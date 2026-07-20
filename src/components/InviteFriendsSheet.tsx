import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, MessageSquare, Share2, X, Gift, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { getMyInviteText, logInvite, getReferralStats } from "@/lib/phase5.functions";

type Stats = { total: number; toNext: number; slotsEarned: number; maxed: boolean; currentMilestone: number };

const MAX_EARNED = 5;

export function InviteFriendsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const fetchText = useServerFn(getMyInviteText);
  const fetchStats = useServerFn(getReferralStats);
  const log = useServerFn(logInvite);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState<null | "share" | "sms" | "copy">(null);
  const [copied, setCopied] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(false);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const [t, s] = await Promise.all([
        fetchText({ data: { origin } }),
        fetchStats(),
      ]);
      setText(t.text);
      setUrl(t.url);
      setStats({
        total: s.total,
        toNext: s.toNext,
        slotsEarned: s.slotsEarned,
        maxed: s.maxed,
        currentMilestone: s.currentMilestone,
      });
    } catch {
      setLoadErr(true);
    } finally {
      setLoading(false);
    }
  }, [fetchText, fetchStats]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    load();
    prevFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    // Lock background scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      // Focus trap
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const list = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
      if (list.length === 0) return;
      const first = list[0]; const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      prevFocusRef.current?.focus?.();
    };
  }, [open, load, onClose]);

  if (!open) return null;

  async function safeCopy(value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch { /* fall through */ }
    return false;
  }

  async function doShare() {
    if (busy || !text) return;
    setBusy("share");
    try {
      let completed = false;
      // Web Share is a promise that rejects on cancel (AbortError). We only log on success.
      if (typeof navigator !== "undefined" && "share" in navigator) {
        try {
          await (navigator as Navigator).share({ text, url });
          completed = true;
        } catch (e) {
          const name = (e as { name?: string })?.name;
          if (name === "AbortError") return; // silent cancel — no log, no toast
          // fall through to clipboard
        }
      }
      if (!completed) {
        const ok = await safeCopy(text);
        if (!ok) { toast.error("Couldn't share — try copy"); return; }
        toast.success("Invite copied");
        completed = true;
      }
      if (completed) {
        const r = await log({ data: { channel: "share" } }).catch(() => ({ ok: false as const, error: "log_failed" }));
        if (!r.ok) toast("Shared — couldn't update progress right now.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function doSms() {
    if (busy) return;
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (cleaned.length < 7) { toast.error("Enter a valid number"); return; }
    setBusy("sms");
    try {
      const r = await log({ data: { phone: cleaned, channel: "sms" } });
      if (!r.ok) { toast.error(r.error); return; }
      const sep = /android/i.test(navigator.userAgent) ? "?" : "&";
      window.location.href = `sms:${cleaned}${sep}body=${encodeURIComponent(text)}`;
    } finally {
      setBusy(null);
    }
  }

  async function doCopy() {
    if (busy || !text) return;
    setBusy("copy");
    try {
      const ok = await safeCopy(text);
      if (!ok) { toast.error("Copy failed"); return; }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      const r = await log({ data: { channel: "copy" } }).catch(() => ({ ok: false as const, error: "log_failed" }));
      if (!r.ok) toast("Copied — couldn't update progress right now.");
    } finally {
      setBusy(null);
    }
  }

  const target = stats ? stats.total + stats.toNext : 0;
  const pct = target > 0 ? Math.min(100, Math.round((stats!.total / target) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Invite friends"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md surface rounded-t-3xl rounded-b-none p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-[18px] font-black lowercase">invite friends</h2>
            <p className="text-[12px] text-muted-foreground">every 3 friends who join = +1 pick slot</p>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            className="icon-btn min-w-11 min-h-11"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Progress */}
        {loading ? (
          <div className="surface p-3 mb-4 h-[64px] animate-pulse" />
        ) : loadErr ? (
          <div className="surface p-3 mb-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">Couldn't load your invite</p>
            <button onClick={load} className="text-[12px] font-semibold underline min-h-11 px-2">Retry</button>
          </div>
        ) : stats && (
          <div className="surface p-3 mb-4 flex items-center gap-3">
            <div className="size-10 rounded-full grid place-items-center shrink-0" style={{ background: "color-mix(in oklab, var(--primary) 12%, var(--card))", color: "var(--primary)" }}>
              <Gift className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-bold lowercase truncate">
                  {stats.maxed
                    ? `max slots unlocked · ${stats.slotsEarned}/${MAX_EARNED} earned`
                    : stats.total === 0
                    ? "invite 3 friends → +1 slot"
                    : `${stats.total} invited · ${stats.toNext} more → +1 slot${stats.slotsEarned > 0 ? ` (${stats.slotsEarned} earned)` : ""}`}
                </p>

                <span className="text-[10px] font-black tracking-wider text-muted-foreground shrink-0">
                  {stats.maxed ? `${stats.slotsEarned}/${MAX_EARNED}` : `${stats.total}/${target}`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${stats.maxed ? 100 : pct}%`,
                    background: "var(--gradient-primary)",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Invite text preview */}
        <div className="surface p-3 mb-4 bg-muted/50">
          {loading ? (
            <div className="h-10 animate-pulse" />
          ) : (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text}</p>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="phone number"
              inputMode="tel"
              aria-label="Phone number"
              className="flex-1 min-h-11 rounded-xl px-3 text-[14px] outline-none surface"
            />
            <button
              onClick={doSms}
              disabled={loading || busy !== null || phone.replace(/[^\d+]/g, "").length < 7}
              className="btn-pop min-h-11 disabled:opacity-50"
            >
              {busy === "sms" ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
              sms
            </button>
          </div>
          <button
            onClick={doShare}
            disabled={loading || busy !== null}
            className="btn-pop w-full min-h-11 disabled:opacity-50"
          >
            {busy === "share" ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
            share invite
          </button>
          <button
            onClick={doCopy}
            disabled={loading || busy !== null}
            className="w-full min-h-11 rounded-xl surface inline-flex items-center justify-center gap-2 text-[14px] font-semibold disabled:opacity-50"
          >
            {copied ? <Check className="size-4" /> : busy === "copy" ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
            {copied ? "copied" : "copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}
