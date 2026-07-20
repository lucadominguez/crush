/**
 * Crush · client store (Cloudflare D1 backend).
 *
 * Privacy model (enforced server-side in src/server/*, no RLS):
 * - A user's crush list is only readable by its owner.
 * - Matches are created atomically inside addCrushFn when reciprocal.
 * - Messages are restricted to the two participants of a match.
 * - Realtime: short-interval polling while a surface is open (Durable Object
 *   websockets are the planned upgrade — see OUTSTANDING.md).
 *
 * The SWR-style module cache + optimistic reconcile logic is preserved from
 * the Supabase era; only the transport changed (server fns over cookie auth).
 */

import { useCallback, useEffect, useState } from "react";

import { getMeFn, signInFn, signOutFn, signUpFn } from "@/server/auth.functions";
import {
  addCrushFn,
  listMyCrushes,
  listMyMatches,
  listMessages,
  removeCrushFn,
  sendMessageFn,
  type MatchWithOther,
} from "@/server/crush.functions";
import { getConversationReads, latestMatchPreviews } from "@/server/groups.functions";
import { markConversationRead } from "@/server/profile.functions";
import { castPollVote, createPollFn, getPollsFeed } from "@/server/polls.functions";

// ============================================================
// Static "Instagram" directory used as a searchable suggestion
// list. These are NOT real accounts in the DB · they just help
// users find / type handles.
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

// Runtime cache of IG accounts discovered via the live search API.
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
// Auth / session (cookie session; server is the authority)
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

/** Minimal session shape (was @supabase/supabase-js Session). */
export type Session = { user: { id: string; email: string } };

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

function setSessionState(s: Session | null) {
  const hadSession = !!_session;
  _session = s;
  _sessionLoaded = true;
  _cache.clear(); // never show a previous user's data
  sessionListeners.forEach((l) => l());
  if (s && !hadSession) {
    applyPendingSignup().finally(() => {
      if (readPending().length) commitPendingCrushes().catch(() => {});
    });
  }
}

async function applyPendingSignup() {
  const snap = readPendingSignup();
  if (!snap) return;
  try {
    const { claimHandle, setDob } = await import("@/lib/onboarding.functions");
    if (snap.handle) { try { await claimHandle({ data: { handle: snap.handle } }); } catch {} }
    if (snap.dob) { try { await setDob({ data: { dob: snap.dob } }); } catch {} }
  } finally {
    clearPendingSignup();
  }
}

/** Re-fetch the authoritative session from the server (cookie-backed). */
export async function refreshSession(): Promise<Session | null> {
  try {
    const res = await getMeFn();
    const s = res.user ? { user: { id: res.user.userId, email: res.user.email } } : null;
    _session = s;
    _sessionLoaded = true;
    sessionListeners.forEach((l) => l());
    return s;
  } catch {
    _session = null;
    _sessionLoaded = true;
    sessionListeners.forEach((l) => l());
    return null;
  }
}

