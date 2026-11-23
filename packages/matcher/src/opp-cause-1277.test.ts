import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import type { Card } from "@edh-seer/engine";
import { loadHierarchy, pairReasons } from "./index.js";
import { loadRules, ruleMatches } from "./rules.js";
import type { DeckCard } from "./types.js";

/** #1277 (owner 2026-11-23, option A): "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield" is a `dies` trigger with `cause: "opp"`, which `ramp.landPut` reads (Sacred Ground is
 *  retention, not Ramp: owner 2026-10-17) and no producer of the deck meets. Oracle text is the corpus's own (Mongo, 2026-11-23). */
const TEXT = {
  "Sacred Ground": { typeLine: "Enchantment", manaCost: "{1}{W}", oracleText: "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield." },
  "Hedge Shredder": { typeLine: "Artifact — Vehicle", manaCost: "{1}{G}", oracleText: "Whenever this Vehicle attacks, you may mill two cards.\nWhenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)" },
  "Desert Warfare": { typeLine: "Enchantment", manaCost: "{2}{W}", oracleText: "Whenever you sacrifice a Desert and whenever a Desert card is put into your graveyard from your hand or library, put that card onto the battlefield under your control at the beginning of your next end step.\nAt the beginning of combat on your turn, if you control five or more Deserts, create that many 1/1 red, green, and white Sand Warrior creature tokens. They gain haste." },
  "Strip Mine": { typeLine: "Land", manaCost: "", oracleText: "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land." },
  "Armageddon": { typeLine: "Sorcery", manaCost: "{3}{W}", oracleText: "Destroy all lands." },
} as const;
const H = loadHierarchy();
const card = (name: keyof typeof TEXT): DeckCard => {
  const c = { name, keywords: [], ...TEXT[name] };
  const g = grammarClauseRecords(c as never);
  return { card: c as unknown as Card, tags: deriveCardTags(deriveInputOf(c as never, name, name, g.records, undefined, g.readings)) as CardTags };
};
const set = loadRules();
const landPut = set.rules.find((r) => r.id === "ramp.landPut")!;

describe("an opponent-caused land loss (#1277)", () => {
  test("Sacred Ground derives a dies trigger of your land, caused by an opponent, and is not Ramp", () => {
    const sg = card("Sacred Ground");
    const t = sg.tags!.abilities.find((a) => a.trigger)?.trigger;
    expect(t).toMatchObject({ verbs: ["dies"], cause: "opp", subject: { control: "you", type: "land" } });
    expect(ruleMatches(landPut, sg, set)).toBe(false);
  });
  test("Hedge Shredder carries no cause and stays Ramp", () => {
    const hs = card("Hedge Shredder");
    expect(hs.tags!.abilities.some((a) => a.trigger?.cause !== undefined)).toBe(false);
    expect(ruleMatches(landPut, hs, set)).toBe(true);
  });
  test("Desert Warfare carries no cause and stays Ramp", () => {
    const dw = card("Desert Warfare");
    expect(dw.tags!.abilities.some((a) => a.trigger?.cause !== undefined)).toBe(false);
    expect(ruleMatches(landPut, dw, set)).toBe(true);
  });
  test("your own Strip Mine and Armageddon do not pair with Sacred Ground's trigger", () => {
    const sg = card("Sacred Ground");
    for (const p of ["Strip Mine", "Armageddon"] as const) {
      const hits = pairReasons(card(p), sg, H).filter((r) => r.producer === p && r.consumer === "Sacred Ground" && r.tag.startsWith("dies"));
      expect(hits, p).toEqual([]);
    }
  });
});
