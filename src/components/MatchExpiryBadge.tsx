import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";

function fmt(msLeft: number): string {
  if (msLeft <= 0) return "expired";
  const mins = Math.floor(msLeft / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d left`;
  if (hours >= 1) return `${hours}h left`;
  if (mins >= 1) return `${mins}m left`;
  return "moments left";
}

export function MatchExpiryBadge({
  expiresAt,
  className = "",
}: {
  expiresAt: string | null;
  className?: string;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${className}`}
        style={{ background: "color-mix(in oklab, var(--destructive) 12%, var(--card))", color: "var(--destructive)" }}
      >
        <Hourglass className="size-3" /> expired
      </span>
    );
  }
  const urgent = ms < 24 * 60 * 60 * 1000;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${className}`}
      style={
        urgent
          ? { background: "color-mix(in oklab, var(--destructive) 12%, var(--card))", color: "var(--destructive)" }
          : { background: "var(--muted)", color: "var(--muted-foreground)" }
      }
    >
      <Hourglass className="size-3" />
      {fmt(ms)}
    </span>
  );
}
