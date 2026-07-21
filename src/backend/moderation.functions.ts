// Moderation review surface.
//
// Access is gated by a MODERATOR_USER_IDS secret (comma-separated user ids)
// rather than a role column: there is exactly one moderator today (the
// operator), and a secret keeps that out of the database and out of the
// bundle. Move to a roles table when there is a real moderation team.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { getSecret, type D1Database } from "./bindings";
import { uuid } from "./rows";

function moderatorIds(): Set<string> {
  return new Set(
    (getSecret("MODERATOR_USER_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

async function assertModerator(userId: string): Promise<void> {
  const ids = moderatorIds();
  // Fail closed: with no moderators configured, nobody gets in.
  if (!ids.has(userId)) throw new Error("Not authorized");
}

export const amIModerator = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => ({ moderator: moderatorIds().has(context.userId) }));

export type ReportRow = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  created_at: string;
  reported_handle: string | null;
  reported_name: string | null;
  suspended_at: string | null;
  report_count: number;
  last_action: string | null;
};

/** Open reports, most-reported users first. */
export const listReports = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ includeHandled: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertModerator(context.userId);

    const handledFilter = data.includeHandled
      ? ""
      : "WHERE NOT EXISTS (SELECT 1 FROM moderation_actions ma WHERE ma.report_id = r.id)";

    const { results } = await context.db
      .prepare(
        `SELECT r.id, r.reporter_id, r.reported_user_id, r.reason, r.created_at,
                p.handle AS reported_handle, p.name AS reported_name, p.suspended_at,
                (SELECT COUNT(*) FROM reports r2 WHERE r2.reported_user_id = r.reported_user_id) AS report_count,
                (SELECT ma2.action FROM moderation_actions ma2 WHERE ma2.report_id = r.id
                  ORDER BY ma2.created_at DESC LIMIT 1) AS last_action
           FROM reports r
           LEFT JOIN profiles p ON p.user_id = r.reported_user_id
           ${handledFilter}
          ORDER BY report_count DESC, r.created_at DESC
          LIMIT 200`,
      )
      .all<ReportRow>();

    return { reports: results };
  });

/** Recent messages from a reported user, so a decision has context behind it. */
export const getReportedUserContext = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertModerator(context.userId);
    const { results } = await context.db
      .prepare(
        `SELECT text, created_at FROM (
           SELECT text, created_at FROM messages WHERE from_user_id = ?
           UNION ALL
           SELECT text, created_at FROM group_messages WHERE from_user_id = ?
         ) ORDER BY created_at DESC LIMIT 25`,
      )
      .bind(data.userId, data.userId)
      .all<{ text: string; created_at: string }>();
    return { messages: results };
  });

const ActionSchema = z.object({
  reportId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  action: z.enum(["dismissed", "warned", "suspended", "unsuspended"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a decision, and apply it when it changes account state.
 * Every action is written to moderation_actions, including dismissals, so a
 * report is never silently dropped.
 */
export const actOnReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => ActionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    await assertModerator(userId);

    if (data.action === "suspended") {
      await setSuspended(db, data.targetUserId, true);
    } else if (data.action === "unsuspended") {
      await setSuspended(db, data.targetUserId, false);
    }

    await db
      .prepare(
        `INSERT INTO moderation_actions (id, report_id, target_user, action, note)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), data.reportId, data.targetUserId, data.action, data.note ?? null)
      .run();

    return { ok: true as const };
  });

async function setSuspended(db: D1Database, targetUserId: string, on: boolean): Promise<void> {
  await db
    .prepare(
      on
        ? "UPDATE profiles SET suspended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?"
        : "UPDATE profiles SET suspended_at = NULL WHERE user_id = ?",
    )
    .bind(targetUserId)
    .run();

  // A suspended account should not keep a live session.
  if (on) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
}
