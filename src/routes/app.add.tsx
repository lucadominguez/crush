import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Search, BadgeCheck, Loader2, Lock, Check, AtSign } from "lucide-react";
import { ScreenHeader } from "@/components/MobileShell";
import { addCrush, rememberIG, useMyCrushes } from "@/lib/store";
import type { IGSearchResult } from "@/lib/instagram.functions";
import { useIGSearch } from "@/lib/use-ig-search";
import { toast } from "sonner";

export const Route = createFileRoute("/app/add")({
  head: () => ({ meta: [{ title: "add a pick · crush" }] }),
  component: AddPage,
});

function AddPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const { results, loading, error: err } = useIGSearch(q);
  const { data: crushes, refresh } = useMyCrushes();
  const owned = new Set(crushes.map((c) => c.target_handle));
  const [pending, setPending] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState<string | null>(null);

  // A handle typed by hand — Instagram search can miss private, renamed, or
  // brand-new accounts, and the person may not be on Crush at all. Picking one
  // is the escrow case: the pick waits until they arrive.
  const typed = q.trim().replace(/^@/, "").toLowerCase();
  const typedIsValid = /^[a-z0-9._]{2,30}$/.test(typed);
  const typedInResults = results.some((r) => r.handle === typed);
  const showAddAnyway = typedIsValid && !typedInResults && !loading;

  async function pick(u: IGSearchResult) {
    if (pending) return;
    if (owned.has(u.handle) || justAdded.has(u.handle)) return;
    setPending(u.handle);
    rememberIG({ handle: u.handle, name: u.name, avatar: u.avatar, verified: u.verified });
    const r = await addCrush(u.handle);
    setPending(null);
    if (r.error) { toast.error(r.error); return; }
    // Only celebrate after the authoritative add succeeds.
    setJustAdded((prev) => { const n = new Set(prev); n.add(u.handle); return n; });
    setCelebrate(u.handle);
    setTimeout(() => setCelebrate((c) => (c === u.handle ? null : c)), 700);
    refresh();
    if (r.matchId) {
      toast.success("it's mutual");
      nav({ to: "/app/match/$id", params: { id: r.matchId } });
    } else {
      toast.success("picked. kept private.");
    }
  }

  return (
    <>
      <ScreenHeader
        title="add a pick"
        subtitle="search any instagram @. only you see this."
        back={
          <Link to="/app" className="icon-btn -ml-1" aria-label="Back">
            <ArrowLeft className="size-4" />
          </Link>
        }
      />
      <div className="px-5">
        <div className="surface p-1.5 flex items-center gap-2">
          <Search className="size-4 ml-2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search instagram"
            className="flex-1 bg-transparent outline-none py-2.5 text-body"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {loading && <Loader2 className="size-4 mr-2 animate-spin text-muted-foreground" />}
        </div>

        <div className="mt-3 space-y-1 pb-6">
          {q.trim().length < 2 && (
            <p className="text-caption text-muted-foreground text-center py-4">
              they never find out, unless they pick you too.
            </p>
          )}
          {err && <div className="surface p-3 text-label text-destructive">{err}</div>}
          {showAddAnyway && (
            <button
              onClick={() => pick({ handle: typed, name: `@${typed}`, avatar: null, verified: false, isPrivate: false })}
              disabled={owned.has(typed) || justAdded.has(typed) || !!pending}
              className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors hover:bg-muted disabled:cursor-not-allowed min-h-11 ${celebrate === typed ? "animate-pop-in" : ""}`}
            >
              <div className="relative size-9 rounded-full grid place-items-center text-sm font-semibold shrink-0 border border-dashed border-foreground/30" style={{ color: "var(--muted-foreground)" }}>
                <AtSign className="size-4" />
                {celebrate === typed && (
                  <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst pointer-events-none" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-body truncate">@{typed}</p>
                <p className="text-caption text-muted-foreground truncate">
                  {results.length ? "not the one you meant? pick this exact @" : "not on crush yet. we'll hold your pick"}
                </p>
              </div>
              <span className="text-micro text-muted-foreground shrink-0 inline-flex items-center gap-1">
                {pending === typed ? (<><Loader2 className="size-3 animate-spin" /> adding</>)
                  : (owned.has(typed) || justAdded.has(typed)) ? (<><Check className="size-3.5 text-primary" /> added</>)
                  : "pick"}
              </span>
            </button>
          )}
          {!loading && !err && q.trim().length >= 2 && results.length === 0 && !typedIsValid && (
            <div className="surface p-4 text-center text-label text-muted-foreground">no one found for "{q}"</div>
          )}
          {results.map((a) => {
            const has = owned.has(a.handle) || justAdded.has(a.handle);
            const isPending = pending === a.handle;
            const disabled = has || !!pending;
            return (
              <button
                key={a.handle}
                onClick={() => pick(a)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors hover:bg-muted disabled:cursor-not-allowed min-h-11 ${has ? "opacity-70" : ""} ${celebrate === a.handle ? "animate-pop-in" : ""}`}
              >
                <div className="relative size-9 rounded-full overflow-hidden grid place-items-center text-sm font-semibold shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                  {a.avatar ? (
                    <img
                      src={a.avatar}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (a.name?.[0]?.toUpperCase() ?? "?")}
                  {celebrate === a.handle && (
                    <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst pointer-events-none" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-body truncate flex items-center gap-1">
                    {a.name}
                    {a.verified && <BadgeCheck className="size-3.5 text-muted-foreground" />}
                    {a.isPrivate && <Lock className="size-3 text-muted-foreground" />}
                  </p>
                  <p className="text-caption text-muted-foreground truncate">@{a.handle}</p>
                </div>
                <span className="text-micro text-muted-foreground shrink-0 inline-flex items-center gap-1">
                  {isPending ? (<><Loader2 className="size-3 animate-spin" /> adding</>) : has ? (<><Check className="size-3.5 text-primary animate-check-pop" /> added</>) : "pick"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
