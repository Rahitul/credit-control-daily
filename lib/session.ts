import { createHmac, timingSafeEqual } from "crypto";
import type { Role, SessionUser } from "@/lib/types";

const SECRET = () => process.env.AUTH_SECRET ?? "ccdaily-dev-secret";

export const SESSION_COOKIE = "cc_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24;
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", SECRET()).update(payload).digest());
}

export function createToken(user: SessionUser, remember = false): string {
  const maxAge = remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE;
  const body = b64url(
    JSON.stringify({
      ...user,
      exp: Math.floor(Date.now() / 1000) + maxAge,
    })
  );
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(body).toString("utf8")) as SessionUser & {
      exp: number;
    };
    if (typeof data.exp !== "number" || data.exp * 1000 < Date.now()) return null;
    if (!data.id || !Array.isArray(data.roles)) return null;
    return {
      id: data.id,
      name: data.name,
      email: data.email,
      roles: data.roles as Role[],
      department: data.department,
      // A branch change is signed into the cookie, so it lands on the user's next
      // sign-in. Read defensively: a token minted before the field existed has
      // none, and a hand-edited one must not put a non-string here.
      branchId: typeof data.branchId === "string" ? data.branchId : undefined,
    };
  } catch {
    return null;
  }
}

export function tokenMaxAge(remember: boolean): number {
  return remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE;
}
