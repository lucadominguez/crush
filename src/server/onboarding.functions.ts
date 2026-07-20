// Onboarding + quiz — D1 port of src/lib/onboarding.functions.ts,
// quiz.functions.ts and the claim_handle RPC (full validation incl. reserved
// handles and dot/underscore rules).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { normHandle } from "./auth.functions";
import type { ProfileRow } from "./rows";
import { nowIso, uuid } from "./rows";

const RESERVED = new Set([
  "admin", "root", "support", "help", "api", "app", "crush", "official", "staff",
  "mod", "moderator", "system", "about", "privacy", "terms", "login", "signup",
  "onboarding", "auth", "settings", "me", "you",
]);

export type ClaimHandleResult = { ok: true; handle: string } | { ok: false; error: string };

// Port of claim_handle RPC — identical validation order and error codes.
export function validateHandle(raw: string): { ok: true; handle: string } | { ok: false; code: string } {
  const norm = normHandle(raw);
  if (!norm) return { ok: false, code: "handle_required" };
  if (norm.length < 3 || norm.length > 20) return { ok: false, code: "handle_length" };
  if (!/^[a-z0-9][a-z0-9_.]*[a-z0-9]$/.test(norm)) return { ok: false, code: "handle_chars" };
  if (norm.includes("..") || norm.includes("__")) return { ok: false, code: "handle_chars" };
  if (RESERVED.has(norm)) return { ok: false, code: "handle_reserved" };
  return { ok: true, handle: norm };
}

const HANDLE_ERRORS: Record<string, string> = {
  handle_required: "pick a handle.",
  handle_length: "handles are 3–20 characters.",
  handle_chars: "only letters, numbers, dot and underscore.",
  handle_reserved: "that one's reserved — try another.",
  handle_taken: "that handle is taken.",
  not_authenticated: "sign in first.",
};

export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const data = await context.db
      .prepare(
        "SELECT user_id, name, handle, dob, onboarded_at, handle_confirmed_at, school, city FROM profiles WHERE user_id = ?",
      )
      .bind(context.userId)
      .first<Pick<ProfileRow, "user_id" | "name" | "handle" | "dob" | "onboarded_at" | "handle_confirmed_at" | "school" | "city">>();
    if (!data) return { ok: false as const, error: "profile_missing" };
    const needsName = !data.name || data.name.trim().length < 1;
    const needsHandle = !data.handle_confirmed_at;
    const needsDob = !data.dob;
    const needsNetwork = !data.school && !data.city;
    const complete = !!data.onboarded_at && !needsName && !needsHandle && !needsDob;
    return { ok: true as const, profile: data, needsName, needsHandle, needsDob, needsNetwork, complete };
  });

export const claimHandle = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ handle: z.string().min(1).max(32) }).parse(input))
  .handler(async ({ data, context }): Promise<ClaimHandleResult> => {
    const { db, userId } = context;
    const v = validateHandle(data.handle);
    if (!v.ok) return { ok: false, error: HANDLE_ERRORS[v.code] ?? "couldn't save handle." };

    const current = await db
      .prepare("SELECT handle FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ handle: string }>();
    if (current?.handle === v.handle) {
      await db
        .prepare("UPDATE profiles SET handle_confirmed_at = COALESCE(handle_confirmed_at, ?) WHERE user_id = ?")
        .bind(nowIso(), userId)
        .run();
      return { ok: true, handle: v.handle };
    }

    const taken = await db
      .prepare("SELECT user_id FROM profiles WHERE handle = ? AND user_id <> ?")
      .bind(v.handle, userId)
      .first();
    if (taken) return { ok: false, error: HANDLE_ERRORS.handle_taken };

    try {
      await db
        .prepare("UPDATE profiles SET handle = ?, handle_confirmed_at = ?, updated_at = ? WHERE user_id = ?")
        .bind(v.handle, nowIso(), nowIso(), userId)
        .run();
    } catch {
      return { ok: false, error: HANDLE_ERRORS.handle_taken };
    }
    return { ok: true, handle: v.handle };
  });

export const setDob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const dob = new Date(data.dob + "T00:00:00Z");
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 13);
    if (isNaN(dob.getTime()) || dob > cutoff) {
      return { ok: false as const, error: "you have to be at least 13 to use crush." };
    }
    await context.db
      .prepare("UPDATE profiles SET dob = ?, updated_at = ? WHERE user_id = ?")
      .bind(data.dob, nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

export const setDisplayName = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ name: z.string().trim().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("UPDATE profiles SET name = ?, updated_at = ? WHERE user_id = ?")
      .bind(data.name.trim(), nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const p = await context.db
      .prepare("SELECT name, dob, handle_confirmed_at FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<Pick<ProfileRow, "name" | "dob" | "handle_confirmed_at">>();
    if (!p) return { ok: false as const, error: "profile_missing" };
    if (!p.name?.trim()) return { ok: false as const, error: "add your name first." };
    if (!p.handle_confirmed_at) return { ok: false as const, error: "claim your handle first." };
    if (!p.dob) return { ok: false as const, error: "add your birthday first." };
    await context.db
      .prepare("UPDATE profiles SET onboarded_at = ?, updated_at = ? WHERE user_id = ?")
      .bind(nowIso(), nowIso(), context.userId)
      .run();
    return { ok: true as const };
  });

// --- Quiz ------------------------------------------------------------------

const QuizSchema = z.object({
  vibe: z.string().min(1).max(40).nullable().optional(),
  sleep: z.string().min(1).max(40).nullable().optional(),
  texting: z.string().min(1).max(40).nullable().optional(),
  weekend: z.string().min(1).max(40).nullable().optional(),
  flag: z.string().min(1).max(40).nullable().optional(),
});

export type QuizAnswers = z.infer<typeof QuizSchema>;

export const getMyQuiz = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const data = await context.db
      .prepare("SELECT vibe, sleep, texting, weekend, flag FROM quiz_answers WHERE user_id = ?")
      .bind(context.userId)
      .first<QuizAnswers>();
    return { answers: data ?? null };
  });

