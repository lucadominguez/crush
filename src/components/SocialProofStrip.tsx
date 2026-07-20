import { Users, Heart, Flame } from "lucide-react";
import { useSchoolStats } from "@/lib/phase1.hooks";

export function SocialProofStrip({ streak }: { streak: number | null }) {
  const stats = useSchoolStats();
  if (!stats && streak == null) return null;

  const chips: { icon: React.ReactNode; label: string }[] = [];
  if (stats?.school && stats.joinedThisWeek > 0) {
    chips.push({
      icon: <Users className="size-3.5" />,
      label: `${stats.joinedThisWeek} from ${stats.school} this week`,
    });
  }
  if (stats && stats.crushesToday > 0) {
    chips.push({
      icon: <Heart className="size-3.5" />,
      label: `${stats.crushesToday} picks added today`,
    });
  }
  if (streak && streak > 1) {
    chips.push({
      icon: <Flame className="size-3.5" />,
      label: `${streak}-day streak`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="px-5 mt-1 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
      {chips.map((c, i) => (
        <span
          key={i}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full bg-card border-2 border-foreground"
        >
          {c.icon}
          {c.label}
        </span>
      ))}
    </div>
  );
}
