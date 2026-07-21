# P8 Azure App Service runbook

This is the active customer-owned web-hosting runbook. It deploys the existing server-rendered
report and Entra OIDC flow to a dedicated Linux Azure App Service in the customer's subscription.
It does not reuse the source Sites project or any cross-tenant pilot identity.

## Runtime boundary

```text
Browser
  -> HTTPS Azure App Service (standalone Next.js, system-managed identity)
       -> customer Entra enterprise application (OIDC + app roles + group claims)
       -> Report API Function (dedicated Key Vault-backed web-bridge key)
       -> Configuration Admin Function (dedicated Key Vault-backed web-bridge key)
       -> Key Vault (client/session/API secrets; Web App has Secrets User only)
```

App Service platform authentication is intentionally disabled. The application owns one validated
OIDC session, enforces `ReportAdmin`/`ReportViewer` server-side, encrypts cookies with AES-256-GCM,
and sends verified identity claims to the APIs. Enabling Easy Auth as well would create two sessions
and change logout, callback, role, and incident-response behavior; that requires a separate ADR.

## Deployment gates

1. Confirm Azure CLI tenant/subscription exactly match the ignored delivery manifest.
2. Confirm the Web app registration is single-tenant, group claims are `ApplicationGroup`, delegated
   `GroupMember.Read.All` consent exists before enabling the group picker, and app-role assignments
   target customer-managed groups.
3. Run Bicep What-if. Review the dedicated B1/S1/P0v3 plan, Web App, Key Vault, telemetry resources,
   and two exact Key Vault RBAC assignments.
4. Deploy infrastructure. Expect the Web App to remain unhealthy until secrets and code are present.
5. Provision secrets once, package the standalone Next.js output, publish, and run the automated check.
6. Perform interactive ReportAdmin, branch-scoped ReportViewer, no-role, admin preview/apply, and
   logout tests. Keep scanner schedules disabled until web UAT and baseline approval are complete.

## Secret ownership and rotation

- The Web App identity has `Key Vault Secrets User`; it cannot create, rotate, or delete secrets.
- The delivery operator has `Key Vault Secrets Officer` at this vault only.
- App settings contain versionless Key Vault references, never values.
- After initial provisioning or rotation, force an App Service Key Vault reference refresh and
  require every managed reference to report `Resolved` before application UAT.
- The Entra client credential expires after one year. Rotate before expiry, validate sign-in, retain
  the previous credential only for the approved rollback window, then delete it.
- Session-key rotation intentionally invalidates all existing application sessions.
- Function bridge-key rotation must update Key Vault first-class secret versions and pass both API
  smoke tests before the previous Function keys are removed.

## Rollback

Keep the previous App Service package and previous secret versions through the customer-approved
rollback window. Application rollback is a package redeploy. Secret rollback is a Key Vault version
activation followed by Web App restart. Entra callback or role-assignment rollback must be performed
from the manifest/access plan, never by copying object IDs from another tenant. Do not delete the
Resource Group, purge the Key Vault, enable scanner schedules, or tear down the source pilot as part
of an application rollback.
