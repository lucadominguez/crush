// Auth server functions (replace supabase.auth.* / GoTrue).
// Port notes:
//  - handle_new_user trigger  -> profile row created here, same transaction
//  - generate_referral_code   -> generated here (retry on collision)
//  - email verification       -> NOT ported yet (no email provider); users are
//    active immediately. See OUTSTANDING.md.

import { createServerFn } from "@tanstack/react-start";
import { setCookie, deleteCookie, getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { getDb } from "./bindings";
import type { ProfileRow } from "./rows";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  hashPassword,
  readSessionCookie,
  verifyPassword,
} from "./auth";
import { optionalAuth } from "./auth-middleware";
import { backfillEscrowClaims } from "./crush.functions";

export const HANDLE_RE = /^[a-z0-9._]{2,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normHandle(h: string): string {
  return h.trim().toLowerCase().replace(/^@+/, "");
}

function newReferralCode(): string {
  // UPPERCASE to match the PG generator; claim_referral uppercases input.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusable 0/O/1/L/I
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

const cookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  setCookie(SESSION_COOKIE, token, { ...cookieOpts, expires: new Date(expiresAt) });
}

export type SessionUser = {
  userId: string;
  email: string;
};

export const signUpFn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        handle: z.string().min(2).max(31),
        email: z.string().trim().toLowerCase().regex(EMAIL_RE, "invalid email"),
        password: z.string().min(6).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const handle = normHandle(data.handle);
    if (!HANDLE_RE.test(handle)) return { error: "handle must be 2-30 letters, numbers, dots or underscores" };

    const emailTaken = await db.prepare("SELECT id FROM users WHERE email = ?").bind(data.email).first();
    if (emailTaken) return { error: "an account with this email already exists" };
    const handleTaken = await db.prepare("SELECT id FROM profiles WHERE handle = ?").bind(handle).first();
    if (handleTaken) return { error: "that handle is taken" };

    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);

    // referral codes: retry a few times on the (astronomically rare) collision
    for (let attempt = 0; ; attempt++) {
      const code = newReferralCode();
      try {
        await db.batch([
          db
            .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
            .bind(userId, data.email, passwordHash),
          db
            .prepare(
              // trust_score explicit: the deployed table kept an old DEFAULT 50;
              // schema.sql says 0 (PG parity). Recompute overwrites it anyway.
              "INSERT INTO profiles (id, user_id, name, handle, referral_code, trust_score) VALUES (?, ?, ?, ?, ?, 0)",
            )
            .bind(profileId, userId, data.name, handle, code),
        ]);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < 3 && msg.includes("referral_code")) continue;
        if (msg.includes("profiles.handle")) return { error: "that handle is taken" };
        if (msg.includes("users.email")) return { error: "an account with this email already exists" };
        throw e;
      }
    }

    // Picks made on this handle before the account existed become
    // "someone picked you" the moment they arrive.
    try { await backfillEscrowClaims(db, userId); } catch { /* never block signup */ }

    await startSession(userId);
    return { ok: true as const, userId };
  });

export const signInFn = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(input),
  )
  .handler(async ({ data }) => {
    const db = getDb();
    const user = await db
      .prepare("SELECT id, password_hash FROM users WHERE email = ?")
      .bind(data.email)
      .first<{ id: string; password_hash: string }>();
    // verify against a dummy hash on unknown email to keep timing uniform
    const ok = user
      ? await verifyPassword(data.password, user.password_hash)
      : (await hashPassword(data.password), false);
    if (!ok || !user) return { error: "wrong email or password" };

    await startSession(user.id);
    return { ok: true as const, userId: user.id };
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const token = request ? readSessionCookie(request) : "";
  if (token) await deleteSession(token);
  deleteCookie(SESSION_COOKIE, cookieOpts);
  return { ok: true as const };
});

export const getMeFn = createServerFn({ method: "GET" })
  .middleware([optionalAuth])
  .handler(async ({ context }): Promise<{ user: SessionUser | null; profile: ProfileRow | null }> => {
    if (!context.userId) return { user: null, profile: null };
    const user = await context.db
      .prepare("SELECT id, email FROM users WHERE id = ?")
      .bind(context.userId)
      .first<{ id: string; email: string }>();
    if (!user) return { user: null, profile: null };
    const profile = await context.db
      .prepare("SELECT * FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<ProfileRow>();
    return { user: { userId: user.id, email: user.email }, profile };
  });
