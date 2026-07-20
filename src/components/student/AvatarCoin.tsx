/**
 * AvatarCoin — renders a student's composed avatar (AvatarConfig) as a warm,
 * textured illustrated portrait inside a circular coin. Everything is drawn
 * in-app from her facet choices: no photograph, no upload, nothing generated
 * by an external service, nothing to moderate.
 *
 * The hair vocabulary centres real Black hairstyles rendered with texture and
 * worn OFF the face: Afro/Coils/Puffs as stippled, ringed volume; Locs, Box
 * braids and Ponytail swept into a crown with the length falling at the
 * sides/back; Cornrows as scalp rows gathered to a bun. Face shape, eyes,
 * nose and mouth are each their own facet. Skin/hair colours come from the
 * avatar palette; crown, beads, lips and backdrop read from branding.config.
 *
 * This SVG is the interim art; commissioned layered assets
 * (docs/AVATAR_ILLUSTRATION_SPEC.md) drop into this same component contract.
 *
 * Layer order back→front: backdrop, hair behind, neck, shoulders, head, ears,
 * face, hair (crown + side length), crown.
 */
import { useId, type ReactNode } from 'react';
import { describeAvatar, hairFill, skinFill, type AvatarConfig } from '@/lib/avatarBuilder';
import { brand } from '@/config/branding.config';

const FEATURE = '#3A2A28';
const LOW = 'rgba(0,0,0,0.24)';
const HI = 'rgba(255,255,255,0.16)';
const LIP = '#B4566A';
const WHITE = '#FFFFFF';

type HeadShape = { path: string; earX: number };
const ROUND_HEAD: HeadShape = {
  path: 'M50,26 C63.3,26 74,36.7 74,50 C74,63.3 63.3,74 50,74 C36.7,74 26,63.3 26,50 C26,36.7 36.7,26 50,26 Z',
  earX: 27,
};
const HEAD_SHAPES: Record<string, HeadShape> = {
  round: ROUND_HEAD,
  oval: {
    path: 'M50,25 C61.6,25 71,36.2 71,50 C71,64.9 61.6,75 50,75 C38.4,75 29,64.9 29,50 C29,36.2 38.4,25 50,25 Z',
    earX: 30,
  },
  heart: {
    path: 'M50,27 C63,27 73,33 73,44 C73,56 62,67 50,76 C38,67 27,56 27,44 C27,33 37,27 50,27 Z',
    earX: 27,
  },
  square: {
    path: 'M29,41 C29,31 38,27 50,27 C62,27 71,31 71,41 L71,59 C71,69.5 63,73 50,73 C37,73 29,69.5 29,59 Z',
    earX: 28,
  },
  long: {
    path: 'M32,39 C32,29 40,26 50,26 C60,26 68,29 68,39 L68,58 C68,71 60,77 50,77 C40,77 32,71 32,58 Z',
    earX: 31,
  },
};

type Pt = readonly [number, number];

function coilField(cx: number, cy: number, rad: number, step: number): Pt[] {
  const pts: Pt[] = [];
  let row = 0;
  for (let y = cy - rad; y <= cy + rad; y += step) {
    const offset = row % 2 === 0 ? 0 : step / 2;
    for (let x = cx - rad; x <= cx + rad; x += step) {
      const ox = x + offset;
      if ((ox - cx) * (ox - cx) + (y - cy) * (y - cy) <= rad * rad) {
        pts.push([Math.round(ox * 10) / 10, Math.round(y * 10) / 10]);
      }
    }
    row += 1;
  }
  return pts;
}

function topScallops(cx: number, cy: number, rad: number, count: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = Math.PI + (Math.PI * i) / (count - 1);
    pts.push([
      Math.round((cx + Math.cos(a) * rad) * 10) / 10,
      Math.round((cy + Math.sin(a) * rad) * 10) / 10,
    ]);
  }
  return pts;
}

