import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Mail, ShieldCheck, UserCog } from "lucide-react";

export const metadata: Metadata = {
  title: "Forgot Password · Credit Control Daily",
};

const STEPS = [
  {
    icon: Mail,
    title: "Contact your administrator",
    body: "Send a password-reset request from your work email or internal extension, mentioning the account email you sign in with.",
  },
  {
    icon: UserCog,
    title: "Admin sets a new password",
    body: "An administrator signs in, opens Admin → Users, edits your user and enters a new password (minimum 6 characters).",
  },
  {
    icon: KeyRound,
    title: "Sign in again",
    body: "Return to the sign-in page and log in with your email and the new password.",
  },
];

export default function ForgotPasswordPage() {
  return (
    <main className="bg-theme text-theme flex min-h-full flex-col items-center justify-center px-4 py-12">
      <div className="surface-card border-theme w-full max-w-2xl rounded-2xl border p-8">
        <p className="text-theme-muted text-xs font-medium uppercase tracking-widest">
          Credit Control Daily
        </p>
        <h1 className="text-theme-strong mt-1 text-2xl font-semibold">Forgot your password?</h1>
        <p className="text-theme-muted mt-2 text-sm leading-relaxed">
          Passwords are managed locally by your system administrator — there is no self-service
          email reset. Follow these three steps:
        </p>

        <ol className="mt-6 space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="bg-theme border-theme text-theme-strong flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
                {i + 1}
              </span>
              <div>
                <h2 className="text-theme-strong flex items-center gap-2 text-sm font-semibold">
                  <s.icon className="h-4 w-4 text-indigo-400" aria-hidden />
                  {s.title}
                </h2>
                <p className="text-theme-muted mt-1 text-sm leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="border-theme mt-8 flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-indigo-400" aria-hidden />
          <p className="text-theme-muted text-sm">
            Your password is stored only as a hash and is never visible to anyone, including
            administrators.
          </p>
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
