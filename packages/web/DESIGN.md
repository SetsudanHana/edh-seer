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

The system is sans throughout (Inter for every heading and body word, JetBrains Mono for every number and label), flat and border-driven (no shadows), with one identity-driven accent instead of a fixed brand color: the accent resolves to the analyzed deck's own MTG color identity, or the player's own pinned pick before any deck is analyzed (`client/src/lib/color-identity.ts`, `use-accent-identity.ts`). Ranked data reads as real tables, not decorative lists — the Cards tab is a rank/name/roles/score table, not a bullet list with dots.

**Key Characteristics:**
- One typeface family per register (Inter for words, JetBrains Mono for numbers/labels) — no display face, no serif
- Flat, border-driven surfaces on a near-black graphite ground — zero `box-shadow` in the system
- One accent, identity-driven rather than fixed — same restraint rule as any single-accent Restrained system
- Ranked/tabular content renders as real `<table>` markup, matching the category's own reference-tool convention
- No kicker/eyebrow ever sits directly above a page or section heading — labels pair inline with their value instead (`DECK IDENTITY  Tokens`, not stacked)

## Colors

Near-monochrome dark graphite with one accent and a small set of semantic/category colors — Restrained strategy, unchanged by which hue the accent resolves to.

### Primary
- **Accent** (`#5b8dee` at rest, identity-driven otherwise): the system's one accent. Deck-identity heading, active tab underline + text, focus ring, filter-chip selected state, combo-connector icon. Never a fill or background. When a deck is analyzed, this resolves to that deck's own color identity (`identityColor()` — same saturation/lightness, hue rotated per color, circular mean for multicolor); otherwise it's the player's pinned pick or this neutral blue default.

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

### Category Markers
Four jewel hues mark the card-role buckets (Consistency / Efficiency / Synergy / Win Condition) as small dots in the Cards table's Roles column:
- **Consistency** — dusty blue (`#6e8fb5`)
- **Efficiency** — amber (`#d99a3d`, shared with Warning)
- **Synergy** — violet (`#9b7fd4`)
- **Win Condition** — red (`#e5484d`, shared with Danger)

### Named Rules
**The Identity-Driven Accent Rule.** `--accent` is computed, not fixed. It is never hand-set to a literal hex in a component; it resolves from `identityColor()` (analyzed deck) or the player's `localStorage` pick, falling back to the neutral blue. Any new UI referencing "the accent" reads the CSS variable, never a literal color.

**The No-Kicker Rule.** No page or section heading gets a small label stacked directly above it. A label pairs inline with its value (`DECK IDENTITY  Tokens`, `# / CARD / ROLES / SCORE` as table headers) or is the heading itself (small-caps section titles like "Mana curve"), never a two-line kicker-then-title stack.

## Typography

**UI Font:** Inter (with ui-sans-serif, system-ui fallback) — every heading and every word of body copy.
**Data/Label Font:** JetBrains Mono (with ui-monospace fallback) — every number, score, count, tab label, and field label.

**Character:** One clean grotesk carries all reading text; monospace is reserved strictly for data and structural labels, never used decoratively. This is the category's own convention (Scryfall, Archidekt, Moxfield all read this way) executed with tighter rhythm and more restraint than the category default.

### Hierarchy
- **Heading** (700, `-0.01em` tracking, sizes from `text-xl` to `text-2xl` by context): page title, section titles (Combos, Unresolved), deck-identity theme name.
- **Body** (400, base size, Inter): card names, archetype pair descriptions, prose copy.
- **Label** (500, `0.6875rem`, `0.1em` tracking, uppercase, mono — the `.eyebrow` class): field labels, tab labels, table column headers, stat-tile labels, inline value labels ("DECK IDENTITY", "YOUR COLORS").
- **Data** (mono, `tabular-nums` where numeric): every score, rank, count, percentage — table Score column, stat-tile values, chart peak labels, pip contents, resolved-count.

### Named Rules
**The Tabular-Data Rule.** Any ranked or numeric column (table Score, rank number, stat-tile value) uses `.tabular-nums` so figures align at a fixed width — a table that jitters column widths as values change has failed this rule.

## Layout

Single-column, centered reading column: `max-w-5xl` container, `mx-auto`, `p-8`, vertical rhythm via `flex flex-col gap-8` at the page level and `gap-6` within the report body. The report is a tab strip (underline-style active indicator in the accent color) gating four panels (Overview / Archetypes / Cards / Combos); an unresolved-cards warning panel renders above the tabs when present.

Stat tiles use a responsive grid (`grid-cols-2` narrow, `sm:grid-cols-5` wide). The Cards tab renders a real `<table>` — header row in label typography, data rows separated by 1px separators, the rank column zero-padded and tabular, the Score column right-aligned. Bar charts (mana curve, land-math) are fixed-height (120px) horizontal bar rows in the accent color.

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
- **Header row:** label typography (`.eyebrow`), left-aligned except the numeric Score column, which is right-aligned; a bottom border in `--border` (heavier than row separators).
- **Rows:** 1px `--separator` bottom border; rank column zero-padded and tabular (`01`, `02`…); the name column truncates rather than wrapping or breaking layout; the Roles column holds up to four small colored dots (the bucket/category markers); the Score column is right-aligned tabular mono.

### Tabs
- **Style:** underline indicator only — 2px bottom border, transparent when inactive, accent-colored when active. Labels are label-style (uppercase mono). No pill or filled-background tab treatment.

### Filter Chips (Cards tab bucket filter)
- **Style:** bordered button (`--radius`), `--separator` border at rest, accent border + text when selected. Same visual grammar as tabs.

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
- **Don't** reach for illustrated/skeuomorphic MTG-card chrome (fake foil, parchment texture, oversized card frame) — this system was chosen specifically to avoid that register.
