import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasonsAcrossFaces } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./renamed-copy.fixtures.json" with { type: "json" };

/** #1577 part 4 (found by it): a copy that is RENAMED is not a second legend. "It becomes a copy of a creature card exiled with it, except its name is Olag, Ludevic's Hubris" (Ludevic, Necrogenius) and "enter as a copy of any creature on the
 *  battlefield, except its name is Sakashima the Impostor" (Sakashima the Impostor) put no second Child of Alara on the battlefield, so the legend rule (CR 704.5j) never puts one into a graveyard. Oracle text and clause records are the corpus's own
 *  (Mongo, 2026-11-09, DERIVE 481). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const legendDeath = (p: string, c: string) => pairReasonsAcrossFaces(card(p), card(c), H).filter((r) => (r.producer ?? "").startsWith(p.split(" //")[0]!) && r.consumer === c && /legend rule/.test(r.text));

describe("a renamed copy fires no legend-rule death", () => {
  test.each(["Ludevic, Necrogenius // Olag, Ludevic's Hubris", "Sakashima the Impostor"])("%s -> Child of Alara: none", (producer) => {
    expect(legendDeath(producer, "Child of Alara")).toEqual([]);
  });
  test("CONTROL: a plain clone of a legendary creature still does", () => {
    expect(legendDeath("Clone", "Child of Alara").length).toBeGreaterThan(0);
  });
});
