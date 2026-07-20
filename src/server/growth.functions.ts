// Growth domain — D1 port of src/lib/phase5.functions.ts:
// invites (log-only; client sends via sms:/share sheet), referrals
// (claim_referral RPC parity incl. slot awards), hints (context-only,
// never identity), weekly superlative.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { normHandle } from "./auth.functions";
import { sha256Hex } from "./auth";
import { insertNotification } from "./crush.functions";
import type { ProfileRow, WeeklySuperlativeRow } from "./rows";
import { uuid } from "./rows";
import type { D1Database } from "./bindings";

// ---------------- Invites --------------------------------------------------

const InviteSchema = z.object({
  phone: z.string().trim().max(32).optional().nullable(),
  targetHandle: z.string().trim().max(64).optional().nullable(),
  channel: z.enum(["sms", "share", "copy"]).default("sms"),
});

export const logInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const countRow = await context.db
      .prepare("SELECT COUNT(*) AS n FROM invites WHERE sender_id = ? AND created_at >= ?")
      .bind(context.userId, since)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= 5) return { ok: false as const, error: "Daily invite limit reached (5/day)" };

    const phoneHash = data.phone ? await sha256Hex(data.phone.replace(/\D/g, "")) : null;
    await context.db
      .prepare("INSERT INTO invites (id, sender_id, phone_hash, target_handle, channel) VALUES (?, ?, ?, ?, ?)")
      .bind(uuid(), context.userId, phoneHash, data.targetHandle ? normHandle(data.targetHandle) : null, data.channel)
      .run();
    return { ok: true as const };
  });

const InviteTextSchema = z.object({ origin: z.string().trim().url().max(200).optional() });

export const getMyInviteText = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => InviteTextSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const prof = await context.db
      .prepare("SELECT referral_code FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<{ referral_code: string | null }>();
    const code = prof?.referral_code ?? "";
    const rawOrigin = (data.origin ?? "").replace(/\/+$/, "");
    const clientOrigin = rawOrigin && /^https?:\/\//.test(rawOrigin) ? rawOrigin : "";
    const fallback = (process.env.PUBLIC_APP_ORIGIN ?? "").replace(/\/+$/, "") || "https://crush-connect.ludomi2502.workers.dev";
    const origin = clientOrigin || fallback;
    const url = code ? `${origin}/?ref=${code}` : origin;
    return {
      referralCode: code,
      url,
      text: `join me on crush — pick your secret crushes. it's mutual-only, so nobody finds out unless you both picked each other. ${url}`,
    };
  });

// ---------------- Referrals ------------------------------------------------

function referralSlotTarget(count: number): number {
  return Math.min(8, 3 + Math.max(0, count) / 3) | 0;
}

const REFERRAL_ERRORS: Record<string, string> = {
  invalid_code: "That code isn't valid",
  self_referral: "You can't refer yourself",
  already_referred: "You've already used a different code",
  profile_not_found: "Profile not ready — try again in a moment",
  not_authenticated: "Please sign in",
  internal_error: "Something went wrong — try again",
};

