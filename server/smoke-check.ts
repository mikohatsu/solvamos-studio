/**
 * Smoke helpers for local verification (optional).
 * Run: npx tsx server/smoke-check.ts  (with server already up)
 */
const base = process.env.APP_URL || 'http://127.0.0.1:3000';

async function main() {
  const status = await fetch(`${base}/api/status`).then((r) => r.json());
  console.log('status', status.product, status.tier);

  const tenant = await fetch(`${base}/api/tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: 'smoke-' + Date.now().toString(36),
      displayName: 'Smoke Tenant',
      tier: 'starter',
    }),
  }).then((r) => r.json());
  console.log('tenant', tenant.status, tenant.tenant?.projectId);

  const agent = await fetch(`${base}/api/agents/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'support',
      tone: 'professional',
      securityLevel: 'strict',
      googleDriveFolderId: 'folder-smoke-001',
      tenantId: tenant.tenant?.tenantId,
    }),
  }).then((r) => r.json());
  console.log('agent', agent.status, agent.agentId, agent.vertexDataStoreId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
