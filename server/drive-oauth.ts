/**
 * Google OAuth (drive.readonly) + Drive folder listing for customer GW.
 * Local PoC: ALLOW_ADC_DRIVE=true uses gcloud Application Default Credentials
 * when GOOGLE_CLIENT_ID/SECRET are unset.
 */

import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import type { Request, Response } from 'express';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'openid',
  'email',
  'profile',
];

const ADC_SESSION_ID = 'adc_local';
const SESSION_FILE = path.join(process.cwd(), '.data', 'oauth-sessions.json');

type OAuthSession = {
  refreshToken?: string;
  accessToken?: string;
  email?: string;
  expiry?: number;
  via?: 'oauth' | 'adc';
};

let oauthSessions: Record<string, OAuthSession> = {};

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
  // Off by default: Google blocks ADC + drive.readonly ("sensitive info" interstitial).
  // Prefer OAuth Web Client. Only enable explicitly for rare lab setups.
  return process.env.ALLOW_ADC_DRIVE === 'true' || process.env.ALLOW_ADC_DRIVE === '1';
}

export function isOAuthClientConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isDriveAuthAvailable(): boolean {
  return isOAuthClientConfigured() || allowAdcDrive();
}

function oauthClient(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect =
    redirectUri ||
    process.env.OAUTH_REDIRECT_URI ||
    `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

export function getAuthUrl(state: string): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

export async function handleOAuthCallback(code: string, sessionId: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();

  oauthSessions[sessionId] = {
    refreshToken: tokens.refresh_token || oauthSessions[sessionId]?.refreshToken,
    accessToken: tokens.access_token || undefined,
    email: me.data.email || undefined,
    expiry: tokens.expiry_date || undefined,
    via: 'oauth',
  };
  saveSessions();

  return oauthSessions[sessionId];
}

export function getSession(sessionId: string) {
  return oauthSessions[sessionId];
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
      'ADC token unavailable. Run: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/userinfo.email'
    );
  }

  let email: string | undefined;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client as any });
    const me = await oauth2.userinfo.get();
    email = me.data.email || undefined;
  } catch {
    email = process.env.GOOGLE_ADC_EMAIL || 'adc-local@gcloud';
  }

  oauthSessions[ADC_SESSION_ID] = {
    accessToken,
    email,
    via: 'adc',
    expiry: Date.now() + 45 * 60 * 1000,
  };
  saveSessions();
  return oauthSessions[ADC_SESSION_ID];
}

async function authedDrive(sessionId: string) {
  const session = oauthSessions[sessionId];
  if (!session) {
    throw new Error('Not authenticated with Google Drive');
  }

  if (session.via === 'adc' || sessionId === ADC_SESSION_ID) {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const client = await auth.getClient();
    return google.drive({ version: 'v3', auth: client as any });
  }

  if (!session.refreshToken && !session.accessToken) {
    throw new Error('Not authenticated with Google Drive');
  }
  const client = oauthClient();
  client.setCredentials({
    refresh_token: session.refreshToken,
    access_token: session.accessToken,
  });
  return google.drive({ version: 'v3', auth: client });
}

export async function listDriveFolders(sessionId: string, parentId = 'root') {
  const drive = await authedDrive(sessionId);
  // Escape single quotes in folder id for Drive query
  const safeParent = String(parentId).replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${safeParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

function successRedirect(sessionId: string, email?: string) {
  const override = process.env.OAUTH_SUCCESS_REDIRECT?.trim();
  // Bare "/" would drop session query — ignore it
  if (override && override !== '/' && !override.startsWith('/?')) {
    const url = new URL(override, process.env.APP_URL || 'http://localhost:3000');
    url.searchParams.set('drive_connected', '1');
    url.searchParams.set('session', sessionId);
    if (email) url.searchParams.set('email', email);
    return url.pathname + url.search;
  }
  return `/?drive_connected=1&session=${encodeURIComponent(sessionId)}&email=${encodeURIComponent(email || '')}`;
}

export function registerDriveAuthRoutes(app: import('express').Express) {
  app.get('/api/auth/google', async (req: Request, res: Response) => {
    try {
      // Prefer real OAuth web client when configured
      if (isOAuthClientConfigured()) {
        const sessionId =
          (req.headers['x-solvamos-session'] as string) ||
          (req.query.session as string) ||
          `sess_${Math.random().toString(36).slice(2)}`;
        const url = getAuthUrl(sessionId);
        res.json({ status: 'success', authUrl: url, sessionId, mode: 'oauth' });
        return;
      }

      // Local ADC fallback
      if (allowAdcDrive()) {
        const session = await connectViaAdc();
        res.json({
          status: 'success',
          mode: 'adc',
          sessionId: ADC_SESSION_ID,
          email: session.email,
          authUrl: null,
          message:
            'Connected via gcloud Application Default Credentials (local PoC). Set GOOGLE_CLIENT_ID/SECRET for real Google SSO.',
        });
        return;
      }

      res.status(503).json({
        status: 'error',
        message: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured',
        hint: 'Create OAuth Web Client in GCP Console, or set ALLOW_ADC_DRIVE=true and run gcloud auth application-default login with drive.readonly scope',
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'error',
        message: err.message,
        hint: 'Set GOOGLE_CLIENT_ID/SECRET, or: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/userinfo.email',
      });
    }
  });

  app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const sessionId = (req.query.state as string) || 'default';
      if (!code) {
        res.status(400).send('Missing code');
        return;
      }
      const session = await handleOAuthCallback(code, sessionId);
      res.redirect(successRedirect(sessionId, session.email));
    } catch (err: any) {
      res.status(500).send(`OAuth error: ${err.message}`);
    }
  });

  app.get('/api/auth/google/session', (req: Request, res: Response) => {
    const sessionId =
      (req.headers['x-solvamos-session'] as string) || (req.query.session as string);
    if (!sessionId) {
      res.status(400).json({ status: 'error', message: 'session required' });
      return;
    }
    const session = getSession(sessionId);
    res.json({
      status: 'success',
      connected: !!(session?.accessToken || session?.refreshToken || session?.via === 'adc'),
      email: session?.email || null,
      via: session?.via || null,
    });
  });

  app.get('/api/drive/folders', async (req: Request, res: Response) => {
    try {
      const sessionId =
        (req.headers['x-solvamos-session'] as string) || (req.query.session as string);
      if (!sessionId) {
        res.status(401).json({ status: 'error', message: 'X-SolVamos-Session required' });
        return;
      }
      const parent = (req.query.parent as string) || 'root';
      const folders = await listDriveFolders(sessionId, parent);
      res.json({ status: 'success', data: folders });
    } catch (err: any) {
      res.status(401).json({ status: 'error', message: err.message });
    }
  });
}
