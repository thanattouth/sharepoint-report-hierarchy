# Customer single-tenant delivery

Deploy one isolated instance per customer tenant. Do not transfer the pilot subscription or copy
tenant-bound identities. Re-provision Azure resources and Entra applications in the target tenant,
then rediscover SharePoint Sites, sensitivity labels, and Entra groups before importing business
configuration.

## Delivery contract

- Keep customer-specific values in an ignored `delivery-instances/<customer>/manifest.json` copied
  from `config/customer-delivery.example.json`.
- Schema v3 is the only production delivery input. Workload Function App names and managed-identity
  IDs are derived from Azure deployment outputs; never copy them into the manifest or a local env
  profile.
- The manifest contains identifiers and resource names only. Never place credentials, Function
  keys, Entra client secrets, file metadata, or Graph tokens in it.
- Run preflight before every mutation. It fails closed when Azure CLI targets another tenant or
  subscription, the subscription is disabled, required providers are unavailable, naming is
  unsafe, or the operator cannot create resources.
- Run Azure What-if before Deploy. Foundation deployment is incremental and idempotent.
- Use a dedicated Resource Group and Storage account with Shared Key disabled. Never reuse the
  cross-tenant pilot cache.
- When the operator cannot create role assignments, use `admin-handoff` mode. Provision resources
  without RBAC and stop before publishing workloads or reading/writing Table data. An authorized
  administrator must apply the documented exact-scope roles; Shared Key is not a fallback.
- Create new single-tenant Entra application objects. App registrations, service principals,
  managed identities, RBAC assignments, SharePoint Site IDs, Entra group IDs, and sensitivity
  label IDs are target-tenant configuration and are never copied as authoritative IDs.
- Import portable business nodes only after validation. Rebind assignments and Site placements to
  immutable objects discovered in the target tenant. Build a fresh cache by scanning the target
  tenant; do not migrate the pilot inventory or delta cursors.
- Keep the source deployment intact until target smoke tests and customer UAT pass. Cutover and
  source teardown are separate approved operations.

## Clone-to-production prerequisites

Install Node.js 22.13 or later, npm, Azure CLI, Azure Bicep and zip. Clone the repository, run
`npm ci`, copy the example manifest into the ignored customer directory and replace every example
identifier with values rediscovered in the target tenant.

The delivery operator must sign in to the exact target tenant/subscription. Foundation deployment
requires resource Contributor access. Workload and Web deployment additionally require Owner,
Role Based Access Control Administrator or User Access Administrator because the templates create
least-privilege managed-identity assignments. Microsoft Graph admin consent remains a separate
customer-admin approval.

### Migrate a schema-v2 manifest

Change `schemaVersion` to `3` and remove the generated fields
`webHosting.reportApiFunctionAppName` and
`webHosting.configurationAdminFunctionAppName`. Do not change tenant/subscription/resource names
during this manifest-only migration. Then rerun preflight, scanner federation plan, workload check
and Web What-if before any deploy or publish operation. See
[ADR 0014](adr/0014-use-one-manifest-and-deployment-outputs-for-delivery.md).

## Foundation rehearsal

```bash
cp config/customer-delivery.example.json delivery-instances/<customer>/manifest.json
npm run delivery:preflight -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:foundation:what-if -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:foundation:deploy -- --manifest delivery-instances/<customer>/manifest.json
```

Foundation creates only the dedicated Resource Group, hardened Storage account, and canonical
Tables. It does not grant Graph permissions, consent to applications, publish scanner/API code,
copy cached data, seed Sites, enable schedules, change web traffic, or delete the source instance.

Plan and create target-tenant application objects without granting consent or generating a client
secret:

```bash
npm run delivery:entra:plan -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:entra:apply -- --manifest delivery-instances/<customer>/manifest.json
```

The identity stage creates a single-tenant Report Web application with `ReportAdmin` and
`ReportViewer` roles plus a separate single-tenant Scanner application. It records requested Graph
permissions but intentionally stops before admin consent. The scanner requests application
`Files.Read.All` and `Sites.Read.All`; the optional server-side group picker requests delegated
`GroupMember.Read.All`. Review and consent remain explicit customer-admin gates.
Every created Service Principal receives the `WindowsAzureActiveDirectoryIntegratedApp` tag so it
appears under the Entra **Enterprise applications** filter when provisioned through the CLI.

After Graph consent and Azure RBAC gates pass, deploy the three workload boundaries with schedules
disabled:

```bash
npm run delivery:workloads:what-if -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:workloads:deploy -- --manifest delivery-instances/<customer>/manifest.json
```

This creates separate Scanner, Report API, and Configuration Admin Function Apps, host storage,
managed identities, telemetry, and exact-scope role assignments. It does not publish code or start
a scan. The workload manifest must keep `schedulesDisabled=true` during initial delivery.

Configure scanner workload federation, package all three Functions, publish them and run the
read-only workload check. Every command reads the same manifest and ignores populated pilot env
profiles:

```bash
npm run delivery:scanner:federation:plan -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:scanner:federation:apply -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:workloads:package
npm run delivery:workloads:publish:plan -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:workloads:publish:apply -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:workloads:check -- --manifest delivery-instances/<customer>/manifest.json
```

The federation step binds the target-tenant Scanner App Registration to the managed identity
created by the scanner deployment. Publish fails closed if that credential is missing or drifted.
The workload check verifies all three Function Apps, indexed core functions, exact workload RBAC,
tenant-pinned federation, HTTPS-only state and disabled schedules without returning file metadata.

