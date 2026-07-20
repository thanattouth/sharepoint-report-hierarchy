---
name: sharepoint-sensitivity-report
description: Build, review, test, and evolve the standalone SharePoint Sensitivity Label Report in this repository. Use for hierarchy scope, cached sensitivity-label reporting, scanner/store contracts, Genesis UI changes, scoped export, authorization tests, Microsoft Graph scanning, Azure scheduling, report API hosting, or persistent business-scope administration.
---

# SharePoint Sensitivity Report

Continue this product without weakening its hierarchy authorization, cache-only report path, or separate scanner identity. Treat the repository requirements and design system as binding inputs.

## Establish context

Read these files completely before changing the product:

1. `../../REQUIREMENTS.md` — product and security source of truth.
2. `../../DESIGN.md` — Genesis visual source of truth.
3. `../../docs/adr/0001-separate-web-and-scanner-identities.md` — identity boundary.
4. `../../docs/adr/0002-separate-business-hierarchy-from-sharepoint-sites.md` — scope/site boundary.
5. `../../docs/adr/0009-persist-business-scope-configuration.md` — canonical placement and admin-write boundary.

Then inspect only the implementation files relevant to the request. Do not infer current completion from this skill; verify it from code, tests, and git state.

## Classify the work

Place the request in one category before editing:

- **Report/domain:** hierarchy validation, UPN assignments, aggregation, filters, pagination, export, or empty states.
- **UI:** report layout or components that must follow Genesis while preserving server-derived data.
- **Scanner/contracts:** queueing, scan outcomes, retry policy, bounded concurrency, inventory, scan-run, or delta-state interfaces.
- **P4 Graph pilot:** one approved non-production site using a separate scanner identity.
- **P5 scheduled pilot:** Azure timer/queue operation after the P4 exit gate.
- **P6 report API:** read-only Azure cache boundary and secure Sites integration.
- **P7 configuration:** persistent hierarchy, User/Group assignments, canonical Site placements, audit, migration, or admin UX.

Keep work inside the current category unless the user explicitly expands scope.

## Preserve security invariants

Enforce all of these on every change:

- Separate capability from data scope. A role never grants all-site visibility by itself.
- Resolve allowed site IDs from signed-in UPN, active assignments, active business nodes, `includeDescendants`, and active hierarchy-to-site mappings.
- Match production principals by immutable Entra object ID. Allow UPN matching only as an explicit pilot fallback, and resolve group assignments from authenticated group object IDs.
- Filter aggregates, file rows, detail views, and exports on the server before returning data.
- Fail closed when hierarchy, assignment, or scope resolution is unavailable or ambiguous.
- Return no inventory for users without an active assignment.
- Keep report requests cache-only. Never enumerate SharePoint or call `extractSensitivityLabels` during page load.
- Treat reportable labels as tenant configuration keyed by immutable label ID. Support
  multiple labels such as Confidential and Secret; never hard-code one display name as
  the product boundary.
- Keep scanner secrets, app-only tokens, tenant configuration, and credentials outside browser code and `NEXT_PUBLIC_*` values.
- Keep report web identity separate from scheduled-scanner identity.
- Use `tenantId + siteId + driveId + itemId` as the stable file key and deduplicate before counting.
- Determine report inclusion from configured label IDs, not display names.
- Exclude deleted/inactive records from current counts.
- Reconcile counts with distinct filtered detail rows.
- Generate export rows from the server-resolved scope and current filters; never export all rows for client filtering.

## Follow implementation boundaries

- Keep domain logic pure and testable under `src/domain` and `src/report`.
- Keep company hierarchy nodes, flat SharePoint Site records, and hierarchy-to-site mappings as separate contracts. Never embed a Site as a hierarchy child or node field.
- Store one canonical placement entity per Site with Site ID as its row key. Use an expected version plus Azure ETag for writes, and append an audit event for every effective change.
- Model the organization as a forest of independent EVP roots. Enforce the parent chain
  `EVP -> Department -> Group -> Project`; keep EVP nodes parentless and never traverse from one
  EVP tree into another.
