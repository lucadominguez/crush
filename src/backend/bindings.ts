// Worker bindings access. src/server.ts captures the env object on every fetch
// (nitro/TSS don't expose bindings through process.env — only string vars).
//
// Structural types below instead of @cloudflare/workers-types: that package's
// globals conflict with lib.dom (this app compiles client + server in one
// tsconfig). Only the members we actually use are declared.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { last_row_id: number; changes: number; [k: string]: unknown };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
  etag: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** Service-binding fetcher (the realtime Worker). Shape we use only. */
export interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export type WorkerEnv = {
  CRUSH_DB: D1Database;
  AVATARS: R2Bucket;
  REALTIME?: Fetcher;
} & Record<string, unknown>;

let workerEnv: WorkerEnv | undefined;

/** Kept for the (unused) custom entry path; nitro is the real entry. */
export function setWorkerEnv(env: unknown): void {
  workerEnv = env as WorkerEnv;
}

// IMPORTANT: nitro's cloudflare preset generates its OWN worker entry and
// ignores `main` in wrangler.jsonc, so src/server.ts never runs in production.
// Nitro's handler sets `globalThis.__env__ = env` on every fetch/scheduled
// invocation (see nitro/dist/presets/cloudflare/runtime/_module-handler.mjs),
// which is the entry-independent way to reach bindings.
export function getWorkerEnv(): WorkerEnv {
  const fromNitro = (globalThis as { __env__?: WorkerEnv }).__env__;
  const env = fromNitro ?? workerEnv;
  if (!env) throw new Error("Worker env unavailable (no globalThis.__env__)");
  return env;
}

/**
 * Read a secret/var. Cloudflare secrets arrive on the env object; nitro also
 * mirrors many into process.env. Check both so local dev and prod agree.
 */
export function getSecret(name: string): string | undefined {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (fromProcess) return fromProcess;
  const value = (globalThis as { __env__?: Record<string, unknown> }).__env__?.[name];
  return typeof value === "string" ? value : undefined;
}

export function getDb(): D1Database {
  const db = getWorkerEnv().CRUSH_DB;
  if (!db) throw new Error("CRUSH_DB binding missing — check wrangler.jsonc d1_databases");
  return db;
}

export function getAvatarsBucket(): R2Bucket {
  const bucket = getWorkerEnv().AVATARS;
  if (!bucket) throw new Error("AVATARS binding missing — check wrangler.jsonc r2_buckets");
  return bucket;
}

/**
 * Poke every client subscribed to a room to refresh. Best-effort and never
 * throws: the realtime binding may be absent (not yet deployed/bound) and the
 * client's polling covers delivery regardless. Fire without blocking the
 * caller's own work for long.
 */
export async function pokeRoom(room: string): Promise<void> {
  try {
    const rt = getWorkerEnv().REALTIME;
    if (!rt) return;
    await rt.fetch(`https://realtime/broadcast?room=${encodeURIComponent(room)}`, { method: "POST" });
  } catch {
    /* best-effort: polling delivers anyway */
  }
}
