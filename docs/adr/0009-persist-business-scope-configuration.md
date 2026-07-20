# ADR 0009: Persist business scope configuration with canonical Site placements

Status: Accepted

Business hierarchy, scope assignments, and SharePoint Site placements must be customer-managed
configuration rather than source-code fixtures. Persist them in separate Azure Tables:

- `HierarchyNodes`
- `ScopeAssignments`
- `HierarchySitePlacements`
- `HierarchySiteMappingAudit`

Keep `ScannerSites` independent. A scanner registry row controls scheduled work; a canonical
placement controls business visibility. Neither record implies the other.

Use the cache tenant ID as the partition key for hierarchy, assignment, and placement records.
Use the immutable Site ID as the `HierarchySitePlacements` row key. This makes one canonical row
per Site a storage-level invariant instead of relying only on report-time validation. Store a
monotonic version, actor, and timestamp on each placement. Configuration writes must use the
expected version and the Azure entity ETag so concurrent administrators cannot silently overwrite
one another. Emit a separate audit event for every effective assignment, move, reactivation, or
deactivation.

Hierarchy nodes and scope assignments also carry a monotonic version, actor, and timestamp. Admin
writes compare the expected version and Azure entity ETag before replacing the record. Existing
rows that predate versioning are read as version 1; their first effective admin change persists
version 2. Node and assignment events use a dedicated `configuration` partition namespace inside
the existing `HierarchySiteMappingAudit` append-only Table. This preserves the exact four-table
writer RBAC boundary while keeping Site-mapping and business-configuration codecs and stores
separate in code.

Assignments support Entra `User` and `Group` principals. Prefer immutable object IDs for
production matching; retain UPN and display name only for controlled pilot fallback, search, and
display. A group assignment contributes scope when the signed-in user's resolved group object IDs
contain the configured group object ID. SharePoint Site ownership never grants report scope.

The Report API remains read-only and resolves scope before inventory access. Configuration writes
must use a separate admin API/workload identity with Table Data Contributor limited to the four
configuration tables where Azure scope permits. Do not grant the report-reader identity write
access and do not reuse the scanner identity.

## Migration and rollback

`HierarchySiteMappings` is the legacy table whose row key combined node and Site IDs. Migrate it
into `HierarchySitePlacements` only after rejecting duplicate active placements. Seed hierarchy
and assignments, read all new records back, and validate the complete configuration before
switching `REPORT_HIERARCHY_SOURCE=table` and `AZURE_TABLE_SITE_MAPPING_NAME`.

Keep the legacy table unchanged during the transition. Roll back by restoring
`REPORT_HIERARCHY_SOURCE=fixture` and `AZURE_TABLE_SITE_MAPPING_NAME=HierarchySiteMappings`, then
republish the last known-good Report API package. Do not delete either table until customer UAT,
retention, and rollback-window decisions are complete.

The version fields and configuration-audit partitions are backward compatible. Rolling back the
Configuration Admin API leaves them untouched; the prior reader ignores additional entity fields.
Never decrement versions or delete configuration audit rows during rollback.
