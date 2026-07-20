# Backend Outline — Crush100

Complete map of the backend as it exists in this repo, intended for anyone
migrating the app off Lovable. Everything is Postgres + PostgREST + GoTrue
(the Supabase stack). Server logic is TanStack Start (Cloudflare Workers
runtime); there are **no** Supabase Edge Functions.

---

## 1. Runtime & hosting

| Concern | Value |
|---|---|
| App runtime | TanStack Start v1 on Vite 7, deployed as a Cloudflare Worker (`wrangler.jsonc`, `src/server.ts`) |
| Node compat | `nodejs_compat` flag on |
| DB / Auth / Storage / Realtime | Supabase (managed by Lovable Cloud today; standard self-host or hosted Supabase works elsewhere) |
| Payments | Stripe via `connector-gateway.lovable.dev/stripe` in this repo — a plain `api.stripe.com` base works after export (see §7) |
| Client SDK entry | `src/integrations/supabase/client.ts` (auto-generated) |
| Server admin client | `src/integrations/supabase/client.server.ts` (service role) |
| Auth middleware for server fns | `src/integrations/supabase/auth-middleware.ts` |
| Bearer attacher | `src/integrations/supabase/auth-attacher.ts`, registered in `src/start.ts` |

---

## 2. Environment variables

Client (Vite, `import.meta.env`):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Server (`process.env`):
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOVABLE_API_KEY` — only needed for the Lovable Stripe gateway shim; drop when using Stripe directly
- `STRIPE_SANDBOX_API_KEY`, `STRIPE_LIVE_API_KEY`
- `PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `PAYMENTS_LIVE_WEBHOOK_SECRET`
- `PAYMENTS_LIVE_ENABLED` — must be `"1"` and a live key present to switch off sandbox
- `PUBLIC_APP_ORIGIN` (or `PUBLIC_ORIGIN`) — used to build Stripe return URLs
- `CRON_SECRET` (if you re-wire cron via HTTP; current cron calls hit the public hook routes with no shared secret — see §6)

---

## 3. Auth

Supabase Auth. No anonymous sign-ups. `handle_new_user` trigger on
`auth.users` populates `public.profiles` with a sanitized handle, name,
optional school/city from `raw_user_meta_data`.

Google OAuth is expected to be enabled at the provider level. OAuth
`redirect_uri` must be `${window.location.origin}` (or a same-origin
callback), never a protected route directly.

Age gate: `enforce_min_age` trigger on `profiles` rejects `dob` under 13.

---

## 4. Database schema (public)

All tables have RLS enabled. Grants are `authenticated` + `service_role`
unless noted. `anon` has no grants.

### 4.1 profiles
Per-user profile (1:1 with `auth.users`).
Columns of note: `user_id UUID unique`, `handle text unique`,
`instagram_handle text unique nullable`, `instagram_avatar text`,
`instagram_verified_at timestamptz`, `avatar_url`, `name`, `dob date`,
`school text`, `city text`, `phone_e164 text`, `referred_by uuid`,
`referral_code text unique`, `crush_slots int default 3`,
`hint_credits int default 0`, `god_mode_expires_at timestamptz`,
`trust_score int`, `push_enabled bool`, `handle_confirmed_at timestamptz`,
`created_at`, `updated_at`.
Triggers: `handle_new_user` (on `auth.users`), `generate_referral_code`,
`normalize_instagram_handle`, `enforce_min_age`, `handle_referral_on_profile`,
`trg_refresh_trust_on_profile` (BEFORE UPDATE sets `trust_score`).
Policies: SELECT to authenticated (all rows); INSERT/UPDATE own row only.

### 4.2 crushes
`(owner_id, target_handle)` unique. Handle is normalized lower/no-@.
Triggers: `check_match_on_crush` (creates a mutual match row when the
other side has already picked us), `notify_target_on_crush`,
`enforce_crush_slot_limit`, `trg_refresh_trust_on_crush`.
Policies: owner SELECT/INSERT/DELETE own.

### 4.3 matches
`user_a_id`, `user_b_id`, `created_at`, `expires_at` (default now+7d via
`set_match_expiry` trigger), `last_message_at`, `saved bool`,
`expiry_warned_at`. `is_match_participant(match_id, uid)` SECURITY INVOKER
helper is used everywhere for RLS.
Trigger: `trg_refresh_trust_on_match`.
Policies: participants SELECT.

