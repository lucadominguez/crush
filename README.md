# Crush Connect

Mutual-only crush matcher built on Instagram identity. You privately pick who
you like; nobody is told anything unless the feeling is mutual. Polls, group
chats, referrals and God Mode sit on top of that core loop.

**Live:** https://crush-connect.ludomi2502.workers.dev

## Stack

Everything runs as a single Cloudflare Worker.

| Concern | Implementation |
|---|---|
| App + SSR + server functions | TanStack Start v1 (React 19, Vite 7) |
| UI | Tailwind v4 + shadcn/ui, mobile-first (390px) |
| Database | Cloudflare D1 (SQLite) — `db/schema.sql` is the source of truth |
| File storage | Cloudflare R2 (avatars), served via `/api/avatar/$` |
| Auth | Own session auth: PBKDF2-SHA256, HttpOnly cookie, `users`/`sessions` |
| Realtime | Visibility-aware polling (Durable Object websockets planned) |
| Payments | Stripe direct, **sandbox only** until explicitly enabled |
| Instagram data | HikerAPI (search, profile, bio-code verification) |
| Native shells | Capacitor (iOS/Android) |

Server code lives in `src/backend/` (not `src/server/` — TanStack Start blocks
client imports matching `**/server/**`). `src/lib/*.functions.ts` are thin
re-export shims so component imports stay stable.

## Develop

```bash
npm install
npm run dev            # vite dev server
npx tsc --noEmit       # keep this at 0 errors
npm run build          # builds the Worker into .output/
```

## Deploy

```bash
npm run build
npx wrangler deploy -c .output/server/wrangler.json
```

Nitro generates the effective Worker config; bindings declared in
`wrangler.jsonc` propagate into it.

## Database

```bash
npx wrangler d1 execute crush-db --local  --file db/schema.sql
npx wrangler d1 execute crush-db --remote --file db/schema.sql
npx wrangler d1 execute crush-db --remote --file db/seed-poll-questions.sql
```

## Secrets

Set with `npx wrangler secret put <NAME> --name crush-connect`. Never commit
them; `.env*` is gitignored.

- `HIKER_API_KEY` — Instagram search/verification
- `CRON_SECRET` — required `x-cron-secret` header on the scheduled hooks
- `STRIPE_SANDBOX_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`
- `PUBLIC_APP_ORIGIN` — used to build absolute URLs

## Scheduled hooks

`POST /api/public/hooks/{daily-poll,match-expiry,weekly-superlative}`, each
requiring the `x-cron-secret` header. They are idempotent and safe to retry.

## Project docs

- `OUTSTANDING.md` — live tracker: decisions, remaining work, runtime traps
- `CHANGELOG.md` — release history
- `CLAUDE.md` — working context and invariants
- `BACKEND.md` — historical Lovable-era backend outline (parity reference)
