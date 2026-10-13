"use server";

import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { User } from "@/lib/models/User";
import { logActivity } from "@/lib/audit";
import { SESSION_COOKIE, createToken, tokenMaxAge } from "@/lib/session";
import { homeForRoles } from "@/lib/nav";
import type { ActionResult, Role, SessionUser } from "@/lib/types";

export async function login(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  try {
    await db();
    const user = await User.findOne({ email }).lean().exec();
    if (!user || user.status !== "active") {
      return { ok: false, error: "Invalid email or password." };
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { ok: false, error: "Invalid email or password." };
    }

    const session: SessionUser = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      roles: user.role as Role[],
      department: user.department,
      // Baked into the signed token, so an admin's branch change reaches this
      // user on their next sign-in rather than instantly.
      branchId: user.branchId ? String(user.branchId) : undefined,
    };

    const store = await cookies();
    // `secure: true` makes browsers DROP the cookie when the site is served
    // over plain http:// (the LAN deploy at <server-ip>:8002) — login then
    // silently bounces back to "/" with no server-side error. Decide from the
    // actual request instead of NODE_ENV: https directly or via a proxy
    // (x-forwarded-proto), or forced with SESSION_COOKIE_SECURE=true.
    const requestProto = (await headers())
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim()
      .toLowerCase();
    const secure =
      requestProto === "https" || process.env.SESSION_COOKIE_SECURE === "true";
    store.set(SESSION_COOKIE, createToken(session, remember), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: tokenMaxAge(remember),
    });

    await logActivity({
      user: session,
      action: "login",
      module: "auth",
      detail: `${user.email} signed in`,
    });

    return { ok: true, home: homeForRoles(session.roles) };
  } catch (err) {
    console.error("login error", err);
    return { ok: false, error: "Unable to sign in right now. Is MongoDB running?" };
  }
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  const { verifyToken } = await import("@/lib/session");
  const user = verifyToken(token);
  if (user) {
    await logActivity({
      user,
      action: "logout",
      module: "auth",
      detail: `${user.email} signed out`,
    });
  }
}
