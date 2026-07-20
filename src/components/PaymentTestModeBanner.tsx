// Compact, accessible status notice. Never suggests a real charge occurred.
// Shown only in sandbox or when payments are not configured.
export function PaymentTestModeBanner({ env }: { env: "sandbox" | "live" | null }) {
  if (env === "live") return null;
  const isSandbox = env === "sandbox";
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full px-4 py-2 text-center text-[12px] border-b border-border/60"
      style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
    >
      {isSandbox
        ? "Sandbox mode — no real charges. Test card 4242 4242 4242 4242."
        : "Payments are not configured for this environment."}
    </div>
  );
}
