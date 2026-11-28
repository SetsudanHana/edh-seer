import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/create-actor-1824.json" with { type: "json" };

/** #1824 (sibling of #1808): a token CREATED BY A PLAYER THE CLAUSE NAMES belongs to that player. "Destroy target creature. That creature's controller creates a 3/3 Frog Lizard" (Rapid Hybridization) read as YOUR token, because the create cue knew "its controller" (Beast Within, Pongify: an
 *  opponent's) but not "that creature's controller" or "its owner", which `recipient.ts` reads for a sacrifice (#1808) and for life and cards (#1591). Stored documents and clauses of the production corpus, 2026-11-27. Census of the 149 corpus cards with such an actor and a create-token emit: nine derived `you` (six of "that creature's controller", three of "its owner"). */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical!, undefined, undefined)) as CardTags });
const creates = (name: string): string[] => dc(name).tags!.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "create-token").map((e) => String(e.subject.control)));
const tagsOf = (p: string, c: string, opts = {}) => pairReasons(dc(p), dc(c), loadHierarchy(), opts).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag);

test("the cards print the actor", () => {
  expect(String(F["Rapid Hybridization"]!.source.oracleText)).toBe("Destroy target creature. It can't be regenerated. That creature's controller creates a 3/3 green Frog Lizard creature token.");
  expect(String(F["Beast Within"]!.source.oracleText)).toContain("Its controller creates a 3/3 green Beast creature token.");
  expect(String(F["Mogg Infestation"]!.source.oracleText)).toContain("that player creates two 1/1 red Goblin creature tokens");
});

test.each(["Rapid Hybridization", "Amphin Mutineer", "Ovinomancer", "Incubation // Incongruity"])("%s: the token a targeted creature's controller gets is an opponent's, as Beast Within's and Pongify's are", (n) => {
  expect(creates(n)).toEqual(["opp"]);
});

test.each(["Beast Within", "Pongify", "Forbidden Orchard"])("%s stays an opponent's token", (n) => { expect(creates(n)).toEqual(["opp"]); });

test.each(["Genesis Chamber", "Funeral Pyre", "Pharika, God of Affliction"])("%s: a player who may be you (an untargeted entering creature's controller, the owner of a card from any graveyard) reads `any`", (n) => {
  expect(creates(n)).toEqual(["any"]);
});

test("Curse of the Swine and Mogg Infestation are not yours either (the controllers of several objects, a target player: `any`, #1666 round 3); Yes Man's own owner and Raise the Alarm are", () => {
  expect(creates("Curse of the Swine")).toEqual(["any"]);
  expect(creates("Mogg Infestation")).toEqual(["any"]);
  expect(creates("Yes Man, Personal Securitron")).toEqual(["you"]);
  expect(creates("Raise the Alarm")).toEqual(["you"]);
});

test("the untouched `any` readings stay: Najeela, Dual Nature, Parallel Evolution", () => {
  for (const n of ["Najeela, the Blade-Blossom", "Dual Nature", "Parallel Evolution"]) expect(creates(n), n).toEqual(["any"]);
});

test.each(["Magnus the Red", "Geyser Leaper"])("Rapid Hybridization gives %s's creature-token count nothing; Raise the Alarm does", (c) => {
  for (const opts of [{}, { tokensMediate: false }]) {
    expect(tagsOf("Rapid Hybridization", c, opts).filter((t) => t === "scales:creature"), `Rapid Hybridization -> ${c} ${JSON.stringify(opts)}`).toEqual([]);
    expect(tagsOf("Raise the Alarm", c, opts), `Raise the Alarm -> ${c}`).toContain("scales:creature");
  }
});

// REVIEW OF #1824. "THE EXILED CARD'S OWNER CREATES" (Skyclave Apparition, Severance Priest) is the owner of a card the exile named: an opponent's where the exile says "you don't control" or names a target opponent. It read `you`.
test.each(["Skyclave Apparition", "Severance Priest"])("%s: the exiled card's owner is an opponent, so the Illusion or Spirit is not yours", (n) => {
  expect(creates(n)).toEqual(["opp"]);
});
test("Skyclave Apparition's token feeds no creature-token count of yours (Magnus the Red)", () => {
  for (const opts of [{}, { tokensMediate: false }]) expect(tagsOf("Skyclave Apparition", "Magnus the Red", opts).filter((t) => t === "scales:creature"), JSON.stringify(opts)).toEqual([]);
});

// BRAMBLE SOVEREIGN IS READ `you` BY PRIMARY USE: "Whenever another nontoken creature enters, you may pay {1}{G}. If you do, that creature's controller creates a token that's a copy of that creature" is a payment YOU make, and nobody pays to copy an opponent's creature. An untargeted entering creature's controller with no payment (Genesis Chamber) is anyone.
test("Bramble Sovereign copies your own creatures (you pay); Genesis Chamber, with no payment, stays any", () => {
  expect(creates("Bramble Sovereign")).toEqual(["you"]);
  expect(creates("Genesis Chamber")).toEqual(["any"]);
  for (const c of ["Blood Seeker", "Authority of the Consuls"]) expect(tagsOf("Bramble Sovereign", c).filter((t) => t.startsWith("enters:")), `Bramble Sovereign -> ${c}`).toEqual([]);
});
