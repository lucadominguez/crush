import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/backend/bindings";
import { requireCronAuth } from "@/backend/cron-auth";
import { uuid } from "@/backend/rows";

// Daily poll generation — D1 port of the pg_cron'd generate_daily_polls():
// for each school cohort with >=4 handle-bearing users, pick a random active
// question and 4 random handles, insert one poll per (school, day). The
// unique index uniq_polls_daily makes re-runs idempotent.
// Was retired on Lovable (pg_cron called the RPC in-database); on Cloudflare
// a Cron Trigger POSTs here with x-cron-secret.
export const Route = createFileRoute("/api/public/hooks/daily-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;

        const db = getDb();
        const today = new Date().toISOString().slice(0, 10);

        const { results: cohorts } = await db
          .prepare(
            `SELECT school, COUNT(*) AS n FROM profiles
             WHERE school IS NOT NULL AND TRIM(school) <> '' AND handle IS NOT NULL
             GROUP BY school HAVING COUNT(*) >= 4`,
          )
          .all<{ school: string; n: number }>();
        if (!cohorts.length) return Response.json({ created: 0 });

        const { results: questions } = await db
          .prepare("SELECT id, text FROM poll_questions WHERE is_active = 1")
          .all<{ id: string; text: string }>();
        if (!questions.length) return Response.json({ created: 0, reason: "no active questions" });

        let created = 0;
        for (const cohort of cohorts) {
          const q = questions[Math.floor(Math.random() * questions.length)];
          const { results: handles } = await db
            .prepare(
              `SELECT handle FROM profiles
               WHERE school = ? AND handle IS NOT NULL
               ORDER BY RANDOM() LIMIT 4`,
            )
            .bind(cohort.school)
            .all<{ handle: string }>();
          if (handles.length < 4) continue;
          try {
            await db
              .prepare(
                "INSERT INTO polls (id, question, option_handles, created_by, school, question_id, active_date) VALUES (?, ?, ?, NULL, ?, ?, ?)",
              )
              .bind(uuid(), q.text, JSON.stringify(handles.map((h) => h.handle)), cohort.school, q.id, today)
              .run();
            created++;
          } catch {
            // uniq_polls_daily — today's poll already exists for this school
          }
        }

        return Response.json({ created });
      },
    },
  },
});
