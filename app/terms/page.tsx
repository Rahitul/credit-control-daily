import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use · Credit Control Daily",
};

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "1. Purpose of the System",
    body: "Credit Control Daily is an internal business tool for recording customers, sales, payments, and pending bills. Access is granted only to authorised staff of the organisation.",
  },
  {
    title: "2. Accounts & Responsibility",
    body: "Each account is assigned to one named individual. You are responsible for keeping your password confidential and for every entry made under your account. Do not share credentials or use someone else's account.",
  },
  {
    title: "3. Accurate Records",
    body: "Entries must be accurate and made in good faith. Financial records logged here may be used for reporting and reconciliation, so incorrect data can affect other departments.",
  },
  {
    title: "4. Acceptable Use",
    body: "Do not attempt to access data outside your role, alter or delete another department's records without authorisation, or interfere with the operation of the system.",
  },
  {
    title: "5. Monitoring & Audit",
    body: "The system keeps an activity log of user actions for audit and security purposes. Use of the system constitutes consent to this logging.",
  },
  {
    title: "6. Availability",
    body: "The service is provided on an as-is basis. While backups and process supervision are in place, the operator is not liable for losses arising from downtime or data entered incorrectly by users.",
  },
];

export default function TermsPage() {
  return (
    <main className="bg-theme text-theme flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="surface-card border-theme w-full max-w-2xl rounded-2xl border p-8">
        <p className="text-theme-muted text-xs font-medium uppercase tracking-widest">
          Credit Control Daily
        </p>
        <h1 className="text-theme-strong mt-1 text-2xl font-semibold">Terms of Use</h1>
        <p className="text-theme-muted mt-2 text-sm">Last updated: October 2026</p>

        <div className="mt-6 space-y-5">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-theme-strong text-sm font-semibold">{s.title}</h2>
              <p className="text-theme-muted mt-1 text-sm leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>

        <div className="border-theme mt-8 border-t pt-6">
          <Link
            href="/"
            className="btn-ghost inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
