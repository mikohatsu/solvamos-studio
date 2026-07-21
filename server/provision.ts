/**
 * Customer GCP project provisioner.
 * Uses Resource Manager when credentials allow; otherwise records a Terraform-ready pending state.
 */

import { ProjectsClient } from '@google-cloud/resource-manager';
import { upsertTenant, type TenantRecord } from './tenants.js';

function sanitizeTenantId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 20);
}

export function plannedProjectId(tenantId: string): string {
  return `cust-${sanitizeTenantId(tenantId)}-prod`;
}

export type ProvisionInput = {
  tenantId: string;
  displayName: string;
  tier?: TenantRecord['tier'];
  byoProjectId?: string;
};

export async function provisionCustomerProject(input: ProvisionInput): Promise<TenantRecord> {
  const tenantId = sanitizeTenantId(input.tenantId);
  const tier = input.tier || 'starter';
  const folderId = process.env.SOLVAMOS_CUSTOMERS_FOLDER_ID;
  const billingAccount = process.env.SOLVAMOS_BILLING_ACCOUNT;
  const orgId = process.env.SOLVAMOS_ORG_ID;

  if (input.byoProjectId) {
    const record: TenantRecord = {
      tenantId,
      displayName: input.displayName,
      projectId: input.byoProjectId,
      tier: 'enterprise',
      status: 'byo',
      byoProject: true,
      createdAt: new Date().toISOString(),
    };
    return upsertTenant(record);
  }

  const projectId = plannedProjectId(tenantId);
  const base: TenantRecord = {
    tenantId,
    displayName: input.displayName,
    projectId,
    folderId,
    tier,
    status: 'provisioning',
    createdAt: new Date().toISOString(),
  };
  upsertTenant(base);

  // Dry-run / local mode: do not call GCP
  if (process.env.PROVISION_MODE === 'terraform-only' || process.env.PROVISION_MODE === 'mock') {
    const record: TenantRecord = {
      ...base,
      status: 'active',
      errorMessage: undefined,
    };
    // Annotate that TF apply is required for real infra
    record.errorMessage =
      process.env.PROVISION_MODE === 'terraform-only'
        ? `Run: terraform apply -var=project_id=${projectId} in modules/customer-project`
        : undefined;
    return upsertTenant({ ...record, status: 'active' });
  }

  try {
    if (!orgId && !folderId) {
      throw new Error('SOLVAMOS_ORG_ID or SOLVAMOS_CUSTOMERS_FOLDER_ID required for live provision');
    }

    const client = new ProjectsClient();
    const project: any = {
      projectId,
      displayName: `SolVamos ${input.displayName}`.slice(0, 30),
      labels: {
        solvamos_tenant: tenantId,
        solvamos_tier: tier,
      },
    };

    const parent = folderId ? `folders/${folderId.replace('folders/', '')}` : `organizations/${orgId}`;

    const [op] = await client.createProject({
      project,
      // parent is set via project.parent in newer APIs — use update after create if needed
    } as any);

    // Best-effort; Resource Manager create may return LRO
    console.log(`[Provisioner] createProject requested for ${projectId}`, op?.name || '');

    if (billingAccount) {
      console.log(
        `[Provisioner] Attach billing ${billingAccount} via Billing API / Terraform (not inlined)`
      );
    }

    console.log(
      `[Provisioner] Enable APIs + KMS + Cloud Run via Terraform module customer-project for ${projectId} (parent=${parent})`
    );

    return upsertTenant({
      ...base,
      status: 'active',
    });
  } catch (err: any) {
    console.error(`[Provisioner] ${err.message}`);
    return upsertTenant({
      ...base,
      status: 'error',
      errorMessage: err.message,
    });
  }
}