- Access fixtures only behind store/data-access contracts. UI components must not import fixture data directly.
- Extend `InventoryStore`, `HierarchyStore`, `ScanRunStore`, `DeltaStateStore`, and `SensitivityScanner` rather than coupling UI to storage or Graph.
- Upsert scanner results idempotently by stable file identity.
- Treat `locked`, `unsupported`, `throttled`, and `failed` as item outcomes; do not fail an entire run automatically.
- Queue Run now and return immediately. Never hold a browser request until scanning completes.
- Read active `scanEnabled` Sites for scheduled work independently of report users. Scan each Site once per run and apply business mappings only when authorizing cached report reads.
- Preserve unrelated user changes in the worktree.

## Build for production maintainability

- Keep Microsoft Graph authentication, transport, orchestration, and persistence behind separate typed ports. Inject fetch, time, sleep, logging, and stores where deterministic testing matters.
- Validate scanner configuration at worker startup and fail closed. Never add tenant-specific production defaults or accept more than the approved P4 Site allowlist.
- Prefer managed identity or workload identity for hosted workloads. Keep client-secret mode limited to an approved local pilot and obtain tokens through Azure Identity.
- Pin Azure Identity token acquisition to the configured scanner tenant. Never inherit an
  unrelated developer CLI tenant implicitly during a connection probe or scan.
- Treat delta processing as at-least-once: apply idempotent inventory changes before saving the cursor, and never advance it after a persistence failure.
- Log operational identifiers, status, attempt, duration, and Graph request ID without tokens, secrets, file names, paths, or query-string delta tokens.
- Add contract tests for retries, throttling, locked files, partial runs, storage failure, cursor safety, configuration rejection, and cross-Site denial.
- For a live bounded diagnostic pilot, require an exact Site allowlist, exact library
  names, a hard limit of at most 20 files per library, a delta-page ceiling, and bounded
  concurrency. Never download content or persist cursors/inventory from this diagnostic.
  Treat its file-level output as sensitive operator-only metadata.
- Persist a bounded pilot only after explicit customer approval for that Site, libraries, and
  cache. Use an isolated customer-owned store, keep the same hard Graph bounds, write inventory
  before the terminal run record, and never save a delta cursor from a truncated traversal.
- For a cross-tenant cache, obtain explicit approval that identifies the source tenant,
  destination tenant, metadata fields, and permitted test data before transferring anything.
- When Graph and Azure Storage belong to different Entra tenants, configure two tenant-pinned
  credentials. Never reuse the Graph credential for Table or make either identity multi-tenant
  merely to simplify the pilot. Limit Azure CLI user auth to the approved local run and use
  managed identity for hosted persistence.
- For Azure Table, partition inventory by `tenantId + siteId`, key rows by
  `driveId + itemId`, strip service metadata in adapters, and materialize Site/label summaries
  for report queries. Do not render a large dashboard by enumerating every Site partition.
- Resolve allowed Site IDs before creating or querying the report cache adapter. For broad
  scopes, read `SiteLabelSummary`; query an inventory partition only after a Site has been
  explicitly selected and authorized. Reject a requested Site outside the resolved scope before
  any Table read.
- Give the hosted report a dedicated `Storage Table Data Reader` workload identity. Never reuse
  the scanner identity or a write-capable operator credential. If the website runtime cannot
  obtain an approved Entra token, keep Azure mode fail-closed and put a narrow server-side report
  API in a compatible managed-identity runtime; never fall back to Shared Key or browser tokens.
- Give configuration writes a separate server-side admin boundary. Never add Table write access to
  the report reader or reuse the scanner identity. Keep browser write actions disabled until the
  server can derive and authorize an administrator identity.
- For Azure Functions, separate the host-storage identity from the cache-reader identity. The
  reader must not receive host-storage write roles. Keep Shared Key disabled for both stores.
- Publish Flex Consumption packages with Azure Functions One Deploy through
  `az functionapp deployment source config-zip`. Do not use `az functionapp deploy --type zip`;
  that path can target unsupported Zip Deploy behavior and return HTTP 415 on Flex Consumption.
- Treat a Function key and selectable fixture UPN as a bounded test-data pilot only. Store the
  key as a Sites server secret and send it in a header, never a URL. Before production, require
  Microsoft Entra caller authorization and derive UPN from authenticated claims.