After workload verification, create the customer-managed access groups and bootstrap the portable
hierarchy. Always inspect the access plan first:

```bash
npm run delivery:access:plan -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:access:apply -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:configuration:bootstrap -- --manifest delivery-instances/<customer>/manifest.json
```

The access stage creates one Report Admin group plus the manifest's business-scope groups, adds
only the explicit bootstrap members, and assigns `ReportAdmin`/`ReportViewer` to the Web enterprise
application. The configuration bootstrap resolves those groups by immutable target-tenant Object
ID, imports only the manifest nodes, assigns scope, places the controlled Site, writes audit events,
and reads the result back for validation. It never imports source-tenant users, groups, Site IDs, or
inventory. Reruns are idempotent; conflicting existing rows fail closed instead of being overwritten.
The schema-v3 manifest has no Report API user allowlist: adding or removing report users is an Entra
group membership operation, while immutable group-to-business-node assignments remain in Azure Table.

For local Vinext/Cloudflare UAT without a `.dev.vars` file, pass
`CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so the Worker receives the process-scoped bindings. Keep
client secrets, session keys, and Function keys outside the manifest and repository. Do not update
the production Sites environment until local Entra, report, admin, and logout UAT passes.

## Customer-owned Azure App Service

Add `webHosting` to the ignored customer manifest with globally unique Web App and Key Vault names,
an explicit SKU, and the group-picker feature gate. Report and Configuration Function App names are
resolved from their deployment outputs. Include
both the local callback (when local UAT is retained) and the exact production callback
`https://<app-name>.azurewebsites.net/api/auth/entra/callback` in `entra.webRedirectUris`.

Use B1 only for delivery rehearsal or low-volume acceptance testing. Choose S1 or P0v3 after the
customer approves availability, scale, deployment-slot, backup, and cost requirements.

```bash
npm run delivery:web:what-if -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:web:deploy -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:web:secrets -- --manifest delivery-instances/<customer>/manifest.json
npm run package:azure-web
npm run delivery:web:publish -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:web:check -- --manifest delivery-instances/<customer>/manifest.json
```

The infrastructure stage creates a dedicated Linux plan, Web App system-managed identity, Key
Vault, App Insights/Log Analytics, least-privilege Key Vault roles, hardened HTTPS/TLS settings,
and versionless Key Vault references. It also installs the exact production callback and requires
explicit user/group assignment on the target enterprise application. The deploy stage also sets
the App Registration homepage and service principal `loginUrl` to the same canonical HTTPS root;
that root starts the application's OIDC flow when Microsoft My Apps launches it. It does not create
a client secret during What-if or infrastructure deployment.

The secrets stage creates one expiring Entra confidential-client credential, a random 256-bit
session key, and separate `web-bridge` Function host keys. Values move directly into Key Vault and
are never written to the manifest, repository, deployment output, or App Service settings. A normal
rerun is a no-op when all four managed secrets exist; deliberate rotation requires invoking
`scripts/delivery-web-secrets.ts --rotate` in an approved change window, verifying the new login,
then removing superseded Entra credentials after rollback expiry.

The check stage fails closed unless all Key Vault references resolve, HTTPS-only is active, the
enterprise application requires assignment, its My Apps launch URL is exact, callback URIs exactly
match the manifest, the public health surface responds, and an anonymous report request reaches the
target tenant's OIDC endpoint.
Complete one interactive ReportAdmin and one ReportViewer/no-role UAT before production cutover.

## Controlled multi-Site baseline

Keep both scanner timers disabled while expanding beyond the single-Site proof. Tenant discovery
may persist readable Sites as inactive candidates, but an operator must select and review an exact
wave of 1–10 Site IDs and their immutable document-library drive IDs before activation. Use:

```bash
npm run p5:scanner:select-wave-1:local
npm run p5:scanner:review-wave-1:local
npm run p5:scanner:activate-wave-1:local
npm run p5:scanner:run-wave-1:local
npm run p5:scanner:audit-wave-1:local
```

The coordinator queues one Site at a time. It stops on failed or throttled outcomes and requires
operator review for locked/unsupported partial outcomes. An approved skip keeps the run evidence,
disables that Site from future schedules, and allows the remaining wave to continue. Map only
completed Sites into the business forest; keep scan scope independent from EVP/Department/Group/
Project placement and verify at least two EVP roots before claiming cross-branch isolation.

## Web cutover gate

Treat customer-owned Azure App Service as the production host. Deploy a new isolated Web App and
Key Vault in the target subscription; never overwrite another tenant's hosted environment or copy
its client/session secrets. Retain the previous App Service package and previous Key Vault secret
versions through the approved rollback window.

Only after workload checks pass, install the exact target HTTPS callback, provision production-only
Web client/session secrets and Function bridge keys, publish the exact tested package, and retest
login, branch visibility, admin read/preview and logout. Do not reuse local-UAT credentials.

After Foundation succeeds, verify Shared Key remains disabled, the expected Tables exist, and no
unexpected RBAC assignment was created. Continue in this order:

1. provision target-tenant Entra application objects without credentials in source control;
2. deploy scanner, Report API, and Configuration Admin workloads with separate managed identities;
3. complete exact-scope Azure RBAC and explicit Microsoft Graph admin-consent checkpoints;
4. rediscover target Sites, labels, and Entra groups;
5. import/rebind business configuration and run a controlled baseline with schedules disabled;
6. deploy customer-owned web hosting, configure exact callback origins, and test app roles;
7. complete branch-visibility UAT, document rollback, then approve cutover.
