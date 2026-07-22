// Groups domain — D1 port of the group side of src/lib/groups.ts plus the
// create_group_atomic / latest_group_previews / latest_match_previews RPCs and
// the group-message triggers (touch_group_on_message, notify_on_group_message).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { insertNotification } from "./crush.functions";
import type { GroupChatRow, GroupMessageRow } from "./rows";
import { nowIso, uuid } from "./rows";
import { pokeRoom, type D1Database } from "./bindings";
import { BLOCKED_MESSAGE, containsBlocked, isSuspended } from "./moderation";

export async function assertGroupMember(db: D1Database, groupId: string, userId: string): Promise<void> {
  const row = await db
    .prepare("SELECT group_id FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .first();
  if (!row) throw new Error("not a member of this group");
}

export const listMyGroups = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<(GroupChatRow & { member_count: number })[]> => {
    const { results } = await context.db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
         FROM group_chats g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
         ORDER BY COALESCE(g.last_message_at, g.created_at) DESC`,
      )
      .bind(context.userId)
      .all<GroupChatRow & { member_count: number }>();
    return results;
  });

export const getGroup = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ groupId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertGroupMember(context.db, data.groupId, context.userId);
    const group = await context.db
      .prepare("SELECT * FROM group_chats WHERE id = ?")
      .bind(data.groupId)
      .first<GroupChatRow>();
    const { results: members } = await context.db
      .prepare(
        `SELECT p.user_id, p.name, p.handle, p.emoji, COALESCE(p.avatar_url, p.instagram_avatar) AS avatar
         FROM group_members gm JOIN profiles p ON p.user_id = gm.user_id
         WHERE gm.group_id = ?`,
      )
      .bind(data.groupId)
      .all<{ user_id: string; name: string; handle: string; emoji: string; avatar: string | null }>();
    return { group, members };
  });

// Port of create_group_atomic RPC.
export const createGroupFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string(),
        emoji: z.string().max(8).optional(),
        memberIds: z.array(z.string().uuid()).max(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const name = data.name.trim();
    if (!name || name.length > 48) return { ok: false as const, error: "invalid_name" };
    const emoji = (data.emoji ?? "").trim() || "✨";

    const ids = [...new Set(data.memberIds.filter((u) => u && u !== userId))];
    if (!ids.length) return { ok: false as const, error: "no_members" };

    const ph = ids.map(() => "?").join(",");
    const validRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM profiles WHERE user_id IN (${ph})`)
      .bind(...ids)
      .first<{ n: number }>();
    if ((validRow?.n ?? 0) !== ids.length) return { ok: false as const, error: "invalid_members" };

    const id = uuid();
    const memberStmts = [...ids, userId].map((u) =>
      db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)").bind(id, u),
    );
    await db.batch([
      db
        .prepare("INSERT INTO group_chats (id, name, emoji, created_by) VALUES (?, ?, ?, ?)")
        .bind(id, name, emoji, userId),
      ...memberStmts,
    ]);
    return { ok: true as const, id };
  });

export const addGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ groupId: z.string().uuid(), memberIds: z.array(z.string().uuid()).min(1).max(30) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertGroupMember(context.db, data.groupId, context.userId);
    const stmts = data.memberIds.map((u) =>
      context.db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)").bind(data.groupId, u),
    );
    await context.db.batch(stmts);
    return { ok: true as const };
  });

export const leaveGroup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ groupId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(data.groupId, context.userId)
      .run();
    return { ok: true as const };
  });

export const listGroupMessages = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ groupId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<GroupMessageRow[]> => {
    await assertGroupMember(context.db, data.groupId, context.userId);
    const { results } = await context.db
      .prepare("SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at ASC, id ASC")
      .bind(data.groupId)
      .all<GroupMessageRow>();
    return results;
  });

export const sendGroupMessageFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        groupId: z.string().uuid(),
        text: z.string().trim().min(1).max(2000),
        clientId: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; message: GroupMessageRow } | { ok: false; error: string }> => {
    const { db, userId } = context;
    await assertGroupMember(db, data.groupId, userId);

    if (await isSuspended(db, userId)) {
      return { ok: false, error: "your account is suspended and can't send messages right now." };
    }
    if (containsBlocked(data.text)) {
      return { ok: false, error: BLOCKED_MESSAGE };
    }

    if (data.clientId) {
      const existing = await db
        .prepare("SELECT * FROM group_messages WHERE group_id = ? AND from_user_id = ? AND client_id = ?")
        .bind(data.groupId, userId, data.clientId)
        .first<GroupMessageRow>();
      if (existing) return { ok: true, message: existing };
    }

    const message: GroupMessageRow = {
      id: uuid(),
      group_id: data.groupId,
      from_user_id: userId,
      text: data.text,
      client_id: data.clientId ?? null,
      created_at: nowIso(),
    };
    try {
      await db
        .prepare(
          "INSERT INTO group_messages (id, group_id, from_user_id, text, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(message.id, message.group_id, message.from_user_id, message.text, message.client_id, message.created_at)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") && data.clientId) {
        const existing = await db
          .prepare("SELECT * FROM group_messages WHERE group_id = ? AND from_user_id = ? AND client_id = ?")
          .bind(data.groupId, userId, data.clientId)
          .first<GroupMessageRow>();
        if (existing) return { ok: true, message: existing };
      }
      return { ok: false, error: "couldn't send" };
    }

    // touch_group_on_message
    await db
      .prepare("UPDATE group_chats SET last_message_at = ? WHERE id = ?")
      .bind(message.created_at, data.groupId)
      .run();

    // notify_on_group_message: all other members, IDs only
    const { results: others } = await db
      .prepare("SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ?")
      .bind(data.groupId, userId)
      .all<{ user_id: string }>();
    for (const o of others) {
      await insertNotification(db, o.user_id, "group_message_received", { group_id: data.groupId });
    }

    // Realtime fast-path: nudge everyone in the group chat to refresh now.
    await pokeRoom(`group:${data.groupId}`);

    return { ok: true, message };
  });

// Port of latest_match_previews / latest_group_previews RPCs.
export const latestMatchPreviews = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { results } = await context.db
      .prepare(
        `SELECT m.match_id, m.from_user_id, m.text, m.created_at
         FROM messages m
         JOIN matches mt ON mt.id = m.match_id
         WHERE (mt.user_a_id = ? OR mt.user_b_id = ?)
           AND m.created_at = (SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.match_id = m.match_id)
         GROUP BY m.match_id`,
      )
      .bind(context.userId, context.userId)
      .all<{ match_id: string; from_user_id: string; text: string; created_at: string }>();
    return results;
  });

export const latestGroupPreviews = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { results } = await context.db
      .prepare(
        `SELECT gm.group_id, gm.from_user_id, gm.text, gm.created_at
         FROM group_messages gm
         JOIN group_members me ON me.group_id = gm.group_id AND me.user_id = ?
         WHERE gm.created_at = (SELECT MAX(g2.created_at) FROM group_messages g2 WHERE g2.group_id = gm.group_id)
         GROUP BY gm.group_id`,
      )
      .bind(context.userId)
      .all<{ group_id: string; from_user_id: string; text: string; created_at: string }>();
    return results;
  });

// Read cursors for the messages screen (client used direct table reads).
export const getConversationReads = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { results } = await context.db
      .prepare("SELECT kind, conv_id, last_read_at FROM conversation_reads WHERE user_id = ?")
      .bind(context.userId)
      .all<{ kind: "match" | "group"; conv_id: string; last_read_at: string }>();
    return results;
  });
