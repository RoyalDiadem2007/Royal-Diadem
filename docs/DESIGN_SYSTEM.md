# Royal Diadem Design System — "Modern Regal"

> **Purpose:** the single, enforceable source of truth for *how the product looks and feels*.
> It structures the visual language into **tiered tokens** and **fixed parameters** so every screen
> reads as one system — regal, warm, and dignified — and so a rebrand is a config swap, not a rewrite.
>
> **Precedence:** the user's explicit request → this system → a builder's improvisation. When a value
> isn't in a token, it doesn't exist yet — add it here first, then use it. Governance lives in
> `CLAUDE.md` (§4.5 white-label, §3 hard gates); this document is the design half of that contract.

---

## 1. Token architecture (three tiers)

Design decisions flow one direction. Never skip upward.

```
Tier 1 — BRAND (branding.config.ts → applyBrandTheme → CSS vars)
   colours, font families               ← the only tier that changes on a rebrand
        │
Tier 2 — PRIMITIVES (:root in index.css)
   spacing, type scale, radius, elevation, motion, z, focus, hairlines
        │
Tier 3 — COMPONENTS (component CSS)
   compose Tier 1 + Tier 2 tokens only — no raw hex, px, ms, or magic numbers
```

**The strength rule:** components consume tokens, never literals. No raw `#hex`, no bare `px`
spacing, no ad-hoc `ms`, no invented `z-index`. If you're typing a number into a component, it should
be a `var(--…)`. Exceptions are illustration internals (e.g. the avatar SVG geometry) and true
one-offs, which must be commented.

---

## 2. Tier 1 — Brand (the only rebrandable layer)

Set at runtime by `applyBrandTheme()` from `branding.config.ts`. **Never hardcode these** anywhere else.

### 2.1 Colour roles
| Token | Role | Value (default brand) |
|---|---|---|
| `--color-primary` | primary action, key accent | `#E05070` royal pink |
| `--color-secondary` | gradients, deep accent | `#C01050` deep magenta |
| `--color-accent` | soft accent, hairline source | `#F0C0B0` rose gold |
| `--color-surface-light` | highlights | `#F0D0C0` soft peach |
| `--color-background` | app ground | `#0A0A0A` rich black |
| `--color-card-surface` | cards | `#191114` warm near-black |
| `--color-crown-gold` | jewels, sparkle, **focus ring** | `#F0B0A0` warm gold-pink |
| `--color-text-primary` | body/heading text | `#FFFFFF` |
| `--color-text-secondary` | supporting text, labels | `#F0C0B0` |
| `--color-success` / `--color-warning` / `--color-danger` | **semantic only** | green / amber / red |

**Rules.** Spend saturation on **one** thing per view — the primary. Semantic colours
(success/warning/danger) signal state only; they are **not** decorative accents. Body text on
`--color-background` and on `--color-card-surface` must clear **WCAG AA (4.5:1)**; large text 3:1.
Never introduce a colour outside this table — derive with `color-mix()` from these tokens (as the
hairlines and field surface do).

### 2.2 Typography families
| Token | Family | Use |
|---|---|---|
| `--font-display` | Fraunces 600 (self-hosted) | headings, titles, the brand voice |
| `--font-body` | Albert Sans 400/600 + italic (self-hosted) | everything else |

Self-hosted and precached (offline PWA) — **never** a webfont CDN link.

---

## 3. Tier 2 — Primitive parameters (`:root` in `index.css`)

These are **not** brand-specific — they're the structural grammar. Fixed, finite, and the only
allowed values on their axis.

### 3.1 Spacing — 4px base, 7 steps
`--space-1 .25rem` · `--space-2 .5rem` · `--space-3 .75rem` · `--space-4 1rem` ·
`--space-5 1.5rem` · `--space-6 2rem` · `--space-7 3rem`

Use for **gap, padding, margin**. Prefer `gap` on a flex/grid parent over per-child margins. Don't
invent half-steps; if two steps feel wrong, the layout is wrong, not the scale.

### 3.2 Type scale — 9 steps
`--text-2xs .72rem` (eyebrows, meta) · `--text-xs .8rem` · `--text-sm .9rem` ·
`--text-base 1rem` (body) · `--text-md 1.125rem` · `--text-lg 1.3rem` (section titles) ·
`--text-xl 1.6rem` · `--text-2xl 2rem` · `--text-display clamp(2rem,5vw,3rem)` (page hero)

- **Weights:** `--weight-regular 400`, `--weight-semibold 600`. No other weights (only these are
  shipped). Display/titles use `--font-display` at 600.
- **Line-height:** `--leading-tight 1.15` (display), `--leading-snug 1.3` (headings),
  `--leading-normal 1.5` (body). Body copy target ≈ 65 characters wide.
- **Tracking:** `--tracking-tight -0.01em` (large display), `--tracking-label .08em` (uppercase
  labels), `--tracking-eyebrow .22em` (eyebrows). Balance headings with `text-wrap: balance`.

