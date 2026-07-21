import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Eye, Heart, MessageCircle, MessagesSquare, Gift, BarChart3, AlertCircle, RefreshCw, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ScreenHeader } from "@/components/MobileShell";
import { useMyNotifications, type Notification } from "@/lib/phase1.hooks";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({ meta: [{ title: "Notifications · Crush" }] }),
  component: NotificationsPage,
});

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function payloadObj(n: Notification): Record<string, unknown> {
  const p = n.payload;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

function routeFor(n: Notification): string | null {
  const p = payloadObj(n);
  switch (n.type) {
    case "crush_received": return "/app/add";
    case "match_created": {
      const id = p.match_id; return isUuid(id) ? `/app/match/${id}` : "/app/matches";
    }
    case "message_received": {
      const id = p.match_id; return isUuid(id) ? `/app/match/${id}` : "/app/messages";
    }
    case "group_message_received": {
      const id = p.group_id; return isUuid(id) ? `/app/group/${id}` : "/app/messages";
    }
    case "poll_voted_for": return "/app/standings";
    case "referral_joined": return "/app";
    default: return null;
  }
}

type Meta = { icon: LucideIcon; title: string; sub: (n: Notification) => string; tone: string };

const META: Record<string, Meta> = {
  crush_received:         { icon: Eye,             title: "someone picked you",         sub: () => "tap to add more picks and find out if it's mutual", tone: "primary" },
  match_created:          { icon: Heart,           title: "it's mutual 💘",             sub: () => "open the chat and say hi", tone: "primary" },
  message_received:       { icon: MessageCircle,   title: "new message",                sub: () => "tap to read it", tone: "accent" },
  group_message_received: { icon: MessagesSquare,  title: "new group message",          sub: () => "tap to open the group", tone: "accent" },
  poll_voted_for:         { icon: BarChart3,       title: "someone voted for you",      sub: () => "polls are anonymous. tap to see", tone: "primary" },
  referral_joined:        { icon: Gift,            title: "a friend joined",            sub: (n) => (payloadObj(n).milestone ? "you just unlocked +1 pick slot" : "keep going. 3 friends = +1 slot"), tone: "accent" },
};

function metaFor(n: Notification): Meta {
  return META[n.type] ?? { icon: Sparkles, title: n.type.replace(/_/g, " "), sub: () => "", tone: "muted" };
}

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return "";
}

function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NotificationsPage() {
  const { items, unread, markRead, loading, error, refresh } = useMyNotifications();
  const nav = useNavigate();
  const markedOnce = useRef(false);

  // Mark the initial visible batch read AFTER first render, once we have items.
  // A failed write does not remove unread styling — badge stays honest.
  useEffect(() => {
    if (loading || error || markedOnce.current || unread.length === 0) return;
    markedOnce.current = true;
    const ids = unread.slice(0, 30).map((n) => n.id);
    const t = setTimeout(() => { markRead(ids); }, 900);
    return () => clearTimeout(t);
  }, [loading, error, unread, markRead]);

  const { today, earlier } = useMemo(() => {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const t: Notification[] = []; const e: Notification[] = [];
    for (const n of items) {
      (new Date(n.created_at).getTime() >= midnight.getTime() ? t : e).push(n);
    }
    return { today: t, earlier: e };
  }, [items]);

  const total = items.length;
  const subtitle = loading ? "loading…" : error ? "couldn't load" : total ? `${unread.length} unread · ${total} total` : "all caught up";

  return (
    <>
      <ScreenHeader title="notifications" subtitle={subtitle} />
      <div className="px-4 pb-8">
        {loading && <SkeletonList />}

        {!loading && error && (
          <div className="surface p-5 text-center">
            <AlertCircle className="size-5 mx-auto text-muted-foreground" />
            <p className="mt-2 font-semibold text-body">couldn't load notifications</p>
            <p className="text-caption text-muted-foreground">check your connection and try again</p>
            <button
              onClick={refresh}
              className="mt-3 min-h-11 px-4 rounded-xl bg-foreground text-background font-semibold text-label inline-flex items-center gap-2"
            >
              <RefreshCw className="size-3.5" /> retry
            </button>
          </div>
        )}

        {!loading && !error && total === 0 && (
          <div className="surface p-8 text-center">
            <div className="size-11 mx-auto rounded-full grid place-items-center" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              <Bell className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-lead">nothing yet</p>
            <p className="mt-1 text-label text-muted-foreground">we'll ping you the moment something happens.</p>
          </div>
        )}

        {!loading && !error && today.length > 0 && (
          <Section label="today">
            {today.map((n) => <Row key={n.id} n={n} onGo={(dest) => nav({ to: dest })} showAbs={false} />)}
          </Section>
        )}
        {!loading && !error && earlier.length > 0 && (
          <Section label="earlier">
            {earlier.map((n) => <Row key={n.id} n={n} onGo={(dest) => nav({ to: dest })} showAbs />)}
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-2">
      <h2 className="px-1 mb-2 text-nano font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ n, onGo, showAbs }: { n: Notification; onGo: (dest: string) => void; showAbs: boolean }) {
  const meta = metaFor(n);
  const Icon = meta.icon;
  const dest = routeFor(n);
  const unread = !n.read_at;
  const sub = meta.sub(n);
  const time = showAbs ? absoluteDate(n.created_at) : timeAgo(n.created_at);

  const content = (
    <>
      <div
        className="size-10 rounded-xl grid place-items-center shrink-0"
        style={{
          background: unread ? "color-mix(in oklab, var(--primary) 12%, var(--card))" : "var(--muted)",
          color: unread ? "var(--primary)" : "var(--muted-foreground)",
        }}
      >
        <Icon className="size-[18px]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-body truncate lowercase">{meta.title}</p>
          <span className="ml-auto text-micro text-muted-foreground shrink-0">{time}</span>
        </div>
        {sub && <p className="text-caption text-muted-foreground line-clamp-2 mt-0.5">{sub}</p>}
      </div>
      {unread && <span className="size-2 rounded-full shrink-0 self-center" style={{ background: "var(--primary)" }} aria-label="Unread" />}
    </>
  );

  const cls =
    "surface w-full text-left px-3 py-2.5 flex items-center gap-3 min-h-[64px] tap-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  if (dest) {
    return (
      <button
        onClick={() => onGo(dest)}
        className={cls}
        style={unread ? { background: "color-mix(in oklab, var(--primary) 6%, var(--card))" } : undefined}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className={cls}
      style={unread ? { background: "color-mix(in oklab, var(--primary) 6%, var(--card))" } : undefined}
    >
      {content}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-1.5 mt-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="surface px-3 py-2.5 flex items-center gap-3 min-h-[64px]">
          <div className="size-10 rounded-xl bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
