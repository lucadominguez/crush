import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Server-authoritative view of onboarding progress. Cheap; safe to poll from the shell.
export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, name, handle, dob, onboarded_at, handle_confirmed_at, school, city")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!data) return { ok: false as const, error: "profile_missing" };
    const needsName = !data.name || data.name.trim().length < 1;
    const needsHandle = !data.handle_confirmed_at;
    const needsDob = !data.dob;
    const needsNetwork = !data.school && !data.city;
    const complete = !!data.onboarded_at && !needsName && !needsHandle && !needsDob;
    return {
      ok: true as const,
      profile: data,
      needsName,
      needsHandle,
      needsDob,
      needsNetwork,
      complete,
    };
  });

const HANDLE_ERRORS: Record<string, string> = {
  handle_required: "pick a handle.",
  handle_length: "handles are 3–20 characters.",
  handle_chars: "only letters, numbers, dot and underscore.",
  handle_reserved: "that one's reserved — try another.",
  handle_taken: "that handle is taken.",
  not_authenticated: "sign in first.",
};

// Atomic handle claim via SECURITY DEFINER RPC (see migration).
export const claimHandle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ handle: z.string().min(1).max(32) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("claim_handle", { _new_handle: data.handle });
    if (error) return { ok: false as const, error: HANDLE_ERRORS[error.message] ?? "couldn't save handle." };
    const row = res as { ok: boolean; error?: string; handle?: string };
    if (!row?.ok) return { ok: false as const, error: HANDLE_ERRORS[row?.error ?? ""] ?? "couldn't save handle." };
    return { ok: true as const, handle: row.handle! };
  });

// Awaited server-side dob write. DB trigger enforces >=13.
export const setDob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Extra client-safety check; DB trigger is the source of truth.
    const dob = new Date(data.dob + "T00:00:00Z");
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 13);
    if (isNaN(dob.getTime()) || dob > cutoff) {
      return { ok: false as const, error: "you have to be at least 13 to use crush." };
    }
    const { error } = await supabase
      .from("profiles")
      .update({ dob: data.dob } as never)
      .eq("user_id", userId);
    if (error) {
      if (error.message?.includes("min_age_13")) {
        return { ok: false as const, error: "you have to be at least 13 to use crush." };
      }
      return { ok: false as const, error: "couldn't save your birthday." };
    }
    return { ok: true as const };
  });

// Also lets user save/update their display name once, if missing (OAuth path).
export const setDisplayName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().trim().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("profiles")
      .update({ name: data.name.trim() } as never)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: "couldn't save your name." };
    return { ok: true as const };
  });

// Marks the profile as onboarded. Only succeeds if the required fields are present.
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: p } = await supabase
      .from("profiles")
      .select("name, dob, handle_confirmed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!p) return { ok: false as const, error: "profile_missing" };
    if (!p.name?.trim()) return { ok: false as const, error: "add your name first." };
    if (!p.handle_confirmed_at) return { ok: false as const, error: "claim your handle first." };
    if (!p.dob) return { ok: false as const, error: "add your birthday first." };
    const { error } = await supabase
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() } as never)
      .eq("user_id", userId);
    if (error) return { ok: false as const, error: "couldn't finish setup." };
    return { ok: true as const };
  });
