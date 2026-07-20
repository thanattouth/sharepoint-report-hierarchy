import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EntraAuthorizationError, requireReportAdmin } from "@/src/auth/entra";
import { BusinessScopeAdmin } from "./business-scope-admin";

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase() || "RA";
}

export default async function BusinessScopeAdminPage() {
  const requestHeaders = await headers();
  let administrator;
  try {
    administrator = await requireReportAdmin(requestHeaders.get("cookie"));
  } catch (error) {
    if (error instanceof EntraAuthorizationError && error.status === 401) {
      redirect("/api/auth/entra/login?returnTo=/admin/business-scope");
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
          <span><strong>Sensitivity Report</strong><small>SharePoint Governance</small></span>
        </Link>
        <nav className="primary-nav" aria-label="เมนูหลัก">
          <Link className="nav-item" href="/">Report</Link>
          <Link className="nav-item active" href="/admin/business-scope">Business scope</Link>
          <Link className="nav-item" href="/admin/site-mappings">Site mappings</Link>
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
            <h1>Structure &amp; assignments</h1>
            <p>สร้างโครงสร้างธุรกิจและกำหนดว่า Entra user หรือ group ใดเห็น branch ไหน ก่อนนำ Site ไปวางใน hierarchy</p>
          </div>
          <div className="admin-heading-proof" aria-label="Configuration security boundary">
            <span>AUTHORIZATION MODEL</span>
            <strong>Principal → Node → Descendants → Sites</strong>
          </div>
        </section>
        <BusinessScopeAdmin administratorUpn={administrator.userPrincipalName} />
      </main>
    </div>
  );
}
