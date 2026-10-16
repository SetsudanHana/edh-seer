import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { bandState } from "../lib/deck-gauge.js";
import { ManaGlance } from "./ManaGlance.js";

const deckMath = {
  lands: { actual: 34, target: 37 },
  colors: [
    { color: "U", supplied: 20 },
    { color: "B", supplied: 13, worst: { pips: 2, turn: 2, required: 17, requiredRaw: 17, cards: 1, available: 13 } },
  ],
  castability: { cards: [
    { name: "Rakdos Charm", turn: 2, castable: { low: 0.42, high: 0.51 }, mana: { low: 0.7, high: 0.8 } },
    { name: "Dire Fleet Ravager", turn: 5, castable: { low: 0.48, high: 0.48 }, mana: { low: 0.55, high: 0.55 } },
  ] },
} as never;
const manaAvailability = { headline: { mana: 6, turn: 6, low: 0.52, high: 0.52 } } as never;

/** FIVE ANSWERS BEFORE THE NUMBERS (owner, 2026-09-27: "manabase is also a section that no one is
 *  going to read through"). */
test("the manabase opens with one tile per question, flagging what is short", () => {
  render(<ManaGlance deckMath={deckMath} manaAvailability={manaAvailability} landCount={34} deckSize={100} />);
  const [lands, colour, hands, mana, cast] = screen.getAllByTestId("mana-tile");
  expect(lands).toHaveTextContent("Lands34wants 37: 3 under, within the normal ±3");
  expect(colour).toHaveTextContent("Weakest colour");
  // Which number is which (persona round 2026-09-29): usable by then, in the deck, and needed.
  // NO SLASH (#1033): "30 /37 (of 38 in the deck)" read as a fraction of 37 four rounds running.
  expect(colour).toHaveTextContent(/13 of 17 neededShort of black: you run 13 black sources\. A card wanting.*needs 17 by turn 2\.$/);
  expect(colour).not.toHaveTextContent("/17");
  expect(hands).toHaveTextContent(/Opening hands\d+%have 2 to 4 lands/);
  expect(mana).toHaveTextContent("Mana52%to make 6 mana by turn 6");
  expect(cast).toHaveTextContent("Hardest cast48%Dire Fleet Ravager on turn 5");
});

test("a deck short of nothing says so", () => {
  const fine = { lands: { actual: 37, target: 37 }, colors: [{ color: "G", supplied: 30 }], castability: { cards: [] } } as never;
  render(<ManaGlance deckMath={fine} landCount={37} deckSize={100} />);
  expect(screen.getByText("wants 37: right on target")).toBeInTheDocument();
  expect(screen.getByText("enough sources for every card")).toBeInTheDocument();
});

/** ONE READING OF THE LAND COUNT (#759). The tile had its own ±2, so a deck the Lands dial and the
 *  score call fine was flagged here; now it says what the dial says, and flags only past the band. */
test("the lands tile reads the count as the Lands dial does", () => {
  const at = (actual: number) => ({ lands: { actual, target: 39 }, colors: [], castability: { cards: [] } }) as never;
  const { unmount } = render(<ManaGlance deckMath={at(37)} landCount={37} deckSize={100} />);
  const near = screen.getAllByTestId("mana-tile")[0]!;
  expect(near).toHaveTextContent("wants 39: 2 under, within the normal ±3");
  expect(near).toHaveTextContent(bandState(37, 39).label);
  expect(near.className).not.toMatch(/border-\(--warning\)/);
  unmount();
  render(<ManaGlance deckMath={at(34)} landCount={34} deckSize={100} />);
  const far = screen.getAllByTestId("mana-tile")[0]!;
  expect(far).toHaveTextContent("wants 39: 5 under");
  expect(far.className).toMatch(/border-\(--warning\)/);
});

test("when some sources come too late, the tile says how many of the deck's are there in time", () => {
  const dm = { ...(deckMath as object), colors: [{ color: "B", supplied: 38, worst: { pips: 3, turn: 3, required: 37, requiredRaw: 37, cards: 2, available: 30 } }] } as never;
  render(<ManaGlance deckMath={dm} landCount={37} deckSize={100} />);
  // ENOUGH, BUT NOT IN TIME (persona round 2026-10-07): the verdict the Improve finding gives.
  expect(screen.getAllByTestId("mana-tile")[1]).toHaveTextContent(/30 of 37 neededEnough black, but not in time: you run 38 black sources and only 30 can tap by turn 3 \(tapped lands, and rocks you couldn't have cast yet, don't count\)\. 2 cards wanting.*need 37 by turn 3\.$/);
});

/** #1151, owner ruling 2026-10-10: the tile asks what the player asks -- can I pay for MY spells on
 *  time -- so it leads with the deck's own need; the 6-by-6 benchmark lives in the fold. */
test("the mana tile reads the deck's own need, and falls back to the headline for an old report", () => {
  const withNeed = { headline: { mana: 6, turn: 6, low: 0.59, high: 0.7 }, need: { mana: 4, turn: 4, share: 0.94, low: 0.8, high: 0.8 } } as never;
  const { unmount } = render(<ManaGlance manaAvailability={withNeed} landCount={0} deckSize={0} />);
  expect(screen.getByTestId("mana-tile")).toHaveTextContent("Mana80%to make 4 mana by turn 4; 94% of your spells cost 4 or less");
  unmount();
  render(<ManaGlance manaAvailability={manaAvailability} landCount={0} deckSize={0} />);
  expect(screen.getByTestId("mana-tile")).toHaveTextContent("Mana52%to make 6 mana by turn 6");
});

