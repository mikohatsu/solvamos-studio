/**
 * Google SSO (openid/email/profile) + Drive.readonly for Sovereign RAG.
 *
 * Session: HttpOnly cookie `solvamos_sid` (CSRF state on authorize).
 * Lab ADC path remains optional behind ALLOW_ADC_DRIVE.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { getTenant, upsertTenant } from './tenants.js';
import { provisionCustomerProject } from './provision.js';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
];

const COOKIE_NAME = 'solvamos_sid';
const ADC_SESSION_ID = 'adc_local';
const SESSION_FILE = path.join(process.cwd(), '.data', 'oauth-sessions.json');
const STATE_TTL_MS = 15 * 60 * 1000;
const SESSION_MAX_AGE_SEC = 30 * 24 * 3600;

type OAuthSession = {
  refreshToken?: string;
  accessToken?: string;
  email?: string;
  name?: string;
  picture?: string;
  expiry?: number;
  via?: 'oauth' | 'adc';
  tenantId?: string;
  createdAt?: string;
};

type PendingState = {
  sessionId: string;
  createdAt: number;
};

let oauthSessions: Record<string, OAuthSession> = {};
const pendingStates: Record<string, PendingState> = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      oauthSessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch {
    oauthSessions = {};
  }
}

function saveSessions() {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(oauthSessions, null, 2));
  } catch (err) {
    console.warn('[oauth] failed to persist sessions', err);
  }
}

loadSessions();

function allowAdcDrive(): boolean {
  return process.env.ALLOW_ADC_DRIVE === 'true' || process.env.ALLOW_ADC_DRIVE === '1';
}

export function isOAuthClientConfigured(): boolean {
  return !!(config.googleClientId && config.googleClientSecret);
}

export function isDriveAuthAvailable(): boolean {
  return isOAuthClientConfigured() || allowAdcDrive();
}

function oauthClient(redirectUri?: string) {
  const clientId = config.googleClientId;
  const clientSecret = config.googleClientSecret;
  const redirect = redirectUri || config.oauthRedirectUri;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function resolveSessionId(req: Request): string | undefined {
  const cookies = parseCookies(req);
  const candidates = [
    cookies[COOKIE_NAME],
    req.headers['x-solvamos-session'] as string | undefined,
    typeof req.query.session === 'string' ? req.query.session : undefined,
  ].filter((v): v is string => !!v && v.trim().length > 0);

  for (const id of candidates) {
    const s = oauthSessions[id];
    if (s && (s.accessToken || s.refreshToken || s.via === 'adc')) return id;
  }
  return candidates[0];
}

function setSessionCookie(res: Response, sessionId: string) {
  const secure = config.isProd ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`
  );
}

function clearSessionCookie(res: Response) {
  const secure = config.isProd ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

function emailToTenantId(email: string): string {
  const local = email.split('@')[0] || 'user';
  return local
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20) || 'user';
}

async function ensureTenantForUser(email: string, displayName?: string): Promise<string> {
  const tenantId = emailToTenantId(email);
  const existing = getTenant(tenantId);
  if (existing) return tenantId;

  try {
    await provisionCustomerProject({
      tenantId,
      displayName: displayName || email,
      tier: 'starter',
    });
  } catch (err) {
    console.warn('[oauth] tenant provision failed, registering stub', err);
    upsertTenant({
      tenantId,
      displayName: displayName || email,
      projectId: config.gcpProject || `shared-${tenantId}`,
      tier: 'starter',
      status: 'active',
      tenancyMode: 'shared',
      sharedProject: true,
      createdAt: new Date().toISOString(),
    });
  }
  return tenantId;
}

export function getAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function handleOAuthCallback(code: string, sessionId: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email || undefined;
  const name = me.data.name || undefined;
  const picture = me.data.picture || undefined;

  let tenantId: string | undefined;
  if (email) {
    tenantId = await ensureTenantForUser(email, name || email);
  }

  oauthSessions[sessionId] = {
    refreshToken: tokens.refresh_token || oauthSessions[sessionId]?.refreshToken,
    accessToken: tokens.access_token || undefined,
    email,
    name,
    picture,
    expiry: tokens.expiry_date || undefined,
    via: 'oauth',
    tenantId,
    createdAt: oauthSessions[sessionId]?.createdAt || new Date().toISOString(),
  };
  saveSessions();

  return oauthSessions[sessionId];
}

export function getSession(sessionId: string) {
  return oauthSessions[sessionId];
}

export function destroySession(sessionId: string) {
  delete oauthSessions[sessionId];
  saveSessions();
}

function publicSession(session: OAuthSession | undefined) {
  if (!session) return null;
  const connected = !!(session.accessToken || session.refreshToken || session.via === 'adc');
  return {
    connected,
    email: session.email || null,
    name: session.name || null,
    picture: session.picture || null,
    via: session.via || null,
    tenantId: session.tenantId || null,
  };
}

/** Connect Drive via gcloud ADC (local developer PoC). */
export async function connectViaAdc(): Promise<OAuthSession> {
  const auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  const accessToken = typeof tokenRes === 'string' ? tokenRes : tokenRes?.token;
  if (!accessToken) {
    throw new Error(
      'ADC token unavailable. Prefer GOOGLE_CLIENT_ID/SECRET OAuth Web Client.'
    );
  }

  let email: string | undefined;
  let name: string | undefined;
  let picture: string | undefined;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client as any });
    const me = await oauth2.userinfo.get();
    email = me.data.email || undefined;
    name = me.data.name || undefined;
    picture = me.data.picture || undefined;
  } catch {
    email = process.env.GOOGLE_ADC_EMAIL || 'adc-local@gcloud';
  }

  const tenantId = email ? await ensureTenantForUser(email, name || email) : undefined;

  oauthSessions[ADC_SESSION_ID] = {
    accessToken,
    email,
    name,
    picture,
    via: 'adc',
    expiry: Date.now() + 45 * 60 * 1000,
    tenantId,
    createdAt: new Date().toISOString(),
  };
  saveSessions();
  return oauthSessions[ADC_SESSION_ID];
}

