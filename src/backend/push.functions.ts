// Push subscription management. The delivery side lives in push.ts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { pushConfigured, sendPush } from "./push";
import { uuid } from "./rows";
import { getSecret } from "./bindings";

/**
 * The VAPID public key the browser needs to subscribe. It is public by
 * definition, but it lives in a Worker secret rather than the bundle so the
 * keypair can be rotated without a rebuild.
 */
export const getPushConfig = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async () => {
    return {
      enabled: pushConfigured(),
      vapidPublicKey: getSecret("VAPID_PUBLIC") ?? null,
    };
  });

const SubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(700),
  p256dh: z.string().trim().min(1).max(200),
  auth: z.string().trim().min(1).max(200),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => SubscribeSchema.parse(input))
  .handler(async ({ data, context }) => {
    // endpoint is UNIQUE: re-subscribing on a device that another account used
    // must move the row, not duplicate it, or the old owner keeps getting the
    // new owner's notifications.
    await context.db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, kind, endpoint, p256dh, auth, failures)
         VALUES (?, ?, 'webpush', ?, ?, ?, 0)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id  = excluded.user_id,
           p256dh   = excluded.p256dh,
           auth     = excluded.auth,
           failures = 0`,
      )
      .bind(uuid(), context.userId, data.endpoint, data.p256dh, data.auth)
      .run();
    return { ok: true as const };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ endpoint: z.string().trim().max(700) }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
      .bind(context.userId, data.endpoint)
      .run();
    return { ok: true as const };
  });

/** Round-trips a real push through the live pipeline so the toggle can prove it works. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const delivered = await sendPush(context.db, context.userId, {
      title: "push is on 🔔",
      body: "this is what a crush notification looks like",
      url: "/app",
      tag: "test",
    });
    return { ok: delivered > 0, delivered };
  });
