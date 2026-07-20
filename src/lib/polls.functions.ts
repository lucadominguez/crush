import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IncomingPollResult = {
  pollId: string;
  question: string;
  votes: number;
  totalVotes: number;
  createdAt: string;
};

// "You were voted X by N people recently" — powered by a SECURITY DEFINER
// aggregate RPC so that anonymity is preserved (no voter IDs, only counts).
export const getMyIncomingPollStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("get_my_incoming_poll_stats" as never);
    if (error) {
      // Surface a safe error so the client can distinguish failure from empty.
      return { ok: false as const, error: "load_failed", results: [] as IncomingPollResult[] };
    }
    const payload = (data as {
      results?: Array<{
        poll_id: string;
        question: string;
        created_at: string;
        votes: number;
        total_votes: number;
      }>;
    } | null) ?? { results: [] };
    const results: IncomingPollResult[] = (payload.results ?? []).map((r) => ({
      pollId: r.poll_id,
      question: r.question,
      votes: r.votes ?? 0,
      totalVotes: r.total_votes ?? 0,
      createdAt: r.created_at,
    }));
    return { ok: true as const, results };
  });


const QuestionSchema = z.object({
  text: z.string().trim().min(5).max(120),
});

export const submitPendingQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => QuestionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // light rate limit: max 3 per 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("pending_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) >= 3) {
      return { ok: false as const, error: "Limit 3 suggestions per day" };
    }
    const { error } = await supabase
      .from("pending_questions")
      .insert({ user_id: userId, text: data.text });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const logPollShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pollId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("poll_share_events")
      .insert({ user_id: userId, poll_id: data.pollId });
    return { ok: true };
  });
