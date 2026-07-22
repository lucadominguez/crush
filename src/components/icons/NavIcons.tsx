// Original nav icon set. Filled currentColor glyphs designed as one family:
// chunky, generously rounded, and tied to the mutual-crush theme so they read
// as this product rather than a stock icon pack. They inherit the nav's color
// (muted when inactive, primary-foreground when active) via currentColor.

type IconProps = { size?: number; className?: string; active?: boolean };

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** picks — a plump, hand-rounded heart (the core act of the app). */
export function IconPicks(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20.5c-.42 0-.83-.15-1.15-.42C6.2 16.2 3 13.2 3 9.5 3 6.9 5 5 7.4 5c1.7 0 3.2 1 3.9 2.5.1.22.3.35.5.35s.4-.13.5-.35C13 5.9 14.5 5 16.2 5 18.6 5 20.6 6.9 20.6 9.5c0 3.7-3.2 6.7-7.45 10.58-.32.27-.73.42-1.15.42Z" />
    </Svg>
  );
}

/** matches — two overlapping hearts: the mutual reveal. */
export function IconMatches(props: IconProps) {
  return (
    <Svg {...props}>
      {/* back heart (slightly translucent so the overlap reads) */}
      <path
        opacity="0.45"
        d="M15.5 18.2c-.28 0-.55-.1-.77-.28-2.83-2.4-4.98-4.4-4.98-6.87 0-1.73 1.33-3 2.93-3 1.13 0 2.13.66 2.6 1.66.06.14.2.23.34.23.14 0 .28-.09.34-.23.47-1 1.47-1.66 2.6-1.66 1.6 0 2.93 1.27 2.93 3 0 2.47-2.15 4.47-4.98 6.87-.22.18-.49.28-.77.28Z"
      />
      {/* front heart */}
      <path d="M8 19c-.3 0-.6-.11-.83-.31C4.1 15.98 1.8 13.83 1.8 11.2 1.8 9.34 3.24 8 4.96 8c1.22 0 2.29.71 2.79 1.79.07.15.21.25.37.25.16 0 .3-.1.37-.25C8.98 8.71 10.05 8 11.27 8c1.72 0 3.16 1.34 3.16 3.2 0 2.63-2.3 4.78-5.37 7.49-.23.2-.53.31-.83.31Z" />
    </Svg>
  );
}

/** polls — three rounded bars, tallest in the middle: the podium of a vote. */
export function IconPolls(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.4" y="13" width="4.1" height="7.5" rx="2.05" />
      <rect x="9.95" y="6" width="4.1" height="14.5" rx="2.05" />
      <rect x="16.5" y="10" width="4.1" height="10.5" rx="2.05" />
    </Svg>
  );
}

/** chat — a plump speech bubble with a tiny heart cut out of it, so the heart
 *  shows the background through it and reads on any color (incl. the active
 *  gradient). */
export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 3.5c-5.1 0-9.2 3.3-9.2 7.6 0 2.5 1.4 4.7 3.6 6.1-.15 1-.6 2-1.3 2.8-.2.23-.24.56-.1.83.14.27.44.42.74.37 1.9-.32 3.4-1 4.5-1.7.6.1 1.2.15 1.76.15 5.1 0 9.2-3.3 9.2-7.55S17.1 3.5 12 3.5Zm0 10.7c-.18 0-.35-.06-.48-.18-1.72-1.5-2.72-2.36-2.72-3.53 0-.9.72-1.55 1.57-1.55.6 0 1.12.32 1.4.83.05.09.15.09.2 0 .28-.51.8-.83 1.4-.83.85 0 1.57.65 1.57 1.55 0 1.17-1 2.03-2.72 3.53-.13.12-.3.18-.48.18Z"
      />
    </Svg>
  );
}

/** you — a friendly, chunky bust. */
export function IconYou(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4.2" />
      <path d="M12 13.6c-3.7 0-6.8 2.2-7.5 5.15-.2.86.48 1.65 1.37 1.65h12.26c.89 0 1.57-.79 1.37-1.65C18.8 15.8 15.7 13.6 12 13.6Z" />
    </Svg>
  );
}
