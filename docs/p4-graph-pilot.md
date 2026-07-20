# P4 Microsoft Graph pilot runbook

## Current implementation

- Azure Identity token provider with managed/workload identity as the default.
- Client-secret mode for an approved local pilot only.
- One-Site allowlist validated before any Graph request.
- Site-drive discovery, drive delta paging, label extraction, item outcomes, deletion
  markers, and delta-state persistence ports.
- Label-response parsing that accepts the current top-level `labels` payload and the
  earlier nested `value.labels` shape used by recorded fixtures.
- Bounded concurrency, bounded retry, `Retry-After`, safe Graph next-link validation,
  and request-ID capture.
- No Graph call from the report page or export path.
- Composition factory that wires environment validation, Azure Identity, transport, and
  injected production stores without coupling them to the report UI.

## Approval gate before live execution

Record all of these decisions before supplying credentials:

1. Non-production SharePoint Site hostname, path, and canonical Graph Site ID.
2. Controlled test files and manually verified expected labels.
3. Reportable label IDs, including Confidential and Secret as applicable.
4. Scanner Entra application/managed identity and credential model.
5. Application permission and admin-consent approval. The extraction API documents
   `Files.Read.All` as least privileged; do not silently substitute `Sites.Selected`.
6. Pilot inventory, scan-run, and delta-state storage adapter.
7. Data retention, access, logging, and incident owner.

## Scanner environment contract

Copy `.env.graph-pilot.example` to `.env.graph-pilot.local`. Copy
`.env.storage.example` only for persistence commands. Do not commit the populated
file. Required values are:

- `SCANNER_TENANT_ID`
- `SCANNER_ALLOWED_SITE_ID`
- `SCANNER_REPORTABLE_LABEL_IDS` — comma-separated Purview label GUIDs included in
  the report, including the exact sublabel GUID where applicable. Do not configure only
  a parent label or compare display names in code.
- Optional `SCANNER_LABEL_DISPLAY_NAMES_JSON` — JSON object mapping approved label
  GUIDs to display names. Every key must already be in the reportable label allowlist.
- `SCANNER_AUTH_MODE=default` for managed/workload identity, optionally with
  `SCANNER_MANAGED_IDENTITY_CLIENT_ID`
- `SCANNER_AUTH_MODE=client-secret` for a local pilot, plus `SCANNER_CLIENT_ID` and
  `SCANNER_CLIENT_SECRET`

Concurrency is restricted to 1–16 and retries to 0–8. Start with the defaults of four
concurrent extractions and three retries, then tune only from measured pilot telemetry.

After the approval gate and secret-managed environment are ready, run `npm run p4:check`.
The command verifies token acquisition, the exact allowlisted Site, and its document
libraries without enumerating files or extracting labels. It prints no token or secret.
Azure Identity is pinned to `SCANNER_TENANT_ID`; a developer CLI session in another
tenant must never be accepted implicitly.
Only proceed to the scanner executor after this check succeeds and a durable store adapter
is configured.

## Bounded extraction pilot

Use `npm run p4:bounded` only after the safe connection check succeeds and the customer
explicitly approves the exact Site and library names. Configure:

- `P4_PILOT_LIBRARY_NAMES` as a comma-separated exact library allowlist.
- `P4_PILOT_MAX_FILES_PER_LIBRARY` from 1 to 20.
- `P4_PILOT_MAX_DELTA_PAGES_PER_LIBRARY` from 1 to 10.

The runner reuses production app-only authentication, retry handling, and bounded
concurrency. It reads delta metadata only until a hard ceiling is reached and calls
`extractSensitivityLabels` only for the selected files. It never downloads content or
writes inventory/cursor state.

The command intentionally prints authorized file names, paths, item outcomes, and label
metadata for pilot reconciliation. Run it only in a private operator terminal; never put
its output in shared CI logs, tickets, or public artifacts. A completed diagnostic pilot
does not replace the durable scheduled scanner or its storage/audit controls.

Treat `415 notSupported` as an unresolved extraction outcome, never as `no-label`. Preserve
the bounded error message and Graph request ID for operator diagnosis. For example, Graph
can reject a protected file when an unsupported user is attached to its assigned sensitivity
label. This proves that extraction failed but does not reveal a trustworthy label ID, so do
not infer the label from its library name or count it under a specific reportable label.

## Safe execution sequence

1. Validate configuration and confirm the requested Site equals the allowlist.
2. Save a running scan record.
3. Discover document-library drives for that Site.
4. Read each saved delta cursor or establish an initial baseline.
5. Extract labels from changed files with bounded concurrency.
6. Atomically apply inventory upserts and deletion markers per drive.
7. Advance the delta cursor only after inventory persistence succeeds.
8. Save succeeded, partial, or failed run metrics without logging file names or tokens.
9. Reconcile cached results against the controlled files manually before any expansion.

Do not broaden the allowlist or schedule tenant-wide scanning until the P4 exit gate,
storage measurement, security review, and customer UAT are complete.
