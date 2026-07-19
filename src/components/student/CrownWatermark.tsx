/**
 * The tonal watermark (SXU mockup): a faint gold crown-and-sparkle line
 * drawing etched into card corners — the motif identity without emoji
 * wallpaper. Pure decoration: aria-hidden by every caller.
 */
export function CrownWatermark() {
  return (
    <svg
      width="150"
      height="150"
      viewBox="0 0 150 150"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M35 108h80M38 108l-7-44 29 20L75 42l15 42 29-20-7 44" />
      <circle cx="28" cy="58" r="3.4" />
      <circle cx="122" cy="58" r="3.4" />
      <circle cx="75" cy="36" r="3.4" />
      <path d="M120 118c1.6 8 4.4 10.8 12.4 12.4-8 1.6-10.8 4.4-12.4 12.4-1.6-8-4.4-10.8-12.4-12.4 8-1.6 10.8-4.4 12.4-12.4Z" />
      <path d="M28 14c1.2 6 3.3 8.1 9.3 9.3-6 1.2-8.1 3.3-9.3 9.3-1.2-6-3.3-8.1-9.3-9.3 6-1.2 8.1-3.3 9.3-9.3Z" />
    </svg>
  );
}
