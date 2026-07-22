// Crush/match/messages/notifications domain — D1 port.
// Replaces the client-side supabase table access in src/lib/store.ts plus the
// PG triggers: check_match_on_crush, enforce_crush_slot_limit,
// notify_target_on_crush, set_match_expiry, notify_on_match_created,
// notify_on_message, touch_match_on_message. Authorization is explicit here
// (no RLS in D1): every query is scoped to context.userId.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { normHandle } from "./auth.functions";
import type { CrushRow, MatchRow, MessageRow, NotificationRow, ProfileRow } from "./rows";
import { nowIso, uuid } from "./rows";
import { pushCopyFor, sendPush } from "./push";
import { sendCrushNotice } from "./outreach";
import { BLOCKED_MESSAGE, containsBlocked, isSuspended } from "./moderation";
import { getSecret, pokeRoom, type D1Database } from "./bindings";

const MATCH_TTL_MS = 7 * 86_400_000;

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type MatchProfileLite = Pick<
  ProfileRow,
  "user_id" | "name" | "handle" | "emoji" | "instagram_avatar" | "instagram_handle" | "instagram_verified_at"
>;

export type MatchWithOther = Pick<
  MatchRow,
  "id" | "user_a_id" | "user_b_id" | "created_at" | "expires_at" | "last_message_at"
> & { other: MatchProfileLite | null };

async function findProfileByAnyHandle(db: D1Database, handle: string): Promise<ProfileRow | null> {
  return db
    .prepare("SELECT * FROM profiles WHERE handle = ? OR instagram_handle = ? LIMIT 1")
    .bind(handle, handle)
    .first<ProfileRow>();
}

export async function insertNotification(
  db: D1Database,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)")
    .bind(uuid(), userId, type, JSON.stringify(payload))
    .run();

  // Remote push rides the same fan-out as the in-app bell, so there is exactly
  // one place a notification can be raised. Only types with copy in
  // pushCopyFor() are pushed; the rest stay in-app. sendPush never throws, so a
  // push outage can never fail the action that triggered the notification.
  const msg = pushCopyFor(type, payload);
  if (msg) await sendPush(db, userId, msg);

  // Realtime fast-path: nudge the recipient's notification surfaces to refresh.
  // Best-effort; the bell/feed polling covers delivery otherwise.
  await pokeRoom(`notif:${userId}`);
}

/**
 * Escrow claim backfill.
 *
 * A crush can target a handle nobody has claimed yet (the whole point of the
 * escrow loop: you pick someone who isn't on Crush, and the pick waits). Those
 * picks produce no notification at insert time because there is no user to
 * notify. When that person later joins — or claims the Instagram handle that
 * was picked — this replays the waiting picks into `crush_received`
 * notifications so the "someone picked you" surface lights up on arrival.
 *
 * Idempotent: each backfilled notification carries its crush_id, and we skip
 * any crush that already has one. Never reveals who picked them.
 */
export async function backfillEscrowClaims(db: D1Database, userId: string): Promise<number> {
  const me = await db
    .prepare("SELECT handle, instagram_handle FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Pick<ProfileRow, "handle" | "instagram_handle">>();
  if (!me) return 0;

  const handles = [me.handle, me.instagram_handle].filter((h): h is string => !!h);
  if (!handles.length) return 0;
  const ph = handles.map(() => "?").join(",");

  const { results: waiting } = await db
    .prepare(`SELECT id FROM crushes WHERE target_handle IN (${ph}) AND owner_id <> ?`)
    .bind(...handles, userId)
    .all<{ id: string }>();
  if (!waiting.length) return 0;

  const { results: existing } = await db
    .prepare(
      "SELECT json_extract(payload,'$.crush_id') AS crush_id FROM notifications WHERE user_id = ? AND type = 'crush_received' AND json_extract(payload,'$.crush_id') IS NOT NULL",
    )
    .bind(userId)
    .all<{ crush_id: string | null }>();
  const already = new Set(existing.map((r) => r.crush_id).filter(Boolean));

  const fresh = waiting.filter((c) => !already.has(c.id));
  if (!fresh.length) return 0;

  await db.batch(
    fresh.map((c) =>
      db
        .prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'crush_received', ?)")
        .bind(uuid(), userId, JSON.stringify({ crush_id: c.id, backfill: 1 })),
    ),
  );
  return fresh.length;
}