// Port of claim_referral: link referred_by, one referrals row, slot award
// never decreasing existing allowance, referral_joined notification.
export const claimReferralCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ code: z.string().trim().min(4).max(12) }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const code = data.code.trim().toUpperCase();
    if (code.length < 4 || code.length > 12) {
      return { ok: false as const, error: REFERRAL_ERRORS.invalid_code };
    }

    const me = await db
      .prepare("SELECT referred_by FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ referred_by: string | null }>();
    if (!me) return { ok: false as const, error: REFERRAL_ERRORS.profile_not_found };

    const referrer = await db
      .prepare("SELECT user_id FROM profiles WHERE referral_code = ? LIMIT 1")
      .bind(code)
      .first<{ user_id: string }>();
    if (!referrer) return { ok: false as const, error: REFERRAL_ERRORS.invalid_code };
    if (referrer.user_id === userId) return { ok: false as const, error: REFERRAL_ERRORS.self_referral };
    if (me.referred_by && me.referred_by !== referrer.user_id) {
      return { ok: false as const, error: REFERRAL_ERRORS.already_referred };
    }

    if (!me.referred_by) {
      await db
        .prepare("UPDATE profiles SET referred_by = ? WHERE user_id = ? AND referred_by IS NULL")
        .bind(referrer.user_id, userId)
        .run();
    }

    // exactly one referrals row per referred user (unique referred_user_id)
    const inserted = await db
      .prepare(
        "INSERT INTO referrals (id, referrer_id, referred_user_id) VALUES (?, ?, ?) ON CONFLICT(referred_user_id) DO NOTHING",
      )
      .bind(uuid(), referrer.user_id, userId)
      .run();
    if (inserted.meta.changes > 0) {
      // notify_on_referral trigger parity
      await insertNotification(db, referrer.user_id, "referral_joined", {});
    }

    const countRow = await db
      .prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?")
      .bind(referrer.user_id)
      .first<{ n: number }>();
    const count = countRow?.n ?? 0;
    const target = referralSlotTarget(count);
    await db
      .prepare("UPDATE profiles SET crush_slots = MAX(COALESCE(crush_slots, 3), ?) WHERE user_id = ?")
      .bind(target, referrer.user_id)
      .run();

    return { ok: true as const, already: !!me.referred_by };
  });

// Idempotent repair: profiles.referred_by set but no referrals row.
export const repairMissingReferral = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, userId } = context;
    const me = await db
      .prepare("SELECT referred_by FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ referred_by: string | null }>();
    if (!me?.referred_by) return { ok: true as const, repaired: false };
    const res = await db
      .prepare(
        "INSERT INTO referrals (id, referrer_id, referred_user_id) VALUES (?, ?, ?) ON CONFLICT(referred_user_id) DO NOTHING",
      )
      .bind(uuid(), me.referred_by, userId)
      .run();
    if (res.meta.changes > 0) {
      await insertNotification(db, me.referred_by, "referral_joined", {});
      const countRow = await db
        .prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?")
        .bind(me.referred_by)
        .first<{ n: number }>();
      await db
        .prepare("UPDATE profiles SET crush_slots = MAX(COALESCE(crush_slots, 3), ?) WHERE user_id = ?")
        .bind(referralSlotTarget(countRow?.n ?? 0), me.referred_by)
        .run();
    }
    return { ok: true as const, repaired: res.meta.changes > 0 };
  });

export const getReferralStats = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const countRow = await context.db
      .prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?")
      .bind(context.userId)
      .first<{ n: number }>();
    const n = countRow?.n ?? 0;
    const MAX_EARNED = 5;
    const earned = Math.min(MAX_EARNED, Math.floor(n / 3));
    const maxed = earned >= MAX_EARNED;
    const nextAt = maxed ? n : (earned + 1) * 3;
    return {
      total: n,
      currentMilestone: earned * 3,
      nextRewardAt: nextAt,
      toNext: maxed ? 0 : nextAt - n,
      slotsEarned: earned,
      maxed,
    };
  });

// ---------------- Hints ----------------------------------------------------

async function hintGateCounts(db: D1Database, userId: string) {
  const prof = await db
    .prepare("SELECT crush_slots, school FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Pick<ProfileRow, "crush_slots" | "school">>();
  const crushRow = await db
    .prepare("SELECT COUNT(*) AS n FROM crushes WHERE owner_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  const matchRow = await db
    .prepare("SELECT COUNT(*) AS n FROM matches WHERE user_a_id = ? OR user_b_id = ?")
    .bind(userId, userId)
    .first<{ n: number }>();
  return {
    slots: prof?.crush_slots ?? 3,
    school: prof?.school ?? null,
    filled: crushRow?.n ?? 0,
    matches: matchRow?.n ?? 0,
  };
}

export const getMyHintEligibility = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { slots, filled, matches } = await hintGateCounts(context.db, context.userId);
    const eligible = filled >= 1 && matches === 0;
    const fullyEligible = filled >= slots && matches === 0;
    return {
      eligible,
      fullyEligible,
      freeHintAvailable: eligible && !fullyEligible,
      slotsFilled: filled,
      matches,
      slots,
    };
  });

