import Link from "next/link";

export default function SignedOutPage() {
  return (
    <main className="auth-state-page">
      <section className="auth-state-card" role="status">
        <span className="auth-state-mark auth-state-mark-success" aria-hidden="true">✓</span>
        <p className="eyebrow">SESSION CLEARED</p>
        <h1>ออกจากระบบเรียบร้อยแล้ว</h1>
        <p>Entra application session และ Microsoft Graph token ของ Report ถูกล้างจาก browser นี้แล้ว</p>
        <div className="auth-state-actions">
          <Link className="button button-primary" href="/api/auth/entra/login?returnTo=/">Sign in อีกครั้ง</Link>
        </div>
      </section>
    </main>
  );
}
