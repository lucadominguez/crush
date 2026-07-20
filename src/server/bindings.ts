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

export type WorkerEnv = {
  CRUSH_DB: D1Database;
  AVATARS: R2Bucket;
} & Record<string, unknown>;

let workerEnv: WorkerEnv | undefined;

export function setWorkerEnv(env: unknown): void {
  workerEnv = env as WorkerEnv;
}

export function getWorkerEnv(): WorkerEnv {
  if (!workerEnv) throw new Error("Worker env not captured yet (server.ts sets it per fetch)");
  return workerEnv;
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
