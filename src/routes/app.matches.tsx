import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, MessageCircle, Plus, AlertCircle, Clock } from "lucide-react";
import { ScreenHeader } from "@/components/MobileShell";
import { useMyMatches, type Match } from "@/lib/store";
import { MatchExpiryBadge } from "@/components/MatchExpiryBadge";

export const Route = createFileRoute("/app/matches")({
  head: () => ({ meta: [{ title: "Matches · Crush" }] }),
  component: MatchesPage,
});

function initials(name?: string | null, handle?: string | null) {
  const src = (name ?? handle ?? "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || src[0].toUpperCase();
}

function MatchAvatar({ m }: { m: Match }) {
  const [failed, setFailed] = useState(false);
  const src = m.other?.instagram_avatar && !failed
    ? `/api/ig-avatar?u=${encodeURIComponent(m.other.instagram_avatar)}`
    : null;
  return (
    <div
      className="size-11 rounded-full overflow-hidden grid place-items-center shrink-0"
      style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-[13px] font-semibold">{initials(m.other?.name, m.other?.handle)}</span>
      )}
    </div>
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function MatchesPage() {
  const { data: matches, loading, error, refresh } = useMyMatches();

  const now = Date.now();
  const active = matches.filter((m) => !m.expires_at || new Date(m.expires_at).getTime() > now);
  const fresh = active.filter((m) => !m.last_message_at);
  const chatting = active.filter((m) => m.last_message_at);
  const expiredUnstarted = matches.filter(
    (m) => m.expires_at && new Date(m.expires_at).getTime() <= now && !m.last_message_at,
  );

  const initialLoading = loading && matches.length === 0;

  return (
    <>
      <ScreenHeader
        title="Matches"
        subtitle={
          initialLoading
            ? "loading…"
            : active.length
              ? `${active.length} mutual ${active.length === 1 ? "match" : "matches"}`
              : "you'll see mutual matches here."
        }
      />
      <div className="px-5 pb-8 space-y-6">
        {initialLoading && (
          <ul className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <li key={i} className="surface px-3 py-2.5 flex items-center gap-3 animate-pulse">
                <div className="size-11 rounded-full" style={{ background: "var(--muted)" }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded w-1/2" style={{ background: "var(--muted)" }} />
                  <div className="h-2.5 rounded w-1/3" style={{ background: "var(--muted)" }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!initialLoading && error && (
          <div className="surface p-6 text-center">
            <div
              className="size-10 mx-auto rounded-full grid place-items-center"
              style={{ background: "color-mix(in oklab, var(--destructive) 12%, var(--card))", color: "var(--destructive)" }}
            >
              <AlertCircle className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-[15px]">couldn't load your matches</p>
            <p className="mt-1 text-[13px] text-muted-foreground">check your connection and try again.</p>
            <button
              onClick={() => refresh()}
              className="mt-4 inline-flex px-4 py-2 min-h-10 rounded-lg text-[13px] font-semibold tap-scale"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              try again
            </button>
          </div>
        )}

        {!initialLoading && !error && active.length === 0 && expiredUnstarted.length === 0 && (
          <div className="surface p-8 text-center">
            <div
              className="size-11 mx-auto rounded-full grid place-items-center"
              style={{ background: "color-mix(in oklab, var(--primary) 10%, var(--card))", color: "var(--primary)" }}
            >
              <Sparkles className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-[15px]">no matches yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">the moment two people pick each other, they land here.</p>
            <Link
              to="/app/add"
              className="mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 min-h-11 rounded-lg text-[14px] font-semibold tap-scale"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              <Plus className="size-4" /> add a pick
            </Link>
          </div>
        )}

        {fresh.length > 0 && (
          <section>
            <SectionLabel>New</SectionLabel>
            <MatchList matches={fresh} fresh />
          </section>
        )}

        {chatting.length > 0 && (
          <section>
            <SectionLabel>Chatting</SectionLabel>
            <MatchList matches={chatting} fresh={false} />
          </section>
        )}

        {expiredUnstarted.length > 0 && (
          <section>
            <SectionLabel>Expired · never said hi</SectionLabel>
            <ul className="space-y-1.5">
              {expiredUnstarted.map((m) => (
                <li key={m.id}>
                  <div className="surface px-3 py-2.5 flex items-center gap-3 opacity-70">
                    <MatchAvatar m={m} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[14px] truncate">{m.other?.name ?? "match"}</p>
                      <p className="text-[12px] text-muted-foreground truncate inline-flex items-center gap-1">
                        <Clock className="size-3" /> expired · start a new pick
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
      {children}
    </p>
  );
}

function MatchList({ matches, fresh }: { matches: Match[]; fresh: boolean }) {
  return (
    <ul className="space-y-1.5">
      {matches.map((m) => {
        const ago = timeAgo(m.last_message_at);
        return (
          <li key={m.id}>
            <Link
              to="/app/chat/$id"
              params={{ id: m.id }}
              className="surface px-3 py-2.5 flex items-center gap-3 tap-scale"
            >
              <MatchAvatar m={m} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-[14px] truncate">{m.other?.name ?? "match"}</p>
                  {fresh && <span className="chip chip-primary shrink-0">New</span>}
                </div>
                <p className="text-[12px] text-muted-foreground truncate">
                  {m.other?.handle ? `@${m.other.handle}` : ""}
                  {ago && ` · ${ago}`}
                </p>
              </div>
              <MatchExpiryBadge expiresAt={m.expires_at} />
              <MessageCircle className="size-4 text-muted-foreground shrink-0" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
