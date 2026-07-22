// Secondary brand glyphs, same crafted family as the nav icons: filled,
// generously rounded, currentColor. These replace the stock lucide marks on
// the primary surfaces (home header etc.) so nothing reads as a stock pack.

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

/** notifications — a rounded bell with a little clapper. */
export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.6c-.7 0-1.25.56-1.25 1.25v.62C7.9 5.05 6 7.5 6 10.4v3l-1.2 2.1c-.5.86.13 1.95 1.12 1.95h12.16c.99 0 1.62-1.09 1.12-1.95L18 13.4v-3c0-2.9-1.9-5.35-4.75-5.93v-.62c0-.69-.56-1.25-1.25-1.25Z" />
      <path d="M9.6 19.2a2.5 2.5 0 0 0 4.8 0H9.6Z" />
    </Svg>
  );
}

/** invite — a chunky paper plane. */
export function IconInvite(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.3 3.8 3.6 10.5c-.86.34-.8 1.58.09 1.84l5.2 1.52 1.52 5.2c.26.89 1.5.95 1.84.09L18.7 3.4c.06-.16-.02-.34-.18-.4a.33.33 0 0 0-.22.01Zm-1.9 1.9-6.06 8.9-.98-3.36 7.04-5.54Z" />
    </Svg>
  );
}

/** standings — a rounded trophy cup. */
export function IconTrophy(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4h12c.55 0 1 .45 1 1v1h1.4c.9 0 1.6.74 1.6 1.63v.5c0 1.98-1.53 3.62-3.5 3.85-.86 1.6-2.4 2.77-4.25 3.06v2.01h2.25c.55 0 1 .45 1 1v.4H6.5v-.4c0-.55.45-1 1-1h2.25v-2.01c-1.85-.29-3.39-1.46-4.25-3.06C3.53 11.75 2 10.1 2 8.13v-.5C2 6.74 2.7 6 3.6 6H5V5c0-.55.45-1 1-1Zm13 3.5v3.02c.9-.32 1.5-1.16 1.5-2.14v-.38A.5.5 0 0 0 20 7.5h-1ZM5 7.5H4a.5.5 0 0 0-.5.5v.38c0 .98.6 1.82 1.5 2.14V7.5Z" />
      <rect x="8.5" y="19.6" width="7" height="1.9" rx="0.95" />
    </Svg>
  );
}

/** upgrade / god mode — a rounded crown with gems. */
export function IconCrown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 8.2c-.7-.5-1.66.13-1.47.96l1.66 7.3c.16.7.78 1.19 1.5 1.19h13.82c.72 0 1.34-.49 1.5-1.19l1.66-7.3c.19-.83-.77-1.46-1.47-.96l-3.9 2.8-3.02-4.9a.83.83 0 0 0-1.42 0l-3.02 4.9-3.9-2.8Z" />
      <rect x="4.5" y="19.1" width="15" height="2" rx="1" />
    </Svg>
  );
}

/** streak — a rounded flame. */
export function IconFlame(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.7 2.3c-.3-.28-.77-.14-.9.24-.5 1.6-1.5 2.85-2.55 4.06-1.2 1.38-2.55 2.9-3.15 4.98a7.2 7.2 0 0 0 3.02 8.03c.4.26.9-.1.78-.56a4.1 4.1 0 0 1 .62-3.44c.5-.7 1.1-1.32 1.5-2.1.18.63.28 1.3.28 1.98 0 .5.02 1.1-.2 1.66-.17.44.3.86.7.6a5.9 5.9 0 0 0 2.73-4.42c.28-2.9-1.3-5.32-2.72-7.35-.9-1.28-1.6-2.6-1.06-4.04.06-.16.03-.34-.1-.46l-.65-.76-.001-.001Z" />
    </Svg>
  );
}

/** invites earned — a rounded gift box. */
export function IconGift(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6.2c-.5-.9-1.5-1.7-2.7-1.7-1.4 0-2.4 1-2.4 2.2 0 .34.07.66.2.95H4.6c-.66 0-1.2.54-1.2 1.2v1.9c0 .5.4.9.9.9h15.4c.5 0 .9-.4.9-.9v-1.9c0-.66-.54-1.2-1.2-1.2h-2.5c.13-.29.2-.61.2-.95 0-1.2-1-2.2-2.4-2.2-1.2 0-2.2.8-2.7 1.7Zm-1-.15c0-.55-.5-1-1.1-1-.6 0-1 .4-1 .95 0 .55.5 1 1.1 1H11v-.95Zm2 0V7h1c.6 0 1.1-.45 1.1-1 0-.55-.4-.95-1-.95-.6 0-1.1.45-1.1 1Z" />
      <path d="M4.6 13.2v5.4c0 .66.54 1.2 1.2 1.2H11v-6.6H4.6Zm8.4 0v6.6h5.2c.66 0 1.2-.54 1.2-1.2v-5.4H13Z" />
    </Svg>
  );
}

/** sparkle — a rounded four-point star, for celebratory accents. */
export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.5c.35 0 .66.22.78.55l1.6 4.35c.16.44.5.79.94.95l4.35 1.6a.83.83 0 0 1 0 1.56l-4.35 1.6c-.44.16-.78.5-.94.95l-1.6 4.35a.83.83 0 0 1-1.56 0l-1.6-4.35a1.5 1.5 0 0 0-.94-.95l-4.35-1.6a.83.83 0 0 1 0-1.56l4.35-1.6c.44-.16.78-.51.94-.95l1.6-4.35c.12-.33.43-.55.78-.55Z" />
    </Svg>
  );
}
