import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lightbulb, X } from "lucide-react";
import { toast } from "sonner";
import { submitPendingQuestion } from "@/lib/polls.functions";

export function SuggestQuestionButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = useServerFn(submitPendingQuestion);

  async function send() {
    const t = text.trim();
    if (t.length < 5) {
      toast.error("Make it a bit longer");
      return;
    }
    setBusy(true);
    const r = await submit({ data: { text: t } });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Thanks! We'll review it.");
    setText("");
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-5 z-30 h-10 pl-3 pr-4 rounded-full bg-card border-2 border-foreground font-bold text-xs flex items-center gap-1.5 tap-scale"
      >
        <Lightbulb className="size-4" /> Suggest question
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-card border-2 border-foreground rounded-3xl p-5 shadow-pop"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-black text-lg">Suggest a poll question</p>
              <button onClick={() => setOpen(false)} className="size-8 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center">
                <X className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Keep it fun, kind, and about a vibe — not a person. We review every submission.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={120}
              rows={3}
              placeholder='e.g. "Most likely to start a band that actually slaps"'
              className="w-full bg-secondary border-2 border-foreground rounded-2xl p-3 text-sm outline-none resize-none"
            />
            <div className="flex justify-between items-center mt-1">
              <span className="text-[10px] text-muted-foreground">{text.length}/120 · 3/day max</span>
            </div>
            <button
              onClick={send}
              disabled={busy}
              className="btn-pop w-full mt-3 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Submit for review"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
