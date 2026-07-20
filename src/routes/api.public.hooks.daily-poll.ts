import { createFileRoute } from "@tanstack/react-router";

// Retired. Daily poll generation is now handled by a database-local scheduled
// SECURITY DEFINER function `public.generate_daily_polls()`, called by pg_cron.
// This HTTP hook used to authenticate only with the public anon key and could
// be triggered by anyone — it is intentionally closed and returns 410 Gone.
export const Route = createFileRoute("/api/public/hooks/daily-poll")({
  server: {
    handlers: {
      POST: async () =>
        new Response(
          JSON.stringify({ error: "gone", message: "Endpoint retired — daily polls are generated in-database." }),
          { status: 410, headers: { "Content-Type": "application/json" } },
        ),
      GET: async () => new Response("Gone", { status: 410 }),
    },
  },
});
