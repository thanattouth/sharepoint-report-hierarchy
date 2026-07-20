"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BusinessConfigurationPreview,
  BusinessNodeChange,
  BusinessScopeAssignmentRow,
  BusinessScopeNodeRow,
  BusinessScopeSnapshot,
  ScopeAssignmentChange,
} from "@/src/configuration/business-scope";
import type { BusinessRole, GovernancePrincipalType, HierarchyNodeType } from "@/src/domain/types";
import type { EntraSecurityGroup } from "@/src/auth/entra-groups";

type Tab = "structure" | "assignments" | "audit";
const nodeTypes: HierarchyNodeType[] = ["EVP", "Department", "Group", "Project"];
const roles: BusinessRole[] = ["EVP", "DepartmentHead", "GroupManager", "ProjectOwner", "Delegate"];
const emptyNode: BusinessNodeChange = { expectedVersion: 0, type: "EVP", name: "", active: true };
const emptyAssignment: ScopeAssignmentChange = {
  expectedVersion: 0,
  principalType: "User",
  nodeId: "",
  businessRole: "Delegate",
  includeDescendants: true,
  active: true,
};

function auditDate(value?: string) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function principalName(assignment: BusinessScopeAssignmentRow) {
  return assignment.principalDisplayName ?? assignment.userUpn ?? assignment.principalObjectId ?? "Unknown principal";
}

