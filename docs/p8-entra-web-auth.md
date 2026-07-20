# P8 Entra web authentication and ReportAdmin authorization

P8 protects the Configuration Admin browser surface with a dedicated single-tenant Entra web app.

## Provisioned pilot identity

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

Do not use an Azure CLI token, a selectable persona, a browser-supplied UPN, or the Sites owner
identity as a substitute for the Entra application session.

## Current boundary and next slice

P8 makes the Site Mapping Admin Inbox visibility and Apply path production-shaped. The main report
still uses the bounded pilot persona/report-API contract to prove business hierarchy. Replacing
that selector with the signed-in Entra object ID, UPN, and group IDs is the next authorization
slice; do not claim production report-user visibility until it is complete.

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
