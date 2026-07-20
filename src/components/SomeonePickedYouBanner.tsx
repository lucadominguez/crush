import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { useMyNotifications } from "@/lib/phase1.hooks";

// One-shot reveal keyed to the newest unread crush notification id.
// - Never reveals sender identity or fabricates state.
// - Ring/glyph pulse fires only when a genuinely new unread arrives.
// - Subsequent renders (theme toggle, focus, etc.) are static.
// - Reduced motion: the animation classes resolve to no-ops via styles.css.
export function SomeonePickedYouBanner({ slotsFilled, slotsTotal }: { slotsFilled: number; slotsTotal: number }) {
  const { unread, unreadCrushCount } = useMyNotifications();

  // Newest unread crush id (list is sorted newest-first by the hook).
  const newestCrushId = unread.find((n) => n.type === "crush_received")?.id ?? null;
  const lastAnimatedId = useRef<string | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!newestCrushId) { lastAnimatedId.current = null; return; }
    if (lastAnimatedId.current === newestCrushId) return;
    lastAnimatedId.current = newestCrushId;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 640);
    return () => clearTimeout(t);
  }, [newestCrushId]);

  if (unreadCrushCount === 0) return null;

  const remaining = Math.max(0, slotsTotal - slotsFilled);
  const cta = remaining > 0
    ? `pick ${remaining} more to find out if it's mutual`
    : "tap to see your picks";

  return (
    <Link
      to="/app/add"
      className="mx-5 mt-1 mb-3 flex items-center gap-3 card-pop p-3 bg-gradient-primary text-foreground"
    >
      <div className="relative size-10 rounded-full bg-background/80 border border-foreground/40 flex items-center justify-center">
        <Eye className="size-5" />
        {pulse && <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst pointer-events-none" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black truncate">
          {unreadCrushCount === 1
            ? "someone just picked you 👀"
            : `${unreadCrushCount} people picked you 👀`}
        </p>
        <p className="text-xs font-medium opacity-80 truncate">{cta}</p>
      </div>
      <span className="text-xs font-black px-3 py-1.5 rounded-full bg-foreground text-background">
        pick →
      </span>
    </Link>
  );
}
