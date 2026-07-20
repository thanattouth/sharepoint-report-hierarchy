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

## Next admin slice

Build a separate configuration-admin API and Site Mapping Inbox. Keep its secret and Table token
server-side. The UI must support:

1. unmapped-first searchable Site rows;
2. mapped/unmapped/inactive filters and pagination;
3. a searchable target-node selector showing full EVP / Department / Group / Project breadcrumb;
4. bulk preview showing new assignments, moves, unchanged rows, and affected direct principals;
5. optimistic version checks and audit identity before apply.

Until authenticated Entra administration is connected, do not expose a browser write path. A
Function key may protect a bounded server-to-server pilot, but the actor must come from an approved
server-side allowlist, never an arbitrary browser header.

## Rollback

Restore the Report API settings to fixture hierarchy and `HierarchySiteMappings`, redeploy the
last package, and verify the multi-Site report check. Do not delete new or legacy configuration
tables during rollback.
