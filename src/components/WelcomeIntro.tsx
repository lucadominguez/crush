import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { MutualGlyph } from "./MutualGlyph";

// One-time (per mount) type-on welcome sequence. Lives inline inside the
// landing hero — not a route, not a wizard, not a signup gate. Plays on
// every unauthenticated entry to "/". Skippable via button/keyboard/tap.
// Announces complete phrases to screen readers, never character-by-character.
// prefers-reduced-motion resolves immediately. Search remains usable
// throughout the animation.

// Wording and capitalization are authoritative — do not alter.
const LINES = [
  "Welcome to Crush",
  "Type the instagram profile of a person you have a crush on",
  "and if they like you back we'll connect you",
];

const CHAR_MS = 26;
const LINE_PAUSE_MS = 520; // perceptible pause between complete lines
const END_HOLD_MS = 700;

export function WelcomeIntro({ onDone }: { onDone: () => void }) {
  const [typed, setTyped] = useState<string[]>(["", "", ""]);
  const [activeLine, setActiveLine] = useState(0);
  const [complete, setComplete] = useState(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const doneRef = useRef(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }, []);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    // intentionally no session/local storage: the intro must play on every
    // unauthenticated entry to "/".
    setTyped(LINES.slice());
    setActiveLine(LINES.length - 1);
    setComplete(true);
    // brief settle so the mutual-glyph transition can play, unless reduced
    const hold = reduced.current ? 0 : 260;
    const t = setTimeout(() => onDone(), hold);
    timers.current.push(t);
  }

  useEffect(() => {
    if (reduced.current) {
      finish();
      return;
    }

    // Schedule the whole sequence with explicit accumulated delays so the
    // between-line pauses are guaranteed regardless of setTimeout batching.
    let cancelled = false;
    let delay = 260;

    LINES.forEach((line, li) => {
      for (let i = 1; i <= line.length; i++) {
        const target = i;
        const t = setTimeout(() => {
          if (cancelled) return;
          setActiveLine(li);
          setTyped((prev) => {
            const next = prev.slice();
            next[li] = line.slice(0, target);
            return next;
          });
        }, delay);
        timers.current.push(t);
        delay += CHAR_MS;
      }
      // pause between lines
      if (li < LINES.length - 1) delay += LINE_PAUSE_MS;
    });

    const endT = setTimeout(finish, delay + END_HOLD_MS);
    timers.current.push(endT);

    return () => {
      cancelled = true;
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" || e.key === "Escape" || e.key === " ") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        finish();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative"
      style={{ minHeight: "clamp(240px, 36vh, 360px)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="text-primary"><MutualGlyph size={18} /></span>
          intro
        </span>
        <button
          type="button"
          onClick={finish}
          className="inline-flex items-center gap-1 text-caption font-semibold text-muted-foreground hover:text-foreground min-h-11 px-3 -mr-2"
          aria-label="Skip intro"
        >
          skip <ArrowRight className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {LINES.slice(0, activeLine + 1).join(". ")}
      </div>

      <div
        onClick={finish}
        role="button"
        tabIndex={-1}
        aria-hidden="true"
        className="cursor-pointer select-none space-y-3 leading-tight"
      >
        {LINES.map((line, i) => {
          const isActive = i === activeLine && !complete;
          const isDone = i < activeLine || complete || typed[i] === line;
          const base =
            i === 0
              ? "font-black tracking-tight text-3xl sm:text-4xl"
              : "text-lead sm:text-base font-semibold text-foreground/80";
          return (
            <p
              key={i}
              className={`${base} transition-opacity`}
              style={{ opacity: typed[i] || isActive ? 1 : 0.35 }}
            >
              <span className={isActive && !isDone ? "caret-blink" : ""}>
                {typed[i]}
              </span>
            </p>
          );
        })}
      </div>

      <div
        className={`mt-5 inline-flex items-center gap-2 text-primary transition-opacity duration-300 ${
          complete ? "opacity-100" : "opacity-60"
        }`}
        aria-hidden="true"
      >
        <MutualGlyph size={44} />
        <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          only if it's mutual
        </span>
      </div>
    </div>
  );
}

// Kept as an exported no-op so existing call sites don't break. The intro
// is now driven purely by mount lifecycle in the landing route; this always
// returns true for unauthenticated visitors and the intro's own onDone
// controls the handoff to the resolved hero.
export function shouldShowIntro(): boolean {
  return true;
}
