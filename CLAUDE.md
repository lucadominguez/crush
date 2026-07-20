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
- Auth: hand-rolled sessions (PBKDF2-SHA256 WebCrypto, HttpOnly cookie),
  `users`/`sessions` tables. All authorization lives in server functions
  (D1 has no RLS) — every server fn must check ownership/participation itself.
- Capacitor shells for iOS/Android wrap the deployed web app.
- Legacy: `src/integrations/supabase/*`, `@lovable.dev/*` packages, Stripe
  gateway shim in `src/lib/stripe.server.ts` — being removed by the port.

## Commands (all verified)
- `npm run dev` — vite dev server
- `npm run build` — Worker build; nitro OVERRIDES wrangler.jsonc `main`; the
  effective deploy config is generated `.output/server/wrangler.json` (bindings
  from wrangler.jsonc DO propagate — verified)
- `npx tsc --noEmit` — baseline 0 errors; keep it there
- `npx wrangler d1 execute crush-db --local|--remote --file db/schema.sql`
- Deploy: `npx nitro deploy --prebuilt` after build (or wrangler deploy on
  `.output/server`)

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

Context verified against commit d4e18c1 on 2026-07-19.
