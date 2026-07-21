import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, BadgeCheck, Loader2, Lock, ArrowLeft, Bell, Crown, Plus, X, Send, Sparkles, Check, Trophy } from "lucide-react";
import { useMyNotifications } from "@/lib/phase1.hooks";

import { SomeonePickedYouBanner } from "@/components/SomeonePickedYouBanner";
import { InviteFriendsSheet } from "@/components/InviteFriendsSheet";
import { ContactImportSheet } from "@/components/ContactImportSheet";
import { useEffect, useState } from "react";
import { getIG, removeCrush, useMyCrushes, useMyMatches, useMyProfile, addCrush, rememberIG } from "@/lib/store";
import { useIGSearch } from "@/lib/use-ig-search";
import { getReferralStats, repairMissingReferral } from "@/lib/phase5.functions";
import { useServerFn } from "@tanstack/react-start";
import type { IGSearchResult } from "@/lib/instagram.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Your picks · Crush" }] }),
  component: CrushesPage,
});


function CrushesPage() {
  const { data: me, loading: meLoading } = useMyProfile();
  const { data: crushes, loading: crushesLoading, refresh } = useMyCrushes();
  const { data: matches } = useMyMatches();
  const nav = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const { results, loading, error: err } = useIGSearch(q);
  const owned = new Set(crushes.map((c) => c.target_handle));
  const [picking, setPicking] = useState<string | null>(null);
  const [justPicked, setJustPicked] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [slotBurst, setSlotBurst] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchStats = useServerFn(getReferralStats);
  const repair = useServerFn(repairMissingReferral);
  const [referral, setReferral] = useState<{ total: number; toNext: number; slotsEarned: number; maxed: boolean } | null>(null);
  const [refErr, setRefErr] = useState(false);
  const loadStats = () => {
    setRefErr(false);
    fetchStats()
      .then((r) => setReferral({ total: r.total, toNext: r.toNext, slotsEarned: r.slotsEarned, maxed: r.maxed }))
      .catch(() => setRefErr(true));
  };
  useEffect(() => {
    let cancelled = false;
    // Repair any partial state from the previous non-atomic flow, then load stats.
    repair().catch(() => {}).finally(() => { if (!cancelled) loadStats(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRemove(id: string) {
    if (removing) return;
    setRemoving(id);
    const r = await removeCrush(id);
    setRemoving(null);
    if (r.error) { toast.error(r.error); return; }
    refresh();
  }


  async function pick(u: IGSearchResult) {
    if (picking) return;
    if (owned.has(u.handle) || justPicked.has(u.handle)) return;
    setPicking(u.handle);
    rememberIG({ handle: u.handle, name: u.name, avatar: u.avatar, verified: u.verified });
    const r = await addCrush(u.handle);
    setPicking(null);
    if (r.error) { toast.error(r.error); return; }
    // Only celebrate after the authoritative add succeeds.
    setJustPicked((prev) => { const n = new Set(prev); n.add(u.handle); return n; });
    setCelebrate(u.handle);
    setSlotBurst(true);
    setTimeout(() => setCelebrate((c) => (c === u.handle ? null : c)), 700);
    setTimeout(() => setSlotBurst(false), 700);
    refresh();
    if (r.matchId) {
      setSearchOpen(false);
      setQ("");
      toast.success("it's mutual");
      nav({ to: "/app/match/$id", params: { id: r.matchId } });
    } else {
      // Let the celebration read on-screen before closing the search panel.
      setTimeout(() => { setSearchOpen(false); setQ(""); }, 520);
      toast.success("picked. kept private.");
    }
  }

  const slotsTotal = me?.crush_slots ?? 3;
  const slotsFilled = crushes.length;
  const slotsLeft = Math.max(0, slotsTotal - slotsFilled);
  const initialLoading = meLoading || crushesLoading;
  const refTarget = referral ? referral.total + referral.toNext : 3;
  const refPct = referral && !referral.maxed && refTarget > 0
    ? Math.min(100, Math.round((referral.total / refTarget) * 100))
    : referral?.maxed ? 100 : 0;


  return (
    <div className="min-h-full px-5 pt-4 pb-8">
      {/* Compact header */}
      <header className="flex items-center justify-between mb-5">
        <div className="min-w-0">
          {initialLoading ? (
            <>
              <div className="h-6 w-40 rounded-md bg-muted animate-pulse" />
              <div className="mt-2 h-3 w-24 rounded-md bg-muted animate-pulse" />
            </>
          ) : (
            <>
              <h1 className="text-[24px] font-black tracking-tight truncate lowercase">
                hi {me?.name?.split(" ")[0] ?? "there"} 👋
              </h1>
              <p className="text-[13px] text-muted-foreground truncate">
                {slotsFilled === 0 ? "add your first pick" : slotsLeft === 0 ? "all slots used" : `${slotsLeft} slot${slotsLeft > 1 ? "s" : ""} open`}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <NotifBell />
          <button onClick={() => setInviteOpen(true)} className="icon-btn" aria-label="Invite friends">
            <Send className="size-4" />
          </button>
          <Link to="/app/leaderboard" className="icon-btn" aria-label="Standings">
            <Trophy className="size-4" />
          </Link>
          <Link to="/app/upgrade" className="icon-btn" aria-label="Upgrade to god mode" style={{ color: "oklch(0.7 0.16 60)" }}>
            <Crown className="size-4" />
          </Link>
        </div>
      </header>

      {/* "Someone picked you" — the highest-intent moment in the product.
          Sits above the fold, before the status card, so it is the first thing
          seen when a pick lands (including picks that were waiting in escrow
          before this account existed). */}
      {!initialLoading && (
        <div className="-mx-5">
          <SomeonePickedYouBanner slotsFilled={slotsFilled} slotsTotal={slotsTotal} />
        </div>
      )}

      {/* Primary status card — playful gradient accent */}
      {initialLoading ? (
        <section className="surface p-5 mb-3 h-[152px] animate-pulse" aria-hidden="true" />
      ) : (
      <section className="surface p-5 mb-3 shadow-glow relative overflow-hidden">
        <div className="absolute -top-8 -right-8 size-32 rounded-full opacity-40 blur-2xl" style={{ background: "var(--gradient-primary)" }} />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground lowercase">picks sent</p>
            <p className="mt-1 text-[32px] font-black leading-none">
              <span className="text-gradient-primary">{slotsFilled}</span>
              <span className="text-muted-foreground font-bold text-[22px]">/{slotsTotal}</span>
            </p>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: slotsTotal }).map((_, i) => {
              const filled = i < slotsFilled;
              const isNewestFilled = filled && i === slotsFilled - 1 && slotBurst;
              return (
                <div
                  key={i}
                  className={`size-3 rounded-full transition-all ${isNewestFilled ? "animate-pop-in" : ""}`}
                  style={{
                    background: filled ? "var(--gradient-primary)" : "transparent",
                    border: filled ? "none" : "1.5px solid var(--border)",
                    boxShadow: filled ? "var(--shadow-pop)" : "none",
                  }}
                />
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="relative mt-4 w-full text-left tap-scale rounded-lg min-h-11"
          aria-label="Open invite friends to earn more slots"
        >
          <div className="flex items-center justify-between text-[11.5px] text-muted-foreground mb-1.5 font-semibold">
            <span className="lowercase">
              {refErr
                ? "couldn't load invites · tap to retry"
                : !referral
                  ? "loading invites…"
                  : referral.maxed
                    ? `max slots unlocked · ${referral.slotsEarned}/5 earned`
                    : referral.total === 0
                      ? "invite 3 friends → +1 slot"
                      : `${referral.total} invited · ${referral.toNext} more → +1 slot${referral.slotsEarned > 0 ? ` (${referral.slotsEarned} earned)` : ""}`}
            </span>
            <span>{referral?.maxed ? "MAX" : `${refPct}%`}</span>
          </div>

          <div className="h-2 rounded-full overflow-hidden" style={{ background: "color-mix(in oklab, var(--muted) 90%, transparent)" }}>
            <div className="h-full rounded-full transition-all animate-gradient-pan" style={{ width: `${refPct}%`, background: "var(--gradient-primary)" }} />
          </div>
        </button>
      </section>
      )}


      {/* Matches summary — only if any */}
      {matches.length > 0 && (
        <Link to="/app/matches" className="surface p-4 mb-3 flex items-center gap-3 tap-scale">
          <div className="size-11 rounded-2xl grid place-items-center bg-gradient-bubble text-primary-foreground shadow-pop">
            <Sparkles className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[15px] lowercase">{matches.length} mutual match{matches.length > 1 ? "es" : ""} 💌</p>
            <p className="text-[12px] text-muted-foreground lowercase">open to chat</p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      )}

      {/* Section label */}
      <div className="flex items-center justify-between px-1 mb-2 mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your picks</p>
        {!searchOpen && slotsFilled > 0 && slotsLeft > 0 && (
          <button
            onClick={() => setSearchOpen(true)}
            className="text-[12px] font-medium inline-flex items-center gap-1 text-muted-foreground hover:text-foreground min-h-11 px-2"
          >
            <Plus className="size-3.5" /> Add
          </button>
        )}
      </div>

      {/* Search panel */}
      {searchOpen && (
        <div className="mb-3">
          <div className="surface p-1.5 flex items-center gap-2">
            <button
              onClick={() => { setSearchOpen(false); setQ(""); }}
              className="icon-btn"
              aria-label="Close search"
            >
              <ArrowLeft className="size-4" />
            </button>
            <Search className="size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Instagram @…"
              className="flex-1 bg-transparent outline-none py-2 text-[14px]"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {loading && <Loader2 className="size-4 mr-2 animate-spin text-muted-foreground" />}
          </div>

          <div className="mt-2 space-y-1">
            {q.trim().length < 2 && (
              <p className="text-[12px] text-muted-foreground text-center py-3">
                They never find out, unless they pick you too.
              </p>
            )}
            {err && <div className="surface p-3 text-[13px] text-destructive">{err}</div>}
            {!loading && !err && q.trim().length >= 2 && results.length === 0 && (
              <div className="surface p-4 text-center text-[13px] text-muted-foreground">No one found for "{q}"</div>
            )}
            {results.map((a) => {
              const has = owned.has(a.handle) || justPicked.has(a.handle);
              const isPending = picking === a.handle;
              const isCelebrating = celebrate === a.handle;
              const disabled = has || !!picking;
              return (
                <button
                  key={a.handle}
                  onClick={() => pick(a)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors hover:bg-muted disabled:cursor-not-allowed min-h-11 ${has && !isCelebrating ? "opacity-60" : ""} ${isCelebrating ? "animate-pop-in" : ""}`}
                  aria-label={has ? `already added ${a.name}` : `pick ${a.name}`}
                >
                  <div className="relative size-9 rounded-full overflow-hidden grid place-items-center text-sm font-semibold shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                    {a.avatar ? (
                      <img src={a.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (a.name?.[0]?.toUpperCase() ?? "?")}
                    {isCelebrating && (
                      <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst pointer-events-none" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[14px] truncate flex items-center gap-1">
                      {a.name}
                      {a.verified && <BadgeCheck className="size-3.5 text-muted-foreground" />}
                      {a.isPrivate && <Lock className="size-3 text-muted-foreground" />}
                    </p>
                    <p className="text-[12px] text-muted-foreground truncate">@{a.handle}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 inline-flex items-center gap-1">
                    {isPending ? (<><Loader2 className="size-3 animate-spin" /> adding</>) : has ? (<><Check className="size-3.5 text-primary animate-check-pop" /> added</>) : "pick"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Picks list / empty state */}
      <div className="space-y-1.5">
        {initialLoading && (
          <>
            <div className="surface h-[62px] animate-pulse" />
            <div className="surface h-[62px] animate-pulse" />
          </>
        )}
        {!initialLoading && crushes.length === 0 && !searchOpen && (

          <div className="surface text-center py-10 px-6">
            <div className="size-11 mx-auto rounded-full grid place-items-center" style={{ background: "color-mix(in oklab, var(--primary) 10%, var(--card))", color: "var(--primary)" }}>
              <Search className="size-5" />
            </div>
            <p className="mt-3 font-semibold text-[15px]">No picks yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground max-w-xs mx-auto">
              Add your secret crush. We only tell them if they pick you back.
            </p>
            <button
              onClick={() => setSearchOpen(true)}
              className="btn-pop mt-5"
            >
              <Search className="size-4" /> find someone
            </button>
          </div>
        )}

        {crushes.map((c) => {
          const ig = getIG(c.target_handle);
          return (
            <div key={c.id} className="surface px-3 py-2.5 flex items-center gap-3">
              <div className="size-10 rounded-full overflow-hidden grid place-items-center text-sm font-semibold shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                {ig?.avatar ? (
                  <img src={ig.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                ) : (ig?.name?.[0]?.toUpperCase() ?? c.target_handle[0]?.toUpperCase())}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[14px] truncate">{ig?.name ?? `@${c.target_handle}`}</p>
                <p className="text-[12px] text-muted-foreground truncate">@{c.target_handle}</p>
              </div>
              <span className="chip">Waiting</span>
              <button
                onClick={() => onRemove(c.id)}
                disabled={removing === c.id || (!!removing && removing !== c.id)}
                className="icon-btn disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={removing === c.id ? `removing @${c.target_handle}` : `remove @${c.target_handle}`}
              >
                {removing === c.id ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <X className="size-4 text-muted-foreground" />}
              </button>
            </div>
          );
        })}

        {crushes.length > 0 && !searchOpen && slotsLeft > 0 && (
          <button
            onClick={() => setSearchOpen(true)}
            className="surface w-full px-3 py-2.5 flex items-center gap-3 tap-scale border-dashed"
            style={{ borderStyle: "dashed" }}
          >
            <div className="size-10 rounded-full grid place-items-center" style={{ border: "1px dashed var(--border)", color: "var(--muted-foreground)" }}>
              <Plus className="size-4" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium text-[14px]">Add another pick</p>
              <p className="text-[12px] text-muted-foreground">{slotsLeft} slot{slotsLeft > 1 ? "s" : ""} left</p>
            </div>
          </button>
        )}
      </div>

      {/* Quiet upgrade nudge — only when relevant */}
      {slotsFilled >= slotsTotal && (
        <Link to="/app/upgrade" className="mt-6 surface p-3.5 flex items-center gap-3 tap-scale">
          <div className="size-9 rounded-lg grid place-items-center" style={{ background: "color-mix(in oklab, var(--accent) 30%, var(--card))", color: "var(--accent-foreground)" }}>
            <Crown className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[14px]">Want more slots?</p>
            <p className="text-[12px] text-muted-foreground">God Mode unlocks unlimited picks and reveals.</p>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      )}

      <InviteFriendsSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onFindContacts={() => setContactsOpen(true)}
      />
      <ContactImportSheet open={contactsOpen} onClose={() => setContactsOpen(false)} />
    </div>
  );
}

function NotifBell() {
  const { unread } = useMyNotifications();
  const count = unread.length;
  return (
    <Link to="/app/notifications" className="icon-btn relative" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}>
      <Bell className="size-4" />
      {count > 0 && (
        <span
          className="absolute top-2 right-2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold grid place-items-center"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
