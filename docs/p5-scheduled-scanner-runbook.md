# P5 scheduled scanner runbook

## Deployed bounded-pilot topology

```text
nightlySchedule ────────────┐
weeklyReconciliation ───────┼─> sensitivity-scan-jobs
Run now (Function key, pilot) ────┘              │
                                                 ▼
                                      processSiteScan (one Site)
                                                 │
                         ┌───────────────────────┼───────────────────────┐
                         ▼                       ▼                       ▼
                  Microsoft Graph        Azure Table cache       Application Insights
                 Secret/Confidential   inventory/run/delta/site       safe telemetry
```

- Resource group: `rg-sp-sensitivity-pilot-sea`
- Function App: `func-sp-sens-scan-khoccycnf`
- Host storage: `stfnscankhoccycnf` (Shared Key disabled)
- Cache storage: `stspsens778a0715` (Shared Key disabled)
- Queue: `sensitivity-scan-jobs`
- Site registry table: `ScannerSites`
- Hosted app registration: `sharepoint-sensitivity-scanner-hosted`
- Hosted app client ID: `ef71cf00-4bff-422d-9413-5877d36d7de2`
- Initial target: DGCS only; exact libraries `Secret` and `Confidential`

`host.json` must include `Microsoft.Azure.Functions.ExtensionBundle` version
`[4.0.0, 5.0.0)` so the Queue trigger binding is registered. A Function metadata listing
alone is insufficient; verify startup telemetry contains `processSiteScan` without a
`queueTrigger not registered` error before invoking Run now.

The schedules are UTC NCRONTAB values:

- nightly incremental: `0 0 18 * * *` (01:00 Asia/Bangkok on the following day)
- weekly reconciliation: `0 0 19 * * 6` (02:00 Asia/Bangkok on Sunday)

Keep `AzureWebJobs.nightlySchedule.Disabled` and
`AzureWebJobs.weeklyReconciliation.Disabled` set to `True` until the manual proof succeeds.
They were changed to `False` after the bounded proof recorded below.

## Source-tenant admin consent gate

An administrator in the SharePoint tenant must review and consent the hosted app's
Microsoft Graph application permission `Files.Read.All`:

<https://login.microsoftonline.com/9fbc4f5d-56ec-4074-82f0-69d9a86a7c06/v2.0/adminconsent?client_id=ef71cf00-4bff-422d-9413-5877d36d7de2&redirect_uri=https%3A%2F%2Ffunc-sp-sens-scan-khoccycnf.azurewebsites.net%2Fapi%2Fscanner%2Fadmin-consent-complete&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default>

The consent must create the enterprise application in the SharePoint tenant and show only
the reviewed application permission. Do not add a client secret. Microsoft documents the
cross-tenant managed-identity federation pattern at
<https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity>.
The redirect URI is registered on the hosted app and terminates at a read-only anonymous
completion page; it does not receive or store a scanner token.

## Build and deploy

Use the non-executing Node env-file loader; never shell-source the populated env file.

```bash
npm run p5:scanner:package
P5_HOSTED_SCANNER_CLIENT_ID=<hosted-app-client-id> \
P5_ASSIGN_MANAGED_IDENTITY_ROLES=true \
P5_SCHEDULES_DISABLED=true \
P5_NIGHTLY_SCHEDULE='0 0 18 * * *' \
P5_RECONCILIATION_SCHEDULE='0 0 19 * * 6' \
npm run p5:scanner:deploy:local
P5_HOSTED_SCANNER_CLIENT_ID=<hosted-app-client-id> npm run p5:scanner:federate:local
npm run p5:scanner:publish:local
npm run p5:scanner:seed-site:local
```

The publish script refuses to deploy unless exact host and cache RBAC assignments exist.
Flex Consumption publishing uses Azure Functions One Deploy (`config-zip`).

## Bounded manual proof

After source-tenant admin consent, keep both timers disabled and run:

```bash
npm run p5:scanner:run-now-check:local
```

The script obtains a Function key without printing it, sends it in the
`x-functions-key` header, expects `202`, and polls `SensitivityScanRuns` until the job is
terminal. It prints only run ID and counts, never file names, paths, credentials, or delta
tokens. Confirm afterward that:

1. the queue has no active message and no poison message;
2. the run is `succeeded` or `partial`, never false-complete;
3. only DGCS and the two exact libraries were touched;
4. delta state was saved only after inventory writes;
5. `SiteLabelSummary.latestRunId` matches the completed run;
6. the report still reads the cache and reflects the new summary.

Only then change both `Disabled` app settings to `False`. If the proof fails, leave timers
disabled, inspect Application Insights by run ID, fix the cause, and retry the bounded
Run now job. Messages that fail three deliveries remain in the automatically created
`sensitivity-scan-jobs-poison` queue for operator review.

### Bounded proof record — 2026-07-16

