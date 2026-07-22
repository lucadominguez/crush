import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IconCrown } from "@/components/icons/GlyphIcons";
import { getCrushOfWeek, type WeeklySuperlative } from "@/lib/phase5.functions";

// Anonymous superlative — shows the question + vote count, but blurs the
// winner unless that winner is the current user.
export function CrushOfWeekBanner() {
  const fetchIt = useServerFn(getCrushOfWeek);
  const [item, setItem] = useState<WeeklySuperlative | null>(null);

  useEffect(() => {
    fetchIt().then((r) => setItem(r.item));
  }, [fetchIt]);

  if (!item) return null;

  return (
    <div className="mx-5 mt-1 mb-3 card-pop p-4 bg-gradient-to-br from-grape via-accent to-primary">
      <div className="flex items-center gap-2 mb-1.5">
        <IconCrown size={16} />
        <p className="text-nano font-black uppercase tracking-wider opacity-80">
          crush of the week
        </p>
      </div>
      <p className="font-black text-base leading-tight">"{item.question}"</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="px-2 py-1 rounded-full bg-foreground/10 backdrop-blur text-xs font-bold blur-sm select-none">
          @anonymous_winner
        </span>
        <span className="text-xs font-bold opacity-90">won with {item.votes} vote{item.votes === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}
