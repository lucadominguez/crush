/**
 * Crush · Lovable Cloud backed store.
 *
 * Privacy model:
 * - A user's list of crushes is RLS-restricted so only the owner can read it.
 * - "Matches" are created automatically by a database trigger when two users
 *   have crushes on each other's handles.
 * - Messages are RLS-restricted to the two participants of a match.
 * - Realtime is enabled on messages so chats update live.
 */

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

// ============================================================
// Static "Instagram" directory used as a searchable suggestion
// list. These are NOT real accounts in the DB · they just help
// users find / type handles. Matching only happens when both
// people have actually created accounts with matching handles.
// ============================================================
export type IGAccount = {
  handle: string;
  name: string;
  followers: string;
  verified?: boolean;
  emoji: string;
};

export const IG_ACCOUNTS: IGAccount[] = [
  { handle: "alexrivera", name: "Alex Rivera", followers: "1.2k", emoji: "🌊" },
  { handle: "samchen", name: "Sam Chen", followers: "844", emoji: "🍵" },
  { handle: "jordanlee", name: "Jordan Lee", followers: "3.1k", verified: true, emoji: "🛹" },
  { handle: "miakim", name: "Mia Kim", followers: "12.4k", verified: true, emoji: "🌸" },
  { handle: "tygreen", name: "Ty Green", followers: "612", emoji: "🏀" },
  { handle: "noahb", name: "Noah Brooks", followers: "2.8k", emoji: "🎧" },
  { handle: "isaflores", name: "Isa Flores", followers: "9.7k", verified: true, emoji: "🦋" },
  { handle: "lucamartin", name: "Luca Martín", followers: "1.9k", emoji: "🎸" },
  { handle: "zoey.w", name: "Zoey Walker", followers: "740", emoji: "🍓" },
  { handle: "kaihernandez", name: "Kai Hernandez", followers: "5.5k", emoji: "🌴" },
  { handle: "ellie.r", name: "Ellie Rosen", followers: "388", emoji: "📷" },
  { handle: "devonp", name: "Devon Park", followers: "2.2k", emoji: "🔥" },
  { handle: "amaranthe", name: "Amara Nthe", followers: "6.6k", verified: true, emoji: "✨" },
  { handle: "jaykwon", name: "Jay Kwon", followers: "910", emoji: "🧃" },
  { handle: "ryanp", name: "Ryan Patel", followers: "1.5k", emoji: "🪩" },
  { handle: "soph.m", name: "Sophie Moreau", followers: "4.4k", emoji: "🌷" },
];

export const norm = (v: string) => (v || "").trim().toLowerCase().replace(/^@/, "");

// Runtime cache of IG accounts discovered via the live search API, so the
// rest of the UI (crush list, matches) can render avatar + display name
// for handles that aren't in the static seed list.
const IG_CACHE_KEY = "crush.ig.cache.v1";
type CachedIG = { handle: string; name: string; avatar?: string | null; verified?: boolean };
let _igCache: Record<string, CachedIG> = (() => {
  if (typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(IG_CACHE_KEY) || "{}"); } catch { return {}; }
})();
export function rememberIG(a: CachedIG) {
  const h = norm(a.handle);
  if (!h) return;
  _igCache[h] = { ...a, handle: h };
  try { localStorage.setItem(IG_CACHE_KEY, JSON.stringify(_igCache)); } catch {}
}
export const getIG = (handle: string): (IGAccount & { avatar?: string | null }) | undefined => {
  const h = norm(handle);
  const seed = IG_ACCOUNTS.find((a) => a.handle === h);
  if (seed) return seed;
  const cached = _igCache[h];
  if (cached) return { handle: cached.handle, name: cached.name, followers: "", emoji: "📸", verified: cached.verified, avatar: cached.avatar };
  return undefined;
};

// ============================================================
// Pending pre-signup crush selections (localStorage only).
// ============================================================
const PENDING_KEY = "crush.pending.v1";
const pendingListeners = new Set<() => void>();
function notifyPending() { pendingListeners.forEach((l) => l()); }

function readPending(): string[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; }
}
function writePending(v: string[]) {
  if (typeof localStorage !== "undefined") localStorage.setItem(PENDING_KEY, JSON.stringify(v));
  notifyPending();
}

export function getPendingTargets(): string[] { return readPending(); }
export function usePendingTargets(): string[] {
  const [v, setV] = useState<string[]>(readPending);
  useEffect(() => {
    const l = () => setV(readPending());
    pendingListeners.add(l);
    return () => { pendingListeners.delete(l); };
  }, []);
  return v;
}
export function togglePendingTarget(handle: string, max = 3): { ok: boolean; reason?: string } {
  const h = norm(handle);
  const cur = readPending();
  if (cur.includes(h)) { writePending(cur.filter((x) => x !== h)); return { ok: true }; }
  if (cur.length >= max) return { ok: false, reason: `You can pick up to ${max} crushes.` };
  writePending([...cur, h]);
  return { ok: true };
}
export function clearPending() { writePending([]); }

