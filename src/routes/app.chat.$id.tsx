import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck, Dices, Send, Smile, ImageIcon, AlertCircle, RotateCw, ChevronDown, Sparkles, HelpCircle, Flag } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { MobileShell } from "@/components/MobileShell";
import { ReportUserSheet } from "@/components/ReportUserSheet";
import {
  sendMessage,
  retryFailedMessage,
  discardFailedMessage,
  useMatch,
  useMessages,
  useSession,
  markConversationReadRemote,
  type ChatMessage,
} from "@/lib/store";

import { getMatchIcebreakers } from "@/lib/match.functions";
import { MatchExpiryBadge } from "@/components/MatchExpiryBadge";
import { GifPicker, type GifChoice } from "@/components/GifPicker";

const GIF_PREFIX = "[gif]";
function parseGif(text: string): string | null {
  if (!text.startsWith(GIF_PREFIX)) return null;
  const url = text.slice(GIF_PREFIX.length);
  return /^https?:\/\//.test(url) ? url : null;
}

export const Route = createFileRoute("/app/chat/$id")({
  head: () => ({ meta: [{ title: "Chat · Crush" }] }),
  component: ChatPage,
});

const QUICK_EMOJIS = ["❤️", "😂", "😍", "🔥", "👀", "✨", "🥹", "😅", "🙌", "💯"];
const SMART_REPLIES = ["omg same 😭", "tell me more 👀", "lmaooo", "wait what 🤨", "sounds fun ✨", "ok spill 🍵"];
const EMOJI_PALETTE = [
  "😀","😂","🥹","😅","😊","😍","🥰","😘","😎","🤩",
  "🤔","🙃","😴","😭","😱","🤯","🥳","🤗","🤤","😋",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💖","💔",
  "🔥","✨","🌟","⭐","💫","💥","🎉","🪩","🎊","🎈",
  "👀","👋","🙏","🙌","👏","💪","🤝","👌","🤞","🤟",
  "💯","💀","☠️","🥲","😏","😬","🫣","🫡","🫠","🫶",
];
const EIGHT_BALL = [
  "yes 💯", "absolutely", "no chance 🚫", "ask me later 🌚",
  "outlook hazy ✨", "100% yes", "i wouldn't", "you already know 😏",
];
// Safe, lightweight conversation starters — no dating/appearance/stalking prompts.
const WOULD_YOU_RATHER = [
  "would you rather always be 10 min early or 10 min late?",
  "would you rather never use emojis or only use emojis?",
  "would you rather have unlimited concert tickets or unlimited plane tickets?",
  "would you rather live without music or without movies?",
  "would you rather teleport once a day or read minds for an hour?",
  "would you rather always know the weather or always know the traffic?",
];
function rollDice() {
  const a = 1 + Math.floor(Math.random() * 6);
  const b = 1 + Math.floor(Math.random() * 6);
  return `🎲 rolled ${a} + ${b} = ${a + b}`;
}
function eightBall() {
  return `🎱 ${EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)]}`;
}
function wouldYouRather() {
  return `🤔 ${WOULD_YOU_RATHER[Math.floor(Math.random() * WOULD_YOU_RATHER.length)]}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function ChatPage() {
  const { id } = useParams({ from: "/app/chat/$id" });
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const { data: match } = useMatch(id);
  const other = match?.other ?? null;
  const { data: messages, loading, error, refresh } = useMessages(id);
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [icebreakers, setIcebreakers] = useState<string[]>([]);
  const [showNewBanner, setShowNewBanner] = useState(false);
  const fetchIce = useServerFn(getMatchIcebreakers);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);
  const lastLenRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenInitRef = useRef(false);
  const [bannerBump, setBannerBump] = useState(0);

  // Load icebreakers when the chat is empty
  useEffect(() => {
    if (messages.length > 0) return;
    fetchIce({ data: { matchId: id } })
      .then((r) => setIcebreakers(r.icebreakers))
      .catch(() => {});
  }, [id, messages.length, fetchIce]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [text]);

  // Track near-bottom for smart auto-scroll
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < 120;
    if (nearBottomRef.current) setShowNewBanner(false);
  }, []);

  // Auto-scroll only on initial load, my own send, or when already near bottom
  useEffect(() => {
    const cur = messages.length;
    const grew = cur > lastLenRef.current;
    const last = messages[cur - 1];
    const mineLast = last && last.from_user_id === uid;
    if (!grew) { lastLenRef.current = cur; return; }
    if (lastLenRef.current === 0 || mineLast || nearBottomRef.current) {
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: lastLenRef.current === 0 ? "auto" : "smooth" }));
    } else {
      setShowNewBanner(true);
      setBannerBump((n) => n + 1);
    }
    lastLenRef.current = cur;
  }, [messages, uid]);

  // Baseline "seen" IDs once the initial fetch settles — even when the
  // thread is empty — so the very first message afterward animates once.
  useEffect(() => {
    if (seenInitRef.current || loading || error) return;
    messages.forEach((m) => seenIdsRef.current.add(m.id));
    seenInitRef.current = true;
  }, [loading, error, messages]);

  // Mark newly-rendered ids as "seen" so future renders don't re-animate.
  useEffect(() => {
    if (!seenInitRef.current) return;
    messages.forEach((m) => seenIdsRef.current.add(m.id));
  }, [messages]);

  // Mark conversation read (server-side) after the thread has actually loaded.
  useEffect(() => {
    if (!uid || loading || error) return;
    if (document.visibilityState === "visible") {
      markConversationReadRemote("match", id);
    }
    const onVis = () => {
      if (document.visibilityState === "visible") markConversationReadRemote("match", id);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [uid, id, loading, error, messages.length]);


  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    // Clear composer only on success — draft is preserved on failure.
    const snapshot = text;
    setText("");
    setShowEmoji(false);
    const res = await sendMessage(id, t);
    setSending(false);
    if (res.error) {
      // Restore the draft so the user can edit and try again
      setText(snapshot);
    }
  }

  function insertEmoji(emoji: string) {
    setText((cur) => cur + emoji);
    taRef.current?.focus();
  }

  async function sendPreset(t: string) {
    if (sending) return;
    setSending(true);
    await sendMessage(id, t);
    setSending(false);
  }

  async function onRetry(m: ChatMessage) {
    if (!m._clientId) return;
    await retryFailedMessage(id, m._clientId);
  }
  function onDiscard(m: ChatMessage) {
    if (!m._clientId) return;
    // Restore text to composer if empty
    setText((cur) => (cur.trim() ? cur : m.text));
    discardFailedMessage(id, m._clientId);
  }

  // Group consecutive messages from same sender
  const groups = useMemo(() => {
    type G = { from: string; items: ChatMessage[]; day: string };
    const out: G[] = [];
    let lastDay = "";
    for (const m of messages) {
      const day = formatDay(m.created_at);
      if (day !== lastDay) { lastDay = day; out.push({ from: "__day__", items: [{ ...m, text: day }], day }); }
      const last = out[out.length - 1];
      if (last && last.from === m.from_user_id) last.items.push(m);
      else out.push({ from: m.from_user_id, items: [m], day });
    }
    return out;
  }, [messages]);

  return (
    <MobileShell>
      <header className="px-4 py-3 flex items-center gap-3 border-b border-border/60 bg-card/75 backdrop-blur-md sticky top-0 z-10">
        <Link to="/app/messages" className="icon-btn -ml-2" aria-label="Back to messages">
          <ArrowLeft className="size-5" strokeWidth={2.2} />
        </Link>
        <div className="size-10 rounded-full bg-gradient-bubble flex items-center justify-center text-lg overflow-hidden shrink-0 ring-1 ring-border/60">
          {other?.instagram_avatar ? (
            <img src={`/api/ig-avatar?u=${encodeURIComponent(other.instagram_avatar)}`} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : (other?.emoji ?? other?.name?.[0])}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold truncate flex items-center gap-1 text-lead">
            {other?.name ?? "Match"}
            {other?.instagram_verified_at && <BadgeCheck className="size-3.5 text-accent" aria-label="Verified" />}
          </p>
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            {other?.handle && (
              <span className="text-micro text-muted-foreground truncate">@{other.handle}</span>
            )}
            <MatchExpiryBadge expiresAt={match?.expires_at ?? null} />
          </div>
        </div>
        {other?.user_id && (
          <button
            onClick={() => setReportOpen(true)}
            className="icon-btn -mr-1 shrink-0"
            aria-label={`Report ${other?.name ?? "this person"}`}
          >
            <Flag className="size-4" />
          </button>
        )}
      </header>

      {other?.user_id && (
        <ReportUserSheet
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          reportedUserId={other.user_id}
          reportedName={other.name}
        />
      )}

      <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-3 py-4 space-y-1.5 chat-gradient-bg">
        {loading && messages.length === 0 && (
          <div className="space-y-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={`skeleton h-8 max-w-[60%] rounded-2xl ${i % 2 === 0 ? "" : "ml-auto"}`} />
            ))}
          </div>
        )}

        {error && (
          <div className="mx-2 my-3 p-3 rounded-2xl border border-destructive/40 bg-card flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
            <div className="flex-1 text-caption">
              <p className="font-semibold">Couldn't load messages</p>
            </div>
            <button onClick={refresh} className="text-caption font-semibold min-h-11 px-3 rounded-lg border border-border">Retry</button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="text-center mt-10">
            <div className="size-16 mx-auto rounded-full bg-gradient-bubble ring-1 ring-border/60 flex items-center justify-center text-2xl">
              👋
            </div>
            <p className="text-sm text-muted-foreground mt-3">Say hi. This chat is just between you two.</p>
            {icebreakers.length > 0 && (
              <div className="mt-5 px-2">
                <p className="text-nano font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tap to send</p>
                <div className="flex flex-col gap-1.5 max-w-sm mx-auto">
                  {icebreakers.map((tip, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => sendPreset(tip)}
                      className="text-left text-sm font-medium px-4 py-2.5 min-h-11 rounded-2xl bg-card/70 border border-border/60 tap-scale hover:bg-primary/10 transition-colors"
                    >
                      {tip}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {groups.map((g, gi) => {
          if (g.from === "__day__") {
            return (
              <div key={`d-${gi}`} className="flex justify-center my-3">
                <span className="text-nano font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/70 border border-border/60 rounded-full px-3 py-1">
                  {g.day}
                </span>
              </div>
            );
          }
          const mine = g.from === uid;
          return (
            <div key={`g-${gi}`} className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
              {g.items.map((m, mi) => {
                const isLast = mi === g.items.length - 1;
                const onlyEmoji = /^\p{Extended_Pictographic}{1,3}$/u.test(m.text.trim());
                const gifUrl = parseGif(m.text);
                const failed = m._status === "failed";
                const pending = m._status === "pending";
                const isNewMsg = seenInitRef.current && !seenIdsRef.current.has(m.id);
                const anim = isNewMsg ? (mine ? "animate-bubble-r" : "animate-bubble-l") : "";
                return (
                  <div key={m.id} className={`group relative max-w-[80%] ${mine ? "self-end" : "self-start"} ${anim}`}>
                    {gifUrl ? (
                      <div
                        className="block overflow-hidden rounded-2xl ring-1 ring-border/60 bg-secondary"
                        style={{ boxShadow: "0 8px 20px -10px oklch(0.18 0.05 290 / 0.4)", opacity: pending ? 0.7 : 1 }}
                      >
                        <img src={gifUrl} alt="GIF" className="block max-w-[240px] max-h-[280px] object-cover" referrerPolicy="no-referrer" />
                      </div>
                    ) : (
                      <div
                        className={`text-left px-4 py-2.5 text-sm rounded-[22px] ${
                          onlyEmoji
                            ? "bg-transparent text-5xl px-1 py-0.5"
                            : mine
                              ? `bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-[0_2px_10px_-4px_color-mix(in_oklab,var(--primary)_60%,transparent)] ${isLast ? "rounded-br-md" : ""}`
                              : `bg-card text-card-foreground shadow-[0_2px_8px_-4px_rgba(0,0,0,0.18)] border border-border/60 ${isLast ? "rounded-bl-md" : ""}`
                        }`}
                        style={{ opacity: pending ? 0.7 : 1 }}
                      >
                        <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.text}</span>
                      </div>
                    )}
                    {isLast && !failed && !pending && (
                      <div className={`mt-1 flex items-center gap-1 text-nano text-muted-foreground ${mine ? "justify-end" : "justify-start"}`}>
                        <span>{formatTime(m.created_at)}</span>
                      </div>
                    )}
                    {pending && (
                      <div className={`mt-1 text-nano text-muted-foreground ${mine ? "text-right" : "text-left"}`}>
                        Sending…
                      </div>
                    )}
                    {failed && (
                      <div className={`mt-1 flex items-center gap-2 text-micro text-destructive ${mine ? "justify-end" : "justify-start"}`}>
                        <span>Not sent</span>
                        <button onClick={() => onRetry(m)} className="underline font-semibold min-h-11 px-2 rounded">Retry</button>
                        <button onClick={() => onDiscard(m)} className="underline min-h-11 px-2 rounded">Discard</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={endRef} />

        {showNewBanner && (
          <button
            key={bannerBump}
            type="button"
            onClick={() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); setShowNewBanner(false); }}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-primary/95 text-primary-foreground text-xs font-semibold shadow-lg backdrop-blur-md ring-1 ring-border/40 flex items-center gap-1 animate-pop-in"
          >
            <ChevronDown className="size-3" /> New messages
          </button>
        )}
      </div>

      {showEmoji && (
        <div className="border-t border-border/60 bg-card/85 backdrop-blur-md px-3 py-2 max-h-48 overflow-y-auto animate-in slide-in-from-bottom-2 duration-200">
          <div className="grid grid-cols-10 gap-1">
            {EMOJI_PALETTE.map((e) => (
              <button
                key={e}
                onClick={() => insertEmoji(e)}
                className="aspect-square text-xl rounded-lg hover:bg-secondary tap-scale"
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {showGifs && (
        <GifPicker
          onPick={(g: GifChoice) => {
            sendPreset(`${GIF_PREFIX}${g.url}`);
            setShowGifs(false);
          }}
          onClose={() => setShowGifs(false)}
        />
      )}

      {showGames && (
        <div className="border-t border-border/60 bg-card/85 backdrop-blur-md px-3 py-3 animate-in slide-in-from-bottom-2 duration-200">
          <p className="text-nano font-semibold uppercase tracking-wider text-muted-foreground mb-2">Playful · tap to send</p>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => { sendPreset(rollDice()); setShowGames(false); }}
              className="rounded-2xl border border-border/60 bg-secondary/60 hover:bg-primary/10 px-2 py-2.5 flex items-center justify-center gap-2 tap-scale min-h-11 text-caption font-semibold"
            >
              <Dices className="size-4 text-primary" strokeWidth={2.2} />
              Roll dice
            </button>
            <button
              onClick={() => { sendPreset(eightBall()); setShowGames(false); }}
              className="rounded-2xl border border-border/60 bg-secondary/60 hover:bg-primary/10 px-2 py-2.5 flex items-center justify-center gap-2 tap-scale min-h-11 text-caption font-semibold"
            >
              <Sparkles className="size-4 text-accent" strokeWidth={2.2} />
              8-ball
            </button>
            <button
              onClick={() => { sendPreset(wouldYouRather()); setShowGames(false); }}
              className="rounded-2xl border border-border/60 bg-secondary/60 hover:bg-primary/10 px-2 py-2.5 flex items-center justify-center gap-2 tap-scale min-h-11 text-caption font-semibold"
            >
              <HelpCircle className="size-4 text-primary" strokeWidth={2.2} />
              Would U rather
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={submit}
        className="px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-card/85 backdrop-blur-md"
      >
        {!text && !sending && messages.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
            {(messages[messages.length - 1]?.from_user_id !== uid ? SMART_REPLIES : QUICK_EMOJIS).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => sendPreset(s)}
                className="shrink-0 px-3 h-9 min-h-9 rounded-full bg-secondary/80 border border-border text-xs font-semibold tap-scale hover:bg-primary/15 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded-3xl bg-secondary/60 border border-border/70 px-1.5 py-1 shadow-sm">
          <button
            type="button"
            onClick={() => { setShowEmoji((v) => !v); setShowGifs(false); setShowGames(false); }}
            className={`icon-btn ${showEmoji ? "text-primary" : "text-muted-foreground"}`}
            aria-label="Emoji picker"
            aria-pressed={showEmoji}
          >
            <Smile className="size-5" strokeWidth={2.1} />
          </button>
          <button
            type="button"
            onClick={() => { setShowGifs((v) => !v); setShowEmoji(false); setShowGames(false); }}
            className={`h-11 min-w-11 px-2 inline-flex items-center justify-center rounded-xl tap-scale font-black text-micro tracking-wider ${showGifs ? "text-primary" : "text-muted-foreground"}`}
            aria-label="GIF picker"
            aria-pressed={showGifs}
          >
            <ImageIcon className="size-4 mr-1" strokeWidth={2.1} /> GIF
          </button>
          <button
            type="button"
            onClick={() => { setShowGames((v) => !v); setShowEmoji(false); setShowGifs(false); }}
            className={`icon-btn ${showGames ? "text-primary" : "text-muted-foreground"}`}
            aria-label="Playful prompts"
            aria-pressed={showGames}
          >
            <Dices className="size-5" strokeWidth={2.1} />
          </button>
          <label htmlFor="chat-composer" className="sr-only">Message</label>
          <textarea
            id="chat-composer"
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Message…"
            rows={1}
            className="flex-1 bg-transparent outline-none py-2.5 px-1 text-lead resize-none max-h-[140px]"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="Send message"
            className="size-11 shrink-0 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center tap-scale disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {sending ? <RotateCw className="size-4 animate-spin" /> : <Send className="size-4" strokeWidth={2.2} />}
          </button>
        </div>
      </form>
    </MobileShell>
  );
}
