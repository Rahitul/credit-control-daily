import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Credit Control Daily",
};

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "The system stores business data you enter: customer details, sales and payment records, pending bills, dropdown values, and an activity log linking entries to the user who made them.",
  },
  {
    title: "Account data",
    body: "Your name, email address, department/role and a hashed password are held so you can sign in. Passwords are never stored in plain text.",
  },
  {
    title: "How it is used",
    body: "Data is used only for credit control, collection and reporting within the organisation. It is not sold, shared with third parties, or used for marketing.",
  },
  {
    title: "Who can see it",
    body: "Access is role-based. Department users see only their own app's records; Accounts and Admin see the full register. Admin can review who created or approved each entry via the activity log.",
  },
  {
    title: "Retention",
    body: "Records are retained for as long as they are needed for business and audit purposes. Requests to correct or remove data should be directed to your system administrator.",
  },
  {
    title: "Security",
    body: "The application runs on an internal server with signed login sessions and role checks on every action. Report any suspected misuse to your system administrator immediately.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="bg-theme text-theme flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="surface-card border-theme w-full max-w-2xl rounded-2xl border p-8">
        <p className="text-theme-muted text-xs font-medium uppercase tracking-widest">
          Credit Control Daily
        </p>
        <h1 className="text-theme-strong mt-1 text-2xl font-semibold">Privacy Policy</h1>
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
