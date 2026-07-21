// Crush scheduler Worker.
//
// The main app is a nitro-built Worker whose entry nitro owns, so we cannot
// attach a scheduled() handler there without dropping the last Lovable build
// dependency. This tiny standalone Worker carries the Cron Triggers instead and
// POSTs the app's existing cron hooks with the shared secret. The hooks already
// enforce x-cron-secret, so this Worker only needs the secret and the app URL.
//
// Schedules (see wrangler.toml, all UTC):
//   - daily-poll        every day 15:00
//   - match-expiry      every hour
//   - weekly-superlative Sundays 17:00
//
// Each cron pattern maps to exactly one hook by matching the pattern string, so
// the three fire independently on their own cadence.

interface Env {
  APP_ORIGIN: string; // used only to build the request URL path/host
  CRON_SECRET: string;
  APP: Fetcher; // service binding to the crush-connect worker
}

// Map a fired cron pattern to its hook. Cloudflare echoes back the pattern
// string it stored, which may normalise the day-of-week token (0 / SUN), so we
// match on the stable minute+hour fields rather than the exact string.
function hookForCron(cron: string): string | null {
  const [min, hour] = cron.trim().split(/\s+/);
  if (min === "0" && hour === "15") return "daily-poll";
  if (min === "0" && hour === "17") return "weekly-superlative";
  if (min === "0" && hour === "*") return "match-expiry";
  return null;
}

async function callHook(env: Env, hook: string): Promise<void> {
  const url = `${env.APP_ORIGIN.replace(/\/+$/, "")}/api/public/hooks/${hook}`;
  // Dispatch through the service binding, not a public fetch: two workers.dev
  // Workers on one account cannot reach each other over their public URLs.
  const res = await env.APP.fetch(url, {
    method: "POST",
    headers: { "x-cron-secret": env.CRON_SECRET, "content-type": "application/json" },
    body: "{}",
  });
  const body = await res.text().catch(() => "");
  // Cron logs are visible via `wrangler tail`; a non-2xx is worth shouting about.
  const line = `scheduler: ${hook} -> ${res.status} ${body.slice(0, 200)}`;
  if (res.ok) console.log(line);
  else console.error(line);
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const hook = hookForCron(event.cron);
    if (!hook) {
      console.error(`scheduler: no hook mapped for cron "${event.cron}"`);
      return;
    }
    ctx.waitUntil(callHook(env, hook));
  },

  // A tiny fetch handler so the Worker is reachable for a manual smoke test.
  // GET /run/<hook> fires one hook on demand (still gated by the app's secret).
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/run\/(daily-poll|match-expiry|weekly-superlative)$/);
    if (m) {
      await callHook(env, m[1]);
      return new Response(`ran ${m[1]}\n`);
    }
    return new Response("crush scheduler ok\n");
  },
};
