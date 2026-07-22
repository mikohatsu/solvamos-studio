/**
 * SolVamos Studio — Express API + Vite (dev) / static (prod)
 * Cloud Run paywall gateway + Vertex AI Search RAG
 */

import express from 'express';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';

import { compileSystemPrompt } from './server/prompt.js';
import { savePrivateKeyToGCP } from './server/vault.js';
import { verifyPayment } from './server/payment.js';
import { ensureDriveDataStore } from './server/rag.js';
import { registerDriveAuthRoutes, isDriveAuthAvailable, isOAuthClientConfigured, requireGoogleSession, resolveSessionId, getSession } from './server/drive-oauth.js';
import { loadTenants, listTenants, getTenant, upsertTenant } from './server/tenants.js';
import { provisionCustomerProject, plannedProjectId, buildProvisionPlan, resolveTenancyMode } from './server/provision.js';
import { provisionTenantCloudRun } from './server/cloudrun-provision.js';
import { config, assertProductionSafety, networkLabel, setPaymentNetwork, paymentNetworkInfo } from './server/config.js';
import {
  loadAgents,
  listAgents,
  getAgent,
  putAgent,
  bumpInvoke,
  type AgentRecord,
} from './server/agents-store.js';
import {
  loadPayShCatalog,
  listCatalog,
  registerAgentOnPayShCatalog,
  getCatalogEntry,
} from './server/paysh-catalog.js';
import { loadWallets, listWallets, addWallet, setPrimaryWallet, removeWallet, getPrimaryWallet, ownerKeyFromEmail, updateWalletLabel } from './server/wallets.js';
import { orchestrateA2ATurn } from './server/a2a.js';

dotenv.config();
assertProductionSafety();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || req.path === '/healthz') {
      console.log(
        JSON.stringify({
          severity: 'INFO',
          httpRequest: {
            requestMethod: req.method,
            requestUrl: req.originalUrl,
            status: res.statusCode,
            latency: `${(Date.now() - start) / 1000}s`,
          },
        })
      );
    }
  });
  next();
});

loadTenants();
loadAgents();
loadPayShCatalog();
loadWallets();
// Ensure every ACTIVE agent is discoverable on pay.sh catalog for A2A
for (const a of listAgents()) {
  if (a.status !== 'PAUSED') {
    void registerAgentOnPayShCatalog(a);
  }
}
registerDriveAuthRoutes(app);

/** Cloud Run / GCLB health */
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, product: config.product, version: config.version });
});

app.get('/readyz', (_req, res) => {
  const ready = !config.isProd || !!config.gcpProject;
  res.status(ready ? 200 : 503).json({
    ready,
    gcpProject: config.gcpProject || null,
    vaultFallback: config.allowLocalVaultFallback,
    paymentBypass: config.allowPaymentBypass,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    product: config.product,
    version: config.version,
    geminiConfigured: !!config.geminiApiKey,
    gcpProject: config.gcpProject || null,
    tenantId: config.tenantId || null,
    tier: config.tier,
    tenancyMode: resolveTenancyMode(),
    provisionMode: config.provisionMode,
    enableOrgProjectCreate: config.enableOrgProjectCreate,
    deployTenantCloudRun: config.deployTenantCloudRun,
    sharedCloudRunImage: config.sharedCloudRunImage || null,
    cloudRunRegion: config.cloudRunRegion,
    orgConfigured: !!(config.orgId || config.customersFolderId),
    billingConfigured: !!config.billingAccount,
    vertexDataStore: config.vertexDataStoreId || null,
    oauthConfigured: isOAuthClientConfigured(),
    driveAuthAvailable: isDriveAuthAvailable(),
    driveAuthMode: isOAuthClientConfigured() ? 'oauth' : 'adc',
    allowLocalVaultFallback: config.allowLocalVaultFallback,
    allowPaymentBypass: config.allowPaymentBypass,
    paymentNetwork: config.paymentNetwork,
    networkLabel: networkLabel(),
    solanaRpcUrl: config.solanaRpcUrl,
    usdcMint: config.usdcMint,
    platformFeeShare: config.platformFeeShare,
    platformTreasuryConfigured: !!config.platformTreasuryPubkey,
    platformTreasuryPubkey: config.platformTreasuryPubkey,
    sandboxProofsAllowed: config.paymentNetwork === 'sandbox' || config.allowPaymentBypass,
    paymentModes: paymentNetworkInfo().modes,
    defaultAgentFeeUsdc: config.defaultAgentFeeUsdc,
    apiEndpoint: `${req.protocol}://${req.get('host')}`,
    totalAgents: listAgents().length,
    payShCatalogListings: listCatalog({ listedOnly: true }).length,
    a2aEnabled: true,
    totalTenants: listTenants().length,
  });
});

