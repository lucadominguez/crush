import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchInstagramUsers, type IGSearchResult } from "@/lib/instagram.functions";

// Module-level cache shared across all hook instances + route mounts.
// Persisted to sessionStorage so refreshes don't re-hit the API.
const CACHE_KEY = "crush.ig.search.cache.v1";
const cache: Map<string, IGSearchResult[]> = (() => {
  if (typeof sessionStorage === "undefined") return new Map();
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
})();
function persist() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {}
}

export type IGSearchState = {
  results: IGSearchResult[];
  loading: boolean;
  error: string | null;
};

export function useIGSearch(rawQuery: string, debounceMs = 300): IGSearchState {
  const search = useServerFn(searchInstagramUsers);
  const reqId = useRef(0);
  const term = rawQuery.trim().replace(/^@/, "").toLowerCase();

  // Seed initial state from cache so the very first paint after typing is
  // instant if we've seen this query before.
  const initial = term.length >= 2 ? cache.get(term) ?? null : null;
  const [state, setState] = useState<IGSearchState>({
    results: initial ?? [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    // Cancel any in-flight previous query.
    const myId = ++reqId.current;

    if (term.length < 2) {
      setState({ results: [], loading: false, error: null });
      return;
    }

    // Cache hit -> apply immediately, no network, no spinner.
    const cached = cache.get(term);
    if (cached) {
      setState({ results: cached, loading: false, error: null });
      return;
    }

    // Cache miss -> clear stale results right away, then debounce.
    setState({ results: [], loading: true, error: null });

    const t = setTimeout(async () => {
      try {
        const { results } = await search({ data: { query: term } });
        if (reqId.current !== myId) return; // a newer query has taken over
        // Dedupe by handle — the upstream API occasionally returns the same
        // user twice across overlapping batches, which crashes React with
        // duplicate-key warnings in the results list.
        const seen = new Set<string>();
        const deduped = results.filter((r) => {
          const h = r.handle.toLowerCase();
          if (seen.has(h)) return false;
          seen.add(h);
          return true;
        });
        cache.set(term, deduped);
        persist();
        setState({ results: deduped, loading: false, error: null });
      } catch (e) {
        if (reqId.current !== myId) return;
        setState({
          results: [],
          loading: false,
          error: e instanceof Error ? e.message : "Search failed",
        });
      }
    }, debounceMs);

    return () => clearTimeout(t);
  }, [term, debounceMs, search]);

  return state;
}
