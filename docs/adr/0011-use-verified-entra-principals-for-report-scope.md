# ADR 0011: Use verified Entra principals for report scope

Status: Superseded by ADR 0013

The production report derives identity only from the verified single-tenant Entra session. URL
parameters may filter an already-authorized report, but `user`, `capability`, and demo scenario
parameters are ignored in Azure API mode. `ReportViewer` or `ReportAdmin` grants application
capability; neither role grants data scope by itself.

The Sites server bridge sends the verified UPN, user object ID, group object IDs, and capability to
the function-key protected report API. The browser cannot set these headers or read the Function
key. The Report API retains the explicit pilot UPN allowlist as a second gate, constructs a
`GovernancePrincipalContext`, resolves active user/group assignments and descendants, and only then
reads cached inventory. This remains a bounded pilot workload boundary; replace the Function key
with workload identity before production completion.

Business groups are selected in the ReportAdmin workspace through a server-side Microsoft Graph
picker. It requests delegated `GroupMember.Read.All` only when
`ENTRA_AUTH_GROUP_PICKER_ENABLED=true`, stores the short-lived Graph access token in a separate
encrypted HttpOnly cookie, searches security groups only, and persists the immutable group object
ID plus a display label. The Graph credential is never returned to browser JavaScript or forwarded
to the Configuration Admin API.

Configure the Entra group claim as `ApplicationGroup` and assign only relevant security groups to
the enterprise application. This limits token size and keeps unrelated tenant groups out of the
session. The application detects `hasgroups` and `_claim_names.groups`; an overage fails closed
instead of silently treating the user as having no business groups. Direct membership is required
for `ApplicationGroup` claims, so nested membership is not part of this authorization contract.

Enable the picker only after a tenant administrator grants delegated `GroupMember.Read.All` admin
consent. Disabling the feature removes the Graph scope from new login requests and leaves existing
stored assignments usable. Rotating the Entra session secret invalidates both application sessions
and protected Graph-token cookies.