// Initialize session once at module load (browser only).
if (typeof window !== "undefined") {
  refreshSession().then((s) => {
    if (s) {
      applyPendingSignup().finally(() => {
        if (readPending().length) commitPendingCrushes().catch(() => {});
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

export async function maybeCommitPendingCrushes(): Promise<CommitResult> {
  const targets = readPending();
  if (!targets.length) return emptyCommit();
  return commitPendingCrushes();
}

export async function signUp(input: { name: string; handle: string; email: string; password: string }): Promise<{ error?: string; commit?: CommitResult }> {
  const handle = norm(input.handle);
  const res = await signUpFn({ data: { name: input.name.trim(), handle, email: input.email.trim(), password: input.password } });
  if ("error" in res && res.error) return { error: res.error };
  setSessionState(await refreshSession());
  return {};
}

export async function signIn(email: string, password: string): Promise<{ error?: string; commit?: CommitResult }> {
  const res = await signInFn({ data: { email: email.trim(), password } });
  if ("error" in res && res.error) return { error: res.error };
  setSessionState(await refreshSession());
  const commit = await maybeCommitPendingCrushes();
  return { commit };
}

// Google OAuth was provided by Lovable's auth broker. Off-platform it needs
// its own OAuth client + domain — deferred (see OUTSTANDING.md). Email works.
export async function signInWithGoogle(): Promise<{ error?: string; redirected?: boolean }> {
  return { error: "google sign-in is coming back soon — use email for now" };
}

export async function signOut() {
  try { await signOutFn(); } catch {}
  setSessionState(null);
}

async function waitForProfile(): Promise<Profile | null> {
  // Profile is created in the same transaction as the user now; a couple of
  // retries only cover transient network failures.
  const delays = [0, 300, 800];
  for (const d of delays) {
    if (d) await new Promise((r) => setTimeout(r, d));
    try {
      const res = await getMeFn();
      if (res.profile) return res.profile as unknown as Profile;
      if (!res.user) return null;
    } catch {}
  }
  return null;
}

// In-flight guard so overlapping calls coalesce.
let _commitInflight: Promise<CommitResult> | null = null;

export function commitPendingCrushes(): Promise<CommitResult> {
  if (_commitInflight) return _commitInflight;
  _commitInflight = (async (): Promise<CommitResult> => {
    try {
      const result = emptyCommit();
      const targets = Array.from(new Set(readPending().map(norm).filter(Boolean)));
      if (!targets.length) return result;

      const profile = await waitForProfile();
      if (!profile || !profile.handle) return result; // preserve pending, retry later

      const stillPending: string[] = [];
      for (const h of targets) {
        if (!h) continue;
        try {
          const res = await addCrushFn({ data: { targetHandle: h } });
          if (res.ok) { result.committed.push(h); continue; }
          if (res.error === "self") { result.skippedSelf.push(h); continue; }
          if (res.error === "duplicate") { result.alreadyPresent.push(h); continue; }
          if (res.error === "slot_limit") {
            result.slotLimited.push(h);
            stillPending.push(h);
            continue;
          }
          result.failed.push({ handle: h, reason: "couldn't save — try again" });
          stillPending.push(h);
        } catch {
          result.failed.push({ handle: h, reason: "couldn't save — try again" });
          stillPending.push(h);
        }
      }

      writePending(stillPending);
      if (result.committed.length) { invalidate(`["crushes",`); invalidate(`["matches",`); }
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
      (e as CacheEntry & { stale?: boolean }).stale = true;
      e.inflight = null;
      e.listeners.forEach((l) => l());
    }
  }
}

function useQuery<T>(key: unknown[], fetcher: () => Promise<T>, initial: T): Query<T> {
  const keyStr = JSON.stringify(key);
  const entry = getEntry(keyStr);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    const e = getEntry(keyStr) as CacheEntry & { stale?: boolean };
    if (e.inflight) return;
    if (e.error) { e.error = null; e.listeners.forEach((l) => l()); }
    e.inflight = fetcher()
      .then((d) => { e.stale = false; e.error = null; setCache(keyStr, d); return d; })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "something went wrong";
        e.error = msg;
        e.inflight = null;
        e.listeners.forEach((l) => l());
        return undefined;
      })
      .finally(() => { e.inflight = null; });
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

  const loading = !entry.loaded && !entry.error;

  return {
    data: (entry.loaded ? (entry.data as T) : initial),
    loading,
    error: entry.error ?? null,
    refresh,
  };
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
      const res = await getMeFn();
      return (res.profile as unknown as Profile) ?? null;
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
      return (await listMyCrushes()) as Crush[];
    },
    []
  );
}

function crushesCacheKey(uid: string | null) { return JSON.stringify(["crushes", uid]); }

export async function addCrush(targetHandle: string): Promise<{ error?: string; matchId?: string }> {
  const uid = _session?.user.id;
  if (!uid) return { error: "sign in first" };
  const h = norm(targetHandle);
  if (!h) return { error: "pick someone" };

  // Optimistic insert into local cache — only mutate an already-loaded list.
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

  let res: Awaited<ReturnType<typeof addCrushFn>>;
  try {
    res = await addCrushFn({ data: { targetHandle: h } });
  } catch {
    if (hadLoaded) setCache<Crush[]>(ck, prev);
    return { error: "couldn't save that pick — try again" };
  }
  if (!res.ok) {
    if (hadLoaded) setCache<Crush[]>(ck, prev);
    if (res.error === "self") return { error: "that's you 😅" };
    if (res.error === "duplicate") return { error: "already on your list" };
    if (res.error === "slot_limit") return { error: "you're at your pick limit — drop one first" };
    return { error: "couldn't save that pick — try again" };
  }
  invalidate(`["crushes",`);
  if (res.matchId) {
    invalidate(`["matches",`);
    return { matchId: res.matchId };
  }
  return {};
}

export async function removeCrush(id: string): Promise<{ error?: string }> {
  const snapshots: { key: string; prev: Crush[] }[] = [];
  for (const [k, e] of _cache) {
    if (k.startsWith(`["crushes",`) && Array.isArray(e.data)) {
      const prev = e.data as Crush[];
      snapshots.push({ key: k, prev });
      setCache(k, prev.filter((c) => c.id !== id));
    }
  }
  try {
    await removeCrushFn({ data: { id } });
  } catch {
    for (const s of snapshots) setCache(s.key, s.prev);
    return { error: "couldn't remove that pick — try again" };
  }
  return {};
}

// ============================================================
// Matches
// ============================================================
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
      const matches: MatchWithOther[] = await listMyMatches();
      return matches as unknown as Match[];
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
// Messages (polling transport)
// ============================================================
export type ChatMessage = {
  id: string;
  match_id: string;
  from_user_id: string;
  text: string;
  created_at: string;
  client_id?: string | null;
  _status?: "pending" | "failed";
  _clientId?: string;
};

const CHAT_POLL_MS = 4000;

export function useMessages(matchId: string): Query<ChatMessage[]> & { data: ChatMessage[] } {
  const [data, setData] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ck = JSON.stringify(["messages", matchId]);

  const refresh = useCallback(async () => {
    setError(null);
    let serverRows: ChatMessage[];
    try {
      serverRows = (await listMessages({ data: { matchId } })) as ChatMessage[];
    } catch {
      setLoading(false);
      setError("couldn't load messages");
      return;
    }
    // Preserve local pending/failed rows on top of authoritative server rows.
    const localPending = ((getEntry(ck).data as ChatMessage[] | undefined) ?? [])
      .filter((m) => m._status === "pending" || m._status === "failed");
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
    const entry = getEntry(ck);
    const l = () => setData(((entry.data as ChatMessage[] | undefined) ?? []).slice());
    entry.listeners.add(l);
    // Poll while the chat is open (replaces the Supabase realtime channel).
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, CHAT_POLL_MS);
    return () => { entry.listeners.delete(l); clearInterval(iv); };
  }, [matchId, refresh, ck]);

  return { data, loading, error, refresh };
}

async function insertMessageIdempotent(matchId: string, text: string, clientId: string): Promise<{ row?: ChatMessage; error?: string }> {
  try {
    const res = await sendMessageFn({ data: { matchId, text, clientId } });
    if (res.ok) return { row: res.message as ChatMessage };
    return { error: res.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "insert_failed" };
  }
}

/** Deterministic reconciliation (unchanged from the Supabase era). */
function reconcileServerRow<T extends { id: string; client_id?: string | null; _clientId?: string }>(
  rows: T[],
  server: T,
  clientId: string,
): T[] {
  const stamped = { ...server, _clientId: clientId } as T;
  const filtered = rows.filter((m) => m.id !== server.id && m._clientId !== clientId);
  return [...filtered, stamped];
}

export async function sendMessage(matchId: string, text: string): Promise<{ error?: string; clientId?: string }> {
  const t = text.trim();
  if (!t) return {};
  const uid = _session?.user.id;
  if (!uid) return { error: "sign in first" };
  const ck = JSON.stringify(["messages", matchId]);
  const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempId = `temp-${clientId}`;
  const prev = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  if (prev.some((m) => m._clientId === clientId)) return { clientId };
  setCache<ChatMessage[]>(ck, [
    ...prev,
    { id: tempId, _clientId: clientId, _status: "pending", match_id: matchId, from_user_id: uid, text: t, created_at: new Date().toISOString(), client_id: clientId },
  ]);
  const res = await insertMessageIdempotent(matchId, t, clientId);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  if (res.error || !res.row) {
    setCache<ChatMessage[]>(ck, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "couldn't send — tap to retry", clientId };
  }
  setCache<ChatMessage[]>(ck, reconcileServerRow(cur, res.row, clientId));
  return { clientId };
}

export async function retryFailedMessage(matchId: string, clientId: string): Promise<{ error?: string }> {
  const uid = _session?.user.id;
  if (!uid) return { error: "sign in first" };
  const ck = JSON.stringify(["messages", matchId]);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  const target = cur.find((m) => m._clientId === clientId && m._status === "failed");
  if (!target) return {};
  setCache<ChatMessage[]>(ck, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "pending" } : m)));
  const res = await insertMessageIdempotent(matchId, target.text, clientId);
  const cur2 = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  if (res.error || !res.row) {
    setCache<ChatMessage[]>(ck, cur2.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "still couldn't send — check your connection" };
  }
  setCache<ChatMessage[]>(ck, reconcileServerRow(cur2, res.row, clientId));
  return {};
}

