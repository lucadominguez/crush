import { useEffect, useRef, useState } from "react";
import { X, Search, Loader2, Check, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createPoll, getIG, rememberIG, useNetworkSuggestions } from "@/lib/store";
import { useIGSearch } from "@/lib/use-ig-search";
import type { IGSearchResult } from "@/lib/instagram.functions";

const QUESTION_IDEAS = [
  "Who's the main character?",
  "Most likely to text back in 3 seconds?",
  "Best plus-one to a party?",
  "Who'd win a karaoke battle?",
];

export function LaunchPollSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Hooks always run — no conditional-return-before-hooks.
  const [question, setQuestion] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { results, loading } = useIGSearch(open ? q : "");
  const network = useNetworkSuggestions();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);

  // Reset draft each time it opens.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    // focus after mount
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Escape to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  function toggle(handle: string, meta?: IGSearchResult) {
    const h = handle.toLowerCase().replace(/^@/, "");
    if (meta) rememberIG({ handle: meta.handle, name: meta.name, avatar: meta.avatar, verified: meta.verified });
    setPicks((cur) => {
      if (cur.includes(h)) return cur.filter((x) => x !== h);
      if (cur.length >= 4) { toast.error("Up to 4 people per poll"); return cur; }
      return [...cur, h];
    });
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await createPoll(question, picks);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    toast.success("Poll launched");
    // reset for next open
    setQuestion(""); setPicks([]); setQ("");
    onCreated();
    onClose();
  }

  const canSubmit = !busy && picks.length >= 2 && question.trim().length >= 5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Launch a poll"
    >
      <div
        ref={dialogRef}
        className="w-full sm:max-w-md bg-card border border-foreground/10 rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-foreground/10">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="font-semibold text-base">Launch a poll</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-11 rounded-full hover:bg-secondary flex items-center justify-center -mr-2"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Question</label>
            <textarea
              ref={firstFieldRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Who is most likely to…?"
              rows={2}
              className="mt-1.5 w-full bg-secondary/60 border border-foreground/10 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
              maxLength={120}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUESTION_IDEAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuestion(s)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-secondary/60 border border-foreground/10 hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              People · {picks.length}/4
            </label>

            {picks.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {picks.map((h) => {
                  const ig = getIG(h);
                  return (
                    <button
                      key={h}
                      onClick={() => toggle(h)}
                      className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary-foreground text-xs font-medium"
                    >
                      <span className="size-5 rounded-full bg-card border border-foreground/10 flex items-center justify-center overflow-hidden text-[10px]">
                        {ig?.avatar ? <img src={ig.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : ig?.emoji ?? "✨"}
                      </span>
                      <span className="text-foreground">@{h}</span>
                      <X className="size-3 text-foreground/60" />
                    </button>
                  );
                })}
              </div>
            )}

            {network.length > 0 && q.trim().length < 2 && (
              <div className="mt-3">
                <p className="text-[11px] text-muted-foreground mb-1.5">From your network</p>
                <div className="space-y-1.5">
                  {network.slice(0, 8).map((h) => {
                    const ig = getIG(h);
                    const on = picks.includes(h);
                    return (
                      <button
                        key={h}
                        onClick={() => toggle(h)}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-colors ${on ? "bg-primary/10 border-primary/30" : "bg-card border-foreground/10 hover:bg-secondary/50"}`}
                      >
                        <div className="size-9 rounded-full bg-secondary border border-foreground/10 overflow-hidden flex items-center justify-center text-base">
                          {ig?.avatar ? <img src={ig.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : ig?.emoji ?? "📸"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{ig?.name ?? `@${h}`}</p>
                          <p className="text-[11px] text-muted-foreground truncate">@{h}</p>
                        </div>
                        {on ? <Check className="size-4 text-primary" /> : <Plus className="size-4 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3">
              <p className="text-[11px] text-muted-foreground mb-1.5">Search Instagram</p>
              <div className="flex items-center gap-2 bg-secondary/60 border border-foreground/10 rounded-xl px-3 py-2">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search any IG handle"
                  className="flex-1 bg-transparent outline-none text-sm"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </div>
              {q.trim().length >= 2 && !loading && results.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">No matches. Try a different handle.</p>
              )}
              {q.trim().length >= 2 && results.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {results.map((u) => {
                    const on = picks.includes(u.handle);
                    return (
                      <button
                        key={u.handle}
                        onClick={() => toggle(u.handle, u)}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-colors ${on ? "bg-primary/10 border-primary/30" : "bg-card border-foreground/10 hover:bg-secondary/50"}`}
                      >
                        <div className="size-9 rounded-full bg-secondary border border-foreground/10 overflow-hidden flex items-center justify-center text-base">
                          {u.avatar ? <img src={u.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : "📸"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{u.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">@{u.handle}</p>
                        </div>
                        {on ? <Check className="size-4 text-primary" /> : <Plus className="size-4 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-foreground/10 space-y-2">
          {err && (
            <p role="alert" className="text-xs text-destructive font-medium">{err}</p>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full min-h-11 rounded-xl bg-foreground text-background font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-transform"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {busy ? "Launching…" : "Launch poll"}
          </button>
        </footer>
      </div>
    </div>
  );
}
