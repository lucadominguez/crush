import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------- Invites (sms / share) ------------------------------------
// Tracks an outgoing invite intent. Rate limited 5/day/user. The actual
// SMS/share is done client-side via `sms:` URI or Web Share API — we do NOT
// send anything server-side (avoids SMS-pumping fraud risk per Twilio guidance).

const InviteSchema = z.object({
  phone: z.string().trim().max(32).optional().nullable(),
  targetHandle: z.string().trim().max(64).optional().nullable(),
  channel: z.enum(["sms", "share", "copy"]).default("sms"),
});

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const logInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("invites")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) {
      return { ok: false as const, error: "Daily invite limit reached (5/day)" };
    }
    const phoneHash = data.phone
      ? await sha256Hex(data.phone.replace(/\D/g, ""))
      : null;
    const { error } = await supabase.from("invites").insert({
      sender_id: userId,
      phone_hash: phoneHash,
      target_handle: data.targetHandle ?? null,
      channel: data.channel,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Compose the invite text on the server so we can interpolate the user's
// referral code consistently and bump it later without a client update.
// The client passes the current app origin (window.location.origin) so
// shared links resolve to the running preview / production origin instead
// of a hard-coded domain that may not be configured yet.
const InviteTextSchema = z.object({
  origin: z.string().trim().url().max(200).optional(),
});

export const getMyInviteText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InviteTextSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("referral_code")
      .eq("user_id", userId)
      .maybeSingle();
    const code = (prof?.referral_code as string | null) ?? "";
    const rawOrigin = (data.origin ?? "").replace(/\/+$/, "");
    const origin = rawOrigin && /^https?:\/\//.test(rawOrigin) ? rawOrigin : "";
    const url = origin
      ? code ? `${origin}/?ref=${code}` : origin
      : code ? `https://crush100.lovable.app/?ref=${code}` : "https://crush100.lovable.app";
    return {
      referralCode: code,
      url,
      text: `join me on crush — pick your secret crushes. it's mutual-only, so nobody finds out unless you both picked each other. ${url}`,
    };
  });

// ---------------- Referrals ------------------------------------------------

const ClaimRefSchema = z.object({ code: z.string().trim().min(4).max(12) });

type ClaimRpc = {
  ok: boolean;
  already?: boolean;
  error?: string;
  referrer_total?: number;
  earned_slots?: number;
};

export const claimReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ClaimRefSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rpc, error } = await supabase.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "claim_referral" as any,
      { _code: data.code.toUpperCase() } as never,
    );
    if (error) return { ok: false as const, error: "Couldn't apply that code" };
    const r = (rpc ?? {}) as ClaimRpc;
    if (!r.ok) {
      const map: Record<string, string> = {
        invalid_code: "That code isn't valid",
        self_referral: "You can't refer yourself",
        already_referred: "You've already used a different code",
        profile_not_found: "Profile not ready — try again in a moment",
        not_authenticated: "Please sign in",
        internal_error: "Something went wrong — try again",
      };
      return { ok: false as const, error: map[r.error ?? ""] ?? "Couldn't apply that code" };
    }
    return { ok: true as const, already: !!r.already };
  });

// Idempotently repairs a missing referral row when profiles.referred_by is set
// but no referrals record exists (e.g. from the previous non-atomic flow).
export const repairMissingReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: rpc, error } = await supabase.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "repair_missing_referral" as any,
    );
    if (error) return { ok: false as const };
    const r = (rpc ?? {}) as { ok?: boolean; repaired?: boolean };
    return { ok: !!r.ok, repaired: !!r.repaired };
  });

export const getReferralStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId);
    const n = count ?? 0;
    // Base = 3 slots, +1 per 3 referrals, hard-capped at 8 → max 5 earned slots (15 referrals).
    const MAX_EARNED = 5;
    const earned = Math.min(MAX_EARNED, Math.floor(n / 3));
    const maxed = earned >= MAX_EARNED;
    const nextAt = maxed ? n : (earned + 1) * 3;
    const toNext = maxed ? 0 : nextAt - n;
    const currentMilestone = earned * 3;
    return {
      total: n,
      currentMilestone,
      nextRewardAt: nextAt,
      toNext,
      slotsEarned: earned,
      maxed,
    };
  });



// ---------------- Hints ----------------------------------------------------
// First hint = FREE after the user has sent ≥1 crush (the hook).
// Hints 2-3 unlock once all slots are filled (and no match yet).
// Hints reveal context (school, mutuals, account tenure) — never identity.