export function discardFailedMessage(matchId: string, clientId: string) {
  const ck = JSON.stringify(["messages", matchId]);
  const cur = (getEntry(ck).data as ChatMessage[] | undefined) ?? [];
  setCache<ChatMessage[]>(ck, cur.filter((m) => m._clientId !== clientId));
}

// ============================================================
// Conversation read-state (server-backed, per-user, cross-device).
// ============================================================
export type ConvKind = "match" | "group";
export type ConversationReadMap = Record<string, number>; // `${kind}:${id}` → ms epoch

function readsKeyFor(uid: string | null) { return JSON.stringify(["conversation-reads", uid]); }

async function fetchConversationReads(uid: string | null): Promise<ConversationReadMap> {
  if (!uid) return {};
  const rows = await getConversationReads();
  const map: ConversationReadMap = {};
  for (const row of rows) {
    map[`${row.kind}:${row.conv_id}`] = new Date(row.last_read_at).getTime();
  }
  return map;
}

export function useConversationReads(): { reads: ConversationReadMap; loading: boolean; error: string | null } {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  const q = useQuery<ConversationReadMap>(["conversation-reads", uid], () => fetchConversationReads(uid), {});
  return { reads: q.data, loading: q.loading, error: q.error };
}

export async function markConversationReadRemote(kind: ConvKind, convId: string): Promise<void> {
  const uid = _session?.user.id;
  if (!uid) return;
  try {
    const res = await markConversationRead({ data: { kind, convId } });
    if (!res.ok) return;
  } catch {
    return;
  }
  const ck = readsKeyFor(uid);
  const cur = (getEntry(ck).data as ConversationReadMap | undefined) ?? {};
  setCache<ConversationReadMap>(ck, { ...cur, [`${kind}:${convId}`]: Date.now() });
}