const AFRO_TEX = coilField(50, 43, 28, 6.4);
const AFRO_EDGE = topScallops(50, 43, 29, 15);
const COIL_TEX = coilField(50, 44, 26, 5.6);
const COIL_EDGE = topScallops(50, 44, 26, 13);
const PUFF_L_TEX = coilField(33, 27, 12, 5);
const PUFF_R_TEX = coilField(67, 27, 12, 5);
const PUFF_EDGE_L = topScallops(33, 27, 12.5, 9);
const PUFF_EDGE_R = topScallops(67, 27, 12.5, 9);

const CAP_PATH =
  'M24,56 Q22,26 50,23 Q78,26 76,56 Q70,45 66,43 Q58,39 50,39 Q42,39 34,43 Q30,45 24,56 Z';
const CAP_ROWS: readonly string[] = [
  'M28,54 Q28,32 50,26',
  'M36,52 Q37,30 50,25',
  'M50,51 L50,24',
  'M64,52 Q63,30 50,25',
  'M72,54 Q72,32 50,26',
];
const CORNROW_ROWS: readonly string[] = [
  'M28,54 Q28,32 50,26',
  'M33,53 Q35,31 50,25.5',
  'M41,52 Q43,30 50,25',
  'M50,51 L50,24',
  'M59,52 Q57,30 50,25',
  'M67,53 Q65,31 50,25.5',
  'M72,54 Q72,32 50,26',
];
const PONY_SWEEP: readonly string[] = [
  'M28,52 Q40,32 50,25',
  'M40,50 Q46,32 50,24',
  'M60,50 Q54,32 50,24',
  'M72,52 Q60,32 50,25',
];
const SIDE_SEG_Y: readonly number[] = [46, 53, 60, 67, 74, 81, 88];
const LOC_SIDE: readonly number[] = [18, 24, 76, 82];
const BRAID_SIDE: readonly number[] = [19, 25, 75, 81];

function texKey(pt: Pt): string {
  return `${String(pt[0])}-${String(pt[1])}`;
}

function stipple(points: readonly Pt[]): ReactNode {
  return (
    <g>
      {points.map((pt) => (
        <g key={texKey(pt)}>
          <circle cx={pt[0]} cy={pt[1]} r={2.1} fill={LOW} />
          <circle cx={pt[0] - 0.6} cy={pt[1] - 0.7} r={0.9} fill={HI} />
        </g>
      ))}
    </g>
  );
}

function sideLength(style: 'locs' | 'braids', color: string): ReactNode {
  if (style === 'locs') {
    return (
      <g strokeLinecap="round">
        {LOC_SIDE.map((x) => (
          <line
            key={`loc-${String(x)}`}
            x1={x}
            y1={46}
            x2={x}
            y2={96}
            stroke={color}
            strokeWidth={6.5}
          />
        ))}
        {LOC_SIDE.map((x) =>
          SIDE_SEG_Y.map((y) => (
            <line
              key={`seg-${String(x)}-${String(y)}`}
              x1={x - 2.8}
              y1={y}
              x2={x + 2.8}
              y2={y + 1.5}
              stroke={LOW}
              strokeWidth={1.3}
              strokeLinecap="round"
            />
          )),
        )}
      </g>
    );
  }
  return (
    <g>
      {BRAID_SIDE.map((x) => (
        <g key={`braid-${String(x)}`}>
          {SIDE_SEG_Y.map((y, i) => {
            const dx = i % 2 === 0 ? -1.7 : 1.7;
            return (
              <g key={`bs-${String(x)}-${String(y)}`}>
                <ellipse cx={x + dx} cy={y} rx={3.3} ry={2.9} fill={color} />
                <path
                  d={`M${String(x - 2.8)},${String(y)} Q${String(x + dx)},${String(y - 2)} ${String(x + 2.8)},${String(y)}`}
                  fill="none"
                  stroke={LOW}
                  strokeWidth={1.1}
                />
              </g>
            );
          })}
          <circle cx={x} cy={91} r={2.5} fill={brand.colors.primary} />
          <circle cx={x} cy={91} r={0.9} fill={brand.colors.crownGold} />
        </g>
      ))}
    </g>
  );
}