/** Replays waiting picks for the caller (safe to call on app open). */
export const claimWaitingPicks = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const claimed = await backfillEscrowClaims(context.db, context.userId);
    return { ok: true as const, claimed };
  });

// --- Crushes ---------------------------------------------------------------

export const listMyCrushes = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<CrushRow[]> => {
    const { results } = await context.db
      .prepare("SELECT * FROM crushes WHERE owner_id = ? ORDER BY created_at DESC")
      .bind(context.userId)
      .all<CrushRow>();
    return results;
  });

export type AddCrushResult =
  | { ok: true; crush: CrushRow; matchId: string | null }
  | { ok: false; error: "self" | "duplicate" | "slot_limit" | "invalid" };

// Port of the crush-insert trigger chain, in one server fn:
//   1. normalize handle           (normalize_instagram_handle-style)
//   2. self-pick guard            (client-side before; enforced here now)
//   3. slot limit                 (enforce_crush_slot_limit)
//   4. duplicate                  (unique index, classified not thrown)
//   5. insert + mutual detection  (check_match_on_crush: target resolved by
//      handle OR instagram_handle, reciprocal crush matched on BOTH our
//      handles; match created once, expiry +7d, match_created notifs x2)
//   6. crush_received notification (notify_target_on_crush)
export const addCrushFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ targetHandle: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data, context }): Promise<AddCrushResult> => {
    const { db, userId } = context;
    const h = normHandle(data.targetHandle);
    if (!h) return { ok: false, error: "invalid" };

    const me = await db
      .prepare("SELECT handle, instagram_handle, crush_slots FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<Pick<ProfileRow, "handle" | "instagram_handle" | "crush_slots">>();
    if (!me) return { ok: false, error: "invalid" };

    const myHandle = normHandle(me.handle ?? "");
    const myIG = normHandle(me.instagram_handle ?? "");
    if ((myHandle && h === myHandle) || (myIG && h === myIG)) return { ok: false, error: "self" };

    const dupe = await db
      .prepare("SELECT id FROM crushes WHERE owner_id = ? AND target_handle = ?")
      .bind(userId, h)
      .first();
    if (dupe) return { ok: false, error: "duplicate" };

    const countRow = await db
      .prepare("SELECT COUNT(*) AS n FROM crushes WHERE owner_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= (me.crush_slots ?? 3)) return { ok: false, error: "slot_limit" };

    const crush: CrushRow = { id: uuid(), owner_id: userId, target_handle: h, created_at: nowIso() };
    try {
      await db
        .prepare("INSERT INTO crushes (id, owner_id, target_handle, created_at) VALUES (?, ?, ?, ?)")
        .bind(crush.id, crush.owner_id, crush.target_handle, crush.created_at)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return { ok: false, error: "duplicate" };
      throw e;
    }

    // Mutual detection (was BEFORE INSERT trigger; here right after — the
    // "no existing match" re-check keeps double-fire idempotent).
    let matchId: string | null = null;
    const target = await findProfileByAnyHandle(db, h);
    if (target && target.user_id !== userId) {
      // crush_received notification (never reveals who)
      await insertNotification(db, target.user_id, "crush_received", {});

      const myHandles = [myHandle, myIG].filter(Boolean);
      if (myHandles.length) {
        const placeholders = myHandles.map(() => "?").join(",");
        const reciprocal = await db
          .prepare(
            `SELECT id FROM crushes WHERE owner_id = ? AND target_handle IN (${placeholders})`,
          )
          .bind(target.user_id, ...myHandles)
          .first();
        if (reciprocal) {
          const existing = await db
            .prepare(
              "SELECT id FROM matches WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)",
            )
            .bind(userId, target.user_id, target.user_id, userId)
            .first<{ id: string }>();
          if (existing) {
            matchId = existing.id;
          } else {
            matchId = uuid();
            const expiresAt = new Date(Date.now() + MATCH_TTL_MS).toISOString();
            await db
              .prepare(
                "INSERT INTO matches (id, user_a_id, user_b_id, expires_at) VALUES (?, ?, ?, ?)",
              )
              .bind(matchId, userId, target.user_id, expiresAt)
              .run();
            await insertNotification(db, userId, "match_created", { match_id: matchId });
            await insertNotification(db, target.user_id, "match_created", { match_id: matchId });
          }
        }
      }
    }

    // Escrow outreach: the pick landed on a handle nobody has claimed, so
    // there is no in-app surface to light up. If the contact graph can resolve
    // that handle to a number, send ONE anonymous notice.
    //
    // Every guardrail (opt-out list, frequency cap counted across all senders,
    // suppression once they join, and the "never say who or how many" copy)
    // lives inside sendCrushNotice. Failures are swallowed: outreach must
    // never break adding a crush.
    if (!target) {
      try {
        const link = await db
          .prepare(
            "SELECT phone_hash FROM handle_phone_links WHERE handle = ? ORDER BY confidence DESC LIMIT 1",
          )
          .bind(h)
          .first<{ phone_hash: string }>();
        if (link) {
          const origin =
            getSecret("PUBLIC_APP_ORIGIN") || "https://crush-connect.ludomi2502.workers.dev";
          await sendCrushNotice(db, {
            senderId: userId,
            phoneHash: link.phone_hash,
            targetHandle: h,
            appOrigin: origin,
          });
        }
      } catch (err) {
        console.error("outreach: crush notice failed", err instanceof Error ? err.message : err);
      }
    }

    return { ok: true, crush, matchId };
  });

export const removeCrushFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("DELETE FROM crushes WHERE id = ? AND owner_id = ?")
      .bind(data.id, context.userId)
      .run();
    return { ok: true as const };
  });

