# ADR 0007: Use per-Site queue jobs and a federated scanner identity

Status: Accepted for the bounded P5 pilot

The hosted scanner uses Azure Functions Timer and Queue triggers. A timer never scans
SharePoint directly. It reads active `scanEnabled` records from the flat `ScannerSites`
table and enqueues one versioned job per Site. The Queue worker resolves the exact Site,
executes one scan, writes idempotent inventory and delta state, then materializes that
Site's `SiteLabelSummary`. Business hierarchy assignments are not part of scheduling.

Scheduled run IDs are deterministic for `trigger + UTC schedule slot + Site`, so a
replayed timer does not multiply work. Queue delivery is at-least-once; terminal
`succeeded`, `partial`, and `cancelled` runs are skipped when delivered again. Failed
runs throw from the worker so the queue runtime can retry them up to its bounded poison
threshold. Inventory changes, including reconciliation tombstones, are persisted before
the delta cursor advances.

The bounded pilot has an exact Graph Site allowlist and an exact, case-sensitive library
allowlist (`Secret` and `Confidential`). A configured library that is absent fails the
Site run closed. `locked`, `unsupported`, `throttled`, and item failures produce a
`partial` run rather than a false complete state.

The Function App has two user-assigned managed identities:

- the host identity can operate only the Function deployment storage, Queue host state,
  and Application Insights ingestion;
- the scanner workload identity has `Storage Table Data Contributor` on the isolated
  report cache and is the federated subject used to obtain Microsoft Graph tokens.

Because the Azure subscription tenant and SharePoint tenant differ, the workload identity
trusts a multi-tenant app registration in the Azure tenant. The app is provisioned and
admin-consented in the SharePoint tenant for Microsoft Graph `Files.Read.All`. No client
secret is stored in the hosted Function. The earlier SharePoint-tenant app registration
remains restricted to the approved local bounded pilot.

Both timer functions deploy disabled. A function-key protected `Run now` endpoint exists
only for the bounded no-login pilot and queues the exact allowlisted Site. It must be
replaced by Microsoft Entra caller authorization and a `ReportAdmin` capability check
before production.

