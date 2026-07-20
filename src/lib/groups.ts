import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MatchProfile } from "./store";

export type Group = {
  id: string;
  name: string;
  emoji: string;
  created_by: string;
  created_at: string;
  last_message_at: string | null;
};

export type GroupMessage = {
  id: string;
  group_id: string;
  from_user_id: string;
  text: string;
  created_at: string;
  client_id?: string | null;
  _status?: "pending" | "failed";
  _clientId?: string;
};

/** Minimized identity fields for group member rendering — no PII beyond
 *  the columns already surfaced elsewhere in the app. */
export type GroupMember = Pick<
  MatchProfile,
  "user_id" | "name" | "handle" | "emoji" | "instagram_avatar" | "instagram_verified_at"
>;

// ============================================================
// Per-group message cache (server rows + local pending/failed rows).
// Kept module-level so send/retry/discard survive route re-renders and
// realtime updates the same store the UI reads from.
// ============================================================
type GroupBucket = { rows: GroupMessage[]; listeners: Set<() => void> };
const groupBuckets = new Map<string, GroupBucket>();
function bucket(id: string): GroupBucket {
  let b = groupBuckets.get(id);
  if (!b) { b = { rows: [], listeners: new Set() }; groupBuckets.set(id, b); }
  return b;
}
function setBucket(id: string, rows: GroupMessage[]) {
  const b = bucket(id);
  b.rows = rows;
  b.listeners.forEach((l) => l());
}
function mergeServer(id: string, server: GroupMessage[]) {
  const local = bucket(id).rows.filter((m) => m._status === "pending" || m._status === "failed");
  // Drop any local row whose clientId now exists as a real server row.
  const keptLocal = local.filter((p) => !server.some((s) => s.client_id && s.client_id === p._clientId));
  setBucket(id, [...server, ...keptLocal]);
}

/** Deterministic reconciliation: replace any row matching the server row's real
 *  id OR the exact client_id/_clientId with a single canonical server row.
 *  Safe against response-vs-realtime ordering, duplicate realtime events, and
 *  retry after unique-conflict recovery. */
function reconcileServerRow(rows: GroupMessage[], server: GroupMessage, clientId: string): GroupMessage[] {
  const stamped: GroupMessage = { ...server, _clientId: clientId };
  const filtered = rows.filter((m) => m.id !== server.id && m._clientId !== clientId);
  return [...filtered, stamped];
}


export function useMyGroups() {
  const [data, setData] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("group_chats")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (err) { setError("couldn't load groups"); setLoading(false); return; }
    setData((rows as Group[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("groups-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "group_chats" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useGroup(id: string) {
  const [data, setData] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    supabase.from("group_chats").select("*").eq("id", id).maybeSingle().then(({ data, error: err }) => {
      if (stop) return;
      if (err) setError("couldn't load group");
      setData((data as Group) ?? null);
    });
    return () => { stop = true; };
  }, [id]);
  return { data, error };
}

export function useGroupMembers(groupId: string) {
  const [data, setData] = useState<GroupMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    const { data: members, error: mErr } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);
    if (mErr) { setError("couldn't load members"); return; }
    const ids = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (!ids.length) { setData([]); return; }
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("user_id,name,handle,emoji,instagram_avatar,instagram_verified_at")
      .in("user_id", ids);
    if (pErr) { setError("couldn't load members"); return; }
    setData((profiles as GroupMember[]) ?? []);
  }, [groupId]);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, refresh, error };
}

