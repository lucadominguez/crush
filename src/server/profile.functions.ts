// Profile domain — D1 port of src/lib/profile.functions.ts (IG claim/verify,
// reports, school/city, dob 13+ gate, push flag, account deletion) plus
// claim_handle and mark_conversation_read RPC ports.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { HANDLE_RE, normHandle } from "./auth.functions";
import type { ProfileRow } from "./rows";
import { nowIso, uuid } from "./rows";

const HIKER = "https://api.hikerapi.com";

async function fetchIGProfile(handle: string) {
  const key = process.env.HIKER_API_KEY;
  if (!key) throw new Error("HIKER_API_KEY is not configured");
  const h = normHandle(handle);
  const res = await fetch(`${HIKER}/v1/user/by/username?username=${encodeURIComponent(h)}`, {
    headers: { accept: "application/json", "x-access-key": key },
  });
  if (!res.ok) throw new Error(`Instagram lookup failed (${res.status})`);
  return (await res.json()) as {
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    follower_count?: number;
    biography?: string;
    is_private?: boolean | null;
  } | null;
}

function genCode(): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `crush-${r}`;
}

// Port of claim_handle RPC: validate + normalize + claim app handle.
export const claimHandleFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ handle: z.string().min(2).max(31) }).parse(input))
  .handler(async ({ data, context }) => {
    const handle = normHandle(data.handle);
    if (!HANDLE_RE.test(handle)) {
      return { ok: false as const, error: "handle must be 2-30 letters, numbers, dots or underscores" };
    }
    const taken = await context.db
      .prepare("SELECT user_id FROM profiles WHERE handle = ? AND user_id <> ?")
      .bind(handle, context.userId)
      .first();
    if (taken) return { ok: false as const, error: "that handle is taken" };
    await context.db
      .prepare("UPDATE profiles SET handle = ?, handle_confirmed_at = ?, updated_at = ? WHERE user_id = ?")
      .bind(handle, nowIso(), nowIso(), context.userId)
      .run();
    return { ok: true as const, handle };
  });

// Step 1: claim an IG handle (snapshot stored; verified_at stays null).
export const claimInstagramHandle = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ handle: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const handle = normHandle(data.handle);

    const taken = await context.db
      .prepare("SELECT user_id FROM profiles WHERE instagram_handle = ? AND user_id <> ?")
      .bind(handle, context.userId)
      .first();
    if (taken) return { error: "That Instagram handle is already claimed." };

    const ig = await fetchIGProfile(handle).catch(() => null);
    await context.db
      .prepare(
        "UPDATE profiles SET instagram_handle = ?, instagram_name = ?, instagram_avatar = ?, instagram_followers = ?, instagram_verified_at = NULL, instagram_verify_code = NULL, updated_at = ? WHERE user_id = ?",
      )
      .bind(handle, ig?.full_name ?? null, ig?.profile_pic_url ?? null, ig?.follower_count ?? null, nowIso(), context.userId)
      .run();
    return { ok: true };
  });

// Step 2: start verification — generate & store a bio code.
export const startInstagramVerification = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const prof = await context.db
      .prepare("SELECT instagram_handle, instagram_verify_code, instagram_verified_at FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<Pick<ProfileRow, "instagram_handle" | "instagram_verify_code" | "instagram_verified_at">>();
    if (!prof?.instagram_handle) return { error: "Claim an Instagram handle first." };
    if (prof.instagram_verified_at) return { code: prof.instagram_verify_code ?? "", alreadyVerified: true };

    const code = prof.instagram_verify_code || genCode();
    if (!prof.instagram_verify_code) {
      await context.db
        .prepare("UPDATE profiles SET instagram_verify_code = ? WHERE user_id = ?")
        .bind(code, context.userId)
        .run();
    }
    return { code, handle: prof.instagram_handle };
  });

