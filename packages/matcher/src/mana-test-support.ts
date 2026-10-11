/** TEST SUPPORT for the colour-source consumers (#1169, task 2a): hand-built derived mana tags for the SYNTHETIC cards a unit test
 *  invents (a land that taps for {B}, a rock that costs 2). A card a test names after a real card takes its tags from the real
 *  derive instead (`fixtures/mana-colour-sources.json`, see `mana-colour-sources.test.ts`). */
import type { CardTags, ManaLine, LandFetch } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";

export const FREE_TAP: ManaLine["cost"] = { mana: 0, tap: true, sacrificeSelf: false, sacrificeOther: false, life: 0, counters: null, tapOther: false, other: [] };

/** A free `{T}: Add` line, any field overridable. */
export const mkLine = (over: Partial<ManaLine> = {}): ManaLine => ({
  face: 0, source: "activated", repeats: "per-cycle", cost: FREE_TAP, colours: [], colourless: 0, anyColour: null,
  amount: { fixed: 1, scales: null }, net: 1, unread: false, gate: null, restriction: null, timing: "now", producesToken: null, trigger: null, triggerSubject: null, ...over,
});

/** `{T}: Add` of these colours (`"C"` is colourless; all five is "any colour"). */
export const tapFor = (colours: readonly string[], over: Partial<ManaLine> = {}): ManaLine => {
  const wubrg = colours.filter((c) => c !== "C");
  return mkLine({ colours: wubrg, colourless: colours.includes("C") ? 1 : 0, ...(wubrg.length === 5 ? { anyColour: "any" as const } : {}), ...over });
};

/** A costed tap line: pays `cost` mana, makes `amount` of `colours`. */
export const filterLine = (cost: number, amount: number, colours: readonly string[], over: Partial<ManaLine> = {}): ManaLine =>
  tapFor(colours, { cost: { ...FREE_TAP, mana: cost }, amount: { fixed: amount, scales: null }, net: amount - cost, ...over });

const BLANK = { types: [], subtypes: [], supertypes: [], keywords: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false };
export const manaTags = (lines: ManaLine[], extra: Partial<CardTags> = {}): CardTags =>
  ({ oracleId: "test", schemaVersion: 0, promptVersion: 0, model: "test", characteristics: BLANK, abilities: [], ...(lines.length ? { manaLines: lines } : {}), ...extra }) as unknown as CardTags;

export const fetchTags = (landFetch: LandFetch, over: Partial<ManaLine> = {}): CardTags =>
  manaTags([mkLine({ source: "fetch", repeats: "once", colours: landFetch.reach, cost: { ...FREE_TAP, tap: false }, ...over })], { landFetch });

/** A TRIGGERED line (`trigger` / `aura-trigger`): mana that arrives when `event` fires on `subject`, with no tap and no cost. */
export const triggerLine = (event: string, subject: string, colours: readonly string[], amount: number, over: Partial<ManaLine> = {}): ManaLine => {
  const wubrg = colours.filter((c) => c !== "C");
  return mkLine({ source: "trigger", repeats: "repeatable", cost: { ...FREE_TAP, tap: false }, colours: wubrg, colourless: colours.includes("C") ? 1 : 0,
    amount: { fixed: amount, scales: null }, net: amount, timing: "on-trigger", trigger: event, triggerSubject: subject, ...over });
};

/** An instant or sorcery that adds `amount` of `colours` as it resolves (Dark Ritual). */
export const ritualLine = (colours: readonly string[], amount: number, over: Partial<ManaLine> = {}): ManaLine =>
  tapFor(colours, { source: "one-shot-spell", repeats: "once", cost: { ...FREE_TAP, tap: false, mana: 1 }, amount: { fixed: amount, scales: null }, net: amount - 1, ...over });

/** The same card carrying these derived mana lines (and any other mana keys), keeping whatever tags it already has. */
export const withLines = (dc: DeckCard, lines: ManaLine[], extra: Partial<CardTags> = {}): DeckCard =>
  ({ ...dc, tags: dc.tags ? { ...dc.tags, ...(lines.length ? { manaLines: lines } : {}), ...extra } : manaTags(lines, extra) });

/** The same card as a plain `{T}: Add` source of these colours (`"C"` colourless), `amount` mana per tap. */
export const withTap = (dc: DeckCard, colours: readonly string[], amount = 1): DeckCard =>
  withLines(dc, [tapFor(colours, { amount: { fixed: amount, scales: null }, net: amount })]);
