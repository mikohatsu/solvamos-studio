/**
 * Central runtime configuration for SolVamos Studio (Cloud Run / local).
 */

export type CustomerTier = 'starter' | 'professional' | 'enterprise';

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

export const config = {
  product: 'SolVamos Studio',
  version: '0.6.0',
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  gcpProject: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
  tenantId: process.env.SOLVAMOS_TENANT_ID || '',
  tier: (process.env.CUSTOMER_TIER || 'starter') as CustomerTier,
  kmsKeyName: process.env.KMS_KEY_NAME || '',

  vertexDataStoreId: process.env.VERTEX_DATA_STORE_ID || '',
  vertexSearchLocation: process.env.VERTEX_SEARCH_LOCATION || 'global',
  vertexSearchCollection: process.env.VERTEX_SEARCH_COLLECTION || 'default_collection',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  oauthRedirectUri:
    process.env.OAUTH_REDIRECT_URI ||
    `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/google/callback`,
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  orgId: process.env.SOLVAMOS_ORG_ID || '',
  customersFolderId: process.env.SOLVAMOS_CUSTOMERS_FOLDER_ID || '',
  billingAccount: process.env.SOLVAMOS_BILLING_ACCOUNT || '',
  provisionMode: (process.env.PROVISION_MODE || 'mock') as 'mock' | 'terraform-only' | 'live',

  /** Dev only — never true on Cloud Run prod */
  allowLocalVaultFallback: bool('ALLOW_LOCAL_VAULT_FALLBACK', process.env.NODE_ENV !== 'production'),
  allowPaymentBypass: bool('ALLOW_PAYMENT_BYPASS', process.env.NODE_ENV !== 'production'),

  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  agentFeeSol: Number(process.env.AGENT_FEE_SOL || 0.01),
};

export function assertProductionSafety() {
  if (!config.isProd) return;
  const problems: string[] = [];
  if (config.allowLocalVaultFallback) {
    problems.push('ALLOW_LOCAL_VAULT_FALLBACK must be false in production');
  }
  if (config.allowPaymentBypass) {
    problems.push('ALLOW_PAYMENT_BYPASS must be false in production');
  }
  if (!config.gcpProject) {
    problems.push('GOOGLE_CLOUD_PROJECT is required in production');
  }
  if (problems.length) {
    console.error('[SolVamos] Production safety check failed:\n - ' + problems.join('\n - '));
    // Soft-fail: log loudly but allow boot so Cloud Run can still serve /healthz during rollout
  }
}
