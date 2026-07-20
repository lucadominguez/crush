# Changelog — Crush Connect

All notable changes. Versions follow semver; app version lives in package.json.

## [0.2.0] — 2026-07-20
Off Lovable and Supabase entirely; running on own Cloudflare infra.

### Live
- Deployed to https://crush-connect.ludomi2502.workers.dev (D1 + R2, single
  Worker). Core loop verified in real browsers: signup, mutual match, chat.

### Added
- Complete D1 server layer under `src/backend/`: session auth (PBKDF2 +
  HttpOnly cookie), crush/match/message domain with full PG-trigger parity
  (mutual detect, slot limit, expiry, notification fan-out, send idempotency),
  profile/IG verify, polls (feed visibility, vote, create), onboarding/quiz/
  icebreakers, growth (invites, referral slot awards, hints, superlative),
  groups (atomic create, previews, read cursors), payments on direct Stripe.
- `db/schema.sql` gained quiz_answers + streak/onboarded columns (remote
  applied).
### Changed
- `src/lib/*.functions.ts` are now re-export shims over `src/backend/*` —
  the Supabase data path for ALL server functions is gone.
- Stripe no longer routes through Lovable's connector gateway.
- Referral codes generate UPPERCASE (PG parity).
- Client fully rewritten off Supabase (store/groups/hooks), R2 avatar upload
  + `/api/avatar/$` reader, `searchProfiles`, `getPublicStats`.
- Cron hooks gated by `x-cron-secret` (previously unauthenticated); daily-poll
  generation reimplemented on D1; poll question bank seeded.

### Fixed
- Bindings now read `globalThis.__env__`: nitro generates its own Worker entry
  and ignores `main`, so the previous env capture never ran in production.
- PBKDF2 iterations lowered to the Workers ceiling of 100k (210k threw).

### Removed
- `@supabase/supabase-js`, `@lovable.dev/cloud-auth-js`, `src/integrations/`,
  and the Lovable Stripe connector gateway.

### Known gaps
- Cron Triggers not auto-firing yet (nitro owns the entry); hooks callable.
- Google OAuth stubbed; add-crush UI needs HIKER_API_KEY; no "add anyway" path.

## [Unreleased]

## [0.1.0] — 2026-07-19
Off-Lovable migration begins ("Phase A").

### Added
- Git history starts: baseline commit + tag `baseline-lovable-export` of the
  Lovable export (all prior history lived only inside Lovable).
- `OUTSTANDING.md` project tracker; `data-export/lovable-export-2026-07-19.json`
  archive of the (near-empty) Lovable database.
- Cloudflare resources on own account: D1 `crush-db`, R2 `crush-avatars`;
  worker renamed `tanstack-start-app` -> `crush-connect`; bindings wired in
  `wrangler.jsonc` and verified to propagate through the nitro build.
- `db/schema.sql`: full D1/SQLite port of the 27 Supabase migrations
  (22 tables incl. new `users`/`sessions` auth tables). Applied to remote.

### Changed
- `.gitignore` now excludes `.env*` (the Lovable export shipped `.env`
  untracked-but-not-ignored with live Supabase keys).

### Decisions
- Backend: Cloudflare D1 + Durable Objects + R2, same account as Attentify,
  new resource names only. No Supabase.
- Auth: hand-rolled session auth (PBKDF2 via WebCrypto); Google OAuth deferred
  until a domain exists. Stripe direct (no Lovable gateway), sandbox only.
- Virality: escrow/claim loops + contact graph + anonymous Twilio SMS;
  no school-gating of features; no Instagram DM automation.