### 4.4 messages
DM messages. Columns: `id`, `match_id`, `from_user_id`, `text`,
`created_at`, `client_id text nullable`.
Unique partial index `messages_client_id_unique(match_id, from_user_id, client_id) WHERE client_id IS NOT NULL` for send idempotency.
Triggers: `touch_match_on_message` (updates `matches.last_message_at`,
clears expiry), `notify_on_message`.
Policies: participants SELECT; INSERT restricted to
`auth.uid()=from_user_id AND is_match_participant`.

### 4.5 group_chats / group_members / group_messages
`group_chats(id, name, emoji, created_by, created_at, last_message_at)`.
`group_members(group_id, user_id, joined_at)` — composite PK.
`group_messages(id, group_id, from_user_id, text, created_at, client_id)`
with the same partial-unique client_id index.
Helper: `is_group_member(group_id, uid)` SECURITY DEFINER.
Triggers: `touch_group_on_message`, `notify_on_group_message`.
Policies (all use `is_group_member`):
- group_chats: members SELECT/UPDATE; INSERT with `created_by=uid`.
- group_members: members SELECT; INSERT allowed for existing members OR
  for the group creator adding initial members.
- group_messages: SELECT/INSERT for members; INSERT also requires
  `from_user_id=uid`.

### 4.6 conversation_reads
Durable per-user read cursor.
`(user_id, kind, conv_id)` PK where `kind IN ('match','group')` and
`last_read_at timestamptz`.
Policies: SELECT/INSERT/UPDATE own row **AND** current participation
in the referenced match or group (predicate matches
`is_match_participant` / `is_group_member`). Written via
`mark_conversation_read(_kind, _conv_id)` RPC.

### 4.7 polls / poll_votes / poll_questions / pending_questions / poll_share_events
- `polls(id, question, option_handles text[], created_by nullable,
  school, question_id nullable, active_date date, created_at)`.
  Unique `(active_date, coalesce(school,''))` for daily; unique
  `(school, question_id, day)` while question_id present.
- `poll_votes(id, poll_id, user_id, voted_handle, created_at)` —
  `(poll_id, user_id)` unique.
  Trigger: `notify_on_poll_vote`.
- `poll_questions(id, text, is_active, created_at)` — question bank.
- `pending_questions(id, user_id, text, ...)` — user-submitted questions.
- `poll_share_events(id, user_id, poll_id, created_at)` — logged share taps.
Policies: authenticated read-only for questions/superlatives; users
insert/view own pending/share rows. `poll_votes` reads are done exclusively
via SECURITY DEFINER RPCs so raw row access isn't required.

### 4.8 notifications
`(id, user_id, type text, payload jsonb, read_at timestamptz, created_at)`.
Indexes on `(user_id, read_at) WHERE read_at IS NULL` and
`(user_id, created_at DESC)`.
Notification `type` values in use:
`match_created`, `message_received`, `group_message_received`,
`poll_voted_for`, `referral_joined`, `crush_received`.
Payloads never contain message text — only IDs/counts.
Policies: users SELECT/UPDATE own; inserts happen from SECURITY DEFINER
triggers only.

### 4.9 referrals / invites
- `referrals(id, referrer_id, referred_user_id unique, created_at)`.
  Awards +1 crush slot per 3 referrals up to slot cap 8 via
  `claim_referral` / `handle_referral_on_profile`.
- `invites(id, sender_id, phone_hash, target_handle, channel, created_at)`.

### 4.10 hints
`(id, user_id, target_handle, hint_index, hint_text, created_at)` with
`(user_id, target_handle, hint_index)` unique. Consumes `hint_credits`
via server function.

### 4.11 weekly_superlatives
`(school, week_start, question_id, ...)` unique per week+question+school.

### 4.12 reports
`(id, reporter_id, reported_user_id, reason, created_at)`.
Trigger: `trg_refresh_trust_on_report`.
Policies: reporter SELECT/INSERT own.

### 4.13 purchases
`(id, user_id, product, amount_cents, metadata jsonb, created_at)`.
Idempotency key is `metadata->>'sessionId'`. Written by
`record_purchase_and_grant` RPC from the Stripe webhook.

---

## 5. Database functions (RPCs) & triggers

All `SECURITY DEFINER` unless noted. All set `search_path = public`. Full
bodies live in `supabase/migrations/`. Function inventory:

**Called from the app (RPCs):**
- `claim_handle(_new_handle text) → jsonb` — validates + normalizes +
  claims a unique handle for the caller.
