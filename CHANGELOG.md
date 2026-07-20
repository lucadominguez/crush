# Changelog — Crush Connect

All notable changes. Versions follow semver; app version lives in package.json.

## [Unreleased]
### Added
- Complete D1 server layer under `src/server/`: session auth (PBKDF2 +
  HttpOnly cookie), crush/match/message domain with full PG-trigger parity
  (mutual detect, slot limit, expiry, notification fan-out, send idempotency),
  profile/IG verify, polls (feed visibility, vote, create), onboarding/quiz/
  icebreakers, growth (invites, referral slot awards, hints, superlative),
  groups (atomic create, previews, read cursors), payments on direct Stripe.
- `db/schema.sql` gained quiz_answers + streak/onboarded columns (remote
  applied).
### Changed
- `src/lib/*.functions.ts` are now re-export shims over `src/server/*` —
  the Supabase data path for ALL server functions is gone.
- Stripe no longer routes through Lovable's connector gateway.
- Referral codes generate UPPERCASE (PG parity).
### Pending
- Client store/groups rewrite (auth + data + polling), 3 components,
  api routes, dependency removal, first Cloudflare deploy.

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
