// Shared-secret gate for the public cron hook routes. The Lovable-era routes
// had NO auth (flagged in BACKEND.md §6); on our infra every caller must send
// x-cron-secret matching the CRON_SECRET worker secret.

import { getSecret } from "./bindings";

export function requireCronAuth(request: Request): Response | null {
  const secret = getSecret("CRON_SECRET");
  if (!secret) return new Response("cron not configured", { status: 503 });
  const got = request.headers.get("x-cron-secret");
  if (got !== secret) return new Response("forbidden", { status: 403 });
  return null;
}