- `cast_poll_vote(_poll_id uuid, _handle text) → jsonb` — visibility check,
  inserts vote, returns `{ok, own_vote}` on success or
  `{ok:false, error:'already_voted', already:true, own_vote}` on conflict.
- `create_poll(_question text, _handles text[]) → jsonb` — rate limited to
  3 polls / 24h; 2–4 options.
- `create_group_atomic(_name, _emoji, _member_ids uuid[]) → jsonb` — one
  transaction: creates group + members. Caller is auto-included.
- `mark_conversation_read(_kind, _conv_id) → jsonb` — upserts
  `conversation_reads`; requires current participation.
- `latest_match_previews()` / `latest_group_previews()` — return the last
  message row per conv scoped to the caller's participation.
- `get_polls_feed() → jsonb` — visibility-filtered feed with tallies,
  `my_vote`, and safe `option_info` (handle, name, avatar, verified).
- `get_my_incoming_poll_stats() → jsonb` — last 7d polls where the caller
  was an option, aggregated vote counts.
- `claim_referral(_code)`, `repair_missing_referral()` —
  self-serialized under a row lock on `profiles`.
- `has_role`-style checks are **not** used; there is no roles table today.
  Admin-only actions run only from the Stripe webhook via service role.
- `record_purchase_and_grant(_user_id, _product, _amount_cents,
  _session_id, _match_id?) → jsonb` — idempotent by (user_id, sessionId);
  applies one-time grants (`hint_pack_5`, `weekend_boost_one`,
  `match_save_one`). Recurring `god_mode_weekly` is handled directly in
  the webhook via `subscription.*` events, not here.

**Trust score:**
- `calculate_trust_score(uid) → int` (0–100).
- `refresh_trust_score(uid)`; triggers on profile/report/crush/match
  keep it fresh.

**Trigger functions:** `handle_new_user`, `generate_referral_code`,
`normalize_instagram_handle`, `enforce_min_age`, `enforce_crush_slot_limit`,
`check_match_on_crush`, `notify_target_on_crush`, `set_match_expiry`,
`touch_match_on_message`, `touch_group_on_message`, `notify_on_message`,
`notify_on_group_message`, `notify_on_match_created`, `notify_on_poll_vote`,
`notify_on_referral`, `handle_referral_on_profile`, `update_updated_at`,
`trg_refresh_trust_on_*` (crush/match/profile/report).

**Immutable helpers:** `referral_slot_target(_count)`,
`is_match_participant(_match_id, _user_id)`,
`is_group_member(_group_id, _user_id)`.

**Batch generator:** `generate_daily_polls()` — for each school cohort
(≥4 users with handles) picks a random active question and 4 random
handles, inserts one poll per day (unique index prevents dupes).

---

## 6. Scheduled jobs (pg_cron)

All three call public TSS routes on the app URL. No shared secret today
— these routes must remain idempotent or add a `CRON_SECRET` header on
export.

| Job | Schedule (UTC) | Target |
|---|---|---|
| `generate-daily-polls` | `0 13 * * *` | `SELECT public.generate_daily_polls();` (runs entirely in DB) |
| `match-expiry-warner` | `15 * * * *` | POST `/api/public/hooks/match-expiry` |
| `weekly-superlative` | `0 17 * * 0` | POST `/api/public/hooks/weekly-superlative` |

Migrating: recreate with `pg_cron` if available, or run from any
external scheduler that can hit the URLs / call the RPC.

---

## 7. Storage

Single public bucket `avatars` (`storage.buckets`, `public=true`).
Used by `AvatarUpload.tsx`. Object policies are the Supabase defaults for
authenticated upload.

---

## 8. TanStack server functions (client-callable RPC)

Each file exports one or more `createServerFn` handlers. Auth-guarded
functions carry `.middleware([requireSupabaseAuth])` and get an
RLS-scoped `supabase` client, `userId`, and `claims`. Client middleware
`attachSupabaseAuth` (registered in `src/start.ts`) forwards the bearer
token automatically.

### `src/lib/onboarding.functions.ts`
- `getOnboardingStatus` (GET)
- `claimHandle({ handle })` (POST) — wraps `claim_handle` RPC
- `setDob({ dob })` / `setDisplayName({ name })` (POST)
- `completeOnboarding` (POST)

