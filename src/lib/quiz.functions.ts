import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const QuizSchema = z.object({
  vibe: z.string().min(1).max(40).nullable().optional(),
  sleep: z.string().min(1).max(40).nullable().optional(),
  texting: z.string().min(1).max(40).nullable().optional(),
  weekend: z.string().min(1).max(40).nullable().optional(),
  flag: z.string().min(1).max(40).nullable().optional(),
});

export type QuizAnswers = z.infer<typeof QuizSchema>;

export const getMyQuiz = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("quiz_answers")
      .select("vibe, sleep, texting, weekend, flag")
      .eq("user_id", userId)
      .maybeSingle();
    return { answers: (data ?? null) as QuizAnswers | null };
  });

export const saveMyQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => QuizSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = { user_id: userId, ...data, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from("quiz_answers")
      .upsert(payload as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
