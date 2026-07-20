// Polls domain — D1 port of the SECURITY DEFINER RPCs (get_polls_feed,
// cast_poll_vote, create_poll, get_my_incoming_poll_stats) plus
// polls.functions.ts (pending questions, share logging).
// option_handles is a JSON TEXT array in D1. Anonymity invariant: voter
// identities never leave the server — only counts and the caller's own vote.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { normHandle } from "./auth.functions";
import { insertNotification } from "./crush.functions";
import type { PollRow, PollVoteRow, ProfileRow } from "./rows";
import { nowIso, uuid } from "./rows";
import type { D1Database } from "./bindings";

type MyIdentity = {
  school_key: string;
  handle: string | null;
  instagram_handle: string | null;
};

async function getIdentity(db: D1Database, userId: string): Promise<MyIdentity> {
  const me = await db
    .prepare("SELECT school, handle, instagram_handle FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<Pick<ProfileRow, "school" | "handle" | "instagram_handle">>();
  return {
    school_key: (me?.school ?? "").trim().toLowerCase(),
    handle: me?.handle ?? null,
    instagram_handle: me?.instagram_handle ?? null,
  };
}

function parseOptions(poll: Pick<PollRow, "option_handles">): string[] {
  try {
    const arr = JSON.parse(poll.option_handles);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function isVisible(poll: PollRow, userId: string, me: MyIdentity, options: string[]): boolean {
  if (poll.created_by === userId) return true;
  if (me.handle && options.includes(me.handle)) return true;
  if (me.instagram_handle && options.includes(me.instagram_handle)) return true;
  return (poll.school ?? "").trim().toLowerCase() === me.school_key;
}

export type PollOptionInfo = { handle: string; name: string | null; avatar: string | null; verified: boolean };
export type PollFeedItem = {
  id: string;
  question: string;
  option_handles: string[];
  created_at: string;
  created_by: string | null;
  school: string | null;
  votes: Record<string, number>;
  my_vote: string | null;
  option_info: PollOptionInfo[];
};

export const getPollsFeed = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<{ polls: PollFeedItem[] }> => {
    const { db, userId } = context;
    const me = await getIdentity(db, userId);

    // Visibility filtering needs the parsed options; feed is small (50), so
    // fetch a recent window and filter in the fn (mirrors the RPC's LIMIT 50).
    const { results: recent } = await db
      .prepare("SELECT * FROM polls ORDER BY created_at DESC LIMIT 200")
      .all<PollRow>();
    const visible = recent
      .map((p) => ({ poll: p, options: parseOptions(p) }))
      .filter(({ poll, options }) => isVisible(poll, userId, me, options))
      .slice(0, 50);
    if (!visible.length) return { polls: [] };

    const pollIds = visible.map(({ poll }) => poll.id);
    const idPh = pollIds.map(() => "?").join(",");
    const { results: votes } = await db
      .prepare(`SELECT poll_id, voted_handle, user_id FROM poll_votes WHERE poll_id IN (${idPh})`)
      .bind(...pollIds)
      .all<Pick<PollVoteRow, "poll_id" | "voted_handle" | "user_id">>();

    const tallies = new Map<string, Record<string, number>>();
    const myVotes = new Map<string, string>();
    for (const v of votes) {
      const t = tallies.get(v.poll_id) ?? {};
      t[v.voted_handle] = (t[v.voted_handle] ?? 0) + 1;
      tallies.set(v.poll_id, t);
      if (v.user_id === userId) myVotes.set(v.poll_id, v.voted_handle);
    }

    const allHandles = [...new Set(visible.flatMap(({ options }) => options))];
    const infoByHandle = new Map<string, PollOptionInfo>();
    if (allHandles.length) {
      const hPh = allHandles.map(() => "?").join(",");
      const { results: profs } = await db
        .prepare(
          `SELECT handle, instagram_handle, name, avatar_url, instagram_avatar, instagram_verified_at FROM profiles WHERE handle IN (${hPh}) OR instagram_handle IN (${hPh})`,
        )
        .bind(...allHandles, ...allHandles)
        .all<Pick<ProfileRow, "handle" | "instagram_handle" | "name" | "avatar_url" | "instagram_avatar" | "instagram_verified_at">>();
      for (const h of allHandles) {
        const p = profs.find((pr) => pr.handle === h || pr.instagram_handle === h);
        infoByHandle.set(h, {
          handle: h,
          name: p?.name ?? null,
          avatar: p?.avatar_url ?? p?.instagram_avatar ?? null,
          verified: !!p?.instagram_verified_at,
        });
      }
    }

    return {
      polls: visible.map(({ poll, options }) => ({
        id: poll.id,
        question: poll.question,
        option_handles: options,
        created_at: poll.created_at,
        created_by: poll.created_by,
        school: poll.school,
        votes: tallies.get(poll.id) ?? {},
        my_vote: myVotes.get(poll.id) ?? null,
        option_info: options.map((h) => infoByHandle.get(h)!).filter(Boolean),
      })),
    };
  });

export const castPollVote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ pollId: z.string().uuid(), handle: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const h = normHandle(data.handle);
    if (!h) return { ok: false as const, error: "invalid_option" };

    const poll = await db.prepare("SELECT * FROM polls WHERE id = ?").bind(data.pollId).first<PollRow>();
    if (!poll) return { ok: false as const, error: "poll_not_found" };
    const options = parseOptions(poll);
    const me = await getIdentity(db, userId);
    if (!isVisible(poll, userId, me, options)) return { ok: false as const, error: "poll_not_found" };
    if (!options.includes(h)) return { ok: false as const, error: "invalid_option" };

    const existing = await db
      .prepare("SELECT voted_handle FROM poll_votes WHERE poll_id = ? AND user_id = ?")
      .bind(data.pollId, userId)
      .first<{ voted_handle: string }>();
    if (existing) {
      return { ok: false as const, error: "already_voted", already: true, own_vote: existing.voted_handle };
    }

    try {
      await db
        .prepare("INSERT INTO poll_votes (id, poll_id, user_id, voted_handle) VALUES (?, ?, ?, ?)")
        .bind(uuid(), data.pollId, userId, h)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) {
        const own = await db
          .prepare("SELECT voted_handle FROM poll_votes WHERE poll_id = ? AND user_id = ?")
          .bind(data.pollId, userId)
          .first<{ voted_handle: string }>();
        return { ok: false as const, error: "already_voted", already: true, own_vote: own?.voted_handle ?? null };
      }
      throw e;
    }

    // notify_on_poll_vote: tell the voted person (counts only, no voter id)
    const target = await db
      .prepare("SELECT user_id FROM profiles WHERE handle = ? OR instagram_handle = ? LIMIT 1")
      .bind(h, h)
      .first<{ user_id: string }>();
    if (target && target.user_id !== userId) {
      await insertNotification(db, target.user_id, "poll_voted_for", { poll_id: data.pollId });
    }

    return { ok: true as const, own_vote: h };
  });

