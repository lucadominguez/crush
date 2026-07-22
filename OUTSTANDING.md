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

## State (verified 2026-07-20)

- Repo: `Desktop/AI/crush/Crush Connect`, git, tag `baseline-lovable-export`.
  Version 0.1.0. `CHANGELOG.md` current. No GitHub remote yet.
- Baselines: `npx tsc --noEmit` = 0 errors; `npm run build` clean.
  Verify with the LIVE surface, not build exit codes (see the traps below).
- Stack now: TanStack Start + React 19 + Tailwind v4 + shadcn on ONE Cloudflare
  Worker; D1 for data, R2 for avatars, cookie sessions. Server fns in
  `src/backend/*`; `src/lib/*.functions.ts` are shims. Capacitor shells unused
  so far. Realtime = polling.
- Feature set (all carried over intact): slots/scarcity, someone-picked-you
  banner, hints (network context only, never identity), cinematic reveal,
  icebreakers, match expiry + save, daily polls + share cards, referrals,
  streaks, quiz, God Mode + consumables (Stripe safe-mode: every product is
  `available:false` server-side until explicitly enabled).
- Smoke-test scripts live in the session scratchpad (`full-loop.mjs`,
  `chat-loop.mjs`) — they drive signup/match/chat against the live worker and
  call server fns by their stable content-hash ids.

## The port (Phase A) — COMPLETE, DEPLOYED, VERIFIED LIVE 2026-07-20

Live: **https://crush-connect.ludomi2502.workers.dev**

- [x] Cloudflare resources: D1 `crush-db` (`d73cf571-16e6-4edf-8ea3-5eab4142c181`),
      R2 `crush-avatars`, single Worker `crush-connect`. Attentify prod untouched.
- [x] Schema: `db/schema.sql`, 23 tables, applied remote. Poll question bank
      seeded (`db/seed-poll-questions.sql`, 20 questions, idempotent).
- [x] Auth: hand-rolled sessions — PBKDF2-SHA256 (WebCrypto), opaque token,
      only its SHA-256 stored, HttpOnly `crush_session` cookie.
- [x] All server fns ported to `src/backend/*` with full PG-trigger/RPC parity.
      `src/lib/*.functions.ts` are re-export shims (component imports unchanged).
- [x] Client rewritten: `store.ts`, `groups.ts`, `phase1.hooks.ts` off Supabase.
      SWR cache + optimistic send/reconcile (client_id) preserved verbatim;
      realtime replaced by visibility-aware polling (chat 4s, previews 8s,
      notifications 10s).
- [x] Components: AvatarUpload + settings upload to R2 via server fn and read
      back through `/api/avatar/$`; CreateGroupSheet uses `searchProfiles`;
      LandingTicker uses `getPublicStats`.
- [x] api routes on D1: payments webhook (record_purchase_and_grant ported to a
      transactional D1 batch, idempotent by (user, sessionId)); the three cron
      hooks + `daily-poll` un-retired as the D1 port of generate_daily_polls().
      All three gated by `x-cron-secret` (they had NO auth on Lovable).
      CRON_SECRET is set as a Worker secret; all three verified live (403
      without the header, correct JSON with it).
- [x] Supabase + Lovable auth fully removed (`src/integrations/` deleted,
      `@supabase/supabase-js` and `@lovable.dev/cloud-auth-js` uninstalled).
- [x] VERIFIED LIVE in two real browsers: signup -> add crush both ways ->
      mutual match on both sides (6d expiry badge) -> chat opens with
      quiz-derived icebreakers -> message sent, received by the other side via
      polling, reply polled back. Zero JS errors. Candy theme intact
      (screenshots reviewed). Test data purged from D1 afterwards.

### Two runtime traps found only by deploying (do not regress)
1. **nitro owns the worker entry.** It ignores `main` and calls our entry
      without `env`, so `src/server.ts`'s env capture never runs. Bindings MUST
      come from `globalThis.__env__` (nitro sets it per fetch) — see
      `src/backend/bindings.ts`. Secrets go through `getSecret()`.
2. **Workers caps PBKDF2 at 100_000 iterations** (throws above it). Stored
      hashes carry their own iteration count, so the cap can be raised later.

### Phase A leftovers (small, non-blocking)
- [ ] Cron Triggers not yet firing automatically: nitro owns the entry, so
      Cloudflare's `scheduled()` needs nitro tasks (blocked on the
      `@lovable.dev/vite-tanstack-config` wrapper, the LAST Lovable dependency).
      Options: drop that wrapper for a plain TanStack Start vite config, or add
      a tiny separate scheduler Worker that POSTs the three hooks with the
      secret. Hooks work today when called manually.
