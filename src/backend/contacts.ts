// Contact-graph primitives: phone normalization, crypto, and name resolution.
//
// Privacy contract (v1, non-negotiable — see OUTSTANDING.md):
//  - A phone number is NEVER stored in the clear. `phone_hash` is an HMAC used
//    only for matching; `phone_enc` is AES-GCM and only ever decrypted inside a
//    send path the user explicitly triggered.
//  - "Who uploaded you" is never revealed or queryable.
//  - Both keys derive from one CONTACT_KEY secret, so rotating it invalidates
//    matching and delivery together (a deliberate kill switch).

import { getSecret } from "./bindings";

const enc = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}
function bytesToB64u(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function contactKeyBytes(): Uint8Array {
  const raw = getSecret("CONTACT_KEY");
  if (!raw) throw new Error("CONTACT_KEY is not configured");
  return b64uToBytes(raw);
}

/**
 * E.164 normalization. Without a country hint we assume NANP for 10-digit
 * inputs, which is what this product's audience uses; anything already
 * carrying a + is respected as-is.
 */
export function normalizePhone(raw: string, defaultCountry = "1"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Stable matching key. HMAC (not bare SHA-256) so the hash space isn't brute-forceable. */
export async function phoneHash(e164: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    contactKeyBytes() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(e164));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** AES-GCM encrypt for the delivery path. Output: b64u(iv) . b64u(ciphertext). */
export async function encryptPhone(e164: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", contactKeyBytes() as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(e164));
  return `${bytesToB64u(iv)}.${bytesToB64u(new Uint8Array(ct))}`;
}

export async function decryptPhone(packed: string): Promise<string | null> {
  try {
    const [ivB64, ctB64] = packed.split(".");
    if (!ivB64 || !ctB64) return null;
    const key = await crypto.subtle.importKey("raw", contactKeyBytes() as BufferSource, "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uToBytes(ivB64) as BufferSource },
      key,
      b64uToBytes(ctB64) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Name resolution
// ---------------------------------------------------------------------------

const NICKNAMES: Record<string, string> = {
  alex: "alexander", alexa: "alexandra", ally: "alexandra", sasha: "alexander",
  ben: "benjamin", benny: "benjamin", bill: "william", will: "william", billy: "william",
  bob: "robert", rob: "robert", robbie: "robert", chris: "christopher", topher: "christopher",
  dan: "daniel", danny: "daniel", dave: "david", davey: "david", ed: "edward", eddie: "edward",
  gabe: "gabriel", greg: "gregory", jim: "james", jimmy: "james", jamie: "james",
  joe: "joseph", joey: "joseph", jon: "jonathan", jonny: "jonathan", josh: "joshua",
  kate: "katherine", katie: "katherine", kathy: "katherine", kat: "katherine",
  liz: "elizabeth", beth: "elizabeth", lizzie: "elizabeth", ellie: "eleanor",
  matt: "matthew", mike: "michael", mikey: "michael", nick: "nicholas",
  pat: "patricia", patty: "patricia", pete: "peter", phil: "philip",
  rick: "richard", ricky: "richard", dick: "richard", sam: "samuel", sammy: "samuel",
  steve: "stephen", tom: "thomas", tommy: "thomas", tony: "anthony",
  vicky: "victoria", zack: "zachary", zach: "zachary", maddy: "madison", maddie: "madison",
  abby: "abigail", becca: "rebecca", cass: "cassandra", char: "charlotte", lottie: "charlotte",
  izzy: "isabella", bella: "isabella", mia: "amelia", millie: "amelia", nat: "natalie",
  olly: "oliver", ollie: "oliver", soph: "sophia", sophie: "sophia", tash: "natasha",
};

/** Strip emoji, punctuation, and role labels teens put in contact names. */
export function cleanContactName(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\b(work|school|mom|dad|home|cell|mobile|do not answer|dont answer)\b/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(raw: string): string[] {
  return cleanContactName(raw)
    .split(" ")
    .filter(Boolean)
    .map((t) => NICKNAMES[t] ?? t);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Similarity in [0,1] between two names that different people saved for the
 * same person ("James McNair", "james m", "Jamie 🏀"). Token overlap dominates;
 * edit distance rescues typos and truncations.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let hits = 0;
  for (const t of ta) {
    if (setB.has(t)) { hits++; continue; }
    // initial-vs-full-name ("james m" ~ "james mcnair")
    if (t.length === 1 && tb.some((x) => x.startsWith(t))) { hits += 0.75; continue; }
    const near = tb.some((x) => Math.abs(x.length - t.length) <= 3 && editDistance(t, x) <= 1);
    if (near) hits += 0.8;
  }
  return Math.min(1, hits / Math.max(ta.length, tb.length));
}

/** Pick the name most address books agree on, preferring fuller forms. */
export function canonicalName(names: string[]): string | null {
  const cleaned = names.map(cleanContactName).filter(Boolean);
  if (!cleaned.length) return null;
  const scored = cleaned.map((n) => {
    const support = cleaned.reduce((acc, other) => acc + (nameSimilarity(n, other) >= 0.6 ? 1 : 0), 0);
    return { n, score: support * 10 + nameTokens(n).length };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].n.replace(/\b\w/g, (c) => c.toUpperCase());
}