// --- Matches ---------------------------------------------------------------

export const listMyMatches = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<MatchWithOther[]> => {
    const { db, userId } = context;
    const { results: matches } = await db
      .prepare(
        "SELECT id, user_a_id, user_b_id, created_at, expires_at, last_message_at FROM matches WHERE user_a_id = ? OR user_b_id = ? ORDER BY created_at DESC",
      )
      .bind(userId, userId)
      .all<MatchRow>();
    if (!matches.length) return [];

    const otherIds = matches.map((m) => (m.user_a_id === userId ? m.user_b_id : m.user_a_id));
    const placeholders = otherIds.map(() => "?").join(",");
    const { results: profiles } = await db
      .prepare(
        `SELECT user_id, name, handle, emoji, instagram_avatar, instagram_handle, instagram_verified_at FROM profiles WHERE user_id IN (${placeholders})`,
      )
      .bind(...otherIds)
      .all<MatchProfileLite>();
    const byId = new Map(profiles.map((p) => [p.user_id, p]));
    return matches.map((m) => ({
      id: m.id,
      user_a_id: m.user_a_id,
      user_b_id: m.user_b_id,
      created_at: m.created_at,
      expires_at: m.expires_at,
      last_message_at: m.last_message_at,
      other: byId.get(m.user_a_id === userId ? m.user_b_id : m.user_a_id) ?? null,
    }));
  });

export async function assertMatchParticipant(
  db: D1Database,
  matchId: string,
  userId: string,
): Promise<MatchRow> {
  const match = await db
    .prepare("SELECT * FROM matches WHERE id = ?")
    .bind(matchId)
    .first<MatchRow>();
  if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
    throw new Error("not a participant of this match");
  }
  return match;
}

// --- Messages --------------------------------------------------------------

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ matchId: z.string().uuid(), sinceId: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MessageRow[]> => {
    await assertMatchParticipant(context.db, data.matchId, context.userId);
    const { results } = await context.db
      .prepare("SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC, id ASC")
      .bind(data.matchId)
      .all<MessageRow>();
    return results;
  });

export type SendMessageResult = { ok: true; message: MessageRow } | { ok: false; error: string };

