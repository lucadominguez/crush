import { useEffect, useState } from "react";
import { Users, Flame } from "lucide-react";
import { getPublicStats } from "@/backend/profile.functions";

// Real-ish live ticker — fetches signup count once + animates a faux delta.
export function LandingTicker() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicStats()
      .then((res) => {
        if (!cancelled) setCount(res.signups);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // light animation: increment every ~7s while visible
  useEffect(() => {
    if (count === null) return;
    const t = setInterval(() => {
      setCount((c) => (c === null ? c : c + (Math.random() > 0.6 ? 1 : 0)));
    }, 7000);
    return () => clearInterval(t);
  }, [count]);

  const displayCount = count ?? 0;

  return (
    <div className="w-full flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/60 border-2 border-foreground/10 backdrop-blur-sm text-caption font-bold">
      <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      <Users className="size-3.5 shrink-0" />
      <span className="tabular-nums">{displayCount.toLocaleString()}</span>
      <span className="opacity-60">picking right now</span>
      <span className="ml-auto inline-flex items-center gap-1 text-pink-600">
        <Flame className="size-3.5" />
        <span className="tabular-nums">{Math.max(3, Math.round(displayCount * 0.12))}</span>
        <span className="opacity-70">matches today</span>
      </span>
    </div>
  );
}
