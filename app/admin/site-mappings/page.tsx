import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  EntraAuthorizationError,
  requireReportAdmin,
} from "@/src/auth/entra";
import { SiteMappingAdminInbox } from "./site-mapping-admin-inbox";

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase() || "RA";
}

export default async function SiteMappingAdminPage() {
  const requestHeaders = await headers();
  let administrator;
  try {
    administrator = await requireReportAdmin(requestHeaders.get("cookie"));
  } catch (error) {
    if (error instanceof EntraAuthorizationError && error.status === 401) {
      redirect("/api/auth/entra/login?returnTo=/admin/site-mappings");
    }
    if (error instanceof EntraAuthorizationError && error.status === 403) {
      redirect(`/auth/denied?reason=${encodeURIComponent(error.code)}`);
    }
    throw error;
  }
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
            <span className="avatar">{initials(administrator.displayName)}</span>
            <span><strong>{administrator.displayName}</strong><small>ReportAdmin · Entra verified</small></span>
          </div>
          <Link className="admin-sign-out" href="/api/auth/entra/logout">Sign out</Link>
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

        <SiteMappingAdminInbox administratorUpn={administrator.userPrincipalName} />
      </main>
    </div>
  );
}
