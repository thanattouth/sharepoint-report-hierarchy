# ADR 0014: Use one customer manifest and Azure deployment outputs for delivery

Status: Accepted

## Context

Infrastructure and Entra provisioning already accepted a validated customer manifest, but Function
package/publish and scanner federation still depended on populated pilot `.env.*.local` profiles.
Derived Function App names also had to be copied into `webHosting`. A stale profile could therefore
target another subscription/resource group even when the customer manifest was correct.

## Decision

Use customer delivery manifest schema v3 as the only production delivery input.

- Keep only customer-selected values and rediscovered target identifiers in the manifest.
- Resolve Function App names, hostnames, managed-identity IDs and federation subjects from named
  Azure deployment outputs.
- Run scanner federation, workload publish and workload verification through `delivery:*` commands
  that require `--manifest`.
- Remove every managed pilot env key before a manifest-driven publisher starts child processes.
- Keep legacy `p4:*` through `p7:*` env-profile commands only for bounded pilot/operator workflows.
- Verify Azure CLI tenant/subscription, exact workload RBAC, scanner federation, indexed core
  functions, HTTPS-only state and disabled schedules before continuing delivery.
- Query Flex Consumption site state through `Microsoft.Web/sites@2024-04-01` because the generic
  Function App CLI surface may return null lifecycle properties.

## Consequences

A fresh clone no longer needs local pilot env files to publish production Functions. App Service
configuration cannot drift because an operator copied generated Function names incorrectly. The
delivery sequence remains deliberately gated rather than becoming one broad mutation command.

Schema v3 is a breaking manifest change, but it removes derived fields instead of changing deployed
resource identities. Existing Azure resources are unchanged until their explicit deploy/publish
steps run.

## Migration and rollback

To migrate a schema-v2 manifest:

1. Change `schemaVersion` to `3`.
2. Remove `webHosting.reportApiFunctionAppName`.
3. Remove `webHosting.configurationAdminFunctionAppName`.
4. Run delivery preflight, scanner federation plan, workload check and Web What-if.

Do not change tenant/subscription/resource names during this manifest-only migration. Roll back the
repository before a production mutation by restoring the last schema-v2 release and manifest. After
publishing, roll back workloads or Web by redeploying the previous package; keep Azure resources,
Table data and Key Vault secret versions intact.
