/** THE NON-MANA HALF OF THE MANA FONT (owner, 2026-09-20: "the mana font has much more symbols,
 *  like for example symbol for commander, we should incorporate as much of the font as possible to
 *  make our website more readable").
 *
 *  ONE COMPONENT FOR ALL OF THEM, and that is not tidiness. mana ships UNLAYERED CSS while Tailwind
 *  v4 emits its utilities inside `@layer utilities`, and an unlayered rule beats a layered one
 *  whatever the source order -- so `.ms { font-size: inherit }` silently defeats a `text-*` put on
 *  the `<i>`, and several families hardcode `color:#111`, which is invisible on this theme's
 *  ground. PR #411 found both in the browser after jsdom passed. Solving them once here is the
 *  difference between one fix and one per call site.
 *
 *  THE GLYPH IS ALWAYS REDUNDANT. Every mark this renders sits beside the word it stands for -- the
 *  type glyph beside the type line, the commander mark beside "As a commander", the keyword glyph
 *  beside the keyword. So it is `aria-hidden` by default and a screen reader hears the words it
 *  already heard, which is also why a keyword mana has no glyph for costs the reader nothing.
 *  `label` is the exception, for the one case where the mark stands alone. */

/** The eight card types (CR 205.2a), in the order a type line prints them. Supertypes ("Legendary",
 *  "Basic", "Snow", "World") are deliberately absent: they are not types and mana draws none. */
const CARD_TYPES = [
  "artifact", "battle", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery",
] as const;

/** The first CARD TYPE named on a type line, as a mana class.
 *
 *  CEILING: "Artifact Creature — Golem" yields `artifact` and not both. Two glyphs on one line
 *  reads as clutter and the words immediately after the mark say the rest. */
export function typeClass(typeLine: string): string | undefined {
  // Everything before the em dash is the type half; the subtypes after it are not card types and
  // must not match ("Enchantment — Saga" has no `creature` in it, but "Creature — Land Golem"
  // would if the whole line were scanned).
  const head = (typeLine.split(/\s[\u2014-]\s/)[0] ?? "").toLowerCase();
  // THE FIRST TYPE ON THE LINE, not the first in `CARD_TYPES`. Scanning the constant instead of
  // the words returns whichever type sorts earliest, so "Enchantment Creature" gave `creature`
  // while "Artifact Creature" gave `artifact` -- right by luck in one case and wrong in the other.
  return head.split(/\s+/).find((w): w is (typeof CARD_TYPES)[number] =>
    (CARD_TYPES as readonly string[]).includes(w));
}

/** A printed keyword as a mana class, across the families mana files them under -- `ability-flying`
 *  but a bare `flashback`, and a handful that live with the counters.
 *
 *  Measured over the corpus on 2026-09-20: 134 of 811 distinct keywords have a glyph, covering
 *  69.0% of the 22,682 keyword renderings. The misses are not a long tail -- `equip` (605) is more
 *  common than `haste` (671) -- which is exactly why the WORD is always printed and the glyph is
 *  only ever an addition to it. `undefined` here means "print the word alone", never "hide it".
 *
 *  THERE WAS A THIRD ARM, `counter-<slug>`, AND IT IS GONE (AM1, 2026-09-20). A specialist review
 *  found it could never match -- `KNOWN` holds zero `counter-` entries while mana ships 38 -- and
 *  proposed widening `KNOWN` to reach them. Measured before doing so, the widening does not pay:
 *
 *    - Of 811 distinct printed keywords, exactly TWO would be served by that arm: `echo` and
 *      `void`. Every other keyword naming a counter (`deathtouch`, `goad`) already resolves on the
 *      first two arms.
 *    - And both are wrong. `rules/MagicCompRules.txt` (revision 20260925) contains no "echo
 *      counter" and no "void counter" -- `Echo` is CR 702.30 and uses age counters; `Void` is not
 *      a keyword ability in that revision at all. The arm would have marked two keywords with a
 *      counter the game does not define.
 *
 *  The counter FAMILY still has no call site either: a planeswalker's loyalty is already drawn by
 *  `LoyaltyCost`, a Saga already carries its own type glyph and no surface names its lore counters,
 *  and the `+1/+1 Counters` theme heading is 1 of 17 mechanism categories -- one marked heading in
 *  a row of seven is the same defect this review rejected for the role chips. Re-add the arm the
 *  day a call site exists, with the class it needs. */
