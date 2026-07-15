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

Keep the public report deployment fixture-backed until a production report cache boundary is
available. Deploy the Azure Table adapter, or a narrow cache API, in an approved server-side
runtime that supports Microsoft Entra workload identity. Grant that identity only `Storage Table
Data Reader` on the isolated cache account.

The server-side boundary must:

- authenticate the interactive report user through the eventual login flow;
- resolve business hierarchy assignments and allowed Site IDs before Table access;
- expose only authorized summary and selected-Site detail projections;
- reject an out-of-scope Site before querying its inventory partition;
- keep Azure tokens and configuration out of browser bundles and `NEXT_PUBLIC_*`; and
- fail closed when identity, hierarchy, mapping, cache, or configuration is unavailable.

The scanner remains a separate workload with its approved Graph permission and Table write role.
Neither identity may impersonate or substitute for the other.

## Consequences

- The local Node pilot can prove cache decoding, projection, reconciliation, and authorization,
  but it is not the production hosting model.
- Sites can remain the presentation host if it calls the narrow report API; alternatively the
  complete report can be hosted on an Azure runtime that supports the same workload identity.
- Production deployment requires an additional identity, RBAC assignment, API/host choice,
  authentication design, observability, and network/security review.
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
