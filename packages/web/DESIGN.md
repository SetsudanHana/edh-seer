---
name: EDH Seer
description: An all-in-one Commander tool — deck analysis, deckbuilding, and physical collection management — held to Scryfall/Archidekt's craft bar
version: 2
supersedes: DESIGN.md v1 (2026-08-27)
colors:
  background:
    value: "#0d0912"
  foreground:
    value: "#e9e4ef"
  surface:
    value: "#16111f"
  surface-secondary:
    value: "#1b1526"
  surface-tertiary:
    value: "#231b30"
  accent:
    value: "#c64bc6"
  fill:
    value: "#55397a"
  muted:
    value: "#948ba6"
  border:
    value: "#2c2338"
  separator:
    value: "#1f1829"
  field-background:
    value: "#120d1a"
  warning:
    value: "#d99a3d"
  danger:
    value: "#e5484d"
  success:
    value: "#34c77b"
  mana-w:
    value: "#ddd6c4"
  mana-u:
    value: "#6ba0f5"
  mana-b:
    value: "#7e7a85"
  mana-r:
    value: "#d9544f"
  mana-g:
    value: "#55a86a"
typography:
  ui:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
  heading:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 700
    letterSpacing: "-0.01em"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.1em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
rounded:
  base: "0.5rem"
  pill: "999px"
components:
  pip:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "0 0.25rem"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.base}"
  tab-active:
    textColor: "{colors.accent}"
    typography: "{typography.label}"
---

# Design System: EDH Seer

## What changed in v2, and why

v1 was written when the product was a deck analyzer: one deck in scope, one report, one
screen. The product is now an all-in-one tool covering deck analysis, deckbuilding, and
physical collection management. Three v1 rules did not survive that, and the graph UX
session (`docs/superpowers/specs/2026-08-29-graph-ux-and-build-mode.md`) contradicted two more.

| v1 rule | Status | Reason |
|---|---|---|
| Identity-driven accent | **Removed** | Requires exactly one deck in scope. Undefined on a collection screen or a multi-deck list. |
| Solid-vs-gradient rule | **Removed** | Existed only to serve the identity accent. |
| `--accent` is computed, never literal | **Inverted** | The accent is now a fixed literal and identity moved to mana pips. |
| Real `<table>` markup as a key characteristic | **Scoped** | The graph doc bans tables on the reading screens. Now scoped by object rather than stated globally. |
| Category marker tokens (Consistency / Efficiency / Synergy / Win Condition) | **Deleted** | Already unused by the shipped Cards tab. |
| Cool blue-grey neutral ladder | **Recast** | The ground is now a low-chroma violet at every tier. See Colors. |
| Blue `#5b8dee` accent | **Replaced** | Moved to magenta `#c64bc6` — a violet ground cannot also carry a violet or blue accent. |

Everything else in v1 carried forward unchanged: flat and border-driven, one radius, Inter
for words and JetBrains Mono for data, the pip as signature shape, the no-kicker rule, no
card chrome, no shadows.

**Open decisions are marked `[OPEN]` and must be resolved before the affected code is
written.** They are not oversights; they are choices this document deliberately does not
make on the reader's behalf.

---

## Overview

**Creative North Star: "The Category Standard, Executed"**

Unchanged from v1, and it survives the scope expansion intact. This is not a novel visual
world. It is a conventional dark tool, held to the craft bar of Scryfall and
Archidekt/Moxfield — the products it actually competes with — rather than a generic SaaS
template or an illustrated MTG-card pastiche.

The expansion to collection management strengthens rather than weakens this. Collection
tools are dense, tabular, and stateful; the restraint that made the analyzer readable is
the same restraint that keeps four thousand rows legible.

**Key characteristics:**
- One typeface family per register — Inter for words, JetBrains Mono for numbers and labels.
  No display face, no serif.
- Flat, border-driven surfaces on a near-black violet ground. Zero `box-shadow` in the system.
- One fixed accent, deliberately outside the WUBRG gamut and off the ground's own hue.
- Deck colour identity is data, shown as mana pips — never chrome.
- Filled versus hollow is the system's one recurring state distinction (see Named Rules).

---

## Colors

