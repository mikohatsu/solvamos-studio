/**
 * Tenant registry: tenant_id → GCP project_id
 */

import fs from 'fs';
import { dataFile, ensureDataDir } from './data-paths.js';

export type TenantRecord = {
  tenantId: string;
  displayName: string;
  projectId: string;
  folderId?: string;
  tier: 'starter' | 'professional' | 'enterprise';
  status: 'provisioning' | 'active' | 'error' | 'byo';
  createdAt: string;
  kmsKeyId?: string;
  cloudRunUri?: string;
  cloudRunServiceName?: string;
  cloudRunStatus?: 'active' | 'pending_image' | 'skipped' | 'error' | string;
  errorMessage?: string;
  byoProject?: boolean;
  /** shared = one PoC GCP project; isolated = cust-{id}-prod under Org */
  tenancyMode?: 'shared' | 'isolated';
  sharedProject?: boolean;
  provisionNotes?: string[];
};

const TENANTS_FILE = dataFile('tenants_db.json');

let tenants: Record<string, TenantRecord> = {};

export function loadTenants() {
  try {
    if (fs.existsSync(TENANTS_FILE)) {
      tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load tenants_db.json', err);
  }
}

function save() {
  try {
    ensureDataDir();
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save tenants_db.json', err);
  }
}

export function listTenants(): TenantRecord[] {
  return Object.values(tenants);
}

export function getTenant(tenantId: string): TenantRecord | undefined {
  return tenants[tenantId];
}

export function upsertTenant(record: TenantRecord): TenantRecord {
  tenants[record.tenantId] = record;
  save();
  return record;
}

export function projectIdForTenant(tenantId: string): string | undefined {
  return tenants[tenantId]?.projectId;
}
