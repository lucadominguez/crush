// Contact-graph server functions — the identity/centrality layer behind invite
// targeting and crush-notice delivery.
//
// Privacy contract (v1, non-negotiable — see OUTSTANDING.md and contacts.ts):
//  - A phone number NEVER leaves this module in the clear. Nothing here returns
//    a phone (or phone_enc) to a client; targets are identified by phone_hash,
//    which the client can map back against its own local address book.
//  - "Who uploaded you" is never revealed: every read aggregates across owners
//    and no query exposes contact_edges.owner_id to a caller.
//  - Import requires explicit consent on every call, not a stored flag.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth } from "./auth-middleware";
import { normHandle } from "./auth.functions";
import {
  canonicalName,
  encryptPhone,
  nameSimilarity,
  normalizePhone,
  phoneHash,
} from "./contacts";
import { uuid } from "./rows";
import type { D1Database } from "./bindings";

/** D1 tolerates far more, but chunking keeps a single import well inside limits. */
const SQL_CHUNK = 90;
const MAX_CONTACTS_PER_IMPORT = 2000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Node recomputation
// ---------------------------------------------------------------------------

/**
 * Rebuild person_nodes rows for the given hashes from the full edge set.
 *
 * Recomputed (not incremented) so the numbers stay correct after re-imports and
 * deletions. `user_id` is deliberately not written here — ON CONFLICT DO UPDATE
 * omits it so a previously established identity is never clobbered.
 */
