// Realtime tickets.
//
// The realtime transport is an additive fast-path: a WebSocket to a Durable
// Object that only ever POKES the client to refresh. Polling remains the
// source of truth and the fallback, so if any of this fails the app still
// works, just at poll cadence.
//
// Auth is a short-lived D1 ticket rather than a shared HMAC secret, so no
// secret needs configuring: the app issues a ticket after an ownership check,
// and the realtime Worker (which also binds CRUSH_DB) validates and consumes
// it on connect. A ticket names exactly one room.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { assertMatchParticipant } from "./crush.functions";
import { assertGroupMember } from "./groups.functions";
import { getSecret, type D1Database } from "./bindings";
import { uuid } from "./rows";

const TICKET_TTL_MS = 60_000; // 1 minute: only needs to survive the connect

/** Public base URL of the realtime Worker; the client opens a WS here. */
function realtimeWsBase(): string {
  const explicit = getSecret("REALTIME_WS_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return "wss://crush-realtime.ludomi2502.workers.dev";
}

async function assertRoomAccess(db: D1Database, userId: string, room: string): Promise<boolean> {
  const [kind, id] = room.split(":");
  try {
    if (kind === "match") {
      await assertMatchParticipant(db, id, userId); // throws if not a participant
      return true;
    }
    if (kind === "group") {
      await assertGroupMember(db, id, userId);
      return true;
    }
    if (kind === "notif") {
      // A user may only subscribe to their own notification room.
      return id === userId;
    }
  } catch {
    return false;
  }
  return false;
}

export const getRealtimeTicket = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ room: z.string().trim().min(3).max(80).regex(/^(match|group|notif):[A-Za-z0-9-]+$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;

    if (!(await assertRoomAccess(db, userId, data.room))) {
      return { ok: false as const, error: "no access to that room" };
    }

    const ticket = uuid() + uuid().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
    await db
      .prepare("INSERT INTO realtime_tickets (ticket, user_id, room, expires_at) VALUES (?, ?, ?, ?)")
      .bind(ticket, userId, data.room, expiresAt)
      .run();

    // Opportunistic cleanup of expired tickets so the table stays tiny.
    await db.prepare("DELETE FROM realtime_tickets WHERE expires_at < ?").bind(new Date().toISOString()).run();

    return {
      ok: true as const,
      ticket,
      url: `${realtimeWsBase()}/ws?ticket=${encodeURIComponent(ticket)}`,
    };
  });
