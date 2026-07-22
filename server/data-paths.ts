/**
 * Writable data directory for JSON stores.
 * Cloud Run image runs as non-root `node` → /app is often read-only for mkdir.
 * Production default: /tmp/solvamos-data (ephemeral).
 */
import fs from 'fs';
import path from 'path';

export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.NODE_ENV === 'production') return '/tmp/solvamos-data';
  return path.join(process.cwd(), '.data');
}

export function dataFile(name: string): string {
  return path.join(resolveDataDir(), name);
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