function rows(paths: readonly string[]): ReactNode {
  return (
    <g fill="none" strokeLinecap="round">
      <g stroke={LOW} strokeWidth={1.5}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g stroke={HI} strokeWidth={0.6}>
        {paths.map((d) => (
          <path key={`hi-${d}`} d={d} />
        ))}
      </g>
    </g>
  );
}

function hairArt(style: string, color: string): { back: ReactNode; front: ReactNode | null } {
  switch (style) {
    case 'afro':
      return {
        back: (
          <g fill={color}>
            <circle cx={50} cy={43} r={28} />
            {AFRO_EDGE.map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={5} />
            ))}
            {stipple(AFRO_TEX)}
          </g>
        ),
        front: (
          <g fill={color}>
            {(
              [
                [36, 31],
                [44, 28],
                [56, 28],
                [64, 31],
              ] as Pt[]
            ).map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={4.2} />
            ))}
          </g>
        ),
      };
    case 'coils':
      return {
        back: (
          <g>
            <circle cx={50} cy={44} r={26} fill={color} />
            {COIL_EDGE.map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={4.2} fill={color} />
            ))}
            {COIL_TEX.map((pt) => (
              <circle
                key={`c-${texKey(pt)}`}
                cx={pt[0]}
                cy={pt[1]}
                r={2.6}
                fill="none"
                stroke={LOW}
                strokeWidth={1.5}
              />
            ))}
          </g>
        ),
        front: (
          <g fill="none" stroke={LOW} strokeWidth={1.5}>
            {(
              [
                [37, 30],
                [45, 27.5],
                [55, 27.5],
                [63, 30],
              ] as Pt[]
            ).map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={3} />
            ))}
          </g>
        ),
      };
    case 'locs':
      return {
        back: null,
        front: (
          <g>
            <path d={CAP_PATH} fill={color} />
            {rows(CAP_ROWS)}
            {sideLength('locs', color)}
          </g>
        ),
      };
    case 'braids':
      return {
        back: null,
        front: (
          <g>
            <path d={CAP_PATH} fill={color} />
            <path d="M50,24 V39" stroke={LOW} strokeWidth={1} fill="none" />
            {sideLength('braids', color)}
          </g>
        ),
      };
    case 'cornrows':
      return {
        back: (
          <g>
            <circle cx={50} cy={18} r={7.5} fill={color} />
            {stipple(coilField(50, 18, 6.5, 4.5))}
          </g>
        ),
        front: (
          <g>
            <path d={CAP_PATH} fill={color} />
            {rows(CORNROW_ROWS)}
          </g>
        ),
      };
    case 'ponytail':
      return {
        back: (
          <g>
            <circle cx={50} cy={15} r={10} fill={color} />
            {stipple(coilField(50, 15, 9, 5))}
          </g>
        ),
        front: (
          <g>
            <path d={CAP_PATH} fill={color} />
            {rows(PONY_SWEEP)}
            <ellipse cx={50} cy={25} rx={4.5} ry={2.6} fill={brand.colors.secondary} />
          </g>
        ),
      };
    case 'puffs':
    default:
      return {
        back: (
          <g fill={color}>
            <circle cx={50} cy={43} r={21} />
            <circle cx={33} cy={27} r={12} />
            <circle cx={67} cy={27} r={12} />
            {PUFF_EDGE_L.map((pt) => (
              <circle key={`l-${texKey(pt)}`} cx={pt[0]} cy={pt[1]} r={3.4} />
            ))}
            {PUFF_EDGE_R.map((pt) => (
              <circle key={`r-${texKey(pt)}`} cx={pt[0]} cy={pt[1]} r={3.4} />
            ))}
            {stipple(PUFF_L_TEX)}
            {stipple(PUFF_R_TEX)}
          </g>
        ),
        front: (
          <g fill={color}>
            {(
              [
                [40, 30],
                [50, 28.5],
                [60, 30],
              ] as Pt[]
            ).map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={3.4} />
            ))}
          </g>
        ),
      };
  }
}

