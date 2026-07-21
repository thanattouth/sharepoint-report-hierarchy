import type { SensitivityInventoryItem } from "@/src/domain/types";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  EntraAuthorizationError,
  hasReportAdminRole,
  readOptionalEntraSession,
  requireReportViewer,
} from "@/src/auth/entra";
import {
  getDemoOptions,
  getReportMode,
  loadReportPage,
  type RawSearchParams,
} from "@/src/report/data-access";
import {
  ReportAuthorizationError,
} from "@/src/report/report-service";
import { RunNowButton } from "./run-now-button";

const SITE_PAGE_SIZE = 8;

const siteScanLabels = {
  current: "Current",
  stale: "Stale",
  attention: "Attention",
  "never-scanned": "Awaiting scan",
};

const statusLabels = {
  success: "สำเร็จ",
  "no-label": "ไม่มี Label",
  unsupported: "ไม่รองรับ",
  locked: "ถูกล็อก",
  throttled: "Throttled",
  failed: "ล้มเหลว",
};

function getSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function makeHref(params: RawSearchParams, updates: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = getSingle(raw);
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

function formatDate(value?: string) {
  if (!value) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: SensitivityInventoryItem["scanStatus"] }) {
  return <span className={`status-badge status-${status}`}>{statusLabels[status]}</span>;
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  const rawParams = (await searchParams) ?? {};
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get("cookie");
  const reportMode = getReportMode();
  let entraSession = await readOptionalEntraSession(cookieHeader);
  if (reportMode === "azure-api") {
    try {
      entraSession = await requireReportViewer(cookieHeader);
    } catch (error) {
      if (error instanceof EntraAuthorizationError && error.status === 401) {
        redirect("/api/auth/entra/login?returnTo=/");
      }
      if (error instanceof EntraAuthorizationError) {
        redirect(`/auth/denied?reason=${encodeURIComponent(error.code)}`);
      }
      throw error;
    }
  }
  const params = reportMode === "azure-api"
    ? Object.fromEntries(Object.entries(rawParams).filter(([name]) => !["user", "capability", "scenario"].includes(name)))
    : rawParams;
  const canManageSiteMappings = entraSession ? hasReportAdminRole(entraSession) : false;
  const personas = reportMode === "azure-api" ? [] : await getDemoOptions();
  const selectedUser = reportMode === "azure-api"
    ? entraSession!.userPrincipalName
    : getSingle(params.user) ?? personas[0].upn;
  const capability = reportMode === "azure-api"
    ? (hasReportAdminRole(entraSession!) ? "ReportAdmin" : "ReportViewer")
    : getSingle(params.capability) === "ReportViewer" ? "ReportViewer" : "ReportAdmin";
  const scenario = getSingle(params.scenario) ?? "current";
  const persona = reportMode === "azure-api" ? {
    upn: entraSession!.userPrincipalName,
    name: entraSession!.displayName,
    initials: entraSession!.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((value) => value[0]).join("").toLocaleUpperCase() || "U",
    role: capability,
  } : personas.find((candidate) => candidate.upn === selectedUser) ?? personas[0];
  let report = null;
  let loadError: "denied" | "cache" | null = null;
  try {
    report = await loadReportPage(params, reportMode === "azure-api" ? {
      tenantId: entraSession!.tenantId,
      userUpn: entraSession!.userPrincipalName,
      userObjectId: entraSession!.principalObjectId,
      groupObjectIds: entraSession!.groupObjectIds,
      capability,
    } : undefined);
  } catch (error) {
    console.error({
      event: "report-page-load-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : "Unknown report error",
    });
    loadError = error instanceof ReportAuthorizationError ? "denied" : "cache";
  }

  const preserved = reportMode === "azure-api" ? {} : {
    user: selectedUser,
    capability,
    scenario: reportMode === "fixture" ? scenario : "current",
  };
  const exportParams = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = getSingle(raw);
    if (value && key !== "page") exportParams.set(key, value);
  }
  if (reportMode !== "azure-api") {
    exportParams.set("user", selectedUser);
    exportParams.set("capability", capability);
  }

  const hierarchy = report?.hierarchyRollups ?? [];
  const hierarchyById = new Map(hierarchy.map((node) => [node.nodeId, node]));
  const assignedScopes = (report?.assignedNodeIds ?? []).flatMap((nodeId) => {
    const node = hierarchyById.get(nodeId);
    return node ? [node] : [];
  });
  const resolvedScopeName = assignedScopes.length === 1
    ? assignedScopes[0].name
    : `${assignedScopes.length.toLocaleString("en-US")} assigned scopes`;
  const resolvedScopeType = assignedScopes.length === 1
    ? assignedScopes[0].type
    : "MULTIPLE ASSIGNMENTS";
  const selectedNode = report?.options.nodes.find((node) => node.id === getSingle(params.node));
  const siteSearch = getSingle(params.siteQ)?.trim() ?? "";
  const normalizedSiteSearch = siteSearch.toLocaleLowerCase();
  const siteCandidates = (report?.siteRollups ?? []).filter((site) =>
    !normalizedSiteSearch || [site.siteName, site.siteId, site.nodeName].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSiteSearch),
    ),
  );
  const requestedSitePage = Math.max(Number(getSingle(params.sitePage) ?? "1") || 1, 1);
  const sitePageCount = Math.max(Math.ceil(siteCandidates.length / SITE_PAGE_SIZE), 1);
  const sitePage = Math.min(requestedSitePage, sitePageCount);
  const visibleSites = siteCandidates.slice(
    (sitePage - 1) * SITE_PAGE_SIZE,
    sitePage * SITE_PAGE_SIZE,
  );
  const selectedSite = report?.options.sites.find((site) => site.id === getSingle(params.site));

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Sensitivity Report home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <strong>Sensitivity Report</strong>
            <small>SharePoint Governance</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="เมนูหลัก">
          <a className="nav-item active" href="#overview">Overview</a>
          <a className="nav-item" href="#sites">Sites</a>
          <a className="nav-item" href="#inventory">File inventory</a>
          <a className="nav-item" href="#scan-status">Scan status</a>
          {canManageSiteMappings
            ? <Link className="nav-item" href="/admin/site-mappings">Site mappings</Link>
            : <Link className="nav-item" href="/api/auth/entra/login?returnTo=/admin/site-mappings">Admin sign in</Link>}
        </nav>

        <div className="topbar-right">
          <span className={`freshness-pill freshness-${report?.freshness ?? "unknown"}`}>
            <i aria-hidden="true" /> {report?.freshness === "stale" ? "Scheduled cache ล้าสมัย" : report?.freshness === "partial" ? "Scheduled scan ไม่สมบูรณ์" : "Scheduled cache"}
          </span>
          <div className="identity">
            <span className="avatar">{persona.initials}</span>
            <span><strong>{persona.name}</strong><small>{report?.capability ?? capability}</small></span>
          </div>
          {entraSession ? <form className="logout-form" method="post" action="/api/auth/entra/logout"><button className="admin-sign-out" type="submit">Sign out</button></form> : null}
        </div>
      </header>

      <div className="workspace">

        <main id="overview">
          <section className="page-heading">
            <div>
              <p className="eyebrow">MICROSOFT PURVIEW · SHAREPOINT</p>
              <h1>Sensitive file exposure</h1>
              <p>ติดตาม Sensitivity Label จาก scheduled inventory ภายใน business scope ที่คุณรับผิดชอบ</p>
            </div>
            <div className="heading-actions">
              {reportMode !== "azure-api" && report?.capability === "ReportAdmin" && !["no-assignment", "no-sites"].includes(report.state) ? (
                <a className="button button-secondary" href={`/export?${exportParams.toString()}`}>⇩ Export CSV</a>
              ) : (
                <button className="button button-secondary" disabled title="ต้องใช้ ReportAdmin">⇩ Export CSV</button>
              )}
              <RunNowButton userUpn={selectedUser} capability={capability} disabled={reportMode !== "fixture" || !report || ["no-assignment", "no-sites"].includes(report.state)} />
            </div>
          </section>

          {reportMode !== "azure-api" ? <section className="demo-panel" aria-labelledby="demo-heading">
            <div className="demo-copy">
              <span className="demo-dot" aria-hidden="true" />
              <div><strong id="demo-heading">{reportMode === "azure-table" ? "Azure cache pilot" : "Deterministic demo mode"}</strong><small>{reportMode === "azure-table" ? "ข้อมูลไฟล์มาจาก scheduled Azure Table cache · persona ยังใช้พิสูจน์ hierarchy scope" : "สลับ persona และ scan state เพื่อทดสอบ authorization"}</small></div>
            </div>
            <form className="demo-controls" method="get">
              <label>UPN
                <select name="user" defaultValue={selectedUser}>
                  {personas.map((item) => <option key={item.upn} value={item.upn}>{item.name} — {item.role}</option>)}
                </select>
              </label>
              <label>App role
                <select name="capability" defaultValue={capability}>
                  <option value="ReportAdmin">ReportAdmin</option>
                  <option value="ReportViewer">ReportViewer</option>
                </select>
              </label>
              {reportMode === "fixture" ? <label>Scan state
                <select name="scenario" defaultValue={scenario}>
                  <option value="current">Current</option>
                  <option value="partial">Partial</option>
                  <option value="stale">Stale</option>
                  <option value="no-scan">No completed scan</option>
                  <option value="cache-error">Cache unavailable</option>
                </select>
              </label> : <input type="hidden" name="scenario" value="current" />}
              <button className="button button-demo" type="submit">Apply persona</button>
            </form>
          </section> : null}

          {loadError ? (
            <section className="empty-state critical" role="alert">
              <span className="empty-icon">!</span>
              <div><p className="eyebrow">FAIL CLOSED</p><h2>{loadError === "denied" ? "ไม่มีสิทธิ์เข้าถึง scope นี้" : "ไม่สามารถอ่าน cached inventory"}</h2><p>ระบบไม่ส่ง aggregate, file rows หรือ export เมื่อไม่สามารถยืนยัน scope ได้ กรุณาลองใหม่หรือติดต่อ ReportAdmin</p></div>
            </section>
          ) : report?.state === "no-assignment" ? (
            <section className="empty-state" role="status">
              <span className="empty-icon">○</span>
              <div><p className="eyebrow">NO ACTIVE ASSIGNMENT</p><h2>บัญชีนี้ยังไม่มี hierarchy scope</h2><p>แม้มี app role ระบบจะไม่แสดง inventory จนกว่าจะมี active assignment ที่ถูกต้อง</p></div>
            </section>
          ) : report?.state === "no-sites" ? (
            <section className="empty-state" role="status">
              <span className="empty-icon">○</span>
              <div><p className="eyebrow">NO MAPPED SITES</p><h2>มี business scope แต่ยังไม่มี SharePoint Site mapping</h2><p>Hierarchy ระบุขอบเขตการมองเห็นเท่านั้น Site ต้องถูกผูกผ่าน mapping แยกก่อนจึงจะแสดง scheduled inventory</p></div>
            </section>
          ) : report?.state === "no-scan" ? (
            <section className="empty-state" role="status">
              <span className="empty-icon">◷</span>
              <div><p className="eyebrow">AWAITING BASELINE</p><h2>Scope พร้อมแล้ว แต่ยังไม่มี completed scan</h2><p>Report จะอ่านเฉพาะ cached inventory และจะไม่ scan SharePoint ระหว่างเปิดหน้านี้</p></div>
            </section>
          ) : report ? (
            <>
              {report.freshness === "partial" || report.freshness === "stale" ? (
                <section className={`warning-banner ${report.freshness}`} role="status">
                  <span aria-hidden="true">{report.freshness === "partial" ? "△" : "◷"}</span>
                  <div><strong>{report.freshness === "partial" ? "รอบล่าสุดเสร็จเพียงบางส่วน" : "Cached inventory เกิน freshness threshold"}</strong><p>{report.freshness === "partial" ? `${report.latestRun?.errorSummary ?? "มีบางรายการที่ scan ไม่สำเร็จ"} — ตัวเลขอาจยังไม่ครบถ้วน` : `Last successful scan: ${formatDate(report.lastSuccessfulScan)}`}</p></div>
                </section>
              ) : null}

              <section className="metric-grid" aria-label="สรุป Sensitive file exposure">
                <article className="metric-card metric-primary">
                  <div className="metric-top"><span className="metric-icon">S</span><span className="trend">IN SCOPE</span></div>
                  <strong>{report.scopeSensitiveCount.toLocaleString("th-TH")}</strong>
                  <p>Sensitive files</p><small>Confidential, Secret และ configured labels</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon neutral">▦</span><span className="subtle">ACTIVE</span></div>
                  <strong>{report.siteCount}</strong><p>SharePoint sites</p><small>{report.libraryCount} document libraries</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon neutral">◷</span><span className="subtle">SCHEDULED CACHE</span></div>
                  <strong className="date-value">{formatDate(report.lastSuccessfulScan).split(" ").slice(0, 3).join(" ")}</strong><p>Last scheduled scan</p><small>Next: {formatDate(report.nextScheduledScan)}</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon warning">△</span><span className="subtle">OUTCOMES</span></div>
                  <strong>{report.statusCounts.locked + report.statusCounts.failed + report.statusCounts.throttled}</strong><p>Need attention</p><small>{report.statusCounts.unsupported} unsupported · {report.statusCounts["no-label"]} no-label</small>
                </article>
              </section>

              {report.state === "zero-sensitive" ? (
                <section className="empty-state success-state" role="status">
                  <span className="empty-icon">✓</span>
                  <div><p className="eyebrow">COMPLETED SCAN</p><h2>ไม่พบ Sensitive file ใน scope นี้</h2><p>Completed inventory มี {Object.values(report.statusCounts).reduce((sum, count) => sum + count, 0)} รายการ และไม่พบ configured reportable label ID</p></div>
                </section>
              ) : null}
                <>
                  <section className="scope-site-stack">
                    <section className="resolved-scope" aria-labelledby="resolved-scope-heading">
                      <div className="resolved-scope-main">
                        <span className="resolved-scope-mark" aria-hidden="true">{resolvedScopeType.slice(0, 1)}</span>
                        <div>
                          <p className="eyebrow">{reportMode === "fixture" ? "RESOLVED DEMO SCOPE" : "RESOLVED PILOT SCOPE"}</p>
                          <h2 id="resolved-scope-heading">{resolvedScopeName}</h2>
                          <p>{resolvedScopeType} assignment รวม Sites ที่ map กับ node นี้และ descendants โดย server</p>
                        </div>
                      </div>
                      <div className="scope-route" aria-label={`เส้นทางสิทธิ์ ${persona.role} ไปยัง ${report.siteCount} SharePoint Sites`}>
                        <span>{persona.role}</span><i aria-hidden="true">→</i><strong>{resolvedScopeName}</strong><i aria-hidden="true">→</i><span>{report.siteCount.toLocaleString("en-US")} Sites</span>
                      </div>
                      <dl>
                        <div><dt>VISIBLE NODES</dt><dd>{report.visibleNodeIds.length.toLocaleString("en-US")}</dd></div>
                        <div><dt>VISIBLE SITES</dt><dd>{report.siteCount.toLocaleString("en-US")}</dd></div>
                        <div><dt>SENSITIVE FILES</dt><dd>{report.scopeSensitiveCount.toLocaleString("en-US")}</dd></div>
                      </dl>
                      <span className="resolved-badge"><i aria-hidden="true" /> SERVER RESOLVED</span>
                    </section>

                    <article className="panel site-explorer" id="sites">
                      <div className="panel-heading"><div><p className="eyebrow">AUTHORIZED SHAREPOINT INVENTORY</p><h2>Site explorer</h2><p>ค้นหา Site ที่ server resolve จาก business scope โดยไม่แสดงเป็น hierarchy tree</p></div><span className="panel-kicker">{report.siteRollups.length.toLocaleString("en-US")} visible</span></div>
                      <form className="site-search" method="get" action="/#sites" role="search">
                        {Object.entries(params).filter(([name]) => !["site", "siteQ", "sitePage", "page"].includes(name)).map(([name, raw]) => {
                          const value = getSingle(raw);
                          return value ? <input key={name} type="hidden" name={name} value={value} /> : null;
                        })}
                        <label><span aria-hidden="true">⌕</span><input name="siteQ" defaultValue={siteSearch} placeholder="ค้นหาชื่อ Site, Site ID หรือหน่วยงาน" aria-label="ค้นหา SharePoint Site" /></label>
                        <button className="button site-search-button" type="submit">ค้นหา</button>
                        {siteSearch ? <a className="site-search-clear" href={makeHref(params, { siteQ: undefined, sitePage: undefined })}>ล้าง</a> : null}
                      </form>
                      {selectedNode ? <div className="site-filter-notice"><span>FILTERED BUSINESS BRANCH</span><strong>{selectedNode.name}</strong><a href={makeHref(params, { node: undefined, site: undefined, sitePage: undefined, page: undefined })}>ล้าง branch filter</a></div> : null}
                      <div className="site-columns" aria-hidden="true"><span>SITE</span><span>BUSINESS MAPPING</span><span>LAST SCANNED</span><span>STATE</span><span>FILES</span></div>
                      <div className="site-list" aria-label="SharePoint Sites ที่มองเห็นได้">
                        {visibleSites.map((site) => (
                          <a className={`site-row ${getSingle(params.site) === site.siteId ? "selected" : ""}`} href={makeHref(params, { site: site.siteId, siteQ: undefined, sitePage: undefined, page: undefined })} key={site.siteId}>
                            <span className="site-mark" aria-hidden="true">SP</span>
                            <span className="site-copy"><strong>{site.siteName}</strong><small>{site.siteId}</small></span>
                            <span className="site-meta"><small>BUSINESS MAPPING</small><strong>{site.nodeName}</strong></span>
                            <span className="site-meta"><small>LAST SCANNED</small><strong>{formatDate(site.lastScannedAt)}</strong></span>
                            <span className={`site-scan-state scan-${site.scanState}`}>{siteScanLabels[site.scanState]}</span>
                            <span className="site-count"><strong>{site.count.toLocaleString("en-US")}</strong><small>Sensitive</small></span>
                          </a>
                        ))}
                        {visibleSites.length === 0 ? <div className="site-no-results"><strong>ไม่พบ SharePoint Site ที่ค้นหา</strong><p>ลองค้นหาด้วยชื่อ Site, Site ID หรือชื่อหน่วยงานอื่น</p></div> : null}
                      </div>
                      {sitePageCount > 1 ? <div className="site-pagination"><span>หน้า {sitePage} จาก {sitePageCount}</span><div><a className={sitePage <= 1 ? "disabled" : ""} aria-disabled={sitePage <= 1} href={makeHref(params, { sitePage: String(Math.max(sitePage - 1, 1)) })}>← ก่อนหน้า</a><a className={sitePage >= sitePageCount ? "disabled" : ""} aria-disabled={sitePage >= sitePageCount} href={makeHref(params, { sitePage: String(Math.min(sitePage + 1, sitePageCount)) })}>ถัดไป →</a></div></div> : null}
                      <div className="site-explorer-footnote"><span>Site inventory ไม่มี hierarchy ใน SharePoint</span><strong>Visibility มาจาก business mapping</strong></div>
                    </article>
                  </section>

                  <section className="panel inventory-panel" id="inventory">
                    <div className="panel-heading inventory-heading"><div><p className="eyebrow">FILE-LEVEL INVENTORY</p><h2>Sensitive files</h2><p>{report.filteredSensitiveCount} จาก {report.scopeSensitiveCount} files ภายใน resolved scope</p></div><span className="scope-stamp">SERVER FILTERED</span></div>
                    <form className="filter-bar" method="get" aria-label="ตัวกรอง file inventory">
                      {Object.entries(preserved).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
                      <label className="search-field"><span aria-hidden="true">⌕</span><input name="q" defaultValue={getSingle(params.q)} placeholder="ค้นหาชื่อไฟล์หรือ path" aria-label="ค้นหาชื่อไฟล์หรือ path" /></label>
                      <label><span className="sr-only">Hierarchy node</span><select name="node" defaultValue={getSingle(params.node) ?? ""}><option value="">ทุก hierarchy node</option>{report.options.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                      <div className="site-filter-control" role="group" aria-label="Site filter">
                        {selectedSite ? <input type="hidden" name="site" value={selectedSite.id} /> : null}
                        <span>SITE</span><strong>{selectedSite?.name ?? "ทุก Site ใน scope"}</strong><a href={selectedSite ? makeHref(params, { site: undefined, page: undefined }) : "#sites"}>{selectedSite ? "ล้าง" : "เลือก"}</a>
                      </div>
                      <label><span className="sr-only">Library</span><select name="library" defaultValue={getSingle(params.library) ?? ""}><option value="">ทุก library</option>{report.options.libraries.map((library) => <option key={library} value={library}>{library}</option>)}</select></label>
                      <label><span className="sr-only">Sensitivity label</span><select name="label" defaultValue={getSingle(params.label) ?? ""}><option value="">ทุก label</option>{report.options.labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
                      <label><span className="sr-only">Scan status</span><select name="status" defaultValue={getSingle(params.status) ?? ""}><option value="">ทุก status</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                      <label><span className="sr-only">Freshness</span><select name="freshness" defaultValue={getSingle(params.freshness) ?? ""}><option value="">ทุก freshness</option><option value="current">Current ≤ 24h</option><option value="stale">Stale &gt; 24h</option></select></label>
                      <button className="button filter-button" type="submit">กรองข้อมูล</button>
                      <a className="clear-link" href={makeHref({}, preserved)}>ล้าง</a>
                    </form>

                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>FILE</th><th>SITE / LIBRARY</th><th>LABEL</th><th>SCAN STATUS</th><th>LAST SCANNED</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead>
                        <tbody>
                          {report.rows.map((item) => {
                            const label = item.sensitivityLabels[0];
                            return <tr key={`${item.siteId}:${item.driveId}:${item.itemId}`}>
                              <td><span className="file-cell"><span className="file-type">{item.fileName.split(".").pop()?.slice(0, 3).toUpperCase()}</span><span><strong>{item.fileName}</strong><small>{item.filePath}</small></span></span></td>
                              <td><strong>{item.siteName}</strong><small>{item.libraryName}</small></td>
                              <td><span className="sensitivity-label"><i />{label?.displayName ?? "Sensitive"}</span><small>{label?.assignmentMethod ?? "unknown"}</small></td>
                              <td><StatusBadge status={item.scanStatus} />{item.errorCode ? <small>Error {item.errorCode}</small> : null}</td>
                              <td><strong>{formatDate(item.scannedAt)}</strong><small>{item.modifiedAt ? `Modified ${formatDate(item.modifiedAt)}` : ""}</small></td>
                              <td><details className="row-details"><summary aria-label={`ดูรายละเอียด ${item.fileName}`}>•••</summary><div><b>Stable identity</b><code>{item.siteId}:{item.driveId}:{item.itemId}</code><b>Label ID</b><code>{label?.id}</code>{item.errorMessage ? <p>{item.errorMessage}</p> : null}</div></details></td>
                            </tr>;
                          })}
                          {report.rows.length === 0 ? <tr><td colSpan={6} className="no-results">{report.detailsRequireSiteSelection ? "เลือก SharePoint Site ที่ได้รับอนุญาตจาก Site explorer ก่อนโหลด file-level inventory" : "ไม่พบ Sensitive file ที่ตรงกับ filters ปัจจุบัน"}</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination"><span>หน้า {report.page} จาก {report.pageCount}</span><div><a className={report.page <= 1 ? "disabled" : ""} aria-disabled={report.page <= 1} href={makeHref(params, { page: String(Math.max(report.page - 1, 1)) })}>← ก่อนหน้า</a><a className={report.page >= report.pageCount ? "disabled" : ""} aria-disabled={report.page >= report.pageCount} href={makeHref(params, { page: String(Math.min(report.page + 1, report.pageCount)) })}>ถัดไป →</a></div></div>
                  </section>
                </>

              <section className="panel scan-panel" id="scan-status">
                <div className="panel-heading"><div><p className="eyebrow">SCHEDULED CACHE HEALTH</p><h2>Latest scheduled scan</h2><p>Scanner ทำงานตามรอบและเขียน inventory ล่วงหน้า หน้า Report ไม่เรียก Microsoft Graph</p></div><span className={`run-status run-${report.latestRun?.status ?? "unknown"}`}>{report.latestRun?.status ?? "unknown"}</span></div>
                <div className="run-grid">
                  <div><small>RUN ID</small><strong>{report.latestRun?.id ?? "—"}</strong></div><div><small>TRIGGER</small><strong>{report.latestRun?.trigger ?? "—"}</strong></div><div><small>SCANNED</small><strong>{report.latestRun?.scannedCount ?? 0}</strong></div><div><small>CHANGED</small><strong>{report.latestRun?.changedCount ?? 0}</strong></div><div><small>LOCKED</small><strong>{report.latestRun?.lockedCount ?? 0}</strong></div><div><small>FAILED</small><strong>{report.latestRun?.failedCount ?? 0}</strong></div>
                </div>
                <p className="scan-footnote">Nightly incremental + controlled reconciliation · Site หนึ่งถูก scan ครั้งเดียวต่อรอบ ไม่ scan ซ้ำตาม EVP หรือผู้ใช้ · Run now สร้าง queued job เท่านั้น</p>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
