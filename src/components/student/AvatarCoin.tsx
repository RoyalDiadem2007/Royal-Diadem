/**
 * AvatarCoin — renders a student's composed avatar (AvatarConfig) as a warm,
 * textured illustrated portrait inside a circular coin. Everything is drawn
 * in-app from her facet choices: no photograph, no upload, nothing generated
 * by an external service, nothing to moderate.
 *
 * The hair vocabulary centres real Black hairstyles rendered with real
 * texture — afro and coils as stippled, ringed volume; locs as segmented
 * ropes; box braids as woven strands with beads; cornrows as scalp rows to a
 * puff — not flat silhouettes. Skin/hair colours come from the avatar
 * palette; the crown, beads and backdrop read from branding.config so the
 * coin stays inside the brand's world.
 *
 * Layer order back→front: backdrop, hair behind, neck, shoulders, head, ears,
 * face, hair framing/on-scalp, crown.
 */
import { useId, type ReactNode } from 'react';
import { describeAvatar, hairFill, skinFill, type AvatarConfig } from '@/lib/avatarBuilder';
import { brand } from '@/config/branding.config';

const FEATURE = '#3A2A28';
const LOW = 'rgba(0,0,0,0.24)';
const HI = 'rgba(255,255,255,0.16)';

/** Head outlines by face shape. The cranium (top/eye region) stays a
 * consistent width so hair still frames; the jaw and chin carry the
 * difference. earX is where the ear meets each side. */
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

/** A staggered field of points filling a disc — the base of coil/afro texture. */
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

/** Points around the top arc of a circle — the bumpy edge of an afro/puff. */
function topScallops(cx: number, cy: number, rad: number, count: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = Math.PI + (Math.PI * i) / (count - 1); // top half, left→right
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  return pts;
}

const AFRO_TEX = coilField(50, 43, 28, 6.4);
const AFRO_EDGE = topScallops(50, 43, 29, 15);
const COIL_TEX = coilField(50, 44, 26, 5.6);
const PUFF_L_TEX = coilField(33, 27, 12, 5);
const PUFF_R_TEX = coilField(67, 27, 12, 5);
const PUFF_EDGE_L = topScallops(33, 27, 12.5, 9);
const PUFF_EDGE_R = topScallops(67, 27, 12.5, 9);

const LOC_XS: readonly number[] = [26, 35, 44, 53, 62, 71];
const LOC_SEG_Y: readonly number[] = [34, 42, 50, 58, 66, 74];
const BRAID_XS: readonly number[] = [29, 40, 50, 60, 71];
const BRAID_SEG_Y: readonly number[] = [32, 39, 46, 53, 60, 67, 74];
const CORNROW_PATHS: readonly string[] = [
  'M30,55 Q33,30 50,25',
  'M39,58 Q40,32 50,25',
  'M50,59 L50,25',
  'M61,58 Q60,32 50,25',
  'M70,55 Q67,30 50,25',
];

function texKey(pt: Pt): string {
  return `${String(pt[0])}-${String(pt[1])}`;
}

/** Stipple + a lighter fleck on each point: reads as tight coil texture. */
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