- When a Sites/Cloudflare Worker calls the report API, use `redirect: "manual"` and reject every
  3xx response before reading the body. Workerd does not implement `redirect: "error"`; never
  switch to automatic redirect following because it could forward the Function key to another
  origin.
- Guard code publishing with exact-scope RBAC checks. When the deployer is only Contributor,
  provision with conditional role assignments disabled and stop before publishing until an
  authorized administrator grants the required roles.
- Respect Azure separation of duties. If the infrastructure deployer cannot write role
  assignments, deploy storage without the conditional assignment and stop before data access
  until an authorized owner grants the scoped Table data role. Never enable Shared Key to bypass
  missing RBAC authority.
- Load populated local env files with the runtime's non-executing env-file parser. Do not shell-
  source files containing secrets or JSON configuration because shell evaluation can corrupt
  values or execute special characters.
- Record production-critical permission, storage, schema, retention, and deployment decisions in ADRs/runbooks. Require a migration and rollback plan for persistent schema changes.
- Review dependency vulnerabilities before a release; do not apply breaking automated fixes without validating the Sites build and runtime.

## Apply Genesis design

Use the business-first editorial system in `../../DESIGN.md`:

- Use General Sans for display headings, DM Sans for body/UI, JetBrains Mono for identifiers, and a Thai-capable fallback.
- Use warm gray `#FAFAFA`, white surfaces, near-black text, and subtle `#E8E8EC` borders.
- Reserve indigo `#6366F1` for interactive elements, links, focus, and active states only.
- Use semantic green, amber, and red only for status meaning.
- Use flat cards with 1px borders and 12px radius. Add shadows only on hover, focus, popovers, and dropdowns.
- Use 6px radii for buttons and inputs, 8px for metadata panels, and pills only for chips/statuses/avatars.
- Follow the 4px spacing grid and keep a 1280px content container.
- Use at most one filled primary action in a section.
- Avoid decorative gradients, illustrations, playful card-game motifs, offset shadows, excess rounding, and static indigo decoration.
- Preserve keyboard navigation, accessible labels, focus rings, table semantics, and responsive layouts.

### Scale scope and Site navigation

- Treat EVP, Department, Group, and Project as customer business scopes, not SharePoint hierarchy levels.
- Never render flat SharePoint Sites as an expanded hierarchy tree; EVP scopes may contain thousands of Sites.
- Keep the company hierarchy as an authorization and aggregation model even when the main dashboard does not visualize the tree.
- Prefer a compact resolved-scope proof on the main report: show the assigned business node or nodes, descendant inclusion, visible-node count, visible-Site count, and Sensitive count.
- Make the searchable, paginated flat Site Explorer the primary navigation for report users.
- Expose a full hierarchy navigator only for a concrete admin, configuration, or hierarchy-analysis task. Do not add one merely to prove authorization.
- Derive scope summaries, Site rows, filters, and counts only from server-authorized rollups. Ignore or reject requested node IDs outside `visibleNodeIds` and never use UI state to broaden data scope.
- Clear incompatible Site and page filters when changing an authorized branch filter, while preserving relevant file filters.
- Prove root, branch, leaf, Site mapping, multi-assignment, cross-branch denial, and large-scope behavior in domain and rendered tests without loading all nodes or Sites into the browser view.

For website work, also follow the available Sites building and hosting skills because `.openai/hosting.json` is present.

## Validate changes

Run the proportional checks, and run all of them before a release or milestone handoff:

```bash
npm run lint
npm run typecheck
npm test
```

Required coverage includes:

- EVP, Department, Group, and Project branch visibility.
- Multiple-assignment union without duplicates.
- No-assignment and inactive-assignment denial.
- Missing-parent and cycle rejection.
- Cross-branch request denial.
- Aggregate/detail reconciliation.
- Zero-Sensitive, no-scan, partial, stale, and cache-error states.
- Queued scanner behavior without page-load scanning.

Do not declare completion when build or relevant tests fail.

## Advance milestones safely

### Review checkpoint before P4

Obtain explicit decisions for:

