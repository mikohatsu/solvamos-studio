/**
 * pay.sh Solana catalog — local registry that agents must be listed on
 * before they can be discovered / paid-invoked by peers.
 *
 * Mode:
 * - local (default): persist to .data/paysh-catalog.json
 * - remote: POST/GET PAYSH_CATALOG_URL when set (future pay.sh API)
 */

import fs from 'fs';
import { config } from './config.js';
import type { AgentRecord } from './agents-store.js';
import { dataFile, ensureDataDir } from './data-paths.js';

export type PayShCatalogEntry = {
  catalogId: string;
  agentId: string;
  name: string;
  description: string;
  role: string;
  tone: string;
  /** pay.sh / x402 invoke endpoint (relative or absolute) */
  invokeUrl: string;
  recipientWallet: string;
  feeUsdc: number;
  token: 'USDC';
  network: string;
  usdcMint: string;
  status: 'listed' | 'unlisted' | 'paused';
  listedAt: string;
  tenantId?: string;
  tags: string[];
};

const CATALOG_FILE = dataFile('paysh-catalog.json');

let catalog: Record<string, PayShCatalogEntry> = {};

export function loadPayShCatalog() {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(catalog).length} pay.sh catalog listings.`);
    }
  } catch (err) {
    console.error('pay.sh catalog load failed', err);
    catalog = {};
  }
}

function saveCatalog() {
  try {
    ensureDataDir();
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), 'utf8');
  } catch (err) {
    console.error('pay.sh catalog save failed', err);
  }
}

export function listCatalog(opts?: { listedOnly?: boolean }): PayShCatalogEntry[] {
  const rows = Object.values(catalog);
  if (opts?.listedOnly !== false) {
    return rows.filter((e) => e.status === 'listed');
  }
  return rows;
}

export function getCatalogEntry(agentId: string): PayShCatalogEntry | undefined {
  return catalog[agentId];
}

export function buildInvokeUrl(agentId: string, baseUrl?: string): string {
  const base = (baseUrl || config.appUrl || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/agents/${agentId}/invoke`;
}

/** Register / refresh agent on pay.sh catalog (required for A2A discovery). */
export async function registerAgentOnPayShCatalog(
  agent: AgentRecord,
  opts?: { baseUrl?: string; description?: string }
): Promise<PayShCatalogEntry> {
  const name =
    agent.agentName || agent.customRole || `${agent.role} / ${agent.tone}`;
  const fee =
    typeof agent.fee === 'number'
      ? agent.fee
      : typeof agent.perCallPriceUsdc === 'number'
        ? agent.perCallPriceUsdc
        : config.defaultAgentFeeUsdc;

  const entry: PayShCatalogEntry = {
    catalogId: `paysh_${agent.id}`,
    agentId: agent.id,
    name,
    description:
      opts?.description ||
      `SolVamos A2A agent (${agent.role}). Grounded RAG + x402 USDC paywall.`,
    role: agent.role,
    tone: agent.tone,
    invokeUrl: buildInvokeUrl(agent.id, opts?.baseUrl),
    recipientWallet: agent.publicKey,
    feeUsdc: fee,
    token: 'USDC',
    network: config.paymentNetwork,
    usdcMint: config.usdcMint,
    status: agent.status === 'PAUSED' ? 'paused' : 'listed',
    listedAt: catalog[agent.id]?.listedAt || new Date().toISOString(),
    tenantId: agent.tenantId,
    tags: ['solvamos', 'a2a', 'x402', agent.role, agent.tone].filter(Boolean),
  };

  // Optional remote publish hook
  const remote = process.env.PAYSH_CATALOG_URL;
  if (remote && process.env.PAYSH_CATALOG_MODE === 'remote') {
    try {
      await fetch(`${remote.replace(/\/$/, '')}/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.PAYSH_CATALOG_API_KEY
            ? { Authorization: `Bearer ${process.env.PAYSH_CATALOG_API_KEY}` }
            : {}),
        },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      console.warn('[pay.sh catalog] remote publish failed, keeping local listing', err);
    }
  }

  catalog[agent.id] = entry;
  saveCatalog();
  return entry;
}

export function unlistFromCatalog(agentId: string) {
  if (catalog[agentId]) {
    catalog[agentId].status = 'unlisted';
    saveCatalog();
  }
}
