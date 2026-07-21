# ADR 0013: Use Entra groups without a Report API user allowlist

Status: Accepted

The production report authorizes application capability through the single-tenant Enterprise
Application's `ReportViewer` and `ReportAdmin` roles, then resolves data scope from active business
assignments keyed by immutable Entra user or group Object ID. A per-user UPN allowlist in the Report
API duplicates Entra group administration and rejects valid B2B guests because their resource-tenant
UPN can use the `#EXT#` form.

Remove `REPORT_PILOT_ALLOWED_UPNS` from the Report API, Bicep template, environment profiles, and
customer delivery manifest. The server bridge must send the tenant ID, UPN, user Object ID, group
Object IDs, and capability derived from the verified Entra session. The Report API compares the
tenant ID with the cache tenant, validates the principal contract, and returns HTTP 403 for invalid
identity or unauthorized scope. Malformed report filters remain HTTP 400; cache/storage failures
remain HTTP 503.

This change does not make the report tenant-wide. An app role grants access to the application but
not cached data. A principal without an active Scope Assignment receives no inventory, and an EVP
assignment resolves only active Site mappings inside that EVP root and its descendants. The Function
key remains a protected server-to-server bridge credential in Key Vault and must never reach the
browser. Replace it with workload identity during final production hardening.

Customer delivery manifest schema version 2 removes `workloads.report.allowedUpns`. UAT identities
belong to operator verification inputs, not workload runtime configuration.
