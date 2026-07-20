import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type QuizRow = {
  user_id: string;
  vibe: string | null;
  sleep: string | null;
  texting: string | null;
  weekend: string | null;
  flag: string | null;
};

const LABELS: Record<string, string> = {
  vibe: "vibe",
  sleep: "sleep schedule",
  texting: "texting style",
  weekend: "weekend energy",
  flag: "🚩/💚 take",
};

// Build send-ready opening lines (not internal hints).
function buildIcebreakers(mine: QuizRow | null, theirs: QuizRow | null): string[] {
  const out: string[] = [];
  if (mine && theirs) {
    const keys: (keyof QuizRow)[] = ["vibe", "sleep", "texting", "weekend", "flag"];
    for (const k of keys) {
      const a = (mine[k] as string | null)?.trim();
      const b = (theirs[k] as string | null)?.trim();
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ matchId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: match, error } = await supabase
      .from("matches")
      .select("user_a_id,user_b_id")
      .eq("id", data.matchId)
      .maybeSingle();
    if (error || !match) return { icebreakers: [] as string[] };
    const otherId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;

    const { data: rows } = await supabase
      .from("quiz_answers")
      .select("user_id,vibe,sleep,texting,weekend,flag")
      .in("user_id", [userId, otherId]);
    const list = (rows ?? []) as QuizRow[];
    const mine = list.find((r) => r.user_id === userId) ?? null;
    const theirs = list.find((r) => r.user_id === otherId) ?? null;
    return { icebreakers: buildIcebreakers(mine, theirs) };
  });
