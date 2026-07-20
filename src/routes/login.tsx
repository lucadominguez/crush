import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { MobileShell, ScreenHeader } from "@/components/MobileShell";
import { BrandMark } from "@/components/BrandMark";
import { signIn, signInWithGoogle, summarizeCommit, useSession } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log in · Crush" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) nav({ to: "/app" });
  }, [loading, session, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await signIn(email, password);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    const s = summarizeCommit(r.commit);
    toast.success(s.ok ?? "Welcome back");
    if (s.warn) toast.warning(s.warn);
    nav({ to: "/app" });
  }

  async function googleSignIn() {
    setBusy(true);
    const r = await signInWithGoogle();
    setBusy(false);
    if (r.error) { setErr(r.error); }
  }

  return (
    <MobileShell>
      <div className="px-5 pt-5 flex items-center justify-between">
        <Link to="/" aria-label="Back" className="icon-btn -ml-2">
          <ArrowLeft className="size-4" />
        </Link>
        <BrandMark size={22} />
        <span className="w-11" />
      </div>
      <ScreenHeader
        title="Welcome back"
        subtitle="Pick up where you left off."
      />
      <form onSubmit={submit} className="px-5 mt-4 flex-1 flex flex-col gap-4">
        <label className="block">
          <span className="text-sm font-bold">email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field mt-1.5" />
        </label>
        <label className="block">
          <span className="text-sm font-bold">password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field mt-1.5" />
        </label>
        {err && <p className="text-sm text-destructive font-medium">{err}</p>}
        <button type="submit" disabled={busy} className="btn-pop mt-2 disabled:opacity-60">{busy ? "logging in…" : "log in"}</button>

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
          new here? <Link to="/signup" className="underline font-semibold">make an account</Link>
        </p>
      </form>
    </MobileShell>
  );
}
