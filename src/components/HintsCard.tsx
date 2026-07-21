import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, Lock, Sparkles, Gift } from "lucide-react";
import { toast } from "sonner";
import {
  getMyHintEligibility,
  revealHint,
  listMyHints,
} from "@/lib/phase5.functions";

type Hint = { hint_index: number; hint_text: string };

// First hint is FREE after the user picks any crush.
// Hints 2 & 3 unlock once all slots are filled.
export function HintsCard({ targetHandle }: { targetHandle: string }) {
  const fetchElig = useServerFn(getMyHintEligibility);
  const fetchList = useServerFn(listMyHints);
  const reveal = useServerFn(revealHint);
  const [elig, setElig] = useState<{ eligible: boolean; fullyEligible: boolean; slotsFilled: number; slots: number } | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchElig(),
      fetchList({ data: { targetHandle } }),
    ]).then(([e, l]) => {
      if (cancelled) return;
      setElig({
        eligible: e.eligible,
        fullyEligible: e.fullyEligible,
        slotsFilled: e.slotsFilled,
        slots: e.slots,
      });
      setHints((l.hints ?? []) as Hint[]);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchElig, fetchList, targetHandle]);

  async function onReveal() {
    setBusy(true);
    const r = await reveal({ data: { targetHandle } });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setHints(r.hints as Hint[]);
  }

  if (!elig) return null;

  if (!elig.eligible) {
    return (
      <div className="card-pop p-4 bg-secondary">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <p className="text-sm font-bold">pick a crush to unlock your first hint</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          hints give context, never identity.
        </p>
      </div>
    );
  }

  const exhausted = hints.length >= 3;
  const nextRequiresFull = hints.length >= 1 && !elig.fullyEligible;
  const slotsLeft = Math.max(0, elig.slots - elig.slotsFilled);

  return (
    <div className="card-pop p-4 bg-gradient-to-br from-citrus to-primary">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4" />
          <p className="text-xs font-black uppercase tracking-wider">
            hints about @{targetHandle}
          </p>
        </div>
        {hints.length === 0 && (
          <span className="inline-flex items-center gap-1 text-nano font-black uppercase tracking-wider bg-foreground text-background px-2 py-0.5 rounded-full">
            <Gift className="size-3" /> 1 free
          </span>
        )}
      </div>
      <ul className="space-y-2 mb-3">
        {hints.map((h) => (
          <li key={h.hint_index} className="text-sm font-medium leading-snug">
            <span className="inline-flex items-center justify-center size-5 rounded-full bg-foreground text-background text-nano font-black mr-1.5">
              {h.hint_index + 1}
            </span>
            {h.hint_text}
          </li>
        ))}
        {!hints.length && (
          <li className="text-sm opacity-80">no hints yet. tap below for your free first hint.</li>
        )}
      </ul>
      {!exhausted && !nextRequiresFull && (
        <button
          onClick={onReveal}
          disabled={busy}
          className="w-full px-4 py-2.5 rounded-xl bg-foreground text-background font-black text-sm tap-scale inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Sparkles className="size-4" />
          {busy ? "revealing…" : hints.length === 0 ? "reveal free hint" : `reveal hint ${hints.length + 1} / 3`}
        </button>
      )}
      {!exhausted && nextRequiresFull && (
        <div className="rounded-xl bg-background/40 border-2 border-foreground/10 p-3 text-center">
          <Lock className="size-4 mx-auto mb-1" />
          <p className="text-xs font-bold leading-snug">
            pick {slotsLeft} more to unlock hint {hints.length + 1}/3
          </p>
        </div>
      )}
      {exhausted && (
        <p className="text-xs font-bold opacity-90 text-center">all 3 hints used. the rest is up to you 💛</p>
      )}
    </div>
  );
}
