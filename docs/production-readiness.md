# Production readiness baseline

This repository is an evolving production product, not a disposable prototype.

## Required engineering controls

- Preserve report/scanner identity and deployment separation.
- Keep domain, Graph transport/authentication, orchestration, and stores behind typed
  contracts with deterministic tests.
- Validate configuration at startup and fail closed on missing or out-of-scope values.
- Use idempotent writes, cursor-after-data ordering, bounded concurrency, bounded retry,
  and partial/failure outcomes.
- Keep secrets and sensitive file metadata out of browser code and operational logs.
- Require migrations, rollback steps, observability, retention, and ownership before a
  persistent store is promoted to production.
- Provision scanner persistence as isolated customer-owned infrastructure from IaC. Use Entra
  token authorization, keep shared keys disabled, and materialize report query patterns instead
  of relying on broad Azure Table scans.
- Give the hosted report a dedicated read-only workload identity and keep Azure tokens behind a
  server-side boundary. Resolve authorized Site IDs before querying summaries or inventory.
- Treat a runtime that cannot obtain the approved Entra workload token as unavailable and fail
  closed; never substitute the scanner credential, an account key, or a browser token.
- Separate the Function host identity from the report-cache reader identity. Scope the reader to
  `Storage Table Data Reader` on the cache account and keep host-storage write roles off it.
- Site Mapping administration uses single-tenant Entra OIDC and derives `ReportAdmin` plus the
  audit UPN from verified claims. In `azure-api` mode the main report uses the same immutable Entra
  session and removes all selectable persona/capability controls. Customer hosting must require
  explicit Enterprise App user/group assignment and keep OIDC/session/API secrets in Key Vault.
- Run lint, type check, unit/rendered tests, build, and dependency audit before release.

## Dependency security baseline — reverified 2026-07-21

Build tooling was updated to remove all high and critical findings reported by `npm audit`.
The production dependency audit reports two moderate findings in Next.js's nested PostCSS
dependency; the complete dependency-tree audit reports four moderate findings through the
same chain. npm currently proposes
an incompatible Next.js downgrade as the only automatic fix, so it was not applied. Track a
compatible upstream Next.js release, reassess the advisory's runtime reachability, and rerun
both the full Sites build and standalone Azure App Service build before upgrading. Never use
`npm audit fix --force` without reviewing the dependency graph and validating runtime compatibility.
