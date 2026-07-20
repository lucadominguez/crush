
This is a large multi-week scope. To execute it well (not simplified, not rushed) I'm grouping it into 6 phases. Each phase is shippable on its own, builds on the last, and ends in a state where the app still works end-to-end. I'll execute phase-by-phase, asking for confirmation between phases so we can adjust based on what we see live.

## Phase 1 — Foundation: schema, scarcity, and the "someone picked you" loop
The core mechanic that everything else hangs on. No payments yet.

- DB: add `crush_slots` (default 3), `god_mode_expires_at`, `streak_count`, `streak_last_open`, `referral_code`, `referred_by`, `phone_e164` to `profiles`. Add `notifications` table (type, payload, read_at). Add `admirer_counts` view (incoming crushes by user). Add `quiz_answers` table.
- Crush slots enforced server-side (3 max, drop-to-add UX on 4th).
- "Someone added you" trigger: when a new crush is inserted targeting a registered user, write a notification row. Surface as a banner on `/app` ("Someone just added you 👀 Add 3 to find out if it's mutual").
- Ambient social proof on Crushes tab: "X people at your school joined this week", "Y added crushes today" via a `school_stats` server function.
- Daily streak counter (light, top-right of `/app`).
- Move IG bio-code verification UI from signup to settings only (it already lives there; remove from signup flow).

## Phase 2 — Pre-signup commitment & onboarding
- Landing page: let users type an @ and see a blurred reveal preview ("they'd only know if they pick you back") before hitting signup wall.
- Add `/onboarding/quiz` route: 5 tappable cards (vibe, sleep, texting style, weekend energy, red/green flag). Stored in `quiz_answers`. Used later by Polls and icebreakers.
- Optional phone-contact import step (uses Capacitor `@capacitor/contacts` on native, manual paste on web). Hash phone numbers, match against `profiles.phone_e164`. One-sentence privacy explainer.
- Referral code generation on signup + `?ref=` capture.

## Phase 3 — The reveal & messaging upgrade
- Cinematic match reveal: full-screen, haptic (Capacitor Haptics), confetti, sound, "you both picked each other on [date]", explicit screenshot-friendly layout with identity-hidden share variant.
- Icebreaker chips in chat header (3 generated from shared quiz answers, e.g. "you both said night owl").
- Match expiry: matches with zero messages auto-archive after 7 days. Countdown badge on match card.
- Read receipts: off by default. Toggle hidden behind God Mode in Phase 6.

## Phase 4 — Polls as the viral surface
- Daily auto-generated poll per school (cron via `/api/public/cron/daily-poll` + pg_cron). Curated question pool seeded in DB; question rotates daily.
- Candidates: 4 random people from voter's network.
- Result screen: "You were picked 'X' by N people today" + blurred voter list (unblur is a Phase 6 paywall).
- Shareable Story card: branded canvas-rendered PNG ("I was voted 'most likely to start a cult' 😭"), download/share via Web Share API + Capacitor Share.
- Moderation: questions go through a curated pool; user-submitted go to a `pending_questions` table for review.

## Phase 5 — Virality loops
- SMS invite ("send a crush to someone not on the app yet") — requires Twilio connector. Rate-limited to 5/day/user, requires explicit per-recipient send action.
- Referral unlocks: 3 invites = +1 crush slot, 5 invites = 1 free hint. Tracked via `referrals` table.
- Hints system: only unlocks after user has filled all 3 slots with zero matches. Hints surface network context (school, mutuals, tenure) — never identity. Final hint always nudges to "add 5 more from [school/group]".
- "Crush of the week" anonymous superlative on Sunday (cron).

## Phase 6 — Monetization (Lovable Payments)
- Provider check via `recommend_payment_provider`, then enable. Given digital + teen audience + subscriptions + microtransactions, Paddle is the likely fit (lower friction, MoR handles tax). I'll confirm after the eligibility check.
- **God Mode** ($6.99/week subscription): admirer count, poll vote count, free hint #1 per admirer, +2 crush slots, read receipts toggle.
- **Hint packs** (consumables): $1.99 single, $4.99 for 5.
- **Poll reveal**: $1.99 per poll (one per poll cap).
- **Weekend boost**: $2.99 for 48hr surface priority.
- **Match save**: $0.99 to extend an expiring match 7 days.
- Webhook handler in `/api/public/webhooks/paddle` updates entitlements on `profiles`.

## Technical notes (for me, not summarized away)
- All server logic via `createServerFn` + `requireSupabaseAuth`; webhooks/cron via `/api/public/*` routes with signature verification.
- Push notifications use `@capacitor/push-notifications` (already installed); store FCM/APNS tokens in a `push_tokens` table; send via a `notify` server fn.
- Capacitor-specific code wrapped in `Capacitor.isNativePlatform()` checks so web preview still works.
- New migrations are additive; no destructive changes.

---

**My ask:** confirm this phasing, or tell me to reorder. Once confirmed, I'll start Phase 1 with the schema migration and the "someone picked you" loop, since that's the single highest-leverage mechanic and unblocks Phases 4–6.
