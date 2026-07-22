// Groups client store — Cloudflare D1 backend via server fns.
// The per-group bucket cache, optimistic send/retry/discard, and client_id
// reconcile logic are preserved from the Supabase era; realtime channels are
// replaced by short-interval polling (DO websocket upgrade planned).

import { useCallback, useEffect, useState } from "react";

import {
  addGroupMembers as addGroupMembersFn,
  createGroupFn,
  getGroup as getGroupFn,
  latestGroupPreviews,
  leaveGroup as leaveGroupFn,
  listGroupMessages,
  listMyGroups,
  sendGroupMessageFn,
} from "@/backend/groups.functions";
import { getSessionUserId, type MatchProfile } from "./store";
import { useRealtime } from "./use-realtime";

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

export type GroupMember = Pick<
  MatchProfile,
  "user_id" | "name" | "handle" | "emoji" | "instagram_avatar" | "instagram_verified_at"
>;

const GROUP_POLL_MS = 4000;
const GROUP_LIST_POLL_MS = 10000;

// ============================================================
// Per-group message cache (server rows + local pending/failed rows).
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
  const keptLocal = local.filter((p) => !server.some((s) => s.client_id && s.client_id === p._clientId));
  setBucket(id, [...server, ...keptLocal]);
}

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
    try {
      const rows = await listMyGroups();
      setData(rows as Group[]);
    } catch {
      setError("couldn't load groups");
      setLoading(false);
      return;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, GROUP_LIST_POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useGroup(id: string) {
  const [data, setData] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    getGroupFn({ data: { groupId: id } })
      .then((res) => {
        if (stop) return;
        setData((res.group as Group) ?? null);
      })
      .catch(() => { if (!stop) setError("couldn't load group"); });
    return () => { stop = true; };
  }, [id]);
  return { data, error };
}

export function useGroupMembers(groupId: string) {
  const [data, setData] = useState<GroupMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await getGroupFn({ data: { groupId } });
      setData(
        res.members.map((m) => ({
          user_id: m.user_id,
          name: m.name,
          handle: m.handle,
          emoji: m.emoji,
          instagram_avatar: m.avatar,
          instagram_verified_at: null,
        })),
      );
    } catch {
      setError("couldn't load members");
    }
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
    try {
      const msgs = await listGroupMessages({ data: { groupId } });
      mergeServer(groupId, msgs as GroupMessage[]);
    } catch {
      setError("couldn't load messages");
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    const b = bucket(groupId);
    const l = () => setData(b.rows.slice());
    b.listeners.add(l);
    refresh();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, GROUP_POLL_MS);
    return () => { b.listeners.delete(l); clearInterval(iv); };
  }, [groupId, refresh]);

  // Realtime fast-path; polling above remains the fallback.
  useRealtime(groupId ? `group:${groupId}` : null, refresh);

  return { data, loading, error, refresh };
}