- Customer hierarchy names and site placement.
- Production reportable label IDs, including Confidential and Secret where approved.
- File columns and direct-link behavior.
- Export and Run now capabilities.
- Scan cadence and timezone.
- Non-production test-site allowlist.
- Scanner Graph permissions, app-only model, admin consent, and least-privilege justification.
- Expected site, library, and file volume plus pilot storage choice.

Do not request real Graph permissions or broaden site access before this checkpoint.

### P4 one-site Graph pilot

1. Add a real scanner adapter behind existing contracts.
2. Use one approved non-production allowlisted site and controlled test files.
3. Verify the exact permission against current Microsoft documentation. `extractSensitivityLabels` documents application `Files.Read.All`; do not assume `Sites.Selected` is accepted when the endpoint does not list it.
4. Call `POST /drives/{drive-id}/items/{item-id}/extractSensitivityLabels` only from the scanner environment.
5. Persist real outcomes, scan timestamps, correlation IDs, and delta state.
6. Implement bounded concurrency and bounded retry for `429`, selected `503/5xx`, and transient network failures; respect `Retry-After`.
7. Compare cached counts and rows with manually verified test files.
8. Measure duration, throughput, throttling, write rate, query patterns, and storage volume.

Do not expand to production-wide scanning during P4.

### Validate labels with controlled fixtures

- Create synthetic Office fixtures with no production or personal data. State the intended
  library, intended label, and expected scanner result inside each fixture.
- Upload fixtures through an approved delegated user context and address the exact document
  library drive. Never grant write permission to the read-only scanner merely to prepare test
  data, and never infer a file label from a library name such as `Secret`.
- Apply the real Microsoft Purview label through an approved user-context workflow. Record the
  immutable sublabel ID expected from Graph rather than relying on a parent label or display
  name alone.
- Parse the current top-level `labels` response from `extractSensitivityLabels`; retain support
  for the earlier nested `value.labels` shape only as a compatibility path. Cover both with tests.
- Treat `415 notSupported` as unresolved extraction, never as `no-label`. Preserve its sanitized
  message and Graph request ID; an unsupported user attached to an assigned protected label is
  one possible cause. Do not infer a specific label from the containing library.
- Keep fixture upload, label assignment, and scanner verification auditable as separate actions.
  Do not download content or widen the approved Site/library/file bounds during verification.

### P5 scheduled Azure pilot

Proceed only after the P4 exit gate and storage decision:

- Add timer and queue workers, nightly incremental scan, and controlled reconciliation.
- Keep Run now queue-based.
- Add telemetry, alerts, recovery, secrets hardening, and operational runbooks.
- Complete security review, retention/export/audit policy, and customer UAT before production completion.

For this repository's hosted cross-tenant pilot:

- Make timers enqueue only; a queue worker owns one Site scan and summary materialization.
- Use deterministic scheduled run IDs keyed by trigger, UTC slot, and Site so replayed timer
  invocations do not duplicate work. Keep manual run IDs unique.
- Store active scan targets in the flat `ScannerSites` Table independently of hierarchy users.
- Require an exact, case-sensitive library allowlist for the pilot. Fail closed if a configured
  library is missing, and classify locked/unsupported/throttled/failed item outcomes as a partial run.
- Deploy timers disabled. Prove the exact allowlisted Site through the queue-based pilot Run now
  endpoint before enabling either schedule.
- In a cross-tenant hosted deployment, keep host and scanner workload managed identities separate.
  The multi-tenant app registration and managed identity must share the Azure tenant; provision
  and admin-consent its enterprise application in the SharePoint tenant. Use managed-identity
  federation and never copy the local P4 client secret into the Function App.
- Configure Queue message encoding explicitly and retain poison messages after bounded retries.
  Operational logs may include run/Site/request IDs and counts, but never file names, paths,
  credentials, or delta tokens.
- Include Azure Functions Extension Bundle v4 in `host.json` for non-HTTP bindings. After
  publishing, verify host startup telemetry registers the Queue trigger; seeing function
  metadata in the control plane does not prove the binding extension loaded successfully.
- Treat tenant-wide Site discovery as a separate gate from tenant-wide file extraction.
  `getAllSites` requires reviewed `Sites.Read.All`; first return aggregate Site/page counts only,
  with a hard page ceiling and no cache writes. Do not automatically add discovered Sites to
  `ScannerSites`, business mappings, or the active schedule.
