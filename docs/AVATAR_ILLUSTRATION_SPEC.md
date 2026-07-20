# Avatar Illustration Spec — "Build Your Crown"

> **For:** the illustrator producing the avatar art for Royal Diadem's Queen Card avatar builder.
> **Owner:** Royal Diadem (Envision VirtualEdge Group build team).
> **Status:** authoritative asset brief. The app's avatar *builder* (data model, validation, storage,
> UI) is already built; this spec defines the **illustrated layers** that drop into it. Every option
> key below is the exact string the code expects — match them and the art composes with no code
> changes.

---

## 1. Who this is for (read this first)

Royal Diadem is a Houston nonprofit that has walked alongside **young Black women ages 11–19** since
2007, building confidence and sisterhood. The avatar a girl builds is how she sees *herself* in the
app. That makes authenticity non-negotiable:

- **Black hair, rendered right.** Afros, coils, locs, box braids, cornrows, puffs and ponytails must
  read as the real styles — genuine coil/braid **texture**, worn correctly (pulled back **off the
  face**, not hanging over it). No flat silhouettes standing in for textured hair.
- **The full range of Black features, with dignity.** Varied nose widths, a **full-lips** option,
  a range of eye shapes and rich deep skin tones — drawn warmly and beautifully, never as caricature.
- **Warm, cute, aspirational.** These girls are treated as royalty; the art should feel like a
  friend and a crown, not a clinical avatar. The **crown** motif is core to the brand.

If a choice is between "technically flexible" and "authentic and cute," choose authentic and cute.

---

## 2. What the app already provides (your boundary)

You draw **only** the character layers. The app supplies:

- The **coin**: a circular frame, `100×100` canvas, clipped to a circle of radius 50 at center
  `(50,50)`, with a warm radial background (peach → blush). **Do not draw a background** — deliver
  transparent art.
- The **composition + recolour engine**: it stacks your layers in the documented order and tints the
  recolourable ones (skin, hair) to the chosen palette entry at runtime.
- Rendering at **32 px to ~220 px**. Your art must stay legible at coin size (~40 px), so keep
  strokes ≥ ~1.2 units and avoid detail finer than ~1 unit.

---

## 3. Canvas, coordinates & registration

**Canvas:** `viewBox="0 0 100 100"`, origin top-left, y increases downward. Every layer is drawn on
this **same** canvas with the **same anchors** so any combination registers perfectly. Keep essential
content within radius ~46 of center (the coin clips at 50; corners are cut).

**Anchor map** (portrait faces forward, centered on `x=50`):

| Feature | Anchor (x, y) | Notes |
|---|---|---|
| Coin center / clip | (50, 50), r=50 | app-provided background & clip |
| Crown / hairline top | y ≈ 23–27 | top of the head |
| Brow line | y ≈ 44–45 | |
| Eye line | y ≈ 51 | left eye ~x42, right eye ~x58 (≈16 apart) |
| Nose | (50, ≈55) | |
| Mouth center | (50, ≈61) | |
| Ears | sides at y ≈ 53 | move inward for narrow face shapes |
| Neck | x ≈ 44–56, y ≈ 62–80 | |
| Shoulders begin | y ≈ 80 | garment fills to bottom |
| Side hair length | x ≈ 18–27 & 73–82, down to y ≈ 96 | falls over the shoulders, **never across the face (x33–67)** |

---

## 4. Layer order (back → front)

Deliver each option as its **own** transparent layer. The engine stacks them in this z-order:

| # | Layer | Facet | Recolour |
|---|---|---|---|
| 0 | Background | — | app-provided (skip) |
| 1 | Hair — back (volume/length behind head) | `hair` | hair palette |
| 2 | Neck | (part of face base) | skin palette |
| 3 | Shoulders / garment | — (shared) | brand fixed |
| 4 | Head + ears (face base, per face shape) | `faceShape` | skin palette |
| 5 | Brows | (shared) | fixed dark |
| 6 | Eyes | `eyes` | fixed dark (+ white catchlight) |
| 7 | Blush (shared, subtle) | — | brand pink @ ~30% |
| 8 | Nose | `nose` | translucent shadow (tone-agnostic) |
| 9 | Mouth | `mouth` | lip rose (see palette) |
| 10 | Hair — front (crown cover, face framing, side length, on-scalp rows) | `hair` | hair palette |
| 11 | Crown / accessory | `crown` | brand gold/pink |

The **face base** (layer 4) may include neck and ears as one skin-tinted piece. Hairstyles are split
into **back** (behind the head) and **front** (crown coverage + framing/length) pieces so the head
sits between them — see §7.

---

## 5. The recolour rule (most important technical instruction)

Skin and hair are tinted at runtime by swapping **one fill**. So every recolourable region must be:

