import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient } from "@/lib/stripe.server";

// ---- Allowlist and capability map (server-authoritative) ----
// Every product listed here has been architecturally reviewed. `available`
// gates checkout — false means the server refuses to create a Session even
// if the client asks. `requiresMatchId` gates required metadata.
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
  available: boolean; // false = shown as "planned", checkout blocked
  requiresMatchId?: boolean;
  hiddenFromShop?: boolean; // needs contextual entry, not a generic shop card
  planned: string; // short honest description of the intended benefit
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

// Server-derived environment. NEVER trust the client. Never silently promote
// to live. Sandbox unless the operator has explicitly configured a live key
// AND opted in via PAYMENTS_LIVE_ENABLED.
function resolveEnv(): "sandbox" | "live" | null {
  const liveOn = process.env.PAYMENTS_LIVE_ENABLED === "1";
  const hasLive = !!process.env.STRIPE_LIVE_API_KEY;
  if (liveOn && hasLive) return "live";
  if (process.env.STRIPE_SANDBOX_API_KEY) return "sandbox";
  return null;
}

// Safe error surface — never leak Stripe/DB internals to the browser.
type SafeError = "unavailable" | "not_configured" | "not_found" | "internal";
function safe<T>(v: T | { error: SafeError }) {
  return v;
}

// ---- Catalog ----
type CatalogItem = {
  key: CatalogKey;
  label: string;
  available: boolean;
  hiddenFromShop: boolean;
  planned: string;
  price: null | {
    amountFormatted: string; // e.g. "$6.99"
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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export const getCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
      // Only fetch allowlisted lookup keys. Bounded, safe.
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
            interval: (p.recurring?.interval as CatalogItem["price"] extends infer _ ? never : never) ?? p.recurring?.interval ?? null,
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

// ---- Checkout ----
// Return path is an allowlisted enum. Server constructs absolute URL from
// request origin to prevent open redirects.
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof CheckoutInput>) => CheckoutInput.parse(d))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const cap = CAPABILITIES[data.priceId];
    if (!cap || !cap.available) return safe({ error: "unavailable" as const });
    if (cap.requiresMatchId && !data.metaMatchId) return safe({ error: "unavailable" as const });

    const env = resolveEnv();
    if (!env) return safe({ error: "not_configured" as const });

    try {
      const stripe = createStripeClient(env);
      const prices = await stripe.prices.list({ lookup_keys: [data.priceId], limit: 1 });
      const price = prices.data[0];
      if (!price || !price.active) return safe({ error: "not_found" as const });
      const isRecurring = price.type === "recurring";

      // Build return URL server-side from a trusted origin.
      const origin =
        process.env.PUBLIC_APP_ORIGIN ||
        process.env.PUBLIC_ORIGIN ||
        "https://crush100.lovable.app";
      const returnUrl = `${origin.replace(/\/$/, "")}${RETURN_PATHS[data.returnTo]}`;

      const { userId, claims } = context;
      const email = (claims.email as string | undefined) ?? undefined;

      // Resolve/create customer with userId metadata (searchable).
      let customerId: string | undefined;
      if (/^[a-zA-Z0-9_-]+$/.test(userId)) {
        const found = await stripe.customers.search({
          query: `metadata['userId']:'${userId}'`,
          limit: 1,
        });
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
          const created = await stripe.customers.create({
            ...(email && { email }),
            metadata: { userId },
          });
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
      return safe({ error: "internal" as const });
    }
  });

// ---- Entitlements (unchanged shape, but return-safe) ----
export const getMyEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      const [{ data: profile }, { data: purchases }] = await Promise.all([
        supabase
          .from("profiles")
          .select("god_mode_expires_at, hint_credits, crush_slots")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("purchases")
          .select("product, amount_cents, created_at, metadata")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const godUntil = profile?.god_mode_expires_at
        ? new Date(profile.god_mode_expires_at).getTime()
        : 0;
      return {
        ok: true as const,
        godMode: godUntil > Date.now(),
        godModeExpiresAt: profile?.god_mode_expires_at ?? null,
        hintCredits: profile?.hint_credits ?? 0,
        crushSlots: profile?.crush_slots ?? 3,
        purchases: (purchases ?? []).map((p) => ({
          product: p.product as string,
          amountCents: p.amount_cents as number,
          createdAt: p.created_at as string,
        })),
      };
    } catch (e) {
      console.error("[payments.getMyEntitlements] failed", e);
      return { ok: false as const, error: "internal" as SafeError };
    }
  });

// Billing portal: intentionally unavailable until account configuration is
// verified. Honest response beats a broken button.
export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ url: string } | { error: SafeError }> => {
    return { error: "unavailable" };
  });