- Run: `manual-a9628905-1528-45c1-8b47-6917ee94f54a`
- Queue delivery: one job; no poison queue created.
- Result: `partial` in 2.6 seconds; 16 scanned, 12 reportable, 4 unsupported, 0 failed.
- Delta state: two allowed document-library drives updated before summary materialization.
- `SiteLabelSummary`: DGCS, 16 inventory rows, 12 sensitive, 2 libraries, latest run ID matched.
- Cache-only report: EVP and Project each returned 12; sibling/no-assignment/cross-scope
  behaviors remained fail-closed.
- Initial deployment missed the Queue extension bundle and left the job queued. Adding the
  v4 bundle and restarting the scanner host registered the binding; the original job was then
  consumed without enqueueing a duplicate.
- Both schedules were enabled after verification: nightly incremental at 01:00 Asia/Bangkok
  and weekly reconciliation at 02:00 Asia/Bangkok on Sunday.

## Production follow-ups

- Replace the pilot Function key with Entra caller authorization and `ReportAdmin`.
- Connect Azure Monitor alerts to the customer's approved action group/on-call route.
- Confirm schedule/timezone, retention, poison-message handling, expected volumes, and UAT.
- Expand `ScannerSites` only through an approved change; do not widen the Graph Site or
  library allowlists implicitly.

## Tenant-wide discovery gate

Tenant-wide Site discovery is a separate read-only operator action from file scanning. It
requires Microsoft Graph application permission `Sites.Read.All` in addition to the
`Files.Read.All` required by sensitivity extraction. The function-key protected
`POST /api/scanner/discover-sites` endpoint calls `getAllSites` with a 100-page ceiling and
returns only unique Site count, page count, and duplicate count. It does not return Site IDs,
names, URLs, libraries, files, write Table rows, or alter `ScannerSites`/schedule scope.

Do not promote discovered Sites into the scheduled registry until volume, exclusions,
canonical business mappings, and customer approval are reviewed.

### Tenant discovery record — 2026-07-16

- Unique SharePoint Sites: 102 in one `getAllSites` page; no duplicates.
- Document libraries: 73 across 63 Sites.
- Sites with no document library: 35.
- Sites whose drives could not be listed: 4, all returning aggregate `423 notAllowed`.
- Discovery status: `partial`; no Site identity was returned by the operator endpoint.
- Guardrail verification: `ScannerSites` remained at one DGCS record, scan-run count did not
  change, and no discovered Site was added to the active schedule or business hierarchy.

The four `423 notAllowed` Sites remain excluded pending a separate platform/site-type review.
Do not infer their content or bypass the Graph response. Before a tenant baseline, run a separately
approved file-count-only measurement across the 73 readable libraries; do not call sensitivity
extraction merely to estimate volume.

## Tenant-wide file-count-only gate

Run this gate only after explicit approval to enumerate file metadata across the readable tenant
libraries. The function-key protected `POST /api/scanner/count-files` endpoint repeats bounded
Site/library discovery, then performs an initial `drive/root/delta` traversal with a 1,000-page
ceiling per library and bounded concurrency. The Graph request selects only `id`, `file`, `folder`,
and `deleted`. The endpoint counts current file facets in memory and returns aggregate counts only.

It must not call `extractSensitivityLabels`, return or persist Site/library/file identities, save a
delta cursor, write cache rows, add `ScannerSites`, or alter schedules. If a library traversal fails,
discard that library's partial file count and report the failure category as aggregate telemetry.

Operator command:

```bash
npm run p5:scanner:count-files:local
```

### File-count record — 2026-07-16

- Tenant Sites rediscovered: 102.
- Readable document libraries: 73; all 73 traversals completed.
- Current files: 481 across 73 initial delta pages.
- Library item failures: 0.
- Overall status: `partial` only because the same four Sites failed library listing with aggregate
  `423 notAllowed`; their unknown libraries/files are not included in the 481 count.
- Guardrail verification: `ScannerSites` remained at one DGCS record, `SensitivityScanRuns`
  remained at two records, the Site allowlist remained DGCS, and both existing schedules retained
  their prior enabled state.

Use 481 as the current readable-scope baseline estimate, not a whole-tenant completeness claim.
Before tenant sensitivity extraction, approve the exact target registry, exclusions, business
mapping, reportable label IDs, rollout waves, and rollback/stop conditions.

## Controlled tenant baseline preparation — 2026-07-16

The scanner now has a backward-compatible, opt-in registry mode. `single-site` remains the runtime
default, and the deployed Function App continues to target only DGCS. Registry mode additionally
requires every active scan target to carry a non-empty exact drive-ID allowlist in `ScannerSites`;
adding a Site row or granting Graph permission alone cannot widen extraction scope.

Baseline wave selection is capped at ten Sites. The rollout decision stops on missing/non-terminal
runs, failed/cancelled runs, failed items, or throttling. Locked/unsupported partial outcomes require
operator review. ADR 0008 records migration and no-delete rollback behavior.

Before creating the real registry manifest, obtain explicit cross-tenant approval for these fields:

