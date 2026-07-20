import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";

// Public Tenor v1 demo key — CORS-enabled, no signup required.
// If this ever stops working, swap to a Klipy key.
const TENOR_KEY = "LIVDSRZULELA";
const TENOR_BASE = "https://g.tenor.com/v1";

type TenorMedia = {
  tinygif?: { url: string; dims: [number, number] };
  nanogif?: { url: string; dims: [number, number] };
  gif?: { url: string; dims: [number, number] };
  mediumgif?: { url: string; dims: [number, number] };
};
type TenorResult = {
  id: string;
  content_description?: string;
  media: TenorMedia[];
};

export type GifChoice = { id: string; url: string; preview: string; w: number; h: number };

const CATEGORIES = [
  { label: "🔥 Trending", q: "" },
  { label: "😂 LOL", q: "lol" },
  { label: "❤️ Love", q: "love" },
  { label: "😍 Cute", q: "cute" },
  { label: "🥺 Aww", q: "aww" },
  { label: "💀 Dead", q: "dead" },
  { label: "🪩 Hype", q: "hype" },
  { label: "💃 Dance", q: "dance" },
  { label: "😮 OMG", q: "omg" },
  { label: "😴 Mood", q: "mood" },
  { label: "👀 Sus", q: "sus" },
  { label: "🙄 Eyeroll", q: "eyeroll" },
];

async function fetchGifs(q: string): Promise<GifChoice[]> {
  const url = q
    ? `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=24&media_filter=minimal&contentfilter=high`
    : `${TENOR_BASE}/trending?key=${TENOR_KEY}&limit=24&media_filter=minimal&contentfilter=high`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("gif fetch failed");
  const j = (await r.json()) as { results: TenorResult[] };
  return (j.results ?? [])
    .map((g) => {
      const m = g.media?.[0];
      const send = m?.gif ?? m?.mediumgif ?? m?.tinygif;
      const prev = m?.tinygif ?? m?.nanogif ?? send;
      if (!send || !prev) return null;
      return {
        id: g.id,
        url: send.url,
        preview: prev.url,
        w: prev.dims?.[0] ?? 200,
        h: prev.dims?.[1] ?? 200,
      } as GifChoice;
    })
    .filter((x): x is GifChoice => !!x);
}

export function GifPicker({ onPick, onClose }: { onPick: (g: GifChoice) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(CATEGORIES[0].q);
  const [items, setItems] = useState<GifChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    const term = q.trim() || active;
    const t = setTimeout(() => {
      fetchGifs(term)
        .then((g) => { if (!ac.signal.aborted) setItems(g); })
        .catch(() => { if (!ac.signal.aborted) { setItems([]); setError("couldn't load GIFs"); } })
        .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    }, q ? 250 : 0);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, active, attempt]);

  return (
    <div className="border-t-2 border-foreground bg-card flex flex-col max-h-[60vh]" role="dialog" aria-label="GIF picker">
      {/* search bar */}
      <div className="p-2.5 flex items-center gap-2 border-b border-border">
        <div className="flex-1 flex items-center gap-2 px-3 h-11 rounded-full bg-secondary border-2 border-foreground">
          <Search className="size-3.5 opacity-60" />
          <label htmlFor="gif-search" className="sr-only">Search GIFs</label>
          <input
            id="gif-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search GIFs…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {q && (
            <button onClick={() => setQ("")} type="button" className="opacity-60 hover:opacity-100 min-h-11 px-2" aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="size-11 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center tap-scale"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* category chips */}
      {!q && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-2.5 py-2 border-b border-border" role="tablist">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              type="button"
              role="tab"
              aria-selected={active === c.q}
              onClick={() => setActive(c.q)}
              className={`shrink-0 px-3 h-9 rounded-full text-xs font-black border-2 border-foreground tap-scale transition-colors ${
                active === c.q ? "bg-primary" : "bg-secondary"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
            <Loader2 className="size-5 animate-spin opacity-60" />
            <span className="sr-only">Loading GIFs</span>
          </div>
        )}
        {!loading && error && (
          <div className="text-center py-10 space-y-2">
            <p className="text-xs text-destructive font-semibold">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="text-xs font-bold min-h-11 px-4 rounded-full border-2 border-foreground bg-secondary tap-scale"
            >
              Try again
            </button>
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-10">No GIFs found. Try another search.</div>
        )}
        <div className="columns-2 gap-2 [&>*]:mb-2">
          {items.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g)}
              aria-label="Pick GIF"
              className="block w-full overflow-hidden rounded-xl border-2 border-foreground bg-secondary tap-scale break-inside-avoid"
              style={{ aspectRatio: `${g.w} / ${g.h}` }}
            >
              <img
                src={g.preview}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
        <p className="text-center text-[9px] text-muted-foreground py-2 opacity-60">Powered by Tenor</p>
      </div>
    </div>
  );
}

