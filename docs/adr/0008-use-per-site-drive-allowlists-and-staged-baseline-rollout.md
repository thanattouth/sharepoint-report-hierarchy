# ADR 0008: Use per-Site drive allowlists and staged baseline rollout

Status: Accepted for implementation; tenant activation requires a separate approved manifest

The bounded DGCS pilot uses one environment Site ID and one library-name allowlist. That boundary
must remain the default, but it does not scale safely to a tenant where Sites have different
library names or a library can be renamed.

Add an explicit scanner scope mode:

- `single-site` remains the default and continues to require the exact environment Site ID and
  case-sensitive library names.
- `registry` permits only active, scan-enabled `ScannerSites` records that contain a non-empty
  exact `scanLibraryIds` allowlist. The worker still resolves the target from the registry before
  invoking Microsoft Graph.

Store `scanLibraryIds` as a JSON property on each Azure Table Site entity and retain the optional
`baselineWave` number as rollout metadata. Drive IDs are the authorization boundary; library names
remain report display metadata only. Existing rows without these fields remain readable, but they
cannot run in registry mode.

Operator exclusions retain the Site record and drive allowlist for audit, clear `baselineWave`,
keep both active flags false, and set `baselineState=excluded` plus reason and timestamp. Do not
delete an excluded record or silently refill a reviewed wave from the next wave. A manifest rebuild
must fail closed on the resulting conflict rather than overwrite the operator decision.

Baseline waves are limited to at most ten Sites. A wave stops automatically at the decision layer
when a run is missing, non-terminal, failed/cancelled, has failed items, or reports throttling. A
wave with only locked/unsupported partial items requires operator review before proceeding.

## Migration

1. Deploy the backward-compatible code and infrastructure setting while keeping
   `SCANNER_SCOPE_MODE=single-site`.
2. Disable both timers before adding candidate records.
3. Build and approve an exact manifest containing source tenant ID, Site ID/name/hostname/path,
   approved drive IDs, baseline wave, destination Table account, and retention decision.
4. Insert candidates as inactive or `scanEnabled=false`; validate duplicates and missing drives.
5. Enable only the approved first wave, switch to registry mode, enqueue its bounded manual jobs,
   and evaluate terminal runs plus cache/report reconciliation.
6. Continue only on `proceed`; review partial outcomes and stop on any stop decision.
7. After all approved baselines reconcile, enable the regular schedules for active targets.

## Rollback

Disable both timers, set `SCANNER_SCOPE_MODE=single-site`, and disable every non-DGCS registry
record. Existing inventory and delta rows are retained for audit until the customer-approved
retention action; rollback never deletes them automatically. Verify the queue and poison queue are
empty before restoring the DGCS schedule.