- source tenant: SharePoint tenant `9fbc4f5d-56ec-4074-82f0-69d9a86a7c06`;
- destination: Azure Table `ScannerSites` in storage account `stspsens778a0715`;
- per Site: Graph Site ID, display name, hostname, path, active/scan-enabled state, baseline wave;
- per approved library: Graph drive ID (library name may be retained only as operator review data,
  not as the authorization key);
- exclusions: four Sites returning `423 notAllowed` and Sites with no readable document library;
- retention/rollback: retain registry and scan evidence for audit; disable instead of deleting
  automatically.

Create candidate records disabled, disable both timers before registry activation, and do not call
`extractSensitivityLabels` while building the manifest. The first live wave still requires an exact
manifest review and explicit approval before switching `SCANNER_SCOPE_MODE` to `registry`.

### Candidate manifest record — 2026-07-16

- Source discovery: 102 Sites, 63 readable Sites, 73 document libraries.
- Existing pilot preserved: DGCS remained active and scan-enabled; its row was not overwritten.
- Candidate registry: 62 new Sites covering 69 libraries, all saved with `active=false`,
  `scanEnabled=false`, and a non-empty exact `scanLibraryIds` JSON allowlist.
- Library display names were not persisted because drive IDs are sufficient for the authorization
  boundary; this minimizes cross-tenant metadata retention.
- Waves: seven deterministic candidate waves with Site counts `10/10/10/10/10/10/2`.
- Exclusions: 34 Sites had no document library, four returned aggregate `423 notAllowed`, and one
  returned incomplete Site manifest metadata. The metadata anomaly was failed closed and no record
  was created; do not infer its Site type without a separately approved diagnostic.
- Live idempotency check: the second run saved zero rows, recognized all 62 existing disabled
  candidates, and preserved the single pilot again.
- Guardrails after both runs: 63 total `ScannerSites`, one active/scan-enabled Site, two scan runs,
  16 inventory rows, and one Site summary. `SCANNER_SCOPE_MODE` remains unset and therefore uses
  the code default `single-site`; both timer settings retained their prior enabled state.

No candidate is authorized for extraction yet. Before Wave 1, review the exact operator manifest,
disable both timers, approve the ten Wave-1 Sites and their drive IDs, then activate only those rows
and switch scope mode in one controlled change window.

### Wave 1 operator review — 2026-07-16

- The function-key protected `POST /api/scanner/review-wave-1` endpoint is hard-coded to Wave 1;
  request parameters cannot select another wave.
- It read ten disabled candidate records and resolved 13 approved document libraries from Graph.
- The response included exact Site name/URL and approved library name/URL/drive ID for the explicitly
  authorized operator review. No exact tenant identity was copied into this repository or telemetry.
- Libraries not present in each record's persisted drive-ID allowlist were excluded from the response.
- The review performed no file/delta traversal, no sensitivity extraction, and no Table write.

The exact list was shown in operator output only. It is not activation approval. Keep every candidate
disabled and keep `single-site` mode until the customer explicitly approves these ten Wave-1 targets
for extraction and cache persistence.

### Wave 1 exclusions — 2026-07-16

- The customer excluded `All Guests` and `PublicSite` after exact operator review.
- Both records were retained for audit with `baselineState=excluded`, reason `operator-review`, and
  an exclusion timestamp. `baselineWave` was removed; `active=false` and `scanEnabled=false` were
  preserved.
- The operator transaction preflighted both records before writing. A second application changed
  zero rows and recognized both exclusions, proving live idempotency.
- No replacement was pulled from Wave 2. Wave 1 now contains eight Sites and 11 approved libraries.
- The function-key review was repeated and resolved only those eight disabled candidates; it made
  no file request, extraction call, queue job, scan run, or cache write.

Do not rerun the original candidate-manifest writer expecting it to restore the ten-Site wave. It
must treat these reviewed exclusions as a conflict and fail closed unless a separate re-inclusion
change is explicitly approved.
## Baseline skip and report publication

- A problem Site may be skipped only after an explicit operator decision. Preserve its run and
  cached inventory, set `baselineState=skipped`, record the reason/time, and set
  `active=false` plus `scanEnabled=false`.
- Resume through the deterministic baseline coordinator. It reads the wave membership from
  `ScannerSites`, counts audited skipped records separately, and never retries their terminal run.
- The Report API may read active `ScannerSites` rows to validate configuration, but every report
role—including EVP—receives Sites only through active canonical `HierarchySitePlacements` inside its assigned
  node or descendants. Each EVP is the root of an independent business tree, not a tenant-wide role.
- Keep unmapped, inactive, excluded, and skipped Sites hidden from all report users. Preserve them
  for scanner/audit operations as appropriate, then publish them only after an operator adds the
  approved canonical business placement.
- Current POC limitation (2026-07-20): the eight visible pilot Sites use the existing
  `project-aurora` placement so DGCS and Wave 1 remain demonstrable. This is test placement, not a
  claim about the customer's real organization. Before production/UAT, load the approved EVP
  forest, assignments, and per-Site canonical placements instead of copying this pilot mapping.