async function authedDrive(sessionId: string) {
  const session = oauthSessions[sessionId];
  if (!session) {
    throw new Error('Not authenticated with Google');
  }

  if (session.via === 'adc' || sessionId === ADC_SESSION_ID) {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const client = await auth.getClient();
    return google.drive({ version: 'v3', auth: client as any });
  }

  if (!session.refreshToken && !session.accessToken) {
    throw new Error('Not authenticated with Google');
  }
  const client = oauthClient();
  client.setCredentials({
    refresh_token: session.refreshToken,
    access_token: session.accessToken,
    expiry_date: session.expiry,
  });

  client.on('tokens', (tokens) => {
    if (tokens.access_token) session.accessToken = tokens.access_token;
    if (tokens.refresh_token) session.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) session.expiry = tokens.expiry_date;
    saveSessions();
  });

  return google.drive({ version: 'v3', auth: client });
}

export async function listDriveChildren(
  sessionId: string,
  parentId = 'root',
  opts?: { foldersOnly?: boolean }
) {
  const drive = await authedDrive(sessionId);
  const safeParent = String(parentId).replace(/'/g, "\\'");
  const foldersOnly = !!opts?.foldersOnly;
  const typeFilter = foldersOnly
    ? ` and mimeType = 'application/vnd.google-apps.folder'`
    : '';
  const res = await drive.files.list({
    q: `'${safeParent}' in parents and trashed = false${typeFilter}`,
    fields: 'files(id, name, mimeType, parents, modifiedTime, size, webViewLink)',
    pageSize: 200,
    orderBy: 'folder,name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name || '(untitled)',
    mimeType: f.mimeType || 'application/octet-stream',
    parents: f.parents || undefined,
    modifiedTime: f.modifiedTime || undefined,
    size: f.size || undefined,
    webViewLink: f.webViewLink || undefined,
    kind:
      f.mimeType === 'application/vnd.google-apps.folder' ? ('folder' as const) : ('file' as const),
  }));
}

/** @deprecated use listDriveChildren */
export async function listDriveFolders(sessionId: string, parentId = 'root') {
  return listDriveChildren(sessionId, parentId, { foldersOnly: true });
}

function successRedirect(sessionId: string, email?: string) {
  const override = process.env.OAUTH_SUCCESS_REDIRECT?.trim();
  if (override && override !== '/' && !override.startsWith('/?')) {
    const url = new URL(override, config.appUrl);
    url.searchParams.set('logged_in', '1');
    url.searchParams.set('session', sessionId);
    if (email) url.searchParams.set('email', email);
    return url.pathname + url.search;
  }
  return `/?logged_in=1&session=${encodeURIComponent(sessionId)}${
    email ? `&email=${encodeURIComponent(email)}` : ''
  }`;
}

function prunePendingStates() {
  const now = Date.now();
  for (const [k, v] of Object.entries(pendingStates)) {
    if (now - v.createdAt > STATE_TTL_MS) delete pendingStates[k];
  }
}

/** Optional middleware: require Google session for mutating studio APIs. */
export function requireGoogleSession(req: Request, res: Response, next: NextFunction) {
  if (!isOAuthClientConfigured() && process.env.REQUIRE_GOOGLE_LOGIN !== 'true') {
    next();
    return;
  }
  const sid = resolveSessionId(req);
  const session = sid ? getSession(sid) : undefined;
  if (!session || !(session.accessToken || session.refreshToken || session.via === 'adc')) {
    res.status(401).json({ status: 'error', message: 'Google login required' });
    return;
  }
  (req as any).solvamosSessionId = sid;
  (req as any).solvamosUser = publicSession(session);
  next();
}

