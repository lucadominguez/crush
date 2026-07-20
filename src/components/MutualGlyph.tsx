// Tiny brand-specific glyph: two dots meeting through arcing paths — used
// during the welcome-intro handoff to hint at mutual connection.
// Prefers CSS transform/opacity animation and respects reduced motion via
// the parent's animation utilities (never animates on its own).
export function MutualGlyph({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 44 44"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="mg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path
        d="M6 22 C 12 8, 22 8, 22 22"
        fill="none"
        stroke="url(#mg-a)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M22 22 C 22 36, 32 36, 38 22"
        fill="none"
        stroke="url(#mg-a)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="6" cy="22" r="3.4" fill="currentColor" />
      <circle cx="38" cy="22" r="3.4" fill="currentColor" />
      <circle cx="22" cy="22" r="2.4" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
