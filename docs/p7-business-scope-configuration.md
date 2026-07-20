# P7 persistent business scope configuration

P7 removes business authorization configuration from compiled fixtures without changing the
scheduled scanner or the report-reader permission boundary.

## Current production slice

- `HierarchyNodes`: 16 validated nodes in two independent EVP trees.
- `ScopeAssignments`: 10 pilot user assignments; the contract also supports Entra groups.
- `HierarchySitePlacements`: 8 canonical Site rows migrated from the legacy mapping table.
- `HierarchySiteMappingAudit`: append-only audit target for configuration changes.
- Report API: `Storage Table Data Reader`, with `REPORT_HIERARCHY_SOURCE=table`.
- Legacy `HierarchySiteMappings`: retained unchanged for rollback.

The migration command is dry-run by default:

```bash
npm run p7:config:migrate:local
npm run p7:config:migrate:apply:local
```

These commands load only the `p7-configuration` env profile. Populate `.env.storage.local` and
`.env.configuration-admin.local`; `.env.p4.local` is supported only as a filtered migration fallback.

The apply path creates missing configuration tables, seeds nodes and assignments, migrates only
Sites that do not already have a canonical row, then reads all records back and validates counts,
references, parent order, cycles, active Sites, and unique placement.

## Site Mapping Admin Inbox

The separate Configuration Admin API and `/admin/site-mappings` Inbox keep the Function key and
Table token server-side. The current UI supports:

1. unmapped-first searchable Site rows;
2. mapped/unmapped/inactive filters and pagination;
3. a searchable target-node selector showing full EVP / Department / Group / Project breadcrumb;
4. bulk preview showing new assignments, moves, unchanged rows, and affected direct principals;
5. Entra `ReportAdmin` authorization for Inbox, preview, and Apply;
6. optimistic apply with expected versions and the verified UPN written to audit metadata.

The Configuration Admin Function paginates before returning rows to Sites, with a maximum page size
of 50 and bulk preview limit of 100. The Sites bridge validates all browser input, rejects redirects,
attaches the Function key from server-only configuration, and derives its actor from the verified
Entra session. The browser cannot choose the actor. The Configuration API pilot allowlist remains a
second server-side check. See `docs/p8-entra-web-auth.md` and ADR 0010.

## Deployed Configuration Admin boundary

The bounded pilot runs in `func-sp-sens-config-rxqc7ksp3` with two user-assigned identities:

- `id-sp-sens-config-host` owns only Function host storage and monitoring publication.
- `id-sp-sens-config-writer` has `Storage Table Data Contributor` at the exact scopes of
  `HierarchyNodes`, `ScopeAssignments`, `HierarchySitePlacements`, and
  `HierarchySiteMappingAudit`, plus `Storage Table Data Reader` at the exact `ScannerSites` scope.

The writer has no inventory, summary, scan-run, delta, host-storage, Graph, or Report API role.
HTTP routes use `/api/configuration/site-mappings`; do not use `/api/admin/...` because Azure
Functions reserves the `admin` route segment. Function-level authentication and the server-side
actor allowlist are both required.

Package and verify the Configuration Admin API independently from the Entra-protected Sites path:

```bash
npm run p7:admin:package
npm run p7:admin:publish:local
npm run p7:admin:check:local
```

The verification calls only inbox and preview. It must reconcile the 8 canonical placements while
allowing additional inactive/unmapped `ScannerSites` records in the inbox. If Flex Consumption
indexes the previous package after One Deploy, wait for the active deployment to complete and
restart only the Configuration Admin Function; confirm the route metadata before retrying.

## Rollback

Restore the Report API settings to fixture hierarchy and `HierarchySiteMappings`, redeploy the
last package, and verify the multi-Site report check. Do not delete new or legacy configuration
tables during rollback.