function hairArt(style: string, color: string): { back: ReactNode; front: ReactNode | null } {
  switch (style) {
    case 'afro':
      return {
        back: (
          <g>
            <circle cx={50} cy={43} r={28} fill={color} />
            {AFRO_EDGE.map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={5} fill={color} />
            ))}
            {stipple(AFRO_TEX)}
          </g>
        ),
        front: (
          <g>
            {[
              [36, 31],
              [44, 28],
              [56, 28],
              [64, 31],
            ].map(([x, y]) => (
              <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={4.2} fill={color} />
            ))}
          </g>
        ),
      };
    case 'coils':
      return {
        back: (
          <g>
            <circle cx={50} cy={44} r={26} fill={color} />
            {topScallops(50, 44, 26, 13).map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={4.2} fill={color} />
            ))}
            {COIL_TEX.map((pt) => (
              <circle
                key={texKey(pt)}
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
          <g>
            {[
              [37, 30],
              [45, 27.5],
              [55, 27.5],
              [63, 30],
            ].map(([x, y]) => (
              <circle
                key={`${String(x)}-${String(y)}`}
                cx={x}
                cy={y}
                r={3}
                fill="none"
                stroke={LOW}
                strokeWidth={1.5}
              />
            ))}
          </g>
        ),
      };
    case 'locs':
      return {
        back: <circle cx={50} cy={42} r={23} fill={color} />,
        front: (
          <g strokeLinecap="round">
            {LOC_XS.map((x) => (
              <line
                key={`loc-${String(x)}`}
                x1={x}
                y1={28}
                x2={x}
                y2={80}
                stroke={color}
                strokeWidth={6}
              />
            ))}
            {LOC_XS.map((x) =>
              LOC_SEG_Y.map((y) => (
                <line
                  key={`seg-${String(x)}-${String(y)}`}
                  x1={x - 2.6}
                  y1={y}
                  x2={x + 2.6}
                  y2={y + 1.4}
                  stroke={LOW}
                  strokeWidth={1.3}
                  strokeLinecap="round"
                />
              )),
            )}
          </g>
        ),
      };
    case 'braids':
      return {
        back: <circle cx={50} cy={42} r={23} fill={color} />,
        front: (
          <g>
            {BRAID_XS.map((x) => (
              <g key={`braid-${String(x)}`}>
                {BRAID_SEG_Y.map((y, i) => {
                  const dx = i % 2 === 0 ? -1.8 : 1.8;
                  return (
                    <g key={`bs-${String(x)}-${String(y)}`}>
                      <ellipse cx={x + dx} cy={y} rx={3.6} ry={3} fill={color} />
                      <path
                        d={`M${String(x - 3)},${String(y)} Q${String(x + dx)},${String(y - 2)} ${String(x + 3)},${String(y)}`}
                        fill="none"
                        stroke={LOW}
                        strokeWidth={1.2}
                      />
                    </g>
                  );
                })}
                <circle cx={x} cy={78} r={2.6} fill={brand.colors.primary} />
                <circle cx={x} cy={78} r={1} fill={brand.colors.crownGold} />
              </g>
            ))}
          </g>
        ),
      };
    case 'cornrows':
      return {
        back: (
          <g>
            <circle cx={50} cy={20} r={7.5} fill={color} />
            {stipple(coilField(50, 20, 6.5, 4.5))}
          </g>
        ),
        front: (
          <g fill="none" strokeLinecap="round">
            <path d="M27,49 Q27,29 50,26 Q73,29 73,49 Q50,40 27,49 Z" fill={color} stroke="none" />
            {CORNROW_PATHS.map((d) => (
              <path key={d} d={d} stroke={LOW} strokeWidth={1.6} />
            ))}
            {CORNROW_PATHS.map((d) => (
              <path key={`hi-${d}`} d={d} stroke={HI} strokeWidth={0.7} />
            ))}
          </g>
        ),
      };
    case 'puffs':
    default:
      return {
        back: (
          <g>
            <circle cx={50} cy={43} r={21} fill={color} />
            <circle cx={33} cy={27} r={12} fill={color} />
            <circle cx={67} cy={27} r={12} fill={color} />
            {PUFF_EDGE_L.map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={3.4} fill={color} />
            ))}
            {PUFF_EDGE_R.map((pt) => (
              <circle key={texKey(pt)} cx={pt[0]} cy={pt[1]} r={3.4} fill={color} />
            ))}
            {stipple(PUFF_L_TEX)}
            {stipple(PUFF_R_TEX)}
          </g>
        ),
        front: (
          <g>
            {[
              [40, 30],
              [50, 28.5],
              [60, 30],
            ].map(([x, y]) => (
              <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={3.4} fill={color} />
            ))}
          </g>
        ),
      };
  }
}

