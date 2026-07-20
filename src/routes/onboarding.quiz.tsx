import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Heart, Sparkles, Check } from "lucide-react";
import { MobileShell, ScreenHeader } from "@/components/MobileShell";
import { useSession } from "@/lib/store";
import { getMyQuiz, saveMyQuiz, type QuizAnswers } from "@/lib/quiz.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding/quiz")({
  head: () => ({ meta: [{ title: "your vibe · crush" }] }),
  component: QuizPage,
});

type QuizStep = {
  key: keyof QuizAnswers;
  q: string;
  hint: string;
  options: { emoji: string; label: string; value: string }[];
};

const QUIZ_STEPS: QuizStep[] = [
  { key: "vibe", q: "what's your vibe?", hint: "pick the one closest to you.", options: [
    { emoji: "🌊", label: "chill", value: "chill" },
    { emoji: "🔥", label: "chaotic", value: "chaotic" },
    { emoji: "💌", label: "romantic", value: "romantic" },
    { emoji: "🌙", label: "mysterious", value: "mysterious" },
  ]},
  { key: "sleep", q: "when are you most awake?", hint: "be honest.", options: [
    { emoji: "🌅", label: "early bird", value: "early" },
    { emoji: "🦉", label: "night owl", value: "night" },
    { emoji: "🌀", label: "chaos sleeper", value: "chaos" },
    { emoji: "🤷", label: "depends", value: "depends" },
  ]},
  { key: "texting", q: "your texting style?", hint: "future matches will know.", options: [
    { emoji: "⚡", label: "instant reply", value: "instant" },
    { emoji: "🐢", label: "slow burn", value: "slow" },
    { emoji: "🎙️", label: "voice notes", value: "voice" },
    { emoji: "😂", label: "memes only", value: "memes" },
  ]},
  { key: "weekend", q: "ideal weekend?", hint: "", options: [
    { emoji: "🎉", label: "party", value: "party" },
    { emoji: "🛋️", label: "cozy in", value: "cozy" },
    { emoji: "🏞️", label: "adventure", value: "adventure" },
    { emoji: "😶‍🌫️", label: "no plans", value: "noplans" },
  ]},
  { key: "flag", q: "biggest green flag?", hint: "in a person.", options: [
    { emoji: "🤣", label: "makes me laugh", value: "funny" },
    { emoji: "🧠", label: "actually listens", value: "listens" },
    { emoji: "🎁", label: "remembers details", value: "remembers" },
    { emoji: "🛟", label: "shows up", value: "shows_up" },
  ]},
];

function QuizPage() {
  const nav = useNavigate();
  const { session, loading } = useSession();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);

  useEffect(() => {
    if (!session) return;
    getMyQuiz().then((r) => { if (r.answers) setAnswers(r.answers); }).catch(() => {});
  }, [session]);

  const step = QUIZ_STEPS[idx];
  const isLast = idx === QUIZ_STEPS.length - 1;
  const current = answers[step.key] ?? null;

  function pick(value: string) {
    setAnswers((a) => ({ ...a, [step.key]: value }));
  }

  async function finish() {
    setBusy(true);
    try {
      await saveMyQuiz({ data: answers }).catch(() => {});
      toast.success("you're in ✨");
    } finally {
      setBusy(false);
      nav({ to: "/app" });
    }
  }

  async function next() {
    if (!isLast) { setIdx((i) => i + 1); return; }
    await finish();
  }

  function skip() {
    nav({ to: "/app" });
  }

  return (
    <MobileShell>
      <ScreenHeader
        title="your vibe"
        subtitle={`${idx + 1} of ${QUIZ_STEPS.length} · skip anytime`}
        back={
          idx > 0 ? (
            <button onClick={() => setIdx(idx - 1)} className="icon-btn -ml-1" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
          ) : undefined
        }
      />

      <div className="px-5 mt-1">
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary"
            style={{
              width: `${((idx + (current ? 1 : 0)) / QUIZ_STEPS.length) * 100}%`,
              transition: "width var(--motion-slow) var(--ease-spring)",
            }}
          />
        </div>
      </div>

      {/* Step transition: re-mount on idx change so the next prompt fades/rises in. */}
      <section key={step.key} className="px-5 mt-6 flex-1 animate-step-in">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border text-xs font-semibold">
          <Sparkles className="size-3.5" /> for icebreakers + polls
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight">{step.q}</h2>
        {step.hint && <p className="text-sm text-muted-foreground mt-1">{step.hint}</p>}

        <div className="mt-5 grid grid-cols-2 gap-3">
          {step.options.map((o) => {
            const selected = current === o.value;
            return (
              <button
                key={o.value}
                onClick={() => pick(o.value)}
                aria-pressed={selected}
                className={`relative aspect-square rounded-3xl flex flex-col items-center justify-center gap-2 p-3 tap-scale ${
                  selected ? "bg-primary text-primary-foreground shadow-pop -translate-y-0.5" : "bg-card hover:-translate-y-0.5"
                }`}
                style={{ transition: "transform var(--motion-med) var(--ease-spring), background-color var(--motion-fast) var(--ease-out), box-shadow var(--motion-med) var(--ease-out)" }}
              >
                <span
                  className="text-4xl"
                  style={{
                    transform: selected ? "scale(1.08) translateY(-2px)" : "scale(1)",
                    transition: "transform var(--motion-med) var(--ease-spring)",
                  }}
                >
                  {o.emoji}
                </span>
                <span className="font-semibold text-sm text-center">{o.label}</span>
                {selected && (
                  <span
                    aria-hidden
                    className="absolute top-2 right-2 size-6 rounded-full bg-primary-foreground text-primary flex items-center justify-center animate-check-pop"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <div className="px-5 mt-6 mb-6 space-y-2">
        <button
          onClick={next}
          disabled={!current || busy}
          className="btn-pop w-full text-lg disabled:opacity-50 disabled:shadow-none disabled:translate-y-0"
        >
          <Heart className="size-5 mr-2" fill="currentColor" />
          {busy ? "saving…" : isLast ? "done" : "next"}
        </button>
        <button
          onClick={skip}
          disabled={busy}
          className="w-full text-sm font-semibold text-muted-foreground py-2 tap-scale disabled:opacity-50"
        >
          skip for now
        </button>
      </div>
    </MobileShell>
  );
}
