# P8 Entra web authentication and ReportAdmin authorization

P8 protects the Configuration Admin browser surface with a dedicated single-tenant Entra web app.

## Historical Sites pilot identity

> The identity and callback below describe the source Sites pilot and are retained for rollback
> evidence only. Customer delivery must use the target tenant's manifest and the Azure App Service
> runbook; do not copy these IDs or callback origins.

- App registration: `sharepoint-sensitivity-report-web`
- Application (client) ID: `28a07326-f117-4d36-880b-6abb133cd222`
- Tenant ID: `778a528f-5fd8-4807-be62-7be9025cd230`
- App roles: `ReportAdmin`, `ReportViewer`
- Production callback:
  `https://sharepoint-sensitivity-report-hierarchy.uzumaki1747.chatgpt.site/api/auth/entra/callback`
- Local callback: `http://localhost:3000/api/auth/entra/callback`

The pilot account is assigned `ReportAdmin`. Add or remove future administrators on the enterprise
application's **Users and groups** blade. Do not encode administrator UPNs in source or Sites
configuration. Keep the Configuration Admin API actor allowlist synchronized until that API is
upgraded from its bounded pilot allowlist to token-based caller authorization.

## Sites runtime contract

Copy `.env.web-auth.example` only for local development. Hosted values belong in Sites runtime
environment variables:

- `ENTRA_AUTH_TENANT_ID`
- `ENTRA_AUTH_CLIENT_ID`
- `ENTRA_AUTH_CLIENT_SECRET` — secret
- `ENTRA_AUTH_SESSION_SECRET` — secret, 32 random bytes encoded as base64url
- `ENTRA_AUTH_ALLOWED_ORIGINS` — exact comma-separated origins
- `ENTRA_AUTH_SESSION_HOURS` — 1–24, default 8
- `ENTRA_AUTH_GROUP_PICKER_ENABLED` — default `false`; enable only after delegated
  `GroupMember.Read.All` admin consent

`CONFIG_ADMIN_API_FUNCTION_KEY` remains a separate Sites secret. There is no
`CONFIG_ADMIN_BRIDGE_ACTOR`; the server derives the actor from verified Entra claims.

## Authorization flow

```text
Browser -> /api/auth/entra/login
        -> tenant-specific Entra authorize endpoint (code + PKCE + state + nonce)
        -> /api/auth/entra/callback
        -> validate issuer/signature/audience/tenant/nonce
        -> encrypted HttpOnly application session
        -> require ReportAdmin for Admin page and all mapping APIs
        -> server bridge adds Function key + verified UPN actor
        -> Configuration Admin API allowlist + scoped writer identity
        -> Azure Table placement + audit event
```

The inbox and preview are also protected, not only Apply. A user without a valid session receives
401 from APIs and is redirected to Entra from the admin page. A signed-in user without
`ReportAdmin` receives 403 or the denied page. All mutation routes verify the request origin.

## Verification and operations

1. Confirm the app is single-tenant and both callback URIs match exactly.
2. Confirm the enterprise application assignment includes the expected `ReportAdmin` user/group.
3. Open `/admin/site-mappings` in a new browser session and complete Entra sign-in.
4. Verify the Inbox loads and the page shows `ReportAdmin · Entra verified`.
5. Preview one test Site placement, then Apply only when the selected target is intended.
6. Confirm the placement version increments and `updatedBy`/audit actor equals the signed-in UPN.
7. In a second session without the role, verify the admin page and all three mapping APIs fail
closed.

Logout is an application-session operation exposed only as POST. It clears the encrypted Entra
session cookie, the pending authorization-flow cookie, and the separate protected Graph-token
cookie, then redirects to the public `/auth/signed-out` confirmation page. Do not redirect directly
to the protected report root because that immediately starts a new Entra flow and makes logout look
unsuccessful. This operation does not sign the user out of Microsoft 365 globally.

Do not use an Azure CLI token, a selectable persona, a browser-supplied UPN, or the Sites owner
identity as a substitute for the Entra application session.

For customer-owned hosting, the same server-side OIDC/session contract runs in Azure App Service.
Runtime secrets are Key Vault references, the enterprise application requires explicit user/group
assignment, and App Service platform authentication remains disabled to avoid a second competing
OIDC session. See [P8 Azure App Service runbook](p8-azure-app-service.md).

## Report identity and group assignments

In Azure API mode the main report requires a verified `ReportViewer` or `ReportAdmin` session and
removes the persona/capability controls. The Sites bridge sends verified UPN, user object ID, group
object IDs, and app role to the Report API; URL identity parameters are ignored. Scope remains the
union of active assignments and descendants, never the user's SharePoint ownership or tenant-wide
visibility.

The Business Scope editor can search Entra security groups through a ReportAdmin-only server route.
The delegated Graph token stays in an encrypted HttpOnly cookie and Graph results expose only group
ID, display name, and optional mail. Configure the token claim as `ApplicationGroup`; group overage
fails closed. The picker feature flag stays off until the required delegated Graph permission has
tenant admin consent.

## Resetting test Site placements

Use the audited reset only when the customer has declared the current placements test data:

```bash
npm run p8:mappings:reset:local
npm run p8:mappings:reset:apply:local -- --confirm-active-count=<dry-run-count>
```

The command deactivates canonical placements; it does not delete them, erase scan/cache rows,
reactivate excluded candidate Sites, or enable additional scanning. Every changed placement keeps
its node, increments its version, records the verified operator UPN, and emits a `deactivated`
audit event. The Admin Inbox then shows active registry Sites as unmapped while preserving the
expected version needed for a later Entra-authorized remap.

The 2026-07-20 pilot reset deactivated 8/8 active placements. Verification through the deployed
Configuration Admin API returned 63 total registry rows: 0 mapped, 8 active/unmapped with persisted
version 2, and 55 intentionally inactive candidates. No inactive candidate was reactivated and no
new scanner target or sensitivity extraction job was created.
