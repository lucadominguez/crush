import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChevronUp, Plus, Sparkles, Loader2, AlertCircle, Crown, Check } from "lucide-react";
import { PollWithStats, getIG, usePolls, votePoll } from "@/lib/store";
import { LaunchPollSheet } from "@/components/LaunchPollSheet";
import { PollIncomingReveal } from "@/components/PollIncomingReveal";
import { SuggestQuestionButton } from "@/components/SuggestQuestionButton";

export const Route = createFileRoute("/app/standings")({
  head: () => ({ meta: [{ title: "Standings · Crush" }] }),
  component: StandingsPage,
});

function StandingsPage() {
  const { data: polls, loading, error, refresh } = usePolls();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-poll-item]"));
    if (!items.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.index);
            setActive(idx);
          }
        });
      },
      { root, threshold: [0.6, 0.9] }
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [polls.length]);

  const sheet = (
    <LaunchPollSheet open={launching} onClose={() => setLaunching(false)} onCreated={refresh} />
  );

  // Loading (initial)
  if (loading && polls.length === 0) {
    return (
      <>
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full max-w-[360px] rounded-3xl border border-foreground/10 bg-card/85 p-6 space-y-4">
            <div className="h-4 w-24 rounded bg-foreground/10" />
            <div className="h-6 w-3/4 rounded bg-foreground/10" />
            <div className="grid grid-cols-2 gap-2">
              {[0,1,2,3].map((i) => <div key={i} className="aspect-square rounded-2xl bg-foreground/5" />)}
            </div>
          </div>
        </div>
        {sheet}
      </>
    );
  }

  // Error
  if (error && polls.length === 0) {
    return (
      <>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <AlertCircle className="size-8 text-muted-foreground mb-2" />
          <h2 className="text-lg font-semibold">Couldn't load polls</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Check your connection and try again.
          </p>
          <button onClick={refresh} className="mt-4 min-h-11 px-5 rounded-full bg-foreground text-background font-semibold text-sm">
            Retry
          </button>
        </div>
        {sheet}
      </>
    );
  }

  // Empty
  if (polls.length === 0) {
    return (
      <>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="size-14 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center mb-3">
            <Sparkles className="size-6 text-primary" />
          </div>
          <h2 className="text-xl font-semibold">No polls yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Launch the first one. Pick a question and 2 to 4 people.
          </p>
          <button
            onClick={() => setLaunching(true)}
            className="mt-5 min-h-11 px-5 rounded-full bg-foreground text-background font-semibold text-sm inline-flex items-center gap-2"
          >
            <Sparkles className="size-4" /> Launch a poll
          </button>
        </div>
        {sheet}
      </>
    );
  }

  return (
    <>
      {/* Incoming results teaser floats outside the snap scroller so it never
          affects poll indices, snap height, or full-screen snapping. */}
      <div
        className="absolute left-0 right-0 z-20 pointer-events-none"
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <div className="pointer-events-auto">
          <PollIncomingReveal />
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="absolute inset-0 overflow-y-auto snap-y snap-mandatory scroll-smooth no-scrollbar overscroll-contain"
        style={{ scrollSnapType: "y mandatory", overscrollBehavior: "contain" }}
      >
        {polls.map((p, i) => (
          <PollSlide key={p.id} poll={p} index={i} total={polls.length} active={active === i} onVoted={refresh} />
        ))}

        <div className="pointer-events-none fixed top-1/2 -translate-y-1/2 right-3 z-20 flex flex-col gap-1.5">
          {polls.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-300 ${
                active === i ? "h-6 w-1.5 bg-foreground" : "h-1.5 w-1.5 bg-foreground/25"
              }`}
            />
          ))}
        </div>
      </div>

      <button
        onClick={() => setLaunching(true)}
        className="fixed right-5 z-30 h-12 pl-3 pr-4 rounded-full bg-foreground text-background font-semibold text-sm flex items-center gap-1.5 shadow-lg active:scale-[0.98] transition-transform"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
      >
        <Plus className="size-4" /> Launch
      </button>

      <SuggestQuestionButton />

      {sheet}
    </>
  );
}


function PollSlide({
  poll,
  index,
  total,
  active,
  onVoted,
}: {
  poll: PollWithStats;
  index: number;
  total: number;
  active: boolean;
  onVoted: () => void;
}) {
  // Server-confirmed vote; falls back to poll.myVote from the feed once
  // the refetch lands. Once set, the card is locked immediately so the
  // option can't be tapped again while refresh is in flight.
  const [confirmed, setConfirmed] = useState<string | null>(null);
  // Set true when the server told us we've already voted but didn't return
  // which option — we lock the card and wait for the feed refetch.
  const [reconciling, setReconciling] = useState(false);
  // Track whether *this* client just cast a new vote (vs. reconciling an
  // existing one), so we only optimistic-increment on a real new vote.
  const [justVoted, setJustVoted] = useState(false);
  useEffect(() => {
    if (poll.myVote) {
      setConfirmed(poll.myVote);
      setReconciling(false);
    }
  }, [poll.myVote]);
  const voted = confirmed ?? poll.myVote;

  // Freeze display order at first render so options never reshuffle.
  const displayOrder = useMemo(() => poll.option_handles.slice(), [poll.id]);
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});

  // Optimistic +1 only for a genuinely new successful vote by this client,
  // and only while the feed refetch hasn't caught up.
  const optimisticVotes = useMemo(() => {
    if (!justVoted || !confirmed || poll.myVote) return poll.votes;
    return { ...poll.votes, [confirmed]: (poll.votes[confirmed] ?? 0) + 1 };
  }, [poll.votes, confirmed, poll.myVote, justVoted]);

  const totalVotes = (Object.values(optimisticVotes) as number[]).reduce((a, b) => a + b, 0);
  const isLast = index === total - 1;

  async function cast(handle: string) {
    if (voted || pending || reconciling) return;
    setPending(handle);
    setErr(null);
    const r = await votePoll(poll.id, handle);
    setPending(null);
    if (r.ok) {
      // Genuine new vote — safe to optimistic-increment and lock.
      setConfirmed(r.ownVote ?? handle);
      setJustVoted(true);
      await Promise.resolve(onVoted());
      return;
    }
    if (r.code === "already_voted") {
      // Never infer the previous vote from the tapped handle. Use the
      // server-returned own_vote when available; otherwise lock into a
      // reconciling state and let the feed refetch surface myVote.
      if (r.ownVote) {
        setConfirmed(r.ownVote);
        setReconciling(false);
      } else {
        setReconciling(true);
      }
      await Promise.resolve(onVoted());
      return;
    }
    setErr(r.error ?? "couldn't record your vote. try again");
  }

  const maxCount = voted ? Math.max(0, ...Object.values(optimisticVotes)) : 0;


  return (
    <section
      data-poll-item
      data-index={index}
      className="snap-start snap-always h-full w-full flex flex-col items-center justify-center px-4 py-6 relative"
    >
      {/* Ambient candy/ice gradient — single restrained palette. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-24 -left-16 size-64 rounded-full blur-3xl motion-safe:transition-opacity motion-safe:duration-700"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 65%)",
            opacity: active ? 0.55 : 0.15,
          }}
        />
        <div
          className="absolute -bottom-24 -right-16 size-72 rounded-full blur-3xl motion-safe:transition-opacity motion-safe:duration-700"
          style={{
            background: "radial-gradient(circle, hsl(var(--accent) / 0.3), transparent 65%)",
            opacity: active ? 0.5 : 0.12,
          }}
        />
      </div>

      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
        <div className="px-2.5 py-1 rounded-full bg-card/85 backdrop-blur border border-foreground/10 text-nano font-semibold uppercase tracking-wider text-muted-foreground">
          {index + 1} / {total}
          {voted && ` · ${totalVotes} vote${totalVotes === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* Depth cue: subtle "next card" peek beneath the active card. */}
      {!isLast && (
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 w-[86%] max-w-[320px] h-6 rounded-b-3xl bg-card/60 border border-t-0 border-foreground/10"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 20px)", filter: "blur(0.5px)" }}
        />
      )}

      <div
        className={`relative w-full max-w-[360px] rounded-3xl border border-foreground/10 bg-card/95 backdrop-blur-xl overflow-hidden flex flex-col ${
          active ? "scale-100 opacity-100" : "scale-[0.97] opacity-70"
        }`}
        style={{
          transition:
            "transform var(--motion-med) var(--ease-spring), opacity var(--motion-med) var(--ease-out)",
          boxShadow:
            "0 1px 0 hsl(var(--background) / 0.5) inset, 0 20px 40px -25px hsl(var(--foreground) / 0.28), 0 6px 20px -12px hsl(var(--foreground) / 0.18)",
        }}
      >
        <div className="px-5 pt-5 pb-4">
          <div className="text-nano font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Sparkles className="size-3" /> the question
          </div>
          <h2 className="text-title font-black leading-[1.15] tracking-tight">{poll.question}</h2>
        </div>

        {/* Options: stacked rows with alternating offset — no more grid of squares. */}
        <div className="px-3 pb-3 flex flex-col gap-2">
          {displayOrder.map((h, i) => {
            const ig = getIG(h);
            const count = optimisticVotes[h] || 0;
            const pct = voted && totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isVote = voted === h;
            const isWinner = !!voted && count > 0 && count === maxCount;
            const isPending = pending === h;
            const displayName = ig?.name && ig.name.toLowerCase() !== h.toLowerCase() ? ig.name : `@${h}`;
            const disabled = !!voted || !!pending || reconciling;
            const initials = (ig?.name || h)
              .split(/[.\s_-]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("") || "?";
            const showAvatar = !!ig?.avatar && !imgFailed[h];
            // Alternating horizontal offset breaks the "grid of squares" feel
            // without shifting hit targets or causing reflow.
            const offset = i % 2 === 0 ? "0px" : "10px";

            return (
              <button
                key={h}
                disabled={disabled}
                aria-pressed={isVote}
                aria-label={`Vote ${displayName}${voted ? `, ${pct}%` : ""}`}
                onClick={() => cast(h)}
                className={`group relative rounded-2xl overflow-hidden text-left min-h-[64px] ${
                  disabled ? "" : "active:scale-[0.985]"
                } ${
                  isVote
                    ? "bg-primary/12 border-primary/45"
                    : isWinner
                      ? "bg-secondary/60 border-foreground/15"
                      : "bg-secondary/40 border-foreground/10 hover:bg-secondary/60"
                } ${active ? "animate-rise" : ""} ${isVote ? "animate-ring-burst" : ""}`}
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  marginLeft: offset,
                  animationDelay: active ? `${i * 60}ms` : undefined,
                  transition:
                    "transform var(--motion-fast) var(--ease-spring), background-color var(--motion-med) var(--ease-out), border-color var(--motion-med) var(--ease-out)",
                }}
              >
                {/* Results bar: fills left-to-right; animates from 0→pct. */}
                {voted && (
                  <ResultBar pct={pct} highlighted={isVote} />
                )}

                <div className="relative flex items-center gap-3 px-3 py-3">
                  {/* Avatar — lifts on selection for a tactile press feedback. */}
                  <div
                    className="size-12 rounded-2xl bg-card border border-foreground/10 overflow-hidden flex items-center justify-center text-xs font-semibold text-muted-foreground shrink-0"
                    style={{
                      transform: isVote ? "translateY(-2px) scale(1.03)" : isPending ? "scale(0.96)" : "none",
                      transition: "transform var(--motion-med) var(--ease-spring)",
                    }}
                  >
                    {showAvatar ? (
                      <img
                        src={ig!.avatar!}
                        alt=""
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={() => setImgFailed((m) => ({ ...m, [h]: true }))}
                      />
                    ) : ig?.emoji && !ig.name ? (
                      <span className="text-xl">{ig.emoji}</span>
                    ) : (
                      <span aria-hidden>{initials}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-body leading-tight flex items-center gap-1 min-w-0">
                      <span className="truncate">{displayName}</span>
                      {ig?.verified && <BadgeCheck className="size-3.5 shrink-0 text-primary" />}
                    </p>
                    {voted ? (
                      <p className="text-micro text-muted-foreground mt-0.5 tabular-nums">
                        {count} vote{count === 1 ? "" : "s"}
                      </p>
                    ) : isPending ? (
                      <p className="text-micro font-medium text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> saving…
                      </p>
                    ) : reconciling ? (
                      <p className="text-micro font-medium text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> loading…
                      </p>
                    ) : (
                      <p className="text-micro font-medium text-muted-foreground mt-0.5">tap to vote</p>
                    )}
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {voted ? (
                      <>
                        <div className="font-black text-title tabular-nums leading-none flex items-center gap-1">
                          {isWinner && <Crown className="size-4 text-primary" aria-label="Top" />}
                          {pct}%
                        </div>
                        {isVote && (
                          <span className="inline-flex items-center gap-0.5 text-nano font-semibold uppercase tracking-wider text-primary">
                            <Check className="size-3" strokeWidth={3} /> your pick
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="size-8 rounded-full border border-foreground/15 flex items-center justify-center text-muted-foreground">
                        <Plus className="size-4" strokeWidth={2.4} />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 pb-3 pt-1 flex items-center justify-between text-nano font-medium text-muted-foreground">
          <span>{voted ? "results are anonymous" : "your vote stays anonymous"}</span>
          {!isLast && (
            <span className="inline-flex items-center gap-1">
              swipe up <ChevronUp className="size-3" strokeWidth={2.5} />
            </span>
          )}
        </div>

        {err && !voted && (
          <div className="px-5 pb-3 -mt-1">
            <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 border border-destructive/25 px-3 py-2 text-xs">
              <span className="text-destructive font-medium truncate">{err}</span>
              <button
                onClick={() => setErr(null)}
                className="text-destructive font-semibold underline underline-offset-2 shrink-0"
              >
                dismiss
              </button>
            </div>
          </div>
        )}
      </div>


      {!isLast && !voted && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center text-muted-foreground text-nano font-semibold uppercase tracking-wider">
          <ChevronUp className="size-3.5" />
          Next
        </div>
      )}

      {isLast && voted && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-muted-foreground text-nano font-semibold uppercase tracking-wider">
          All caught up
        </div>
      )}
    </section>
  );
}

// Animated result fill: mounts at 0% and tweens to the real percentage on the
// next frame so the growth is visible after a vote lands. Any subsequent
// percentage change (e.g. reconciled server totals) transitions from the
// previous displayed value to the new one. Reduced-motion users get the
// final width immediately via the global media-query rule in styles.css.
function ResultBar({ pct, highlighted }: { pct: number; highlighted: boolean }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div
      aria-hidden
      className={`absolute inset-y-0 left-0 ${highlighted ? "bg-primary/25" : "bg-foreground/[0.06]"}`}
      style={{
        width: `${w}%`,
        transition: "width var(--motion-slow) var(--ease-out)",
      }}
    />
  );
}
