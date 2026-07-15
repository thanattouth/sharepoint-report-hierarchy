# ADR 0005: Use Azure Table for the pilot scanner cache

- Status: Accepted for pilot
- Date: 2026-07-15

## Context

The report must read cached scan results and must remain independent from real-time
SharePoint enumeration. A customer tenant can contain about 1,000 Sites and many more
files. The selected store must support idempotent file upserts, scheduled scans, operational
run records, delta cursors, customer-owned deployment, and a credible handoff path.

SharePoint Lists are familiar to Microsoft 365 administrators, but the per-file inventory
would quickly encounter list-view/query constraints and Graph write throttling. Lists remain
reasonable for small, human-maintained configuration, not for the scanner's primary inventory.

## Decision

Use an isolated customer-owned Azure Storage account with Azure Table for the pilot cache.
Provision it from Bicep and authenticate with Microsoft Entra ID. Disable shared-key access.
Grant `Storage Table Data Contributor` only to the approved data-plane principal at the
storage-account scope. A local cross-tenant pilot may use the signed-in storage-tenant operator;
production must replace that assignment with the hosted worker's managed identity.

Use these tables:

- `SensitivityInventory` — current item outcomes. Partition by encoded
  `tenantId + siteId`; row key by encoded `driveId + itemId`.
- `SensitivityScanRuns` — run status and aggregate outcome counts. Partition by tenant ID.
- `SensitivityDeltaState` — one opaque cursor per drive. Partition by tenant ID.
- `SiteLabelSummary` — precomputed report-facing Site/label, library, outcome, and freshness
  counts. It is materialized from one Site inventory partition after persistence and can be
  rebuilt independently for reconciliation.

The report will read precomputed summaries and paginated cache projections. It will not scan
SharePoint during page load and will not enumerate every inventory partition to render a
1,000-Site dashboard.

Report authorization resolves allowed Site IDs before any Table query. Broad views read Site
summaries; file detail requires an explicitly selected, server-authorized Site. The report's
read identity is separate from the scanner's write identity as defined in ADR 0006.

## Consequences

- Stable keys make file writes idempotent and allow a Site partition to be read efficiently.
- Graph and Table credentials are separate configuration boundaries. This supports a Graph
  tenant and an Azure subscription tenant that differ without making either credential
  multi-tenant or reusing a token across resources.
- Azure Table supports the pilot's high write volume at low operational complexity.
- Queries outside partition/row-key access are not automatically indexed. Required global
  views must be materialized explicitly rather than implemented as broad table scans.
- Table entities returned by the service contain `etag` and `timestamp`; adapters must strip
  these service fields before returning domain objects.
- `Standard_LRS` and a public service endpoint are pilot settings. Production promotion
  requires an approved durability tier, network isolation, retention/export, restore drills,
  monitoring, and cost/volume evidence.
- If query requirements expand to complex ad-hoc joins, cross-tenant analytics, or many
  secondary indexes, reassess Azure SQL or Cosmos DB instead of forcing those workloads into
  Azure Table.

## Alternatives considered

- **SharePoint Lists:** rejected for per-file inventory because the operational query/write
  profile is machine-oriented and likely to exceed comfortable list thresholds. May still be
  used for low-volume customer-managed configuration after a separate decision.
- **Azure SQL:** strong query model but more cost and operational overhead than this bounded
  pilot currently justifies.
- **Cosmos DB:** capable at scale but unnecessary before throughput and query evidence show
  that Azure Table is insufficient.

## References

- [Azure Table scalability targets](https://learn.microsoft.com/azure/storage/tables/scalability-targets)
- [Design for querying Azure Table](https://learn.microsoft.com/azure/storage/tables/table-storage-design-for-query)
- [Authorize Azure Table with Microsoft Entra ID](https://learn.microsoft.com/azure/storage/tables/authorize-access-azure-active-directory)
- [SharePoint list limits](https://learn.microsoft.com/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits)
