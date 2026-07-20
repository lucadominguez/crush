import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Users, Search, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { createGroup } from "@/lib/groups";
import { useMyMatches } from "@/lib/store";
import { searchProfiles } from "@/backend/profile.functions";
import { getSessionUserId } from "@/lib/store";

// Minimized identity fields — do not fetch full profiles for member picking.
type PickProfile = {
  user_id: string;
  name: string;
  handle: string;
  emoji: string | null;
  instagram_avatar: string | null;
};

const EMOJI_CHOICES = ["✨", "💖", "🔥", "🌈", "🎉", "🪩", "🍿", "🧃", "🏝️", "👻"];

export function CreateGroupSheet({ onClose }: { onClose: () => void }) {
  const { data: matches } = useMyMatches();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("✨");
  const [picked, setPicked] = useState<Map<string, PickProfile>>(new Map());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    setMe(getSessionUserId());
  }, []);

  // Debounced search across all profiles — minimized columns only.
  useEffect(() => {
    const term = q.trim().replace(/^@/, "");
    if (term.length < 2) { setResults([]); setSearchError(null); return; }
    setSearching(true);
    setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const res = await searchProfiles({ data: { query: term } });
        setResults((res.results as PickProfile[]) ?? []);
      } catch {
        setSearchError("search failed");
        setResults([]);
      }
      setSearching(false);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  function toggle(p: PickProfile) {
    if (!p.user_id || p.user_id === me) return;
    setPicked((cur) => {
      const n = new Map(cur);
      if (n.has(p.user_id)) n.delete(p.user_id); else n.set(p.user_id, p);
      return n;
    });
  }

  async function submit() {
    if (busy) return;
    if (!name.trim()) { toast.error("Give your group a name"); return; }
    if (picked.size < 1) { toast.error("Add at least one person"); return; }
    setBusy(true);
    const res = await createGroup({ name: name.trim(), emoji, memberUserIds: Array.from(picked.keys()) });
    setBusy(false);
    if (res.error || !res.id) { toast.error(res.error ?? "Couldn't create"); return; }
    toast.success("Group created ✨");
    onClose();
    nav({ to: "/app/group/$id", params: { id: res.id } });
  }

  const matchProfiles = useMemo<PickProfile[]>(
    () => matches
      .map((m) => m.other)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        user_id: p.user_id,
        name: p.name,
        handle: p.handle,
        emoji: p.emoji,
        instagram_avatar: p.instagram_avatar,
      })),
    [matches]
  );

  const showList: PickProfile[] = q.trim().length >= 2 ? results : matchProfiles;
  const listLabel = q.trim().length >= 2 ? "Search results" : "Your matches";


  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border-t-2 border-x-2 border-foreground rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto animate-in slide-in-from-bottom duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="size-5" />
            <h2 className="font-black text-lg">Start a group</h2>
          </div>
          <button onClick={onClose} className="size-9 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center tap-scale">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="size-12 rounded-2xl border-2 border-foreground bg-gradient-bubble flex items-center justify-center text-2xl shrink-0">
            {emoji}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name…"
            className="flex-1 px-4 py-3 rounded-2xl border-2 border-foreground bg-secondary outline-none font-bold"
            maxLength={48}
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-3">
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={`text-xl size-10 shrink-0 rounded-full border-2 border-foreground tap-scale ${emoji === e ? "bg-primary" : "bg-secondary"}`}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Search anyone */}
        <div className="relative mb-2">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or @handle…"
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl border-2 border-foreground bg-secondary outline-none text-sm font-medium"
          />
          {searching && (
            <Loader2 className="size-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>

        {/* Picked chips */}
        {picked.size > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Array.from(picked.values()).map((p) => (
              <button
                key={p.user_id}
                onClick={() => toggle(p)}
                className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-primary/30 border-2 border-foreground text-xs font-bold tap-scale"
              >
                <span className="size-5 rounded-full bg-gradient-bubble flex items-center justify-center text-[10px] overflow-hidden">
                  {p.emoji ?? p.name?.[0] ?? "?"}
                </span>
                {p.name ?? p.handle}
                <X className="size-3" />
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] font-black uppercase tracking-wider text-foreground/60 mb-2">
          {listLabel} · {picked.size} picked
        </p>

        {searchError && (
          <div className="p-3 mb-2 rounded-2xl border border-destructive/40 bg-card flex items-center gap-2 text-[12px]">
            <AlertCircle className="size-4 text-destructive shrink-0" />
            <span className="flex-1">Search failed. Try again.</span>
          </div>
        )}

        {showList.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {q.trim().length >= 2
              ? (searching ? "Searching…" : "No one found. Try a different handle.")
              : "Search above to add anyone — or get some matches first."}
          </p>

        ) : (
          <div className="space-y-1.5 mb-4">
            {showList.map((p) => {
              const uid = p.user_id;
              if (!uid || uid === me) return null;
              const on = picked.has(uid);
              return (
                <button
                  key={uid}
                  onClick={() => toggle(p)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-2xl border-2 transition ${
                    on ? "border-foreground bg-primary/30" : "border-transparent bg-secondary/60"
                  }`}
                >
                  <div className="size-10 rounded-full bg-gradient-bubble border-2 border-foreground flex items-center justify-center text-lg overflow-hidden shrink-0">
                    {p.instagram_avatar ? (
                      <img src={`/api/ig-avatar?u=${encodeURIComponent(p.instagram_avatar)}`} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                    ) : (p.emoji ?? p.name?.[0] ?? "?")}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-bold truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">@{p.handle}</p>
                  </div>
                  <span className={`size-6 rounded-full border-2 border-foreground flex items-center justify-center ${on ? "bg-primary" : "bg-card"}`}>
                    {on && <span className="text-xs font-black">✓</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !name.trim() || picked.size === 0}
          className="w-full py-3.5 rounded-full bg-foreground text-background font-black border-2 border-foreground tap-scale disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create group
        </button>
      </div>
    </div>
  );
}
