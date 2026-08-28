---
name: MTG Synergy
description: Oracle-level deck reading for Commander players — a dark analytics dashboard held to Scryfall/Archidekt's craft bar
colors:
  background:
    value: "#0b0d10"
  foreground:
    value: "#e6e8eb"
  surface:
    value: "#14171b"
  surface-secondary:
    value: "#191d22"
  surface-tertiary:
    value: "#20242a"
  accent:
    value: "#5b8dee"
  muted:
    value: "#8b93a1"
  border:
    value: "#262b31"
  separator:
    value: "#1d2126"
  field-background:
    value: "#101317"
  warning:
    value: "#d99a3d"
  danger:
    value: "#e5484d"
  success:
    value: "#34c77b"
  bucket-consistency:
    value: "#6e8fb5"
  bucket-efficiency:
    value: "#d99a3d"
  bucket-synergy:
    value: "#9b7fd4"
  bucket-win-condition:
    value: "#e5484d"
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

# Design System: MTG Synergy

## Overview

**Creative North Star: "The Category Standard, Executed"**

This is deliberately not a novel visual world. Two rolled directions — a seed-catalog world (cards as nursery packets) and a tournament-standings-board world — were reviewed and set aside on purpose, in favor of the plain thing done right: a conventional dark analytics dashboard, held to the actual craft bar this product competes against — **Scryfall** and **Archidekt/Moxfield** — not a generic SaaS template and not an illustrated MTG-card pastiche.

The system is sans throughout (Inter for every heading and body word, JetBrains Mono for every number and label), flat and border-driven (no shadows), with one identity-driven accent instead of a fixed brand color: the accent resolves to the analyzed deck's own MTG color identity, or the player's own pinned pick before any deck is analyzed (`client/src/lib/color-identity.ts`, `use-accent-identity.ts`). Ranked data reads as real tables, not decorative lists — the Cards tab is a rank/name/roles/synergy table, not a bullet list.

**Key Characteristics:**
- One typeface family per register (Inter for words, JetBrains Mono for numbers/labels) — no display face, no serif
- Flat, border-driven surfaces on a near-black graphite ground — zero `box-shadow` in the system
- One accent, identity-driven rather than fixed — same restraint rule as any single-accent Restrained system
- Ranked/tabular content renders as real `<table>` markup, matching the category's own reference-tool convention
- No kicker/eyebrow ever sits directly above a page or section heading — labels pair inline with their value instead (`DECK IDENTITY  Tokens`, not stacked)

## Colors

Near-monochrome dark graphite with one accent and a small set of semantic/category colors — Restrained strategy, unchanged by which hue the accent resolves to.

### Primary
- **Accent** (`#5b8dee` at rest, identity-driven otherwise): the system's one accent. Deck-identity heading, active tab underline + text, focus ring, filter-chip selected state, combo-connector icon. When a deck is analyzed, this resolves to that deck's own color identity (`identityColor()` — same saturation/lightness, hue rotated per color, circular mean for multicolor); otherwise it's the player's pinned pick or this neutral blue default.

### Neutral
- **Background** (`#0b0d10`): page background, near-black graphite.
- **Foreground** (`#e6e8eb`): primary text, crisp cool off-white.
- **Surface** (`#14171b`): first panel tier — input panel, deck-identity panel, missing-cards panel.
- **Surface Secondary** (`#191d22`): second tier — filled controls at rest.
- **Surface Tertiary** (`#20242a`): third tier.
- **Muted** (`#8b93a1`): secondary text, placeholders, inactive labels.
- **Border** (`#262b31`): structural border/field-border color.
- **Separator** (`#1d2126`): list/table row dividers, hairlines.

### Semantic
- **Warning** (`#d99a3d`): amber.
- **Danger** (`#e5484d`): clean red — unresolved-card state.
- **Success** (`#34c77b`): dashboard-standard green.

### Category Markers (legacy tokens, unused by the Cards table)
Four jewel hues were reserved for card-role buckets (Consistency / Efficiency / Synergy / Win Condition) as colored dots. The shipped Cards tab instead renders each card's functional categories (Ramp / Draw / Removal / Board wipes / Protection / Tutors / Lands) as readable text chips in the Roles column, so these tokens no longer back that column:
- **Consistency** — dusty blue (`#6e8fb5`)
- **Efficiency** — amber (`#d99a3d`, shared with Warning)
- **Synergy** — violet (`#9b7fd4`)
- **Win Condition** — red (`#e5484d`, shared with Danger)

### Named Rules
**The Solid-vs-Gradient Rule.** The identity resolves to TWO variables and they have different
jobs. `--accent` is the SOLID colour and is the only one text, icons and focus rings ever use —
gradient text stays off the table. `--accent-gradient` (and `--accent-gradient-y`, for a bar whose
dominant dimension is height) is the full identity across its colours, and it is used ONLY on a
fillable shape whose whole job is to carry the identity: the primary action, a proportion bar, a
selected chip's border, the active tab's underline. It is never a surface fill behind content and
never a page background.

