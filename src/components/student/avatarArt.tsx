/**
 * Illustrated avatar medallions (SXU brief: "optional profile image or
 * selected illustrated avatar; do not require a photograph"). Line-art
 * marks in the brand's gold, rendered in a coin — no photographs, no
 * uploads, nothing to moderate. The initial-letter coin stays the default.
 */
import { CrownIcon, RoseIcon, SparkleIcon } from '@/components/student/moodIcons';

type ArtProps = { className?: string | undefined };

function base(props: ArtProps) {
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

function GemIcon(props: ArtProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 5h10l5 6-10 13L4 11l5-6ZM4 11h20M9 5l5 6 5-6M14 24l-5-13M14 24l5-13" />
    </svg>
  );
}

function StarIcon(props: ArtProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.8-6.2 3.8 1.6-7L4 11.3l7.1-.7L14 4Z" />
    </svg>
  );
}

function HeartIcon(props: ArtProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 23S4.5 17 4.5 10.8C4.5 7.6 7 5.5 9.8 5.5c1.8 0 3.4.9 4.2 2.3.8-1.4 2.4-2.3 4.2-2.3 2.8 0 5.3 2.1 5.3 5.3C23.5 17 14 23 14 23Z" />
    </svg>
  );
}

export function AvatarArt({
  avatarKey,
  className,
}: {
  avatarKey: string;
  className?: string | undefined;
}) {
  if (avatarKey === 'crown') {
    return <CrownIcon className={className} />;
  }
  if (avatarKey === 'sparkle') {
    return <SparkleIcon className={className} />;
  }
  if (avatarKey === 'rose') {
    return <RoseIcon className={className} />;
  }
  if (avatarKey === 'gem') {
    return <GemIcon className={className} />;
  }
  if (avatarKey === 'star') {
    return <StarIcon className={className} />;
  }
  return <HeartIcon className={className} />;
}
