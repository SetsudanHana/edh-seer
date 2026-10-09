import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { CutChoice } from "../lib/cut-choice.js";
import { CutList } from "./CutList.js";

const cut = (name: string, extra: Partial<CutChoice> = {}): CutChoice =>
  ({ name, manaValue: 2, keeps: [], onPlan: false, unmet: [], reasons: ["only 1 card connects to it"], twins: [], ...extra });

test("a cut says why it is here and what argues it stays", () => {
  render(<CutList cuts={[cut("Sidekick", { keeps: ["its best edge is on your main theme"], unmet: ["its condition needs a Cleric, and nothing in the deck provides that"] })]} slack={[]} />);
  const row = screen.getByRole("heading", { name: /Sidekick/ }).closest("li")!;
  expect(within(row).getByText("Only 1 card connects to it.")).toBeInTheDocument();
  expect(within(row).getByText("Its condition needs a Cleric, and nothing in the deck provides that.")).toBeInTheDocument();
  expect(within(row).getByText(/Why you might keep it:/).parentElement).toHaveTextContent("its best edge is on your main theme");
  expect(within(row).queryByText(/doesn't fill a core role/)).toBeNull();
});

test("cards nothing argues for and cards with a reason to stay are two groups, the first one first", () => {
  render(<CutList cuts={[cut("Trade-off", { keeps: ["its best edge is on your main theme"] }), cut("Dead weight")]} slack={[]} />);
  const clear = screen.getByRole("region", { name: "Nothing argues for keeping these" });
  const maybe = screen.getByRole("region", { name: "Weak here, but something argues for them" });
  expect(within(clear).getByRole("heading", { name: /Dead weight/ })).toBeInTheDocument();
  expect(within(maybe).getByRole("heading", { name: /Trade-off/ })).toBeInTheDocument();
  expect(clear.compareDocumentPosition(maybe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("trade-offs show four at a time; clear cuts always show in full", async () => {
  const cuts = [
    ...Array.from({ length: 5 }, (_, i) => cut(`Clear ${i + 1}`)),
    ...Array.from({ length: 6 }, (_, i) => cut(`Maybe ${i + 1}`, { keeps: ["rates 1.5 of 5 in this deck"] })),
  ];
  render(<CutList cuts={cuts} slack={[]} />);
  expect(screen.getAllByRole("heading", { name: /^Clear \d/ })).toHaveLength(5);
  expect(screen.getAllByRole("heading", { name: /^Maybe \d/ })).toHaveLength(4);
  await userEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
  expect(screen.getAllByRole("heading", { name: /^Maybe \d/ })).toHaveLength(6);
});

/** THE REST OF THE TRIM (appeal review 2026-09-26): a role over its target says how many can go.
 *  ONE LINE, POINTING AT THE SHELF (owner, 2026-09-27: one place per fact): the cards to pick from
 *  are on the Roles shelves, which were repeated here as card images. */
test("a role over its target says how many can go, and the row takes you to its shelf", () => {
  const card = (name: string) => ({ id: name, name, typeLine: "", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: ["draw"], score: 0, manaCost: "", physical: name });
  render(<CutList cuts={[]} slack={[{ category: "Consistency", count: 16, target: 13, over: 3 }]}
    surplus={[{ name: "Consistency", count: 16, target: 13, over: 3, cards: [card("Brainstorm"), card("Ponder")], shelf: "draw" }]} />);
  // ONE BUTTON PER ROLE, scrolling to that role's own shelf (owner, 2026-09-29: "if I click it it
  // does not work"): a `#roles` link replaced the deck the report keeps in the URL's hash.
  const row = screen.getByRole("button", { name: /Consistency.*16 against 13: up to 3 can go/ });
  expect(screen.queryByRole("link", { name: /on the shelf/ })).toBeNull();
  const shelf = document.createElement("li");
  shelf.id = "shelf-draw";
  shelf.scrollIntoView = vi.fn();
  document.body.appendChild(shelf);
  window.location.hash = "#deck=abc";
  fireEvent.click(row);
  expect(shelf.scrollIntoView).toHaveBeenCalled();
  expect(window.location.hash).toBe("#deck=abc");
  shelf.remove();
  expect(screen.queryByRole("list", { name: "Consistency: 2 cards" })).toBeNull();
  // The bare chip is gone where the cards are shown.
  expect(screen.queryByText("16/13 (+3)")).toBeNull();
});

const add = (name: string) => ({ name, slug: name.toLowerCase().replace(/\W+/g, "-"), identity: [], mv: 2, connections: ["A", "B", "C"], reasons: [{ text: `${name} works with A.`, others: [] }] });

/** ONE PLAN (baseline round 2026-09-26: "cuts and adds are not one plan"). The card that could take
 *  a cut's slot sits on that cut's own card, not in a list of its own. */
test("a cut at deck size carries the card that could take its slot", () => {
  render(<MemoryRouter><CutList cuts={[cut("Multiclass Baldric"), cut("Other")]} slack={[]} deckSize={100}
    pairs={[{ cut: "Multiclass Baldric", add: add("Pious Evangel"), rule: "no-role", counts: [], cutConnections: 1, cutStrength: { strength: 1, partners: 1, onTheme: 0, commander: false }, addStrength: { strength: 2, partners: 4, onTheme: 1, commander: false } }]} /></MemoryRouter>);
  const row = screen.getByRole("heading", { name: /Multiclass Baldric/ }).closest("li")!;
  expect(within(row).getByTestId("swap")).toHaveTextContent("Swap it for Pious Evangel");
  expect(within(row).getByTestId("swap")).toHaveTextContent("works with 4 of your cards, 1 on your deck's theme");
  expect(within(row).getByTestId("swap")).toHaveTextContent("Pious Evangel works with A.");
  expect(within(screen.getByRole("heading", { name: /^Other/ }).closest("li")!).queryByTestId("swap")).toBeNull();
  expect(screen.queryByRole("region", { name: "A card that could take the slot" })).toBeNull();
});

/** OVER 100, THE CUTS REACH 100: the first-deck seat, 8 over, got 7 names and "Trim 3 5 10". */
test("over 100, the list leads with exactly as many cuts as the deck is over, weakest first", () => {
  const cuts = [cut("Maybe 1", { keeps: ["rates 1.5 of 5 in this deck"] }), cut("Clear 1"), cut("Clear 2"), cut("Maybe 2", { keeps: ["rates 1.5 of 5 in this deck"] })];
  render(<MemoryRouter><CutList cuts={cuts} slack={[]} deckSize={103}
    pairs={[{ cut: "Clear 1", add: add("Swap In"), rule: "no-role", counts: [], cutConnections: 0, cutStrength: { strength: 1, partners: 0, onTheme: 0, commander: false }, addStrength: { strength: 2, partners: 4, onTheme: 1, commander: false } }]} /></MemoryRouter>);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("Your list has 103 cards, 3 over 100. These 3 lose no link when cut: every link they make, another card makes too. Take them out and it is 100.");
  expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.replace(/(\d+(\.\d+)? synergy · )?2 mana$/, ""))).toEqual(["Clear 1", "Clear 2", "Maybe 1"]);
  expect(screen.getByText(/If you would rather keep one of these,/).parentElement).toHaveTextContent("the next weakest is Maybe 2.");
  // A deck over its size needs cards out, not swaps.
  expect(screen.queryByTestId("swap")).toBeNull();
});

/** WEAKEST FIRST BY THE NUMBER ON SCREEN (#981): Krenko's eight read 2.3, 2.6, 2.5, 1.6, 2.9 … under
 *  "weakest first", and the first-cuts seat could not tell what the order measured. */
test("within a group, the cuts read in the order of the score they print", () => {
  const cuts = [cut("Clear 1"), cut("Mid", { keeps: ["it scores 2.5 for synergy, where 5 is this deck's best card"] }),
    cut("Low", { keeps: ["it scores 1.6 for synergy, where 5 is this deck's best card"] }), cut("High", { keeps: ["it scores 2.9 for synergy, where 5 is this deck's best card"] })];
  render(<MemoryRouter><CutList cuts={cuts} slack={[]} deckSize={104} /></MemoryRouter>);
  expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.replace(/(\d+(\.\d+)? synergy · )?2 mana$/, ""))).toEqual(["Clear 1", "Low", "Mid", "High"]);
});

/** WHAT A CUT LOSES COMES FIRST (owner 2026-10-07, #981): Roaming Throne led Krenko's cuts at 1.6
 *  while losing 20 links no other card makes, ahead of six that lose nothing. */
test("a cut that loses nothing comes before one that does, whatever the score", () => {
  const row = (loses: string[]) => ({ partners: 3, why: "Works with 3 other cards.", loses: loses.map((text) => ({ from: "a", to: "b", tag: "t", text, repeat: "static" })), covers: [] }) as never;
  const score = (n: string) => [`it scores ${n} for synergy, where 5 is this deck's best card`];
  const cuts = [cut("Throne", { keeps: score("1.6"), row: row(["Kreat's triggers trigger twice", "Taunter's too", "Lackey's too"]) }),
    cut("Mid", { keeps: score("2.5"), row: row([]) }), cut("High", { keeps: score("2.9"), row: row([]) })];
  render(<MemoryRouter><CutList cuts={cuts} slack={[]} deckSize={103} /></MemoryRouter>);
  expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.replace(/(\d+(\.\d+)? synergy · )?2 mana$/, ""))).toEqual(["Mid", "High", "This one costs something to cut, so it is not counted", "Throne"]);
  // ONLY THE LOSS-FREE COUNT TOWARD 100 (owner 2026-10-07): Throne is listed, not counted.
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("These 2 lose no link when cut: every link they make, another card makes too. The other 1 has to come from the one below that costs something to cut, or the cards you like least.");
  const throne = screen.getByRole("heading", { name: /Throne/ }).closest("li")!;
  expect(within(throne).getByTestId("cut-loses")).toHaveTextContent("Why you might keep it: cutting it loses 3 links no other card makes: Kreat's triggers trigger twice; Taunter's too");
  expect(within(throne).getByText("and 1 more")).toBeInTheDocument();
  expect(within(screen.getByRole("heading", { name: /Mid/ }).closest("li")!).getByTestId("cut-loses")).toHaveTextContent("Cutting it loses nothing");
});

