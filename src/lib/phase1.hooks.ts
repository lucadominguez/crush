import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyNotifications,
  markNotificationsRead,
  getSchoolStats,
  touchStreak,
} from "./phase1.functions";

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

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel(`notifications:self:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as Notification | null;
          if (!row?.id) { refresh(); return; }
          if (seenIds.current.has(row.id)) return;
          seenIds.current.add(row.id);
          setItems((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

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
