import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/backend/bindings";
import { requireCronAuth } from "@/backend/cron-auth";
import { uuid } from "@/backend/rows";
import type { PollRow } from "@/backend/rows";
import { insertNotification } from "@/backend/crush.functions";
import { computeWeeklyRecap } from "@/backend/recap.functions";

// Weekly "Crush of the week" cron — runs Sundays 17:00 UTC via Cron Trigger.
// For each school cohort, picks the most-voted-for handle in the last 7 days
// of polls and records it as the week's anonymous superlative.
export const Route = createFileRoute("/api/public/hooks/weekly-superlative")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;

        const db = getDb();
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

        const { results: polls } = await db
          .prepare("SELECT id, school, question, question_id, created_at FROM polls WHERE created_at >= ?")
          .bind(since)
          .all<Pick<PollRow, "id" | "school" | "question" | "question_id" | "created_at">>();
        if (!polls.length) return Response.json({ created: 0 });

        const ph = polls.map(() => "?").join(",");
        const { results: votes } = await db
          .prepare(`SELECT poll_id, voted_handle FROM poll_votes WHERE poll_id IN (${ph})`)
          .bind(...polls.map((p) => p.id))
          .all<{ poll_id: string; voted_handle: string }>();

        type Tally = Map<string, number>; // handle::questionId → votes
        const byCohort = new Map<string, { tally: Tally; pollMeta: typeof polls }>();
        const pollById = new Map(polls.map((p) => [p.id, p]));
        for (const p of polls) {
          const k = p.school ?? "unknown";
          if (!byCohort.has(k)) byCohort.set(k, { tally: new Map(), pollMeta: [] });
          byCohort.get(k)!.pollMeta.push(p);
        }
        for (const v of votes) {
          const p = pollById.get(v.poll_id);
          if (!p) continue;
          const bucket = byCohort.get(p.school ?? "unknown");
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
          const meta = pollMeta.find((p) => (p.question_id ?? p.id) === questionKey);
          if (!meta) continue;
          try {
            await db
              .prepare(
                "INSERT INTO weekly_superlatives (id, school, week_start, question_id, question, winner_handle, votes) VALUES (?, ?, ?, ?, ?, ?, ?)",
              )
              .bind(
                uuid(),
                cohort === "unknown" ? null : cohort,
                weekStart,
                meta.question_id,
                meta.question,
                handle,
                bestVotes,
              )
              .run();
            created++;
          } catch {
            // unique (school, week_start, question_id) — already recorded
          }
        }

        // Personal weekly recap push, same Sunday cadence. Only users with a
        // push subscription and something worth reporting get one, so this is a
        // celebratory nudge rather than a blanket weekly ping.
        let recapsPushed = 0;
        const { results: subscribers } = await db
          .prepare("SELECT DISTINCT user_id FROM push_subscriptions")
          .all<{ user_id: string }>();
        for (const { user_id } of subscribers) {
          try {
            const recap = await computeWeeklyRecap(db, user_id);
            const worthSending =
              recap.newMatches + recap.admirers + recap.pollWins + recap.invites > 0;
            if (!worthSending) continue;
            // insertNotification fans out to push via pushCopyFor("weekly_recap").
            await insertNotification(db, user_id, "weekly_recap", { headline: recap.headline });
            recapsPushed++;
          } catch {
            // one user's recap failing must not stop the batch
          }
        }

        return Response.json({ created, recapsPushed });
      },
    },
  },
});