### `src/lib/profile.functions.ts`
- `claimInstagramHandle`, `startInstagramVerification`, `verifyInstagramBio`
- `reportUser({ reportedUserId, reason })`
- `updateProfileNetwork`, `updateProfileDob`
- `setPushEnabled({ enabled })`
- `deleteMyAccount` — cascades via FK / manual cleanup

### `src/lib/match.functions.ts`
- `getMatchIcebreakers({ matchId })`

### `src/lib/polls.functions.ts`
- `getMyIncomingPollStats` — safe-error shape `{results | error}`
- `submitPendingQuestion`, `logPollShare`

### `src/lib/quiz.functions.ts`
- `getMyQuiz`, `saveMyQuiz`

### `src/lib/phase1.functions.ts`
- `listMyNotifications` / `markNotificationsRead`
- `getSchoolStats`, `touchStreak`

### `src/lib/phase5.functions.ts`
- Invites/referrals/hints/crush-of-week:
  `logInvite`, `getMyInviteText`, `claimReferralCode`,
  `repairMissingReferral`, `getReferralStats`,
  `getMyHintEligibility`, `revealHint`, `listMyHints`, `getCrushOfWeek`.

### `src/lib/instagram.functions.ts` (unauthenticated)
- `searchInstagramUsers`, `getInstagramProfile` — public read-only search
  helpers. Never write to DB.

### `src/lib/payments.functions.ts`
- `getCatalog` — merges hard-coded capability matrix with live Stripe
  price lookups by `lookup_key`.
- `createCheckoutSession({ priceId, returnTo, metaMatchId? })` — creates
  an embedded-checkout session; return URL built from
  `PUBLIC_APP_ORIGIN`.
- `getMyEntitlements` — reads profile + recent purchases.
- `createBillingPortalSession` — intentionally returns
  `{error:'unavailable'}`.

Server-only helpers: `src/lib/stripe.server.ts` (`createStripeClient`,
`verifyWebhook` — HMAC-SHA256 signature check with 5-minute tolerance,
timing-safe compare). To leave the Lovable gateway, drop the fetch
override so requests go direct to `https://api.stripe.com`.

---

## 9. Public HTTP routes (`src/routes/api/...`)

All under `src/routes/api.*.ts`. `api.public.*` bypasses the published-site
auth wall.

| Path | Purpose | Notes |
|---|---|---|
| `POST /api/public/payments/webhook?env=sandbox\|live` | Stripe webhook | Verifies signature, checks `livemode`, routes `checkout.session.completed` → `record_purchase_and_grant`, and `customer.subscription.*` → god-mode expiry management. Returns 400 to force Stripe retry on failure (RPC is idempotent). |
| `POST /api/public/hooks/daily-poll` | Legacy hook that calls `generate_daily_polls()` — pg_cron now calls the RPC directly, but the route remains. |
| `POST /api/public/hooks/match-expiry` | Sends 24h-before expiry notifications and cleans expired matches. Called hourly. |
| `POST /api/public/hooks/weekly-superlative` | Weekly superlative rollup. |
| `GET  /api/ig-avatar` | Proxies an Instagram avatar (image cache) — no PII returned. |

---

## 10. Realtime

Channels used by the client (via `supabase.channel(...)`):
- DM per-match: `postgres_changes` on `public.messages` filtered by
  `match_id`.
- Group per-group: `postgres_changes` on `public.group_messages` filtered
  by `group_id`.
- Notifications: `postgres_changes` on `public.notifications` filtered by
  `user_id`.

Reconciliation is done through the `reconcileServerRow` helper in
`src/lib/store.ts` and `src/lib/groups.ts`, matching by real `id` OR
`client_id` so realtime-before-response cannot delete an in-flight send.

---

## 11. Export checklist

1. Provision Postgres (Supabase or plain PG with `pgcrypto`, `pg_cron`,
   `pg_net` extensions).
2. Run every file under `supabase/migrations/` in order.
3. Enable Supabase Auth (or swap for another JWT provider that populates
   `auth.uid()` — every RLS policy depends on it).
4. Create the `avatars` storage bucket (public).
5. Re-create the three cron jobs from §6.
6. Set the env vars in §2. Point Stripe env off the Lovable gateway.
7. Deploy the TanStack Start app anywhere that runs a Cloudflare
   Worker–style handler (Cloudflare Workers, Netlify Edge, Vercel Edge,
   or Node adapter — remove `wrangler.jsonc` accordingly).
8. Update the Stripe webhook endpoint to your new host.

