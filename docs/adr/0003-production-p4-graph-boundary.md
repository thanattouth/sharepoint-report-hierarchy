# ADR 0003: Production boundary for the P4 Microsoft Graph pilot

Status: Accepted for implementation; live tenant execution pending approval

The P4 scanner uses a separate background identity and a Microsoft Graph adapter
behind the existing scanner and store contracts. Report requests remain cache-only.
No scanner credential, access token, tenant ID, Site ID, or production label ID may
enter browser code, `NEXT_PUBLIC_*`, logs, fixtures, or committed configuration.

The pilot fails closed to exactly one active, scan-enabled, non-production Site ID.
Microsoft Graph next links are accepted only from the configured Graph v1.0 origin.
Requests use bounded concurrency and bounded retry, honor `Retry-After`, and persist
item outcomes before advancing the drive delta cursor. Reprocessing is therefore
at-least-once and must remain idempotent in the production inventory store.

Use Azure managed identity or workload identity for hosted production workloads.
Client-secret authentication exists only for an explicitly approved local pilot and
must use a secret store. Azure Identity owns token acquisition and caching.

The `extractSensitivityLabels` documentation currently lists `Files.Read.All` as the
least privileged application permission. Although `Sites.Selected` supports explicit
site-level grants generally, that extraction API does not list it. Do not assume the
Selected scope works for extraction. Security review must choose and document either:

1. an approved `Files.Read.All` P4 scanner identity with a single-Site application
   allowlist and monitoring, accepting that the Entra grant is tenant-wide; or
2. a verified, Microsoft-supported site-scoped permission path proven in the test
   tenant before implementation relies on it.

Do not grant or expand Graph permission automatically from this repository.
