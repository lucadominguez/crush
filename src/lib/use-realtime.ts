import { useEffect, useRef } from "react";

import { getRealtimeTicket } from "@/lib/realtime.functions";

/**
 * Additive realtime "poke" transport.
 *
 * Opens a WebSocket to the realtime Worker for `room` and calls `onPoke` when
 * the server nudges (i.e. something changed). It carries NO data: `onPoke`
 * should trigger the surface's existing refresh. Polling stays in place as the
 * fallback, so this only makes delivery faster, never load-bearing.
 *
 * Fails silent and self-heals: if the ticket, connect, or socket drops, it
 * reconnects with capped backoff, and the caller's polling covers the gap.
 * Disabled entirely when `room` is null.
 */
export function useRealtime(room: string | null, onPoke: () => void): void {
  const onPokeRef = useRef(onPoke);
  onPokeRef.current = onPoke;

  useEffect(() => {
    if (!room || typeof window === "undefined" || !("WebSocket" in window)) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = async () => {
      if (closed) return;
      try {
        const res = await getRealtimeTicket({ data: { room } });
        if (closed || !res.ok) {
          if (!closed) scheduleReconnect();
          return;
        }
        ws = new WebSocket(res.url);

        ws.onopen = () => {
          attempt = 0;
          // Keepalive so intermediaries don't reap an idle socket.
          pingTimer = setInterval(() => {
            try {
              ws?.readyState === WebSocket.OPEN && ws.send("ping");
            } catch {
              /* ignore */
            }
          }, 25_000);
        };

        ws.onmessage = (ev) => {
          if (ev.data === "pong") return;
          // Any real message means "something changed" — refresh.
          onPokeRef.current();
        };

        ws.onclose = () => {
          clearPing();
          if (!closed) scheduleReconnect();
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        if (!closed) scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      attempt += 1;
      // Capped exponential backoff with jitter; give up quietly after a while
      // since polling is already covering delivery.
      if (attempt > 6) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
      reconnectTimer = setTimeout(connect, delay);
    };

    const clearPing = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    // Reconnect promptly when the tab returns to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!ws || ws.readyState > WebSocket.OPEN)) {
        attempt = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearPing();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [room]);
}