- **One flat base fill**, declared as a CSS variable so the app can set it:
  - skin regions: `fill="var(--rd-skin, #D99C77)"`
  - hair regions: `fill="var(--rd-hair, #1C1712)"`
- **All shading and texture done with translucent overlays on top** — shadows as **black at
  ~18–26 % opacity**, highlights as **white at ~12–16 % opacity**. **Never** shade by using a darker
  or lighter *opaque* shade of the base colour. (An opaque darker brown would stay brown when we tint
  to espresso; a translucent black shadow rides correctly on all six tones and all five hair colours.)

This lets you draw each hairstyle **once** and each face base **once**, and have them look right in
every tone. If a region is genuinely not recolourable (crown gold, lips, eye dark), use a fixed hex
from §6.

---

## 6. Palettes (exact values)

**Skin tones** — `skin` facet (6). App sets `--rd-skin` to one of these:

| key | name | hex |
|---|---|---|
| `porcelain` | Porcelain | `#F7D9C4` |
| `honey` | Honey | `#EFC1A0` |
| `golden` | Golden | `#D99C77` |
| `amber` | Amber | `#B87A50` |
| `chestnut` | Chestnut | `#8D5A38` |
| `espresso` | Espresso | `#5C3A26` |

**Hair colours** — `hairColor` facet (5). App sets `--rd-hair`:

| key | name | hex |
|---|---|---|
| `black` | Black | `#1C1712` |
| `espresso` | Espresso | `#3B2A1E` |
| `chestnut` | Chestnut | `#6B4429` |
| `auburn` | Auburn | `#8C3B22` |
| `honey` | Honey | `#B67A3D` |

**Fixed brand colours** (crowns, lips, garment, features):

| use | hex |
|---|---|
| Crown gold | `#F0B0A0` |
| Brand pink (gems, blush, beads) | `#E05070` |
| Deep magenta (garment, outlines) | `#C01050` |
| Lip rose (default mouth) | `#B4566A` |
| Feature dark (eyes, brows) | `#3A2A28` |

---

## 7. The facets & options (deliver every one)

Each option below is a separate layer file. **File key = the string in `key`** — name files exactly
(see §8). Short descriptions set direction; use your craft for the rest.

### 7.1 `faceShape` — 5 (skin-tinted face base: head + neck + ears)
| key | direction |
|---|---|
| `round` | soft full circle-ish face |
| `oval` | slightly narrower, taller |
| `heart` | wider cheeks/temples, softly pointed chin |
| `square` | broader jaw, soft corners, flatter chin |
| `long` | narrower, elongated |

Keep the **cranium/eye region width consistent** across shapes so shared features and hair register;
let the **jaw and chin** carry the difference.

### 7.2 `eyes` — 5 (fixed dark + white catchlight)
| key | direction |
|---|---|
| `round` | large, open, friendly; bright catchlight |
| `almond` | elegant almond with a soft upper lash line |
| `wide` | big and doll-like, extra sparkle |
| `upturned` | gentle cat-eye lift at the outer corner |
| `soft` | relaxed, gently closed/curved — calm |

### 7.3 `nose` — 4 (subtle, translucent shadow so it rides any skin tone)
| key | direction |
|---|---|
| `button` | tiny, soft |
| `rounded` | small rounded tip with soft nostrils |
| `wide` | broader base and nostrils |
| `narrow` | slim bridge and tip |

### 7.4 `mouth` — 5 (lip rose `#B4566A`, recolour optional)
| key | direction |
|---|---|
| `smile` | gentle warm smile |
| `full` | **full lips**, neutral — upper + lower lip |
| `grin` | open happy smile, teeth/tongue hint |
| `soft` | small, calm |
| `small` | petite, closed |

### 7.5 `hair` — 7 (hair-tinted; **back** + **front** pieces as noted; **worn off the face**)
| key | pieces | direction |
|---|---|---|
| `afro` | front (+ optional back halo) | full rounded afro, **coil texture** all through, bumpy edge |
| `coils` | back + front | defined springy coils/ringlets — the coils must be *evident*, not a smooth mass |
| `locs` | front (cap) + side length | swept-back crown; **segmented locs** fall at the sides/back; rope texture |
| `braids` | front (cap) + side length | **box braids**: distinct woven strands with the plait pattern; optional beads/cuffs (brand pink + gold) at the ends |
| `cornrows` | front (rows on scalp) + back bun | flat **cornrow rows** following the scalp, gathered into a bun/puff at the back |
| `ponytail` | front (sleek crown + tie) + back (gathered tail) | hair swept up into a **ponytail/puff** with a tie; textured tail |
| `puffs` | back (two puffs) + front (edge) | two **afro puffs** up top, coil texture |

Every style: hair covers the crown/hairline and frames the **sides** of the head; the **face
(x33–67) stays clear**. Length hangs at the sides (x≈18–27 / 73–82), draping over the shoulders, not
across the cheeks.

