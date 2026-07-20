import Link from "next/link";
import { SiteMappingAdminInbox } from "./site-mapping-admin-inbox";

export default function SiteMappingAdminPage() {
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
          <Link className="nav-item" href="/">Report</Link>
          <Link className="nav-item active" href="/admin/site-mappings">Site mappings</Link>
        </nav>

        <div className="topbar-right">
          <span className="admin-boundary-pill"><i aria-hidden="true" /> Admin workspace</span>
          <div className="identity">
            <span className="avatar">CA</span>
            <span><strong>Configuration Admin</strong><small>Bounded pilot</small></span>
          </div>
        </div>
      </header>

      <main className="admin-main">
        <section className="page-heading admin-page-heading">
          <div>
            <p className="eyebrow">BUSINESS SCOPE CONFIGURATION</p>
            <h1>Site Mapping Inbox</h1>
            <p>จัดวาง SharePoint Sites แบบ flat inventory เข้ากับ business hierarchy โดยไม่เปลี่ยนโครงสร้าง Site ใน SharePoint</p>
          </div>
          <div className="admin-heading-proof" aria-label="Configuration security boundary">
            <span>SERVER BRIDGE</span>
            <strong>Function key stays private</strong>
          </div>
        </section>

        <SiteMappingAdminInbox />
      </main>
    </div>
  );
}
