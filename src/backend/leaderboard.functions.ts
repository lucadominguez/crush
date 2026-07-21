// Standings.
//
// HARD RULE (CLAUDE.md): rankings use positive activity ONLY. Admirer counts
// are never ranked and never exposed here. Ranking people by how many admirers
// they have is God Mode's paid product and, more importantly, turns the app
// into a popularity board with an obvious bottom, which is the shaming risk
// this product cannot take.
//
// Score inputs: poll wins (people voted FOR you), streak, and friends invited.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import type { D1Database } from "./bindings";

const POLL_WIN_POINTS = 10;
const REFERRAL_POINTS = 15;
const STREAK_POINTS = 3;

export type StandingRow = {
  user_id: string;
  name: string | null;
  handle: string | null;
  emoji: string | null;
  avatar: string | null;
  school: string | null;
  poll_wins: number;
  referrals: number;
  streak: number;
  score: number;
  rank: number;
};

const WINDOW_DAYS = 30;

/**
 * Individual standings, optionally scoped to the caller's school.
 *
 * Polls are open to everyone (no school gating, per the standing decision), so
 * school here is a lens on the same board rather than a lock.
 */
export const getIndividualStandings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ scope: z.enum(["school", "everyone"]).default("everyone"), limit: z.number().int().min(5).max(100).default(25) })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const me = await db
      .prepare("SELECT school FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ school: string | null }>();
    const school = me?.school ?? null;
    const scoped = data.scope === "school" && !!school;

    const rows = await scoreQuery(db, { since, school: scoped ? school : null, limit: data.limit });

    const ranked: StandingRow[] = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    const meRow = ranked.find((r) => r.user_id === userId) ?? null;

    return {
      scope: scoped ? ("school" as const) : ("everyone" as const),
      school,
      standings: ranked,
      me: meRow,
    };
  });

async function scoreQuery(
  db: D1Database,
  opts: { since: string; school: string | null; limit: number },
): Promise<Omit<StandingRow, "rank">[]> {
  // Poll wins are counted from votes cast FOR a handle, matched against either
  // the crush handle or the linked Instagram handle.
  const sql = `
    WITH wins AS (
      SELECT p.user_id, COUNT(*) AS n
        FROM poll_votes v
        JOIN profiles p
          ON v.voted_handle = p.handle OR v.voted_handle = p.instagram_handle
       WHERE v.created_at >= ?
       GROUP BY p.user_id
    ),
    refs AS (
      SELECT referrer_id AS user_id, COUNT(*) AS n
        FROM referrals
       WHERE created_at >= ?
       GROUP BY referrer_id
    )
    SELECT p.user_id, p.name, p.handle, p.emoji,
           COALESCE(p.avatar_url, p.instagram_avatar) AS avatar, p.school,
           COALESCE(w.n, 0) AS poll_wins,
           COALESCE(r.n, 0) AS referrals,
           COALESCE(p.streak_count, 0) AS streak,
           (COALESCE(w.n,0) * ${POLL_WIN_POINTS}
            + COALESCE(r.n,0) * ${REFERRAL_POINTS}
            + COALESCE(p.streak_count,0) * ${STREAK_POINTS}) AS score
      FROM profiles p
      LEFT JOIN wins w ON w.user_id = p.user_id
      LEFT JOIN refs r ON r.user_id = p.user_id
     WHERE p.suspended_at IS NULL
       ${opts.school ? "AND p.school = ?" : ""}
       AND (COALESCE(w.n,0) + COALESCE(r.n,0) + COALESCE(p.streak_count,0)) > 0
     ORDER BY score DESC, p.handle ASC
     LIMIT ?`;

  const binds: (string | number)[] = [opts.since, opts.since];
  if (opts.school) binds.push(opts.school);
  binds.push(opts.limit);

  const { results } = await db.prepare(sql).bind(...binds).all<Omit<StandingRow, "rank">>();
  return results;
}

export type SchoolStanding = {
  school: string;
  members: number;
  score: number;
  rank: number;
};

/**
 * School standings. Averaged per member, not summed, so a big school does not
 * win purely by being big.
 */
export const getSchoolStandings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ limit: z.number().int().min(5).max(50).default(20) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const { results } = await context.db
      .prepare(
        `WITH wins AS (
           SELECT p.user_id, COUNT(*) AS n
             FROM poll_votes v
             JOIN profiles p ON v.voted_handle = p.handle OR v.voted_handle = p.instagram_handle
            WHERE v.created_at >= ?
            GROUP BY p.user_id
         ),
         refs AS (
           SELECT referrer_id AS user_id, COUNT(*) AS n
             FROM referrals WHERE created_at >= ? GROUP BY referrer_id
         )
         SELECT p.school AS school,
                COUNT(*) AS members,
                CAST(ROUND(AVG(
                  COALESCE(w.n,0) * ${POLL_WIN_POINTS}
                  + COALESCE(r.n,0) * ${REFERRAL_POINTS}
                  + COALESCE(p.streak_count,0) * ${STREAK_POINTS}
                )) AS INTEGER) AS score
           FROM profiles p
           LEFT JOIN wins w ON w.user_id = p.user_id
           LEFT JOIN refs r ON r.user_id = p.user_id
          WHERE p.school IS NOT NULL AND TRIM(p.school) <> '' AND p.suspended_at IS NULL
          GROUP BY p.school
         HAVING members >= 3
          ORDER BY score DESC, members DESC
          LIMIT ?`,
      )
      .bind(since, since, data.limit)
      .all<Omit<SchoolStanding, "rank">>();

    return { schools: results.map((s, i) => ({ ...s, rank: i + 1 })) };
  });
