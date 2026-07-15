# P5 Azure Table pilot cache

This slice promotes the bounded DGCS scan from console-only diagnostics to an isolated,
customer-owned cache. It does not schedule the scanner yet and does not connect the web report
to Azure. The approved Graph boundary remains exactly one Site and the exact `Secret` and
`Confidential` library names configured for the pilot.

## Resources

Deploy `infra/azure-table-pilot/main.bicep` into a dedicated resource group. The template:

- creates one `StorageV2` account using `Standard_LRS` for the pilot;
- disables blob public access and shared-key authorization;
- defaults data-plane authorization to Microsoft Entra ID;
- creates inventory, scan-run, delta-state, and future Site-summary tables; and
- grants only `Storage Table Data Contributor` to the supplied data-plane principal at the
  storage-account scope.

Do not reuse a generic customer storage account. Do not add account keys or connection strings
to the application configuration.

Example deployment (replace all placeholders):

```bash
az group create \
  --name <isolated-resource-group> \
  --location southeastasia \
  --tags workload=sharepoint-sensitivity-scanner environment=pilot managedBy=bicep

az deployment group create \
  --resource-group <isolated-resource-group> \
  --name azure-table-pilot-v1 \
  --template-file infra/azure-table-pilot/main.bicep \
  --parameters storageAccountName=<globally-unique-name> \
               tableDataPrincipalId=<data-plane-principal-object-id> \
               tableDataPrincipalType=ServicePrincipal
```

The deployer needs `Microsoft.Authorization/roleAssignments/write`. When organizational
separation of duties prevents that permission, deploy with `assignTableDataRole=false`; then an
authorized subscription owner must assign `Storage Table Data Contributor` at the new storage
account scope before any data-plane test. Do not enable Shared Key as a workaround.

Deployment is idempotent. Rollback for this isolated pilot is removal of its dedicated resource
group after an approved export or confirmation that pilot data may be discarded. Never run that
rollback against a shared resource group.

## Local bounded persistence

Keep the real values in the ignored `.env.p4.local` file and add:

```dotenv
AZURE_STORAGE_ACCOUNT_NAME=<isolated-storage-account>
AZURE_STORAGE_TENANT_ID=<storage-subscription-tenant-id>
AZURE_TABLE_AUTH_MODE=azure-cli
AZURE_TABLE_INVENTORY_NAME=SensitivityInventory
AZURE_TABLE_SCAN_RUN_NAME=SensitivityScanRuns
AZURE_TABLE_DELTA_STATE_NAME=SensitivityDeltaState
```

After RBAC propagation, load the local environment with Node's env-file parser and run:

```bash
npm run p5:persist-bounded:local
```

Do not shell-source the populated file. JSON display-name maps and secret characters can be
altered or interpreted by the shell; Node's env-file parser loads them without executing text.

`azure-cli` is restricted to the explicitly approved local pilot. Grant that signed-in user the
Table role only on this isolated account. A hosted worker must use `managed-identity` and replace
the user role assignment before production promotion.

The command uses separate tenant-pinned credentials for Graph and Table, probes the exact
allowed Site, scans only the explicitly named libraries within
the existing hard bounds, upserts item outcomes, saves one run record, and reads the Site
partition back. Its console output contains only IDs and aggregate counts—not file names or
paths. It does not persist delta cursors because a bounded diagnostic is not a complete drive
delta traversal.

An outcome is `partial` when any item is locked, throttled, unsupported, or failed. A `415`
response remains `unsupported`; it is never converted to `no-label` or inferred from the
library name.

## Verification

Before handoff:

1. Confirm the storage account has shared-key access disabled.
2. Confirm the scanner principal has only the required Table data role on this account.
3. Confirm table entity counts through the application credential and compare aggregate
   outcomes with the bounded Graph run.
4. Run `npm run lint`, `npm run typecheck`, `npm test`, and dependency audit.
5. Confirm no credentials, file names, paths, or opaque delta tokens were committed or logged.

## Production promotion gates

- Replace the short-lived local client secret with managed identity/workload identity.
- Add timer and queue workers; Run now must enqueue and return immediately.
- Populate `SiteLabelSummary` transactionally enough for cache-only report reads and record
  freshness/run provenance.
- Add metrics, alerts, poison-job handling, retry budgets, reconciliation, and operator runbooks.
- Approve network isolation, durability tier, retention, export/restore, privacy, cost, and
  regional placement with the customer.
- Load-test expected Site/file volume and validate hot-partition behavior. Revisit key design or
  storage technology if the measured query/write profile crosses the agreed thresholds.

## Pilot deployment record — 2026-07-15

- Azure tenant: `778a528f-5fd8-4807-be62-7be9025cd230`
- Subscription: `5BAHT_Ent_AI_Env` (`d7467474-0c95-42a8-9eff-cfb83c9387f8`)
- Resource group: `rg-sp-sensitivity-pilot-sea`
- Storage account: `stspsens778a0715`, Southeast Asia, `Standard_LRS`
- Security: Shared Key disabled, OAuth default, HTTPS only, minimum TLS 1.2
- Tables: `SensitivityInventory`, `SensitivityScanRuns`, `SensitivityDeltaState`,
  `SiteLabelSummary`
- RBAC: `Storage Table Data Contributor` is currently inherited at subscription scope. The user
  explicitly accepted this broader temporary scope for the pilot; narrow it to the storage
  account before production promotion.
- Cross-tenant transfer approval: the user confirmed that every bounded DGCS file is a test file
  and approved storing its metadata from `baht.net` in the `m365.co.th` Azure Table pilot.
- First persisted run: `bounded-f0621ef1-abb7-44dc-874a-4429cde9601f`; 16 current inventory
  entities, 12 reportable-label successes, 4 unsupported, 0 failed, and status `partial`.
- `SensitivityDeltaState` remained empty because the bounded traversal must not establish a
  production delta cursor.
