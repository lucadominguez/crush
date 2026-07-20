import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "@/backend/bindings";
import { uuid } from "@/backend/rows";
import { type StripeEnv, verifyWebhook } from "@/backend/stripe.server";
import type { D1Database } from "@/backend/bindings";

const ALLOWED_PRODUCTS = new Set([
  "god_mode_weekly",
  "hint_pack_5",
  "poll_reveal_one",
  "weekend_boost_one",
  "match_save_one",
]);

// Port of the record_purchase_and_grant RPC: idempotent by (user_id,
// sessionId); one-time grants applied alongside the purchases row.
async function recordOneTime(
  db: D1Database,
  opts: { userId: string; priceId: string; matchId?: string; amountCents: number; sessionId: string },
): Promise<void> {
  if (!ALLOWED_PRODUCTS.has(opts.priceId)) return;

  const existing = await db
    .prepare("SELECT id FROM purchases WHERE user_id = ? AND json_extract(metadata,'$.sessionId') = ? LIMIT 1")
    .bind(opts.userId, opts.sessionId)
    .first();
  if (existing) return; // already recorded — idempotent success

  const metadata = JSON.stringify(
    opts.matchId ? { sessionId: opts.sessionId, matchId: opts.matchId } : { sessionId: opts.sessionId },
  );
  const stmts = [
    db
      .prepare("INSERT INTO purchases (id, user_id, product, amount_cents, metadata) VALUES (?, ?, ?, ?, ?)")
      .bind(uuid(), opts.userId, opts.priceId, opts.amountCents ?? 0, metadata),
  ];
  if (opts.priceId === "hint_pack_5") {
    stmts.push(
      db
        .prepare("UPDATE profiles SET hint_credits = COALESCE(hint_credits, 0) + 5 WHERE user_id = ?")
        .bind(opts.userId),
    );
  } else if (opts.priceId === "weekend_boost_one") {
    stmts.push(
      db
        .prepare("UPDATE profiles SET crush_slots = MIN(12, COALESCE(crush_slots, 3) + 3) WHERE user_id = ?")
        .bind(opts.userId),
    );
  } else if (opts.priceId === "match_save_one" && opts.matchId) {
    stmts.push(
      db.prepare("UPDATE matches SET saved = 1, expires_at = NULL WHERE id = ?").bind(opts.matchId),
    );
  }
  // D1 batch is transactional: purchases row + grant land together or not at all.
  await db.batch(stmts);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscription(db: D1Database, sub: any) {
  const userId = sub.metadata?.userId;
  if (!userId) return;
  const item = sub.items?.data?.[0];
  const priceId: string | undefined = item?.price?.lookup_key ?? undefined;
  if (!priceId || !ALLOWED_PRODUCTS.has(priceId)) return;
  const periodEnd: number | undefined = item?.current_period_end ?? sub.current_period_end;

  const status: string = sub.status;
  const activeStatuses = new Set(["active", "trialing"]);
  const paidThroughStatuses = new Set(["canceled", "past_due", "unpaid"]);

  if (priceId === "god_mode_weekly") {
    if (activeStatuses.has(status) && periodEnd) {
      await db
        .prepare("UPDATE profiles SET god_mode_expires_at = ? WHERE user_id = ?")
        .bind(new Date(periodEnd * 1000).toISOString(), userId)
        .run();
    } else if (paidThroughStatuses.has(status)) {
      // Don't shorten paid-through access; only clear once elapsed.
      if (periodEnd && periodEnd * 1000 < Date.now()) {
        await db.prepare("UPDATE profiles SET god_mode_expires_at = NULL WHERE user_id = ?").bind(userId).run();
      }
    }
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = await verifyWebhook(request, env);
          // livemode guard against cross-environment misrouting.
          const evLivemode = (event as unknown as { livemode?: boolean }).livemode;
          if (typeof evLivemode === "boolean" && evLivemode !== (env === "live")) {
            console.error("[payments-webhook] livemode mismatch", { env, evLivemode });
            return Response.json({ received: true, ignored: "livemode mismatch" });
          }

          const db = getDb();
          switch (event.type) {
            case "checkout.session.completed": {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const s = event.data.object as any;
              const meta = s.metadata ?? {};
              const priceId: string | undefined = meta.priceId;
              const userId: string | undefined = meta.userId;
              // Only one-time purchases here; subscriptions are driven by
              // customer.subscription.* events.
              if (
                userId &&
                priceId &&
                ALLOWED_PRODUCTS.has(priceId) &&
                priceId !== "god_mode_weekly" &&
                (s.mode ?? "payment") !== "subscription"
              ) {
                await recordOneTime(db, {
                  userId,
                  priceId,
                  matchId: meta.matchId,
                  amountCents: s.amount_total ?? 0,
                  sessionId: s.id,
                });
              }
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await handleSubscription(db, event.data.object);
              break;
            case "customer.subscription.deleted": {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sub = event.data.object as any;
              const userId = sub.metadata?.userId;
              const item = sub.items?.data?.[0];
              const periodEnd: number | undefined = item?.current_period_end ?? sub.current_period_end;
              if (userId && (!periodEnd || periodEnd * 1000 < Date.now())) {
                await db.prepare("UPDATE profiles SET god_mode_expires_at = NULL WHERE user_id = ?").bind(userId).run();
              }
              break;
            }
            default:
              break;
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("[payments-webhook] error:", e);
          // 400 so Stripe retries — recordOneTime is idempotent.
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