### 3.3 Radius — 4 steps
`--radius-sm 8px` · `--radius-control 12px` (buttons, inputs, chips) · `--radius-card 18px` (cards,
sheets) · `--radius-pill 999px` (pills, coins, toggles). One radius per element role — controls and
cards do **not** share a radius.

### 3.4 Elevation — 3 steps + button glow
`--elevation-1` (resting cards) · `--elevation-2` (popovers, the avatar coin) ·
`--elevation-3` (modals, the studio panel). `--button-shadow` is the primary button's brand-tinted
glow. Elevation is **shadow**, not border — borders are hairlines (§3.5). Higher elevation = more
important / more temporary, never decoration.

### 3.5 Borders & hairlines
`--hairline` (18% accent) for dividers and resting borders; `--hairline-strong` (36%) for inputs and
emphasis. **Modern Regal replaces full-strength borders with hairlines** — a solid 1px accent border
is a bug. `--field-surface` is the input/well fill.

### 3.6 Motion
`--duration-fast 120ms` (hovers, taps) · `--duration-base 200ms` (most transitions) ·
`--duration-slow 320ms` (entrances). Easings: `--ease-standard` (default),
`--ease-out` (entering). **Pair every duration with an easing.** Everything animated must sit inside
`@media (prefers-reduced-motion: reduce)` guards that disable non-essential motion. Animate `opacity`
and `transform` only — not layout properties.

### 3.7 Focus
`--focus-ring-width 2px` · `--focus-ring-offset 2px` · `--focus-ring-color` = crown gold. Every
interactive element shows a visible focus ring on `:focus-visible` via these tokens — never
`outline: none` without an equal-or-better replacement. Keyboard access is non-negotiable (kids on
school Chromebooks tab through everything).

### 3.8 Z-index layers
`--z-raised 10` · `--z-sticky 100` · `--z-appbar 200` · `--z-overlay 1000` · `--z-modal 1100` ·
`--z-toast 1200`. Pick a layer; never type a raw `z-index`. Toast always wins; modal beats overlay.

### 3.9 Breakpoints
`--bp-sm 480px` · `--bp-md 720px` · `--bp-lg 960px` (documented tokens; CSS can't read a var inside
`@media`, so mirror these exact values in media queries). **Design mobile-first** — this is a
phone-first PWA for students. The body must never scroll horizontally; wide content
(tables, code, the avatar gallery) scrolls inside its own `overflow-x: auto` container.

---

## 4. Component conventions (Tier 3)

Recurring patterns, all built from the tokens above:

- **Buttons.** Primary: `--button-gradient` fill + `--button-shadow`, `--radius-control`, semibold.
  Secondary/ghost: transparent + `--hairline-strong`, text in `--color-text-secondary`. One primary
  action per view.
- **Cards / sheets.** `--color-card-surface`, `--radius-card`, `--hairline` border, `--elevation-1`,
  `--space-5` padding.
- **Inputs.** `--field-surface`, `--hairline-strong`, `--radius-control`; label above in
  `--text-2xs`/`--tracking-label` uppercase `--color-text-secondary`.
- **Chips / pills / coins.** `--radius-pill`.
- **Eyebrows.** `--text-2xs`, `--tracking-eyebrow`, uppercase, `--color-text-secondary`.
- **Empty & error states.** Calm and warm, never an alarm (e.g. "Nothing needs attention 👑").
  Errors say what happened and how to recover — no stack traces, no apologies.
- **State encodes in form, not just colour** — a pill, a tilted crown, a severity stripe — so meaning
  survives colour-blindness and greyscale.

---

## 5. Voice (words are design material)

Warm, dignified, girl-facing; every student is treated as royalty. Name things by what a person
recognises, not how the system is built. Active voice; a control says exactly what it does. The crown
motif is the brand's signature — use it as affirmation, never as an alarm. (See the avatar work:
`AVATAR_ILLUSTRATION_SPEC.md`.)

---

## 6. Accessibility (non-negotiable parameters)

- **Contrast:** AA (4.5:1 text / 3:1 large & UI) on both card and background surfaces.
- **Focus:** visible ring on everything interactive (§3.7).
- **Target size:** interactive targets ≥ 44×44px (young users, phones).
- **Motion:** honour `prefers-reduced-motion`.
- **Semantics:** real roles/labels; state never conveyed by colour alone.
- **Error boundaries:** a calm fallback, never a white screen (CLAUDE.md §12).

---

## 7. How to extend this system

1. Need a value that isn't a token? **Add the token here + in `:root`** (Tier 2) or `branding.config`
   (Tier 1) first — then consume it. Never inline a literal to "just ship it."
2. New component? Compose existing tokens. If it needs a genuinely new parameter, it probably belongs
   in the scale — extend the scale, don't special-case.
3. Rebrand for another org? Change **only** `branding.config.ts` (colours, fonts) and the font files.
   Tier 2 and Tier 3 stay put — that's the proof the system has strength.

*This document is the design contract. Code that violates it — raw hex, off-scale spacing, a solid
accent border, a missing focus ring — is not done, the same way a type error isn't done.*
