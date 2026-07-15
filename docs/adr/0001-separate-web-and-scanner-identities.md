# ADR 0001: Separate report web and scanner identities

Status: Accepted

The report web application and scheduled scanner are separate deployment and
security boundaries. The web application represents an interactive user and
resolves hierarchy scope before reading cached inventory. The scanner is a
background workload that may later receive approved Microsoft Graph
application permissions.

No scanner credential, app-only token, tenant identifier, site allowlist, or
production label ID may be exposed through browser code or `NEXT_PUBLIC_*`
configuration. Prototype P0–P3 uses deterministic fixtures and store contracts
only; real Graph permissions are deferred until the P4 review checkpoint.

The report cache reader is also a separate workload identity. It receives only
`Storage Table Data Reader` on the isolated cache and never receives scanner Graph
permissions or Table write access. Browser code never receives Azure Storage tokens;
cache reads occur behind the server-side report boundary after hierarchy scope has
been resolved. See ADR 0006 for the hosting consequence.
