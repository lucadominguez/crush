import { useEffect, useRef, useState } from "react";

/**
 * Animate a number toward its target.
 *
 * Driven by rAF rather than a CSS transition because the value is text, and
 * eased with the same curve as the CSS motion tokens so numbers feel like they
 * belong to the rest of the motion system.
 *
 * Respects prefers-reduced-motion by snapping straight to the target, and
 * skips the very first paint when the value is already final (so a returning
 * user does not watch their counter roll up on every navigation).
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(target);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  const firstRun = useRef(true);

  useEffect(() => {
    // First mount: show the real number immediately. Counting up from zero on
    // load makes the whole screen feel slower than it is.
    if (firstRun.current) {
      firstRun.current = false;
      fromRef.current = target;
      setValue(target);
      return;
    }

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || durationMs <= 0) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // cubic ease-out, matching --ease-out in spirit
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + delta * eased);
      setValue(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Leave the counter wherever it stopped so an interrupted run animates
      // onward from there instead of jumping back.
      fromRef.current = value;
    };
    // `value` is deliberately not a dependency: including it would restart the
    // animation on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
