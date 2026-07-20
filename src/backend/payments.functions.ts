// Payments domain — D1 port of src/lib/payments.functions.ts.
// Launch-safety state preserved: every product is `available: false`, so the
// server refuses checkout regardless of client requests. Stripe now talks
// directly to api.stripe.com (no Lovable gateway). SANDBOX ONLY until the
// operator explicitly enables live.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { createStripeClient } from "./stripe.server";
import type { ProfileRow, PurchaseRow } from "./rows";

const CATALOG_KEYS = [
  "god_mode_weekly",
  "hint_pack_5",
  "poll_reveal_one",
  "weekend_boost_one",
  "match_save_one",
] as const;
type CatalogKey = (typeof CATALOG_KEYS)[number];

type Capability = {
  label: string;
  available: boolean;
  requiresMatchId?: boolean;
  hiddenFromShop?: boolean;
  planned: string;
};

const CAPABILITIES: Record<CatalogKey, Capability> = {
  god_mode_weekly: {
    label: "God Mode",
    available: false,
    planned: "See who picked you. Recurring cadence & benefits not finalized.",
  },
  hint_pack_5: {
    label: "Hints",
    available: false,
    planned: "Progressive hints toward a secret admirer. Redemption path not wired.",
  },
  poll_reveal_one: {
    label: "Poll reveal",
    available: false,
    planned: "Reveal one voter on a specific poll. Poll-context checkout not wired.",
  },
  weekend_boost_one: {
    label: "Weekend boost",
    available: false,
    planned: "24-hour visibility & extra slots. Time-boxed effect not implemented.",
  },
  match_save_one: {
    label: "Save this match",
    available: false,
    hiddenFromShop: true,
    requiresMatchId: true,
    planned: "Persist an expiring match. Entry lives in a match, not the shop.",
  },
};

function resolveEnv(): "sandbox" | "live" | null {
  const liveOn = process.env.PAYMENTS_LIVE_ENABLED === "1";
  const hasLive = !!process.env.STRIPE_LIVE_API_KEY;
  if (liveOn && hasLive) return "live";
  if (process.env.STRIPE_SANDBOX_API_KEY) return "sandbox";
  return null;
}

type SafeError = "unavailable" | "not_configured" | "not_found" | "internal";

type CatalogItem = {
  key: CatalogKey;
  label: string;
  available: boolean;
  hiddenFromShop: boolean;
  planned: string;
  price: null | {
    amountFormatted: string;
    currency: string;
    interval: "day" | "week" | "month" | "year" | null;
    intervalCount: number | null;
    active: boolean;
    productName: string;
  };
};

function formatAmount(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export const getCatalog = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ env: "sandbox" | "live" | null; items: CatalogItem[] }> => {
    const env = resolveEnv();
    const baseItems: CatalogItem[] = CATALOG_KEYS.map((key) => ({
      key,
      label: CAPABILITIES[key].label,
      available: CAPABILITIES[key].available,
      hiddenFromShop: !!CAPABILITIES[key].hiddenFromShop,
      planned: CAPABILITIES[key].planned,
      price: null,
    }));
    if (!env) return { env: null, items: baseItems };

    try {
      const stripe = createStripeClient(env);
      const prices = await stripe.prices.list({
        lookup_keys: [...CATALOG_KEYS],
        expand: ["data.product"],
        limit: CATALOG_KEYS.length,
      });
      const byKey = new Map(prices.data.map((p) => [p.lookup_key as string, p]));
      const items = baseItems.map((it) => {
        const p = byKey.get(it.key);
        if (!p) return it;
        const productName =
          typeof p.product === "object" && p.product && "name" in p.product
            ? (p.product as { name: string }).name
            : it.label;
        const currency = p.currency || "usd";
        return {
          ...it,
          price: {
            amountFormatted: formatAmount(p.unit_amount, currency),
            currency,
            interval: p.recurring?.interval ?? null,
            intervalCount: p.recurring?.interval_count ?? null,
            active: !!p.active,
            productName,
          } as CatalogItem["price"],
        };
      });
      return { env, items };
    } catch (e) {
      console.error("[payments.getCatalog] stripe list failed", e);
      return { env, items: baseItems };
    }
  });