- [ ] Google OAuth is stubbed with a friendly message (needs own OAuth client
      + domain). Email/password works.
- [x] HIKER_API_KEY set as a Worker secret 2026-07-20; Instagram search
      VERIFIED live (10 real results for "zendaya", pick registered, home shows
      1/3 picks + avatars proxying). **User should rotate this key** — it was
      pasted into a chat transcript.
- [ ] Secrets still to set: STRIPE_SANDBOX_API_KEY, PAYMENTS_SANDBOX_WEBHOOK_SECRET,
      PUBLIC_APP_ORIGIN.
- [ ] Durable Object websocket upgrade to replace polling.
- [ ] Push to a private GitHub repo `crush-connect`. `gh` CLI v2.96 is now
      INSTALLED (winget, at `C:\Program Files\GitHub CLI`) but not logged in —
      needs an interactive `gh auth login` from the user, then:
      `gh repo create crush-connect --private --source=. --push`.

### Product gap found while testing (feeds Phase B)
`/app/add` can ONLY add people returned by Instagram search. There is no
"add @handle anyway" path, so crushing on someone not in IG search results is
impossible — the escrow/claim virality loop depends on that path existing.

## RESUME HERE (state saved 2026-07-21)

Live: https://crush-connect.ludomi2502.workers.dev
GitHub: https://github.com/lucadominguez/crush (main, pushed and current).
NOTE: the local branch was `master`, not `main` as previously recorded here.
Renamed to `main` on 2026-07-21 and pushed with both tags.

### Shipped 2026-07-21
- **Contact graph server fns** (`src/backend/contacts.functions.ts`):
  importContacts, getInviteTargets, resolveHandleToPhone, confirmContactMatch,
  linkPersonNodesForHandle. person_nodes are RECOMPUTED from the full edge set,
  never incremented, so degree/canonical_name survive re-imports.
  Privacy: no phone is ever returned to a client. importContacts echoes back
  hashes for the numbers the caller uploaded so the client builds its own local
  hash -> phone map for the SMS composer. Targeting and name matching are
  scoped to the caller's own edges so nobody can probe other address books.
- **Contact import UI** (`ContactImportSheet`): per-call consent screen, Contact
  Picker API + manual paste fallback, ranked targets (reach bucketed, never an
  exact cross-book count). Reached from InviteFriendsSheet, but OWNED by
  app.index as a sibling: nesting the two sheets gave competing focus traps.
- **Web Push, VERIFIED LIVE END TO END.** Full RFC 8291 + 8292 on WebCrypto in
  `src/backend/push.ts` (web-push is Node-only). Wired into insertNotification,
  the single fan-out point. sw.js in public/. PushNotifToggle is now real.
- **Moderation**: word blocklist + suspension gate on both message send paths,
  /app/moderation review page, ReportUserSheet + a report control in chat.
- **Outreach sender** (`src/backend/outreach.ts`): pluggable, guardrails
  enforced in one place, records `suppressed` until Twilio is configured.
- **Em dash sweep**: 55 user-facing strings rewritten across 19 files.

### Push: hard-won details (do not regress)
1. **VAPID_PRIVATE is stored as PKCS#8 DER (138 bytes), NOT a raw 32-byte
   scalar.** The importer accepts both, but this is the format in production.
2. After `unsubscribe()`, `getSubscription()` can still hand back the dead
   subscription; pushing to it returns 410 and prunes the fresh row. enable()
   now always subscribes fresh.
3. Log EVERY delivery failure including the 404/410 prune path. Both bugs above
   were invisible because failed sends were deleted without recording why.

### Secrets: set vs still needed
Set: HIKER_API_KEY, CRON_SECRET, VAPID_PUBLIC, VAPID_PRIVATE, CONTACT_KEY.
Still to set:
- `MODERATOR_USER_IDS` (comma-separated) — **/app/moderation is inaccessible
  until this is set**; it fails closed by design.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — outreach
  stays in `suppressed` mode until all three exist.
- STRIPE_SANDBOX_API_KEY, PAYMENTS_SANDBOX_WEBHOOK_SECRET, PUBLIC_APP_ORIGIN.

### Still to do in Phase B
- [x] Wire `sendCrushNotice()` into the addCrush path DONE 2026-07-21. Fires
      only when the pick targets an unclaimed handle that the contact graph can
      resolve to a number; records `suppressed` until Twilio is configured.
      Verified live: adding a pick on an unresolvable handle succeeds with no
      error and attempts no notice.
