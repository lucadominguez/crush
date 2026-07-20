# Crush Connect — outstanding work tracker

Read this before planning any session. Update it before finishing.
Product: mutual-only crush matcher on Instagram identity, teen audience.
Lovable project `crush100` (a0b29d2b-...) is the ORIGIN, being left behind.

## Decisions (settled)

- **Backend: Cloudflare stack, same account as Attentify** (D1 + Workers + R2 +
  Durable Objects for realtime). No Supabase anywhere. User-directed 2026-07-19.
- Account `ludomi2502@gmail.com`, ID `9d6d64bd96fde15e47a6b5351cd3bce5`. Wrangler
  already OAuth'd machine-wide. See `Desktop/AI/CLOUDFLARE-HANDOFF.md`.
- **NEVER touch Attentify prod resources**: worker `attentify-cloud`, D1 `pd-cloud`,
  R2 `pd-downloads`, Pages `productivity-daemon`. Create new names (`crush-*`).
- Fresh data start: Lovable DB was near-empty (3 profiles). Export archived at
  `data-export/lovable-export-2026-07-19.json`. No data migration needed.
- Auth: email/password first; Google OAuth after a domain exists.
- Stripe: user's own account, SANDBOX ONLY until user explicitly enables live.
- No school-gated feature locks (user rejected): polls stay open to everyone —
  they are an acquisition surface ("see what people think about you").
- Crush Hour feature: rejected. Weekly recap: approved. School standings +
  individual standings: approved. UI overhaul: approved.
- Crush-link outreach: approved, but NOT via Instagram DMs — channel TBD
  (SMS/share-sheet proposal pending user confirmation).

## State (verified 2026-07-19)

- Repo: `Desktop/AI/crush/Crush Connect`, git init'd, tag `baseline-lovable-export`.
- Baseline: `npx tsc --noEmit` = 0 errors; `npm run build` = clean Worker build.
  Nitro overrides `wrangler.jsonc` `main` — effective config is generated
  `.output/server/wrangler.json`.
- Stack today: TanStack Start + React 19 + Tailwind v4 + shadcn, Supabase client
  everywhere (~35 `from("table")` call sites), Stripe via Lovable gateway shim
  (`src/lib/stripe.server.ts:11-37`), Google OAuth via `@lovable.dev/cloud-auth-js`
  (`src/lib/store.ts:254`), Capacitor shells for iOS/Android.
- `.env` holds Lovable Supabase keys; gitignored, never commit.
- Feature state: slots/scarcity, someone-picked-you banner, hints (network
  context only, never identity), cinematic reveal, icebreakers, match expiry+save,
  daily polls + share cards, referrals, streaks, quiz, God Mode weekly + Stripe
  sandbox consumables — ALL BUILT on the Supabase stack.

## The port (Phase A — blocks everything else)

- [ ] Scaffold `backend/` per Attentify pattern: Worker `crush-api`, new D1 db
      `crush-db`, R2 `crush-avatars`, DO namespaces for chat + notifications.
- [ ] Port schema: 27 Supabase migrations -> one D1 `schema.sql` (SQLite dialect;
      drop RLS — authorization moves into server functions).
- [ ] Auth: Better Auth (or session JWT) on the Worker; users table in D1.
- [ ] Rewrite data access: all Supabase client calls -> server fns hitting D1.
      Mutual-match detection must be transactional in the server fn (no triggers).
- [ ] Realtime: Durable Object per match/group chat + per-user notification DO
      (WebSocket hibernation). Replaces `postgres_changes` channels.
- [ ] Storage: avatar upload -> R2.
- [ ] Stripe: delete Lovable gateway shim, direct api.stripe.com, sandbox keys.
- [ ] Cron: 3 jobs (daily poll, hourly match-expiry, weekly superlative) ->
      CF Cron Triggers; add CRON_SECRET check to hook routes (they have NO auth).
- [ ] Deploy `crush-connect` to workers.dev; verify core loop LIVE:
      signup -> add crush -> mutual -> reveal -> chat over websocket.
- [ ] Push GitHub private repo `crush-connect`.

## Features (Phase B, after port) — user-approved list

- [ ] Crush-link outreach (value-in-escrow): crush on a non-user generates a
      claim link + anonymous notification. Channel decision pending.
- [ ] Poll claim loop: non-users can be poll candidates; "you were voted X by
      N people at [school]" claimable on signup.
- [ ] Push notifications backend: push_tokens in D1, FCM/APNs from Worker
      (native via Capacitor) + Web Push for browsers/PWA.
- [ ] Two-sided referral incentives (PayPal model, app currency both sides).
- [ ] Weekly recap card (Sunday push + IG-story shareable render).
- [ ] School standings (public leaderboard incl. landing page) + individual
      standings (positive metrics only: poll wins, streaks, invites — NEVER
      admirer counts: that's God Mode's paid product + shaming risk).
- [ ] UI overhaul (after features stabilize; direct code pass, not prompts).
- [ ] Moderation minimum: report review page, chat word blocklist, curated polls.
- [ ] K-factor instrumentation from day one (invites sent x conversion).

## Needed from user (when reached)

- HikerAPI key (lives only in Lovable env today) — Phase A deploy.
- Stripe sandbox keys from their own account — Phase A deploy.
- Twilio decision if SMS channel confirmed — Phase B.
- Domain name — whenever; workers.dev until then.

## Session log

- 2026-07-19: Oriented, git baseline + tag, deps installed, tsc/build baselines
  clean, coupling audit done, Lovable DB exported (near-empty), backend decision
  = Attentify Cloudflare stack, feature list negotiated with user.