const RETURN_PATHS = {
  shop: "/app/shop?return=1",
  upgrade: "/app/upgrade?return=1",
} as const;

const CheckoutInput = z.object({
  priceId: z.enum(CATALOG_KEYS),
  returnTo: z.enum(["shop", "upgrade"]).default("shop"),
  metaMatchId: z.string().uuid().optional(),
});

type CheckoutResult = { clientSecret: string } | { error: SafeError };

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: z.input<typeof CheckoutInput>) => CheckoutInput.parse(d))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const cap = CAPABILITIES[data.priceId];
    if (!cap || !cap.available) return { error: "unavailable" };
    if (cap.requiresMatchId && !data.metaMatchId) return { error: "unavailable" };

    const env = resolveEnv();
    if (!env) return { error: "not_configured" };

    try {
      const stripe = createStripeClient(env);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId], limit: 1 });
      const price = prices.data[0];
      if (!price || !price.active) return { error: "not_found" };
      const isRecurring = price.type === "recurring";

      const origin =
        process.env.PUBLIC_APP_ORIGIN ||
        process.env.PUBLIC_ORIGIN ||
        "https://crush-connect.ludomi2502.workers.dev";
      const returnUrl = `${origin.replace(/\/$/, "")}${RETURN_PATHS[data.returnTo]}`;

      const { userId } = context;
      const userRow = await context.db
        .prepare("SELECT email FROM users WHERE id = ?")
        .bind(userId)
        .first<{ email: string }>();
      const email = userRow?.email;

      let customerId: string | undefined;
      if (/^[a-zA-Z0-9_-]+$/.test(userId)) {
        const found = await stripe.customers.search({ query: `metadata['userId']:'${userId}'`, limit: 1 });
        if (found.data.length) customerId = found.data[0].id;
        else if (email) {
          const list = await stripe.customers.list({ email, limit: 1 });
          if (list.data.length) {
            const c = list.data[0];
            await stripe.customers.update(c.id, { metadata: { ...c.metadata, userId } });
            customerId = c.id;
          }
        }
        if (!customerId) {
          const created = await stripe.customers.create({ ...(email && { email }), metadata: { userId } });
          customerId = created.id;
        }
      }

      const meta: Record<string, string> = {
        userId,
        priceId: data.priceId,
        ...(data.metaMatchId && { matchId: data.metaMatchId }),
      };

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: price.id, quantity: 1 }],
        mode: isRecurring ? "subscription" : "payment",
        ui_mode: "embedded_page",
        return_url: returnUrl,
        ...(customerId && { customer: customerId }),
        metadata: meta,
        ...(isRecurring && { subscription_data: { metadata: meta } }),
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (e) {
      console.error("[payments.createCheckoutSession] failed", e);
      return { error: "internal" };
    }
  });

export const getMyEntitlements = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    try {
      const profile = await context.db
        .prepare("SELECT god_mode_expires_at, hint_credits, crush_slots FROM profiles WHERE user_id = ?")
        .bind(context.userId)
        .first<Pick<ProfileRow, "god_mode_expires_at" | "hint_credits" | "crush_slots">>();
      const { results: purchases } = await context.db
        .prepare(
          "SELECT product, amount_cents, created_at, metadata FROM purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
        )
        .bind(context.userId)
        .all<Pick<PurchaseRow, "product" | "amount_cents" | "created_at" | "metadata">>();

      const godUntil = profile?.god_mode_expires_at ? new Date(profile.god_mode_expires_at).getTime() : 0;
      return {
        ok: true as const,
        godMode: godUntil > Date.now(),
        godModeExpiresAt: profile?.god_mode_expires_at ?? null,
        hintCredits: profile?.hint_credits ?? 0,
        crushSlots: profile?.crush_slots ?? 3,
        purchases: purchases.map((p) => ({
          product: p.product,
          amountCents: p.amount_cents,
          createdAt: p.created_at,
        })),
      };
    } catch (e) {
      console.error("[payments.getMyEntitlements] failed", e);
      return { ok: false as const, error: "internal" as SafeError };
    }
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ url: string } | { error: SafeError }> => {
    return { error: "unavailable" };
  });
