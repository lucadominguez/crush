import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Flame, Gift, Heart, Loader2, Share2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";

import { getWeeklyRecap, type WeeklyRecap } from "@/lib/recap.functions";
import { shareRecapStory } from "@/lib/recap-story";

const DISMISS_KEY = "crush.recap.dismissed";

/** ISO week key so the card reappears once per new week, not once ever. */
function weekKey(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Personal weekly recap. Shows on the home screen once per week and can be
 * dismissed; dismissal is keyed by ISO week so next week's recap returns.
 * Renders nothing on a truly empty week (no activity to celebrate) so it never
 * nags a brand-new or dormant user.
 */
export function WeeklyRecapCard() {
  const fetchRecap = useServerFn(getWeeklyRecap);
  const [recap, setRecap] = useState<WeeklyRecap | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(localStorage.getItem(DISMISS_KEY) === weekKey());
    }
    fetchRecap().then(setRecap).catch(() => {});
  }, [fetchRecap]);

  if (dismissed || !recap) return null;

  const hasActivity =
    recap.newMatches + recap.admirers + recap.pollWins + recap.invites + recap.picksMade > 0;
  if (!hasActivity) return null;

  const stats = [
    { icon: Heart, label: "matches", value: recap.newMatches },
    { icon: Sparkles, label: "picked you", value: recap.admirers },
    { icon: Trophy, label: "poll votes", value: recap.pollWins },
    { icon: Flame, label: "day streak", value: recap.streak },
    { icon: Gift, label: "invites", value: recap.invites },
  ].filter((s) => s.value > 0);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(DISMISS_KEY, weekKey());
    setDismissed(true);
  }

  async function share() {
    if (!recap || sharing) return;
    setSharing(true);
    try {
      const how = await shareRecapStory(recap);
      if (how === "downloaded") toast.success("saved your recap. share it to your story");
    } catch {
      toast.error("couldn't make your recap image");
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="surface-solid p-4 mb-3 relative overflow-hidden animate-rise">
      <div aria-hidden className="absolute inset-0 opacity-90" style={{ background: "var(--gradient-primary)" }} />
      <div className="relative text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-nano font-black uppercase tracking-wider opacity-80">your week</p>
            <p className="mt-1 font-black text-title lowercase leading-tight">{recap.headline}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={share}
              disabled={sharing}
              className="inline-flex items-center gap-1.5 rounded-full px-3 min-h-11 text-caption font-bold bg-white/25 backdrop-blur-sm disabled:opacity-60"
              aria-label="Share weekly recap to your story"
            >
              {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
              share
            </button>
            <button
              onClick={dismiss}
              className="text-primary-foreground/80 text-caption font-bold min-h-11 px-2"
              aria-label="Dismiss weekly recap"
            >
              done
            </button>
          </div>
        </div>

        {stats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.map((s) => (
              <span
                key={s.label}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-bold bg-white/20 backdrop-blur-sm tabular-nums"
              >
                <s.icon className="size-3.5" />
                {s.value} {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
