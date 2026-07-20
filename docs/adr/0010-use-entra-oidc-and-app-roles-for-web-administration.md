# ADR 0010: Use single-tenant Entra OIDC and app roles for web administration

Status: Accepted

The report web application authenticates configuration administrators with a dedicated,
single-tenant Microsoft Entra application registration. It uses Authorization Code Flow with
PKCE, state, and nonce against the tenant-specific v2.0 issuer. The web runtime validates the ID
token signature, issuer, audience, tenant, and nonce before creating an application session.

`ReportAdmin` and `ReportViewer` are Entra app roles. Only a verified session containing
`ReportAdmin` may render the Site Mapping Admin Inbox or call its inbox, preview, and apply routes.
An app role grants capability only; it never grants report data scope. Business visibility remains
the result of immutable Entra principal identity, active assignments, visible business descendants,
and active canonical Site placements.

The web application stores a short-lived encrypted and authenticated session in an HttpOnly,
SameSite=Lax cookie. Client and session secrets remain Sites server secrets. The session contains
only the verified tenant ID, user object ID, UPN, display name, app roles, and group IDs needed for
authorization. It has no refresh token and expires after eight hours by default.

Configuration API calls derive `x-configuration-actor` from the verified session UPN. The browser
cannot supply or override the actor, Function key, tenant, or app role. Apply still requires an
impact preview, expected mapping versions, explicit server confirmation, the Configuration API
actor allowlist, and its separately scoped writer identity. Version conflicts return HTTP 409 and
require a fresh preview.

The Sites access policy and Entra authorization are independent gates. The current private Sites
deployment may require its owner sign-in before the application starts Entra OIDC; Entra remains
the application-level source of truth for `ReportAdmin`.

## Rotation and rollback

Rotate the Entra client secret before expiry and update `ENTRA_AUTH_CLIENT_SECRET` as a Sites
secret before disabling the old credential. Rotate `ENTRA_AUTH_SESSION_SECRET` only with an
intentional global sign-out. Roll back the web version without removing the app registration or
role assignments; the previous locked Apply path remains safe. Never reintroduce a fixed bridge
actor as a rollback shortcut.