### 7.6 `crown` — 5 (fixed brand gold/pink)
| key | direction |
|---|---|
| `classic` | 3–5 point crown with gem accents, sits on the hairline |
| `tiara` | low tiara band with a center gem |
| `flowers` | flower crown across the hairline (brand pink petals, gold centers) |
| `halo` | thin gold ring floating just above the head |
| `none` | *no asset* — empty |

### 7.7 Shared layers
- **Brows** — one subtle, soft pair (feature dark). *Optional:* 2 variants (`soft`, `bold`).
- **Blush** — one subtle pair of cheeks, brand pink at ~30 %.

### 7.8 Extensibility (nice-to-have, not required)
Accessories designed as their own top layer would extend the builder later: **earrings** (studs,
hoops), **glasses**, **headwrap/scarf**. Deliver only if in scope; same canvas/anchors.

---

## 8. Deliverables & format

1. **Layered SVGs**, one file per option, on the `100×100` canvas, transparent, named exactly:
   ```
   face/round.svg  face/oval.svg  face/heart.svg  face/square.svg  face/long.svg
   eyes/round.svg  eyes/almond.svg  eyes/wide.svg  eyes/upturned.svg  eyes/soft.svg
   nose/button.svg  nose/rounded.svg  nose/wide.svg  nose/narrow.svg
   mouth/smile.svg  mouth/full.svg  mouth/grin.svg  mouth/soft.svg  mouth/small.svg
   hair/afro-front.svg      hair/afro-back.svg        (back optional)
   hair/coils-front.svg     hair/coils-back.svg
   hair/locs-front.svg      hair/locs-back.svg        (back optional)
   hair/braids-front.svg    hair/braids-back.svg      (back optional)
   hair/cornrows-front.svg  hair/cornrows-back.svg
   hair/ponytail-front.svg  hair/ponytail-back.svg
   hair/puffs-front.svg     hair/puffs-back.svg
   brows/soft.svg   blush/blush.svg
   crown/classic.svg  crown/tiara.svg  crown/flowers.svg  crown/halo.svg
   ```
2. **Pure vector, self-contained.** No embedded raster images, no external fonts, no linked
   resources, no `<image href>`. SVG only. Optimize (e.g. SVGO) but keep the `--rd-skin` /
   `--rd-hair` variables and the layer structure intact.
3. **Recolour compliance** (§5): skin/hair fills use the CSS variables; shading is translucent
   black/white overlays only.
4. **A preview sheet** (one PNG or SVG) showing ~9 fully composed avatars spanning the range of skin
   tones, hairstyles and features, so we can sanity-check registration and vibe.
5. **Editable source** (Figma / Illustrator) for future edits.
6. **License:** full commercial rights assigned to Royal Diadem — perpetual, worldwide, including the
   right to modify and to recolour — suitable for a product serving minors. Confirm the work is
   original (no third-party stock that restricts this).

---

## 9. Technical constraints (hard requirements)

- Legible at **40 px**: min stroke ~1.2 units; no essential detail < ~1 unit.
- **Offline-safe:** nothing that fetches anything (the app is an offline PWA); fully inline vector.
- **No text**, no real brand logos inside the avatar art.
- Transparent background; content within the safe radius (§3).
- Faces forward, symmetric enough to compose; **face area kept clear of hair** (§7.5).

---

## 10. Acceptance criteria

An option set is accepted when:

- [ ] Every file in §8 is present, correctly named, on the `100×100` canvas with the §3 anchors.
- [ ] Any skin tone × any face × any eyes/nose/mouth × any hair × any hair colour × any crown
      **composes cleanly** — no misalignment, no hair crossing the face, no gaps at neck/shoulders.
- [ ] Skin and hair recolour correctly across **all** palette entries via the single-fill rule (§5).
- [ ] Coils read as coils, braids as braided, locs as segmented — **texture is present** at coin size.
- [ ] Full-lips, varied noses, deep skin tones all render with warmth and dignity.
- [ ] It reads as **cute and aspirational** at 40 px and at 200 px.

---

## 11. How it plugs into the app (for reference)

The builder composes an `AvatarConfig` — `{ skin, faceShape, eyes, nose, mouth, hair, hairColor,
crown }` — from these exact keys, validates them server-side against this vocabulary, and stores the
chosen keys (not an image). The renderer stacks your layers in the §4 order and sets `--rd-skin` /
`--rd-hair`. Swapping the current placeholder SVG for your assets is a drop-in: no new keys, no schema
change. Adding an option later = one new file + one key in two places (the vocabulary module and the
server mirror).

*Questions on anchors, palettes, or edge cases → ask before drawing the full set; a quick alignment
check on one composed avatar first will save a round.*