/** CUT TOGETHER (review, #981): Elf and Druid each give Payoff the same, so alone each loses nothing
 *  -- and cutting both loses it. Picked one at a time, only one of them counts; the other is listed
 *  as costing something, and says what. */
test("of two cuts that cover each other only one counts, and the other says what cutting both loses", () => {
  const link = { from: "Elf", to: "Payoff", tag: "enters:creature", text: "When an Elf enters, Payoff draws", repeat: "static" };
  const row = (other: string) => ({ partners: 1, why: "Works with 1 other card.", loses: [], covers: [{ link, by: [other], partner: "Payoff" }] }) as never;
  render(<MemoryRouter><CutList cuts={[cut("Elf", { row: row("Druid") }), cut("Druid", { row: row("Elf") }), cut("Spare", { row: row("Nobody") })]} slack={[]} deckSize={102} /></MemoryRouter>);
  const li = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("li")!;
  expect(within(li("Elf")).getByTestId("cut-loses")).toHaveTextContent("Cutting it loses nothing: another card makes every link it makes. Druid alone covers it.");
  expect(screen.getByRole("region", { name: /something to cut/ })).toContainElement(li("Druid"));
  expect(within(li("Druid")).getByTestId("cut-loses")).toHaveTextContent("Why you might keep it: cutting it loses the one link no other card makes: When an Elf enters, Payoff draws.");
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("These 2 lose no link when cut: every link they make, another card makes too. Take them out and it is 100.");
});

