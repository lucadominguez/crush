import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Heart, Check } from "lucide-react";
import { MutualGlyph } from "@/components/MutualGlyph";
import { MobileShell, ScreenHeader } from "@/components/MobileShell";
import { BrandMark } from "@/components/BrandMark";
import {
  getPendingTargets,
  signUp,
  signInWithGoogle,
  maybeCommitPendingCrushes,
  summarizeCommit,
  norm,
  stashPendingSignup,
} from "@/lib/store";
import { claimReferralCode } from "@/lib/phase5.functions";
import { claimHandle, setDob as setDobFn } from "@/lib/onboarding.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up · Crush" }] }),
  component: SignupPage,
});

const HANDLE_RE = /^[a-z0-9][a-z0-9_.]{1,18}[a-z0-9]$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Field-level validators — MUST mirror submit-time rules in `validate()`
// so the post-blur valid check never disagrees with what submit accepts.
const isValidName = (v: string) => v.trim().length > 0;
const isValidHandle = (v: string) => HANDLE_RE.test(norm(v));
const isValidEmail = (v: string) => EMAIL_RE.test(v.trim());
const isValidPassword = (v: string) => v.length >= 6;
const isValidDob = (v: string) => {
  if (!v) return false;
  const d = new Date(v + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 13);
  return d <= cutoff;
};

