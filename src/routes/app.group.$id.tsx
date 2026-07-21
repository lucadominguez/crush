import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Send, Smile, Users, LogOut, AlertCircle, ChevronDown, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { MobileShell } from "@/components/MobileShell";
import { useSession, markConversationReadRemote } from "@/lib/store";
import { sendGroupMessage, retryFailedGroupMessage, discardFailedGroupMessage, useGroup, useGroupMembers, useGroupMessages, leaveGroup, type GroupMessage, type GroupMember } from "@/lib/groups";


export const Route = createFileRoute("/app/group/$id")({
  head: () => ({ meta: [{ title: "Group · Crush" }] }),
  component: GroupChatPage,
});

const QUICK_EMOJIS = ["❤️", "😂", "😍", "🔥", "👀", "✨", "🥹", "🙌", "💯", "🎉"];
const GIF_PREFIX = "[gif]";

function parseGif(text: string): string | null {
  if (!text.startsWith(GIF_PREFIX)) return null;
  const url = text.slice(GIF_PREFIX.length);
  return /^https?:\/\//.test(url) ? url : null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatDay(iso: string) {
  const d = new Date(iso); const today = new Date(); const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function GroupChatPage() {
  const { id } = useParams({ from: "/app/group/$id" });
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const { data: group, error: groupError } = useGroup(id);
  const { data: members } = useGroupMembers(id);
  const { data: messages, loading, error, refresh } = useGroupMessages(id);
  const [text, setText] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [sending, setSending] = useState(false);
  const [showNewBanner, setShowNewBanner] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);
  const lastLenRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenInitRef = useRef(false);
  const [bannerBump, setBannerBump] = useState(0);

  const memberById = useMemo(() => {
    const m = new Map<string, GroupMember>();
    members.forEach((p) => m.set(p.user_id, p));
    return m;
  }, [members]);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [text]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < 120;
    if (nearBottomRef.current) setShowNewBanner(false);
  }, []);

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


  useEffect(() => {
    if (!seenInitRef.current) return;
    messages.forEach((m) => seenIdsRef.current.add(m.id));
  }, [messages]);

  useEffect(() => {
    if (!uid || loading || error) return;
    if (document.visibilityState === "visible") markConversationReadRemote("group", id);
    const onVis = () => { if (document.visibilityState === "visible") markConversationReadRemote("group", id); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [uid, id, loading, error, messages.length]);


  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    const snapshot = text;
    setText("");
    const res = await sendGroupMessage(id, t);
    setSending(false);
    if (res.error) {
      // Preserve draft so the user can edit and try again
      setText(snapshot);
    }
  }

  async function sendPreset(t: string) {
    if (sending) return;
    setSending(true);
    await sendGroupMessage(id, t);
    setSending(false);
  }

  async function onRetry(m: GroupMessage) {
    if (!m._clientId) return;
    const res = await retryFailedGroupMessage(id, m._clientId);
    if (res.error) toast.error(res.error);
  }
  function onDiscard(m: GroupMessage) {
    if (!m._clientId) return;
    setText((cur) => (cur.trim() ? cur : m.text));
    discardFailedGroupMessage(id, m._clientId);
  }


  async function onLeave() {
    if (!confirm("Leave this group?")) return;
    const res = await leaveGroup(id);
    if (res.error) { toast.error(res.error); return; }
    toast.success("Left the group");
    history.back();
  }

  // group consecutive messages from same sender
  const groups = useMemo(() => {
    type G = { from: string; items: GroupMessage[]; day: string };
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
        <button
          onClick={() => setShowMembers(true)}
          className="flex-1 flex items-center gap-3 min-w-0 text-left tap-scale min-h-11"
        >
          <div className="size-10 rounded-2xl bg-gradient-grape flex items-center justify-center text-xl text-white shrink-0 ring-1 ring-border/60">
            {group?.emoji ?? "✨"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate text-lead">{group?.name ?? (groupError ? "Group unavailable" : "Group")}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="size-3" strokeWidth={2.2} /> {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
        </button>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5 relative">
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
            <div className="flex-1 text-caption font-semibold">Couldn't load messages</div>
            <button onClick={refresh} className="text-caption font-semibold min-h-11 px-3 rounded-lg border border-border">Retry</button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="text-center mt-10">
            <div className="size-16 mx-auto rounded-full bg-gradient-bubble ring-1 ring-border/60 flex items-center justify-center text-2xl">
              👋
            </div>
            <p className="text-sm text-muted-foreground mt-3">Be the first to break the ice.</p>
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
          const sender = memberById.get(g.from);
          return (
            <div key={`g-${gi}`} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              {!mine && (
                <div className="size-7 rounded-full bg-gradient-bubble flex items-center justify-center text-xs overflow-hidden shrink-0 self-end mb-5 ring-1 ring-border/60">
                  {sender?.instagram_avatar ? (
                    <img src={`/api/ig-avatar?u=${encodeURIComponent(sender.instagram_avatar)}`} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                  ) : (sender?.emoji ?? sender?.name?.[0] ?? "?")}
                </div>
              )}
              <div className={`flex flex-col gap-0.5 max-w-[75%] ${mine ? "items-end" : "items-start"}`}>
                {!mine && (
                  <span className="text-nano font-semibold text-muted-foreground px-2 truncate max-w-full">{sender?.name ?? "Someone"}</span>
                )}
                {g.items.map((m, mi) => {
                  const isLast = mi === g.items.length - 1;
                  const gifUrl = parseGif(m.text);
                  const pending = m._status === "pending";
                  const failed = m._status === "failed";
                  const isNewMsg = seenInitRef.current && !seenIdsRef.current.has(m.id);
                  const anim = isNewMsg ? (mine ? "animate-bubble-r" : "animate-bubble-l") : "";
                  return (
                    <div key={m.id} className={anim}>
                      {gifUrl ? (
                        <div
                          className="block overflow-hidden rounded-2xl bg-secondary ring-1 ring-border/60"
                          style={{ opacity: pending ? 0.7 : 1 }}
                        >
                          <img src={gifUrl} alt="GIF" className="block max-w-[240px] max-h-[280px] object-cover" referrerPolicy="no-referrer" />
                        </div>
                      ) : (
                        <div
                          className={`px-3.5 py-2 text-sm rounded-2xl ${
                            mine
                              ? `bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-[0_2px_10px_-4px_color-mix(in_oklab,var(--primary)_60%,transparent)] ${isLast ? "rounded-br-md" : ""}`
                              : `bg-card text-card-foreground shadow-[0_2px_8px_-4px_rgba(0,0,0,0.16)] border border-border/60 ${isLast ? "rounded-bl-md" : ""}`
                          }`}
                          style={{ opacity: pending ? 0.7 : 1 }}
                        >
                          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.text}</span>
                        </div>
                      )}
                      {isLast && !pending && !failed && (
                        <div className={`mt-1 text-nano text-muted-foreground ${mine ? "text-right" : "text-left"}`}>
                          {formatTime(m.created_at)}
                        </div>
                      )}
                      {pending && (
                        <div className={`mt-1 text-nano text-muted-foreground ${mine ? "text-right" : "text-left"}`}>Sending…</div>
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

      <form
        onSubmit={submit}
        className="px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-card/85 backdrop-blur-md"
      >
        {!text && !sending && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => sendPreset(e)}
                aria-label={`Send ${e}`}
                className="text-xl size-10 shrink-0 rounded-full bg-secondary/80 border border-border tap-scale flex items-center justify-center"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-3xl bg-secondary/60 border border-border/70 px-1.5 py-1 shadow-sm">
          <button
            type="button"
            onClick={() => setText((t) => t + "✨")}
            className="icon-btn text-muted-foreground"
            aria-label="Add sparkle emoji"
          >
            <Smile className="size-5" strokeWidth={2.1} />
          </button>
          <label htmlFor="group-composer" className="sr-only">Message the group</label>
          <textarea
            id="group-composer"
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Message the group…"
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

      {showMembers && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowMembers(false)}>
          <div
            className="w-full max-w-md bg-card/95 backdrop-blur-md border-t border-border/60 rounded-t-3xl p-5 max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border/70" aria-hidden />
            <div className="flex items-center gap-3 mb-4">
              <div className="size-12 rounded-2xl bg-gradient-grape ring-1 ring-border/60 flex items-center justify-center text-2xl text-white">
                {group?.emoji ?? "✨"}
              </div>
              <div className="flex-1">
                <p className="font-bold text-lg truncate">{group?.name}</p>
                <p className="text-xs text-muted-foreground">{members.length} {members.length === 1 ? "member" : "members"}</p>
              </div>
            </div>
            <div className="mb-4 divide-y divide-border/60 border border-border/60 rounded-2xl overflow-hidden">
              {members.map((p) => (
                <div key={p.user_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="size-10 rounded-full bg-gradient-bubble ring-1 ring-border/60 flex items-center justify-center text-base overflow-hidden">
                    {p.instagram_avatar ? (
                      <img src={`/api/ig-avatar?u=${encodeURIComponent(p.instagram_avatar)}`} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                    ) : (p.emoji ?? p.name?.[0] ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-body truncate">{p.name}{p.user_id === uid && <span className="text-xs text-muted-foreground font-normal"> · you</span>}</p>
                    <p className="text-micro text-muted-foreground truncate">@{p.handle}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={onLeave}
              className="w-full py-3 min-h-11 rounded-full bg-destructive/10 text-destructive font-semibold ring-1 ring-destructive/30 tap-scale flex items-center justify-center gap-2 hover:bg-destructive/15 transition-colors"
            >
              <LogOut className="size-4" /> Leave group
            </button>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