function Eyes() {
  return (
    <g>
      <ellipse cx={42} cy={51} rx={3.1} ry={3.9} fill={FEATURE} />
      <ellipse cx={58} cy={51} rx={3.1} ry={3.9} fill={FEATURE} />
      <circle cx={43.2} cy={49.6} r={1.1} fill="#FFFFFF" />
      <circle cx={59.2} cy={49.6} r={1.1} fill="#FFFFFF" />
    </g>
  );
}

function Face({ expression }: { expression: string }) {
  const cheeks = (
    <g fill={brand.colors.primary} opacity={0.32}>
      <circle cx={36} cy={58} r={3.7} />
      <circle cx={64} cy={58} r={3.7} />
    </g>
  );
  const brows = (
    <g stroke={FEATURE} strokeWidth={1.5} strokeLinecap="round" fill="none">
      <path d="M38.5,44.5 Q42,43 45.5,44.5" />
      <path d="M54.5,44.5 Q58,43 61.5,44.5" />
    </g>
  );
  const nose = (
    <path
      d="M49.4,55 Q50,56.4 50.6,55"
      stroke={LOW}
      strokeWidth={1.2}
      fill="none"
      strokeLinecap="round"
    />
  );

  if (expression === 'calm') {
    return (
      <g>
        {cheeks}
        <g stroke={FEATURE} strokeWidth={2.4} strokeLinecap="round" fill="none">
          <path d="M38.5,51 Q42,53.4 45.5,51" />
          <path d="M54.5,51 Q58,53.4 61.5,51" />
        </g>
        {nose}
        <path
          d="M46,61 Q50,62.8 54,61"
          stroke={FEATURE}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  if (expression === 'joyful') {
    return (
      <g>
        {cheeks}
        <g stroke={FEATURE} strokeWidth={2.4} strokeLinecap="round" fill="none">
          <path d="M38,52 Q42,47.5 46,52" />
          <path d="M54,52 Q58,47.5 62,52" />
        </g>
        {nose}
        <path d="M43,60 Q50,68 57,60 Q50,63 43,60 Z" fill={FEATURE} />
        <path d="M45.5,63.5 Q50,65.5 54.5,63.5" fill="#E0748B" />
      </g>
    );
  }
  if (expression === 'cool') {
    return (
      <g>
        {cheeks}
        {brows}
        <Eyes />
        {nose}
        <path
          d="M45,61.5 Q49,63 57,60.5"
          stroke={FEATURE}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    );
  }
  // smile (default)
  return (
    <g>
      {cheeks}
      {brows}
      <Eyes />
      {nose}
      <path
        d="M45,60.5 Q50,65.5 55,60.5"
        stroke={FEATURE}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
      />
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
        {[
          [37, 29],
          [50, 26],
          [63, 29],
        ].map(([cx, cy]) => (
          <g key={`${String(cx)}-${String(cy)}`}>
            <circle cx={cx} cy={cy} r={4} fill={brand.colors.primary} />
            <circle cx={cx} cy={cy} r={1.7} fill={gold} />
          </g>
        ))}
      </g>
    );
  }
  if (kind === 'halo') {
    return <ellipse cx={50} cy={15} rx={15} ry={4} fill="none" stroke={gold} strokeWidth={2.6} />;
  }
  // classic
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
            neck top — so there's no gap between chin and shoulders. */}
        <rect x={44} y={62} width={12} height={18} rx={5} fill={skin} />
        <path d="M18,100 Q18,80 50,80 Q82,80 82,100 Z" fill={brand.colors.secondary} />
        <circle cx={head.earX} cy={53} r={3.3} fill={skin} />
        <circle cx={100 - head.earX} cy={53} r={3.3} fill={skin} />
        <path d={head.path} fill={skin} />
        <Face expression={config.expression} />
        {hair.front}
        <Crown kind={config.crown} />
      </g>
    </svg>
  );
}
