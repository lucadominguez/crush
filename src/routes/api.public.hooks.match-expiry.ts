import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/backend/bindings";
import { requireCronAuth } from "@/backend/cron-auth";
import { uuid } from "@/backend/rows";
import type { MatchRow } from "@/backend/rows";

// Cron: warn participants 24h before match expiry. Called by a Cloudflare
// Cron Trigger (or manually) with the x-cron-secret header.
export const Route = createFileRoute("/api/public/hooks/match-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronAuth(request);
        if (denied) return denied;

        const db = getDb();
        const now = Date.now();
        const in24h = new Date(now + 86_400_000).toISOString();
        const nowIso = new Date(now).toISOString();

        const { results: expiring } = await db
          .prepare(
            `SELECT id, user_a_id, user_b_id, expires_at FROM matches
             WHERE saved = 0 AND expiry_warned_at IS NULL
               AND expires_at IS NOT NULL AND expires_at <= ? AND expires_at > ?`,
          )
          .bind(in24h, nowIso)
          .all<Pick<MatchRow, "id" | "user_a_id" | "user_b_id" | "expires_at">>();

        let warned = 0;
        for (const m of expiring) {
          const payload = JSON.stringify({ matchId: m.id, expiresAt: m.expires_at });
          await db.batch([
            db
              .prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'match_expiring', ?)")
              .bind(uuid(), m.user_a_id, payload),
            db
              .prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'match_expiring', ?)")
              .bind(uuid(), m.user_b_id, payload),
            db.prepare("UPDATE matches SET expiry_warned_at = ? WHERE id = ?").bind(nowIso, m.id),
          ]);
          warned++;
        }

        return Response.json({ warned });
      },
    },
  },
});