app.get('/api/tenants', (_req, res) => {
  res.json({
    status: 'success',
    tenancyMode: resolveTenancyMode(),
    provisionMode: config.provisionMode,
    sharedProjectId: config.gcpProject || null,
    data: listTenants(),
  });
});

app.get('/api/tenants/plan/preview', (req, res) => {
  const tenantId = String(req.query.tenantId || 'demo');
  const displayName = String(req.query.displayName || tenantId);
  const plan = buildProvisionPlan({ tenantId, displayName });
  res.json({ status: 'success', plan });
});

app.post('/api/tenants', requireGoogleSession, async (req, res) => {
  try {
    const { tenantId, displayName, tier, byoProjectId, tenancyMode } = req.body;
    if (!tenantId || !displayName) {
      res.status(400).json({ status: 'error', message: 'tenantId and displayName required' });
      return;
    }
    if (getTenant(tenantId) && !byoProjectId) {
      res.status(409).json({
        status: 'error',
        message: 'Tenant already exists',
        tenant: getTenant(tenantId),
      });
      return;
    }
    const plan = buildProvisionPlan({
      tenantId,
      displayName,
      tier,
      byoProjectId,
      tenancyMode,
    });
    const tenant = await provisionCustomerProject({
      tenantId,
      displayName,
      tier,
      byoProjectId,
      tenancyMode,
    });
    res.status(201).json({
      status: 'success',
      tenant,
      plan,
      plannedProjectId: plannedProjectId(tenantId),
      note:
        plan.tenancyMode === 'shared'
          ? 'Dev/shared: tenant metadata only — all workloads use GOOGLE_CLOUD_PROJECT'
          : 'Product/isolated: cust-* project under Org (live create needs billing + folder)',
      terraformHint:
        plan.tenancyMode === 'isolated'
          ? `infra/terraform customer-project project_id=${tenant.projectId}`
          : null,
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/tenants/:id', (req, res) => {
  const t = getTenant(req.params.id);
  if (!t) {
    res.status(404).json({ status: 'error', message: 'Tenant not found' });
    return;
  }
  res.json({ status: 'success', tenant: t });
});

app.patch('/api/tenants/:id', (req, res) => {
  const existing = getTenant(req.params.id);
  if (!existing) {
    res.status(404).json({ status: 'error', message: 'Tenant not found' });
    return;
  }
  const updated = upsertTenant({ ...existing, ...req.body, tenantId: existing.tenantId });
  res.json({ status: 'success', tenant: updated });
});

/** Redeploy / create tenant Cloud Run in shared project (Lab). */
app.post('/api/tenants/:id/cloud-run', async (req, res) => {
  try {
    const existing = getTenant(req.params.id);
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Tenant not found' });
      return;
    }
    const cloudRun = await provisionTenantCloudRun({
      tenantId: existing.tenantId,
      displayName: existing.displayName,
      tier: existing.tier,
    });
    const updated = upsertTenant({
      ...existing,
      cloudRunUri: cloudRun.uri || existing.cloudRunUri,
      cloudRunServiceName: cloudRun.serviceName,
      cloudRunStatus: cloudRun.status,
      errorMessage: cloudRun.status === 'error' ? cloudRun.message : undefined,
      provisionNotes: [
        ...(existing.provisionNotes || []),
        ...(cloudRun.message ? [cloudRun.message] : []),
      ],
    });
    res.json({
      status: cloudRun.status === 'error' ? 'error' : 'success',
      cloudRun,
      tenant: updated,
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/agents', (_req, res) => {
  res.json({ status: 'success', data: listAgents() });
});

function walletOwnerFromReq(req: import('express').Request): string {
  const sid = resolveSessionId(req);
  const session = sid ? getSession(sid) : undefined;
  return ownerKeyFromEmail(session?.email);
}

app.get('/api/wallets', (req, res) => {
  const owner = walletOwnerFromReq(req);
  const wallets = listWallets(owner);
  res.json({
    status: 'success',
    owner,
    primary: getPrimaryWallet(owner) || null,
    data: wallets,
  });
});

app.post('/api/wallets', (req, res) => {
  try {
    const owner = walletOwnerFromReq(req);
    const { address, label, source, makePrimary } = req.body || {};
    if (!address) {
      res.status(400).json({ status: 'error', message: 'address required' });
      return;
    }
    const wallet = addWallet(owner, {
      address: String(address),
      label: label ? String(label) : undefined,
      source: source ? String(source) : 'manual',
      makePrimary: makePrimary !== false,
    });
    res.status(201).json({
      status: 'success',
      wallet,
      primary: getPrimaryWallet(owner) || null,
      data: listWallets(owner),
    });
  } catch (err: any) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.post('/api/wallets/:id/primary', (req, res) => {
  try {
    const owner = walletOwnerFromReq(req);
    const wallet = setPrimaryWallet(owner, req.params.id);
    res.json({
      status: 'success',
      wallet,
      primary: wallet,
      data: listWallets(owner),
    });
  } catch (err: any) {
    res.status(404).json({ status: 'error', message: err.message });
  }
});

app.patch('/api/wallets/:id', (req, res) => {
  try {
    const owner = walletOwnerFromReq(req);
    const wallet = updateWalletLabel(owner, req.params.id, String(req.body?.label || ''));
    res.json({ status: 'success', wallet, data: listWallets(owner) });
  } catch (err: any) {
    res.status(404).json({ status: 'error', message: err.message });
  }
});

app.delete('/api/wallets/:id', (req, res) => {
  try {
    const owner = walletOwnerFromReq(req);
    const data = removeWallet(owner, req.params.id);
    res.json({
      status: 'success',
      primary: getPrimaryWallet(owner) || null,
      data,
    });
  } catch (err: any) {
    res.status(404).json({ status: 'error', message: err.message });
  }
});

app.post('/api/agents/create', requireGoogleSession, async (req, res) => {
  try {
    const {
      role,
      tone,
      securityLevel,
      customRole,
      googleDriveFolderId,
      tenantId: bodyTenantId,
      agentName,
      perCallPriceUsdc,
      fee,
      recipientWallet,
      usePrimaryWallet,
    } = req.body;

    if (!role || !tone || !securityLevel) {
      res.status(400).json({
        status: 'error',
        message: 'Missing parameters: role, tone, and securityLevel are required.',
      });
      return;
    }

    const sid = resolveSessionId(req);
    const authSession = sid ? getSession(sid) : undefined;
    const tenantId = bodyTenantId || authSession?.tenantId || config.tenantId || undefined;
    const owner = ownerKeyFromEmail(authSession?.email);
    const primary = getPrimaryWallet(owner);

    let publicKey: string;
    let secretKeyBase64: string | undefined;
    let vaultMode: 'user_wallet' | 'default_vault' | 'generated' = 'default_vault';

    const explicit =
      typeof recipientWallet === 'string' && recipientWallet.trim()
        ? String(recipientWallet).trim()
        : null;
    // Only use operator primary wallet when explicitly requested
    const useUser =
      usePrimaryWallet === true && !!primary?.address && !explicit;

    if (explicit) {
      publicKey = explicit;
      vaultMode = 'user_wallet';
      secretKeyBase64 = undefined;
    } else if (useUser) {
      publicKey = primary!.address;
      vaultMode = 'user_wallet';
      secretKeyBase64 = undefined;
    } else {
      // A2A agent vault — lab default pubkey (not the operator "connected wallet")
      publicKey = config.defaultAgentVaultPubkey;
      vaultMode = 'default_vault';
      secretKeyBase64 = undefined;
    }

    const agentId = `${role}-${tone}-${Math.random().toString(36).substr(2, 6)}`;
    const systemPrompt = compileSystemPrompt(role, tone, securityLevel, customRole);

    let vertexDataStoreId: string | undefined;
    let indexingStatus: AgentRecord['status'] = 'ACTIVE';
    if (googleDriveFolderId) {
      const ds = await ensureDriveDataStore({
        displayName: agentName || agentId,
        driveFolderId: googleDriveFolderId,
      });
      vertexDataStoreId = ds.dataStoreId;
      indexingStatus = ds.status === 'pending' ? 'INDEXING' : 'ACTIVE';
    }

    const gcpStorage = secretKeyBase64
      ? await savePrivateKeyToGCP(agentId, secretKeyBase64)
      : { path: `user-wallet:${publicKey}`, mock: false as boolean };

    const parsedFee =
      typeof fee === 'number'
        ? fee
        : typeof perCallPriceUsdc === 'number'
          ? perCallPriceUsdc
          : config.defaultAgentFeeUsdc;

    const newAgent: AgentRecord = {
      id: agentId,
      tenantId,
      agentName,
      role,
      customRole,
      tone,
      securityLevel,
      publicKey,
      systemPrompt,
      created: new Date().toISOString(),
      invokeCount: 0,
      googleDriveFolderId,
      vertexDataStoreId,
      secretManagerPath: gcpStorage.path,
      status: indexingStatus,
      fee: parsedFee,
      perCallPriceUsdc: parsedFee,
    };

    putAgent(newAgent);

    const tenant = tenantId ? getTenant(String(tenantId)) : undefined;
    const runtimeBase =
      (tenant?.cloudRunUri && String(tenant.cloudRunUri).replace(/\/$/, '')) ||
      `${req.protocol}://${req.get('host')}`;

    const listing = await registerAgentOnPayShCatalog(newAgent, {
      baseUrl: runtimeBase,
      description: req.body.description,
    });

    res.status(201).json({
      status: 'success',
      agentId,
      publicKey,
      vaultMode,
      gcpVaultPath: gcpStorage.path,
      isGcpMocked: gcpStorage.mock,
      vertexDataStoreId,
      agent: newAgent,
      payShCatalog: listing,
      runtimeBase,
      cloudRunUri: tenant?.cloudRunUri || null,
      message:
        vaultMode === 'user_wallet'
          ? `Agent created — payouts go to your linked wallet ${publicKey.slice(0, 4)}…`
          : `Agent created — A2A vault ${publicKey.slice(0, 4)}…${publicKey.slice(-4)} (default)`,
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/agents/preview-prompt', (req, res) => {
  const { role, tone, securityLevel, customRole } = req.body;
  const systemPrompt = compileSystemPrompt(
    role || 'support',
    tone || 'professional',
    securityLevel || 'strict',
    customRole
  );
  res.json({ systemPrompt });
});

app.get('/api/agents/:id/balance', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ status: 'error', message: 'Agent not found' });
    return;
  }
  const listing = getCatalogEntry(agent.id);
  res.json({
    status: 'success',
    agentId: agent.id,
    solanaPubkey: agent.publicKey,
    payShConnected: !!listing && listing.status === 'listed',
    payShCatalogId: listing?.catalogId || null,
    currentUsdcBalance: null,
    note: 'Listed on pay.sh catalog for A2A; USDC balance audit is Solana workstream',
  });
});

/** pay.sh catalog — discover agents other A2A callers can pay-invoke */
app.get('/api/paysh/catalog', (_req, res) => {
  res.json({
    status: 'success',
    protocol: 'pay.sh / x402',
    network: networkLabel(),
    paymentNetwork: config.paymentNetwork,
    data: listCatalog({ listedOnly: true }),
  });
});

/** Runtime payment network switch — sandbox (test) ↔ devnet (product path) */
app.get('/api/payment/network', (_req, res) => {
  res.json({ status: 'success', ...paymentNetworkInfo() });
});

app.post('/api/payment/network', (req, res) => {
  const network = String(req.body?.network || '').toLowerCase();
  const result = setPaymentNetwork(network as any, {
    rpcUrl: req.body?.rpcUrl,
    usdcMint: req.body?.usdcMint,
  });
  if (!result.ok) {
    res.status(config.isProd ? 403 : 400).json({ status: 'error', message: result.error });
    return;
  }
  res.json({
    status: 'success',
    message: `Payment network switched to ${config.paymentNetwork}`,
    ...paymentNetworkInfo(),
  });
});
app.post('/api/paysh/catalog/:agentId/register', async (req, res) => {
  try {
    const agent = getAgent(req.params.agentId);
    if (!agent) {
      res.status(404).json({ status: 'error', message: 'Agent not found' });
      return;
    }
    const listing = await registerAgentOnPayShCatalog(agent, {
      baseUrl: `${req.protocol}://${req.get('host')}`,
      description: req.body?.description,
    });
    res.json({ status: 'success', listing });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/agents/:id/invoke', async (req, res) => {
  try {
    const agentId = req.params.id;
    const { prompt, query, enableA2A } = req.body;
    const userPrompt = prompt || query;
    const paymentProof =
      (req.headers['x-payment-proof'] as string) ||
      (req.headers['x-pay-sh-proof'] as string);

    const agent = getAgent(agentId);
    if (!agent) {
      res.status(404).json({ status: 'error', message: `Agent with ID ${agentId} not found.` });
      return;
    }
    if (!userPrompt) {
      res.status(400).json({ status: 'error', message: 'Missing input parameter: prompt' });
      return;
    }

    // Must be on pay.sh catalog to participate in A2A commerce
    let listing = getCatalogEntry(agentId);
    if (!listing || listing.status !== 'listed') {
      listing = await registerAgentOnPayShCatalog(agent, {
        baseUrl: `${req.protocol}://${req.get('host')}`,
      });
    }

    const feeAmount =
      typeof agent.fee === 'number'
        ? agent.fee
        : typeof agent.perCallPriceUsdc === 'number'
          ? agent.perCallPriceUsdc
          : config.defaultAgentFeeUsdc;

    const runOrchestrated = async (paymentLogs: string[]) => {
      const result = await orchestrateA2ATurn({
        agent,
        userPrompt,
        enablePeers: enableA2A !== false,
      });
      bumpInvoke(agentId);
      res.json({
        status: 'success',
        answer: result.answer,
        data: result.answer,
        confidence: result.confidence,
        citations: result.citations,
        ragMode: result.ragMode,
        paymentLogs,
        network: networkLabel(),
        feeUsdc: feeAmount,
        payShCatalogId: listing!.catalogId,
        a2a: {
          catalogUsed: result.catalogUsed,
          planningNote: result.planningNote,
          peerHops: result.peerHops,
        },
      });
    };

    // Free tier — no paywall
    if (feeAmount === 0) {
      await runOrchestrated([`[Free Tier] fee=0 USDC — paywall skipped on ${networkLabel()}`]);
      return;
    }

    if (!paymentProof) {
      const agentShare = 1 - config.platformFeeShare;
      res.status(402).json({
        status: 'payment_required',
        amount: feeAmount,
        token: 'USDC',
        recipientWallet: agent.publicKey,
        platformTreasury: config.platformTreasuryPubkey || null,
        agentShareUsdc: feeAmount * agentShare,
        platformShareUsdc: feeAmount * config.platformFeeShare,
        network: networkLabel(),
        paymentNetwork: config.paymentNetwork,
        usdcMint: config.usdcMint,
        payShCatalogId: listing.catalogId,
        invokeUrl: listing.invokeUrl,
        message: `HTTP 402: Pay ${feeAmount} USDC on ${networkLabel()} (≈${(agentShare * 100).toFixed(0)}% agent / ${(config.platformFeeShare * 100).toFixed(0)}% platform). Attach signature in X-PAYMENT-PROOF. Agent is listed on pay.sh catalog for A2A.`,
      });
      return;
    }

    const audit = await verifyPayment(paymentProof, agent.publicKey, feeAmount);
    if (!audit.verified) {
      res.status(402).json({
        status: 'payment_verification_failed',
        message: `On-chain validation failed: ${audit.error || 'Transaction verification error'}`,
        logs: audit.logs,
        network: audit.network,
      });
      return;
    }

    await runOrchestrated(audit.logs);
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

async function startServer() {
  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[${config.product}] v${config.version} http://0.0.0.0:${config.port}`);
  });
}

startServer();
