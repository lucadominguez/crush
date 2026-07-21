import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  MessageCircle,
  Share2,
  Home,
  BadgeCheck,
  Copy,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import { useMatch, useMyProfile, useSession, sendMessage, type Match, type Profile } from "@/lib/store";
import { celebrateMatch, shareMatch } from "@/lib/match-effects";
import { getMatchIcebreakers } from "@/lib/match.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/app/match/$id")({
  head: () => ({ meta: [{ title: "it's mutual · crush" }] }),
  component: MatchReveal,
});

function initialsOf(name: string | null | undefined, handle: string | null | undefined): string {
  const src = (name ?? handle ?? "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  return letters || src[0].toUpperCase();
}

function Avatar({ p, size = 88 }: { p: Pick<Profile, "name" | "handle" | "emoji" | "instagram_avatar"> | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = p?.instagram_avatar && !failed
    ? `/api/ig-avatar?u=${encodeURIComponent(p.instagram_avatar)}`
    : null;
  return (
    <div
      className="rounded-full overflow-hidden grid place-items-center shrink-0"
      style={{
        width: size,
        height: size,
        background: "var(--muted)",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 2px rgb(0 0 0 / 0.04)",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-2xl font-semibold" style={{ color: "var(--muted-foreground)" }}>
          {p?.emoji ?? initialsOf(p?.name, p?.handle)}
        </span>
      )}
    </div>
  );
}

function CenterState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center px-6"
      style={{ paddingTop: "max(env(safe-area-inset-top), 1.5rem)", paddingBottom: "max(env(safe-area-inset-bottom), 1.5rem)" }}
    >
      <div className="max-w-sm">
        <p className="text-lg font-semibold">{title}</p>
        {body && <p className="mt-2 text-body text-muted-foreground">{body}</p>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function MatchReveal() {
  const { id } = useParams({ from: "/app/match/$id" });
  const { session, loading: sessionLoading } = useSession();
  const { data: match, loading, error, refresh } = useMatch(id);
  const { data: me } = useMyProfile();

  // Loading gate: only render the reveal after we've confirmed the current
  // user is a participant of an existing match. Otherwise show explicit
  // loading/not-found/error/expired states.
  const uid = session?.user.id;
  const isParticipant = !!(match && uid && (match.user_a_id === uid || match.user_b_id === uid));

  if (sessionLoading || loading) {
    return (
      <MobileShell>
        <CenterState
          title="loading your match…"
          body="hold tight. checking that this is really yours."
          action={<Loader2 className="size-5 mx-auto animate-spin text-muted-foreground" />}
        />
      </MobileShell>
    );
  }

  if (error) {
    return (
      <MobileShell>
        <CenterState
          title="couldn't load this match"
          body={"check your connection and try again."}
          action={
            <button
              onClick={() => refresh()}
              className="inline-flex px-5 py-2.5 min-h-11 rounded-lg text-body font-semibold tap-scale"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              try again
            </button>
          }
        />
      </MobileShell>
    );
  }

  if (!match || !isParticipant) {
    return (
      <MobileShell>
        <CenterState
          title="match not found"
          body="this link might be old, or it's not for you."
          action={
            <Link
              to="/app"
              className="inline-flex px-5 py-2.5 min-h-11 rounded-lg text-body font-semibold tap-scale"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              back home
            </Link>
          }
        />
      </MobileShell>
    );
  }

  const now = Date.now();
  const isExpired = !!match.expires_at && new Date(match.expires_at).getTime() <= now;
  if (isExpired && !match.last_message_at) {
    return (
      <MobileShell>
        <CenterState
          title="this mutual expired"
          body="you didn't say hi in time, but new picks are always open."
          action={
            <div className="flex flex-col gap-2 items-center">
              <Link
                to="/app/matches"
                className="inline-flex px-5 py-2.5 min-h-11 rounded-lg text-body font-semibold tap-scale"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                see other matches
              </Link>
              <Link
                to="/app"
                className="inline-flex px-4 py-2 text-label text-muted-foreground"
              >
                back home
              </Link>
            </div>
          }
        />
      </MobileShell>
    );
  }

  return <ConfirmedReveal id={id} match={match} me={me} />;
}

function ConfirmedReveal({ id, match, me }: { id: string; match: Match; me: Profile | null }) {
  const other = match.other;
  const nav = useNavigate();
  const fetchIce = useServerFn(getMatchIcebreakers);
  const [icebreakers, setIcebreakers] = useState<string[] | null>(null);
  const [iceError, setIceError] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const celebratedRef = useRef(false);

  // Celebrate exactly once, after we know it's a valid mutual.
  useEffect(() => {
    if (celebratedRef.current) return;
    celebratedRef.current = true;
    celebrateMatch();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIceError(false);
    fetchIce({ data: { matchId: id } })
      .then((r) => { if (!cancelled) setIcebreakers(r.icebreakers ?? []); })
      .catch(() => { if (!cancelled) { setIcebreakers([]); setIceError(true); } });
    return () => { cancelled = true; };
  }, [id, fetchIce]);

  const dateStr = useMemo(() => {
    const d = match.created_at ? new Date(match.created_at) : new Date();
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }, [match.created_at]);

  async function onShare() {
    setSharing(true);
    try {
      // Privacy-first: payload is generic — no name/handle/avatar/date/school.
      const r = await shareMatch();
      if (r.ok) {
        toast.success(r.copied ? "copied invite link" : "shared");
      }
      // Cancellation is silent.
    } finally {
      setSharing(false);
    }
  }

  async function useIcebreaker(text: string, mode: "send" | "copy") {
    if (mode === "copy") {
      try {
        await navigator.clipboard.writeText(text);
        toast.success("copied");
      } catch {
        toast.error("couldn't copy");
      }
      return;
    }
    setSending(text);
    const r = await sendMessage(id, text);
    setSending(null);
    if (r.error) { toast.error("couldn't send. try again"); return; }
    nav({ to: "/app/chat/$id", params: { id } });
  }

  const otherName = other?.name?.trim() || (other?.handle ? `@${other.handle}` : "your match");

  return (
    <MobileShell>
      <div
        className="flex-1 flex flex-col px-5"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 1.25rem)",
          paddingBottom: "max(env(safe-area-inset-bottom), 1.25rem)",
        }}
      >
        <div className="pt-4 flex justify-center">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-micro font-semibold"
            style={{
              background: "color-mix(in oklab, var(--primary) 12%, var(--card))",
              color: "var(--primary)",
              border: "1px solid color-mix(in oklab, var(--primary) 22%, transparent)",
            }}
          >
            <Sparkles className="size-3.5" /> it's mutual
          </span>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Avatar p={me} />
          <span className="text-2xl" aria-hidden>💛</span>
          <Avatar p={other} />
        </div>

        <div className="mt-5 text-center">
          <h1 className="text-headline leading-tight font-bold tracking-tight">
            you & <span className="break-words">{otherName}</span>
          </h1>
          {other?.handle && (
            <p className="mt-1 text-label text-muted-foreground inline-flex items-center gap-1 justify-center">
              @{other.handle}
              {other.instagram_verified_at && <BadgeCheck className="size-3.5" />}
            </p>
          )}
          <p className="mt-2 text-caption text-muted-foreground">picked each other on {dateStr}</p>
        </div>

        <section className="mt-6 flex-1 min-h-0">
          <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            icebreakers
          </p>
          {icebreakers === null && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="surface p-3 animate-pulse">
                  <div className="h-3 rounded" style={{ background: "var(--muted)", width: `${70 + i * 8}%` }} />
                </div>
              ))}
            </div>
          )}
          {icebreakers && icebreakers.length === 0 && (
            <div className="surface p-4 text-center text-label text-muted-foreground">
              {iceError ? "couldn't load ideas, you got this though." : "no ideas yet. say something you'd actually say."}
            </div>
          )}
          {icebreakers && icebreakers.length > 0 && (
            <ul className="space-y-2">
              {icebreakers.map((tip, i) => (
                <li key={i} className="surface p-3">
                  <p className="text-body leading-snug">{tip}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => useIcebreaker(tip, "send")}
                      disabled={sending !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-9 rounded-lg text-caption font-semibold tap-scale disabled:opacity-60"
                      style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                    >
                      {sending === tip ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                      send
                    </button>
                    <button
                      onClick={() => useIcebreaker(tip, "copy")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-9 rounded-lg text-caption font-semibold tap-scale"
                      style={{ background: "var(--muted)", color: "var(--foreground)" }}
                    >
                      <Copy className="size-3.5" /> copy
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-5 space-y-2">
          <Link
            to="/app/chat/$id"
            params={{ id }}
            className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 min-h-12 rounded-xl text-body font-semibold tap-scale"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <MessageCircle className="size-4" /> open chat
          </Link>
          <div className="flex gap-2">
            <button
              onClick={onShare}
              disabled={sharing}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl text-label font-semibold tap-scale disabled:opacity-60"
              style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }}
              aria-label="share a generic mutual match message"
            >
              <Share2 className="size-4" /> share
            </button>
            <Link
              to="/app"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl text-label font-semibold tap-scale"
              style={{ background: "var(--muted)", color: "var(--foreground)" }}
            >
              <Home className="size-4" /> home
            </Link>
          </div>
          <p className="text-micro text-muted-foreground text-center inline-flex items-center gap-1 justify-center">
            <AlertCircle className="size-3" />
            sharing sends a generic message, never their name or handle.
          </p>
        </div>
      </div>
    </MobileShell>
  );
}
