/**
 * Google OAuth (drive.readonly) + Drive folder listing for customer GW.
 */

import { google } from 'googleapis';
import type { Request, Response } from 'express';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email', 'profile'];

// In-memory session store for demo (replace with signed cookies / Firestore in prod)
const oauthSessions: Record<
  string,
  { refreshToken?: string; accessToken?: string; email?: string; expiry?: number }
> = {};

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
  };

  return oauthSessions[sessionId];
}

export function getSession(sessionId: string) {
  return oauthSessions[sessionId];
}

async function authedDrive(sessionId: string) {
  const session = oauthSessions[sessionId];
  if (!session?.refreshToken && !session?.accessToken) {
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
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, parents)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

export function registerDriveAuthRoutes(app: import('express').Express) {
  app.get('/api/auth/google', (req: Request, res: Response) => {
    try {
      const sessionId =
        (req.headers['x-solvamos-session'] as string) ||
        (req.query.session as string) ||
        `sess_${Math.random().toString(36).slice(2)}`;
      const url = getAuthUrl(sessionId);
      res.json({ status: 'success', authUrl: url, sessionId });
    } catch (err: any) {
      res.status(503).json({
        status: 'error',
        message: err.message,
        hint: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for customer Workspace OAuth',
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
      const redirect =
        process.env.OAUTH_SUCCESS_REDIRECT ||
        `/?drive_connected=1&session=${encodeURIComponent(sessionId)}&email=${encodeURIComponent(session.email || '')}`;
      res.redirect(redirect);
    } catch (err: any) {
      res.status(500).send(`OAuth error: ${err.message}`);
    }
  });

  app.get('/api/auth/google/session', (req: Request, res: Response) => {
    const sessionId = (req.headers['x-solvamos-session'] as string) || (req.query.session as string);
    if (!sessionId) {
      res.status(400).json({ status: 'error', message: 'session required' });
      return;
    }
    const session = getSession(sessionId);
    res.json({
      status: 'success',
      connected: !!(session?.accessToken || session?.refreshToken),
      email: session?.email || null,
    });
  });

  app.get('/api/drive/folders', async (req: Request, res: Response) => {
    try {
      const sessionId = (req.headers['x-solvamos-session'] as string) || (req.query.session as string);
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
