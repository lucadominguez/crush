import { BellOff, Info } from "lucide-react";

/**
 * Truthful capability card.
 *
 * There is no service worker, PushManager subscription, push_subscriptions
 * table, delivery worker, or configured native push channel (VAPID/APNs/FCM)
 * in this build. Requesting Notification permission or writing
 * profiles.push_enabled = true would be a lie: nothing can actually deliver
 * a remote push. Until a real subscription pipeline lands, this component
 * fails closed: no permission prompt, no server write, no local test toast
 * pretending to be a push.
 *
 * In-app notifications (the bell + realtime feed) still work — that channel
 * is independent and honest about what it is.
 */
export function PushNotifToggle() {
  return (
    <div
      className="card-pop p-4 flex items-center gap-3 w-full"
      role="group"
      aria-label="Push notifications status"
    >
      <div
        className="size-10 rounded-xl grid place-items-center shrink-0"
        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
      >
        <BellOff className="size-5" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="font-bold text-[14px] lowercase">push notifications</p>
        <p className="text-[12px] text-muted-foreground leading-snug">
          not available yet — in-app alerts still work in the bell.
        </p>
      </div>
      <Info className="size-4 text-muted-foreground shrink-0" aria-hidden />
    </div>
  );
}
