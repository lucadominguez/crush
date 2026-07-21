// Moderation primitives: suspension checks and the chat word blocklist.
// The review surface lives in moderation.functions.ts.

import type { D1Database } from "./bindings";

/**
 * Suspended accounts keep their session but lose the ability to act. Checked in
 * the write paths rather than in requireAuth so a suspended user can still read
 * their own data and see why they were suspended.
 */
export async function isSuspended(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT suspended_at FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ suspended_at: string | null }>();
  return !!row?.suspended_at;
}

export async function assertNotSuspended(db: D1Database, userId: string): Promise<void> {
  if (await isSuspended(db, userId)) {
    throw new Error("Your account is suspended and can't send or post right now.");
  }
}

// Slurs and explicit sexual solicitation. Deliberately narrow: this is a teen
// product, so the cost of over-blocking normal teen speech is high, and a
// blunt profanity filter would catch mostly harmless words. Harassment that
// isn't lexical is handled by reports, not by this list.
const BLOCKED = [
  "kys", "kill yourself", "killyourself",
  "nigger", "nigga", "faggot", "fag", "tranny", "retard", "retarded",
  "chink", "spic", "kike", "wetback",
  "send nudes", "sendnudes", "nudes?", "child porn", "cp",
  "rape you", "rape u",
];

// Common evasions: repeated letters, separators between letters, digit swaps.
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function normalizeForMatch(text: string): string {
  const lowered = text.toLowerCase();
  const deleet = [...lowered].map((c) => LEET[c] ?? c).join("");
  // Strip anything that isn't a letter or space so "n.i.g" and "n_i_g" collapse.
  const stripped = deleet.replace(/[^a-z\s]/g, "");
  // Collapse runs of the same letter ("niiiigga" -> "niga") and whitespace.
  return stripped.replace(/(.)\1+/g, "$1").replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word match. Substring matching is not safe here: "cp" alone flags
 * "cpa" and "cpu", and "fag" flags ordinary words. Boundaries are letter-based
 * rather than \b so that a term can still be found inside punctuation.
 */
function hasWord(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(^|[^a-z])${escapeRe(term)}($|[^a-z])`).test(haystack);
}

/**
 * True when the text contains blocked language.
 *
 * Checked against both the raw lowercase text and a normalized form, so simple
 * evasions (leetspeak, separators, repeated letters) are caught. Both passes
 * are whole-word, which is what keeps the short entries usable.
 */
export function containsBlocked(text: string): boolean {
  if (!text) return false;
  const raw = text.toLowerCase();
  const norm = normalizeForMatch(text);
  return BLOCKED.some((term) => {
    if (hasWord(raw, term)) return true;
    const normTerm = normalizeForMatch(term);
    return normTerm.length >= 3 && hasWord(norm, normTerm);
  });
}

export const BLOCKED_MESSAGE = "That message breaks our rules. Keep it kind.";
