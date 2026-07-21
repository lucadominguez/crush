import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Loader2, Share2, Sparkles, X } from "lucide-react";
import {
  getMyIncomingPollStats,
  logPollShare,
  type IncomingPollResult,
} from "@/lib/polls.functions";
import { sharePollCard } from "@/lib/poll-share";
import { toast } from "sonner";

type Status = "loading" | "ok" | "error";

export function PollIncomingReveal() {
  const fetchStats = useServerFn(getMyIncomingPollStats);
  const logShare = useServerFn(logPollShare);
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<IncomingPollResult[]>([]);
  const [sharing, setSharing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await fetchStats();
      if (r.ok) {
        setItems(r.results);
        setStatus("ok");
      } else {
        setItems([]);
        setStatus("error");
      }
    } catch {
      setItems([]);
      setStatus("error");
    }
  }, [fetchStats]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetchStats().catch(() => null);
      if (!alive) return;
      if (r && r.ok) { setItems(r.results); setStatus("ok"); }
      else { setStatus("error"); }
    })();
    return () => { alive = false; };
  }, [fetchStats]);

  // Fully dismissed: render nothing so it can't cover the feed or affect snap.
  if (dismissed) return null;
  // No incoming votes and no error: don't clutter the feed.
  if (status === "ok" && items.length === 0) return null;

  async function share(item: IncomingPollResult) {
    if (sharing) return;
    setSharing(true);
    try {
      const outcome = await sharePollCard({
        question: item.question,
        superlative: item.question,
        voterCount: item.votes,
      });
      if (outcome === "cancelled") return; // silent
      if (outcome === "failed") { toast.error("Couldn't share right now."); return; }
      logShare({ data: { pollId: item.pollId } }).catch(() => {});
      if (outcome === "downloaded") toast.success("Saved the card to share.");
    } finally {
      setSharing(false);
    }
  }

  const dismissBtn = (
    <button
      onClick={() => setDismissed(true)}
      aria-label="Dismiss incoming votes"
      className="shrink-0 -mr-1 -mt-1 size-11 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition"
    >
      <X className="size-4" />
    </button>
  );

  // Compact wrapper — sits above the feed but never taller than needed.
  const wrap = (children: React.ReactNode) => (
    <div className="mx-4 mt-2 rounded-2xl border border-foreground/10 bg-card/95 backdrop-blur px-3 py-2 shadow-sm">
      {children}
    </div>
  );

  if (status === "loading") {
    return wrap(
      <div className="flex items-center gap-2 min-h-9">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-medium">Checking incoming votes…</span>
      </div>,
    );
  }

  if (status === "error") {
    return wrap(
      <div className="flex items-center gap-2">
        <AlertCircle className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground font-medium flex-1 truncate">
          Couldn't load your incoming votes.
        </span>
        <button
          onClick={load}
          className="min-h-9 px-2.5 rounded-lg text-xs font-semibold text-foreground hover:bg-foreground/5"
        >
          Retry
        </button>
        {dismissBtn}
      </div>,
    );
  }

  const top = items[0];
  return (
    <div className="mx-4 mt-2 rounded-2xl border border-foreground/10 bg-card/95 backdrop-blur px-3 py-2.5 shadow-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="size-4 mt-0.5 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-nano font-black uppercase tracking-wider text-muted-foreground">
            You were voted
          </p>
          <p className="font-black text-sm leading-snug mt-0.5 line-clamp-2">
            "{top.question}"
          </p>
          <p className="text-micro font-medium mt-0.5 text-muted-foreground">
            by {top.votes} {top.votes === 1 ? "person" : "people"} this week
            {items.length > 1 && ` · +${items.length - 1} more`}
          </p>
        </div>
        {dismissBtn}
      </div>
      <button
        onClick={() => share(top)}
        disabled={sharing}
        className="mt-2 w-full min-h-11 px-4 rounded-xl bg-foreground text-background font-semibold text-xs inline-flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.99] transition-transform"
      >
        {sharing ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
        {sharing ? "Preparing…" : "Share anonymously"}
      </button>
    </div>
  );
}