Near-monochrome violet dark, one fixed accent, a fill, a small semantic set, and a five-hue
mana scale. The neutral ladder is not grey — it is a single violet hue (~272°) held at low
chroma and stepped by lightness. The mana scale is the only place in the system where hue
carries domain meaning.

### Neutral ladder

- **Background** (`#0d0912`): page background. Near-black with a violet cast, never pure black.
- **Field background** (`#120d1a`): input fills, one step above the page.
- **Surface** (`#16111f`): first panel tier.
- **Surface Secondary** (`#1b1526`): second tier — filled controls at rest.
- **Surface Tertiary** (`#231b30`): third tier.
- **Separator** (`#1f1829`): list and table row dividers, hairlines, unfilled tracks.
- **Border** (`#2c2338`): structural border and field-border colour.
- **Muted** (`#948ba6`): secondary text, placeholders, inactive labels.
- **Foreground** (`#e9e4ef`): primary text. Off-white with the same violet cast, never `#fff`.

Every step shares one hue. Saturation falls as lightness rises so the upper tiers do not
turn candy, and neither end is neutral — a pure grey or a pure white anywhere in this ladder
reads as a mistake, because it breaks the cast that makes the ground look deliberate rather
than like a purple theme bolted onto a grey app.

### Primary

- **Accent** (`#c64bc6`): the system's one accent. Active tab underline and text, focus
  ring, primary action, selected filter chip, combo connector, emphasis pips. Fixed and literal.
- **Fill** (`#55397a`): progress-bar fills, proportion bars, chart bars. Never text, never a
  border, never a surface behind content.

The accent is magenta because the ground is violet. An accent that shares its hue with the
substrate stops reading as an accent — this is why the accent could not stay at the former
`bucket-synergy` violet once the ladder was recast. Magenta separates by chroma and hue
shift, and remains **outside WUBRG**, so a magenta underline can never be misread as mana.

`--fill` exists so that bars do not all render magenta. Bars are large areas; the accent is
meant to be scarce. The fill is a mid-violet drawn from the same hue as the ladder, so a
proportion bar reads as part of the substrate rather than as an alert.

### Semantic

- **Warning** (`#d99a3d`): amber.
- **Danger** (`#e5484d`): unresolved-card state, destructive actions.
- **Success** (`#34c77b`): completion, quota met.

Danger and the accent are the closest pair in the system — a red and a magenta, roughly 58°
apart. They are distinguishable but will read as related at a glance, so they must never
carry opposed meanings in the same component. A danger pip beside an accent pip in one row
is acceptable; an accent "confirm" next to a danger "delete" as adjacent buttons is not —
that pairing uses accent and a bordered neutral instead.

### Mana (data-visualisation ramp only)

- **W** (`#ddd6c4`) · **U** (`#6ba0f5`) · **B** (`#7e7a85`) · **R** (`#d9544f`) · **G** (`#55a86a`)

These are **not** UI tokens. Deck identity in the interface uses real mana symbols in
Wizards' colours (see Deck identity). This ramp exists only where a colour identity has to
become a fill or a stroke and a symbol cannot be placed: the graph's colour-identity mode,
chart series, and pie or bar segments broken down by colour.

The values are tuned for this ground, not copied from the cards. **U** is brighter and
cooler than the card blue, which sat too close to the violet ladder and muddied against
panel fills. **B** is a true neutral grey rather than a charcoal-violet — on a violet ground
the latter reads as "slightly darker substrate" instead of as a colour. That grey is the one
place a pure neutral is correct in this system, precisely because it is the absence of the
cast around it.

Red and green sit a step off `--danger` and `--success` deliberately. In charts they are
labelled; in the graph they are a grouping, not a state. If a chart ever needs both a mana
red and a danger red in one frame, the chart is doing two jobs and should be split.

### Named rules

**The Fixed-Accent Rule.** `--accent` is a literal, is the same on every screen, and never
derives from deck contents. Deck identity is data and renders as pips; it never themes
chrome. A user comparing eight decks must see eight identities at once, which a themed
interface cannot express.

**The Off-Wheel Rule.** No UI colour that means a UI thing may sit inside the WUBRG hue
ranges. Anything on the mana wheel reads as mana in this product.