export function BusinessScopeAdmin({ administratorUpn }: { administratorUpn: string }) {
  const [snapshot, setSnapshot] = useState<BusinessScopeSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("structure");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nodeChange, setNodeChange] = useState<BusinessNodeChange>(emptyNode);
  const [assignmentChange, setAssignmentChange] = useState<ScopeAssignmentChange>(emptyAssignment);
  const [preview, setPreview] = useState<BusinessConfigurationPreview | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/configuration/business-scope", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Business scope returned HTTP ${response.status}`);
      const body = await response.json() as BusinessScopeSnapshot;
      setSnapshot(body);
      setAssignmentChange((current) => current.nodeId || !body.nodes.length
        ? current
        : { ...current, nodeId: body.nodes.find((node) => node.active)?.id ?? "" });
    } catch {
      setError("ไม่สามารถอ่าน business scope ได้ ระบบปิดข้อมูลไว้เมื่อยืนยัน server boundary ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredNodes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (snapshot?.nodes ?? []).filter((node) => !query
      || node.breadcrumb.toLocaleLowerCase().includes(query)
      || node.type.toLocaleLowerCase().includes(query));
  }, [search, snapshot?.nodes]);
  const filteredAssignments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (snapshot?.assignments ?? []).filter((assignment) => !query
      || principalName(assignment).toLocaleLowerCase().includes(query)
      || assignment.breadcrumb.toLocaleLowerCase().includes(query)
      || assignment.businessRole.toLocaleLowerCase().includes(query));
  }, [search, snapshot?.assignments]);

  function beginNode(node?: BusinessScopeNodeRow, parent?: BusinessScopeNodeRow) {
    const nextType = parent ? nodeTypes[nodeTypes.indexOf(parent.type) + 1] : "EVP";
    if (parent && !nextType) return;
    setTab("structure");
    setPreview(null);
    setError(null);
    setSuccess(null);
    setNodeChange(node ? {
      id: node.id,
      expectedVersion: node.version ?? 1,
      type: node.type,
      name: node.name,
      parentId: node.parentId,
      active: node.active,
    } : {
      ...emptyNode,
      type: nextType,
      parentId: parent?.id,
    });
  }

  function beginAssignment(assignment?: BusinessScopeAssignmentRow) {
    setTab("assignments");
    setPreview(null);
    setError(null);
    setSuccess(null);
    setAssignmentChange(assignment ? {
      id: assignment.id,
      expectedVersion: assignment.version ?? 1,
      principalType: assignment.principalType ?? "User",
      principalObjectId: assignment.principalObjectId,
      principalDisplayName: assignment.principalDisplayName,
      userUpn: assignment.userUpn,
      nodeId: assignment.nodeId,
      businessRole: assignment.businessRole,
      includeDescendants: assignment.includeDescendants,
      active: assignment.active,
    } : {
      ...emptyAssignment,
      nodeId: snapshot?.nodes.find((node) => node.active)?.id ?? "",
    });
  }

  async function requestPreview() {
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const structure = tab === "structure";
      const response = await fetch(structure
        ? "/api/configuration/business-nodes/preview"
        : "/api/configuration/scope-assignments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: structure ? nodeChange : assignmentChange }),
      });
      if (!response.ok) throw new Error("preview-rejected");
      setPreview(await response.json() as BusinessConfigurationPreview);
    } catch {
      setPreview(null);
      setError("Preview ถูกปฏิเสธ กรุณาตรวจลำดับ parent, principal identity และ dependencies ที่ยัง active");
    } finally {
      setWorking(false);
    }
  }

  async function applyChange() {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      const structure = preview.entityType === "HierarchyNode";
      const response = await fetch(structure
        ? "/api/configuration/business-nodes/apply"
        : "/api/configuration/scope-assignments/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: structure ? nodeChange : assignmentChange }),
      });
      if (response.status === 409) throw new Error("conflict");
      if (!response.ok) throw new Error("rejected");
      setSuccess(`บันทึก ${preview.entityType === "HierarchyNode" ? "business node" : "principal assignment"} แล้วโดย ${administratorUpn}`);
      setPreview(null);
      if (structure) setNodeChange(emptyNode);
      else setAssignmentChange({ ...emptyAssignment, nodeId: assignmentChange.nodeId });
      await load();
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error && cause.message === "conflict"
        ? "ข้อมูลเปลี่ยนหลัง Preview กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่"
        : "Apply ไม่สำเร็จ ระบบไม่ได้บันทึกการเปลี่ยนแปลง");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="scope-admin" aria-label="Business Scope administration">
      <nav className="scope-admin-tabs" aria-label="Business configuration sections">
        <button className={tab === "structure" ? "active" : ""} onClick={() => { setTab("structure"); setPreview(null); }} type="button"><span>01</span>Structure</button>
        <button className={tab === "assignments" ? "active" : ""} onClick={() => { setTab("assignments"); setPreview(null); }} type="button"><span>02</span>Principal assignments</button>
        <Link href="/admin/site-mappings"><span>03</span>Site mappings ↗</Link>
        <button className={tab === "audit" ? "active" : ""} onClick={() => { setTab("audit"); setPreview(null); }} type="button"><span>04</span>Audit</button>
      </nav>

      <section className="scope-metrics" aria-label="Business scope totals">
        <div><span>ACTIVE NODES</span><strong>{snapshot?.counts.activeNodes ?? "—"}</strong></div>
        <div><span>EVP ROOTS</span><strong>{snapshot?.counts.evpRoots ?? "—"}</strong></div>
        <div><span>ACTIVE ASSIGNMENTS</span><strong>{snapshot?.counts.activeAssignments ?? "—"}</strong></div>
        <div><span>MAPPED SITES</span><strong>{snapshot?.counts.mappedSites ?? "—"}</strong></div>
      </section>

      {error ? <div className="admin-error scope-message" role="alert"><strong>Change rejected</strong><span>{error}</span></div> : null}
      {success ? <div className="admin-success scope-message" role="status"><strong>Configuration saved</strong><span>{success}</span></div> : null}

      <div className={`scope-admin-layout ${tab === "audit" ? "audit-layout" : ""}`}>
        <section className="panel scope-list-panel">
          <div className="panel-heading admin-panel-heading scope-list-heading">
            <div>
              <p className="eyebrow">{tab === "structure" ? "ORGANIZATION FOREST" : tab === "assignments" ? "ENTRA PRINCIPALS" : "CONFIGURATION LEDGER"}</p>
              <h2>{tab === "structure" ? "Business structure" : tab === "assignments" ? "Scope assignments" : "Recent changes"}</h2>
              <p>{tab === "structure" ? "EVP → Department → Group → Project" : tab === "assignments" ? "Capability ไม่ให้ data scope จนกว่าจะมี assignment" : "ทุก effective change เก็บ actor, time และ version"}</p>
            </div>
            {tab !== "audit" ? <button className="button button-primary" type="button" onClick={() => tab === "structure" ? beginNode() : beginAssignment()}>+ {tab === "structure" ? "New EVP root" : "New assignment"}</button> : null}
          </div>
          {tab !== "audit" ? <div className="scope-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "structure" ? "ค้นหาชื่อ node หรือ breadcrumb" : "ค้นหา principal, role หรือ business node"} aria-label="ค้นหา business configuration" /></div> : null}

          {loading ? <div className="scope-empty">กำลังโหลด persistent business scope…</div> : null}
          {!loading && tab === "structure" ? <div className="scope-node-list">
            {filteredNodes.map((node) => {
              const depth = node.breadcrumb.split(" / ").length - 1;
              const nextType = nodeTypes[nodeTypes.indexOf(node.type) + 1];
              return <article className={`scope-node-row ${node.active ? "" : "inactive"}`} key={node.id} style={{ "--node-depth": depth } as React.CSSProperties}>
                <span className="scope-node-type">{node.type.slice(0, 1)}</span>
                <div className="scope-node-copy"><strong>{node.name}</strong><small>{node.breadcrumb}</small><code>{node.id}</code></div>
                <dl><div><dt>CHILDREN</dt><dd>{node.childCount}</dd></div><div><dt>SITES</dt><dd>{node.directSiteCount}</dd></div><div><dt>PRINCIPALS</dt><dd>{node.directAssignmentCount}</dd></div></dl>
                <span className={`mapping-status mapping-${node.active ? "mapped" : "inactive"}`}><i aria-hidden="true" />{node.active ? "Active" : "Inactive"}</span>
                <code className="version-code">v{node.version ?? 1}</code>
                <div className="scope-row-actions"><button type="button" onClick={() => beginNode(node)}>Edit</button>{nextType && node.active ? <button type="button" onClick={() => beginNode(undefined, node)}>+ {nextType}</button> : null}</div>
              </article>;
            })}
            {!filteredNodes.length ? <div className="scope-empty">ไม่พบ node ที่ตรงกับคำค้น</div> : null}
          </div> : null}

          {!loading && tab === "assignments" ? <div className="scope-assignment-list">
            {filteredAssignments.map((assignment) => <article className={`scope-assignment-row ${assignment.active ? "" : "inactive"}`} key={assignment.id}>
              <span className="scope-principal-mark">{(assignment.principalType ?? "User") === "Group" ? "G" : "U"}</span>
              <div><strong>{principalName(assignment)}</strong><small>{assignment.businessRole} · {assignment.includeDescendants ? "Node + descendants" : "Direct node only"}</small><span>{assignment.breadcrumb}</span></div>
              <span className={`mapping-status mapping-${assignment.active ? "mapped" : "inactive"}`}><i aria-hidden="true" />{assignment.active ? "Active" : "Inactive"}</span>
              <code className="version-code">v{assignment.version ?? 1}</code>
              <button type="button" onClick={() => beginAssignment(assignment)}>Edit</button>
            </article>)}
            {!filteredAssignments.length ? <div className="scope-empty">ไม่พบ assignment ที่ตรงกับคำค้น</div> : null}
          </div> : null}

          {!loading && tab === "audit" ? <div className="scope-audit-list">
            {(snapshot?.auditEvents ?? []).map((event) => <article key={event.id}><span className="scope-audit-action">{event.action}</span><div><strong>{event.summary}</strong><small>{event.entityType} · {event.entityId}</small></div><div><strong>{event.actor}</strong><small>{auditDate(event.occurredAt)} · v{event.version}</small></div></article>)}
            {!snapshot?.auditEvents.length ? <div className="scope-empty">ยังไม่มี Business Scope audit events ใน ledger</div> : null}
          </div> : null}
        </section>

        {tab !== "audit" ? <aside className="scope-editor" aria-label="Configuration editor">
          <div className="mapping-action-head"><div><p className="eyebrow">{tab === "structure" ? "NODE EDITOR" : "ASSIGNMENT EDITOR"}</p><h2>{tab === "structure" ? (nodeChange.id ? "Edit business node" : "Create business node") : (assignmentChange.id ? "Edit assignment" : "Create assignment")}</h2></div><span>{tab === "structure" ? `v${nodeChange.expectedVersion}` : `v${assignmentChange.expectedVersion}`}</span></div>
          {tab === "structure" ? <NodeEditor change={nodeChange} nodes={snapshot?.nodes ?? []} onChange={(next) => { setNodeChange(next); setPreview(null); }} /> : <AssignmentEditor change={assignmentChange} nodes={snapshot?.nodes ?? []} onChange={(next) => { setAssignmentChange(next); setPreview(null); }} />}
          <button className="button button-secondary preview-button" type="button" disabled={working} onClick={requestPreview}>{working ? "กำลังตรวจสอบ…" : "Preview impact"}</button>
          {preview ? <section className="impact-preview scope-impact" aria-live="polite"><div className="impact-preview-heading"><div><p className="eyebrow">IMPACT PREVIEW</p><h3>{preview.title}</h3></div><span>READY</span></div><p>{preview.summary}</p><dl><div><dt>DESCENDANTS</dt><dd>{preview.impact.descendantNodes}</dd></div><div><dt>VISIBLE SITES</dt><dd>{preview.impact.visibleSites ?? preview.impact.directSites}</dd></div><div><dt>NEXT VERSION</dt><dd>v{preview.nextVersion}</dd></div></dl></section> : null}
          <div className="apply-lock apply-ready"><span aria-hidden="true">✓</span><div><strong>ReportAdmin boundary</strong><p>actor = {administratorUpn} · expected version · append-only audit</p></div></div>
          <button className="button apply-button" type="button" disabled={!preview || working} onClick={applyChange}>{working ? "กำลังบันทึก…" : "Apply configuration"}</button>
          <p className="mapping-action-footnote">Deactivate node จะถูก block หากยังมี active child, assignment หรือ Site mapping โดยตรง</p>
        </aside> : null}
      </div>
    </section>
  );
}

