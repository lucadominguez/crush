import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  deletePushSubscription,
  getPushConfig,
  savePushSubscription,
  sendTestPush,
} from "@/lib/push.functions";

function b64uToUint8(base64: string): Uint8Array {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const raw = atob(padded + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type State = "loading" | "unsupported" | "blocked" | "off" | "on";

/**
 * Real push subscription toggle.
 *
 * Fails closed and stays truthful: if the browser cannot do push, or the server
 * has no VAPID keys, it says so rather than flipping a switch that delivers
 * nothing. Turning it on registers the service worker, subscribes with the
 * server's VAPID key, and stores the subscription.
 */
export function PushNotifToggle() {
  const fetchConfig = useServerFn(getPushConfig);
  const save = useServerFn(savePushSubscription);
  const remove = useServerFn(deletePushSubscription);
  const test = useServerFn(sendTestPush);

  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supported) { setState("unsupported"); return; }
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.vapidPublicKey) { setState("unsupported"); return; }
        setVapidKey(cfg.vapidPublicKey);

        if (Notification.permission === "denied") { setState("blocked"); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(existing ? "on" : "off");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => { cancelled = true; };
  }, [fetchConfig, supported]);

  const enable = useCallback(async () => {
    if (!vapidKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64uToUint8(vapidKey) as BufferSource,
        }));

      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      const p256dh = json.keys?.p256dh ?? bufToB64u(sub.getKey("p256dh"));
      const auth = json.keys?.auth ?? bufToB64u(sub.getKey("auth"));
      if (!p256dh || !auth) { toast.error("Couldn't set up notifications"); return; }

      await save({ data: { endpoint: sub.endpoint, p256dh, auth } });
      setState("on");

      // Prove the whole pipeline works rather than claiming success on a
      // successful database write.
      const r = await test().catch(() => ({ ok: false, delivered: 0 }));
      if (!r.ok) toast("Notifications are on. We couldn't deliver a test one just now.");
    } catch {
      toast.error("Couldn't turn on notifications");
    } finally {
      setBusy(false);
    }
  }, [vapidKey, save, test]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await remove({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch {
      toast.error("Couldn't turn off notifications");
    } finally {
      setBusy(false);
    }
  }, [remove]);

  const copy: Record<State, string> = {
    loading: "checking…",
    unsupported: "not available on this device. in-app alerts still work in the bell.",
    blocked: "blocked in your browser settings. allow notifications for this site to turn them on.",
    off: "get told the moment someone picks you back.",
    on: "you'll get a nudge for mutuals, messages and picks.",
  };

  const active = state === "on";
  const canToggle = state === "on" || state === "off";

  return (
    <div className="card-pop p-4 flex items-center gap-3 w-full" role="group" aria-label="Push notifications">
      <div
        className="size-10 rounded-xl grid place-items-center shrink-0"
        style={
          active
            ? { background: "var(--gradient-primary)", color: "var(--primary-foreground)" }
            : { background: "var(--muted)", color: "var(--muted-foreground)" }
        }
      >
        {active ? <Bell className="size-5" /> : <BellOff className="size-5" />}
      </div>

      <div className="flex-1 text-left min-w-0">
        <p className="font-bold text-[14px] lowercase">push notifications</p>
        <p className="text-[12px] text-muted-foreground leading-snug">{copy[state]}</p>
      </div>

      {canToggle && (
        <button
          onClick={active ? disable : enable}
          disabled={busy}
          aria-pressed={active}
          className={active ? "chip shrink-0 min-h-11 px-3" : "btn-pop shrink-0 min-h-11 px-4"}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : active ? "on" : "turn on"}
        </button>
      )}
    </div>
  );
}