This line previously read *"never a fill or background"*, which the build has not matched since the
gradient variables were introduced — caught by an adversarial craft review 2026-08-27. The doc was
the stale half: `use-accent-identity.ts` carries the real policy in its own comment and the shipped
uses are all bounded shapes. Corrected here rather than by changing shipped visuals, which is a
product decision and not a documentation one.

**The Identity-Driven Accent Rule.** `--accent` is computed, not fixed. It is never hand-set to a literal hex in a component; it resolves from `identityColor()` (analyzed deck) or the player's `localStorage` pick, falling back to the neutral blue. Any new UI referencing "the accent" reads the CSS variable, never a literal color.

**The No-Kicker Rule.** No page or section heading gets a small label stacked directly above it. A label pairs inline with its value (`DECK IDENTITY  Tokens`, `# / CARD / ROLES / SYNERGY` as table headers) or is the heading itself (small-caps section titles like "Mana curve"), never a two-line kicker-then-title stack.

**The Semantic-vs-Accent Rule.** State and quality use the semantic tokens
(`--danger`, `--warning`, `--success`); identity and structure use `--accent`
(deck identity, active tab, focus ring, combo connector). Components never use a
raw Tailwind palette color class (`text-red-500`, `bg-amber-500`, …).

## Typography

**UI Font:** Inter (with ui-sans-serif, system-ui fallback) — every heading and every word of body copy.
**Data/Label Font:** JetBrains Mono (with ui-monospace fallback) — every number, score, count, tab label, and field label.

**Character:** One clean grotesk carries all reading text; monospace is reserved strictly for data and structural labels, never used decoratively. This is the category's own convention (Scryfall, Archidekt, Moxfield all read this way) executed with tighter rhythm and more restraint than the category default.

### Hierarchy
- **Heading** (700, `-0.01em` tracking, sizes from `text-xl` to `text-2xl` by context): page title, section titles (Combos, Unresolved), deck-identity theme name.
- **Body** (400, base size, Inter): card names, archetype pair descriptions, prose copy.
- **Label** (500, `0.6875rem`, `0.1em` tracking, uppercase, mono — the `.eyebrow` class): field labels, tab labels, table column headers, stat-tile labels, inline value labels ("DECK IDENTITY", "YOUR COLORS").
- **Data** (mono, `tabular-nums` where numeric): every score, rank, count, percentage — table Synergy column, stat-tile values, chart peak labels, pip contents, resolved-count.
- **Micro-label** (`--text-2xs`, 10px, mono): chart axis tick labels only (mana curve, land math). The one step below `label`.

### Named Rules
**The Tabular-Data Rule.** Any ranked or numeric column (table Synergy, rank number, stat-tile value) uses `.tabular-nums` so figures align at a fixed width — a table that jitters column widths as values change has failed this rule.

## Layout

Centered reading column up to `xl`, full-bleed above it: `max-w-5xl xl:max-w-none` container, `mx-auto`, `p-8`, vertical rhythm via `flex flex-col gap-8` at the page level and `gap-6` within the report body. The report is a tab strip (underline-style active indicator in the accent color) gating five panels (Overview / Archetypes / Cards / Combos / Graph); the strip is **sticky to the top of the viewport** and scrolls horizontally at narrow widths, because the report runs ~3,000px and the only navigation between its sections used to scroll away after the first screen. An unresolved-cards warning panel renders above the tabs when present.

**The Width-Buys-Columns Rule.** A wide viewport adds COLUMNS, never longer lines. The Overview's blocks are self-contained and unequal in height, so they flow through native CSS multi-column (`columns-1 xl:columns-2`, `break-inside-avoid` on each child) rather than a grid, and every run of prose carries its own measure cap (`max-w-[65ch]`). Two columns is the measured ceiling: at three, the deck-math panel is taller than everything else combined and cannot split, so it takes a whole column and the third renders empty. This replaces the previous fixed `max-w-5xl` page, which left 47% of a 1920 viewport as empty gutter while the report scrolled for 2.9 screens.

Stat tiles use a responsive grid (`grid-cols-2` narrow, `sm:grid-cols-5` wide). The Cards tab renders a real `<table>` — header row in label typography, data rows separated by 1px separators, the rank column zero-padded and tabular, the Synergy column right-aligned. Bar charts (mana curve, land-math) are fixed-height (120px) horizontal bar rows in the accent color.

## Elevation & Depth

Flat by design — zero `box-shadow` anywhere. Depth comes from tonal layering (background → surface → surface-secondary → surface-tertiary) and 1px borders only.

### Named Rules
**The Flat-By-Default Rule.** Surfaces separate by border and tonal step, never by shadow.

## Shapes

One consistent corner radius (`--radius: 0.5rem` / 8px) on every rectangular container — panels, buttons, filter chips, inputs, table cells stay square. The one exception is fully round (`999px`): the rank/score pip and progress-bar fills, the system's one recurring signature shape.

## Components

### Buttons
- **Shape:** `--radius` (8px), HeroUI-wired to the project's CSS custom properties.
- **Primary:** the deck-analysis submit action; disabled while input is empty or a request is in flight; label swaps to "Analyzing…" rather than adding a separate spinner element.