function SignupPage() {
  const nav = useNavigate();
  const pending = getPendingTargets();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState("");
  const [err, setErr] = useState<{ name?: string; handle?: string; email?: string; password?: string; dob?: string; top?: string }>({});
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  function validate(googleFlow = false): boolean {
    const e: typeof err = {};
    if (!googleFlow && !isValidName(name)) e.name = "add your name.";
    if (!isValidHandle(handle)) e.handle = "3–20 chars: letters, numbers, . or _";
    if (!googleFlow) {
      if (!isValidEmail(email)) e.email = "check your email.";
      if (!isValidPassword(password)) e.password = "6+ characters.";
    }
    if (!dob) e.dob = "add your birthday.";
    else if (!isValidDob(dob)) e.dob = "you have to be at least 13.";
    setErr(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setErr({});
    try {
      const r = await signUp({ name, handle: norm(handle), email, password });
      if (r.error) {
        setErr({ top: r.error.replace(/^duplicate.*/i, "that email is already in use.") });
        return;
      }
      // Await handle claim + dob so picks commit under the confirmed handle.
      try { await claimHandle({ data: { handle: norm(handle) } }); } catch {}
      try { await setDobFn({ data: { dob } }); } catch {}
      // Claim referral, fire-and-forget.
      const ref = typeof localStorage !== "undefined" ? localStorage.getItem("crush.pending.ref") : null;
      if (ref) {
        claimReferralCode({ data: { code: ref } })
          .then((res) => { if (res.ok) localStorage.removeItem("crush.pending.ref"); })
          .catch(() => {});
      }
      const commit = await maybeCommitPendingCrushes();
      const s = summarizeCommit(commit);
      if (s.ok) toast.success(s.ok); else toast.success("welcome to crush");
      if (s.warn) toast.warning(s.warn);
      // Brief Candy "connected" moment after account + pending picks land.
      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      setConnected(true);
      await new Promise((r) => setTimeout(r, reduced ? 0 : 720));
      nav({ to: "/onboarding/quiz" });
    } catch {
      setErr({ top: "network hiccup — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    // If the user has already typed handle/dob, preserve them across OAuth so
    // the compact signup screen "applies" once the session lands. Handle/dob
    // are validated (googleFlow=true skips email/password since Google covers
    // that). Empty fields = returning Google user, straight into /app.
    const h = norm(handle);
    if (h || dob) {
      if (!validate(true)) return;
      stashPendingSignup({ handle: h || undefined, dob: dob || undefined });
    }
    setBusy(true);
    const r = await signInWithGoogle();
    setBusy(false);
    if (r.error) setErr({ top: r.error });
  }



  return (
    <MobileShell>
      {connected && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm animate-pop-in"
        >
          <div className="relative text-primary">
            <MutualGlyph size={72} />
            <span aria-hidden className="absolute inset-0 rounded-full animate-ring-burst" />
          </div>
          <p className="mt-4 text-sm font-black uppercase tracking-wider inline-flex items-center gap-2">
            <Check className="size-4 animate-check-pop" /> you're in
          </p>
        </div>
      )}
      <div className="px-5 pt-5 flex items-center justify-between">
        <Link to="/" aria-label="Back" className="icon-btn -ml-2">
          <ArrowLeft className="size-4" />
        </Link>
        <BrandMark size={22} />
        <span className="w-11" />
      </div>
      <ScreenHeader
        title="Claim your @"
        subtitle={pending.length ? `we'll quietly send your ${pending.length} pick${pending.length > 1 ? "s" : ""} the moment you're in.` : "lock in your handle so people can pick you back."}
      />
      <form onSubmit={submit} className="px-5 mt-4 flex-1 flex flex-col gap-4">
        <Field label="your name" value={name} onChange={setName} placeholder="taylor swift" error={err.name} isValid={isValidName} />
        <HandleField value={handle} onChange={setHandle} error={err.handle} isValid={isValidHandle} />
        <Field label="email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" error={err.email} isValid={isValidEmail} />
        <Field label="password" value={password} onChange={setPassword} placeholder="••••••" type="password" error={err.password} isValid={isValidPassword} />
        <Field label="birthday" value={dob} onChange={setDob} type="date" error={err.dob} isValid={isValidDob} />
        <p className="-mt-2 text-xs text-muted-foreground">you have to be 13+ to use crush. we never show your birthday.</p>
        {err.top && <p className="text-sm text-destructive font-medium">{err.top}</p>}

        <button type="submit" disabled={busy} className="btn-pop mt-2 disabled:opacity-60">
          <Heart className="size-5 mr-2" fill="currentColor" />
          {busy ? "creating…" : pending.length ? `send ${pending.length} pick${pending.length > 1 ? "s" : ""}` : "make my account"}
        </button>

        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <button
          type="button"
          onClick={googleSignIn}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2.5 w-full rounded-lg px-4 py-3 min-h-11 font-medium bg-card border tap-scale disabled:opacity-60"
        >
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#EA4335" d="M12 5.04c1.54 0 2.92.53 4.01 1.57l3.01-3.01C17.31 1.55 14.83.5 12 .5 7.66.5 3.91 2.95 1.98 6.55l3.51 2.72C6.58 6.26 9.1 5.04 12 5.04z" />
            <path fill="#4285F4" d="M23.5 12.23c0-.8-.07-1.57-.2-2.31H12v4.37h6.45c-.28 1.47-1.09 2.71-2.32 3.55l3.76 2.92c2.2-2.03 3.61-5.03 3.61-8.53z" />
            <path fill="#FBBC05" d="M5.49 14.27l-.36 2.24 3.51 2.72c1.42-2.66 1.42-5.9 0-8.55l-3.51 2.72.36 2.24z" />
            <path fill="#34A853" d="M12 23.5c3.24 0 5.96-1.08 7.95-2.93l-3.76-2.92c-1.08.72-2.45 1.15-4.19 1.15-2.9 0-5.42-1.22-7.01-3.22l-3.51 2.72C3.91 21.05 7.66 23.5 12 23.5z" />
            <path fill="#4285F4" d="M5.49 9.68L1.98 6.96C.73 9.15 0 11.5 0 14s.73 4.85 1.98 7.04l3.51-2.72c-.65-1.27-1.02-2.7-1.02-4.32s.37-3.05 1.02-4.32z" />
          </svg>
          continue with google
        </button>

        <p className="text-center text-sm text-muted-foreground mb-8">
          already have an account? <Link to="/login" className="underline font-semibold">log in</Link>
        </p>
      </form>
    </MobileShell>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", error, isValid,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; error?: string; isValid?: (v: string) => boolean }) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const [touched, setTouched] = useState(false);
  const invalid = !!error;
  // Only mark valid once the user has left the field AND the value passes the
  // same rule submit uses. Prevents false green-checks on malformed input.
  const showValid = touched && !invalid && !!isValid && isValid(value);
  return (
    <label className="block" htmlFor={id}>
      <span className="text-sm font-semibold">{label}</span>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-err` : undefined}
          className={`input-field pr-9 transition-shadow ${invalid ? "ring-1 ring-destructive/50 animate-shake" : ""}`}
        />
        {showValid && (
          <Check aria-hidden className="size-4 text-primary absolute right-3 top-1/2 -translate-y-1/2 animate-check-pop" />
        )}
      </div>
      {invalid && (
        <p id={`${id}-err`} className="text-xs text-destructive mt-1 font-medium animate-fade-in">{error}</p>
      )}
    </label>
  );
}

function HandleField({ value, onChange, error, isValid }: { value: string; onChange: (v: string) => void; error?: string; isValid?: (v: string) => boolean }) {
  const [touched, setTouched] = useState(false);
  const invalid = !!error;
  const showValid = touched && !invalid && !!isValid && isValid(value);
  return (
    <label className="block" htmlFor="f-handle">
      <span className="text-sm font-semibold">handle</span>
      <div className="relative mt-1.5">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
        <input
          id="f-handle"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@/, ""))}
          onBlur={() => setTouched(true)}
          placeholder="taylor"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "f-handle-err" : "f-handle-hint"}
          className={`input-field pl-8 pr-9 transition-shadow ${invalid ? "ring-1 ring-destructive/50 animate-shake" : ""}`}
        />
        {showValid && (
          <Check aria-hidden className="size-4 text-primary absolute right-3 top-1/2 -translate-y-1/2 animate-check-pop" />
        )}
      </div>
      <p id="f-handle-hint" className="text-xs text-muted-foreground mt-1">lowercase, 3–20 chars. letters, numbers, . or _</p>
      {invalid && (
        <p id="f-handle-err" className="text-xs text-destructive mt-1 font-medium animate-fade-in">{error}</p>
      )}
    </label>
  );
}
