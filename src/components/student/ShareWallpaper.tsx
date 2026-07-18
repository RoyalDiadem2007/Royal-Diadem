/**
 * The Share room's wallpaper (Maria's direction 2026-07-18): crowns and
 * flamingos drifting faintly behind the feed, so the space feels like a
 * party wall, not a form. Pure decoration: aria-hidden, pointer-events
 * none, whisper opacity, and perfectly still for reduced-motion users.
 * Positions are fixed (not random) so the wall looks composed, not spilled.
 */

type Motif = {
  id: string;
  icon: string;
  top: string;
  left: string;
  size: string;
  delay: string;
  duration: string;
};

const MOTIFS: readonly Motif[] = [
  {
    id: 'crown-a',
    icon: '👑',
    top: '4%',
    left: '6%',
    size: '2.4rem',
    delay: '0s',
    duration: '26s',
  },
  {
    id: 'flamingo-a',
    icon: '🦩',
    top: '12%',
    left: '84%',
    size: '2.8rem',
    delay: '3s',
    duration: '31s',
  },
  {
    id: 'sparkle-a',
    icon: '✨',
    top: '22%',
    left: '12%',
    size: '1.4rem',
    delay: '6s',
    duration: '22s',
  },
  {
    id: 'gem-a',
    icon: '💎',
    top: '30%',
    left: '90%',
    size: '1.6rem',
    delay: '2s',
    duration: '27s',
  },
  {
    id: 'crown-b',
    icon: '👑',
    top: '41%',
    left: '4%',
    size: '1.8rem',
    delay: '9s',
    duration: '33s',
  },
  {
    id: 'rose-a',
    icon: '🌹',
    top: '48%',
    left: '88%',
    size: '1.9rem',
    delay: '5s',
    duration: '29s',
  },
  {
    id: 'flamingo-b',
    icon: '🦩',
    top: '58%',
    left: '8%',
    size: '2.2rem',
    delay: '11s',
    duration: '35s',
  },
  {
    id: 'sparkle-b',
    icon: '✨',
    top: '66%',
    left: '82%',
    size: '1.3rem',
    delay: '8s',
    duration: '24s',
  },
  {
    id: 'gem-b',
    icon: '💎',
    top: '74%',
    left: '14%',
    size: '1.5rem',
    delay: '4s',
    duration: '28s',
  },
  {
    id: 'crown-c',
    icon: '👑',
    top: '82%',
    left: '90%',
    size: '2.1rem',
    delay: '13s',
    duration: '30s',
  },
  {
    id: 'rose-b',
    icon: '🌹',
    top: '90%',
    left: '6%',
    size: '1.7rem',
    delay: '7s',
    duration: '25s',
  },
  {
    id: 'flamingo-c',
    icon: '🦩',
    top: '93%',
    left: '70%',
    size: '2.5rem',
    delay: '10s',
    duration: '32s',
  },
];

export function ShareWallpaper() {
  return (
    <div className="share-wallpaper" aria-hidden="true">
      {MOTIFS.map((motif) => (
        <span
          key={motif.id}
          className="share-wallpaper-motif"
          style={{
            top: motif.top,
            left: motif.left,
            fontSize: motif.size,
            animationDelay: motif.delay,
            animationDuration: motif.duration,
          }}
        >
          {motif.icon}
        </span>
      ))}
    </div>
  );
}