export function useGroupMessages(groupId: string) {
  const [data, setData] = useState<GroupMessage[]>(bucket(groupId).rows.slice());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const { data: msgs, error: err } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });
    if (err) { setError("couldn't load messages"); setLoading(false); return; }
    mergeServer(groupId, (msgs as GroupMessage[]) ?? []);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    const b = bucket(groupId);
    const l = () => setData(b.rows.slice());
    b.listeners.add(l);
    refresh();
    const ch = supabase
      .channel(`group-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const next = payload.new as GroupMessage;
          const cur = bucket(groupId).rows;
          if (next.client_id) {
            setBucket(groupId, reconcileServerRow(cur, next, next.client_id));
          } else if (!cur.some((x) => x.id === next.id)) {
            setBucket(groupId, [...cur, next]);
          }
        }

      )
      .subscribe();
    return () => { b.listeners.delete(l); supabase.removeChannel(ch); };
  }, [groupId, refresh]);

  return { data, loading, error, refresh };
}

/** Latest per-group previews via SECURITY DEFINER RPC (one row per accessible group). */
export type GroupPreview = { text: string; created_at: string; from_user_id: string };
export function useLatestGroupPreviews(groupIds: string[]) {
  const [state, setState] = useState<{ map: Record<string, GroupPreview>; loading: boolean; error: string | null }>(
    { map: {}, loading: groupIds.length > 0, error: null }
  );
  const key = groupIds.slice().sort().join(",");
  const refresh = useCallback(async () => {
    if (!groupIds.length) { setState({ map: {}, loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.rpc("latest_group_previews");
    if (error) { setState((s) => ({ map: s.map, loading: false, error: "couldn't load previews" })); return; }
    const filter = new Set(groupIds);
    const map: Record<string, GroupPreview> = {};
    for (const row of ((data ?? []) as { group_id: string; from_user_id: string; text: string; created_at: string }[])) {
      if (!filter.has(row.group_id)) continue;
      map[row.group_id] = { text: row.text, created_at: row.created_at, from_user_id: row.from_user_id };
    }
    setState({ map, loading: false, error: null });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!groupIds.length) return;
    const ch = supabase
      .channel(`group-previews:${key.slice(0, 60)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, (payload) => {
        const m = payload.new as GroupMessage;
        if (!groupIds.includes(m.group_id)) return;
        setState((s) => ({ ...s, map: { ...s.map, [m.group_id]: { text: m.text, created_at: m.created_at, from_user_id: m.from_user_id } } }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { previews: state.map, loading: state.loading, error: state.error, refresh };
}

// ============================================================
// Atomic group creation via SECURITY DEFINER RPC.
// The RPC validates name, dedupes members, includes the creator, verifies
// each target profile exists, and creates the group + memberships in one txn.
// ============================================================
export async function createGroup(input: { name: string; emoji?: string; memberUserIds: string[] }): Promise<{ id?: string; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "give it a name" };
  if (name.length > 48) return { error: "name is too long" };
  if (!input.memberUserIds.length) return { error: "add at least one person" };
  const { data, error } = await supabase.rpc("create_group_atomic", {
    _name: name,
    _emoji: input.emoji ?? "✨",
    _member_ids: input.memberUserIds,
  });
  if (error) return { error: "couldn't create group — try again" };
  const payload = data as { ok?: boolean; id?: string; error?: string } | null;
  if (!payload?.ok || !payload.id) {
    const errMap: Record<string, string> = {
      not_authenticated: "sign in first",
      invalid_name: "give your group a name",
      no_members: "add at least one person",
      invalid_members: "one of those picks isn't on Crush yet",
    };
    return { error: errMap[payload?.error ?? ""] ?? "couldn't create group — try again" };
  }
  return { id: payload.id };
}

// ============================================================
// Group send / retry / discard — mirrors DM behavior with client_id idempotency.
// ============================================================
async function insertGroupMessageIdempotent(groupId: string, uid: string, text: string, clientId: string): Promise<{ row?: GroupMessage; error?: string }> {
  const { data: inserted, error } = await supabase
    .from("group_messages")
    .insert({ group_id: groupId, from_user_id: uid, text, client_id: clientId })
    .select("*")
    .single();
  if (!error && inserted) return { row: inserted as GroupMessage };
  if (error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
    const { data: existing } = await supabase
      .from("group_messages")
      .select("*")
      .eq("group_id", groupId)
      .eq("from_user_id", uid)
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) return { row: existing as GroupMessage };
  }
  return { error: error?.message ?? "insert_failed" };
}

export type SendGroupResult = { error?: string; clientId?: string };

export async function sendGroupMessage(groupId: string, text: string): Promise<SendGroupResult> {
  const t = text.trim();
  if (!t) return {};
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempId = `temp-${clientId}`;
  const prev = bucket(groupId).rows;
  if (prev.some((m) => m._clientId === clientId)) return { clientId };
  setBucket(groupId, [
    ...prev,
    { id: tempId, _clientId: clientId, _status: "pending", client_id: clientId, group_id: groupId, from_user_id: uid, text: t, created_at: new Date().toISOString() },
  ]);
  const res = await insertGroupMessageIdempotent(groupId, uid, t, clientId);
  const cur = bucket(groupId).rows;
  if (res.error || !res.row) {
    setBucket(groupId, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "couldn't send — tap to retry", clientId };
  }
  setBucket(groupId, reconcileServerRow(cur, res.row, clientId));

  return { clientId };
}

export async function retryFailedGroupMessage(groupId: string, clientId: string): Promise<{ error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const cur = bucket(groupId).rows;
  const target = cur.find((m) => m._clientId === clientId && m._status === "failed");
  if (!target) return {};
  setBucket(groupId, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "pending" } : m)));
  const res = await insertGroupMessageIdempotent(groupId, uid, target.text, clientId);
  const cur2 = bucket(groupId).rows;
  if (res.error || !res.row) {
    setBucket(groupId, cur2.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "still couldn't send — check your connection" };
  }
  setBucket(groupId, reconcileServerRow(cur2, res.row, clientId));

  return {};
}

export function discardFailedGroupMessage(groupId: string, clientId: string) {
  const cur = bucket(groupId).rows;
  setBucket(groupId, cur.filter((m) => m._clientId !== clientId));
}

export async function addGroupMembers(groupId: string, userIds: string[]): Promise<{ error?: string }> {
  if (!userIds.length) return {};
  const rows = userIds.map((user_id) => ({ group_id: groupId, user_id }));
  const { error } = await supabase.from("group_members").insert(rows);
  if (error) return { error: "couldn't add members — try again" };
  return {};
}

export async function leaveGroup(groupId: string): Promise<{ error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { error: "sign in first" };
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", uid);
  if (error) return { error: "couldn't leave — try again" };
  return {};
}