- Treat tenant-wide file counting as another separately approved gate. Enumerate only `id`, `file`,
  `folder`, and `deleted` through an initial bounded `drive/root/delta` traversal; never call
  sensitivity extraction merely to measure volume. Return aggregate file/page/failure counts only,
  discard the partial count for any failed library, do not persist a delta cursor or file identity,
  and verify afterward that Site targets, scan runs, cache rows, and schedules did not change.
- Keep multi-Site extraction behind two simultaneous gates: explicit `registry` scope mode and an
  active scan-enabled Site record with an exact non-empty drive-ID allowlist. Keep `single-site` as
  the deployment default. Limit baseline waves to ten Sites, stop on missing/failed/throttled work,
  require review for locked/unsupported partial work, and document a no-delete rollback before
  activating a tenant manifest.
- Build a tenant candidate manifest only after explicit cross-tenant field/destination approval.
  Preserve an existing active pilot instead of overwriting it; save all other candidates disabled,
  use drive IDs rather than library names as the persisted authorization boundary, return only
  aggregate counts, and prove live idempotency. Fail closed on incomplete Site metadata, existing
  active/conflicting candidate rows, missing drive allowlists, or candidate/page ceilings.
- Expose exact candidate identities only through a separately approved, function-key protected
  operator review. Hard-code the reviewed wave, require every target to remain disabled, resolve and
  return only libraries matching persisted drive IDs, and log aggregate counts only. Never copy the
  exact tenant review list into repository docs or treat review permission as activation permission.
- Apply reviewed candidate exclusions with an exact-ID, preflight-first, idempotent operator change.
  Retain the record and drive allowlist, clear its wave, keep it inactive/scan-disabled, and store an
  exclusion state/reason/timestamp for audit. Never delete it, silently replace it from a later wave,
  or let manifest regeneration overwrite the operator decision.
- Execute an approved baseline serially through a dedicated fail-closed coordinator. Disable both
  timers, open a separate short-lived baseline window, require `registry` mode, require the exact
  approved Site count and drive-ID allowlists, and use deterministic run IDs per wave and Site.
  Enqueue only the first missing Site; return the existing queued/running run on retries; enqueue the
  next Site only after a clean `succeeded` result. Stop on failed, cancelled, failed-item, or
  throttled outcomes, and pause for operator review on partial, locked, or unsupported outcomes.
  Close the baseline window after completion or any stop/review condition. Do not automatically
  retry a terminal baseline run or re-enable timers without a separately reviewed decision.
- When an operator explicitly chooses to skip a terminal problem/review Site, retain its run and
  inventory, record a skip state/reason/timestamp, and disable that Site for later schedules. A
  data-driven coordinator may continue past that audited state, but must never infer a skip from an
  error automatically. Read the wave and approved states from the registry instead of hard-coding
  tenant Site IDs or wave size in source code.
- Publish business placement through a separate persistent hierarchy-to-Site mapping table. Load
  active registry Sites for validation, but authorize every role—including EVP—only through active
  mappings inside the assigned node or its visible descendants. Never treat EVP as tenant-wide,
  expose another EVP tree, or expose an unmapped Site merely because it is active or cached. Fail
  closed on missing/inactive mapped Sites or multiple canonical placements, and resolve hierarchy
  scope before inventory reads. Adding a Site requires both a scan-registry operation and an
  approved canonical business mapping; neither requires a source-code change. Keep zero-Sensitive
  and never-scanned mapped Sites visible so operators can distinguish coverage from missing scan data.
- Migrate legacy mappings into a new canonical table instead of changing row-key semantics in place.
  Keep the legacy table for rollback, reject duplicate active Site placements before writing, read
  the new configuration back, validate it, and only then switch the Report API settings.
- Build configuration UX as an unmapped-first Site inbox with search, filters, pagination, bulk
  selection, full node breadcrumbs, impact preview, optimistic concurrency feedback, and audit
  metadata. Never render thousands of Sites as an expanded business tree.

## Handoff

Report:

- Milestone/category completed.
- User-visible behavior changed.
- Security invariants and tests verified.
- Decisions or approvals still blocking the next milestone.
- Deployed private URL when publishing succeeds.
