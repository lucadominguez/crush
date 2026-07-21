// Web Push delivery from the Worker: VAPID (RFC 8292) auth + aes128gcm
// payload encryption (RFC 8291), both on WebCrypto since there is no Node
// crypto here and `web-push` is a Node library.
//
// Payload rule (see CLAUDE.md): notification payloads carry IDs and counts,
// never message text or the identity of who picked someone.

import { getSecret, type D1Database } from "./bindings";

const enc = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}
function bytesToB64u(u8: Uint8Array): string {
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** HKDF with a single output block, which is all Web Push ever needs. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

/**
 * Import the VAPID private key, tolerating either storage format:
 *  - 32 bytes: the raw P-256 scalar, as `web-push` style generators emit.
 *    WebCrypto cannot import a bare scalar, so we rebuild a JWK using x/y
 *    from VAPID_PUBLIC.
 *  - anything else: treated as PKCS#8 DER, which is what SubtleCrypto's own
 *    exportKey("pkcs8") produces (~138 bytes for P-256). This is the format
 *    the deployed keypair actually uses.
 */
async function vapidSigningKey(): Promise<CryptoKey> {
  const priv = b64uToBytes(getSecret("VAPID_PRIVATE") ?? "");
  if (!priv.length) throw new Error("VAPID_PRIVATE is not configured");

  if (priv.length === 32) {
    const pub = b64uToBytes(getSecret("VAPID_PUBLIC") ?? "");
    if (pub.length !== 65 || pub[0] !== 0x04) {
      throw new Error(`VAPID_PUBLIC must be a 65-byte uncompressed P-256 point (got ${pub.length})`);
    }
    return crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: bytesToB64u(pub.slice(1, 33)),
        y: bytesToB64u(pub.slice(33, 65)),
        d: bytesToB64u(priv),
        ext: true,
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  }

  return crypto.subtle.importKey(
    "pkcs8",
    priv as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for one push origin. */
async function vapidHeader(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: getSecret("VAPID_SUBJECT") ?? "mailto:support@crush.app",
      }),
    ),
  );
  const signingInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await vapidSigningKey(),
    enc.encode(signingInput),
  );
  // WebCrypto already emits raw r||s, which is what JWS ES256 wants.
  const jwt = `${signingInput}.${bytesToB64u(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${getSecret("VAPID_PUBLIC")}`;
}

// ---------------------------------------------------------------------------
// Payload encryption (RFC 8291)
// ---------------------------------------------------------------------------

async function encryptPayload(
  plaintext: string,
  p256dhB64: string,
  authB64: string,
): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(p256dhB64);
  const authSecret = b64uToBytes(authB64);

  // Ephemeral sender keypair, fresh per message.
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // IKM is derived from the shared secret keyed by the subscription's auth
  // secret, binding the message to this specific subscription.
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 is the last-record delimiter for a single-record message.
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, padded as BufferSource),
  );

  // aes128gcm header: salt(16) | record size(4) | key id length(1) | key id
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

type SubRow = { id: string; endpoint: string; p256dh: string | null; auth: string | null; failures: number };

/** True when the VAPID keys are present, i.e. push can actually be delivered. */
export function pushConfigured(): boolean {
  return !!getSecret("VAPID_PUBLIC") && !!getSecret("VAPID_PRIVATE");
}

/**
 * Fan a message out to every subscription a user has.
 *
 * Failures are tolerated and counted: 404/410 mean the subscription is dead at
 * the push service and is deleted immediately; other errors increment a counter
 * and are pruned after repeated failures. Never throws — a push problem must
 * not fail the action that triggered it.
 */
export async function sendPush(db: D1Database, userId: string, msg: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;

  const { results: subs } = await db
    .prepare("SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = ?")
    .bind(userId)
    .all<SubRow>();
  if (!subs.length) return 0;

  const payload = JSON.stringify(msg);
  let delivered = 0;

  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.p256dh || !sub.auth) return;
      try {
        const [body, auth] = await Promise.all([
          encryptPayload(payload, sub.p256dh, sub.auth),
          vapidHeader(sub.endpoint),
        ]);
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "normal",
          },
          body: body as BodyInit,
        });

        if (res.ok) {
          delivered++;
          if (sub.failures > 0) {
            await db.prepare("UPDATE push_subscriptions SET failures = 0 WHERE id = ?").bind(sub.id).run();
          }
          return;
        }
        // Push services explain rejections in the body. Log every failure,
        // including the 404/410 prune path: deleting a subscription without
        // saying why is exactly the case that is impossible to debug later.
        const detail = await res.text().catch(() => "");
        console.error(`push: ${res.status} from ${new URL(sub.endpoint).host}: ${detail.slice(0, 300)}`);

        if (res.status === 404 || res.status === 410) {
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
          return;
        }
        await bumpFailure(db, sub);
      } catch (err) {
        console.error(`push: threw for ${sub.id}:`, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        await bumpFailure(db, sub).catch(() => {});
      }
    }),
  );

  return delivered;
}

async function bumpFailure(db: D1Database, sub: SubRow): Promise<void> {
  if (sub.failures >= 4) {
    await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
    return;
  }
  await db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?").bind(sub.id).run();
}

/**
 * Human-readable push copy for a notification type. Returns null for types that
 * should stay in-app only, which is how we keep the push channel to meaningful
 * moments rather than every row written to `notifications`.
 */
export function pushCopyFor(type: string, payload: Record<string, unknown>): PushMessage | null {
  switch (type) {
    case "crush_received":
      return { title: "someone picked you 👀", body: "open crush to see how close you are", url: "/app", tag: "crush_received" };
    case "match_created":
      return { title: "it's mutual 💘", body: "you both picked each other. say something.", url: "/app/matches", tag: "match" };
    case "new_message":
      // Deliberately no message text: payloads never carry content.
      return { title: "new message", body: "you have a new message", url: "/app/messages", tag: "msg" };
    case "match_expiring":
      return { title: "your match is expiring", body: "save it before it disappears", url: "/app/matches", tag: "expiry" };
    case "referral_joined":
      return { title: "a friend joined 🎉", body: "you're closer to another pick slot", url: "/app", tag: "referral" };
    case "poll_won":
      return { title: "you won a poll 🏆", body: "see what people voted", url: "/app/standings", tag: "poll" };
    default:
      return null;
  }
}
