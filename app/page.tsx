import type { SensitivityInventoryItem } from "@/src/domain/types";
import Link from "next/link";
import {
  getDemoOptions,
  loadReportPage,
  type RawSearchParams,
} from "@/src/report/data-access";
import {
  ReportAuthorizationError,
  type ReportData,
} from "@/src/report/report-service";
import { RunNowButton } from "./run-now-button";

type HierarchyRollup = ReportData["hierarchyRollups"][number];
const SCOPE_PAGE_SIZE = 6;

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

function hierarchyPath(
  node: HierarchyRollup,
  byId: Map<string, HierarchyRollup>,
): HierarchyRollup[] {
  const path: HierarchyRollup[] = [];
  const seen = new Set<string>();
  let current: HierarchyRollup | undefined = node;
  while (current && !seen.has(current.nodeId)) {
    path.unshift(current);
    seen.add(current.nodeId);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function isDescendantOf(
  node: HierarchyRollup,
  ancestorId: string,
  byId: Map<string, HierarchyRollup>,
): boolean {
  let current: HierarchyRollup | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.nodeId)) {
    if (current.nodeId === ancestorId) return true;
    seen.add(current.nodeId);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

function StatusBadge({ status }: { status: SensitivityInventoryItem["scanStatus"] }) {
  return <span className={`status-badge status-${status}`}>{statusLabels[status]}</span>;
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<RawSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const personas = await getDemoOptions();
  const selectedUser = getSingle(params.user) ?? personas[0].upn;
  const capability = getSingle(params.capability) === "ReportViewer" ? "ReportViewer" : "ReportAdmin";
  const scenario = getSingle(params.scenario) ?? "current";
  const persona = personas.find((candidate) => candidate.upn === selectedUser) ?? personas[0];
  let report = null;
  let loadError: "denied" | "cache" | null = null;
  try {
    report = await loadReportPage(params);
  } catch (error) {
    loadError = error instanceof ReportAuthorizationError ? "denied" : "cache";
  }

  const preserved = {
    user: selectedUser,
    capability,
    scenario,
  };
  const exportParams = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = getSingle(raw);
    if (value && key !== "page") exportParams.set(key, value);
  }
  exportParams.set("user", selectedUser);
  exportParams.set("capability", capability);

  const hierarchy = report?.hierarchyRollups ?? [];
  const hierarchyById = new Map(hierarchy.map((node) => [node.nodeId, node]));
  const assignedRoots = (report?.assignedNodeIds ?? [])
    .map((nodeId) => hierarchyById.get(nodeId))
    .filter((node): node is HierarchyRollup => Boolean(node));
  const requestedScopeId = getSingle(params.scope) ?? getSingle(params.node);
  const requestedScope = requestedScopeId ? hierarchyById.get(requestedScopeId) : undefined;
  const activeScope = requestedScope ?? (assignedRoots.length === 1 ? assignedRoots[0] : undefined);
  const scopeSearch = getSingle(params.scopeQ)?.trim() ?? "";
  const normalizedScopeSearch = scopeSearch.toLocaleLowerCase();
  const nextLevelNodes = activeScope
    ? hierarchy.filter((node) => node.parentId === activeScope.nodeId)
    : assignedRoots;
  const scopeCandidates = normalizedScopeSearch
    ? hierarchy.filter((node) => {
        const isInsideScope = activeScope
          ? node.nodeId !== activeScope.nodeId && isDescendantOf(node, activeScope.nodeId, hierarchyById)
          : assignedRoots.some((root) => isDescendantOf(node, root.nodeId, hierarchyById));
        return isInsideScope && [node.name, node.type].some((value) =>
          value.toLocaleLowerCase().includes(normalizedScopeSearch),
        );
      })
    : nextLevelNodes;
  const requestedScopePage = Math.max(Number(getSingle(params.scopePage) ?? "1") || 1, 1);
  const scopePageCount = Math.max(Math.ceil(scopeCandidates.length / SCOPE_PAGE_SIZE), 1);
  const scopePage = Math.min(requestedScopePage, scopePageCount);
  const visibleScopeNodes = scopeCandidates.slice(
    (scopePage - 1) * SCOPE_PAGE_SIZE,
    scopePage * SCOPE_PAGE_SIZE,
  );
  const scopeBreadcrumb = activeScope ? hierarchyPath(activeScope, hierarchyById) : [];
  const scopeSecretCount = activeScope?.count ?? report?.scopeSecretCount ?? 0;
  const scopeSiteCount = activeScope?.siteCount ?? report?.siteCount ?? 0;

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
          <a className="nav-item" href="#hierarchy">Hierarchy</a>
          <a className="nav-item" href="#inventory">File inventory</a>
          <a className="nav-item" href="#scan-status">Scan status</a>
        </nav>

        <div className="topbar-right">
          <span className={`freshness-pill freshness-${report?.freshness ?? "unknown"}`}>
            <i aria-hidden="true" /> {report?.freshness === "stale" ? "ข้อมูลล้าสมัย" : report?.freshness === "partial" ? "ข้อมูลไม่สมบูรณ์" : "Cached inventory"}
          </span>
          <div className="identity">
            <span className="avatar">{persona.initials}</span>
            <span><strong>{persona.name}</strong><small>{capability}</small></span>
          </div>
        </div>
      </header>

      <div className="workspace">

        <main id="overview">
          <section className="page-heading">
            <div>
              <p className="eyebrow">MICROSOFT PURVIEW · SHAREPOINT</p>
              <h1>Secret file exposure</h1>
              <p>ติดตามไฟล์ที่มี Sensitivity Label ภายใน hierarchy scope ที่คุณรับผิดชอบ</p>
            </div>
            <div className="heading-actions">
              {report?.capability === "ReportAdmin" && report.state !== "no-assignment" ? (
                <a className="button button-secondary" href={`/export?${exportParams.toString()}`}>⇩ Export CSV</a>
              ) : (
                <button className="button button-secondary" disabled title="ต้องใช้ ReportAdmin">⇩ Export CSV</button>
              )}
              <RunNowButton userUpn={selectedUser} capability={capability} disabled={!report || report.state === "no-assignment"} />
            </div>
          </section>

          <section className="demo-panel" aria-labelledby="demo-heading">
            <div className="demo-copy">
              <span className="demo-dot" aria-hidden="true" />
              <div><strong id="demo-heading">Deterministic demo mode</strong><small>สลับ persona และ scan state เพื่อทดสอบ authorization</small></div>
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
              <label>Scan state
                <select name="scenario" defaultValue={scenario}>
                  <option value="current">Current</option>
                  <option value="partial">Partial</option>
                  <option value="stale">Stale</option>
                  <option value="no-scan">No completed scan</option>
                  <option value="cache-error">Cache unavailable</option>
                </select>
              </label>
              <button className="button button-demo" type="submit">Apply persona</button>
            </form>
          </section>

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

              <section className="metric-grid" aria-label="สรุป Secret file exposure">
                <article className="metric-card metric-primary">
                  <div className="metric-top"><span className="metric-icon">S</span><span className="trend">IN SCOPE</span></div>
                  <strong>{report.scopeSecretCount.toLocaleString("th-TH")}</strong>
                  <p>Secret files</p><small>Distinct active files จาก label ID</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon neutral">▦</span><span className="subtle">ACTIVE</span></div>
                  <strong>{report.siteCount}</strong><p>SharePoint sites</p><small>{report.libraryCount} document libraries</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon neutral">✓</span><span className="subtle">CACHE</span></div>
                  <strong className="date-value">{formatDate(report.lastSuccessfulScan).split(" ").slice(0, 3).join(" ")}</strong><p>Last successful scan</p><small>Next: {formatDate(report.nextScheduledScan)}</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span className="metric-icon warning">△</span><span className="subtle">OUTCOMES</span></div>
                  <strong>{report.statusCounts.locked + report.statusCounts.failed + report.statusCounts.throttled}</strong><p>Need attention</p><small>{report.statusCounts.unsupported} unsupported · {report.statusCounts["no-label"]} no-label</small>
                </article>
              </section>

              {report.state === "zero-secret" ? (
                <section className="empty-state success-state" role="status">
                  <span className="empty-icon">✓</span>
                  <div><p className="eyebrow">COMPLETED SCAN</p><h2>ไม่พบ Secret file ใน scope นี้</h2><p>Completed inventory มี {Object.values(report.statusCounts).reduce((sum, count) => sum + count, 0)} รายการ และไม่พบ configured Secret label ID</p></div>
                </section>
              ) : (
                <>
                  <section className="insight-grid">
                    <article className="panel scope-explorer" id="hierarchy">
                      <div className="panel-heading"><div><p className="eyebrow">BUSINESS SCOPE</p><h2>Scope navigator</h2><p>เปิดดูทีละระดับแทนการแสดง {report.visibleNodeIds.length.toLocaleString("en-US")} nodes พร้อมกัน</p></div><span className="panel-kicker">{scopeSiteCount.toLocaleString("en-US")} sites</span></div>
                      <div className="scope-toolbar">
                        <nav className="scope-breadcrumb" aria-label="ตำแหน่งปัจจุบันใน hierarchy">
                          {activeScope && assignedRoots.length > 1 ? <a href={makeHref(params, { scope: undefined, node: undefined, site: undefined, scopeQ: undefined, scopePage: undefined, page: undefined })}>Assigned scope</a> : null}
                          {scopeBreadcrumb.map((node, index) => (
                            <span key={node.nodeId}>
                              {index > 0 || assignedRoots.length > 1 ? <i aria-hidden="true">/</i> : null}
                              {index === scopeBreadcrumb.length - 1 ? <strong aria-current="page">{node.name}</strong> : <a href={makeHref(params, { scope: node.nodeId, node: node.nodeId, site: undefined, scopeQ: undefined, scopePage: undefined, page: undefined })}>{node.name}</a>}
                            </span>
                          ))}
                          {!activeScope ? <strong aria-current="page">Assigned scope</strong> : null}
                        </nav>
                        <form className="scope-search" method="get" action="/#hierarchy" role="search">
                          {Object.entries(params).filter(([name]) => !["scopeQ", "scopePage", "page"].includes(name)).map(([name, raw]) => {
                            const value = getSingle(raw);
                            return value ? <input key={name} type="hidden" name={name} value={value} /> : null;
                          })}
                          <label><span aria-hidden="true">⌕</span><input name="scopeQ" defaultValue={scopeSearch} placeholder="ค้นหา branch หรือ site" aria-label="ค้นหา hierarchy branch หรือ site" /></label>
                          <button className="button scope-search-button" type="submit">ค้นหา</button>
                          {scopeSearch ? <a className="scope-search-clear" href={makeHref(params, { scopeQ: undefined, scopePage: undefined })}>ล้าง</a> : null}
                        </form>
                      </div>

                      <div className="scope-current">
                        <span className={`scope-current-mark type-${(activeScope?.type ?? "scope").toLowerCase()}`} aria-hidden="true">{activeScope?.type.slice(0, 1) ?? "S"}</span>
                        <div className="scope-current-copy"><small>{activeScope?.type ?? "AUTHORIZED SCOPE"}</small><h3>{activeScope?.name ?? "My assigned scope"}</h3><p>เลือก branch ด้านล่างเพื่อกรอง report และลงไปยังระดับถัดไป</p></div>
                        <dl>
                          <div><dt>SECRET FILES</dt><dd>{scopeSecretCount.toLocaleString("en-US")}</dd></div>
                          <div><dt>SITES</dt><dd>{scopeSiteCount.toLocaleString("en-US")}</dd></div>
                          <div><dt>NEXT LEVEL</dt><dd>{nextLevelNodes.length.toLocaleString("en-US")}</dd></div>
                        </dl>
                      </div>

                      <div className="scope-results-heading">
                        <div><p className="eyebrow">{scopeSearch ? "SEARCH RESULTS" : "NEXT LEVEL"}</p><strong>{scopeSearch ? `ผลลัพธ์สำหรับ “${scopeSearch}”` : activeScope ? `ภายใต้ ${activeScope.name}` : "Assigned branches"}</strong></div>
                        <span>{scopeCandidates.length.toLocaleString("en-US")} items</span>
                      </div>
                      <div className="scope-list">
                        {visibleScopeNodes.map((node) => (
                          <a className="scope-row" href={makeHref(params, { scope: node.nodeId, node: node.nodeId, site: undefined, scopeQ: undefined, scopePage: undefined, page: undefined })} key={node.nodeId}>
                            <span className={`node-mark type-${node.type.toLowerCase()}`}>{node.type.slice(0, 1)}</span>
                            <span className="scope-row-copy"><strong>{node.name}</strong><small>{node.type} · {node.siteCount.toLocaleString("en-US")} sites · {node.childCount.toLocaleString("en-US")} sub-scopes</small></span>
                            <span className="scope-row-count"><strong>{node.count.toLocaleString("en-US")}</strong><small>Secret</small></span>
                            <span className="scope-row-arrow" aria-hidden="true">→</span>
                          </a>
                        ))}
                        {visibleScopeNodes.length === 0 ? <div className="scope-no-results"><strong>{scopeSearch ? "ไม่พบ branch หรือ site ที่ค้นหา" : "ถึงระดับปลายสุดของ scope แล้ว"}</strong><p>{scopeSearch ? "ลองค้นหาด้วยชื่อ Department, Group, Project หรือ site อื่น" : "ไฟล์และ site ภายใน scope นี้แสดงในส่วน report ด้านล่าง"}</p></div> : null}
                      </div>
                      {scopePageCount > 1 ? <div className="scope-pagination"><span>หน้า {scopePage} จาก {scopePageCount}</span><div><a className={scopePage <= 1 ? "disabled" : ""} aria-disabled={scopePage <= 1} href={makeHref(params, { scopePage: String(Math.max(scopePage - 1, 1)) })}>← ก่อนหน้า</a><a className={scopePage >= scopePageCount ? "disabled" : ""} aria-disabled={scopePage >= scopePageCount} href={makeHref(params, { scopePage: String(Math.min(scopePage + 1, scopePageCount)) })}>ถัดไป →</a></div></div> : null}
                    </article>

                    <article className="panel">
                      <div className="panel-heading"><div><p className="eyebrow">CONCENTRATION</p><h2>Exposure by site</h2></div><span className="panel-kicker">Filtered view</span></div>
                      <div className="bar-list">
                        {report.siteRollups.map((site) => {
                          const max = Math.max(...report.siteRollups.map((item) => item.count), 1);
                          return <a href={makeHref(params, { site: site.siteId, page: undefined })} className="bar-row" key={site.siteId}>
                            <span className="bar-copy"><strong>{site.siteName}</strong><small>{site.siteId}</small></span>
                            <span className="bar-track"><i style={{ width: `${Math.max((site.count / max) * 100, 8)}%` }} /></span>
                            <b>{site.count}</b>
                          </a>;
                        })}
                        {report.siteRollups.length === 0 ? <p className="muted-message">ไม่มี site ที่ตรงกับ filters ปัจจุบัน</p> : null}
                      </div>
                      <div className="library-summary">
                        <span>TOP LIBRARIES</span>
                        {report.libraryRollups.slice(0, 4).map((library) => <div key={`${library.siteId}:${library.libraryName}`}><strong>{library.libraryName}</strong><small>{library.siteName}</small><b>{library.count}</b></div>)}
                      </div>
                    </article>
                  </section>

                  <section className="panel inventory-panel" id="inventory">
                    <div className="panel-heading inventory-heading"><div><p className="eyebrow">FILE-LEVEL INVENTORY</p><h2>Secret files</h2><p>{report.filteredSecretCount} จาก {report.scopeSecretCount} files ภายใน resolved scope</p></div><span className="scope-stamp">SERVER FILTERED</span></div>
                    <form className="filter-bar" method="get" aria-label="ตัวกรอง file inventory">
                      {Object.entries(preserved).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
                      <label className="search-field"><span aria-hidden="true">⌕</span><input name="q" defaultValue={getSingle(params.q)} placeholder="ค้นหาชื่อไฟล์หรือ path" aria-label="ค้นหาชื่อไฟล์หรือ path" /></label>
                      <label><span className="sr-only">Hierarchy node</span><select name="node" defaultValue={getSingle(params.node) ?? ""}><option value="">ทุก hierarchy node</option>{report.options.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                      <label><span className="sr-only">Site</span><select name="site" defaultValue={getSingle(params.site) ?? ""}><option value="">ทุก site</option>{report.options.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                      <label><span className="sr-only">Library</span><select name="library" defaultValue={getSingle(params.library) ?? ""}><option value="">ทุก library</option>{report.options.libraries.map((library) => <option key={library} value={library}>{library}</option>)}</select></label>
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
                              <td><span className="secret-label"><i />{label?.displayName ?? "Secret"}</span><small>{label?.assignmentMethod ?? "unknown"}</small></td>
                              <td><StatusBadge status={item.scanStatus} />{item.errorCode ? <small>Error {item.errorCode}</small> : null}</td>
                              <td><strong>{formatDate(item.scannedAt)}</strong><small>{item.modifiedAt ? `Modified ${formatDate(item.modifiedAt)}` : ""}</small></td>
                              <td><details className="row-details"><summary aria-label={`ดูรายละเอียด ${item.fileName}`}>•••</summary><div><b>Stable identity</b><code>{item.siteId}:{item.driveId}:{item.itemId}</code><b>Label ID</b><code>{label?.id}</code>{item.errorMessage ? <p>{item.errorMessage}</p> : null}</div></details></td>
                            </tr>;
                          })}
                          {report.rows.length === 0 ? <tr><td colSpan={6} className="no-results">ไม่พบ Secret file ที่ตรงกับ filters ปัจจุบัน</td></tr> : null}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination"><span>หน้า {report.page} จาก {report.pageCount}</span><div><a className={report.page <= 1 ? "disabled" : ""} aria-disabled={report.page <= 1} href={makeHref(params, { page: String(Math.max(report.page - 1, 1)) })}>← ก่อนหน้า</a><a className={report.page >= report.pageCount ? "disabled" : ""} aria-disabled={report.page >= report.pageCount} href={makeHref(params, { page: String(Math.min(report.page + 1, report.pageCount)) })}>ถัดไป →</a></div></div>
                  </section>
                </>
              )}

              <section className="panel scan-panel" id="scan-status">
                <div className="panel-heading"><div><p className="eyebrow">CACHED DATA HEALTH</p><h2>Latest scan run</h2></div><span className={`run-status run-${report.latestRun?.status ?? "unknown"}`}>{report.latestRun?.status ?? "unknown"}</span></div>
                <div className="run-grid">
                  <div><small>RUN ID</small><strong>{report.latestRun?.id ?? "—"}</strong></div><div><small>TRIGGER</small><strong>{report.latestRun?.trigger ?? "—"}</strong></div><div><small>SCANNED</small><strong>{report.latestRun?.scannedCount ?? 0}</strong></div><div><small>CHANGED</small><strong>{report.latestRun?.changedCount ?? 0}</strong></div><div><small>LOCKED</small><strong>{report.latestRun?.lockedCount ?? 0}</strong></div><div><small>FAILED</small><strong>{report.latestRun?.failedCount ?? 0}</strong></div>
                </div>
                <p className="scan-footnote">Report requests อ่าน cache เท่านั้น · Scanner identity และ app-only token แยกจาก Web App · Run now จะตอบ queued job โดยไม่รอ scan เสร็จ</p>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
