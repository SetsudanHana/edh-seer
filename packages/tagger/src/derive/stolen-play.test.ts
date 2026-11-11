import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./stolen-play.fixtures.json" with { type: "json" };

/** #1596 item 1: "YOU MAY PLAY THAT CARD / THOSE CARDS" OF A CARD TAKEN FROM ANOTHER PLAYER derived no cast and no land play at all (a `play` emitted only where its object was a land). To play a card is to play it as a land or
 *  cast it as a spell (CR 701.18b), so such a permission is both: a cast and a land play, yours (CR 112.2), of a card its owner still owns (CR 108.3).
 *  Card documents and stored `cardClauses` dumped from Mongo 2026-11-11 (DERIVE 496); derived as derive-corpus derives them (`deriveAsCorpus`: the grammar's records where the grammar reads the card completely). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb && e.subject.self !== true).map((e) => e.subject);

const THIEVES = [
  // the permission points back at what this ability took: "that card", "those cards", "it", "the exiled card(s)", "one of those cards"
  "Brainstealer Dragon", "Praetor's Grasp", "Siphon Insight", "Gonti, Canny Acquisitor", "Thada Adel, Acquisitor", "Fiend of the Shadows", "Knacksaw Clique", "Petty Larceny", "Ornate Kanzashi", "Fallen Shinobi", "Fire Lord Ozai",
  "Edward Kenway", "Korvold and the Noble Thief", "Kotose, the Silent Spider", "Breeches, Brazen Plunderer", "Reno and Rude", "Inside Information",
  // the stored answer left the permission out, or filed it as a grant: read off the printed sentence
  "Black Cat, Cunning Thief", "Dream-Thief's Bandana", "Mindleecher", "Predators' Hour", "Decadent Dragon // Expensive Taste", "Klaw, Master of Sound", "Ixhel, Scion of Atraxa", "Grinning Totem",
  // the permission names a pile another ability of the card fills, or the owner
  "Lobelia, Defender of Bag End", "Rogue Class", "Valgavoth, Terror Eater", "Dauthi Voidwalker", "Tinybones, Bauble Burglar", "Xanathar, Guild Kingpin",
];
describe.each(THIEVES)("%s: 'you may play' a card another player owns", (thief) => {
  test("is YOUR cast of a card an opponent owns", () => {
    const cast = emits(thief, "cast");
    expect(cast.length).toBeGreaterThan(0);
    for (const s of cast) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: "opp" });
  });
  test("and YOUR land play of a land an opponent owns", () => {
    const land = emits(thief, "land-play");
    expect(land.length).toBeGreaterThan(0);
    for (const s of land) expect({ control: s.control, owner: s.owner, type: s.type }).toEqual({ control: "you", owner: "opp", type: "land" });
  });
});
test("Azula, Cunning Usurper: 'you may cast cards exiled with Azula' is a cast though the sentence also grants flash; 'cast' is no land play", () => {
  const cast = emits("Azula, Cunning Usurper", "cast");
  expect(cast.length).toBeGreaterThan(0);
  for (const s of cast) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: "opp" });
  expect(emits("Azula, Cunning Usurper", "land-play")).toEqual([]);
});
// A MIXED SOURCE: each player's library, a target player's cards. You may play your own card too, so no owner is written.
describe.each(["Mezzio Mugger", "Lidless Gaze", "Evelyn, the Covetous", "Extract Power", "Nashi, Moon Sage's Scion", "Rakdos, the Muscle", "Muse Vessel", "Triple Triad"])("%s: a source that can hold your own card", (mixed) => {
  test("is your cast and your land play, with no owner", () => {
    const cast = emits(mixed, "cast"), land = emits(mixed, "land-play");
    expect(cast.length).toBeGreaterThan(0);
    expect(land.length).toBeGreaterThan(0);
    for (const s of [...cast, ...land]) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: undefined });
  });
});
// CEILING pinned: a play of a card off YOUR OWN library derives no cast, as before (296 corpus cards print "you may play" with no cast emit at DERIVE 496; the thieves and the mixed sources are the ones this change reads).
test.each(["Professional Face-Breaker", "Jeska's Will", "Light Up the Stage", "Act on Impulse"])("%s plays cards off your own library: unchanged, no cast and no land play", (own) => {
  expect(emits(own, "cast")).toEqual([]);
  expect(emits(own, "land-play")).toEqual([]);
});