/** ONE VERDICT PER CUT (persona round 2026-10-07): "Cutting it loses nothing" beside a green "Why
 *  you might keep it: its strongest link … it scores 2.3" read as two verdicts, on both seats. */
test("a cut that loses nothing names what covers it and argues for itself only with a real reason", () => {
  const link = (text: string, from: string) => ({ from, to: "Lackey", tag: "t", text, repeat: "static" });
  const row = { partners: 2, why: "Works with 2 other cards.", loses: [], covers: [
    { link: link("Lackey is fodder for Trashmaster", "Trashmaster"), by: ["Bushwhacker", "Chieftain"], partner: "Trashmaster" },
    { link: link("Anthem gives Lackey +1/+1", "Anthem"), by: ["Chieftain"], partner: "Anthem" },
  ] } as never;
  const keeps = ["its strongest link: Lackey is fodder for Trashmaster", "it scores 2.8 for synergy, where 5 is this deck's best card"];
  const { unmount } = render(<MemoryRouter><CutList cuts={[cut("Lackey", { keeps, row, rating: 2.8 })]} slack={[]} /></MemoryRouter>);
  const lackey = screen.getByRole("heading", { name: /Lackey/ }).closest("li")!;
  expect(within(lackey).getByTestId("cut-loses")).toHaveTextContent("Cutting it loses nothing: another card makes every link it makes. Chieftain alone covers all 2 cards involved.");
  expect(within(lackey).queryByText(/Why you might keep it/)).toBeNull();
  // The score the order reads is in the header now.
  expect(within(lackey).getByRole("heading", { level: 4 })).toHaveTextContent("2.8 synergy · 2 mana");
  // With nothing arguing for it, it is a clear cut.
  expect(screen.getByRole("region", { name: "Nothing argues for keeping these" })).toContainElement(lackey);
  unmount();
  // A real reason still argues for it.
  render(<MemoryRouter><CutList cuts={[cut("Nabber", { keeps: [...keeps, "you warn the table that it steals permanents"], row })]} slack={[]} /></MemoryRouter>);
  expect(screen.getByText(/Why you might keep it:/).parentElement).toHaveTextContent("Why you might keep it: you warn the table that it steals permanents");
});

