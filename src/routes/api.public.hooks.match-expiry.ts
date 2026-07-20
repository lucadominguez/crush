import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Cron: warn participants 24h before match expiry, and clean up expired non-saved matches.
export const Route = createFileRoute("/api/public/hooks/match-expiry")({
  server: {
    handlers: {
      POST: async () => {
        const now = Date.now();
        const in24h = new Date(now + 24 * 60 * 60 * 1000).toISOString();
        const nowIso = new Date(now).toISOString();

        // 1) find matches expiring in the next 24h that haven't been warned
        const { data: expiring } = await supabaseAdmin
          .from("matches")
          .select("id,user_a_id,user_b_id,expires_at")
          .eq("saved", false)
          .is("expiry_warned_at", null)
          .not("expires_at", "is", null)
          .lte("expires_at", in24h)
          .gt("expires_at", nowIso);

        let warned = 0;
        for (const m of expiring ?? []) {
          const rows = [m.user_a_id, m.user_b_id].map((uid) => ({
            user_id: uid,
            type: "match_expiring",
            payload: { matchId: m.id, expiresAt: m.expires_at },
          }));
          await supabaseAdmin.from("notifications").insert(rows);
          await supabaseAdmin
            .from("matches")
            .update({ expiry_warned_at: nowIso })
            .eq("id", m.id);
          warned++;
        }

        return Response.json({ warned });
      },
    },
  },
});
