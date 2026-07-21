import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Gift, ArrowRight } from "lucide-react";
import { getReferralStats } from "@/lib/phase5.functions";

const MAX_EARNED = 5;

export function ReferralProgressBanner({ onOpen }: { onOpen: () => void }) {
  const fetchStats = useServerFn(getReferralStats);
  const [stats, setStats] = useState<{ total: number; toNext: number; slotsEarned: number; maxed: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then((r) => {
        if (cancelled) return;
        setStats({ total: r.total, toNext: r.toNext, slotsEarned: r.slotsEarned, maxed: r.maxed });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchStats]);

  if (loading) {
    return <div className="skeleton mx-5 mt-1 mb-4 h-[60px] rounded-[20px]" />;
  }
  if (!stats) return null;

  const target = stats.total + stats.toNext;
  const pct = target > 0 ? Math.min(100, Math.round((stats.total / target) * 100)) : 0;
  const label = stats.maxed
    ? `max slots unlocked · ${stats.slotsEarned}/${MAX_EARNED} earned`
    : stats.total === 0
      ? "invite 3 friends → +1 pick slot"
      : `${stats.total} invited · ${stats.toNext} more → +1 slot${stats.slotsEarned > 0 ? ` (${stats.slotsEarned} earned)` : ""}`;


  return (
    <button
      onClick={onOpen}
      className="mx-5 mt-1 mb-4 w-[calc(100%-2.5rem)] surface p-3 text-left tap-scale flex items-center gap-3 min-h-11"
      aria-label="Open invite friends sheet"
    >
      <div className="size-10 rounded-full grid place-items-center shrink-0" style={{ background: "color-mix(in oklab, var(--primary) 12%, var(--card))", color: "var(--primary)" }}>
        <Gift className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-bold text-label lowercase truncate">{label}</p>
          <span className="text-nano font-black tracking-wider text-muted-foreground shrink-0">
            {stats.maxed ? `${stats.slotsEarned}/${MAX_EARNED}` : `${stats.total}/${target}`}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
          <div className="h-full transition-all" style={{ width: `${stats.maxed ? 100 : pct}%`, background: "var(--gradient-primary)" }} />
        </div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
