// Crush realtime Worker.
//
// One Durable Object per room. Clients open a WebSocket with a one-time D1
// ticket; the DO validates and consumes it, then keeps the socket. The DO only
// ever broadcasts a tiny {type:"poke"} to everyone in the room — it carries no
// message content. The app, after writing a message or notification, calls
// /broadcast to fan a poke to the room, which nudges clients to refresh.
//
// This is why the transport is safe to add: it never becomes the source of
// truth. If the ticket, the socket, or the broadcast fails, the client's
// existing polling still delivers the data, just a few seconds later.
//
// Ticket validation uses D1 (bound here as CRUSH_DB), so there is no shared
// secret to configure. Broadcasts arrive from the app over a service binding.

interface Env {
  ROOM: DurableObjectNamespace;
  CRUSH_DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // WS connect: /ws?ticket=... — validate the ticket, then hand off to the DO
    // for the room the ticket names.
    if (url.pathname === "/ws") {
      const ticket = url.searchParams.get("ticket") ?? "";
      if (!ticket) return new Response("missing ticket", { status: 400 });

      const row = await env.CRUSH_DB.prepare(
        "SELECT room, expires_at FROM realtime_tickets WHERE ticket = ?",
      )
        .bind(ticket)
        .first<{ room: string; expires_at: string }>();

      // One-time: consume it regardless so a ticket can't be replayed.
      await env.CRUSH_DB.prepare("DELETE FROM realtime_tickets WHERE ticket = ?").bind(ticket).run();

      if (!row || row.expires_at < new Date().toISOString()) {
        return new Response("invalid or expired ticket", { status: 403 });
      }

      const id = env.ROOM.idFromName(row.room);
      return env.ROOM.get(id).fetch(new Request(`https://do/connect`, request));
    }

    // Broadcast a poke to a room. Called by the app over the service binding.
    if (url.pathname === "/broadcast") {
      const room = url.searchParams.get("room");
      if (!room) return new Response("missing room", { status: 400 });
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(new Request(`https://do/poke`, { method: "POST" }));
    }

    return new Response("crush realtime ok\n");
  },
};

/** One instance per room. Holds the room's live sockets and pokes them. */
export class Room implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      // Hibernatable: the runtime can evict us between events and rehydrate the
      // sockets, so we don't hold them in memory ourselves.
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/poke") {
      const sockets = this.state.getWebSockets();
      const payload = JSON.stringify({ type: "poke", t: Date.now() });
      for (const ws of sockets) {
        try {
          ws.send(payload);
        } catch {
          /* a dead socket will be cleaned up on its close event */
        }
      }
      return Response.json({ poked: sockets.length });
    }

    return new Response("not found", { status: 404 });
  }

  // Hibernation handlers. We don't expect client messages; respond to pings and
  // otherwise ignore. Closed/errored sockets are dropped by the runtime.
  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (msg === "ping") {
      try {
        ws.send("pong");
      } catch {
        /* ignore */
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
}
