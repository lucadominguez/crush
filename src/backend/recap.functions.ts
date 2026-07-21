// Weekly recap: a private, personal summary of the caller's last 7 days.
//
// Unlike the anonymous "crush of the week" superlative, this is the user's own
// activity. It still obeys the product invariants: it reports how many people
// picked you (a count the owner is allowed to see about themselves — the escrow
// backfill already shows this), but never WHO, and it leans on positive
// activity (matches, poll wins, streak, invites).

import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "./auth-middleware";
import type { D1Database } from "./bindings";

const WEEK_MS = 7 * 86_400_000;

export type WeeklyRecap = {
  weekStart: string;
  picksMade: number;      // crushes you sent this week
  newMatches: number;     // mutuals that formed this week
  admirers: number;       // people who picked you this week (count only, never who)
  pollWins: number;       // times you were voted for this week
  streak: number;         // current daily streak
  invites: number;        // friends who joined via your code this week
  headline: string;       // one-line summary chosen from the above
};

async function scalar(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function computeWeeklyRecap(db: D1Database, userId: string): Promise<WeeklyRecap> {
  const since = new Date(Date.now() - WEEK_MS).toISOString();

  const me = await db
    .prepare("SELECT handle, instagram_handle, streak_count FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ handle: string | null; instagram_handle: string | null; streak_count: number | null }>();

  const handles = [me?.handle, me?.instagram_handle].filter((h): h is string => !!h);
  const hph = handles.length ? handles.map(() => "?").join(",") : "''";

  const [picksMade, newMatches, admirers, pollWins, invites] = await Promise.all([
    scalar(db, "SELECT COUNT(*) AS n FROM crushes WHERE owner_id = ? AND created_at >= ?", userId, since),
    scalar(
      db,
      "SELECT COUNT(*) AS n FROM matches WHERE (user_a_id = ? OR user_b_id = ?) AND created_at >= ?",
      userId, userId, since,
    ),
    // People who picked YOU: crushes whose target is one of my handles. Count
    // only — never the owners.
    handles.length
      ? scalar(db, `SELECT COUNT(*) AS n FROM crushes WHERE target_handle IN (${hph}) AND owner_id <> ? AND created_at >= ?`, ...handles, userId, since)
      : Promise.resolve(0),
    handles.length
      ? scalar(db, `SELECT COUNT(*) AS n FROM poll_votes WHERE voted_handle IN (${hph}) AND created_at >= ?`, ...handles, since)
      : Promise.resolve(0),
    scalar(db, "SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND created_at >= ?", userId, since),
  ]);

  const streak = me?.streak_count ?? 0;

  // Headline picks the most exciting true thing that happened.
  let headline: string;
  if (newMatches > 0) headline = `you matched with ${newMatches} ${newMatches === 1 ? "person" : "people"} this week 💌`;
  else if (admirers > 0) headline = `${admirers} ${admirers === 1 ? "person" : "people"} picked you this week 👀`;
  else if (pollWins > 0) headline = `you got ${pollWins} poll vote${pollWins === 1 ? "" : "s"} this week 🏆`;
  else if (invites > 0) headline = `${invites} friend${invites === 1 ? "" : "s"} joined because of you 🎉`;
  else if (picksMade > 0) headline = `you sent ${picksMade} pick${picksMade === 1 ? "" : "s"} this week`;
  else headline = "a quiet week. pick someone to get things moving.";

  return {
    weekStart: since,
    picksMade,
    newMatches,
    admirers,
    pollWins,
    streak,
    invites,
    headline,
  };
}

export const getWeeklyRecap = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<WeeklyRecap> => {
    return computeWeeklyRecap(context.db, context.userId);
  });
