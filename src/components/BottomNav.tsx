import { Link, useLocation } from "@tanstack/react-router";

import { IconPicks, IconMatches, IconPolls, IconChat, IconYou } from "@/components/icons/NavIcons";

type NavIcon = (p: { size?: number; className?: string }) => React.ReactNode;

const items: { to: string; label: string; icon: NavIcon; exact?: boolean }[] = [
  { to: "/app", label: "picks", icon: IconPicks, exact: true },
  { to: "/app/matches", label: "matches", icon: IconMatches },
  { to: "/app/standings", label: "polls", icon: IconPolls },
  { to: "/app/messages", label: "chat", icon: IconChat },
  { to: "/app/settings", label: "you", icon: IconYou },
];

export function BottomNav() {
  const loc = useLocation();
  return (
    <nav className="sticky bottom-0 z-20 bottom-nav-bar">
      <ul className="grid grid-cols-5 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] gap-1">
        {items.map((it) => {
          const active = it.exact ? loc.pathname === it.to : loc.pathname.startsWith(it.to);
          const Icon = it.icon;
          return (
            <li key={it.to}>
              <Link
                to={it.to}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-11 tap-scale rounded-2xl"
                style={{
                  color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  background: active ? "var(--gradient-primary)" : "transparent",
                  boxShadow: active ? "var(--shadow-pop)" : "none",
                }}
              >
                <Icon size={21} className={active ? "drop-shadow-sm" : ""} />
                <span className={`text-nano lowercase ${active ? "font-bold" : "font-semibold"}`}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
