import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Eye, Zap, Sparkles, Info } from "lucide-react";
import { ScreenHeader } from "@/components/MobileShell";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getCatalog, getMyEntitlements } from "@/lib/payments.functions";

export const Route = createFileRoute("/app/shop")({
  head: () => ({ meta: [{ title: "Shop · Crush" }] }),
  component: ShopPage,
});

const PRODUCT_LABELS: Record<string, string> = {
  god_mode_weekly: "God Mode",
  hint_pack_5: "Hints",
  poll_reveal_one: "Poll reveal",
  weekend_boost_one: "Weekend boost",
  match_save_one: "Saved match",
};

const ICONS: Record<string, typeof Lightbulb> = {
  hint_pack_5: Lightbulb,
  poll_reveal_one: Eye,
  weekend_boost_one: Zap,
  god_mode_weekly: Sparkles,
  match_save_one: Sparkles,
};

function ShopPage() {
  const fetchCatalog = useServerFn(getCatalog);
  const fetchEnts = useServerFn(getMyEntitlements);
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => fetchCatalog() });
  const ents = useQuery({ queryKey: ["entitlements"], queryFn: () => fetchEnts() });

  const items = (catalog.data?.items ?? []).filter((it) => !it.hiddenFromShop && it.key !== "god_mode_weekly");
  const env = catalog.data?.env ?? null;

  return (
    <>
      <PaymentTestModeBanner env={env} />
      <ScreenHeader title="Shop" subtitle="À la carte. No subscription." />
      <div className="px-5 pb-28 space-y-3 stagger-tight">
        <div className="surface p-4 flex items-center gap-3">
          <div
            className="size-9 rounded-lg grid place-items-center"
            style={{ background: "color-mix(in oklab, var(--primary) 12%, var(--card))", color: "var(--primary)" }}
          >
            <Lightbulb className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-body">
              You have {ents.data?.ok ? ents.data.hintCredits : 0} hint
              {ents.data?.ok && ents.data.hintCredits === 1 ? "" : "s"}
            </p>
            <p className="text-caption text-muted-foreground">Redemption is coming soon.</p>
          </div>
        </div>

        <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mt-4 mb-1 px-1">
          Planned perks
        </p>

        {catalog.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-[20px]" />
            ))}
          </div>
        ) : catalog.isError ? (
          <div className="surface p-4 text-label">
            Couldn't load the catalog.{" "}
            <button className="underline min-h-11 tap-scale" onClick={() => catalog.refetch()}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="surface p-4 text-label text-muted-foreground">Nothing available right now.</div>
        ) : (
          items.map((it) => {
            const Icon = ICONS[it.key] ?? Sparkles;
            const priceLabel = it.price?.amountFormatted ?? "not set";
            const disabled = !it.available || !it.price?.active;
            return (
              <div key={it.key} className="surface w-full p-3.5 flex items-center gap-3">
                <div
                  className="size-10 rounded-lg grid place-items-center shrink-0"
                  style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-body truncate">{it.label}</p>
                    <p className="font-semibold text-label shrink-0 text-muted-foreground">{priceLabel}</p>
                  </div>
                  <p className="text-caption text-muted-foreground truncate">{it.planned}</p>
                </div>
                <button
                  disabled={disabled}
                  aria-disabled={disabled}
                  className="h-11 px-3 rounded-lg text-caption font-semibold shrink-0"
                  style={{
                    background: "var(--muted)",
                    color: "var(--muted-foreground)",
                    opacity: 0.7,
                    cursor: "not-allowed",
                  }}
                  title="Not available yet"
                >
                  Coming soon
                </button>
              </div>
            );
          })
        )}

        <div className="surface p-4 mt-4 flex gap-3">
          <Info className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-caption text-muted-foreground">
            These items appear in the catalog but their end-to-end redemption isn't wired yet. We won't take payment
            for something the app can't deliver.
          </p>
        </div>

        <div className="surface p-4 mt-2">
          <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Recent purchases
          </p>
          {ents.isLoading ? (
            <div className="skeleton h-4 w-24" />
          ) : !ents.data?.ok ? (
            <p className="text-caption text-muted-foreground">
              Couldn't load history.{" "}
              <button className="underline min-h-11" onClick={() => ents.refetch()}>
                Try again
              </button>
            </p>
          ) : ents.data.purchases.length === 0 ? (
            <p className="text-caption text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {ents.data.purchases.map((p, i) => (
                <li key={i} className="flex items-center justify-between text-caption">
                  <span className="font-medium">{PRODUCT_LABELS[p.product] ?? "Purchase"}</span>
                  <span className="text-muted-foreground">
                    ${(p.amountCents / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