/** SOURCES THE COUNT COULD NOT READ (#1186): derive lists a mana line it could not read as no colour, and the
 *  tile used to claim "enough sources for every card" over a count that might be short. */
test("a colour tile says which sources it could not read, and no longer claims every card is covered", () => {
  const fine = (unreadSources?: string[]) => ({ lands: { actual: 37, target: 37 }, colors: [{ color: "G", supplied: 30 }], castability: { cards: [] }, ...(unreadSources ? { unreadSources } : {}) }) as never;
  const text = (names?: string[]) => {
    const { unmount } = render(<ManaGlance deckMath={fine(names)} landCount={37} deckSize={100} />);
    const t = screen.getAllByTestId("mana-tile")[1]!.textContent;
    unmount();
    return t;
  };
  expect(text()).toContain("enough sources for every card");
  expect(text()).not.toContain("Not counted");
  const one = text(["Meteor Crater"]);
  expect(one).toContain("Not counted: Meteor Crater (its mana could not be read)");
  expect(one).toContain("enough sources for every card it could read");
  expect(text(["Charmed Pendant", "Incubation Druid", "Meteor Crater"])).toContain("Not counted: Charmed Pendant, Incubation Druid and 1 other card (their mana could not be read)");
});

test("the weakest-colour tile carries the same caveat", () => {
  const short = { ...(deckMath as object), unreadSources: ["Meteor Crater"] } as never;
  render(<ManaGlance deckMath={short} landCount={34} deckSize={100} />);
  expect(screen.getAllByTestId("mana-tile")[1]).toHaveTextContent("Not counted: Meteor Crater (its mana could not be read)");
});

/** #1226: a policy RANGE says which end is which inside its own tile; a collapsed figure adds no
 *  end words (persona rounds 2026-10-14..15: every seat asked which end applied to their game). */
test("a range on the Mana and Hardest cast tiles names its ends; a single figure does not", () => {
  const ranged = { headline: { mana: 6, turn: 6, low: 0.62, high: 0.85 } } as never;
  const dm = { ...(deckMath as object), castability: { cards: [{ name: "Dualcaster Mage", turn: 3, castable: { low: 0.34, high: 0.53 }, mana: { low: 0.71, high: 0.86 } }] } } as never;
  const { unmount } = render(<ManaGlance deckMath={dm} manaAvailability={ranged} landCount={34} deckSize={100} />);
  const tiles = screen.getAllByTestId("mana-tile");
  const mana = tiles.find((t) => t.textContent?.startsWith("Mana"))!;
  const cast = tiles.find((t) => t.textContent?.startsWith("Hardest cast"))!;
  expect(mana).toHaveTextContent("62% – 85%");
  expect(mana).toHaveTextContent("62% if you hold up two mana, 85% if you spend it all on ramp");
  expect(cast).toHaveTextContent("34% if you hold up two mana, 53% if you spend it all on ramp");
  unmount();
  render(<ManaGlance deckMath={deckMath} manaAvailability={manaAvailability} landCount={34} deckSize={100} />);
  expect(document.body.textContent).not.toMatch(/hold up two mana/);
});

test("the need branch of the Mana tile names its ends too (#1226)", () => {
  const withNeed = { headline: { mana: 6, turn: 6, low: 0.59, high: 0.7 }, need: { mana: 4, turn: 4, share: 0.94, low: 0.62, high: 0.85 } } as never;
  render(<ManaGlance manaAvailability={withNeed} landCount={0} deckSize={0} />);
  expect(screen.getByTestId("mana-tile")).toHaveTextContent("62% if you hold up two mana, 85% if you spend it all on ramp");
});

/** #1242 (owner ruling 2026-10-16): the tile keeps its ranking and names every OTHER short colour after the
 *  headline, worst first (persona round 2026-10-16: "the box points at blue" while red was short too). */
test("the weakest-colour tile names the other short colours, worst first, and only when there are some", () => {
  const w = (required: number, available: number, turn: number) => ({ pips: 2, turn, required, requiredRaw: required, cards: 1, available });
  const three = { ...(deckMath as object), colors: [
    { color: "B", supplied: 14, worst: w(17, 12, 1) },
    { color: "U", supplied: 14, worst: w(22, 12, 2) },
    { color: "R", supplied: 14, worst: w(17, 11, 1) },
  ] } as never;
  const { unmount } = render(<ManaGlance deckMath={three} landCount={34} deckSize={100} />);
  const text = screen.getAllByTestId("mana-tile")[1]!.textContent!;
  expect(text).toContain("12 of 22 needed");
  const also = text.indexOf("Also short:");
  expect(also).toBeGreaterThan(text.indexOf("Short of blue"));
  expect(text.indexOf("11 of 17 by turn 1")).toBeGreaterThan(also);
  expect(text.indexOf("12 of 17 by turn 1")).toBeGreaterThan(text.indexOf("11 of 17 by turn 1"));
  expect(text).toMatch(/12 of 17 by turn 1\.$/);
  unmount();
  render(<ManaGlance deckMath={deckMath} landCount={34} deckSize={100} />);
  expect(screen.getAllByTestId("mana-tile")[1]!.textContent).not.toContain("Also short");
});