**The Hue-Budget Rule.** Hue is budgeted per frame, not globally. In the chrome the only
hues are the accent, the fill, and three semantic colours — mana hue never appears there,
because identity is carried by symbol art. Inside the graph and charts the mana ramp claims
five more, but graph modes are **exclusive**, so colour-identity hues and verb-family hues
are never both resting on screen. Any new categorical distinction must fit the budget of the
frame it appears in; when it does not, encode it structurally — shape, dash pattern, fill
state, position — rather than adding a hue.

**The Semantic-vs-Accent Rule.** State and quality use the semantic tokens; identity and
structure use `--accent`. Components never use a raw Tailwind palette class
(`text-red-500`, `bg-amber-500`, …).

---

## Typography

**UI font:** Inter (with `ui-sans-serif, system-ui` fallback) — every heading and every
word of body copy.

**Data and label font:** JetBrains Mono (with `ui-monospace` fallback) — every number,
score, count, tab label, and field label.

One clean grotesk carries all reading text; monospace is reserved strictly for data and
structural labels, never used decoratively. This is the category's own convention executed
with tighter rhythm than the category default.

### Hierarchy

- **Heading** — 700, `-0.01em`, `text-xl` to `text-2xl` by context.
- **Body** — 400, base size.
- **Label** — mono, 500, `0.6875rem`, `0.1em` tracking, uppercase (the `.eyebrow` class).
- **Data** — mono, `tabular-nums` where numeric.
- **Micro-label** — mono, `--text-2xs` (10px). Chart axis ticks only.

### Named rules

**The Tabular-Data Rule.** Any ranked or numeric column uses `.tabular-nums` so figures
align at a fixed width. A column that jitters as values change has failed this rule. This
now extends to non-numeric fixed-vocabulary columns — see the mana pip column.

**The No-Kicker Rule.** No page or section heading gets a small label stacked directly
above it. A label pairs inline with its value (`DECK IDENTITY  Tokens`) or is the heading
itself, never a two-line kicker-then-title stack.

**No display or serif face.** Inter carries every word. This rule killed an earlier
exploration that set the wordmark in a wonky serif, and it stands.

---

## Logotype

The wordmark is `edhseer` — one lowercase string, no space, split by weight and colour:
`edh` at Inter 400 in `--muted`, `seer` at Inter 700 in `--foreground`.

- **Weight is the primary seam, colour is reinforcement.** In a monochrome context the
  weight difference alone still separates the words. Colour alone would not survive.
- **Tracking** `-0.03em` at display size, `-0.01em` at header size, `0` below 16px.
  Inter's default spacing is tuned for small sizes and reads loose at display scale. Drive
  the `opsz` axis to 32 for the display lockup.
- **Ship it as outlined SVG paths, not text.** The UI font stack falls back to
  `system-ui`, which is correct for UI and unacceptable for a logotype — the mark would
  change shape per platform. Outlining also costs zero webfont weight and lets the `dh`
  pair be optically corrected without that leaking into CSS.
- **Never `--accent`.** The wordmark is the fixed point in a header that also contains the
  mana pip row; the pips are the colourful element there.
- **Floor:** below 13px the weight seam stops reading. Use the icon alone instead.
- **Written form is `EDH Seer`.** The one-word lowercase form is a logotype decision, not
  a naming decision. Prose, README, page titles, and package names use the spaced form.

**Icon.** Two circles joined by a short line — one small and filled, one larger and
outlined — in `--muted`. This is one edge between two nodes: the atomic unit of the data
model, and a literal instance of what the graph draws. The unequal weights break the
generic "link glyph" reading and echo the filled-versus-hollow rule below. Below 24px the
outlined circle goes solid and size alone carries the distinction.

---

## Deck identity

Deck colour identity renders as a row of **real MTG mana symbols**. It is data, not chrome.

- **Source them from Scryfall's symbology endpoint** (`/symbology`, which returns an
  `svg_uri` per symbol). Cache the SVGs locally with the rest of the bulk data — offline-first
  holds here as everywhere else.
- **Fixed five slots in any tabular context.** Every row reserves W/U/B/R/G; absent colours
  render as an empty `--separator` circle at the same diameter. A two-colour deck and a
  five-colour deck occupy identical width. Five empty slots reads as colourless.
