/**
 * The "Today for you" tile icons (SXU mockup fidelity): quill-and-inkwell
 * for the daily message, an open journal for the prompt, gathered figures
 * under a crown for events. Line art, aria-hidden — the eyebrow labels
 * carry the meaning.
 */

type IconProps = { className?: string | undefined };

function base(props: IconProps) {
  return {
    ...(props.className === undefined ? {} : { className: props.className }),
    width: 34,
    height: 34,
    viewBox: '0 0 34 34',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
}

export function QuillIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M26 5c-7 1.5-11.5 5-14 12l-1.5 5 5-1.5c7-2.5 10.5-7 12-14Z" />
      <path d="M23 8c-4 2.5-7 5.5-9.5 10" />
      <path d="M8 25c-2 0-3.5 1-4 3h12c-.5-2-2-3-4-3H8Z" />
    </svg>
  );
}

export function OpenBookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M17 9c-2.5-2-6-2.7-10-2.5V25c4-.2 7.5.5 10 2.5 2.5-2 6-2.7 10-2.5V6.5C23 6.3 19.5 7 17 9Z" />
      <path d="M17 9v18.5" />
      <path d="M10 11.5c1.5 0 3 .2 4.5.7M10 15.5c1.5 0 3 .2 4.5.7M19.5 12.2c1.5-.5 3-.7 4.5-.7" />
      <path d="M27 8l3.5 3.5L21 21l-4 1 1-4 9-9.5Z" />
    </svg>
  );
}

export function GatheringIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 12h8M13.5 12l-1-5 3 2 1.5-3.5L18.5 9l3-2-1 5" />
      <circle cx="9" cy="19" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <circle cx="25" cy="19" r="2.4" />
      <path d="M4.5 29c.5-3 2.2-4.6 4.5-4.6S13 26 13.5 29M12.5 28c.5-3 2.2-4.6 4.5-4.6s4 1.6 4.5 4.6M20.5 29c.5-3 2.2-4.6 4.5-4.6s4 1.6 4.5 4.6" />
    </svg>
  );
}
