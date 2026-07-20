// Session auth core (replaces Supabase GoTrue).
// Passwords: PBKDF2-SHA256 via WebCrypto, format "v1$<iterations>$<saltB64>$<hashB64>".
// Sessions: 32-byte random opaque token in an HttpOnly cookie; only its SHA-256
// is stored in D1 (`sessions.token_hash`), so a DB leak leaks no usable tokens.

import { getDb } from "./bindings";

// 100k is the hard ceiling the Workers runtime allows for PBKDF2 (higher
// throws "iteration counts above 100000 are not supported"). Stored hashes
// carry their own iteration count, so this can be raised if the cap ever is.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_DAYS = 60;
export const SESSION_COOKIE = "crush_session";

const enc = new TextEncoder();

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `v1$${PBKDF2_ITERATIONS}$${b64(salt.buffer as ArrayBuffer)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const iterations = Number(parts[1]);
  const salt = b64decode(parts[2]);
  const expected = b64decode(parts[3]);
  const actual = new Uint8Array(await pbkdf2(password, salt, iterations));
  if (actual.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = newSessionToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, userId, expiresAt)
    .run();
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function getUserIdForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    await getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return row.user_id;
}

export function readSessionCookie(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function sessionSetCookie(token: string, expiresAt: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
