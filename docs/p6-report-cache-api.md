# P6 read-only report API

This slice places Azure Table access behind an Azure Functions Flex Consumption API. It keeps
the Sites worker and browser away from Azure Storage tokens and preserves the cache-only report
path. In hosted mode it accepts only the identity contract produced from a verified single-tenant
Entra session and exposes no scanner operation.

## Architecture

- `id-sp-sens-report-host` runs the Functions host and accesses only its dedicated host storage
  plus Application Insights.
- `id-sp-sens-report-reader` reads the existing report cache and receives only
  `Storage Table Data Reader` at that storage-account scope.
- The scanner identity remains separate and is never attached to the Function App.
- The API resolves hierarchy scope before Table access. Broad scope reads `SiteLabelSummary`;
  inventory reads require an authorized Site selection when the configured threshold is crossed.
- The API validates the request tenant against `REPORT_CACHE_TENANT_ID`, validates the verified
  user/group Object IDs and app role, and then resolves active business assignments. It has no
  per-user UPN allowlist; Entra groups remain the membership source of truth.
- The Function key is a bounded pilot caller credential. Sites must store it as a server-side
  secret and send it in `x-functions-key`; it must never appear in a URL, browser bundle,
  `NEXT_PUBLIC_*`, log, or commit.

The Function-key caller boundary must eventually be replaced with Microsoft Entra
service-to-service authorization. Until then the key is a Key Vault-backed server-bridge credential;
the browser cannot submit identity headers or read the key. Function keys do not themselves provide
user identity or business authorization.

## Reproducible commands

Keep tenant-specific values in ignored `.env.storage.local`, `.env.report-api.local`, and
`.env.p6-operator.local`. Keep the Sites connection key in `.env.report-client.local` for local
work only. Do not shell-source any env file.

```bash
npm run p6:api:what-if:local
npm run p6:api:deploy:local
npm run p6:api:package
npm run p6:api:publish:local
```

`p6:api:publish:local` fails closed unless every required role exists at the exact resource
scope. It does not accept an inherited broad role as a production shortcut. The command publishes
with Azure Functions One Deploy (`az functionapp deployment source config-zip`), the supported
package deployment path for Flex Consumption.

## Required RBAC

An authorized Role Based Access Control Administrator, User Access Administrator, or Owner must
create these assignments. Grant the administrator role at the smallest practical scope and remove
temporary elevation after the assignments are verified:

| Principal | Role | Exact scope |
| --- | --- | --- |
| host identity | Storage Blob Data Owner | dedicated Functions host storage account |
| host identity | Storage Table Data Contributor | dedicated Functions host storage account |
| host identity | Monitoring Metrics Publisher | dedicated Application Insights resource |
| report-reader identity | Storage Table Data Reader | existing isolated report-cache storage account |

The host Table role supports Functions diagnostic events. It does not apply to the report cache.
Do not grant the report reader Contributor, Owner, scanner Graph permissions, or a write-capable
Table role.

An administrator can either rerun the Bicep deployment with
`assignManagedIdentityRoles=true` or create the four equivalent exact-scope assignments. After
RBAC propagation, rebuild the package and run the guarded publish command.

## Live verification

After code publishing:

1. Retrieve a Function host key without printing or committing it.
2. Call `/api/health` and confirm only configured aggregate metadata is returned.
3. Call `/api/report` with verified same-tenant EVP and Project identity contracts; compare sensitive counts with
   `SiteLabelSummary`.
4. Confirm wrong-tenant, malformed-identity, sibling, no-assignment, and cross-Site requests fail closed.
5. Inspect logs and confirm they contain status/count telemetry but no tokens, keys, file names,
   paths, or query-string secrets.
6. Store the key through Sites environment management as a secret, set
   `REPORT_DATA_SOURCE=azure-api`, build, and privately deploy the exact validated source.

Rotate the Function key after operator testing and before Sites handoff. Revoke it when Microsoft
Entra caller authorization replaces the pilot boundary.

## Rollback

The API shares the resource group with the report cache, so never delete the resource group.
Rollback only the Function App, Flex plan, host storage, Application Insights, Log Analytics,
the two P6 managed identities, and their P6 role assignments. Preserve `stspsens778a0715` and
all four report-cache tables.

## Deployment record — 2026-07-15

- Deployment: `p6-report-cache-api-v1`, succeeded with RBAC creation disabled.
- Function App: `func-sp-sens-report-zldde7q4v`
- Flex plan: `plan-sp-sens-report-zldde7q4v`, Node.js 22, 2 GB, maximum 20 instances.
- Host storage: `stfnreportzldde7q4v`; Shared Key disabled, HTTPS/TLS 1.2, OAuth default.
- Host identity principal: `30f0346b-3f7f-49f4-8f3a-d8e631e4881f`
- Report-reader identity principal: `0b733b4f-6fb2-4e02-a401-3c3c677b9ac7`
- Report-reader client ID: `20c4ca0f-0d43-49d3-a686-962f27538dc0`
- Application Insights: `appi-sp-sens-report-zldde7q4v`, local authentication disabled.
- Exact-scope RBAC: all four required assignments were created and verified.
- Code package: published successfully with Azure Functions One Deploy.
- Live API verification: `/api/health` returned HTTP 200 with `azure-table` mode. The approved EVP
  and Project personas each returned one Site, 12 sensitive rows, and HTTP 200. The sibling persona
  returned `no-sites`; the unassigned persona returned `no-assignment`.
- Sites integration: the Function key is stored as a Sites server-side secret; the endpoint, mode,
  and timeout are runtime environment values. This historical pilot deployment was later superseded
  by ADR 0013, which removes the persona allowlist in favor of verified tenant/app-role/group scope.

## References

- [Azure Functions Flex Consumption](https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan)
- [Identity-based Azure Functions connections](https://learn.microsoft.com/azure/azure-functions/functions-reference)
- [Microsoft Entra authentication for App Service and Functions](https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad)
