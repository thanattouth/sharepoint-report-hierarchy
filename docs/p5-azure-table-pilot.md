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
- grants only `Storage Table Data Contributor` to the supplied scanner principal.

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
               scannerPrincipalId=<scanner-service-principal-object-id>
```

Deployment is idempotent. Rollback for this isolated pilot is removal of its dedicated resource
group after an approved export or confirmation that pilot data may be discarded. Never run that
rollback against a shared resource group.

## Local bounded persistence

Keep the real values in the ignored `.env.p4.local` file and add:

```dotenv
AZURE_STORAGE_ACCOUNT_NAME=<isolated-storage-account>
AZURE_TABLE_INVENTORY_NAME=SensitivityInventory
AZURE_TABLE_SCAN_RUN_NAME=SensitivityScanRuns
AZURE_TABLE_DELTA_STATE_NAME=SensitivityDeltaState
```

After RBAC propagation, load the environment without printing it and run:

```bash
set -a
source .env.p4.local
set +a
npm run p5:persist-bounded
```

The command probes the exact allowed Site, scans only the explicitly named libraries within
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