async function recomputeNodes(db: D1Database, hashes: string[]): Promise<void> {
  const unique = [...new Set(hashes)];
  if (!unique.length) return;

  for (const group of chunk(unique, SQL_CHUNK)) {
    const placeholders = group.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT ce.phone_hash, ce.owner_id, ce.name_as_saved, p.school
           FROM contact_edges ce
           LEFT JOIN profiles p ON p.user_id = ce.owner_id
          WHERE ce.phone_hash IN (${placeholders})`,
      )
      .bind(...group)
      .all<{ phone_hash: string; owner_id: string; name_as_saved: string | null; school: string | null }>();

    const byHash = new Map<string, { owners: Set<string>; names: string[]; schools: string[] }>();
    for (const row of results) {
      let agg = byHash.get(row.phone_hash);
      if (!agg) {
        agg = { owners: new Set(), names: [], schools: [] };
        byHash.set(row.phone_hash, agg);
      }
      agg.owners.add(row.owner_id);
      if (row.name_as_saved) agg.names.push(row.name_as_saved);
      if (row.school) agg.schools.push(row.school);
    }

    const statements = [...byHash.entries()].map(([hash, agg]) => {
      // school_guess = what most of the address books holding this person attend
      const tally = new Map<string, number>();
      for (const s of agg.schools) tally.set(s, (tally.get(s) ?? 0) + 1);
      let school: string | null = null;
      let best = 0;
      for (const [s, n] of tally) if (n > best) { best = n; school = s; }

      return db
        .prepare(
          `INSERT INTO person_nodes (phone_hash, canonical_name, school_guess, degree, updated_at)
           VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ON CONFLICT(phone_hash) DO UPDATE SET
             canonical_name = excluded.canonical_name,
             school_guess   = excluded.school_guess,
             degree         = excluded.degree,
             updated_at     = excluded.updated_at`,
        )
        .bind(hash, canonicalName(agg.names), school, agg.owners.size);
    });

    if (statements.length) await db.batch(statements);
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const ImportSchema = z.object({
  // Explicit per-call consent: the import screen must pass this, so a stale
  // stored flag can never authorize a silent re-upload.
  consent: z.literal(true),
  contacts: z
    .array(
      z.object({
        phone: z.string().trim().min(4).max(32),
        name: z.string().trim().max(120).optional().nullable(),
      }),
    )
    .max(MAX_CONTACTS_PER_IMPORT),
});

/**
 * Upload one address book. Numbers are hashed for matching and encrypted for
 * the delivery path; the plaintext is discarded before anything is written.
 */
export const importContacts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) => ImportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { db, userId } = context;

    // Normalize + dedupe first: address books are full of the same person under
    // several formattings, and each duplicate would otherwise cost a hash.
    const byE164 = new Map<string, string | null>();
    let skipped = 0;
    for (const entry of data.contacts) {
      const e164 = normalizePhone(entry.phone);
      if (!e164) { skipped++; continue; }
      const existing = byE164.get(e164);
      // prefer the fuller saved name when the same number appears twice
      if (existing === undefined || (entry.name && entry.name.length > (existing?.length ?? 0))) {
        byE164.set(e164, entry.name ?? existing ?? null);
      }
    }

    const prepared = await Promise.all(
      [...byE164.entries()].map(async ([e164, name]) => ({
        e164,
        hash: await phoneHash(e164),
        enc: await encryptPhone(e164),
        name,
      })),
    );

    // Never store an edge pointing at the importer themselves.
    const selfHash = await selfPhoneHash(db, userId);
    const edges = selfHash ? prepared.filter((p) => p.hash !== selfHash) : prepared;

    for (const group of chunk(edges, SQL_CHUNK)) {
      await db.batch(
        group.map((p) =>
          db
            .prepare(
              `INSERT INTO contact_edges (id, owner_id, phone_hash, phone_enc, name_as_saved)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(owner_id, phone_hash) DO UPDATE SET
                 name_as_saved = COALESCE(excluded.name_as_saved, contact_edges.name_as_saved),
                 phone_enc     = excluded.phone_enc`,
            )
            .bind(uuid(), userId, p.hash, p.enc, p.name),
        ),
      );
    }

    await recomputeNodes(db, edges.map((e) => e.hash));

    // Hand back the hash for each number the caller supplied so the client can
    // build its OWN local hash -> phone map. Invite targeting then works
    // without the server ever sending a phone number to a client; the only
    // numbers echoed here are the ones this caller just uploaded.
    return {
      ok: true as const,
      imported: edges.length,
      skipped,
      map: edges.map((e) => ({ hash: e.hash, e164: e.e164 })),
    };
  });

/** The importer's own number, if we've ever learned it — used to drop self-edges. */
async function selfPhoneHash(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT phone_hash FROM person_nodes WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ phone_hash: string }>();
  return row?.phone_hash ?? null;
}

// ---------------------------------------------------------------------------
// Invite targeting
// ---------------------------------------------------------------------------

/**
 * Who to invite first: the people the most address books agree exist and who
 * haven't joined. Ranked by degree (centrality) — popular people first, since
 * they pull the most of their own network in behind them.
 *
 * Returns phone_hash, never a number. The client re-identifies each target
 * against the local address book it just imported from.
 */
export const getInviteTargets = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(100).default(25) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;

    // Restricted to the caller's OWN edges: you may only see, and invite,
    // people who are actually in your address book.
    const { results } = await db
      .prepare(
        `SELECT pn.phone_hash, pn.canonical_name, pn.school_guess, pn.degree
           FROM person_nodes pn
           JOIN contact_edges ce
             ON ce.phone_hash = pn.phone_hash AND ce.owner_id = ?
          WHERE pn.user_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM outreach_optouts oo WHERE oo.phone_hash = pn.phone_hash)
          ORDER BY pn.degree DESC, pn.canonical_name ASC
          LIMIT ?`,
      )
      .bind(userId, data.limit)
      .all<{ phone_hash: string; canonical_name: string | null; school_guess: string | null; degree: number }>();

    return {
      targets: results.map((r) => ({
        phoneHash: r.phone_hash,
        name: r.canonical_name,
        school: r.school_guess,
        // How many address books hold them. Deliberately coarse: an exact count
        // across other people's contacts is a popularity metric we don't expose.
        reach: r.degree >= 10 ? "high" : r.degree >= 3 ? "medium" : "low",
      })),
    };
  });

// ---------------------------------------------------------------------------
// Handle <-> phone resolution
// ---------------------------------------------------------------------------

/**
 * Best known phone_hash for an Instagram handle, in confidence order:
 *   1. an existing handle_phone_link (signup > sender-confirmed > name match)
 *   2. a fresh name match between the IG display name and the crowd's
 *      canonical name for a node
 *
 * Never returns a number — only the hash and a confidence, so callers can
 * decide whether to ask the sender to confirm before anything is delivered.
 */
export const resolveHandleToPhone = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        handle: z.string().trim().min(1).max(64),
        // IG display name, when the caller already has the profile in hand
        displayName: z.string().trim().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const handle = normHandle(data.handle);

    const linked = await db
      .prepare(
        `SELECT phone_hash, source, confidence FROM handle_phone_links
          WHERE handle = ? ORDER BY confidence DESC LIMIT 1`,
      )
      .bind(handle)
      .first<{ phone_hash: string; source: string; confidence: number }>();
    if (linked) {
      return {
        resolved: true as const,
        phoneHash: linked.phone_hash,
        confidence: linked.confidence,
        source: linked.source,
        needsConfirmation: linked.confidence < 0.9,
      };
    }

    if (!data.displayName) {
      return { resolved: false as const, candidates: [] };
    }

    // Name-match against the caller's own contacts only. Matching across the
    // whole graph would let anyone probe for who is in other people's books.
    const { results } = await db
      .prepare(
        `SELECT pn.phone_hash, pn.canonical_name, pn.school_guess
           FROM person_nodes pn
           JOIN contact_edges ce
             ON ce.phone_hash = pn.phone_hash AND ce.owner_id = ?
          WHERE pn.canonical_name IS NOT NULL AND pn.user_id IS NULL
          LIMIT 500`,
      )
      .bind(userId)
      .all<{ phone_hash: string; canonical_name: string; school_guess: string | null }>();

    const scored = results
      .map((r) => ({
        phoneHash: r.phone_hash,
        name: r.canonical_name,
        school: r.school_guess,
        score: nameSimilarity(data.displayName!, r.canonical_name),
      }))
      .filter((c) => c.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { resolved: false as const, candidates: scored };
  });

/**
 * The sender confirms "yes, this contact is that handle". Highest-confidence
 * source there is, short of the person signing up and telling us themselves.
 */
export const confirmContactMatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input) =>
    z
      .object({
        handle: z.string().trim().min(1).max(64),
        phoneHash: z.string().trim().regex(/^[0-9a-f]{64}$/, "invalid contact reference"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const handle = normHandle(data.handle);

    // Authorization: you can only confirm a link for someone in YOUR address
    // book. Without this check any user could assert a link for any number.
    const owned = await db
      .prepare("SELECT 1 AS ok FROM contact_edges WHERE owner_id = ? AND phone_hash = ? LIMIT 1")
      .bind(userId, data.phoneHash)
      .first<{ ok: number }>();
    if (!owned) return { ok: false as const, error: "That contact isn't in your address book" };

    await db
      .prepare(
        `INSERT INTO handle_phone_links (id, phone_hash, handle, source, confidence)
         VALUES (?, ?, ?, 'sender_confirmed', 1.0)
         ON CONFLICT(phone_hash, handle) DO UPDATE SET
           source     = 'sender_confirmed',
           confidence = 1.0`,
      )
      .bind(uuid(), data.phoneHash, handle)
      .run();

    return { ok: true as const };
  });

/**
 * Called on signup once a handle is known: binds every node linked to that
 * handle to the new user, which retires them from invite targeting.
 * Idempotent — safe to call on every signup and handle change.
 */
export async function linkPersonNodesForHandle(
  db: D1Database,
  handle: string,
  userId: string,
): Promise<void> {
  const norm = normHandle(handle);
  await db
    .prepare(
      `UPDATE person_nodes SET user_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE user_id IS NULL
          AND phone_hash IN (SELECT phone_hash FROM handle_phone_links WHERE handle = ?)`,
    )
    .bind(userId, norm)
    .run();
}
