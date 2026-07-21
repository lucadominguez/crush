import { Link } from "@tanstack/react-router";

/**
 * Playful mark: two overlapping filled loops = mutual match.
 * Sunshine yellow + bubblegum pink; the overlap creates a warm blend.
 */
export function BrandMark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 40 32"
      width={size * (40 / 32)}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="bm-sun" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="var(--sun)" />
          <stop offset="1" stopColor="oklch(0.82 0.19 60)" />
        </radialGradient>
        <radialGradient id="bm-pink" cx="0.5" cy="0.5" r="0.55">
          <stop offset="0" stopColor="oklch(0.82 0.17 350)" />
          <stop offset="1" stopColor="var(--primary)" />
        </radialGradient>
      </defs>
      <circle cx="15" cy="16" r="12" fill="url(#bm-sun)" opacity="0.95" />
      <circle cx="25" cy="16" r="12" fill="url(#bm-pink)" opacity="0.9" style={{ mixBlendMode: "multiply" }} />
      <circle cx="15" cy="16" r="12" fill="none" stroke="oklch(0.2 0.02 285 / 0.6)" strokeWidth="1.25" />
      <circle cx="25" cy="16" r="12" fill="none" stroke="oklch(0.2 0.02 285 / 0.6)" strokeWidth="1.25" />
    </svg>
  );
}

export function BrandLockup({ to = "/", className = "" }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2 ${className}`} aria-label="crush home">
      <BrandMark size={26} />
      <span className="text-lead font-black tracking-tight lowercase">crush</span>
    </Link>
  );
}