export const createPollFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ question: z.string(), handles: z.array(z.string()).max(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const q = data.question.trim();
    if (q.length < 5 || q.length > 120) return { ok: false as const, error: "invalid_question" };

    const opts = [...new Set(data.handles.map(normHandle).filter(Boolean))];
    if (opts.length < 2 || opts.length > 4) return { ok: false as const, error: "invalid_options" };

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const countRow = await db
      .prepare("SELECT COUNT(*) AS n FROM polls WHERE created_by = ? AND created_at > ?")
      .bind(userId, since)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= 3) return { ok: false as const, error: "rate_limited" };

    const me = await db
      .prepare("SELECT school FROM profiles WHERE user_id = ?")
      .bind(userId)
      .first<{ school: string | null }>();

    const id = uuid();
    await db
      .prepare("INSERT INTO polls (id, question, option_handles, created_by, school) VALUES (?, ?, ?, ?, ?)")
      .bind(id, q, JSON.stringify(opts), userId, me?.school ?? null)
      .run();
    return { ok: true as const, pollId: id };
  });

export type IncomingPollResult = {
  pollId: string;
  question: string;
  votes: number;
  totalVotes: number;
  createdAt: string;
};

export const getMyIncomingPollStats = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; error?: string; results: IncomingPollResult[] }> => {
    const { db, userId } = context;
    const me = await getIdentity(db, userId);
    const myIds = [me.handle, me.instagram_handle].filter((x): x is string => !!x && !!x.trim());
    if (!myIds.length) return { ok: true, results: [] };

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { results: recent } = await db
      .prepare("SELECT * FROM polls WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200")
      .bind(weekAgo)
      .all<PollRow>();
    const mine = recent
      .map((p) => ({ poll: p, options: parseOptions(p) }))
      .filter(({ options }) => myIds.some((h) => options.includes(h)))
      .slice(0, 20);
    if (!mine.length) return { ok: true, results: [] };

    const ids = mine.map(({ poll }) => poll.id);
    const ph = ids.map(() => "?").join(",");
    const { results: votes } = await db
      .prepare(`SELECT poll_id, voted_handle FROM poll_votes WHERE poll_id IN (${ph})`)
      .bind(...ids)
      .all<Pick<PollVoteRow, "poll_id" | "voted_handle">>();

    return {
      ok: true,
      results: mine.map(({ poll }) => {
        const pollVotes = votes.filter((v) => v.poll_id === poll.id);
        return {
          pollId: poll.id,
          question: poll.question,
          votes: pollVotes.filter((v) => myIds.includes(v.voted_handle)).length,
          totalVotes: pollVotes.length,
          createdAt: poll.created_at,
        };
      }),
    };
  });

const QuestionSchema = z.object({ text: z.string().trim().min(5).max(120) });

export const submitPendingQuestion = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => QuestionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const countRow = await context.db
      .prepare("SELECT COUNT(*) AS n FROM pending_questions WHERE user_id = ? AND created_at >= ?")
      .bind(context.userId, since)
      .first<{ n: number }>();
    if ((countRow?.n ?? 0) >= 3) return { ok: false as const, error: "Limit 3 suggestions per day" };
    await context.db
      .prepare("INSERT INTO pending_questions (id, user_id, text) VALUES (?, ?, ?)")
      .bind(uuid(), context.userId, data.text)
      .run();
    return { ok: true as const };
  });

export const logPollShare = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => z.object({ pollId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.db
      .prepare("INSERT INTO poll_share_events (id, user_id, poll_id) VALUES (?, ?, ?)")
      .bind(uuid(), context.userId, data.pollId)
      .run();
    return { ok: true };
  });