function Eyes({ shape }: { shape: string }) {
  if (shape === 'almond') {
    return (
      <g>
        <ellipse cx={42} cy={51} rx={3.9} ry={2.7} fill={FEATURE} />
        <ellipse cx={58} cy={51} rx={3.9} ry={2.7} fill={FEATURE} />
        <path
          d="M38,50 Q42,47.8 46,49.6"
          stroke={FEATURE}
          strokeWidth={1.3}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M54,49.6 Q58,47.8 62,50"
          stroke={FEATURE}
          strokeWidth={1.3}
          fill="none"
          strokeLinecap="round"
        />
        <circle cx={43} cy={50.2} r={0.9} fill={WHITE} />
        <circle cx={59} cy={50.2} r={0.9} fill={WHITE} />
      </g>
    );
  }
  if (shape === 'wide') {
    return (
      <g>
        <ellipse cx={42} cy={51} rx={3.6} ry={4.4} fill={FEATURE} />
        <ellipse cx={58} cy={51} rx={3.6} ry={4.4} fill={FEATURE} />
        <circle cx={43.4} cy={49.2} r={1.4} fill={WHITE} />
        <circle cx={59.4} cy={49.2} r={1.4} fill={WHITE} />
        <circle cx={41} cy={52.6} r={0.7} fill={WHITE} />
        <circle cx={57} cy={52.6} r={0.7} fill={WHITE} />
      </g>
    );
  }
  if (shape === 'soft') {
    return (
      <g stroke={FEATURE} strokeWidth={2.2} strokeLinecap="round" fill="none">
        <path d="M38.5,51 Q42,53.6 45.5,51" />
        <path d="M54.5,51 Q58,53.6 61.5,51" />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx={42} cy={51} rx={3.1} ry={3.9} fill={FEATURE} />
      <ellipse cx={58} cy={51} rx={3.1} ry={3.9} fill={FEATURE} />
      <circle cx={43.2} cy={49.6} r={1.1} fill={WHITE} />
      <circle cx={59.2} cy={49.6} r={1.1} fill={WHITE} />
    </g>
  );
}

function Nose({ shape }: { shape: string }) {
  if (shape === 'round') {
    return (
      <g>
        <ellipse cx={50} cy={55.4} rx={1.5} ry={1} fill={LOW} />
        <path
          d="M48.6,55 Q50,57.2 51.4,55"
          stroke={LOW}
          strokeWidth={1.1}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  if (shape === 'wide') {
    return (
      <g>
        <circle cx={48.3} cy={56} r={0.8} fill={LOW} />
        <circle cx={51.7} cy={56} r={0.8} fill={LOW} />
        <path
          d="M47.6,55 Q50,57.6 52.4,55"
          stroke={LOW}
          strokeWidth={1.1}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  if (shape === 'narrow') {
    return (
      <path
        d="M49.6,53 L49.4,55.4 Q50,56.2 50.6,55.4 L50.4,53"
        stroke={LOW}
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      d="M49.3,55 Q50,56.5 50.7,55"
      stroke={LOW}
      strokeWidth={1.2}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function Mouth({ shape }: { shape: string }) {
  if (shape === 'full') {
    return (
      <g>
        <path d="M44.5,60.2 Q50,58 55.5,60.2 Q50,61 44.5,60.2 Z" fill={LIP} />
        <path d="M44.5,60.2 Q50,64.6 55.5,60.2 Q50,61 44.5,60.2 Z" fill={LIP} />
        <path
          d="M45,60.5 Q50,61.2 55,60.5"
          stroke={FEATURE}
          strokeWidth={0.8}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  if (shape === 'grin') {
    return (
      <g>
        <path d="M43,60 Q50,68 57,60 Q50,63 43,60 Z" fill={FEATURE} />
        <path d="M45.5,63.5 Q50,65.5 54.5,63.5" fill="#E0748B" />
      </g>
    );
  }
  if (shape === 'soft') {
    return (
      <path
        d="M46,61 Q50,62.8 54,61"
        stroke={FEATURE}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <path
      d="M45,60.5 Q50,65.5 55,60.5"
      stroke={FEATURE}
      strokeWidth={2.2}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function Face({ eyes, nose, mouth }: { eyes: string; nose: string; mouth: string }) {
  return (
    <g>
      <g fill={brand.colors.primary} opacity={0.32}>
        <circle cx={36} cy={58} r={3.7} />
        <circle cx={64} cy={58} r={3.7} />
      </g>
      <g stroke={FEATURE} strokeWidth={1.5} strokeLinecap="round" fill="none">
        <path d="M38.5,44.5 Q42,43 45.5,44.5" />
        <path d="M54.5,44.5 Q58,43 61.5,44.5" />
      </g>
      <Eyes shape={eyes} />
      <Nose shape={nose} />
      <Mouth shape={mouth} />
    </g>
  );
}

function Crown({ kind }: { kind: string }) {
  const gold = brand.colors.crownGold;
  const edge = brand.colors.secondary;
  if (kind === 'none') {
    return null;
  }
  if (kind === 'tiara') {
    return (
      <g stroke={edge} strokeWidth={1} strokeLinejoin="round">
        <path d="M37,31 Q50,21 63,31 Q50,27 37,31 Z" fill={gold} />
        <circle cx={50} cy={25.5} r={2.4} fill={brand.colors.primary} stroke="none" />
      </g>
    );
  }
  if (kind === 'flowers') {
    return (
      <g stroke="none">
        {(
          [
            [37, 29],
            [50, 26],
            [63, 29],
          ] as Pt[]
        ).map((pt) => (
          <g key={texKey(pt)}>
            <circle cx={pt[0]} cy={pt[1]} r={4} fill={brand.colors.primary} />
            <circle cx={pt[0]} cy={pt[1]} r={1.7} fill={gold} />
          </g>
        ))}
      </g>
    );
  }
  if (kind === 'halo') {
    return <ellipse cx={50} cy={15} rx={15} ry={4} fill="none" stroke={gold} strokeWidth={2.6} />;
  }
  return (
    <g stroke={edge} strokeWidth={1} strokeLinejoin="round">
      <path d="M35,31 L38,20 L44,27 L50,16 L56,27 L62,20 L65,31 Z" fill={gold} />
      <g fill={brand.colors.primary} stroke="none">
        <circle cx={38} cy={20} r={1.5} />
        <circle cx={50} cy={16} r={1.7} />
        <circle cx={62} cy={20} r={1.5} />
      </g>
    </g>
  );
}

export function AvatarCoin({
  config,
  size = 96,
  title,
}: {
  config: AvatarConfig;
  size?: number;
  title?: string | undefined;
}) {
  const id = useId();
  const clipId = `${id}-clip`;
  const bgId = `${id}-bg`;
  const skin = skinFill(config.skin);
  const head = HEAD_SHAPES[config.faceShape] ?? ROUND_HEAD;
  const hair = hairArt(config.hair, hairFill(config.hairColor));

  return (
    <svg
      className="avatar-coin-svg"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title ?? describeAvatar(config)}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={50} cy={50} r={50} />
        </clipPath>
        <radialGradient id={bgId} cx="50%" cy="36%" r="78%">
          <stop offset="0%" stopColor={brand.colors.surfaceLight} />
          <stop offset="100%" stopColor={brand.colors.accent} />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle cx={50} cy={50} r={50} fill={`url(#${bgId})`} />
        {hair.back}
        {/* Neck first, then shoulders over its base, then the head over the
            neck top — no gap between chin and shoulders. */}
        <rect x={44} y={62} width={12} height={18} rx={5} fill={skin} />
        <path d="M18,100 Q18,80 50,80 Q82,80 82,100 Z" fill={brand.colors.secondary} />
        <circle cx={head.earX} cy={53} r={3.3} fill={skin} />
        <circle cx={100 - head.earX} cy={53} r={3.3} fill={skin} />
        <path d={head.path} fill={skin} />
        <Face eyes={config.eyes} nose={config.nose} mouth={config.mouth} />
        {hair.front}
        <Crown kind={config.crown} />
      </g>
    </svg>
  );
}