- [x] Landing "check your @" claim surface DONE 2026-07-21. Mode toggle on
      the landing card; entering your @ routes to /signup?claim=<handle> which
      prefills the handle. Never leaks whether a handle has admirers pre-signup
      (no server call keyed to the handle); truth comes from the post-signup
      escrow backfill. Verified live.
- [x] School + individual standings DONE 2026-07-21 at `/app/leaderboard`
      (positive activity only, never admirer counts). Reached from a trophy in
      the home header.
- [x] Weekly recap card + Sunday send DONE 2026-07-21. Personal recap card on
      home (once per ISO week, dismissable, hidden on an empty week); Sunday
      push fanned out via the weekly-superlative cron to push subscribers with
      activity. Verified live with seeded data. IG-story shareable render NOT
      built (nice-to-have, deferred).
- [x] Cron Triggers DONE 2026-07-21 via a standalone `crush-scheduler` Worker
      (repo `scheduler/`). Registers daily-poll (15:00), match-expiry (hourly),
      weekly-superlative+recap (Sun 17:00). Reaches the app via a SERVICE
      BINDING (env.APP) because two workers.dev workers can't call each other
      publicly (error 1042). Verified live (403 forbidden through the chain).
      USER MUST set the scheduler's CRON_SECRET to match the app:
      `cd scheduler && npx wrangler secret put CRON_SECRET`.
- [x] Durable Object websockets DONE 2026-07-22 as an ADDITIVE poke fast-path
      (standalone `crush-realtime` Worker, DO per room, D1-ticket auth so no
      secret needed, service binding for broadcast). Polling stays as the
      fallback everywhere. Wired into chat, groups, and notifications. Verified
      end to end live (3 pokes -> 3 instant refreshes, DO reported poked:1).
- [ ] Google OAuth still stubbed.
- [x] **UI overhaul (option B) DONE 2026-07-21**: semantic type scale
      (nano..display) adopted across 30 files, surface classes documented,
      hierarchy reworked (matches now outrank the picks stat), motion
      primitives added (.stagger/.stagger-tight/.lift/.skeleton/useCountUp)
      with a correct reduced-motion path. Candy identity preserved.
      Reference the user gave for the bar: Hinge.
- [x] Motion completeness pass DONE 2026-07-21: all animate-pulse loaders
      replaced with the .skeleton shimmer (LandingTicker's live dot kept);
      matches/messages/notifications/settings/shop lists now stagger in.
      Verified entrance animations do NOT replay across polling cycles.
- [x] Polls page chrome aligned to the design system 2026-07-22 (lowercase
      voice, btn-pop buttons, shimmer skeletons, gradient FAB). The immersive
      snap-scroll interaction was KEPT deliberately — it is a good pattern, not
      a bug; only the off-brand chrome changed.
- [x] Weekly recap IG-story shareable render DONE 2026-07-22 (canvas 1080x1920,
      Web Share API + download fallback, share button on the recap card).

### Blocked on the user
- **Stripe**: user asked to wire the live `rk_live_` restricted key (recovered
  from the claude-logs archive; only a placeholder `rk_test_xxxx` exists there).
  Setting the secret is BLOCKED by the permission classifier — user must run
  `npx wrangler secret put STRIPE_LIVE_API_KEY --name crush-connect` themselves.
  DO NOT set PAYMENTS_LIVE_ENABLED=1 until PAYMENTS_LIVE_WEBHOOK_SECRET (whsec_)
  also exists, or charges succeed but grant nothing (webhook verify fails).
  Products are hardcoded available:false in payments.functions.ts regardless.
  User said they will rotate the key later.
- **Twilio**: account + A2P 10DLC registration (1-2 week lead time).
- **HIKER_API_KEY should be rotated** (it was pasted into a chat transcript).

## Features (Phase B, after port) — user-approved list

> SUPERSEDED 2026-07-21: this was the original planning list. Its status is now
> tracked in "RESUME HERE" above, which is authoritative. As of 2026-07-21 the
> buildable items below are DONE: contact graph, push delivery, moderation,
> standings, weekly recap, landing "check your @", escrow outreach wiring, cron
> triggers, and the UI overhaul + motion pass. What remains is user-blocked
> (Stripe/Twilio/OAuth/domain/secrets) or a deliberate deferral (Durable Object
> websockets, polls-page redesign, IG-story shareable recap render). The list is
> kept below only for the original detail/rationale.

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
