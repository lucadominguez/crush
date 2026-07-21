import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search, BadgeCheck, X, Loader2, Lock, ArrowRight, Check, Shield, Sparkles, EyeOff, Plus, HeartHandshake, UserRoundSearch, Mail } from "lucide-react";
import { rememberIG, togglePendingTarget, usePendingTargets, useSession } from "@/lib/store";
import type { IGSearchResult } from "@/lib/instagram.functions";
import { useIGSearch } from "@/lib/use-ig-search";
import { BrandMark, BrandLockup } from "@/components/BrandMark";
import { WelcomeIntro } from "@/components/WelcomeIntro";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "crush: only if it's mutual" },
      { name: "description", content: "pick your secret crush. if they pick you back, you both find out. otherwise it stays private, forever." },
      { property: "og:title", content: "crush: only if it's mutual" },
      { property: "og:description", content: "pick your secret crush. if they pick you back, you both find out. otherwise it stays private." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const nav = useNavigate();
  const { session } = useSession();
  const [q, setQ] = useState("");
  // "pick" = search for someone to crush on. "claim" = enter your own @ to see
  // if anyone picked you. Claim mode never calls the server for a specific
  // handle, so it cannot leak whether that @ has admirers; the truth is only
  // revealed after signup, where the escrow backfill already handles it.
  const [mode, setMode] = useState<"pick" | "claim">("pick");
  const [claimHandle, setClaimHandle] = useState("");
  const pending = usePendingTargets();
  const isPhone = /^\+?\d[\d\s-]{5,}$/.test(q.trim());
  const { results, loading, error: err } = useIGSearch(isPhone ? "" : q);
  // Always play the intro on every unauthenticated mount of "/". Starts true;
  // WelcomeIntro's onDone flips it off after the sequence (or immediately when
  // prefers-reduced-motion is set), then the resolved hero appears.
  const [showIntro, setShowIntro] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) localStorage.setItem("crush.pending.ref", code.trim().toUpperCase());
  }, []);

  // Signed-in users who land here (e.g. Google OAuth return) go to /app,
  // which handles onboarding gating.
  useEffect(() => {
    if (session) nav({ to: "/app", replace: true });
  }, [session, nav]);

  function onPick(u: IGSearchResult | { handle: string }) {
    if ("name" in u) {
      rememberIG({ handle: u.handle, name: u.name, avatar: u.avatar, verified: u.verified });
    }
    const r = togglePendingTarget(u.handle, 3);
    if (!r.ok) toast.error(r.reason || "slot limit reached");
  }

  function onSend() {
    if (!pending.length) {
      const input = document.querySelector<HTMLInputElement>('input[data-landing-search]');
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => input.focus(), 250);
      }
      return;
    }
    nav({ to: session ? "/app" : "/signup" });
  }

  const hasQuery = q.trim().length >= 2;
  const canSend = pending.length > 0;

  return (
    <div className="min-h-dvh w-full text-foreground hub-bg">
      {/* Top nav */}
      <header className="sticky top-0 z-20 backdrop-blur-md" style={{ background: "color-mix(in oklab, var(--card) 55%, transparent)", borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-5 lg:px-8 h-14">
          <BrandLockup />
          <div className="flex items-center gap-1">
            <Link to="/login" className="px-3 py-2 min-h-11 inline-flex items-center text-sm font-semibold text-muted-foreground hover:text-foreground lowercase">log in</Link>
            <Link to="/signup" className="btn-pop text-sm px-4 !min-h-10 !py-2">sign up</Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 lg:px-8 pb-20">
        {/* Hero */}
        <section className="pt-6 lg:pt-12 pb-8 lg:pb-12 grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12 items-center">
          {/* Copy column */}
          <div className="text-center lg:text-left order-2 lg:order-1">
            {showIntro ? (
              <WelcomeIntro onDone={() => setShowIntro(false)} />
            ) : (
              <div className="animate-step-in">
                <span className="chip chip-sun animate-pop-in">
                  <Sparkles className="size-3.5" /> only if it's mutual
                </span>
                <h1
                  className="mt-4 font-black tracking-tight leading-[0.98] lowercase"
                  style={{ fontSize: "clamp(38px, 6.5vw, 72px)" }}
                >
                  <span className="block">tell your</span>
                  <span className="block text-gradient-primary animate-gradient-pan">crush.</span>
                  <span className="block text-foreground/80" style={{ fontSize: "0.55em", fontWeight: 700, letterSpacing: "-0.01em", marginTop: "0.4em" }}>
                    only if they pick you back.
                  </span>
                </h1>
                <p className="mt-5 text-lead lg:text-lead text-foreground/70 max-w-md mx-auto lg:mx-0 leading-relaxed">
                  pick someone. if they pick you back, you both find out at the same time. otherwise, nobody ever knows.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-2">
                  <span className="chip"><Lock className="size-3.5" /> anonymous</span>
                  <span className="chip"><Shield className="size-3.5" /> encrypted</span>
                  <span className="chip"><EyeOff className="size-3.5" /> no dms, ever</span>
                </div>
              </div>
            )}
          </div>

          {/* Search card column */}
          <div className="order-1 lg:order-2">
            <div className="surface p-5 sm:p-6 shadow-glow relative animate-pop-in">
              {/* Mode toggle */}
              <div className="flex gap-1 p-1 rounded-full mb-4" style={{ background: "color-mix(in oklab, var(--muted) 80%, transparent)" }}>
                <button
                  onClick={() => setMode("pick")}
                  aria-pressed={mode === "pick"}
                  className="flex-1 min-h-10 rounded-full text-caption font-bold transition-all"
                  style={mode === "pick" ? { background: "var(--card)", boxShadow: "var(--shadow-pop)" } : { color: "var(--muted-foreground)" }}
                >
                  pick your crush
                </button>
                <button
                  onClick={() => setMode("claim")}
                  aria-pressed={mode === "claim"}
                  className="flex-1 min-h-10 rounded-full text-caption font-bold transition-all"
                  style={mode === "claim" ? { background: "var(--card)", boxShadow: "var(--shadow-pop)" } : { color: "var(--muted-foreground)" }}
                >
                  check your @
                </button>
              </div>

              {mode === "claim" ? (
                <ClaimYourAt
                  handle={claimHandle}
                  onChange={setClaimHandle}
                  onSubmit={() => {
                    const h = claimHandle.trim().replace(/^@+/, "").toLowerCase();
                    nav({ to: "/signup", search: h ? { claim: h } : {} });
                  }}
                />
              ) : (
              <>
              <div className="flex items-center justify-between mb-3">
                <label htmlFor="landing-search" className="text-caption font-bold uppercase tracking-wider text-muted-foreground lowercase">
                  pick your crush
                </label>
                <span className="chip chip-primary">{pending.length}/3</span>
              </div>
              <div className="relative">
                <Search className="absolute top-1/2 left-4 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <input
                  id="landing-search"
                  data-landing-search
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="@username or phone"
                  aria-label="Search Instagram username or phone number"
                  className="input-field pl-11 pr-11 h-14 text-lead font-medium"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {loading && <Loader2 className="size-4 absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>

              {/* Selected picks */}
              {pending.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {pending.map((h) => (
                    <button
                      key={h}
                      onClick={() => togglePendingTarget(h)}
                      className="chip chip-primary tap-scale animate-pop-in"
                    >
                      @{h} <X className="size-3" />
                    </button>
                  ))}
                </div>
              )}

              {/* Results */}
              {(hasQuery || isPhone) && (
                <div className="mt-3 space-y-0.5 max-h-72 overflow-y-auto">
                  {isPhone && (
                    <ResultRow
                      avatar={null} fallback="#"
                      title={q.trim()} subtitle="send to this phone number"
                      selected={pending.includes(q.trim().toLowerCase())}
                      onClick={() => onPick({ handle: q.trim().toLowerCase() })}
                    />
                  )}
                  {results.map((a) => (
                    <ResultRow
                      key={a.handle}
                      avatar={a.avatar} fallback={a.name?.[0]?.toUpperCase() ?? "?"}
                      title={a.name} subtitle={`@${a.handle}${a.isPrivate ? " · private" : ""}`}
                      verified={a.verified}
                      selected={pending.includes(a.handle)}
                      onClick={() => onPick(a)}
                    />
                  ))}
                  {err && <p className="text-center text-sm text-destructive py-4">{err}</p>}
                  {!loading && !err && hasQuery && !isPhone && results.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-4">no one found for "{q}"</p>
                  )}
                </div>
              )}

              <button
                onClick={onSend}
                disabled={!canSend}
                aria-disabled={!canSend}
                className="btn-pop mt-4 w-full h-14 text-lead animate-gradient-pan"
              >
                {canSend
                  ? <>send {pending.length === 1 ? "your pick" : `${pending.length} picks`} <ArrowRight className="size-4" /></>
                  : <>pick someone to continue</>}
              </button>
              <p className="mt-3 text-center text-caption text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
                <Lock className="size-3.5" /> they'll never know, unless they pick you back.
              </p>
              </>
              )}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-8 lg:mt-14">
          <div className="text-center mb-8 lg:mb-10">
            <span className="chip chip-grape">how it works</span>
            <h2 className="mt-3 text-headline lg:text-display font-black tracking-tight lowercase">
              two people. one quiet reveal.
            </h2>
          </div>
          <ol className="grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto">
            {[
              { Icon: UserRoundSearch, title: "pick your crush", body: "search their @ or number. nothing is ever sent until it's mutual.", tone: "sun" as const },
              { Icon: HeartHandshake, title: "they pick too", body: "if they add you back, we quietly wait. no pings, no pressure, no hints.", tone: "grape" as const },
              { Icon: Mail, title: "it's mutual", body: "you both find out at the same moment. otherwise it stays private, forever.", tone: "primary" as const },
            ].map((s, i) => (
              <li key={i} className="surface p-5 tap-scale">
                <div className={`size-11 rounded-2xl grid place-items-center ${s.tone === "sun" ? "bg-gradient-sun text-[color:var(--sun-foreground)]" : s.tone === "grape" ? "bg-gradient-grape text-[color:var(--accent-foreground)]" : "bg-gradient-bubble text-[color:var(--primary-foreground)]"}`}>
                  <s.Icon className="size-5" strokeWidth={2.2} />
                </div>
                <p className="mt-3 font-bold text-lead lowercase">{s.title}</p>
                <p className="mt-1.5 text-label text-foreground/70 leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-border/60 flex flex-col items-center gap-3">
          <BrandMark size={26} />
          <p className="text-label text-muted-foreground lowercase">only if it's mutual.</p>
          <div className="flex items-center gap-4 text-micro text-muted-foreground lowercase">
            <Link to="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">privacy</Link>
            <Link to="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">terms</Link>
            <span>13+</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

/**
 * "check your @" surface.
 *
 * Privacy: this deliberately does NOT tell you whether your handle has admirers
 * before you sign up — showing that to anyone who types a handle would leak
 * "does @X have admirers" to the whole internet. The copy is identical for
 * everyone; the honest answer arrives after signup, where the escrow backfill
 * reveals any waiting picks truthfully.
 */
function ClaimYourAt({
  handle, onChange, onSubmit,
}: { handle: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const clean = handle.trim().replace(/^@+/, "");
  return (
    <div className="animate-fade-in">
      <p className="text-caption font-bold uppercase tracking-wider text-muted-foreground lowercase mb-3">
        did someone pick you?
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="relative"
      >
        <span className="absolute top-1/2 left-4 -translate-y-1/2 text-lead font-bold text-muted-foreground pointer-events-none">@</span>
        <input
          value={clean}
          onChange={(e) => onChange(e.target.value)}
          placeholder="yourhandle"
          aria-label="Your Instagram handle"
          className="input-field pl-9 h-14 text-lead font-medium"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </form>
      <button
        onClick={onSubmit}
        disabled={clean.length < 2}
        className="btn-pop mt-4 w-full h-14 text-lead animate-gradient-pan disabled:opacity-60"
      >
        {clean.length >= 2 ? <>claim @{clean.toLowerCase()} <ArrowRight className="size-4" /></> : <>enter your @</>}
      </button>
      <p className="mt-3 text-center text-caption text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
        <EyeOff className="size-3.5" /> we only reveal a pick if you both chose each other.
      </p>
    </div>
  );
}

function ResultRow({
  avatar, fallback, title, subtitle, verified, selected, onClick,
}: { avatar: string | null; fallback: string; title: string; subtitle: string; verified?: boolean; selected: boolean; onClick: () => void }) {
  const wasSelected = useRef(selected);
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (selected && !wasSelected.current) {
      setBurst(true);
      const t = setTimeout(() => setBurst(false), 620);
      wasSelected.current = true;
      return () => clearTimeout(t);
    }
    wasSelected.current = selected;
  }, [selected]);

  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors tap-scale"
      style={selected ? {
        background: "color-mix(in oklab, var(--primary) 12%, var(--card))",
        boxShadow: "inset 0 0 0 1.5px color-mix(in oklab, var(--primary) 40%, transparent)",
      } : undefined}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in oklab, var(--card) 60%, transparent)"; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <div className="relative size-10 rounded-full overflow-hidden grid place-items-center text-sm font-bold shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        {avatar ? (
          <img src={avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <span>{fallback}</span>
        )}
        {burst && <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst pointer-events-none" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-body truncate flex items-center gap-1">
          {title}
          {verified && <BadgeCheck className="size-3.5" style={{ color: "var(--accent-foreground)" }} />}
        </p>
        <p className="text-caption text-muted-foreground truncate">{subtitle}</p>
      </div>
      <div
        className="size-8 rounded-full grid place-items-center shrink-0 transition-all"
        style={{
          background: selected ? "var(--gradient-primary)" : "transparent",
          color: selected ? "var(--primary-foreground)" : "var(--muted-foreground)",
          border: selected ? "1px solid transparent" : "1.5px solid var(--border)",
          boxShadow: selected ? "var(--shadow-pop)" : "none",
        }}
      >
        {selected ? <Check key="c" className="size-4 animate-check-pop" /> : <Plus className="size-4" strokeWidth={2.4} />}
      </div>
    </button>
  );
}