export const getMyHintEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: prof }, { count: crushCount }, { count: matchCount }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("crush_slots")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("crushes")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId),
        supabase
          .from("matches")
          .select("id", { count: "exact", head: true })
          .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
      ]);
    const slots = (prof?.crush_slots as number | undefined) ?? 3;
    const filled = crushCount ?? 0;
    const matches = matchCount ?? 0;
    // Tier 1: free first hint after picking anyone, no match yet.
    const eligible = filled >= 1 && matches === 0;
    // Tier 2: deeper hints once committed (all slots picked).
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

const HintSchema = z.object({ targetHandle: z.string().trim().min(1).max(64) });

// Build a hint about a specific crush target. Idempotent per (user, handle, index).
export const revealHint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => HintSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const handle = data.targetHandle.replace(/^@/, "").toLowerCase();

    // gate: must be eligible
    const [{ data: prof }, { count: crushCount }, { count: matchCount }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("crush_slots, school")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("crushes")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId),
        supabase
          .from("matches")
          .select("id", { count: "exact", head: true })
          .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
      ]);
    const slots = (prof?.crush_slots as number | undefined) ?? 3;
    const filled = crushCount ?? 0;
    if (filled < 1 || (matchCount ?? 0) > 0) {
      return { ok: false as const, error: "Not eligible for hints yet" };
    }

    // existing hints for this target
    const { data: existing } = await supabase
      .from("hints")
      .select("hint_index, hint_text")
      .eq("user_id", userId)
      .eq("target_handle", handle)
      .order("hint_index", { ascending: true });
    const used = existing ?? [];
    const nextIndex = used.length;
    if (nextIndex >= 3) {
      return { ok: true as const, hints: used, exhausted: true };
    }
    // Hints 2 & 3 require all slots filled — first is free.
    if (nextIndex >= 1 && filled < slots) {
      return { ok: false as const, error: "Fill all your crush slots to unlock deeper hints" };
    }

    // Build a context-only fact about the target.
    let text = "";
    if (nextIndex === 0) {
      const { data: tProf } = await supabase
        .from("profiles")
        .select("school, created_at")
        .eq("handle", handle)
        .maybeSingle();
      if (!tProf) {
        text = "They haven't joined yet. Sending them an invite makes the strongest signal.";
      } else {
        const days = Math.max(
          1,
          Math.round(
            (Date.now() - new Date(tProf.created_at as string).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        );
        text = `They've been on Crush for ${days} day${days === 1 ? "" : "s"}${
          tProf.school ? ` and listed ${tProf.school} as their school` : ""
        }.`;
      }
    } else if (nextIndex === 1) {
      // mutual school count
      const { data: tProf } = await supabase
        .from("profiles")
        .select("school")
        .eq("handle", handle)
        .maybeSingle();
      const sameSchool =
        prof?.school && tProf?.school && prof.school === tProf.school;
      text = sameSchool
        ? `You're in the same school cohort — that doubles the chance the poll shows you to them.`
        : `Different school cohort, so polls won't bring you to each other organically. Tag a mutual friend to nudge.`;
    } else {
      text = `Final nudge: pick 5 more from your school to widen the network. You stop being a guess and start being a pattern.`;
    }

    const { error } = await supabase
      .from("hints")
      .insert({ user_id: userId, target_handle: handle, hint_index: nextIndex, hint_text: text });
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      hints: [...used, { hint_index: nextIndex, hint_text: text }],
      exhausted: nextIndex === 2,
    };
  });

export const listMyHints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ targetHandle: z.string().trim().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const handle = data.targetHandle.replace(/^@/, "").toLowerCase();
    const { data: rows } = await supabase
      .from("hints")
      .select("hint_index, hint_text, created_at")
      .eq("user_id", userId)
      .eq("target_handle", handle)
      .order("hint_index", { ascending: true });
    return { hints: rows ?? [] };
  });

// ---------------- Weekly superlative ---------------------------------------

export type WeeklySuperlative = {
  id: string;
  school: string | null;
  week_start: string;
  question: string;
  winner_handle: string;
  votes: number;
};

export const getCrushOfWeek = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("school")
      .eq("user_id", userId)
      .maybeSingle();
    const school = (me?.school as string | null) ?? null;

    const { data } = await supabase
      .from("weekly_superlatives")
      .select("id, school, week_start, question, winner_handle, votes")
      .eq("school", school ?? "")
      .order("week_start", { ascending: false })
      .limit(1);
    return { item: (data?.[0] as WeeklySuperlative | undefined) ?? null };
  });
