# ADR 0012: Redeploy one isolated instance per customer tenant

Status: Accepted

Customer delivery uses reproducible provisioning into the customer's Entra tenant and Azure
subscription. It does not move the pilot subscription, reuse its managed identities, or treat an
Azure resource move as application delivery. Tenant-bound application objects, service principals,
managed identities, RBAC assignments, SharePoint Site IDs, Entra group IDs, and sensitivity label
IDs are recreated or rediscovered in the target tenant.

Store non-secret target identifiers in a validated, ignored delivery manifest. Keep secrets in the
target platform's secret boundary. A committed example documents the schema without becoming a
production default. Preflight binds Azure CLI to the exact manifest tenant and subscription before
What-if or Deploy.

Foundation deployment creates a dedicated Resource Group and hardened report-cache Storage account
from Bicep. It is idempotent and uses Shared Key disabled. If the operator lacks role-assignment
permission, deploy in explicit admin-handoff mode and stop before workload publishing or Table data
access. Never weaken storage authentication to bypass separation of duties.

Portable business nodes may be exported and imported after validation. Principal assignments and
Site placements must be rebound to immutable target-tenant objects. Inventory and delta cursors are
not portable business configuration; populate a fresh cache from a controlled target scan.

Keep the source instance unchanged during rehearsal. Cut over identity, API endpoints, web hosting,
and traffic only after target smoke tests and hierarchy-visibility UAT pass. Delete the source
instance only through a later approved retention and teardown decision.