export function registerDriveAuthRoutes(app: import('express').Express) {
  app.get('/api/auth/google', async (req: Request, res: Response) => {
    try {
      if (isOAuthClientConfigured()) {
        prunePendingStates();
        const sessionId = `sess_${crypto.randomBytes(16).toString('hex')}`;
        const state = crypto.randomBytes(24).toString('hex');
        pendingStates[state] = { sessionId, createdAt: Date.now() };
        const url = getAuthUrl(state);
        res.json({
          status: 'success',
          authUrl: url,
          sessionId,
          mode: 'oauth',
          message: 'Redirect browser to authUrl to complete Google SSO',
        });
        return;
      }

      if (allowAdcDrive()) {
        const session = await connectViaAdc();
        setSessionCookie(res, ADC_SESSION_ID);
        res.json({
          status: 'success',
          mode: 'adc',
          sessionId: ADC_SESSION_ID,
          email: session.email,
          name: session.name,
          tenantId: session.tenantId,
          authUrl: null,
          user: publicSession(session),
          message:
            'Connected via ADC (lab only). Set GOOGLE_CLIENT_ID/SECRET for real Google SSO.',
        });
        return;
      }

      res.status(503).json({
        status: 'error',
        message: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured',
        hint: 'GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web). See docs/DRIVE_OAUTH_SETUP.md',
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'error',
        message: err.message,
        hint: 'Check OAuth consent screen + redirect URI http://localhost:3000/api/auth/google/callback',
      });
    }
  });

  app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;
      const oauthError = req.query.error as string | undefined;

      if (oauthError) {
        res.status(400).send(`OAuth denied: ${oauthError}`);
        return;
      }
      if (!code || !state) {
        res.status(400).send('Missing code or state');
        return;
      }

      prunePendingStates();
      const pending = pendingStates[state];
      delete pendingStates[state];
      if (!pending) {
        res.status(400).send('Invalid or expired OAuth state — start login again');
        return;
      }

      const session = await handleOAuthCallback(code, pending.sessionId);
      setSessionCookie(res, pending.sessionId);
      noStore(res);
      res.redirect(successRedirect(pending.sessionId, session.email));
    } catch (err: any) {
      console.error('[oauth] callback', err);
      res.status(500).send(`OAuth error: ${err.message}`);
    }
  });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    noStore(res);
    const sessionId = resolveSessionId(req);
    if (!sessionId) {
      res.json({
        status: 'success',
        connected: false,
        oauthConfigured: isOAuthClientConfigured(),
        user: null,
      });
      return;
    }
    const session = getSession(sessionId);
    const user = publicSession(session);
    if (user?.connected) {
      setSessionCookie(res, sessionId);
    }
    res.json({
      status: 'success',
      connected: !!user?.connected,
      oauthConfigured: isOAuthClientConfigured(),
      sessionId: user?.connected ? sessionId : null,
      user,
      email: user?.email || null,
      via: user?.via || null,
      tenantId: user?.tenantId || null,
    });
  });

  /** @deprecated prefer /api/auth/me — kept for older UI */
  app.get('/api/auth/google/session', (req: Request, res: Response) => {
    noStore(res);
    const sessionId = resolveSessionId(req);
    if (!sessionId) {
      res.status(400).json({ status: 'error', message: 'session required' });
      return;
    }
    const session = getSession(sessionId);
    const user = publicSession(session);
    res.json({
      status: 'success',
      connected: !!user?.connected,
      email: user?.email || null,
      name: user?.name || null,
      picture: user?.picture || null,
      via: user?.via || null,
      tenantId: user?.tenantId || null,
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    noStore(res);
    const sessionId = resolveSessionId(req);
    if (sessionId) destroySession(sessionId);
    clearSessionCookie(res);
    res.json({ status: 'success', connected: false });
  });

  app.get('/api/drive/folders', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const sessionId = resolveSessionId(req);
      if (!sessionId) {
        res.status(401).json({ status: 'error', message: 'Google login required' });
        return;
      }
      const parent = (req.query.parent as string) || 'root';
      const foldersOnly =
        req.query.foldersOnly === '1' ||
        req.query.foldersOnly === 'true' ||
        req.query.files === '0';
      const items = await listDriveChildren(sessionId, parent, { foldersOnly });
      res.json({
        status: 'success',
        parent,
        data: items,
        folders: items.filter((i) => i.kind === 'folder'),
        files: items.filter((i) => i.kind === 'file'),
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      const needsApi =
        /Drive API has not been used|disabled|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg);
      res.status(needsApi ? 503 : 401).json({
        status: 'error',
        message: msg,
        hint: needsApi
          ? 'Enable drive.googleapis.com on the GCP project, then retry folder refresh (not re-login).'
          : 'Re-login with Google if the session expired.',
      });
    }
  });
}