// ============================================================
// Latest-message previews for the conversation list.
// ============================================================
export type LatestPreview = { text: string; created_at: string; from_user_id: string };

const PREVIEW_POLL_MS = 8000;

export function useLatestMatchPreviews(matchIds: string[]): { previews: Record<string, LatestPreview>; loading: boolean; error: string | null; refresh: () => void } {
  const key = JSON.stringify(["match-previews", matchIds.slice().sort()]);
  const [state, setState] = useState<{ map: Record<string, LatestPreview>; loading: boolean; error: string | null }>(
    { map: {}, loading: matchIds.length > 0, error: null }
  );

  const refresh = useCallback(async () => {
    if (!matchIds.length) { setState({ map: {}, loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    let rows: { match_id: string; from_user_id: string; text: string; created_at: string }[];
    try {
      rows = await latestMatchPreviews();
    } catch {
      setState((s) => ({ map: s.map, loading: false, error: "couldn't load previews" }));
      return;
    }
    const filter = new Set(matchIds);
    const map: Record<string, LatestPreview> = {};
    for (const row of rows) {
      if (!filter.has(row.match_id)) continue;
      map[row.match_id] = { text: row.text, created_at: row.created_at, from_user_id: row.from_user_id };
    }
    setState({ map, loading: false, error: null });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while the list is open (replaces the realtime channel).
  useEffect(() => {
    if (!matchIds.length) return;
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, PREVIEW_POLL_MS);
    return () => clearInterval(iv);
  }, [key, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  return { previews: state.map, loading: state.loading, error: state.error, refresh };
}

// ============================================================
// Polls
// ============================================================
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

export function usePolls(): Query<PollWithStats[]> {
  const { session } = useSession();
  const uid = session?.user.id ?? null;
  return useQuery<PollWithStats[]>(
    ["polls", uid],
    async () => {
      if (!uid) return [];
      const payload = await getPollsFeed();
      const rows = payload.polls ?? [];
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
  already?: boolean;
  ownVote?: string | null;
  error?: string;
  code?: "already_voted" | "not_authenticated" | "invalid_option" | "poll_not_found" | "network" | "unknown";
};

export async function votePoll(pollId: string, handle: string): Promise<VotePollResult> {
  let r: Awaited<ReturnType<typeof castPollVote>>;
  try {
    r = await castPollVote({ data: { pollId, handle } });
  } catch {
    return { ok: false, code: "network", error: "couldn't record your vote — try again" };
  }
  if (!r.ok) {
    const code = (r.error ?? "unknown") as VotePollResult["code"];
    const msg =
      code === "already_voted" ? "you already voted on this one"
      : code === "not_authenticated" ? "sign in first"
      : code === "invalid_option" ? "that option isn't part of this poll"
      : code === "poll_not_found" ? "this poll is gone"
      : "couldn't record your vote — try again";
    return {
      ok: false,
      code,
      already: ("already" in r ? r.already : undefined) ?? code === "already_voted",
      ownVote: ("own_vote" in r ? r.own_vote : null) ?? null,
      error: msg,
    };
  }
  invalidate(`["polls",`);
  return { ok: true, ownVote: r.own_vote ?? null };
}

export async function createPoll(question: string, handles: string[]): Promise<{ error?: string; id?: string }> {
  const opts = Array.from(new Set(handles.map(norm).filter(Boolean)));
  let r: Awaited<ReturnType<typeof createPollFn>>;
  try {
    r = await createPollFn({ data: { question, handles: opts } });
  } catch {
    return { error: "couldn't launch poll — try again" };
  }
  if (!r.ok) {
    const code: string = r.error ?? "unknown";
    const msg =
      code === "not_authenticated" ? "sign in first"
      : code === "invalid_question" ? "question needs 5–120 characters"
      : code === "invalid_options" ? "pick 2–4 unique people"
      : code === "rate_limited" ? "you've launched 3 polls today — try again tomorrow"
      : "couldn't launch poll — try again";
    return { error: msg };
  }
  invalidate(`["polls",`);
  return { id: r.pollId };
}

// Network suggestions: handles the user already interacts with.
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
