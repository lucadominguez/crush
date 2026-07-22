import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { IconCrown } from "@/components/icons/GlyphIcons";
import { ScreenHeader } from "@/components/MobileShell";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getCatalog, getMyEntitlements } from "@/lib/payments.functions";

export const Route = createFileRoute("/app/upgrade")({
  head: () => ({ meta: [{ title: "God Mode · Crush" }] }),
  component: UpgradePage,
});

// Honest, planned benefits — clearly labeled, no checkout CTA.
const PLANNED_PERKS = [
  "See who picked you (planned)",
  "Extra pick slots (planned)",
  "Weekend visibility boost (planned)",
];

function UpgradePage() {
  const fetchCatalog = useServerFn(getCatalog);
  const fetchEnts = useServerFn(getMyEntitlements);
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => fetchCatalog() });
  const ents = useQuery({ queryKey: ["entitlements"], queryFn: () => fetchEnts() });

  const god = catalog.data?.items.find((i) => i.key === "god_mode_weekly");
  const env = catalog.data?.env ?? null;
  const active = ents.data?.ok ? ents.data.godMode : false;
  const expiresAt = ents.data?.ok ? ents.data.godModeExpiresAt : null;

  return (
    <>
      <PaymentTestModeBanner env={env} />
      <ScreenHeader title="God Mode" subtitle="Planned upgrade. Not available yet." />
      <div className="px-5 pb-10 space-y-4">
        <section className="surface p-5">
          <div className="flex items-center gap-2">
            <div
              className="size-8 rounded-lg grid place-items-center"
              style={{ background: "color-mix(in oklab, var(--primary) 15%, var(--card))", color: "var(--primary)" }}
            >
              <IconCrown size={17} />
            </div>
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Planned pass</p>
          </div>

          {catalog.isLoading ? (
            <div className="skeleton mt-3 h-8 w-32" aria-busy="true" />
          ) : (
            <p className="mt-3 text-headline font-semibold leading-none tracking-tight text-muted-foreground">
              {god?.price?.amountFormatted ?? "Price TBD"}
              {god?.price?.interval && (
                <span className="text-label font-medium ml-1">
                  / {god.price.intervalCount && god.price.intervalCount > 1 ? `${god.price.intervalCount} ` : ""}
                  {god.price.interval}
                </span>
              )}
            </p>
          )}

          <ul className="mt-5 space-y-2.5">
            {PLANNED_PERKS.map((label) => (
              <li key={label} className="flex items-center gap-3 text-body text-muted-foreground">
                <Check className="size-4 shrink-0 opacity-50" />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          {active ? (
            <div
              className="mt-6 p-3 rounded-lg text-center text-label font-medium"
              style={{
                background: "color-mix(in oklab, var(--success) 15%, var(--card))",
                color: "var(--success)",
              }}
            >
              Active until {expiresAt ? new Date(expiresAt).toLocaleDateString() : "not set"}. Billing management requires
              additional account configuration.
            </div>
          ) : (
            <button
              disabled
              aria-disabled="true"
              className="mt-6 w-full h-12 rounded-lg font-semibold text-lead"
              style={{ background: "var(--muted)", color: "var(--muted-foreground)", cursor: "not-allowed" }}
              title="Not available yet"
            >
              Coming soon
            </button>
          )}
        </section>

        <div className="surface p-4 flex gap-3">
          <Info className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-caption text-muted-foreground">
            We won't sell God Mode until the benefits above are implemented end-to-end and the cadence is confirmed.
            This screen exists so the surface is honest rather than misleading.
          </p>
        </div>

        <Link to="/app/shop" className="surface p-4 flex items-center gap-3 tap-scale">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-body">Planned à la carte perks</p>
            <p className="text-caption text-muted-foreground">Hints, poll reveal, weekend boost.</p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>

        <Link to="/app" className="block text-center text-caption text-muted-foreground py-2 min-h-11">
          Back to Crush
        </Link>
      </div>
    </>
  );
}
