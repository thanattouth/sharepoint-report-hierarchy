# ADR 0006: Host report cache access behind a dedicated read identity

- Status: Accepted
- Date: 2026-07-15

## Context

The report must read Azure Table without exposing credentials to the browser and without gaining
the scheduled scanner's Microsoft Graph or Table write permissions. The current Sites deployment
runs on a Cloudflare-compatible worker. It can build the Azure adapter, but it cannot use the
developer's Azure CLI session and is not an Azure managed-identity host. Publishing that local
credential model would either fail at runtime or invite an unsafe account-key workaround.

## Decision

Use a narrow Azure Functions Flex Consumption API as the report cache boundary. Attach two
user-assigned identities: a host identity for the dedicated Functions runtime storage and
telemetry, and a report-reader identity granted only `Storage Table Data Reader` on the isolated
cache. Keep the public report deployment fixture-backed until this API passes live authorization
verification.

The server-side boundary must:

- authenticate the interactive report user through the eventual login flow;
- resolve business hierarchy assignments and allowed Site IDs before Table access;
- expose only authorized summary and selected-Site detail projections;
- reject an out-of-scope Site before querying its inventory partition;
- keep Azure tokens and configuration out of browser bundles and `NEXT_PUBLIC_*`; and
- fail closed when identity, hierarchy, mapping, cache, or configuration is unavailable.

The scanner remains a separate workload with its approved Graph permission and Table write role.
Neither identity may impersonate or substitute for the other.

For the bounded no-login pilot, protect the API with a Function key stored only as a Sites
server-side secret, fix API capability to `ReportViewer`, and allow only configured test personas.
This proves the hosting path but is not production user authentication. Production must replace
the Function key and persona query with Microsoft Entra caller authorization and an authenticated
UPN.

## Consequences

- The local Node pilot can prove cache decoding, projection, reconciliation, and authorization,
  but it is not the production hosting model.
- Sites can remain the presentation host if it calls the narrow report API; alternatively the
  complete report can be hosted on an Azure runtime that supports the same workload identity.
- Production deployment requires Microsoft Entra caller authentication, removal of the persona
  switch, RBAC review, observability, retention, and network/security review.
- Shared Key, scanner credentials, developer CLI sessions, and browser-held Storage tokens are
  explicitly rejected as hosting shortcuts.

## Alternatives considered

- **Use the scanner identity in the report:** rejected because compromise of an interactive path
  would expose Graph scanning and Table write capabilities.
- **Embed a Storage account key:** rejected because shared-key access is disabled and bypasses
  Entra least privilege and identity auditability.
- **Pass an Azure token to browser code:** rejected because the browser must never become the
  cache authorization boundary.
- **Publish Azure mode directly to the current Sites worker:** rejected until that runtime has an
  approved workload-identity integration that preserves this decision.
- **Give one identity both host-storage and report-cache roles:** rejected because runtime write
  needs must not broaden the cache reader's data-plane capability.
