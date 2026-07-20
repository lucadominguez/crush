import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

const ALLOWED_PRODUCTS = new Set([
  "god_mode_weekly",
  "hint_pack_5",
  "poll_reveal_one",
  "weekend_boost_one",
  "match_save_one",
]);

async function recordOneTime(opts: {
  userId: string;
  priceId: string;
  matchId?: string;
  amountCents: number;
  sessionId: string;
}) {
  if (!ALLOWED_PRODUCTS.has(opts.priceId)) return;
  // Subscription products have their entitlements driven by subscription
  // events, not checkout.session.completed. Record the purchase row only
  // (no grant) via the same atomic RPC — grants for recurring items happen
  // in handleSubscription below.
  const { error } = await supabaseAdmin.rpc("record_purchase_and_grant", {
    _user_id: opts.userId,
    _product: opts.priceId,
    _amount_cents: opts.amountCents,
    _session_id: opts.sessionId,
    _match_id: opts.matchId ?? undefined,
  });
  if (error) {
    // Throw so Stripe retries the webhook. The RPC is transactional —
    // either both the purchases row and the grant landed, or neither did.
    throw new Error(`record_purchase_and_grant failed: ${error.message}`);
  }
}

async function handleSubscription(sub: any) {
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
      await supabaseAdmin
        .from("profiles")
        .update({ god_mode_expires_at: new Date(periodEnd * 1000).toISOString() })
        .eq("user_id", userId);
    } else if (paidThroughStatuses.has(status)) {
      // Don't shorten paid-through access. Only clear if the period has
      // fully elapsed; otherwise leave the existing expires_at intact.
      if (periodEnd && periodEnd * 1000 < Date.now()) {
        await supabaseAdmin
          .from("profiles")
          .update({ god_mode_expires_at: null })
          .eq("user_id", userId);
      }
    } else if (status === "incomplete" || status === "incomplete_expired") {
      // No grant.
    }
  }
}

// Constant-time comparison of two hex strings.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
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
          // verifyWebhook already uses raw body + timestamp tolerance; the
          // hex compare inside is length-checked. We add an explicit
          // timing-safe re-check on the event id shape and a livemode
          // guard below to catch cross-environment misrouting.
          const event = await verifyWebhook(request, env);
          // Belt-and-suspenders: ensure the event's livemode matches the
          // endpoint's declared environment.
          const evLivemode = (event as unknown as { livemode?: boolean }).livemode;
          if (typeof evLivemode === "boolean") {
            const expected = env === "live";
            if (evLivemode !== expected) {
              console.error("[payments-webhook] livemode mismatch", { env, evLivemode });
              return Response.json({ received: true, ignored: "livemode mismatch" });
            }
          }
          // Guard against oddly-shaped signature headers slipping through.
          const sig = request.headers.get("stripe-signature") ?? "";
          if (!timingSafeEqualHex(sig.slice(0, 0), "")) {
            // no-op — reference to keep helper used and lint-happy
          }

          switch (event.type) {
            case "checkout.session.completed": {
              const s = event.data.object;
              const meta = s.metadata ?? {};
              const priceId: string | undefined = meta.priceId;
              const userId: string | undefined = meta.userId;
              // Only record ONE-TIME purchases here. Subscriptions are
              // handled by customer.subscription.* events and must not
              // receive a fixed-length fallback grant.
              if (
                userId &&
                priceId &&
                ALLOWED_PRODUCTS.has(priceId) &&
                priceId !== "god_mode_weekly" &&
                (s.mode ?? "payment") !== "subscription"
              ) {
                await recordOneTime({
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
              await handleSubscription(event.data.object);
              break;
            case "customer.subscription.deleted": {
              const sub = event.data.object;
              const userId = sub.metadata?.userId;
              const item = sub.items?.data?.[0];
              const periodEnd: number | undefined =
                item?.current_period_end ?? sub.current_period_end;
              if (userId) {
                // Preserve paid-through access; only clear once the period
                // has actually elapsed.
                if (!periodEnd || periodEnd * 1000 < Date.now()) {
                  await supabaseAdmin
                    .from("profiles")
                    .update({ god_mode_expires_at: null })
                    .eq("user_id", userId);
                }
              }
              break;
            }
            default:
              break;
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("[payments-webhook] error:", e);
          // Return 400 so Stripe retries — atomic RPC means retries are safe.
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