export function abilityClass(keyword: string): string | undefined {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return undefined;
  return [`ability-${slug}`, slug].find((c) => KNOWN.has(c));
}

/** The classes this module is allowed to name. A class mana does not define renders as an empty
 *  box -- the private-use codepoint with no glyph behind it -- so every lookup is checked rather
 *  than assumed, the same reason `isSymbolCode` guards the mana path. Generated from
 *  `mana.min.css` (565 classes) and narrowed to the families these call sites use. */
const KNOWN: ReadonlySet<string> = new Set([
  "ability-activated", "ability-adamant", "ability-adapt", "ability-addendum", "ability-adventure",
  "ability-afflict", "ability-afterlife", "ability-aftermath", "ability-alliance", "ability-amass",
  "ability-amass-orcs", "ability-amass-zombies", "ability-annihilator", "ability-ascend", "ability-backup",
  "ability-bargain", "ability-battle-cry", "ability-blitz", "ability-boast", "ability-cannot-block",
  "ability-cannot-untap", "ability-case-solved", "ability-case-solved-print", "ability-casualty",
  "ability-celebration", "ability-changeling", "ability-channel", "ability-cleave", "ability-cloak",
  "ability-cohort", "ability-collect-evidence", "ability-combat-condition", "ability-companion",
  "ability-constellation", "ability-convoke", "ability-convoke-original", "ability-copy",
  "ability-corrupted", "ability-coven", "ability-craft", "ability-crew", "ability-crime", "ability-cycling",
  "ability-d20", "ability-day-night", "ability-daybound-nightbound", "ability-deathtouch", "ability-decayed",
  "ability-defender", "ability-delirium", "ability-delve", "ability-descend", "ability-detain",
  "ability-devotion", "ability-dfc", "ability-discover", "ability-disguise", "ability-disturb",
  "ability-domain", "ability-double-strike", "ability-duels-annihilator", "ability-duels-battle-cry",
  "ability-duels-cannot-block", "ability-duels-cannot-untap", "ability-duels-cohort", "ability-duels-copy",
  "ability-duels-deathtouch", "ability-duels-defender", "ability-duels-delirium", "ability-duels-detain",
  "ability-duels-dfc", "ability-duels-double-strike", "ability-duels-evolve", "ability-duels-exalted",
  "ability-duels-exile", "ability-duels-fading", "ability-duels-fear", "ability-duels-first-strike",
  "ability-duels-flying", "ability-duels-forestwalk", "ability-duels-haste", "ability-duels-haunt",
  "ability-duels-hexproof", "ability-duels-indestructible", "ability-duels-infect", "ability-duels-ingest",
  "ability-duels-intimidate", "ability-duels-islandwalk", "ability-duels-legendary",
  "ability-duels-lifelink", "ability-duels-menace", "ability-duels-monstrous", "ability-duels-mountainwalk",
  "ability-duels-must-attack", "ability-duels-plainswalk", "ability-duels-prevent-damage",
  "ability-duels-protection", "ability-duels-protection-black", "ability-duels-protection-blue",
  "ability-duels-protection-green", "ability-duels-protection-red", "ability-duels-protection-white",
  "ability-duels-rally", "ability-duels-regenerate", "ability-duels-renowned", "ability-duels-shroud",
  "ability-duels-skulk", "ability-duels-soulshift", "ability-duels-swampwalk",
  "ability-duels-temporary-control", "ability-duels-totem-armor", "ability-duels-trample",
  "ability-duels-unblockable", "ability-duels-undying", "ability-duels-vigilance", "ability-dungeon",
  "ability-eerie", "ability-embalm", "ability-enchant", "ability-enlist", "ability-enrage",
  "ability-enrage-original", "ability-escape", "ability-eternalize", "ability-evolve", "ability-exalted",
  "ability-exile", "ability-expend", "ability-exploit", "ability-explore", "ability-fabricate",
  "ability-fading", "ability-fear", "ability-ferocious", "ability-finality", "ability-first-strike",
  "ability-flash", "ability-flying", "ability-for-mirrodin", "ability-forage", "ability-forestwalk",
  "ability-foretell", "ability-gift", "ability-goad", "ability-haktos-the-unscarred", "ability-haste",
  "ability-haunt", "ability-hexproof", "ability-hexproof-black", "ability-hexproof-blue",
  "ability-hexproof-green", "ability-hexproof-red", "ability-hexproof-white", "ability-hideaway",
  "ability-impending", "ability-improvise", "ability-incubate", "ability-indestructible", "ability-infect",
  "ability-ingest", "ability-intimidate", "ability-investigate", "ability-islandwalk", "ability-jumpstart",
  "ability-kicker", "ability-landfall", "ability-learn", "ability-legendary", "ability-lifelink",
  "ability-lifelink-original", "ability-magecraft", "ability-manifest-dread", "ability-meld",
  "ability-menace", "ability-mentor", "ability-monstrous", "ability-morph", "ability-mountainwalk",
  "ability-must-attack", "ability-mutate", "ability-ninjutsu", "ability-obscura", "ability-offspring",
  "ability-outlast", "ability-party", "ability-phyrexian", "ability-plainswalk", "ability-plot",
  "ability-prevent-damage", "ability-proliferate", "ability-protection", "ability-protection-black",
  "ability-protection-blue", "ability-protection-green", "ability-protection-red",
  "ability-protection-white", "ability-prototype", "ability-prowess", "ability-raid", "ability-rally",
  "ability-reach", "ability-read-ahead", "ability-reconfigure", "ability-regenerate", "ability-renowned",
  "ability-revolt", "ability-ring-bearer", "ability-riot", "ability-robber-of-the-rich",
  "ability-role-cursed", "ability-role-monster", "ability-role-royal", "ability-role-sorceror",
  "ability-role-wicked", "ability-role-young-hero", "ability-saddle", "ability-shroud", "ability-skulk",
  "ability-soulshift", "ability-specialize", "ability-spectacle", "ability-spree", "ability-static",
  "ability-summoning-sickness", "ability-surveil", "ability-surveil-original", "ability-survival",
  "ability-suspect", "ability-swampwalk", "ability-temporary-control", "ability-the-ring-tempts-you",
  "ability-totem-armor", "ability-toxic", "ability-training", "ability-trample", "ability-transform",
  "ability-triggered", "ability-unblockable", "ability-undergrowth", "ability-undying", "ability-unearth",
  "ability-valiant", "ability-vigilance", "ability-ward", "artifact", "battle", "commander", "creature",
  "dfc-back", "dfc-day", "dfc-emrakul", "dfc-enchantment", "dfc-facedown", "dfc-front", "dfc-ignite",
  "dfc-land", "dfc-lesson", "dfc-meld", "dfc-modal-back", "dfc-modal-face", "dfc-moon", "dfc-night",
  "dfc-saga", "dfc-saga-creature", "dfc-spark", "enchantment", "flashback", "instant", "land",
  "planeswalker", "saga", "sorcery", "token",
]);

export function CardSymbol(
  { name, label, className = "" }: { name: string; label?: string; className?: string },
): React.JSX.Element | null {
  if (!KNOWN.has(name)) return null;
  return (
    <i
      className={`ms ms-${name} ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      // Inline, for the cascade reason in this file's header: mana's own rules are unlayered and
      // would beat a Tailwind colour utility on this element.
      style={{ color: "currentColor" }}
    />
  );
}