- **Present colours only in headers and detail views**, where nothing needs to align.
- **Always WUBRG order.** Never alphabetical, never sorted by card count.
- **Never recolour or restyle the symbols.** They arrive in Wizards' own palette and that
  palette is the reason they are instantly recognisable. Recolouring them to match the
  system defeats the entire reason for using them.

Because the glyphs are distinct silhouettes, identity survives greyscale and small sizes
without a letter or a hue. This is the one component in the system whose colours are not
drawn from the token file, and that exception is deliberate.

**The black symbol is the legibility case.** Its circle is dark and sits on a near-black
violet ground; it will read as low-contrast where the other four do not. Give the symbol row
a consistent 1px `--border` ring at every slot — not a special case for black, which would
make the row asymmetric — so every symbol has an edge to sit against.

**Licensing.** These are Wizards' marks, used under the Fan Content Policy. That covers a
free, non-commercial tool and is what every comparable deckbuilder relies on. If EDH Seer
ever takes money, this decision has to be revisited — the fallback is authored pips, which
is why the `--mana-*` ramp below still exists.

The v1 identity-driven accent and its picker are removed entirely: `identityColor()`,
`use-accent-identity.ts`, the `localStorage` pinned pick, the gradient variables, and the
five-pip header control all go. Nothing in the chrome derives from deck contents.

---

## Graph

Written against `docs/superpowers/specs/2026-08-29-graph-ux-and-build-mode.md` §2–3. That document governs structure and
physics; this section governs only what things look like.

### Resting state

The graph at rest is monochrome. Parallel synergy edges between a pair collapse to one
line in `--separator`; non-adjacent nodes drop to fog. Nothing at rest carries categorical
hue.

### Verb families

Family colour appears **only in the selection fan** — the per-claim edges that fan out from
a selected node, with arrowheads. It is transient, scoped to one node at a time, and never
present across the canvas.

Because graph modes are exclusive, the fan may take hue **in synergy mode**, where nothing
else on screen is claiming the wheel. Seven families need seven distinguishable hues; draw
them from outside the semantic three, and keep them at mid lightness so they sit legibly on
`--background` without out-shouting the nodes.

**In grouped modes the fan stays monochrome.** Colour-identity mode paints nodes from the
mana ramp and card-type mode groups them spatially; a family-hued fan drawn over either
would put two unrelated colour systems in one frame, and a green `resource` edge crossing a
green identity cluster reads as related to it. In those modes the fan renders in
`--foreground` and distinguishes family by dash rhythm and arrowhead, with the verb in the
tooltip.

This is why family must be legible without hue in the first place: the structural encoding
is not a fallback, it is the grouped-mode presentation, and the hues are an enhancement
synergy mode can afford.

### Node ring

The segmented `inByFamily` / `outByFamily` ring on unselected nodes is **monochrome** —
in-density in `--accent`, out-density in `--muted`. Colouring it by family would put seven
hues on a hundred nodes at rest and defeat both the fog treatment and the resting-state
rule above.

### Dash is reserved

Dashed strokes mean `struct` edges — `transforms` and `makes` — and nothing else. Build
mode's ghost suggestions were also specified as dashed, and both appear on screen
simultaneously. **Ghosts use translucency plus a lighter stroke weight, never dashes.**

### Card art override

Carried forward from v1 unchanged. Each face node's circle fills with that card's Scryfall
`art_crop`, clipped at a fixed 14px radius with a 1px `--border` ring. This is a deliberate,
scoped exception to the no-card-chrome rule, chosen because a card's own art is the fastest
way to recognise it in a dense graph where text labels cannot scale.

Bounds: art crops inside plain node circles only. No card frame, no mana-cost pips, no set
symbol, no foil treatment, no parchment. Art is lazy-loaded with capped concurrency and is
**always optional** — until it resolves, and forever if it fails or is never requested, the
node draws as the plain dot every other node kind uses. Non-card nodes never get art; they
get an authored SVG glyph stroked in `--accent` or `--muted`.

---

## Elevation, shape, and state

**Flat by default.** Zero `box-shadow` anywhere. Depth comes from tonal layering
(background → surface → surface-secondary → surface-tertiary) and 1px borders only.

**One radius.** `--radius: 0.5rem` on every rectangular container. The one exception is
fully round (`999px`): pips and progress-bar fills — the system's one recurring signature
shape. Bar tracks are `--separator`; bar fills are `--fill`, not `--accent`.

