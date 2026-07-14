---
name: sharepoint-sensitivity-report
description: Build, review, test, and evolve the standalone SharePoint Sensitivity Label Report in this repository. Use for hierarchy scope, cached Secret-file reporting, scanner/store contracts, Genesis UI changes, scoped export, authorization tests, Microsoft Graph pilot planning, Azure scheduled scanning, or milestone work from P0 through P5.
---

# SharePoint Sensitivity Report

Continue this product without weakening its hierarchy authorization, cache-only report path, or separate scanner identity. Treat the repository requirements and design system as binding inputs.

## Establish context

Read these files completely before changing the product:

1. `../../REQUIREMENTS.md` — product and security source of truth.
2. `../../DESIGN.md` — Genesis visual source of truth.
3. `../../docs/adr/0001-separate-web-and-scanner-identities.md` — identity boundary.
4. `../../docs/adr/0002-separate-business-hierarchy-from-sharepoint-sites.md` — scope/site boundary.

Then inspect only the implementation files relevant to the request. Do not infer current completion from this skill; verify it from code, tests, and git state.

## Classify the work

Place the request in one category before editing:

- **Report/domain:** hierarchy validation, UPN assignments, aggregation, filters, pagination, export, or empty states.
- **UI:** report layout or components that must follow Genesis while preserving server-derived data.
- **Scanner/contracts:** queueing, scan outcomes, retry policy, bounded concurrency, inventory, scan-run, or delta-state interfaces.
- **P4 Graph pilot:** one approved non-production site using a separate scanner identity.
- **P5 scheduled pilot:** Azure timer/queue operation after the P4 exit gate.

Keep work inside the current category unless the user explicitly expands scope.

## Preserve security invariants

Enforce all of these on every change:

- Separate capability from data scope. A role never grants all-site visibility by itself.
- Resolve allowed site IDs from signed-in UPN, active assignments, active business nodes, `includeDescendants`, and active hierarchy-to-site mappings.
- Filter aggregates, file rows, detail views, and exports on the server before returning data.
- Fail closed when hierarchy, assignment, or scope resolution is unavailable or ambiguous.
- Return no inventory for users without an active assignment.
- Keep report requests cache-only. Never enumerate SharePoint or call `extractSensitivityLabels` during page load.
- Keep scanner secrets, app-only tokens, tenant configuration, and credentials outside browser code and `NEXT_PUBLIC_*` values.
- Keep report web identity separate from scheduled-scanner identity.
- Use `tenantId + siteId + driveId + itemId` as the stable file key and deduplicate before counting.
- Determine Secret status from configured label IDs, not display names.
- Exclude deleted/inactive records from current counts.
- Reconcile counts with distinct filtered detail rows.
- Generate export rows from the server-resolved scope and current filters; never export all rows for client filtering.

## Follow implementation boundaries

- Keep domain logic pure and testable under `src/domain` and `src/report`.
- Keep company hierarchy nodes, flat SharePoint Site records, and hierarchy-to-site mappings as separate contracts. Never embed a Site as a hierarchy child or node field.
- Access fixtures only behind store/data-access contracts. UI components must not import fixture data directly.
- Extend `InventoryStore`, `HierarchyStore`, `ScanRunStore`, `DeltaStateStore`, and `SensitivityScanner` rather than coupling UI to storage or Graph.
- Upsert scanner results idempotently by stable file identity.
- Treat `locked`, `unsupported`, `throttled`, and `failed` as item outcomes; do not fail an entire run automatically.
- Queue Run now and return immediately. Never hold a browser request until scanning completes.
- Read active `scanEnabled` Sites for scheduled work independently of report users. Scan each Site once per run and apply business mappings only when authorizing cached report reads.
- Preserve unrelated user changes in the worktree.

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
- Prefer a compact resolved-scope proof on the main report: show the assigned business node or nodes, descendant inclusion, visible-node count, visible-Site count, and Secret count.
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
- Zero-Secret, no-scan, partial, stale, and cache-error states.
- Queued scanner behavior without page-load scanning.

Do not declare completion when build or relevant tests fail.

## Advance milestones safely

### Review checkpoint before P4

Obtain explicit decisions for:

- Customer hierarchy names and site placement.
- Production Secret label IDs and whether other labels are included.
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
3. Call `POST /drives/{drive-id}/items/{item-id}/extractSensitivityLabels` only from the scanner environment.
4. Persist real outcomes, scan timestamps, correlation IDs, and delta state.
5. Implement bounded concurrency and bounded retry for `429`, selected `503/5xx`, and transient network failures; respect `Retry-After`.
6. Compare cached counts and rows with manually verified test files.
7. Measure duration, throughput, throttling, write rate, query patterns, and storage volume.

Do not expand to production-wide scanning during P4.

### P5 scheduled Azure pilot

Proceed only after the P4 exit gate and storage decision:

- Add timer and queue workers, nightly incremental scan, and controlled reconciliation.
- Keep Run now queue-based.
- Add telemetry, alerts, recovery, secrets hardening, and operational runbooks.
- Complete security review, retention/export/audit policy, and customer UAT before production completion.

## Handoff

Report:

- Milestone/category completed.
- User-visible behavior changed.
- Security invariants and tests verified.
- Decisions or approvals still blocking the next milestone.
- Deployed private URL when publishing succeeds.
