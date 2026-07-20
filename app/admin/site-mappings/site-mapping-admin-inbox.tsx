"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SiteMappingInboxResponse,
  SiteMappingNodeOption,
} from "@/src/configuration/admin-bridge";
import type {
  SiteMappingInboxRow,
  SiteMappingInboxStatus,
  SiteMappingPreview,
} from "@/src/configuration/site-mapping";

const statusLabels: Record<SiteMappingInboxStatus, string> = {
  all: "ทั้งหมด",
  unmapped: "ยังไม่ Mapping",
  mapped: "Mapped",
  inactive: "Inactive",
};

function formatAuditDate(value?: string) {
  if (!value) return "ยังไม่มีการเปลี่ยนแปลง";
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function statusCopy(status: SiteMappingInboxRow["status"]) {
  if (status === "unmapped") return "Needs placement";
  if (status === "mapped") return "Mapped";
  return "Inactive";
}

export function SiteMappingAdminInbox() {
  const [status, setStatus] = useState<SiteMappingInboxStatus>("unmapped");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [inbox, setInbox] = useState<SiteMappingInboxResponse | null>(null);
  const [selected, setSelected] = useState<Map<string, SiteMappingInboxRow>>(new Map());
  const [nodeQuery, setNodeQuery] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [preview, setPreview] = useState<SiteMappingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      status,
      q: query,
      page: String(page),
      pageSize: String(pageSize),
    });
    void fetch(`/api/configuration/site-mappings?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Inbox returned HTTP ${response.status}`);
      return response.json() as Promise<SiteMappingInboxResponse>;
    }).then((body) => {
      setInbox(body);
      setPage(body.page);
      setSelected(new Map());
      setPreview(null);
    }).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("ไม่สามารถอ่าน Site Mapping Inbox ได้ ระบบไม่เปิดเผยข้อมูลบางส่วนเมื่อยืนยัน server boundary ไม่สำเร็จ");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [page, pageSize, query, status]);

  const filteredNodes = useMemo(() => {
    const normalized = nodeQuery.trim().toLocaleLowerCase();
    return (inbox?.nodes ?? []).filter((node) => !normalized
      || node.breadcrumb.toLocaleLowerCase().includes(normalized)
      || node.type.toLocaleLowerCase().includes(normalized));
  }, [inbox?.nodes, nodeQuery]);

  const targetNode = inbox?.nodes.find((node) => node.id === targetNodeId);
  const rows = inbox?.rows ?? [];
  const allPageRowsSelected = rows.length > 0 && rows.every((row) => selected.has(row.siteId));

  function changeStatus(nextStatus: SiteMappingInboxStatus) {
    if (nextStatus === status) return;
    setLoading(true);
    setError(null);
    setStatus(nextStatus);
    setPage(1);
    setSelected(new Map());
    setPreview(null);
  }

  function toggleRow(row: SiteMappingInboxRow) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.siteId)) next.delete(row.siteId);
      else if (next.size < 100) next.set(row.siteId, row);
      return next;
    });
    setPreview(null);
  }

  function togglePage() {
    setSelected((current) => {
      const next = new Map(current);
      if (allPageRowsSelected) rows.forEach((row) => next.delete(row.siteId));
      else rows.forEach((row) => {
        if (next.size < 100) next.set(row.siteId, row);
      });
      return next;
    });
    setPreview(null);
  }

  async function requestPreview() {
    if (!targetNodeId || selected.size === 0) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetch("/api/configuration/site-mappings/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetNodeId,
          changes: [...selected.values()].map((row) => ({
            siteId: row.siteId,
            expectedVersion: row.version,
          })),
        }),
      });
      if (!response.ok) throw new Error(`Preview returned HTTP ${response.status}`);
      setPreview(await response.json() as SiteMappingPreview);
    } catch {
      setError("Preview ไม่สำเร็จ อาจมีการเปลี่ยน mapping หรือ server boundary ไม่พร้อม กรุณา refresh แล้วลองใหม่");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section className="admin-workspace" aria-label="Site Mapping administration">
      <div className="admin-inbox-column">
        <section className="admin-summary-strip" aria-label="Site mapping workflow">
          <div><span>1</span><strong>Review inbox</strong><small>ค้นหา Site จาก registry</small></div>
          <i aria-hidden="true">→</i>
          <div><span>2</span><strong>Choose business node</strong><small>เลือกจาก breadcrumb เต็ม</small></div>
          <i aria-hidden="true">→</i>
          <div><span>3</span><strong>Preview impact</strong><small>ตรวจ move และ principals</small></div>
          <i aria-hidden="true">→</i>
          <div className="locked-step"><span>4</span><strong>Authenticated apply</strong><small>ล็อกไว้จนต่อ Entra admin</small></div>
        </section>

        <section className="panel admin-inbox-panel">
          <div className="panel-heading admin-panel-heading">
            <div>
              <p className="eyebrow">FLAT SHAREPOINT INVENTORY</p>
              <h2>Sites awaiting placement</h2>
              <p>Unmapped Sites มาก่อนเสมอ · เลือกได้สูงสุด 100 Sites ต่อครั้ง</p>
            </div>
            <span className="panel-kicker">{inbox?.total ?? 0} results</span>
          </div>

          <div className="admin-toolbar">
            <form onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = queryDraft.trim();
              if (nextQuery === query) return;
              setLoading(true);
              setError(null);
              setQuery(nextQuery);
              setPage(1);
            }} role="search" className="admin-search">
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  placeholder="ค้นหาชื่อ Site, URL, ID หรือ business mapping"
                  aria-label="ค้นหา Site Mapping Inbox"
                />
              </label>
              <button className="button button-primary" type="submit">ค้นหา</button>
            </form>
            <div className="admin-status-tabs" aria-label="กรอง mapping status">
              {(Object.keys(statusLabels) as SiteMappingInboxStatus[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={status === value ? "active" : ""}
                  aria-pressed={status === value}
                  onClick={() => changeStatus(value)}
                >
                  {statusLabels[value]}
                </button>
              ))}
            </div>
          </div>

          {error ? <div className="admin-error" role="alert"><strong>Configuration unavailable</strong><span>{error}</span></div> : null}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-check-cell"><input type="checkbox" checked={allPageRowsSelected} onChange={togglePage} aria-label="เลือก Sites ทั้งหน้าปัจจุบัน" /></th>
                  <th>SITE</th>
                  <th>BUSINESS PLACEMENT</th>
                  <th>STATUS</th>
                  <th>LAST CHANGE</th>
                  <th>VERSION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="admin-empty-row">กำลังโหลด Site Mapping Inbox…</td></tr> : null}
                {!loading && rows.map((row) => (
                  <tr key={row.siteId} className={selected.has(row.siteId) ? "selected" : ""}>
                    <td className="admin-check-cell"><input type="checkbox" checked={selected.has(row.siteId)} onChange={() => toggleRow(row)} aria-label={`เลือก ${row.siteName}`} /></td>
                    <td>
                      <span className="admin-site-cell">
                        <span className="site-mark" aria-hidden="true">SP</span>
                        <span><strong>{row.siteName}</strong><a href={row.siteUrl} target="_blank" rel="noreferrer">{row.siteUrl}</a><small>{row.siteId}</small></span>
                      </span>
                    </td>
                    <td>{row.nodeBreadcrumb ? <span className="placement-copy"><strong>{row.nodeBreadcrumb.split(" / ").at(-1)}</strong><small>{row.nodeBreadcrumb}</small></span> : <span className="unmapped-copy">ยังไม่มี canonical placement</span>}</td>
                    <td><span className={`mapping-status mapping-${row.status}`}><i aria-hidden="true" />{statusCopy(row.status)}</span></td>
                    <td><span className="audit-copy"><strong>{formatAuditDate(row.updatedAt)}</strong><small>{row.updatedBy ?? "—"}</small></span></td>
                    <td><code className="version-code">v{row.version}</code></td>
                  </tr>
                ))}
                {!loading && rows.length === 0 ? <tr><td colSpan={6} className="admin-empty-row">ไม่พบ Site ที่ตรงกับ filter ปัจจุบัน</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="admin-pagination">
            <span>หน้า {inbox?.page ?? 1} จาก {inbox?.pageCount ?? 1} · {inbox?.total ?? 0} Sites</span>
            <div>
              <button type="button" disabled={!inbox || inbox.page <= 1 || loading} onClick={() => {
                setLoading(true);
                setError(null);
                setPage((current) => Math.max(current - 1, 1));
              }}>← ก่อนหน้า</button>
              <button type="button" disabled={!inbox || inbox.page >= inbox.pageCount || loading} onClick={() => {
                setLoading(true);
                setError(null);
                setPage((current) => current + 1);
              }}>ถัดไป →</button>
            </div>
          </div>
        </section>
      </div>

      <aside className="mapping-action-panel" aria-labelledby="mapping-action-heading">
        <div className="mapping-action-head">
          <div><p className="eyebrow">BULK PLACEMENT</p><h2 id="mapping-action-heading">Assign business node</h2></div>
          <span>{selected.size} selected</span>
        </div>

        <div className="selected-summary">
          <span className="selected-summary-mark" aria-hidden="true">{selected.size || "—"}</span>
          <div><strong>{selected.size ? `${selected.size} Sites ready for preview` : "Select Sites from the inbox"}</strong><small>Selection clears when filters or page change</small></div>
        </div>

        <div className="node-picker">
          <label htmlFor="node-search">ค้นหา business node</label>
          <input id="node-search" type="search" value={nodeQuery} onChange={(event) => setNodeQuery(event.target.value)} placeholder="ชื่อ EVP, Department, Group หรือ Project" />
          <label htmlFor="target-node">Target placement</label>
          <select id="target-node" size={Math.min(Math.max(filteredNodes.length, 3), 7)} value={targetNodeId} onChange={(event) => {
            setTargetNodeId(event.target.value);
            setPreview(null);
          }}>
            {filteredNodes.map((node: SiteMappingNodeOption) => <option key={node.id} value={node.id}>{node.breadcrumb} · {node.type}</option>)}
          </select>
          {targetNode ? <div className="target-proof"><span>{targetNode.type}</span><strong>{targetNode.breadcrumb}</strong></div> : <p className="node-picker-help">เลือก node เพื่อสร้าง impact preview</p>}
        </div>

        <button className="button button-primary preview-button" type="button" disabled={!targetNodeId || selected.size === 0 || previewing} onClick={requestPreview}>{previewing ? "กำลังตรวจสอบ…" : "Preview impact"}</button>

        {preview ? <section className="impact-preview" aria-live="polite">
          <div className="impact-preview-heading"><div><p className="eyebrow">IMPACT PREVIEW</p><h3>{preview.targetBreadcrumb}</h3></div><span>READY</span></div>
          <dl>
            <div><dt>NEW</dt><dd>{preview.newAssignments}</dd></div>
            <div><dt>MOVES</dt><dd>{preview.moves}</dd></div>
            <div><dt>UNCHANGED</dt><dd>{preview.unchanged}</dd></div>
          </dl>
          <div className="principal-impact"><strong>Direct principals at target</strong>{preview.affectedPrincipals.length ? <ul>{preview.affectedPrincipals.slice(0, 5).map((principal) => <li key={`${principal.label}:${principal.businessRole}`}><span>{principal.label}</span><small>{principal.businessRole}</small></li>)}</ul> : <p>ไม่มี direct principal ที่ node นี้</p>}</div>
        </section> : null}

        <div className="apply-lock" role="status">
          <span aria-hidden="true">◇</span>
          <div><strong>Apply ยังถูกล็อก</strong><p>ต้อง derive ผู้ดูแลจาก authenticated Entra claims ก่อนเปิด browser write path</p></div>
        </div>
        <button className="button apply-button" type="button" disabled title="Authenticated administrator required">Apply mapping changes</button>
        <p className="mapping-action-footnote">Function key และ pilot actor อยู่ฝั่ง server เท่านั้น · ทุก effective change จะใช้ expected version และเขียน audit event</p>
      </aside>
    </section>
  );
}
