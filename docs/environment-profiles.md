# Environment profiles

Local operator configuration is split by workload and trust boundary. Do not create another
combined `.env` file. Copy only the examples required by the command being run:

| Local file | Owner | Contains secrets |
| --- | --- | --- |
| `.env.storage.local` | Azure Table operator access and optional table overrides | No shared key; Azure CLI token is external |
| `.env.scanner-target.local` | SharePoint tenant, scope mode, Site/library and label boundaries | No credential |
| `.env.graph-pilot.local` | bounded local Graph pilot | May contain the temporary P4 client secret |
| `.env.scheduled-scanner.local` | hosted scanner runtime inputs | No local client secret |
| `.env.p5-operator.local` | scanner infrastructure and baseline operations | No workload credential |
| `.env.report-api.local` | read-only Report API runtime and pilot persona inputs | No scanner or Function key |
| `.env.report-client.local` | Sites server-to-Report-API connection | Function key; store it as a Sites secret when hosted |
| `.env.p6-operator.local` | Report API infrastructure, migration, and verification | No workload credential |
| `.env.configuration-admin.local` | configuration tenant and bounded admin allowlist | No Table token; hosted access uses managed identity |
| `.env.p7-operator.local` | Configuration Admin infrastructure and deployment controls | No workload credential |

Every `*:local` npm command uses `scripts/run-env-profile.ts`. The runner:

1. reads env text with Node's non-executing parser;
2. validates that known keys are placed in the owning scoped file;
3. removes all managed keys from the inherited child environment;
4. passes only the keys allowlisted for the named command profile;
5. allows an explicitly supplied shell variable to override the same allowlisted key;
6. logs file names and key counts but never values.

`.env.p4.local` remains a temporary migration fallback. When no scoped file for a command exists,
the runner reads the legacy file, filters it through the selected profile, and emits a deprecation
warning. Delete the legacy file only after the required scoped local files have been populated and
the P5, P6, and P7 dry-run checks pass.

Split the current legacy file without printing any value or overwriting an existing scoped file:

```bash
npm run env:split:dry-run
npm run env:split:apply
```

The apply command writes ignored files with owner-only permissions and retains `.env.p4.local` for
rollback. Review duplicated workload values such as authentication mode against each matching
example before deleting the legacy file.

## Runtime rules

- Keep business hierarchy, assignments, Site placements, and their audit trail in Azure Tables.
- Keep stable table names in code/Bicep defaults; set override variables only for migrations.
- Keep subscription, resource group, expected counts, and apply flags in operator profiles. Never
  deploy them as Function App settings.
- Use managed/workload identity for hosted Table and Graph access. Never move a client secret into
  the scheduled scanner, Report API, or Configuration Admin Function settings.
- Keep Report API and Configuration Admin identities separate. A local env profile is not an RBAC
  boundary; Azure roles remain the enforcement boundary.
