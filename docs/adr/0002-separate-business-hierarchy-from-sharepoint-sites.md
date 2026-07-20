# ADR 0002: Separate business hierarchy from SharePoint sites

Status: Accepted for prototype

SharePoint sites are a flat tenant inventory. EVP, Department, Group, and
Project are customer business scopes used to authorize visibility; they are not
SharePoint parent/child levels.

The organization is a forest of independent EVP roots. Each tree follows
`EVP -> Department -> Group -> Project`. An EVP assignment includes only that
EVP node and its descendants; it never implies tenant-wide visibility or access
to another EVP tree.

Store business nodes, SharePoint sites, and hierarchy-to-site mappings as
separate records. A business node may map to zero or many sites. The prototype
requires one canonical active hierarchy placement per site. Resolve report
access in this order:

```text
signed-in UPN
-> active hierarchy assignments
-> visible business nodes
-> active site mappings
-> distinct allowed site IDs
-> server-filtered cached inventory
```

A Site registry row or cached summary does not grant report access. Every
visible Site requires one active canonical mapping to a node inside the user's
resolved tree. Unmapped Sites remain available to scanner operations but hidden
from all report users until their business placement is approved.

The scheduled scanner reads active scan-enabled sites independently of user
assignments. It scans a site once per scheduled run, persists inventory and
delta state, and never runs as part of a report page request. Business mappings
are applied when cached report data is read, not when scan jobs are multiplied.

This separation supports large tenants, organizational changes, and site
reassignment without pretending that SharePoint itself has the customer's
corporate hierarchy.
