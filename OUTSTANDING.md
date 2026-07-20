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

- [x] Cloudflare resources created 2026-07-19: D1 `crush-db`
      (`d73cf571-16e6-4edf-8ea3-5eab4142c181`), R2 `crush-avatars`. Bindings
      in `wrangler.jsonc` (worker renamed `crush-connect`); VERIFIED they
      propagate into nitro's generated `.output/server/wrangler.json`.
      Architecture: SINGLE Worker (TanStack app + server fns + bindings), not
      the Attentify two-worker split — SSR app is already a Worker; no CORS,
      one deploy. DO namespaces get added to config when the chat DO is written.
- [x] Schema ported: `db/schema.sql` (22 tables incl. users/sessions for auth).
      Validated on local D1, APPLIED TO REMOTE crush-db 2026-07-19.
      Conventions: uuid->TEXT (app-side randomUUID), timestamptz->ISO TEXT,
      bool->INTEGER, jsonb/text[]->JSON TEXT. All RLS/trigger/RPC semantics
      documented in the file header — they move to server fns.
- [ ] Auth: hand-rolled sessions (PBKDF2-SHA256 via WebCrypto, opaque token,
      SHA-256 stored) — users/sessions tables already in schema. No Better
      Auth dependency needed.
- [~] Rewrite data access: Supabase -> server fns on D1. DONE so far:
      `src/server/bindings.ts` (env capture in server.ts fetch; structural D1/R2
      types — do NOT install @cloudflare/workers-types, its globals clash with
      lib.dom), `auth.ts` + `auth-middleware.ts` (requireAuth/optionalAuth give
      {userId, db}), `auth.functions.ts` (signUp/signIn/signOut/getMe, cookie
      `crush_session`), `rows.ts` (row types), `crush.functions.ts` (crushes/
      matches/messages/notifications/school-stats/streak, full trigger-chain
      port). tsc clean at each step.
      DONE: ALL server fn domains ported to src/server/*: crush.functions
      (also phase1), profile.functions (+claim_handle/mark_conversation_read),
      polls.functions (feed/vote/create RPC parity), onboarding.functions
      (+quiz+icebreakers), growth.functions (invites/referrals/hints/
      superlative), groups.functions (atomic create/messages/previews/read
      cursors), payments.functions + stripe.server (DIRECT api.stripe.com,
      gateway shim dead, all products still available:false safe-mode).
      src/lib/*.functions.ts are now thin re-export shims (component imports
      unchanged). instagram.functions.ts needed no port (no supabase).
      tsc = 0 errors.
      REMAINING:
      - [ ] CLIENT: rewrite src/lib/store.ts (1090 ln) + groups.ts (335) +
            phase1.hooks.ts internals: auth via signUpFn/signInFn/signOutFn/
            getMeFn (cookie session; no more supabase.auth), data via the
            listMyCrushes/addCrushFn/listMyMatches/listMessages/sendMessageFn
            + groups equivalents. KEEP the SWR cache/hook shapes + optimistic
            reconcile (client_id). Replace supabase realtime channels with
            4-5s polling while chat/notification surface is open; DO websocket
            upgrade AFTER first verified live deploy.
      - [ ] Components w/ direct supabase: AvatarUpload.tsx (-> R2 upload server
            fn, add uploadAvatar to profile.functions), CreateGroupSheet.tsx,
            LandingTicker.tsx, app.settings.tsx.
      - [ ] api.* routes: payments.webhook (use src/server/stripe.server verify
            + D1 record_purchase_and_grant port), match-expiry + weekly-
            superlative hooks (D1 + CRON_SECRET), wire CF Cron Triggers.
      - [ ] Delete src/integrations/supabase + lovable dirs; remove
            @supabase/supabase-js + @lovable.dev/cloud-auth-js deps; remove
            auth-attacher from src/start.ts.
      - [ ] npm run build; deploy workers.dev; drive core loop live.
- [ ] Realtime upgrade: Durable Object per match/group chat + per-user
      notification DO (WebSocket hibernation) — after polling version verified
      live.
- [ ] Storage: avatar upload -> R2.
- [ ] Stripe: delete Lovable gateway shim, direct api.stripe.com, sandbox keys.
- [ ] Cron: 3 jobs (daily poll, hourly match-expiry, weekly superlative) ->
      CF Cron Triggers; add CRON_SECRET check to hook routes (they have NO auth).
- [ ] Deploy `crush-connect` to workers.dev; verify core loop LIVE:
      signup -> add crush -> mutual -> reveal -> chat over websocket.
- [ ] Push GitHub private repo `crush-connect`.

## Features (Phase B, after port) — user-approved list

- [ ] Crush-link outreach (value-in-escrow): crush on a non-user generates a
      claim record + anonymous server-sent SMS (Twilio). NO Instagram DMs ever
      (bot-ban treadmill). Delivery resolution order: sender-provided number ->
      contact-graph resolution -> sender-confirmed match -> escrow.
- [ ] Poll claim loop: non-users can be poll candidates; "you were voted X by
      N people at [school]" claimable on signup.
- [ ] Landing "check your @" mode: anyone types their own IG handle, sees
      claim count ("1 person picked you"), signup to reveal. Zero-channel
      delivery surface.
- [ ] CONTACT GRAPH (user-directed 2026-07-19):
      - Import: Capacitor Contacts (native), Contact Picker API (Android web),
        manual fallback. E.164 normalization.
      - One person-node per phone number; edges (owner, phone, name-as-saved).
      - Identity resolution: name-variant clustering (nicknames, edit distance,
        token overlap), attribute inference from the crowd (school), IG-handle
        linkage from signups + sender confirmations + HikerAPI name match.
      - Centrality scoring: rank invite suggestions by how many address books
        contain the node (popular kids first).
      - Share-app: select-contacts or all-contacts via user's own SMS composer
        (personal invites); anonymous notices always server-side via Twilio.
      - Guardrails (v1, non-negotiable): import consent screen, 1 crush-SMS
        per target until response (+1 reminder max), global opt-out list,
        numbers encrypted + hashed match index, "who uploaded you" never
        revealed, purge on request. Teen product = zero press-cycle margin.
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
- Twilio: APPROVED 2026-07-19. User must create account + start A2P 10DLC
      registration EARLY (1-2 week lead time) — prompt them during Phase A.
- Domain name — whenever; workers.dev until then.

## Session log

- 2026-07-19: Oriented, git baseline + tag, deps installed, tsc/build baselines
  clean, coupling audit done, Lovable DB exported (near-empty), backend decision
  = Attentify Cloudflare stack, feature list negotiated with user.