export type GroupPreview = { text: string; created_at: string; from_user_id: string };
export function useLatestGroupPreviews(groupIds: string[]) {
  const [state, setState] = useState<{ map: Record<string, GroupPreview>; loading: boolean; error: string | null }>(
    { map: {}, loading: groupIds.length > 0, error: null }
  );
  const key = groupIds.slice().sort().join(",");
  const refresh = useCallback(async () => {
    if (!groupIds.length) { setState({ map: {}, loading: false, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    let rows: { group_id: string; from_user_id: string; text: string; created_at: string }[];
    try {
      rows = await latestGroupPreviews();
    } catch {
      setState((s) => ({ map: s.map, loading: false, error: "couldn't load previews" }));
      return;
    }
    const filter = new Set(groupIds);
    const map: Record<string, GroupPreview> = {};
    for (const row of rows) {
      if (!filter.has(row.group_id)) continue;
      map[row.group_id] = { text: row.text, created_at: row.created_at, from_user_id: row.from_user_id };
    }
    setState({ map, loading: false, error: null });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!groupIds.length) return;
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, 8000);
    return () => clearInterval(iv);
  }, [key, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return { previews: state.map, loading: state.loading, error: state.error, refresh };
}

// ============================================================
// Atomic group creation (server fn validates + creates in one batch).
// ============================================================
export async function createGroup(input: { name: string; emoji?: string; memberUserIds: string[] }): Promise<{ id?: string; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "give it a name" };
  if (name.length > 48) return { error: "name is too long" };
  if (!input.memberUserIds.length) return { error: "add at least one person" };
  let payload: Awaited<ReturnType<typeof createGroupFn>>;
  try {
    payload = await createGroupFn({ data: { name, emoji: input.emoji ?? "✨", memberIds: input.memberUserIds } });
  } catch {
    return { error: "couldn't create group. try again" };
  }
  if (!payload.ok) {
    const errMap: Record<string, string> = {
      not_authenticated: "sign in first",
      invalid_name: "give your group a name",
      no_members: "add at least one person",
      invalid_members: "one of those picks isn't on Crush yet",
    };
    return { error: errMap[payload.error ?? ""] ?? "couldn't create group. try again" };
  }
  return { id: payload.id };
}

// ============================================================
// Group send / retry / discard — mirrors DM behavior with client_id idempotency.
// ============================================================
async function insertGroupMessageIdempotent(groupId: string, text: string, clientId: string): Promise<{ row?: GroupMessage; error?: string }> {
  try {
    const res = await sendGroupMessageFn({ data: { groupId, text, clientId } });
    if (res.ok) return { row: res.message as GroupMessage };
    return { error: res.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "insert_failed" };
  }
}

export type SendGroupResult = { error?: string; clientId?: string };

export async function sendGroupMessage(groupId: string, text: string): Promise<SendGroupResult> {
  const t = text.trim();
  if (!t) return {};
  const uid = getSessionUserId();
  if (!uid) return { error: "sign in first" };
  const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tempId = `temp-${clientId}`;
  const prev = bucket(groupId).rows;
  if (prev.some((m) => m._clientId === clientId)) return { clientId };
  setBucket(groupId, [
    ...prev,
    { id: tempId, _clientId: clientId, _status: "pending", client_id: clientId, group_id: groupId, from_user_id: uid, text: t, created_at: new Date().toISOString() },
  ]);
  const res = await insertGroupMessageIdempotent(groupId, t, clientId);
  const cur = bucket(groupId).rows;
  if (res.error || !res.row) {
    setBucket(groupId, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "couldn't send. tap to retry", clientId };
  }
  setBucket(groupId, reconcileServerRow(cur, res.row, clientId));
  return { clientId };
}

export async function retryFailedGroupMessage(groupId: string, clientId: string): Promise<{ error?: string }> {
  const uid = getSessionUserId();
  if (!uid) return { error: "sign in first" };
  const cur = bucket(groupId).rows;
  const target = cur.find((m) => m._clientId === clientId && m._status === "failed");
  if (!target) return {};
  setBucket(groupId, cur.map((m) => (m._clientId === clientId ? { ...m, _status: "pending" } : m)));
  const res = await insertGroupMessageIdempotent(groupId, target.text, clientId);
  const cur2 = bucket(groupId).rows;
  if (res.error || !res.row) {
    setBucket(groupId, cur2.map((m) => (m._clientId === clientId ? { ...m, _status: "failed" } : m)));
    return { error: "still couldn't send. check your connection" };
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
  try {
    await addGroupMembersFn({ data: { groupId, memberIds: userIds } });
  } catch {
    return { error: "couldn't add members. try again" };
  }
  return {};
}

export async function leaveGroup(groupId: string): Promise<{ error?: string }> {
  const uid = getSessionUserId();
  if (!uid) return { error: "sign in first" };
  try {
    await leaveGroupFn({ data: { groupId } });
  } catch {
    return { error: "couldn't leave. try again" };
  }
  return {};
}
