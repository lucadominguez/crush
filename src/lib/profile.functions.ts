import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";


const HIKER = "https://api.hikerapi.com";

async function fetchIGProfile(handle: string) {
  const key = process.env.HIKER_API_KEY;
  if (!key) throw new Error("HIKER_API_KEY is not configured");
  const h = handle.trim().replace(/^@/, "").toLowerCase();
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

// Step 1: claim a handle. Saves snapshot but verified_at remains null.
export const claimInstagramHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ handle: z.string().min(1).max(64) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const handle = data.handle.trim().replace(/^@/, "").toLowerCase();

    // Pull a fresh snapshot (so we store name/avatar/followers at claim time)
    const ig = await fetchIGProfile(handle).catch(() => null);

    const { error } = await supabase
      .from("profiles")
      .update({
        instagram_handle: handle,
        instagram_name: ig?.full_name ?? null,
        instagram_avatar: ig?.profile_pic_url ?? null,
        instagram_followers: ig?.follower_count ?? null,
        instagram_verified_at: null,
        instagram_verify_code: null,
      })
      .eq("user_id", userId);

    if (error) {
      if (error.code === "23505") return { error: "That Instagram handle is already claimed." };
      return { error: error.message };
    }
    return { ok: true };
  });

// Step 2: start verification · generate & store a bio code.
export const startInstagramVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("instagram_handle, instagram_verify_code, instagram_verified_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!prof?.instagram_handle) return { error: "Claim an Instagram handle first." };
    if (prof.instagram_verified_at) return { code: prof.instagram_verify_code ?? "", alreadyVerified: true };

    const code = prof.instagram_verify_code || genCode();
    if (!prof.instagram_verify_code) {
      await supabase
        .from("profiles")
        .update({ instagram_verify_code: code })
        .eq("user_id", userId);
    }
    return { code, handle: prof.instagram_handle };
  });

// Step 3: verify · fetch bio from IG and check for the code.
export const verifyInstagramBio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("instagram_handle, instagram_verify_code, instagram_verified_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!prof?.instagram_handle) return { error: "Claim a handle first." };
    if (prof.instagram_verified_at) return { ok: true, alreadyVerified: true };
    if (!prof.instagram_verify_code) return { error: "Generate a code first." };

    const ig = await fetchIGProfile(prof.instagram_handle).catch(() => null);
    if (!ig) return { error: "Couldn't reach Instagram. Try again." };

    const bio = (ig.biography || "").toLowerCase();
    if (!bio.includes(prof.instagram_verify_code.toLowerCase())) {
      return { error: "Code not found in bio yet. Save your bio and try again." };
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        instagram_verified_at: new Date().toISOString(),
        instagram_verify_code: null,
        instagram_name: ig.full_name ?? null,
        instagram_avatar: ig.profile_pic_url ?? null,
        instagram_followers: ig.follower_count ?? null,
      })
      .eq("user_id", userId);
    if (error) return { error: error.message };
    return { ok: true };
  });

// Report another user (impersonation, abuse). Decreases their trust score.
export const reportUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      reportedUserId: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.reportedUserId === userId) return { error: "You can't report yourself." };
    const { error } = await supabase
      .from("reports")
      .insert({ reporter_id: userId, reported_user_id: data.reportedUserId, reason: data.reason });
    if (error) return { error: error.message };
    return { ok: true };
  });

// Save school + city — used by the onboarding network step.
// School is the killer growth-loop signal (Gas-style cohort feed).
export const updateProfileNetwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      school: z.string().trim().min(1).max(120).nullable().optional(),
      city: z.string().trim().min(1).max(120).nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, string | null> = {};
    if (data.school !== undefined) patch.school = data.school?.trim() || null;
    if (data.city !== undefined) patch.city = data.city?.trim() || null;
    if (Object.keys(patch).length === 0) return { ok: true as const };
    const { error } = await supabase
      .from("profiles")
      .update(patch as never)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Save date of birth + enforce minimum age 13 (COPPA).
export const updateProfileDob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const dob = new Date(data.dob);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 13);
    if (isNaN(dob.getTime()) || dob > cutoff) {
      return { ok: false as const, error: "You must be at least 13 to use Crush." };
    }
    const { error } = await supabase
      .from("profiles")
      .update({ dob: data.dob } as never)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Toggle browser-push opt-in flag (actual delivery handled by service worker/VAPID later).
export const setPushEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({ push_enabled: data.enabled } as never)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

// Hard-delete the current user. Wipes profile/crushes/matches/messages then the auth user.
// GDPR / App Store compliance: users must be able to delete their account.
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Wipe rows the user owns. RLS-bypassing admin client.
    await supabaseAdmin.from("messages").delete().eq("from_user_id", userId);
    await supabaseAdmin.from("matches").delete().or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);
    await supabaseAdmin.from("crushes").delete().eq("owner_id", userId);
    await supabaseAdmin.from("hints").delete().eq("user_id", userId);
    await supabaseAdmin.from("invites").delete().eq("sender_id", userId);
    await supabaseAdmin.from("notifications").delete().eq("user_id", userId);
    await supabaseAdmin.from("poll_votes").delete().eq("user_id", userId);
    await supabaseAdmin.from("poll_share_events").delete().eq("user_id", userId);
    await supabaseAdmin.from("pending_questions").delete().eq("user_id", userId);
    await supabaseAdmin.from("quiz_answers").delete().eq("user_id", userId);
    await supabaseAdmin.from("reports").delete().or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`);
    await supabaseAdmin.from("referrals").delete().or(`referrer_id.eq.${userId},referred_user_id.eq.${userId}`);
    await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
    // Finally remove the auth user. This invalidates the session.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
