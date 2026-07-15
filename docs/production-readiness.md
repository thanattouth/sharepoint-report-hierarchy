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
- Run lint, type check, unit/rendered tests, build, and dependency audit before release.

## Dependency security baseline — 2026-07-14

Build tooling was updated to remove all high and critical findings reported by `npm audit`.
The production dependency audit reports two moderate findings in Next.js's nested PostCSS
dependency; the complete dependency-tree audit reports four moderate findings through the
same chain. npm currently proposes
an incompatible Next.js downgrade as the only automatic fix, so it was not applied. Track a
compatible upstream Next.js release, reassess the advisory's runtime reachability, and rerun
the full Sites build before upgrading. Never use `npm audit fix --force` without reviewing
the dependency graph and validating runtime compatibility.
