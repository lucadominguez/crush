// Anonymous crush-notice outreach.
//
// Guardrails are v1 scope, not polish (see OUTSTANDING.md). Every send passes
// through sendCrushNotice(), which enforces all of them in one place:
//   - global opt-out list, honored forever
//   - one notice per target until they respond, plus at most one reminder
//   - never reveals who picked them, and never says how many people did
//   - no Instagram DMs, ever (bot-ban treadmill)
//
// The sender is pluggable. With no Twilio credentials configured every send is
// recorded as `suppressed` rather than failing, so the whole loop is testable
// and the product behaves correctly before A2P registration completes.

import { decryptPhone } from "./contacts";
import { getSecret, type D1Database } from "./bindings";
import { uuid } from "./rows";

export type SendResult = { status: "sent" | "suppressed" | "failed"; detail?: string };

export interface SmsSender {
  readonly name: string;
  send(toE164: string, body: string): Promise<SendResult>;
}

/** Records intent without delivering. Used until Twilio is configured. */
const suppressedSender: SmsSender = {
  name: "suppressed",
  async send() {
    return { status: "suppressed", detail: "no sms provider configured" };
  },
};

function twilioSender(sid: string, token: string, from: string): SmsSender {
  return {
    name: "twilio",
    async send(toE164, body) {
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: toE164, From: from, Body: body }),
        });
        if (res.ok) return { status: "sent" };
        const detail = await res.text().catch(() => "");
        return { status: "failed", detail: `${res.status}: ${detail.slice(0, 200)}` };
      } catch (err) {
        return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Twilio when fully configured, otherwise a recorder that delivers nothing. */
export function getSender(): SmsSender {
  const sid = getSecret("TWILIO_ACCOUNT_SID");
  const token = getSecret("TWILIO_AUTH_TOKEN");
  const from = getSecret("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return suppressedSender;
  return twilioSender(sid, token, from);
}

const MAX_NOTICES = 2; // the initial notice plus one reminder, forever

/**
 * Send (or record) one anonymous notice to a person who was picked.
 *
 * Returns the recorded status. Never throws and never reveals the sender.
 */
export async function sendCrushNotice(
  db: D1Database,
  opts: { senderId: string; phoneHash: string; targetHandle?: string | null; appOrigin: string },
): Promise<SendResult> {
  const { senderId, phoneHash, targetHandle, appOrigin } = opts;

  const optedOut = await db
    .prepare("SELECT 1 AS ok FROM outreach_optouts WHERE phone_hash = ? LIMIT 1")
    .bind(phoneHash)
    .first<{ ok: number }>();
  if (optedOut) return record(db, senderId, phoneHash, targetHandle, "suppressed", "opted out");

  // Frequency cap counts every prior notice to this person from ANYONE. A
  // popular target must not receive one message per admirer.
  const priorRow = await db
    .prepare("SELECT COUNT(*) AS n FROM outreach_sends WHERE phone_hash = ? AND status IN ('sent','suppressed')")
    .bind(phoneHash)
    .first<{ n: number }>();
  if ((priorRow?.n ?? 0) >= MAX_NOTICES) {
    return record(db, senderId, phoneHash, targetHandle, "suppressed", "frequency cap reached");
  }

  // If they already joined, the in-app escrow backfill tells them instead.
  const joined = await db
    .prepare("SELECT user_id FROM person_nodes WHERE phone_hash = ? AND user_id IS NOT NULL LIMIT 1")
    .bind(phoneHash)
    .first<{ user_id: string }>();
  if (joined) return record(db, senderId, phoneHash, targetHandle, "suppressed", "already a user");

  const encRow = await db
    .prepare("SELECT phone_enc FROM contact_edges WHERE phone_hash = ? AND phone_enc IS NOT NULL LIMIT 1")
    .bind(phoneHash)
    .first<{ phone_enc: string }>();
  if (!encRow) return record(db, senderId, phoneHash, targetHandle, "failed", "no deliverable number");

  const toE164 = await decryptPhone(encRow.phone_enc);
  if (!toE164) return record(db, senderId, phoneHash, targetHandle, "failed", "could not decrypt number");

  // Deliberately says nothing about who picked them or how many people did.
  const body =
    `someone picked you on crush. you only ever find out who if you pick them back. ` +
    `see who's waiting: ${appOrigin.replace(/\/+$/, "")}/?c=1\n\nreply STOP to never get these again.`;

  const result = await getSender().send(toE164, body);
  await record(db, senderId, phoneHash, targetHandle, result.status, result.detail);
  return result;
}

async function record(
  db: D1Database,
  senderId: string,
  phoneHash: string,
  targetHandle: string | null | undefined,
  status: SendResult["status"],
  detail?: string,
): Promise<SendResult> {
  await db
    .prepare(
      `INSERT INTO outreach_sends (id, sender_id, phone_hash, target_handle, kind, status, detail)
       VALUES (?, ?, ?, ?, 'crush_notice', ?, ?)`,
    )
    .bind(uuid(), senderId, phoneHash, targetHandle ?? null, status, detail ?? null)
    .run();
  return { status, detail };
}

/**
 * Honor STOP. Permanent and global: an opt-out is never scoped to one sender,
 * because the recipient has no idea who the senders are.
 */
export async function optOut(db: D1Database, phoneHash: string): Promise<void> {
  await db
    .prepare("INSERT INTO outreach_optouts (phone_hash) VALUES (?) ON CONFLICT(phone_hash) DO NOTHING")
    .bind(phoneHash)
    .run();
}
