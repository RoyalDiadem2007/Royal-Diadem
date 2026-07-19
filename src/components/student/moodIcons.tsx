/**
 * The crown-check line icons (SXU mockup, Maria 2026-07-19): the same five
 * decided symbols — 👑 ✨ 🌹 💧 🌧️ — drawn as elegant strokes instead of
 * platform emoji. The stored data keeps the emoji as its canonical symbol;
 * these are presentation only. All aria-hidden: the word label beside each
 * icon carries the meaning.
 */

type IconProps = { className?: string | undefined };

function base(props: IconProps) {
  return {
    ...(props.className === undefined ? {} : { className: props.className }),
    width: 28,
    height: 28,
    viewBox: '0 0 28 28',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
}

/** Score 5 — Radiant. */
export function CrownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h20M5 20l-1.5-9 6 4L14 7l4.5 8 6-4L23 20" />
      <circle cx="3.5" cy="10" r="1" />
      <circle cx="24.5" cy="10" r="1" />
      <circle cx="14" cy="6" r="1" />
    </svg>
  );
}

/** Score 4 — Steady. */
export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7Z" />
      <path d="M22 18c.35 2 1 2.65 3 3-2 .35-2.65 1-3 3-.35-2-1-2.65-3-3 2-.35 2.65-1 3-3Z" />
    </svg>
  );
}

/** Score 3 — Tender. */
export function RoseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 13c-3 0-5-2-5-4.5C9 6 11 4.5 14 4.5S19 6 19 8.5C19 11 17 13 14 13Z" />
      <path d="M14 8.5c-1.2 0-2 .7-2 1.6 0 .9.8 1.6 2 1.6s2-.7 2-1.6" />
      <path d="M14 13v10M14 18c-2.5 0-4.5-1.5-5-3.5M14 20c2.5 0 4.5-1.5 5-3.5" />
    </svg>
  );
}

/** Score 2 — Low. */
export function DropletIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4.5C10.5 9.5 8 13 8 16.5a6 6 0 0 0 12 0c0-3.5-2.5-7-6-12Z" />
      <path d="M11 17a3 3 0 0 0 2 2.8" />
    </svg>
  );
}

/** Score 1 — Stormy. */
export function StormIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8.5 17.5a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6 1.6 3.6 3.6 0 0 1 .3 7.2" />
      <path d="M10 21l-1 3M14.5 21l-1 3M19 21l-1 3" />
    </svg>
  );
}

/** Icon for a mood score; the tier's word label always accompanies it. */
export function MoodIcon({ score, className }: { score: number; className?: string | undefined }) {
  if (score === 5) {
    return <CrownIcon className={className} />;
  }
  if (score === 4) {
    return <SparkleIcon className={className} />;
  }
  if (score === 3) {
    return <RoseIcon className={className} />;
  }
  if (score === 2) {
    return <DropletIcon className={className} />;
  }
  return <StormIcon className={className} />;
}