### Named rules

**The Filled-vs-Hollow Rule.** A filled shape means the system has data for this thing; a
hollow outline means it does not. This already runs through three places independently —
resolved chips fill while untagged stay hollow on the paste screen, untagged faces sit on
the outer ring in the graph, and the `.pip` is a circular outline — and it extends directly
to physical state in the collection. Naming it prevents three components from quietly
disagreeing about what an outline means.

`[OPEN]` The collection object model is not yet specified. A card's physical state
(owned / proxied / ordered / wanted) needs one encoding that works simultaneously in a
table row, on a graph node, and in a deck list. Filled-vs-hollow covers two states; a
third and fourth need a second channel — ring style is the obvious candidate, and it must
not collide with the graph's dashed struct edges.

---

## Layout and navigation

`[OPEN] — resolve before writing any shell code.`

v1 and the graph UX document specify incompatible navigation models, and neither extends
to collection management:

- **v1:** a sticky five-tab strip (Overview / Archetypes / Cards / Combos / Graph) over one
  ~3,000px report. A dashboard.
- **Graph UX spec §1:** four sequential screens — paste, reading, board, try-a-card — each
  showing one thing with everything else behind a tap. A wizard.
- **Collection management:** neither. A persistent, multi-object space the user returns to,
  with no analysis run in scope.

These are not variants of one another. The layout rules below were written against the
dashboard reading and are provisional until this is settled.

**The Width-Buys-Columns Rule.** A wide viewport adds columns, never longer lines. Overview
blocks flow through native CSS multi-column (`columns-1 xl:columns-2`, `break-inside-avoid`)
rather than a grid, and every run of prose carries `max-w-[65ch]`. Two columns is the
measured ceiling — at three, the deck-math panel takes a whole column and the third renders
empty.

---

## Components

### Pip (signature component)

Every score, count, or tally that needs emphasis renders inside a small circular outline —
`min-width` and `height` `1.75rem`, 1px border in `--pip-color` (defaults to `--accent`,
swappable per instance), mono type inside. Mana pips are a smaller variant of the same
component at 20px.

### Tabs

Underline indicator only — 2px bottom border, transparent when inactive, `--accent` when
active. Labels in label typography. No pill or filled-background treatment.

### Data table

`[SCOPED]` Ranked and tabular content renders as real `<table>` markup — **for collection
views, card lists, and any object inventory**. The graph doc's ban on tables and scores
applies to the reading and board screens, where the Reason sentence is the atomic unit.
Both hold; they address different objects.

Header row in label typography, left-aligned except numeric columns; bottom border in
`--border`, heavier than the `--separator` row rules. Rank columns zero-padded and tabular.
Name columns truncate rather than wrap.

### Filter chips

Bordered button at `--radius`, `--separator` border at rest, `--accent` border and text when
selected. Same visual grammar as tabs.

### Panels

`--surface` background, `--radius` corners, 1px `--border`, no shadow. The
missing/unresolved variant swaps to `--danger` borders, a danger-tinted pip, and a
danger-coloured title, reusing every other panel convention.

### Inputs

`--field-background` fill, `--field-border` stroke, `--radius` corners. The decklist
textarea sets `font-mono` since it holds structured list data. Labels always sit above the
field, never floating or inline-in-border.

---

## Do's and don'ts

### Do

- Render every score, count, or tally inside a `.pip` circle.
- Show deck identity as mana pips, five fixed slots in tables, letters always inside.
- Use `.tabular-nums` mono for any ranked or numeric column.
- Pair a label inline with its value rather than stacking it above a heading.
- Encode new categorical distinctions structurally — the hue budget is spent.

### Don't

- Don't add `box-shadow` anywhere.
- Don't derive `--accent` from deck contents. It is fixed.
- Don't use a UI colour that sits on the WUBRG wheel.
- Don't use dashes for anything but `struct` edges.
- Don't stack an eyebrow above any heading.
- Don't use a Unicode glyph or emoji as an icon — draw a small SVG in one consistent stroke.
- Don't introduce a serif or display face.
- Don't reach for illustrated or skeuomorphic MTG-card chrome. The one bounded exception is
  the graph's card-art node fills.
