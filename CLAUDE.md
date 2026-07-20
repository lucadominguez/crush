# Crush Connect

Mutual-only crush matcher on Instagram identity for teens/students. You privately
pick crushes by IG handle; both sides only find out on a mutual. Polls, group
chats, referrals, God Mode monetization on top. Formerly Lovable project
`crush100`; now self-owned, mid-migration to Cloudflare.

## Read first, update last
- **`OUTSTANDING.md`** — live tracker: decisions, phase checklists, session log.
  Read before planning; update before finishing. Discoveries go there, not chat.
- **`CHANGELOG.md`** — keep current; bump package.json version with meaningful
  releases.
- Session transcripts: `Desktop/AI/claude-logs/` (grep before re-asking the user).
- `BACKEND.md` — Lovable-era backend outline (historical reference for parity).

## Architecture (target state, mid-port)
- ONE Cloudflare Worker: TanStack Start v1 (React 19, Tailwind v4, shadcn) SSR
  app + server fns + bindings. No separate API worker.
- D1 `crush-db` (binding `CRUSH_DB`) — schema in `db/schema.sql` (the source of
  truth; SQLite conventions documented in its header).
- R2 `crush-avatars` (binding `AVATARS`). Durable Objects for chat/notifications
  realtime (replacing Supabase channels) — added when written.
- Auth: hand-rolled sessions (PBKDF2-SHA256 WebCrypto, HttpOnly cookie
  `crush_session`), `users`/`sessions` tables. All authorization lives in server
  functions (D1 has no RLS) — every server fn must check ownership itself.
- Server code lives in `src/backend/` — NOT `src/server/`: TanStack Start's
  import-protection denies client imports matching `**/server/**`.
  `src/lib/*.functions.ts` are thin re-export shims over it.
- Realtime is visibility-aware polling (chat 4s, previews 8s, notifications
  10s). Durable Object websockets are the planned upgrade.
- Capacitor shells for iOS/Android wrap the deployed web app.
- Supabase/Lovable auth are GONE. The only Lovable tie left is the build-time
  `@lovable.dev/vite-tanstack-config` wrapper (blocks nitro task config).

## Commands (all verified)
- `npm run dev` — vite dev server
- `npm run build` — Worker build; nitro OVERRIDES wrangler.jsonc `main`; the
  effective deploy config is generated `.output/server/wrangler.json` (bindings
  from wrangler.jsonc DO propagate — verified)
- `npx tsc --noEmit` — baseline 0 errors; keep it there
- `npx wrangler d1 execute crush-db --local|--remote --file db/schema.sql`
- Deploy: `npx nitro deploy --prebuilt` after build (or wrangler deploy on
  `.output/server`)

## Runtime traps (cost a deploy each — do not regress)
- **nitro owns the Worker entry.** It ignores `main` and invokes the entry
  without `env`, so `src/server.ts` cannot capture bindings. Read them from
  `globalThis.__env__` via `src/backend/bindings.ts`; secrets via `getSecret()`.
- **Workers caps PBKDF2 at 100_000 iterations** — above that it throws.
- A green `npm run build` proves nothing: both bugs above built clean and only
  surfaced when the deployed app was driven in a browser.

## Invariants — don't break these
- **Never touch Attentify prod**: worker `attentify-cloud`, D1 `pd-cloud`,
  R2 `pd-downloads`, Pages `productivity-daemon` (same CF account!).
- Mutual-match creation must be atomic/idempotent (was a PG trigger; now must be
  transactional in the addCrush server fn).
- Message send idempotency via `client_id` unique indexes — the realtime-race
  reconcile logic in `src/lib/store.ts`/`groups.ts` depends on it.
- Hints reveal network context ONLY, never identity. Notification payloads carry
  IDs/counts, never message text.
- Standings/leaderboards rank positive activity only — never admirer counts.
- Stripe: SANDBOX ONLY until the user explicitly enables live.
- No school-gating of polls/features (explicit user decision).
- No secrets in client code or repo; `.env*` is gitignored.
- Teen-safety guardrails in OUTSTANDING.md are v1 scope, not polish.

## Quality bar
- Definition of done: committed + deployed + verified on the LIVE surface
  (drive the deployed app; build exit codes prove nothing).
- UI changes are unverified until looked at (screenshot/driven render).
- Product-grade polish; no debug noise in user-facing surfaces.

Live: https://crush-connect.ludomi2502.workers.dev
Context verified against commit 7b9aefb on 2026-07-20.
