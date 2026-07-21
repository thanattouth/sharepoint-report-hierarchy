import Link from "next/link";
import { headers } from "next/headers";
import { readOptionalEntraSession } from "@/src/auth/entra";

const reasonCopy: Record<string, string> = {
  "report-admin-role-required": "บัญชีนี้ sign in สำเร็จ แต่ยังไม่ได้รับ Entra app role ReportAdmin",
  "report-viewer-role-required": "บัญชีนี้ sign in สำเร็จ แต่ยังไม่ได้รับ Entra app role ReportViewer หรือ ReportAdmin",
  "group-claim-overage": "Entra token ไม่สามารถส่ง group membership ได้ครบ ระบบจึงปิด report scope ไว้เพื่อป้องกันข้อมูลข้าม branch",
  "wrong-tenant": "บัญชีนี้ไม่ได้อยู่ใน Entra tenant ที่ระบบอนุญาต",
  "entra-authentication-failed": "ไม่สามารถยืนยัน Entra session ได้ กรุณาลอง sign in ใหม่",
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>;
}) {
  const reason = (await searchParams)?.reason ?? "report-admin-role-required";
  const requestHeaders = await headers();
  const session = await readOptionalEntraSession(requestHeaders.get("cookie"));
  return (
    <main className="auth-state-page">
      <section className="auth-state-card" role="alert">
        <span className="auth-state-mark" aria-hidden="true">!</span>
        <p className="eyebrow">ENTRA AUTHORIZATION</p>
        <h1>ไม่มีสิทธิ์เข้าถึงพื้นที่นี้</h1>
        <p>{reasonCopy[reason] ?? "ระบบปฏิเสธคำขอนี้เนื่องจากไม่สามารถยืนยันสิทธิ์ ReportAdmin ได้"}</p>
        {session ? <p className="auth-state-identity">Signed in as <strong>{session.userPrincipalName}</strong></p> : null}
        <div className="auth-state-actions">
          <Link className="button button-secondary" href="/">กลับหน้า Report</Link>
          <Link className="button button-primary" href="/api/auth/entra/login?returnTo=/admin/site-mappings&prompt=select_account">เลือกบัญชีอื่น</Link>
          {session ? <form method="post" action="/api/auth/entra/logout"><button className="button button-secondary" type="submit">Sign out</button></form> : null}
        </div>
      </section>
    </main>
  );
}
