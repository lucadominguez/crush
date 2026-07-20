import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Weekly "Crush of the week" cron — runs Sundays 17:00 UTC.
// For each school cohort, picks the most-voted-for handle in the last 7 days
// of polls and records it as the week's anonymous superlative.
export const Route = createFileRoute("/api/public/hooks/weekly-superlative")({
  server: {
    handlers: {
      POST: async () => {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        // load last week's polls and their votes
        const { data: polls, error: pErr } = await supabaseAdmin
          .from("polls")
          .select("id, school, question, question_id, created_at")
          .gte("created_at", since);
        if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
        if (!polls?.length) return Response.json({ created: 0 });

        const pollIds = polls.map((p) => p.id);
        const { data: votes, error: vErr } = await supabaseAdmin
          .from("poll_votes")
          .select("poll_id, voted_handle")
          .in("poll_id", pollIds);
        if (vErr) return Response.json({ error: vErr.message }, { status: 500 });

        // group by school: pick the (handle, question) pair with the most votes
        type Tally = Map<string, number>; // key: handle::questionId → votes
        const byCohort = new Map<string, { tally: Tally; pollMeta: typeof polls }>();
        const pollById = new Map(polls.map((p) => [p.id, p]));
        for (const p of polls) {
          const k = p.school ?? "unknown";
          if (!byCohort.has(k)) byCohort.set(k, { tally: new Map(), pollMeta: [] });
          byCohort.get(k)!.pollMeta.push(p);
        }
        for (const v of votes ?? []) {
          const p = pollById.get(v.poll_id);
          if (!p) continue;
          const k = p.school ?? "unknown";
          const bucket = byCohort.get(k);
          if (!bucket) continue;
          const key = `${v.voted_handle}::${p.question_id ?? p.id}`;
          bucket.tally.set(key, (bucket.tally.get(key) ?? 0) + 1);
        }

        const weekStart = (() => {
          const d = new Date();
          const day = d.getUTCDay(); // 0 = Sunday
          d.setUTCDate(d.getUTCDate() - day);
          return d.toISOString().slice(0, 10);
        })();

        let created = 0;
        for (const [cohort, { tally, pollMeta }] of byCohort) {
          if (!tally.size) continue;
          let bestKey = "";
          let bestVotes = 0;
          for (const [k, n] of tally) {
            if (n > bestVotes) {
              bestVotes = n;
              bestKey = k;
            }
          }
          if (!bestKey) continue;
          const [handle, questionKey] = bestKey.split("::");
          const meta = pollMeta.find(
            (p) => (p.question_id ?? p.id) === questionKey,
          );
          if (!meta) continue;
          const { error } = await supabaseAdmin
            .from("weekly_superlatives")
            .insert({
              school: cohort === "unknown" ? null : cohort,
              week_start: weekStart,
              question_id: meta.question_id,
              question: meta.question,
              winner_handle: handle,
              votes: bestVotes,
            });
          if (!error) created++;
        }

        return Response.json({ created });
      },
    },
  },
});