### Pip (signature component)
Every score, count, or tally that needs emphasis renders inside a small circular outline — `min-width 1.75rem`, `height 1.75rem`, 1px border in `--pip-color` (defaults to the accent, swappable per-instance — e.g. danger-red for the unresolved-cards count), mono type inside.

### Data Table (Cards tab)
- **Columns:** `#` / Card / Roles / Synergy — no separate Score column.
- **Header row:** label typography (`.eyebrow`), left-aligned except the numeric Synergy column, which is right-aligned; a bottom border in `--border` (heavier than row separators).
- **Rows:** 1px `--separator` bottom border; rank column zero-padded and tabular (`01`, `02`…); the name column truncates rather than wrapping or breaking layout, and shows a "why it's here" subline underneath (the card's top synergy-partner reason); the Roles column renders each of the card's functional categories (Ramp / Draw / Removal / Board wipes / Protection / Tutors / Lands) as a small bordered text chip, not a colored dot; the Synergy column is right-aligned tabular mono.

### Tabs
- **Style:** underline indicator only — 2px bottom border, transparent when inactive, accent-colored when active. Labels are label-style (uppercase mono). No pill or filled-background tab treatment.

### Filter Chips (Cards tab functional-category filter)
- **Style:** bordered button (`--radius`), `--separator` border at rest, accent border + text when selected. Same visual grammar as tabs. Chips are the functional categories actually present in the analyzed deck (Ramp/Draw/Removal/Board wipes/Protection/Tutors/Lands), plus an "All" chip — not the old abstract Consistency/Efficiency/Synergy/Win Condition buckets.

### Archetype Rows
- **Style:** expandable row, click-to-toggle, a horizontal proportion bar (`--separator` track, accent fill, `999px` radius) shows relative group size; expanded state reveals nested synergy-pair reasons indented with a left border rule.

### Panels
- **Corner Style:** `--radius` (8px) uniformly.
- **Background:** `--surface`.
- **Shadow Strategy:** none.
- **Border:** 1px `--border`.

### Inputs / Fields
- **Style:** `--field-background` fill, `--field-border` stroke, `--radius` corners; the decklist textarea sets `font-mono` since it holds structured list data.
- **Labels:** always a label above the field, never floating or inline-in-border.

### Missing/Unresolved Panel
- **Style:** danger-colored variant of the standard panel — `border-danger`, a danger-tinted pip carrying the unresolved count, danger-colored section title. Reuses every other panel convention.

### Graph Card Art (deliberate override)
The deck-graph view (`GraphView.tsx`) fills each card node's circle with that card's Scryfall
`art_crop` image, clipped to the circle at a fixed 14px radius with a 1px `--border` ring. This is
a **deliberate, scoped override** of the anti-card-chrome rule below (illustrated/skeuomorphic MTG
chrome is banned everywhere else in the system) — chosen because a card's own art is the fastest
way to recognize it in a dense node graph, where a text label can't scale to every node at once.
The override does not reopen the door to card-chrome generally:
- **Bound:** art crops inside plain node circles only. No card frame, no mana-cost pips, no set
  symbol, no foil/holo treatment, no parchment texture — the circle stays the one shape language
  the graph already uses for every other node kind.
- Art is lazy-loaded, capped concurrency, and **always optional**: until an image resolves, and
  forever if it fails or is never requested (small/zoomed-out nodes skip the request entirely),
  the node draws as the plain filled dot every other kind uses. The graph must never depend on a
  successful image fetch — offline-first holds here same as everywhere else.
- Non-card nodes never get art; they get an authored SVG glyph (`graph-glyphs.ts`) instead, stroked
  in `--accent` (event kinds) or `--muted` (everything else), never a bitmap.

### Color-Identity Picker (signature component)
Five toggleable pips (W/U/B/R/G) in the header, each showing its own resolved hue when active. Selecting a combination sets the player's pinned accent (persisted to `localStorage`) and shows the resolved identity name (e.g. "Izzet") beside the row. Sits inline beside the wordmark, never as a modal or settings page.

## Do's and Don'ts

### Do:
- **Do** render every score, count, or tally inside a `.pip` circle.
- **Do** keep the accent identity-driven — read `--accent`/`identityColor()`, never hardcode a hex for "the accent."
- **Do** use `.tabular-nums` mono for any ranked or numeric column.
- **Do** pair a label inline with its value rather than stacking it above a heading.
- **Do** render ranked/tabular data as a real `<table>`, not a styled list.

### Don't:
- **Don't** add `box-shadow` anywhere — depth is tonal and border-based only.
- **Don't** stack an eyebrow/kicker directly above any page or section heading.
- **Don't** use a Unicode glyph or emoji as an icon — draw a small SVG in one consistent stroke (see `ComboList`'s arrow) instead.
- **Don't** introduce a serif or display face — Inter carries every word, JetBrains Mono every number/label.
- **Don't** reach for illustrated/skeuomorphic MTG-card chrome (fake foil, parchment texture, oversized card frame) — this system was chosen specifically to avoid that register. The one deliberate, bounded exception is the deck graph's card-art node fills — see "Graph Card Art" under Components.
