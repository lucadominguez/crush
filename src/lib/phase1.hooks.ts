import { useEffect, useState, useCallback, useRef } from "react";
import {
  listMyNotifications,
  markNotificationsRead,
  getSchoolStats,
  touchStreak,
} from "./phase1.functions";
import { useSession } from "./store";
import { useRealtime } from "./use-realtime";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type Notification = {
  id: string;
  type: string;
  payload: Json;
  read_at: string | null;
  created_at: string;
};

export function useMyNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const r = await listMyNotifications();
      if (!r.ok) { setError(true); return; }
      seenIds.current = new Set(r.notifications.map((n) => n.id));
      setItems(r.notifications);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const { session } = useSession();

  useEffect(() => {
    refresh();
    // Poll while mounted. Stays the fallback under the realtime poke below.
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh();
    }, 10000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Realtime fast-path for the notification bell / feed.
  useRealtime(session ? `notif:${session.user.id}` : null, refresh);

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return { ok: false as const };
    const r = await markNotificationsRead({ data: { ids } }).catch(() => ({ ok: false as const }));
    if (r.ok) {
      const at = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: at } : n))
      );
    }
    return r;
  }, []);

  const unread = items.filter((n) => !n.read_at);
  const unreadCrushCount = unread.filter((n) => n.type === "crush_received").length;

  return { items, unread, unreadCrushCount, loading, error, refresh, markRead };
}

export function useSchoolStats() {
  const [stats, setStats] = useState<{
    school: string | null;
    joinedThisWeek: number;
    crushesToday: number;
  } | null>(null);

  useEffect(() => {
    getSchoolStats().then(setStats).catch(() => {});
  }, []);

  return stats;
}

export function useStreak() {
  const [streak, setStreak] = useState<number | null>(null);
  useEffect(() => {
    touchStreak()
      .then((r) => setStreak(r.streak))
      .catch(() => {});
  }, []);
  return streak;
}