export const sendMessageFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        matchId: z.string().uuid(),
        text: z.string().trim().min(1).max(2000),
        clientId: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SendMessageResult> => {
    const { db, userId } = context;
    const match = await assertMatchParticipant(db, data.matchId, userId);

    if (await isSuspended(db, userId)) {
      return { ok: false, error: "your account is suspended and can't send messages right now." };
    }
    if (containsBlocked(data.text)) {
      return { ok: false, error: BLOCKED_MESSAGE };
    }

    // Idempotency: same (match, sender, clientId) returns the existing row.
    if (data.clientId) {
      const existing = await db
        .prepare("SELECT * FROM messages WHERE match_id = ? AND from_user_id = ? AND client_id = ?")
        .bind(data.matchId, userId, data.clientId)
        .first<MessageRow>();
      if (existing) return { ok: true, message: existing };
    }

    const message: MessageRow = {
      id: uuid(),
      match_id: data.matchId,
      from_user_id: userId,
      text: data.text,
      client_id: data.clientId ?? null,
      created_at: nowIso(),
    };
    try {
      await db
        .prepare(
          "INSERT INTO messages (id, match_id, from_user_id, text, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(message.id, message.match_id, message.from_user_id, message.text, message.client_id, message.created_at)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") && data.clientId) {
        const existing = await db
          .prepare("SELECT * FROM messages WHERE match_id = ? AND from_user_id = ? AND client_id = ?")
          .bind(data.matchId, userId, data.clientId)
          .first<MessageRow>();
        if (existing) return { ok: true, message: existing };
      }
      return { ok: false, error: "couldn't send" };
    }

    // touch_match_on_message: bump last_message_at, clear expiry once talking
    await db
      .prepare("UPDATE matches SET last_message_at = ?, expires_at = NULL, expiry_warned_at = NULL WHERE id = ?")
      .bind(message.created_at, data.matchId)
      .run();

    // notify_on_message: other participant, IDs only (never message text)
    const other = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    await insertNotification(db, other, "message_received", { match_id: data.matchId });

    // Realtime fast-path: nudge everyone watching this chat to refresh now.
    // Best-effort; polling delivers regardless.
    await pokeRoom(`match:${data.matchId}`);

    return { ok: true, message };
  });

// --- Notifications (port of phase1.functions.ts) ---------------------------

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { results } = await context.db
      .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
      .bind(context.userId)
      .all<NotificationRow>();
    return {
      ok: true as const,
      notifications: results.map((n) => ({ ...n, payload: JSON.parse(n.payload || "{}") as Json })),
    };
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(input))
  .handler(async ({ data, context }) => {
    const placeholders = data.ids.map(() => "?").join(",");
    await context.db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`)
      .bind(nowIso(), context.userId, ...data.ids)
      .run();
    return { ok: true as const };
  });

// --- Ambient social proof + streak (port of phase1.functions.ts) -----------

export const getSchoolStats = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, userId } = context;
    const me = await db
      .prepare("SELECT school FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ school: string | null }>();
    const school = me?.school ?? null;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    let joinedThisWeek = 0;
    if (school) {
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM profiles WHERE school = ? AND created_at >= ?")
        .bind(school, weekAgo)
        .first<{ n: number }>();
      joinedThisWeek = row?.n ?? 0;
    }
    const crushesRow = await db
      .prepare("SELECT COUNT(*) AS n FROM crushes WHERE created_at >= ?")
      .bind(dayAgo)
      .first<{ n: number }>();

    return { school, joinedThisWeek, crushesToday: crushesRow?.n ?? 0 };
  });

export const touchStreak = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, userId } = context;
    const prof = await db
      .prepare("SELECT streak_count, streak_last_open FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ streak_count: number; streak_last_open: string | null }>();

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const last = prof?.streak_last_open ?? null;
    let count = prof?.streak_count ?? 0;

    if (last === today) return { streak: count };
    count = last === yesterday ? count + 1 : 1;

    await db
      .prepare("UPDATE profiles SET streak_count = ?, streak_last_open = ? WHERE user_id = ?")
      .bind(count, today, userId)
      .run();
    return { streak: count };
  });
