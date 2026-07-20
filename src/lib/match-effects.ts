// Client-only effects for the match reveal.
// Restrained by default; respects prefers-reduced-motion and never
// includes the other user's identity in shared payloads.
import confetti from "canvas-confetti";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export async function celebrateMatch() {
  const reduced = prefersReducedMotion();

  // Haptics: single tap on native, single short vibration on web. Skip when reduced.
  if (!reduced) {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(30);
      }
    } catch {
      /* ignore */
    }
  }

  if (reduced) return;

  // Single restrained burst — brand palette, moderate spread.
  const colors = ["#FFD93D", "#FF6F91", "#9B5DE5", "#00C2A8"];
  confetti({
    particleCount: 40,
    spread: 55,
    startVelocity: 32,
    ticks: 120,
    origin: { y: 0.55 },
    colors,
    disableForReducedMotion: true,
  });
}

// Privacy-first: never include the other user's name, handle, avatar, school,
// or the match date in shared payloads. There is no consent mechanism yet.
export async function shareMatch() {
  const text = "it's a mutual on crush 💛";
  const url = typeof window !== "undefined" ? window.location.origin : "https://crush.app";
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      try {
        await Share.share({ title: "it's a mutual", text, url });
        return { ok: true as const };
      } catch {
        return { ok: false as const, cancelled: true };
      }
    }
  } catch {
    /* fall through */
  }
  if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "it's a mutual", text, url });
      return { ok: true as const };
    } catch {
      // AbortError (cancel) or unsupported — treat as silent cancel.
      return { ok: false as const, cancelled: true };
    }
  }
  try {
    await navigator.clipboard?.writeText(`${text} ${url}`);
    return { ok: true as const, copied: true };
  } catch {
    return { ok: false as const, cancelled: false };
  }
}