// Step 3: verify — fetch bio from IG and check for the code.
export const verifyInstagramBio = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const prof = await context.db
      .prepare("SELECT instagram_handle, instagram_verify_code, instagram_verified_at FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<Pick<ProfileRow, "instagram_handle" | "instagram_verify_code" | "instagram_verified_at">>();
    if (!prof?.instagram_handle) return { error: "Claim a handle first." };
    if (prof.instagram_verified_at) return { ok: true, alreadyVerified: true };
    if (!prof.instagram_verify_code) return { error: "Generate a code first." };

    const ig = await fetchIGProfile(prof.instagram_handle).catch(() => null);
    if (!ig) return { error: "Couldn't reach Instagram. Try again." };

    const bio = (ig.biography || "").toLowerCase();
    if (!bio.includes(prof.instagram_verify_code.toLowerCase())) {
      return { error: "Code not found in bio yet. Save your bio and try again." };
    }

    await context.db
      .prepare(
        "UPDATE profiles SET instagram_verified_at = ?, instagram_verify_code = NULL, instagram_name = ?, instagram_avatar = ?, instagram_followers = ?, updated_at = ? WHERE user_id = ?",
      )
      .bind(nowIso(), ig.full_name ?? null, ig.profile_pic_url ?? null, ig.follower_count ?? null, nowIso(), context.userId)
      .run();
    return { ok: true };
  });

// Report another user. (Trust-score refresh happens on read paths now.)
export const reportUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ reportedUserId: z.string().uuid(), reason: z.string().min(3).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.reportedUserId === context.userId) return { error: "You can't report yourself." };
    await context.db
      .prepare("INSERT INTO reports (id, reporter_id, reported_user_id, reason) VALUES (?, ?, ?, ?)")
      .bind(uuid(), context.userId, data.reportedUserId, data.reason)
      .run();
    return { ok: true };
  });

// School + city (onboarding network step).
export const updateProfileNetwork = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        school: z.string().trim().min(1).max(120).nullable().optional(),
        city: z.string().trim().min(1).max(120).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sets: string[] = [];
    const binds: (string | null)[] = [];
    if (data.school !== undefined) {
      sets.push("school = ?");
      binds.push(data.school?.trim() || null);
    }
    if (data.city !== undefined) {
      sets.push("city = ?");
      binds.push(data.city?.trim() || null);
    }
    if (!sets.length) return { ok: true as const };
    await context.db
      .prepare(`UPDATE profiles SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`)
      .bind(...binds, nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

// DOB + minimum age 13 (COPPA) — port of enforce_min_age.
export const updateProfileDob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const dob = new Date(data.dob);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 13);
    if (isNaN(dob.getTime()) || dob > cutoff) {
      return { ok: false as const, error: "You must be at least 13 to use Crush." };
    }
    await context.db
      .prepare("UPDATE profiles SET dob = ?, updated_at = ? WHERE user_id = ?")
      .bind(data.dob, nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

export const setPushEnabled = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("UPDATE profiles SET push_enabled = ?, updated_at = ? WHERE user_id = ?")
      .bind(data.enabled ? 1 : 0, nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

// Port of mark_conversation_read RPC (participation-checked upsert).
export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ kind: z.enum(["match", "group"]), convId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    if (data.kind === "match") {
      const m = await db
        .prepare("SELECT id FROM matches WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)")
        .bind(data.convId, userId, userId)
        .first();
      if (!m) return { ok: false as const, error: "not_participant" };
    } else {
      const g = await db
        .prepare("SELECT group_id FROM group_members WHERE group_id = ? AND user_id = ?")
        .bind(data.convId, userId)
        .first();
      if (!g) return { ok: false as const, error: "not_participant" };
    }
    await db
      .prepare(
        "INSERT INTO conversation_reads (user_id, kind, conv_id, last_read_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind, conv_id) DO UPDATE SET last_read_at = excluded.last_read_at",
      )
      .bind(userId, data.kind, data.convId, nowIso())
      .run();
    return { ok: true as const };
  });

// GDPR/App-Store account deletion. FK ON DELETE CASCADE clears profiles,
// crushes, messages, notifications, sessions, etc. when the users row goes;
// matches/reports need explicit deletes (reported_user_id has no FK).
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, userId } = context;
    await db.prepare("DELETE FROM matches WHERE user_a_id = ? OR user_b_id = ?").bind(userId, userId).run();
    await db.prepare("DELETE FROM reports WHERE reporter_id = ? OR reported_user_id = ?").bind(userId, userId).run();
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    return { ok: true as const };
  });
