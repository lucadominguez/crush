import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// --- Notifications --------------------------------------------------------

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      return { ok: false as const, error: "load_failed", notifications: [] as Notif[] };
    }
    return { ok: true as const, notifications: (data ?? []) as Notif[] };
  });

type Notif = {
  id: string;
  type: string;
  payload: Json;
  read_at: string | null;
  created_at: string;
};

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) return { ok: false as const, error: "update_failed" };
    return { ok: true as const };
  });

// --- Ambient social proof -------------------------------------------------

export const getSchoolStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("school")
      .eq("user_id", userId)
      .maybeSingle();

    const school = me?.school ?? null;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let joinedThisWeek = 0;
    if (school) {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("school", school)
        .gte("created_at", weekAgo);
      joinedThisWeek = count ?? 0;
    }

    const { count: crushesToday } = await supabase
      .from("crushes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo);

    return {
      school,
      joinedThisWeek,
      crushesToday: crushesToday ?? 0,
    };
  });

// --- Daily streak ---------------------------------------------------------

export const touchStreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("streak_count, streak_last_open")
      .eq("user_id", userId)
      .maybeSingle();

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const profAny = prof as { streak_count?: number; streak_last_open?: string | null } | null;
    const last = profAny?.streak_last_open ?? null;
    let count = profAny?.streak_count ?? 0;

    if (last === today) {
      return { streak: count };
    }
    if (last === yesterday) count = count + 1;
    else count = 1;

    await supabase
      .from("profiles")
      .update({ streak_count: count, streak_last_open: today } as never)
      .eq("user_id", userId);

    return { streak: count };
  });