export const revealHint = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ targetHandle: z.string().trim().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const handle = normHandle(data.targetHandle);

    const { slots, school, filled, matches } = await hintGateCounts(db, userId);
    if (filled < 1 || matches > 0) return { ok: false as const, error: "Not eligible for hints yet" };

    const { results: used } = await db
      .prepare("SELECT hint_index, hint_text FROM hints WHERE user_id = ? AND target_handle = ? ORDER BY hint_index ASC")
      .bind(userId, handle)
      .all<{ hint_index: number; hint_text: string }>();
    const nextIndex = used.length;
    if (nextIndex >= 3) return { ok: true as const, hints: used, exhausted: true };
    if (nextIndex >= 1 && filled < slots) {
      return { ok: false as const, error: "Fill all your crush slots to unlock deeper hints" };
    }

    let text = "";
    if (nextIndex === 0) {
      const tProf = await db
        .prepare("SELECT school, created_at FROM profiles WHERE handle = ?")
        .bind(handle)
        .first<{ school: string | null; created_at: string }>();
      if (!tProf) {
        text = "They haven't joined yet. Sending them an invite makes the strongest signal.";
      } else {
        const days = Math.max(1, Math.round((Date.now() - new Date(tProf.created_at).getTime()) / 86_400_000));
        text = `They've been on Crush for ${days} day${days === 1 ? "" : "s"}${tProf.school ? ` and listed ${tProf.school} as their school` : ""}.`;
      }
    } else if (nextIndex === 1) {
      const tProf = await db
        .prepare("SELECT school FROM profiles WHERE handle = ?")
        .bind(handle)
        .first<{ school: string | null }>();
      const sameSchool = school && tProf?.school && school === tProf.school;
      text = sameSchool
        ? `You're in the same school cohort — that doubles the chance the poll shows you to them.`
        : `Different school cohort, so polls won't bring you to each other organically. Tag a mutual friend to nudge.`;
    } else {
      text = `Final nudge: pick 5 more from your school to widen the network. You stop being a guess and start being a pattern.`;
    }

    await db
      .prepare("INSERT INTO hints (id, user_id, target_handle, hint_index, hint_text) VALUES (?, ?, ?, ?, ?)")
      .bind(uuid(), userId, handle, nextIndex, text)
      .run();
    return {
      ok: true as const,
      hints: [...used, { hint_index: nextIndex, hint_text: text }],
      exhausted: nextIndex === 2,
    };
  });

export const listMyHints = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ targetHandle: z.string().trim().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }) => {
    const handle = normHandle(data.targetHandle);
    const { results } = await context.db
      .prepare(
        "SELECT hint_index, hint_text, created_at FROM hints WHERE user_id = ? AND target_handle = ? ORDER BY hint_index ASC",
      )
      .bind(context.userId, handle)
      .all<{ hint_index: number; hint_text: string; created_at: string }>();
    return { hints: results };
  });

// ---------------- Weekly superlative ---------------------------------------

export const getCrushOfWeek = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const me = await context.db
      .prepare("SELECT school FROM profiles WHERE user_id = ?")
      .bind(context.userId)
      .first<{ school: string | null }>();
    const school = me?.school ?? "";
    const item = await context.db
      .prepare(
        "SELECT id, school, week_start, question, winner_handle, votes FROM weekly_superlatives WHERE COALESCE(school,'') = ? ORDER BY week_start DESC LIMIT 1",
      )
      .bind(school)
      .first<Pick<WeeklySuperlativeRow, "id" | "school" | "week_start" | "question" | "winner_handle" | "votes">>();
    return { item: item ?? null };
  });