// ============================================================
// Auth / session
// ============================================================
export type Profile = {
  id: string;
  user_id: string;
  name: string;
  handle: string;
  emoji: string;
  school: string | null;
  city: string | null;
  instagram_handle: string | null;
  instagram_name: string | null;
  instagram_avatar: string | null;
  instagram_followers: number | null;
  instagram_verified_at: string | null;
  instagram_verify_code: string | null;
  trust_score: number;
  crush_slots: number;
  god_mode_expires_at: string | null;
  streak_count: number;
  streak_last_open: string | null;
  referral_code: string | null;
  referred_by: string | null;
  phone_e164: string | null;
  dob: string | null;
  onboarded_at: string | null;
  handle_confirmed_at: string | null;
};

// Pending signup snapshot: preserved across Google OAuth round-trip so that a
// user who filled the compact signup screen and clicked "continue with google"
// still gets their chosen handle + dob applied on return.
const PENDING_SIGNUP_KEY = "crush.pending.signup.v1";
export type PendingSignup = { handle?: string; dob?: string };
export function stashPendingSignup(v: PendingSignup) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(v)); } catch {}
}
export function readPendingSignup(): PendingSignup | null {
  if (typeof localStorage === "undefined") return null;
  try { const raw = localStorage.getItem(PENDING_SIGNUP_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearPendingSignup() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(PENDING_SIGNUP_KEY);
}

const sessionListeners = new Set<() => void>();
let _session: Session | null = null;
let _sessionLoaded = false;

async function applyPendingSignup() {
  const snap = readPendingSignup();
  if (!snap) return;
  try {
    const [{ claimHandle, setDob }] = await Promise.all([
      import("@/lib/onboarding.functions"),
    ]);
    if (snap.handle) { try { await claimHandle({ data: { handle: snap.handle } }); } catch {} }
    if (snap.dob) { try { await setDob({ data: { dob: snap.dob } }); } catch {} }
  } finally {
    clearPendingSignup();
  }
}

// Initialize session listener once at module load (browser only).
if (typeof window !== "undefined") {
  supabase.auth.getSession().then(({ data }) => {
    _session = data.session;
    _sessionLoaded = true;
    sessionListeners.forEach((l) => l());
    if (data.session) {
      applyPendingSignup().finally(() => {
        if (readPending().length) commitPendingCrushes().catch(() => {});
      });
    }
  });
  supabase.auth.onAuthStateChange((_e, s) => {
    const hadSession = !!_session;
    _session = s;
    _sessionLoaded = true;
    sessionListeners.forEach((l) => l());
    if (s && !hadSession) {
      applyPendingSignup().finally(() => {
        commitPendingCrushes().catch(() => {});
      });
    }
  });
}

export function useSession(): { session: Session | null; loading: boolean } {
  const [s, setS] = useState<Session | null>(_session);
  const [loaded, setLoaded] = useState(_sessionLoaded);
  useEffect(() => {
    const l = () => { setS(_session); setLoaded(_sessionLoaded); };
    sessionListeners.add(l);
    return () => { sessionListeners.delete(l); };
  }, []);
  return { session: s, loading: !loaded };
}

export type CommitResult = {
  committed: string[];
  alreadyPresent: string[];
  skippedSelf: string[];
  slotLimited: string[];
  failed: { handle: string; reason: string }[];
  waiting?: boolean;
};
const emptyCommit = (): CommitResult => ({ committed: [], alreadyPresent: [], skippedSelf: [], slotLimited: [], failed: [] });

// Public-facing wrapper: signup/login call this. Commits as soon as a profile
// row exists (created by the handle_new_user trigger). No identity gate.
export async function maybeCommitPendingCrushes(): Promise<CommitResult> {
  const targets = readPending();
  if (!targets.length) return emptyCommit();
  return commitPendingCrushes();
}

export async function signUp(input: { name: string; handle: string; email: string; password: string }): Promise<{ error?: string; commit?: CommitResult }> {
  const handle = norm(input.handle);
  const { error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/app`,
      data: { name: input.name.trim(), handle },
    },
  });
  if (error) return { error: error.message };
  // Don't commit picks here — the caller must first claim handle & save dob.
  return {};
}

export async function signIn(email: string, password: string): Promise<{ error?: string; commit?: CommitResult }> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { error: error.message };
  const commit = await maybeCommitPendingCrushes();
  return { commit };
}

export async function signInWithGoogle(): Promise<{ error?: string; redirected?: boolean }> {
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: window.location.origin,
  });
  if (result.error) return { error: result.error.message || "Google sign-in failed" };
  if (result.redirected) return { redirected: true };
  return {};
}

export async function signOut() { await supabase.auth.signOut(); }

async function waitForProfile(): Promise<Profile | null> {
  // Bounded backoff, ~4s total, waits for handle_new_user() trigger.
  const delays = [100, 150, 250, 400, 600, 800, 800, 800];
  for (const d of delays) {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (uid) {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
      if (data) return data as Profile;
    }
    await new Promise((r) => setTimeout(r, d));
  }
  return null;
}

// In-flight guard so overlapping calls (signUp + onAuthStateChange) coalesce.
let _commitInflight: Promise<CommitResult> | null = null;

export function commitPendingCrushes(): Promise<CommitResult> {
  if (_commitInflight) return _commitInflight;
  _commitInflight = (async (): Promise<CommitResult> => {
    try {
      const result = emptyCommit();
      const targets = Array.from(new Set(readPending().map(norm).filter(Boolean)));
      if (!targets.length) return result;

      const profile = await waitForProfile();
      if (!profile || !profile.handle) {
        // Preserve pending — retry later. No writes attempted.
        return result;
      }
      const uid = profile.user_id;
      const myHandle = norm(profile.handle || "");
      const myIG = norm(profile.instagram_handle || "");

      // Snapshot existing crushes so we can classify "alreadyPresent" without
      // relying on error codes.
      const { data: existing } = await supabase
        .from("crushes")
        .select("target_handle")
        .eq("owner_id", uid);
      const existingSet = new Set((existing ?? []).map((c: { target_handle: string }) => norm(c.target_handle)));

      const stillPending: string[] = [];

      for (const h of targets) {
        if (!h) continue;
        if (h === myHandle || (myIG && h === myIG)) {
          result.skippedSelf.push(h);
          continue;
        }
        if (existingSet.has(h)) {
          result.alreadyPresent.push(h);
          continue;
        }
        const { error } = await supabase
          .from("crushes")
          .insert({ owner_id: uid, target_handle: h });
        if (!error) {
          result.committed.push(h);
          existingSet.add(h);
          continue;
        }
        if (error.code === "23505") {
          result.alreadyPresent.push(h);
          continue;
        }
        if (error.message?.includes("crush_slot_limit_reached")) {
          result.slotLimited.push(h);
          stillPending.push(h);
          continue;
        }
        // Unknown / transient (network, RLS). Keep for retry.
        result.failed.push({ handle: h, reason: "couldn't save — try again" });
        stillPending.push(h);
      }

      writePending(stillPending);
      if (result.committed.length) invalidate(`["crushes",`);
      return result;
    } finally {
      _commitInflight = null;
    }
  })();
  return _commitInflight;
}

export function summarizeCommit(r: CommitResult | undefined): { ok: string | null; warn: string | null } {
  if (!r) return { ok: null, warn: null };
  if (r.waiting) return { ok: null, warn: null };
  const parts: string[] = [];
  if (r.committed.length) parts.push(`sent ${r.committed.length} pick${r.committed.length > 1 ? "s" : ""}`);
  if (r.alreadyPresent.length) parts.push(`${r.alreadyPresent.length} already on your list`);
  const ok = parts.length ? parts.join(" · ") : null;
  const warnBits: string[] = [];
  if (r.skippedSelf.length) warnBits.push("skipped your own handle");
  if (r.slotLimited.length) warnBits.push(`${r.slotLimited.length} over your crush limit`);
  if (r.failed.length) warnBits.push(`${r.failed.length} didn't send — we'll retry`);
  const warn = warnBits.length ? warnBits.join(" · ") : null;
  return { ok, warn };
}

// ============================================================
// Hook helpers · shared module-level cache (SWR-style)
// Multiple components calling the same key share one fetch and one cached
// value, so navigating between screens is instant.
// ============================================================
type Query<T> = { data: T; loading: boolean; error: string | null; refresh: () => void };

type CacheEntry = {
  data: unknown;
  loaded: boolean;
  inflight: Promise<unknown> | null;
  listeners: Set<() => void>;
  error?: string | null;
};
const _cache = new Map<string, CacheEntry>();

function getEntry(key: string): CacheEntry {
  let e = _cache.get(key);
  if (!e) {
    e = { data: undefined, loaded: false, inflight: null, listeners: new Set() };
    _cache.set(key, e);
  }
  return e;
}

function setCache<T>(key: string, data: T) {
  const e = getEntry(key);
  e.data = data;
  e.loaded = true;
  e.listeners.forEach((l) => l());
}

function invalidate(prefix: string) {
  for (const [k, e] of _cache) {
    if (k.startsWith(prefix)) {
      // SWR: keep stale data visible; mark stale and notify so any mounted
      // useQuery kicks off a background refetch.
      (e as CacheEntry & { stale?: boolean }).stale = true;
      e.inflight = null;
      e.listeners.forEach((l) => l());
    }
  }
}

function useQuery<T>(
  key: unknown[],
  fetcher: () => Promise<T>,
  initial: T
): Query<T> {
  const keyStr = JSON.stringify(key);
  const entry = getEntry(keyStr);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    const e = getEntry(keyStr) as CacheEntry & { stale?: boolean };
    if (e.inflight) return;
    // Clear stale error at retry start so the UI reflects loading, not error.
    if (e.error) { e.error = null; e.listeners.forEach((l) => l()); }
    e.inflight = fetcher()
      .then((d) => { e.stale = false; e.error = null; setCache(keyStr, d); return d; })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "something went wrong";
        e.error = msg;
        // Clear inflight BEFORE notifying so listeners observe the final
        // (not-loading, has-error) state in a single tick.
        e.inflight = null;
        e.listeners.forEach((l) => l());
        return undefined;
      })
      .finally(() => { e.inflight = null; });
    // Notify so listeners mounted before refresh() started see loading=true.
    e.listeners.forEach((l) => l());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr]);

  useEffect(() => {
    const e = getEntry(keyStr) as CacheEntry & { stale?: boolean };
    const l = () => {
      setTick((n) => n + 1);
      if (e.stale && !e.inflight) refresh();
    };
    e.listeners.add(l);
    if ((!e.loaded || (e as CacheEntry & { stale?: boolean }).stale) && !e.inflight) refresh();
    return () => { e.listeners.delete(l); };
  }, [keyStr, refresh]);

  // Truthful initial loading: an uncached entry with no error is loading from
  // first render, even before the effect starts the fetch.
  const loading = !entry.loaded && !entry.error;

  return {
    data: (entry.loaded ? (entry.data as T) : initial),
    loading,
    error: entry.error ?? null,
    refresh,
  };
}

// Reset all caches on sign in/out so a new user doesn't see stale data.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange(() => { _cache.clear(); });
}

// ============================================================
// Profile
// ============================================================
export function useMyProfile(): Query<Profile | null> {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  return useQuery<Profile | null>(
    ["profile", uid],
    async () => {
      if (!uid) return null;
      const { data } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
      return (data as Profile) ?? null;
    },
    null
  );
}

// ============================================================
// Crushes
// ============================================================
export type Crush = {
  id: string;
  owner_id: string;
  target_handle: string;
  created_at: string;
};

export function useMyCrushes(): Query<Crush[]> {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  return useQuery<Crush[]>(
    ["crushes", uid],
    async () => {
      if (!uid) return [];
      const { data } = await supabase
        .from("crushes")
        .select("*")
        .eq("owner_id", uid)
        .order("created_at", { ascending: false });
      return (data as Crush[]) ?? [];
    },
    []
  );
}

function crushesCacheKey(uid: string | null) { return JSON.stringify(["crushes", uid]); }
function matchesCacheKey(uid: string | null) { return JSON.stringify(["matches", uid]); }

export async function addCrush(targetHandle: string): Promise<{ error?: string; matchId?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const h = norm(targetHandle);
  if (!h) return { error: "pick someone" };

  // Prevent crushing on self (check both handle and instagram_handle)
  const { data: me } = await supabase
    .from("profiles")
    .select("handle,instagram_handle")
    .eq("user_id", uid)
    .maybeSingle();
  const myHandle = norm(me?.handle ?? "");
  const myIG = norm(me?.instagram_handle ?? "");
  if ((myHandle && h === myHandle) || (myIG && h === myIG)) {
    return { error: "that's you 😅" };
  }

  // Optimistic insert into local cache — only mutate an already-loaded list
  // so we never treat an empty (unloaded) cache as authoritative.
  const ck = crushesCacheKey(uid);
  const entry = getEntry(ck);
  const hadLoaded = entry.loaded;
  const prev = (entry.data as Crush[] | undefined) ?? [];
  const tempId = `temp-${Date.now()}`;
  if (hadLoaded) {
    setCache<Crush[]>(ck, [
      { id: tempId, owner_id: uid, target_handle: h, created_at: new Date().toISOString() },
      ...prev,
    ]);
  }

  const { error } = await supabase.from("crushes").insert({ owner_id: uid, target_handle: h });
  if (error) {
    if (hadLoaded) setCache<Crush[]>(ck, prev);
    if (error.code === "23505") return { error: "already on your list" };
    if (error.message?.includes("crush_slot_limit_reached")) {
      return { error: "you're at your pick limit — drop one first" };
    }
    return { error: "couldn't save that pick — try again" };
  }
  invalidate(`["crushes",`);

  // The trigger may have created a match. It resolves the target by either
  // profiles.handle OR profiles.instagram_handle, so mirror both here — a
  // lookup on handle alone silently misses IG-handle-based mutuals.
  const safe = h.replace(/[,()"']/g, "");
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("user_id")
    .or(`handle.eq.${safe},instagram_handle.eq.${safe}`)
    .maybeSingle();
  if (targetProfile?.user_id && targetProfile.user_id !== uid) {
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .or(`and(user_a_id.eq.${uid},user_b_id.eq.${targetProfile.user_id}),and(user_a_id.eq.${targetProfile.user_id},user_b_id.eq.${uid})`)
      .maybeSingle();
    if (match) {
      invalidate(`["matches",`);
      return { matchId: match.id };
    }
  }
  return {};
}

export async function removeCrush(id: string): Promise<{ error?: string }> {
  // Snapshot every cache we optimistically mutate so we can roll back.
  const snapshots: { key: string; prev: Crush[] }[] = [];
  for (const [k, e] of _cache) {
    if (k.startsWith(`["crushes",`) && Array.isArray(e.data)) {
      const prev = e.data as Crush[];
      snapshots.push({ key: k, prev });
      setCache(k, prev.filter((c) => c.id !== id));
    }
  }
  const { error } = await supabase.from("crushes").delete().eq("id", id);
  if (error) {
    for (const s of snapshots) setCache(s.key, s.prev);
    return { error: "couldn't remove that pick — try again" };
  }
  return {};
}

// ============================================================
// Matches
// ============================================================
// Minimized profile shape used by match/reveal surfaces. Kept narrower than
// full Profile to avoid over-fetching PII and to keep the type honest.
export type MatchProfile = Pick<
  Profile,
  "user_id" | "name" | "handle" | "emoji" | "instagram_avatar" | "instagram_handle" | "instagram_verified_at"
>;

export type Match = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  expires_at: string | null;
  last_message_at: string | null;
  other: MatchProfile | null;
};

export function useMyMatches(): Query<Match[]> {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  return useQuery<Match[]>(
    ["matches", uid],
    async () => {
      if (!uid) return [];
      const { data: matches, error: matchesErr } = await supabase
        .from("matches")
        .select("id,user_a_id,user_b_id,created_at,expires_at,last_message_at")
        .or(`user_a_id.eq.${uid},user_b_id.eq.${uid}`)
        .order("created_at", { ascending: false });
      if (matchesErr) throw new Error("couldn't load your matches");
      const list = (matches as Omit<Match, "other">[]) ?? [];
      if (!list.length) return [];
      const otherIds = list.map((m) => (m.user_a_id === uid ? m.user_b_id : m.user_a_id));
      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("user_id,name,handle,emoji,instagram_avatar,instagram_handle,instagram_verified_at")
        .in("user_id", otherIds);
      if (profErr) throw new Error("couldn't load match profiles");
      const byId = new Map(((profiles ?? []) as MatchProfile[]).map((p) => [p.user_id, p]));
      return list.map((m) => ({
        ...m,
        other: byId.get(m.user_a_id === uid ? m.user_b_id : m.user_a_id) ?? null,
      }));
    },
    []
  );
}

export function useMatch(id: string): Query<Match | null> {
  const { data, loading, error, refresh } = useMyMatches();
  const match = data.find((m) => m.id === id) ?? null;
  return { data: match, loading, error, refresh };
}

// ============================================================
// Messages (with realtime)
// ============================================================
export type ChatMessage = {
  id: string;
  match_id: string;
  from_user_id: string;
  text: string;
  created_at: string;
  /** Server-side idempotency key. Null on legacy rows. */
  client_id?: string | null;
  /** Local-only status for the caller's own optimistic bubble. */
  _status?: "pending" | "failed";
  /** Local-only alias of client_id for optimistic reconciliation. */
  _clientId?: string;
};


export function useMessages(matchId: string): Query<ChatMessage[]> & { data: ChatMessage[] } {
  const [data, setData] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ck = JSON.stringify(["messages", matchId]);

  const refresh = useCallback(async () => {
    setError(null);
    const { data: msgs, error: err } = await supabase
      .from("messages")
      .select("*")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });
    if (err) {
      setLoading(false);
      setError("couldn't load messages");
      return;
    }
    // Preserve local pending/failed rows on top of authoritative server rows.
    const serverRows = (msgs as ChatMessage[]) ?? [];
    const localPending = ((getEntry(ck).data as ChatMessage[] | undefined) ?? [])
      .filter((m) => m._status === "pending" || m._status === "failed");
    // Drop any local pending whose clientId now exists as a real server row
    // (server rows carry client_id, never _clientId — compare correctly).
    const merged = [
      ...serverRows,
      ...localPending.filter((p) => !serverRows.some((s) => s.client_id && s.client_id === p._clientId)),
    ];
    setCache<ChatMessage[]>(ck, merged);
    setData(merged);
    setLoading(false);
  }, [matchId, ck]);


  useEffect(() => {
    refresh();
    // Sync cache -> local state so optimistic changes render.
    const entry = getEntry(ck);
    const l = () => setData(((entry.data as ChatMessage[] | undefined) ?? []).slice());
    entry.listeners.add(l);
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const next = payload.new as ChatMessage;
          const cur = ((getEntry(ck).data as ChatMessage[] | undefined) ?? []);
          // Deterministic reconciliation identical to response/retry/refresh:
          // exactly one row per (id, client_id). Idempotent for duplicate events.
          if (next.client_id) {
            setCache<ChatMessage[]>(ck, reconcileServerRow(cur, next, next.client_id));
          } else if (!cur.some((m) => m.id === next.id)) {
            setCache<ChatMessage[]>(ck, [...cur, next]);
          }
        }

      )
      .subscribe();
    return () => { entry.listeners.delete(l); supabase.removeChannel(channel); };
  }, [matchId, refresh, ck]);

  return { data, loading, error, refresh };
}

async function insertMessageIdempotent(matchId: string, uid: string, text: string, clientId: string): Promise<{ row?: ChatMessage; error?: string }> {
  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({ match_id: matchId, from_user_id: uid, text, client_id: clientId })
    .select("*")
    .single();
  if (!error && inserted) return { row: inserted as ChatMessage };
  // Idempotent recovery: same (match, sender, client_id) already exists →
  // treat as success and adopt the existing row.
  if (error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
    const { data: existing } = await supabase
      .from("messages")
      .select("*")
      .eq("match_id", matchId)
      .eq("from_user_id", uid)
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) return { row: existing as ChatMessage };
  }
  return { error: error?.message ?? "insert_failed" };
}

/** Deterministic reconciliation: replace any row matching the server row's real
 *  id OR the exact client_id/_clientId with a single canonical server row.
 *  Safe against arbitrary orderings (response-then-realtime, realtime-then-response,
 *  duplicate realtime events, and retry after unique-conflict recovery). */
function reconcileServerRow<T extends { id: string; client_id?: string | null; _clientId?: string }>(
  rows: T[],
  server: T,
  clientId: string,
): T[] {
  const stamped = { ...server, _clientId: clientId } as T;
  const filtered = rows.filter((m) => m.id !== server.id && m._clientId !== clientId);
  return [...filtered, stamped];
}



/** Send a DM. On failure the temp bubble is kept as `_status: "failed"` for retry.
 *  On success the temp bubble is replaced by the server row. */
export async function sendMessage(matchId: string, text: string): Promise<{ error?: string; clientId?: string }> {
  const t = text.trim();
  if (!t) return {};
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const ck = JSON.stringify(["messages", matchId]);
  const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempId = `temp-${clientId}`;
  const prev = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  // Guard against accidental double-submit of the same clientId.
  if (prev.some((m) => m._clientId === clientId)) return { clientId };
  setCache<ChatMessage[]>(ck, [
    ...prev,
    { id: tempId, _clientId: clientId, _status: "pending", match_id: matchId, from_user_id: uid, text: t, created_at: new Date().toISOString(), client_id: clientId },
  ]);
  const res = await insertMessageIdempotent(matchId, uid, t, clientId);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  if (res.error || !res.row) {
    setCache<ChatMessage[]>(ck, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "couldn't send — tap to retry", clientId };
  }
  setCache<ChatMessage[]>(ck, reconcileServerRow(cur, res.row, clientId));

  return { clientId };
}

/** Retry a previously-failed message by client id. */
export async function retryFailedMessage(matchId: string, clientId: string): Promise<{ error?: string }> {
  // Always derive the authenticated user — never trust a stale from_user_id.
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const ck = JSON.stringify(["messages", matchId]);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  const target = cur.find((m) => m._clientId === clientId && m._status === "failed");
  if (!target) return {};
  setCache<ChatMessage[]>(ck, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "pending" } : m)));
  const res = await insertMessageIdempotent(matchId, uid, target.text, clientId);
  const cur2 = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  if (res.error || !res.row) {
    setCache<ChatMessage[]>(ck, cur2.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "still couldn't send — check your connection" };
  }
  setCache<ChatMessage[]>(ck, reconcileServerRow(cur2, res.row, clientId));

  return {};
}

/** Discard a failed message (composer restore path). */
export function discardFailedMessage(matchId: string, clientId: string) {
  const ck = JSON.stringify(["messages", matchId]);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  setCache<ChatMessage[]>(ck, cur.filter((m) => m._clientId !== clientId));
}


// ============================================================
// Conversation read-state (server-backed, per-user, cross-device).
// Backed by public.conversation_reads with RLS: users only see/write their
// own row, and only for a chat they currently participate in. The read
// timestamp is stamped by the server via mark_conversation_read().
// ============================================================
export type ConvKind = "match" | "group";
export type ConversationReadMap = Record<string, number>; // key: `${kind}:${id}` → ms epoch

function readsKeyFor(uid: string | null) { return JSON.stringify(["conversation-reads", uid]); }

async function fetchConversationReads(uid: string | null): Promise<ConversationReadMap> {
  if (!uid) return {};
  const { data, error } = await supabase
    .from("conversation_reads")
    .select("kind,conv_id,last_read_at")
    .eq("user_id", uid);
  if (error) throw new Error("couldn't load read state");
  const map: ConversationReadMap = {};
  for (const row of (data ?? []) as { kind: string; conv_id: string; last_read_at: string }[]) {
    map[`${row.kind}:${row.conv_id}`] = new Date(row.last_read_at).getTime();
  }
  return map;
}

/** Server-backed read state for all my conversations. Cached + reactive. */
export function useConversationReads(): { reads: ConversationReadMap; loading: boolean; error: string | null } {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const q = useQuery<ConversationReadMap>(
    ["conversation-reads", uid],
    () => fetchConversationReads(uid),
    {}
  );
  return { reads: q.data, loading: q.loading, error: q.error };
}

/** Mark a conversation read on the server (uses server timestamp). */
export async function markConversationReadRemote(kind: ConvKind, convId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return;
  const { data, error } = await supabase.rpc("mark_conversation_read", { _kind: kind, _conv_id: convId });
  if (error) return;
  const payload = data as { ok?: boolean; at?: string } | null;
  if (!payload?.ok || !payload.at) return;
  // Optimistically update the cache so DM/group list badges clear immediately.
  const ck = readsKeyFor(uid);
  const cur = (getEntry(ck).data as ConversationReadMap | undefined) ?? {};
  setCache<ConversationReadMap>(ck, { ...cur, [`${kind}:${convId}`]: new Date(payload.at).getTime() });
}

// ============================================================
// Latest-message previews for the conversation list.
// Uses the SECURITY DEFINER RPC latest_match_previews() so we always get the
// single most recent message per accessible match (no arbitrary row cap).
// ============================================================
export type LatestPreview = { text: string; created_at: string; from_user_id: string };

export function useLatestMatchPreviews(matchIds: string[]): { previews: Record<string, LatestPreview>; loading: boolean; error: string | null; refresh: () => void } {
  const key = JSON.stringify(["match-previews", matchIds.slice().sort()]);
  const [state, setState] = useState<{ map: Record<string, LatestPreview>; loading: boolean; error: string | null }>(
    { map: {}, loading: matchIds.length > 0, error: null }
  );

  const refresh = useCallback(async () => {
    if (!matchIds.length) { setState({ map: {}, loading: false, error: null }); return; }
    // Keep last-known previews visible during retry — never clear the map on error.
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.rpc("latest_match_previews");
    if (error) { setState((s) => ({ map: s.map, loading: false, error: "couldn't load previews" })); return; }
    const filter = new Set(matchIds);
    const map: Record<string, LatestPreview> = {};
    for (const row of ((data ?? []) as { match_id: string; from_user_id: string; text: string; created_at: string }[])) {
      if (!filter.has(row.match_id)) continue;
      map[row.match_id] = { text: row.text, created_at: row.created_at, from_user_id: row.from_user_id };
    }
    setState({ map, loading: false, error: null });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  // Live-update on new messages in any of my matches.
  useEffect(() => {
    if (!matchIds.length) return;
    const ch = supabase
      .channel(`match-previews:${matchIds.join(",").slice(0, 60)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!matchIds.includes(m.match_id)) return;
        setState((s) => ({
          ...s,
          map: { ...s.map, [m.match_id]: { text: m.text, created_at: m.created_at, from_user_id: m.from_user_id } },
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { previews: state.map, loading: state.loading, error: state.error, refresh };
}


export type Poll = {
  id: string;
  question: string;
  option_handles: string[];
  created_at: string;
  created_by: string | null;
  school?: string | null;
};

export type PollOptionInfo = {
  handle: string;
  name: string | null;
  avatar: string | null;
  verified: boolean;
};

export type PollWithStats = Poll & {
  votes: Record<string, number>;
  myVote: string | null;
  optionInfo: PollOptionInfo[];
};

type PollFeedRow = {
  id: string;
  question: string;
  option_handles: string[];
  created_at: string;
  created_by: string | null;
  school: string | null;
  votes: Record<string, number> | null;
  my_vote: string | null;
  option_info: PollOptionInfo[] | null;
};

export function usePolls(): Query<PollWithStats[]> {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  return useQuery<PollWithStats[]>(
    ["polls", uid],
    async () => {
      if (!uid) return [];
      const { data, error } = await supabase.rpc("get_polls_feed" as never);
      if (error) throw new Error("couldn't load polls");
      const payload = (data as { polls?: PollFeedRow[] } | null) ?? { polls: [] };
      const rows = payload.polls ?? [];
      // Warm the local IG cache so option cards render a credible identity
      // even when getIG has no static seed for a real profile handle.
      for (const r of rows) {
        for (const opt of r.option_info ?? []) {
          if (opt?.handle && (opt.name || opt.avatar)) {
            rememberIG({
              handle: opt.handle,
              name: opt.name ?? opt.handle,
              avatar: opt.avatar ?? null,
              verified: !!opt.verified,
            });
          }
        }
      }
      return rows.map<PollWithStats>((r) => ({
        id: r.id,
        question: r.question,
        option_handles: r.option_handles,
        created_at: r.created_at,
        created_by: r.created_by,
        school: r.school,
        votes: r.votes ?? {},
        myVote: r.my_vote ?? null,
        optionInfo: r.option_info ?? [],
      }));
    },
    []
  );
}


export type VotePollResult = {
  ok: boolean;
  /** true when the caller had already voted before this call */
  already?: boolean;
  /** server-confirmed handle the caller actually voted for, if known */
  ownVote?: string | null;
  error?: string;
  code?: "already_voted" | "not_authenticated" | "invalid_option" | "poll_not_found" | "network" | "unknown";
};

export async function votePoll(pollId: string, handle: string): Promise<VotePollResult> {
  const { data, error } = await supabase.rpc("cast_poll_vote" as never, {
    _poll_id: pollId,
    _handle: handle,
  } as never);
  if (error) return { ok: false, code: "network", error: "couldn't record your vote — try again" };
  const r = data as { ok: boolean; error?: string; already?: boolean; own_vote?: string | null } | null;
  if (!r?.ok) {
    const code = (r?.error ?? "unknown") as VotePollResult["code"];
    const msg =
      code === "already_voted" ? "you already voted on this one"
      : code === "not_authenticated" ? "sign in first"
      : code === "invalid_option" ? "that option isn't part of this poll"
      : code === "poll_not_found" ? "this poll is gone"
      : "couldn't record your vote — try again";
    return {
      ok: false,
      code,
      already: r?.already ?? code === "already_voted",
      ownVote: r?.own_vote ?? null,
      error: msg,
    };
  }
  invalidate(`["polls",`);
  return { ok: true, ownVote: r?.own_vote ?? null };
}

export async function createPoll(question: string, handles: string[]): Promise<{ error?: string; id?: string }> {
  const opts = Array.from(new Set(handles.map(norm).filter(Boolean)));
  const { data, error } = await supabase.rpc("create_poll" as never, {
    _question: question,
    _handles: opts,
  } as never);
  if (error) return { error: "couldn't launch poll — try again" };
  const r = data as { ok: boolean; id?: string; error?: string } | null;
  if (!r?.ok) {
    const code = r?.error ?? "unknown";
    const msg =
      code === "not_authenticated" ? "sign in first"
      : code === "invalid_question" ? "question needs 5–120 characters"
      : code === "invalid_options" ? "pick 2–4 unique people"
      : code === "rate_limited" ? "you've launched 3 polls today — try again tomorrow"
      : "couldn't launch poll — try again";
    return { error: msg };
  }
  invalidate(`["polls",`);
  return { id: r.id };
}

// Network suggestions: handles the user already interacts with (their crushes,
// match partners' IG handles, and previously-searched IG accounts).
export function useNetworkSuggestions(): string[] {
  const { data: crushes } = useMyCrushes();
  const { data: matches } = useMyMatches();
  const set = new Set<string>();
  crushes.forEach((c) => set.add(norm(c.target_handle)));
  matches.forEach((m) => {
    if (m.other?.instagram_handle) set.add(norm(m.other.instagram_handle));
  });
  Object.keys(_igCache).forEach((h) => h && set.add(h));
  return Array.from(set).filter(Boolean);
}
