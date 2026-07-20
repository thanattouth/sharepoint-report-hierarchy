import Link from "next/link";

const reasonCopy: Record<string, string> = {
  "report-admin-role-required": "บัญชีนี้ sign in สำเร็จ แต่ยังไม่ได้รับ Entra app role ReportAdmin",
  "wrong-tenant": "บัญชีนี้ไม่ได้อยู่ใน Entra tenant ที่ระบบอนุญาต",
  "entra-authentication-failed": "ไม่สามารถยืนยัน Entra session ได้ กรุณาลอง sign in ใหม่",
};

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>;
}) {
  const reason = (await searchParams)?.reason ?? "report-admin-role-required";
  return (
    <main className="auth-state-page">
      <section className="auth-state-card" role="alert">
        <span className="auth-state-mark" aria-hidden="true">!</span>
        <p className="eyebrow">ENTRA AUTHORIZATION</p>
        <h1>ไม่มีสิทธิ์เข้า Admin workspace</h1>
        <p>{reasonCopy[reason] ?? "ระบบปฏิเสธคำขอนี้เนื่องจากไม่สามารถยืนยันสิทธิ์ ReportAdmin ได้"}</p>
        <div className="auth-state-actions">
          <Link className="button button-secondary" href="/">กลับหน้า Report</Link>
          <Link className="button button-primary" href="/api/auth/entra/login?returnTo=/admin/site-mappings">Sign in อีกครั้ง</Link>
        </div>
      </section>
    </main>
  );
}
