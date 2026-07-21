# Customer single-tenant delivery

Deploy one isolated instance per customer tenant. Do not transfer the pilot subscription or copy
tenant-bound identities. Re-provision Azure resources and Entra applications in the target tenant,
then rediscover SharePoint Sites, sensitivity labels, and Entra groups before importing business
configuration.

## Delivery contract

- Keep customer-specific values in an ignored `delivery-instances/<customer>/manifest.json` copied
  from `config/customer-delivery.example.json`.
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

After Graph consent and Azure RBAC gates pass, deploy the three workload boundaries with schedules
disabled:

```bash
npm run delivery:workloads:what-if -- --manifest delivery-instances/<customer>/manifest.json
npm run delivery:workloads:deploy -- --manifest delivery-instances/<customer>/manifest.json
```

This creates separate Scanner, Report API, and Configuration Admin Function Apps, host storage,
managed identities, telemetry, and exact-scope role assignments. It does not publish code or start
a scan. The workload manifest must keep `schedulesDisabled=true` during initial delivery.

After packaging and publishing the three Functions, create the customer-managed access groups and
bootstrap the portable hierarchy. Always inspect the access plan first:

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

For local Vinext/Cloudflare UAT without a `.dev.vars` file, pass
`CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so the Worker receives the process-scoped bindings. Keep
client secrets, session keys, and Function keys outside the manifest and repository. Do not update
the production Sites environment until local Entra, report, admin, and logout UAT passes.

## Customer-owned Azure App Service

Add `webHosting` to the ignored customer manifest with globally unique Web App and Key Vault names,
the exact deployed Function App names, an explicit SKU, and the group-picker feature gate. Include
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
explicit user/group assignment on the target enterprise application. It does not create a client
secret during What-if or infrastructure deployment.

The secrets stage creates one expiring Entra confidential-client credential, a random 256-bit
session key, and separate `web-bridge` Function host keys. Values move directly into Key Vault and
are never written to the manifest, repository, deployment output, or App Service settings. A normal
rerun is a no-op when all four managed secrets exist; deliberate rotation requires invoking
`scripts/delivery-web-secrets.ts --rotate` in an approved change window, verifying the new login,
then removing superseded Entra credentials after rollback expiry.

The check stage fails closed unless all Key Vault references resolve, HTTPS-only is active, the
enterprise application requires assignment, callback URIs exactly match the manifest, the public
health surface responds, and an anonymous report request reaches the target tenant's OIDC endpoint.
Complete one interactive ReportAdmin and one ReportViewer/no-role UAT before production cutover.

## Web cutover gate

Treat hosted environment replacement as a separate cutover. Sites returns existing secret values
as non-exportable placeholders, so overwriting a source project's client secret, session secret, or
Function keys without a recoverable rollback configuration can strand the previous version even
when its source artifact is still available. Before changing the existing project, choose one:

- deploy a separate customer-owned web project/host and UAT its HTTPS callback;
- retain customer-approved recoverable copies of the previous runtime secrets in an approved secret
  manager; or
- explicitly accept that rollback means rotating/reconstructing the source credentials.

Only after that decision, add the exact target HTTPS callback, generate production-only Web client
and session secrets, set the target API endpoints/keys, save a version from the exact pushed commit,
deploy the owner-only version, and retest login, branch visibility, admin read/preview, and logout.
Do not reuse or retain local-UAT client credentials.

After Foundation succeeds, verify Shared Key remains disabled, the expected Tables exist, and no
unexpected RBAC assignment was created. Continue in this order:

1. provision target-tenant Entra application objects without credentials in source control;
2. deploy scanner, Report API, and Configuration Admin workloads with separate managed identities;
3. complete exact-scope Azure RBAC and explicit Microsoft Graph admin-consent checkpoints;
4. rediscover target Sites, labels, and Entra groups;
5. import/rebind business configuration and run a controlled baseline with schedules disabled;
6. deploy customer-owned web hosting, configure exact callback origins, and test app roles;
7. complete branch-visibility UAT, document rollback, then approve cutover.