/** REVIEW (2026-10-07): a cover is never a card the same list proposes cutting, and a row with no
 *  partners keeps only real reasons. */
test("a cover is never another proposed cut, and a partnerless row shows only real reasons", () => {
  const link = { from: "Elf", to: "Payoff", tag: "enters:creature", text: "When an Elf enters, Payoff draws", repeat: "static" };
  const row = (other: string) => ({ partners: 1, why: "Works with 1 other card.", loses: [], covers: [{ link, by: [other], partner: "Payoff" }] }) as never;
  const { unmount } = render(<MemoryRouter><CutList cuts={[cut("Elf", { row: row("Druid") }), cut("Druid", { row: row("Elf") })]} slack={[]} /></MemoryRouter>);
  for (const name of ["Elf", "Druid"]) {
    const li = screen.getByRole("heading", { name: new RegExp(name) }).closest("li")!;
    expect(within(li).getByTestId("cut-loses")).toHaveTextContent(/^Cutting it loses nothing: another card makes every link it makes\.$/);
  }
  unmount();
  const lone = { partners: 0, why: "Works with nothing else in this deck.", loses: [], covers: [] } as never;
  render(<MemoryRouter><CutList cuts={[cut("Lone", { row: lone, rating: 0.4, keeps: ["it scores 0.4 for synergy, where 5 is this deck's best card"] })]} slack={[]} /></MemoryRouter>);
  const li = screen.getByRole("heading", { name: /Lone/ }).closest("li")!;
  expect(within(li).queryByText(/Why you might keep it/)).toBeNull();
  expect(within(li).getByRole("heading", { level: 4 })).toHaveTextContent("0.4 synergy · 2 mana");
});

test("over 100 with too few cuts, the list says how many are still to find and where", () => {
  const surplus = [{ name: "Consistency", count: 16, target: 13, over: 3, cards: [] }];
  const { unmount } = render(<CutList cuts={[cut("Only One")]} slack={[]} surplus={surplus} deckSize={108} />);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("This one loses no link when cut: every link it makes, another card makes too. The other 7 have to come from a role you run more of than you need, below, or the cards you like least.");
  unmount();
  // NO ROLE OVER ITS TARGET, NO POINTER TO ONE (persona round 2026-09-27: a dead end).
  const { unmount: gone } = render(<CutList cuts={[cut("Only One")]} slack={[]} deckSize={108} />);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("This one loses no link when cut: every link it makes, another card makes too. The other 7 have to come from the cards you like least.");
  gone();
  // THE PLACES NAMED (persona round 2026-09-29: the eighth cut was found by hand in "Fits no theme").
  render(<CutList cuts={[cut("A"), cut("B")]} slack={[]} deckSize={103} fillFrom={["Brightstone Ritual", "Patriar's Seal"]} />);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("These 2 lose no link when cut: every link they make, another card makes too. The other 1 has to come from the cards that fit no theme and are neither interaction nor protection (Brightstone Ritual, Patriar's Seal), or the cards you like least.");
});