export const saveMyQuiz = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => QuizSchema.parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare(
        `INSERT INTO quiz_answers (id, user_id, vibe, sleep, texting, weekend, flag, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           vibe = excluded.vibe, sleep = excluded.sleep, texting = excluded.texting,
           weekend = excluded.weekend, flag = excluded.flag, updated_at = excluded.updated_at`,
      )
      .bind(
        uuid(),
        context.userId,
        data.vibe ?? null,
        data.sleep ?? null,
        data.texting ?? null,
        data.weekend ?? null,
        data.flag ?? null,
        nowIso(),
      )
      .run();
    return { ok: true };
  });

// Icebreakers (port of match.functions.ts) live in matchExtras below to keep
// quiz row access in one module.

type QuizRow = { user_id: string; vibe: string | null; sleep: string | null; texting: string | null; weekend: string | null; flag: string | null };

function buildIcebreakers(mine: QuizRow | null, theirs: QuizRow | null): string[] {
  const out: string[] = [];
  if (mine && theirs) {
    const keys: (keyof Omit<QuizRow, "user_id">)[] = ["vibe", "sleep", "texting", "weekend", "flag"];
    for (const k of keys) {
      const a = mine[k]?.trim();
      const b = theirs[k]?.trim();
      if (a && b && a.toLowerCase() === b.toLowerCase()) {
        if (k === "sleep") out.push(`ok we're both ${a} 😭 what're you usually doing at 2am?`);
        else if (k === "vibe") out.push(`apparently we share the same vibe (${a}) — prove it, what're you listening to rn?`);
        else if (k === "texting") out.push(`fair warning: i was told we're both ${a} texters 😅`);
        else if (k === "weekend") out.push(`saw we both said ${a} for weekends. plans this one?`);
        else if (k === "flag") out.push(`we apparently agree that ${a} is the move. discuss 👀`);
      }
    }
  }
  const fallbacks = [
    "okay i'll start: rate your week 1-10, no explanation needed",
    "hi 👋 what's the most chaotic thing in your camera roll right now?",
    "be honest — coffee, matcha, or energy drink person?",
    "if we were doing one thing tonight, what would it be?",
    "tell me a hot take and i'll tell you mine 🎯",
  ];
  for (const f of fallbacks) {
    if (out.length >= 3) break;
    out.push(f);
  }
  return out.slice(0, 3);
}

export const getMatchIcebreakers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ matchId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const match = await db
      .prepare("SELECT user_a_id, user_b_id FROM matches WHERE id = ?")
      .bind(data.matchId)
      .first<{ user_a_id: string; user_b_id: string }>();
    if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
      return { icebreakers: [] as string[] };
    }
    const otherId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    const { results: rows } = await db
      .prepare("SELECT user_id, vibe, sleep, texting, weekend, flag FROM quiz_answers WHERE user_id IN (?, ?)")
      .bind(userId, otherId)
      .all<QuizRow>();
    const mine = rows.find((r) => r.user_id === userId) ?? null;
    const theirs = rows.find((r) => r.user_id === otherId) ?? null;
    return { icebreakers: buildIcebreakers(mine, theirs) };
  });