function NodeEditor({ change, nodes, onChange }: { change: BusinessNodeChange; nodes: BusinessScopeNodeRow[]; onChange: (value: BusinessNodeChange) => void }) {
  return <div className="scope-editor-form">
    <label>Node type<select value={change.type} onChange={(event) => onChange({ ...change, type: event.target.value as HierarchyNodeType, parentId: event.target.value === "EVP" ? undefined : change.parentId })}>{nodeTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label>Business name<input value={change.name} maxLength={120} onChange={(event) => onChange({ ...change, name: event.target.value })} placeholder="เช่น Corporate Services" /></label>
    <label>Parent node<select value={change.parentId ?? ""} disabled={change.type === "EVP"} onChange={(event) => onChange({ ...change, parentId: event.target.value || undefined })}><option value="">{change.type === "EVP" ? "EVP is always a root" : "Select parent"}</option>{nodes.filter((node) => node.active && node.id !== change.id).map((node) => <option key={node.id} value={node.id}>{node.breadcrumb} · {node.type}</option>)}</select></label>
    <label className="scope-switch"><input type="checkbox" checked={change.active} onChange={(event) => onChange({ ...change, active: event.target.checked })} /><span><strong>Active node</strong><small>Inactive nodes never contribute report scope</small></span></label>
  </div>;
}

function AssignmentEditor({ change, nodes, onChange }: { change: ScopeAssignmentChange; nodes: BusinessScopeNodeRow[]; onChange: (value: ScopeAssignmentChange) => void }) {
  const [groupQuery, setGroupQuery] = useState("");
  const [groupResults, setGroupResults] = useState<EntraSecurityGroup[]>([]);
  const [groupSearchState, setGroupSearchState] = useState<"idle" | "searching" | "error">("idle");

  async function searchGroups() {
    if (groupQuery.trim().length < 2) return;
    setGroupSearchState("searching");
    setGroupResults([]);
    try {
      const response = await fetch(`/api/directory/groups?q=${encodeURIComponent(groupQuery.trim())}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("group-search-unavailable");
      const body = await response.json() as { groups?: EntraSecurityGroup[] };
      setGroupResults(Array.isArray(body.groups) ? body.groups : []);
      setGroupSearchState("idle");
    } catch {
      setGroupSearchState("error");
    }
  }

  return <div className="scope-editor-form">
    <label>Principal type<select value={change.principalType} onChange={(event) => onChange({ ...change, principalType: event.target.value as GovernancePrincipalType, principalObjectId: undefined, principalDisplayName: undefined, userUpn: undefined })}><option>User</option><option>Group</option></select></label>
    {change.principalType === "Group" ? <section className="entra-group-picker" aria-label="Entra security group picker">
      <div className="entra-group-picker-heading"><strong>Entra security group</strong><small>ค้นหาจาก Entra แล้วระบบจะเก็บ immutable Object ID</small></div>
      {change.principalObjectId ? <div className="entra-group-selection"><span>G</span><div><strong>{change.principalDisplayName ?? "Selected security group"}</strong><code>{change.principalObjectId}</code></div><button type="button" onClick={() => onChange({ ...change, principalObjectId: undefined, principalDisplayName: undefined })}>Change</button></div> : <>
        <div className="entra-group-search"><input type="search" value={groupQuery} onChange={(event) => setGroupQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchGroups(); } }} placeholder="เช่น EVP-A หรือ Department 1-A" /><button type="button" disabled={groupSearchState === "searching" || groupQuery.trim().length < 2} onClick={() => void searchGroups()}>{groupSearchState === "searching" ? "Searching…" : "Search"}</button></div>
        {groupSearchState === "error" ? <p className="entra-group-error">Group Picker ยังไม่พร้อมหรือ session ไม่มี Graph consent กรุณา sign in ใหม่หลังเปิด permission</p> : null}
        {groupResults.length ? <div className="entra-group-results">{groupResults.map((group) => <button key={group.id} type="button" onClick={() => { onChange({ ...change, principalObjectId: group.id, principalDisplayName: group.displayName }); setGroupResults([]); }}><span>G</span><span><strong>{group.displayName}</strong><small>{group.mail ?? "Security group"}</small></span></button>)}</div> : null}
      </>}
    </section> : <>
      <label>Display name<input value={change.principalDisplayName ?? ""} onChange={(event) => onChange({ ...change, principalDisplayName: event.target.value })} placeholder="ชื่อสำหรับค้นหาและแสดงผล" /></label>
      <label>Entra object ID<input value={change.principalObjectId ?? ""} onChange={(event) => onChange({ ...change, principalObjectId: event.target.value })} placeholder="00000000-0000-0000-0000-000000000000" /><small>Recommended immutable identity</small></label>
      <label>User principal name<input type="email" value={change.userUpn ?? ""} onChange={(event) => onChange({ ...change, userUpn: event.target.value })} placeholder="user@customer.com" /><small>Pilot fallback หากยังไม่มี object ID</small></label>
    </>}
    <label>Business node<select value={change.nodeId} onChange={(event) => onChange({ ...change, nodeId: event.target.value })}><option value="">Select node</option>{nodes.filter((node) => node.active).map((node) => <option key={node.id} value={node.id}>{node.breadcrumb} · {node.type}</option>)}</select></label>
    <label>Business role<select value={change.businessRole} onChange={(event) => onChange({ ...change, businessRole: event.target.value as BusinessRole })}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
    <label className="scope-switch"><input type="checkbox" checked={change.includeDescendants} onChange={(event) => onChange({ ...change, includeDescendants: event.target.checked })} /><span><strong>Include descendants</strong><small>เห็นทุก active node และ mapped Site ใต้ branch นี้</small></span></label>
    <label className="scope-switch"><input type="checkbox" checked={change.active} onChange={(event) => onChange({ ...change, active: event.target.checked })} /><span><strong>Active assignment</strong><small>Inactive assignments grant no scope</small></span></label>
  </div>;
}