test("at deck size, a swap for a role card sits under the cuts; over 100 it does not", () => {
  const pairs = [{ cut: "Despark", add: add("Better Removal"), rule: "same-job" as const, counts: [], cutConnections: 1, cutStrength: { strength: 1, partners: 1, onTheme: 0, commander: false }, addStrength: { strength: 2, partners: 4, onTheme: 1, commander: false } }];
  const { unmount } = render(<MemoryRouter><CutList cuts={[cut("Listed")]} slack={[]} deckSize={100} pairs={pairs} /></MemoryRouter>);
  const row = within(screen.getByRole("region", { name: "Better cards for the same job" })).getByTestId("role-swap");
  expect(row).toHaveTextContent("Out: Despark");
  expect(row).toHaveTextContent("Swap it for Better Removal");
  unmount();
  render(<MemoryRouter><CutList cuts={[cut("Listed")]} slack={[]} deckSize={101} pairs={pairs} /></MemoryRouter>);
  expect(screen.queryByRole("region", { name: "Better cards for the same job" })).toBeNull();
});

// #1085: the line lists only the cards a slot can come from; the rest are counted, not named.
test("fits-no-theme names the free cards and counts the held ones", () => {
  const { unmount } = render(<CutList cuts={[]} slack={[]} offTheme={["Crib Swap"]} offThemeHeld={1} />);
  const line = screen.getByText(/Fits no theme:/).closest("p")!;
  expect(line).toHaveTextContent("Fits no theme: Crib Swap. The next place to look for a slot.");
  expect(line).not.toHaveTextContent(/unless/);
  expect(screen.getByText("1 more fits no theme but fills a role you are at or under target on, or is interaction or protection, so it is not listed.")).toBeInTheDocument();
  unmount();
  render(<CutList cuts={[]} slack={[]} offTheme={["Crib Swap"]} offThemeHeld={3} />);
  expect(screen.getByText("3 more fit no theme but fill a role you are at or under target on, or are interaction or protection, so they are not listed.")).toBeInTheDocument();
});

test("fits-no-theme with nothing free says only the held sentence", () => {
  render(<CutList cuts={[]} slack={[]} offTheme={[]} offThemeHeld={3} />);
  expect(screen.queryByText(/Fits no theme:/)).toBeNull();
  expect(screen.getByText("3 cards fit no theme, but each fills a role you are at or under target on, or is interaction or protection.")).toBeInTheDocument();
  expect(screen.queryByTestId("cut-list")).not.toBeNull();
});

/** THE COVER'S TEXT NEXT TO THE CUT CARD'S (persona round 2026-10-09): "Beetleback Chief alone covers
 *  all 28" could not be checked without leaving the page. */
test("a loses-nothing verdict folds both cards' text under the line, and without a model it does not", () => {
  const link = { from: "Lackey", to: "Payoff", tag: "t", text: "x", repeat: "static" };
  const row = { partners: 1, why: "Works with 1 other card.", loses: [], covers: [{ link, by: ["Chief"], partner: "Payoff" }] } as never;
  const ec = (name: string, text: string) => ({ id: name, name, typeLine: "Creature", text, isToken: false, isCommander: false, isLand: false, isFace: false, roles: [], score: 1, manaCost: "", physical: name });
  const model = { cards: new Map([["Lackey", ec("Lackey", "Lackey makes goblins.")], ["Chief", ec("Chief", "Chief makes more goblins.")]]) } as never;
  const { unmount } = render(<MemoryRouter><CutList cuts={[cut("Lackey", { row })]} slack={[]} model={model} /></MemoryRouter>);
  const fold = screen.getByText("Read both cards").closest("details")!;
  expect(fold).not.toHaveAttribute("open");
  expect(fold).toHaveTextContent("Lackey makes goblins.");
  expect(fold).toHaveTextContent("Chief makes more goblins.");
  unmount();
  render(<MemoryRouter><CutList cuts={[cut("Lackey", { row })]} slack={[]} /></MemoryRouter>);
  expect(screen.queryByText("Read both cards")).toBeNull();
});

/** A DOUBLE-FACED CUT is read on the face whose links the verdict describes (review, #981). */
test("the fold shows the face the row describes, and the cover's front", () => {
  const link = { from: "Back", to: "Payoff", tag: "t", text: "x", repeat: "static" };
  const ec = (id: string, name: string, text: string, extra = {}) => ({ id, name, typeLine: "Creature", text, isToken: false, isCommander: false, isLand: false, isFace: false, roles: [], score: 1, manaCost: "", physical: name, ...extra });
  const front = ec("Front", "Front", "Front text.", { physical: "Front // Back", isFace: true });
  const back = ec("Back", "Back", "Back text.", { physical: "Front // Back", faceOf: "Front", isFace: true });
  const chief = ec("Chief", "Chief", "Chief text.");
  const row = { card: back, partners: 1, why: "w", loses: [], covers: [{ link, by: ["Chief"], partner: "Payoff" }] } as never;
  const model = { cards: new Map([["Front", front], ["Back", back], ["Chief", chief]]) } as never;
  render(<MemoryRouter><CutList cuts={[cut("Front // Back", { row })]} slack={[]} model={model} /></MemoryRouter>);
  const fold = screen.getByText("Read both cards").closest("details")!;
  expect(fold).toHaveTextContent("Back text.");
  expect(fold).not.toHaveTextContent("Front text.");
});

/** A TOKEN COVER GOES WHEN ITS MAKERS DO (review, #981): A's link is given only by a token B makes. */
test("cutting a card and the maker of the token that covers it counts as a loss", () => {
  const link = { from: "A", to: "Payoff", tag: "t", text: "A pays off", repeat: "static" };
  const tok = { id: "token:Goblin", name: "Goblin", typeLine: "Token", text: "", isToken: true, isCommander: false, isLand: false, isFace: false, roles: [], score: 0, manaCost: "", physical: "token:Goblin", madeBy: ["B"] };
  const row = { partners: 1, why: "w", loses: [], covers: [{ link, by: ["token:Goblin"], partner: "Payoff" }] } as never;
  const rowB = { partners: 1, why: "w", loses: [], covers: [] } as never;
  const model = { cards: new Map([["token:Goblin", tok]]) } as never;
  render(<MemoryRouter><CutList cuts={[cut("A", { row }), cut("B", { row: rowB })]} slack={[]} deckSize={102} model={model} /></MemoryRouter>);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("This one loses no link when cut");
});

/** A MAKER'S FACE NAME IS NOT ITS CUT NAME (review, #981): madeBy holds "Maker", the cut list "Maker // Flip". */
test("a token made by a double-faced card goes when that card is cut", () => {
  const link = { from: "A", to: "Payoff", tag: "t", text: "A pays off", repeat: "static" };
  const ec = (id: string, name: string, extra = {}) => ({ id, name, typeLine: "Creature", text: "", isToken: false, isCommander: false, isLand: false, isFace: false, roles: [], score: 1, manaCost: "", physical: name, ...extra });
  const tok = ec("token:Goblin", "Goblin", { isToken: true, physical: "token:Goblin", madeBy: ["Maker"] });
  const maker = ec("Maker", "Maker", { physical: "Maker // Flip", isFace: true });
  const row = { partners: 1, why: "w", loses: [], covers: [{ link, by: ["token:Goblin"], partner: "Payoff" }] } as never;
  const rowM = { partners: 1, why: "w", loses: [], covers: [] } as never;
  const model = { cards: new Map([["token:Goblin", tok], ["Maker", maker]]) } as never;
  render(<MemoryRouter><CutList cuts={[cut("A", { row }), cut("Maker // Flip", { row: rowM })]} slack={[]} deckSize={102} model={model} /></MemoryRouter>);
  expect(screen.getByTestId("cuts-over")).toHaveTextContent("This one loses no link when cut");
});
