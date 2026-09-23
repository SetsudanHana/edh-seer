import { fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { CardSearch, QUERY_SETTLE_MS, SEARCH_LIMIT } from "./CardSearch.js";
import type { EventFrequencyFile, EventMembers, NameIndexEntry } from "../lib/partners.js";
import { eventKeyAction } from "../lib/demand-sentence.js";

const INDEX: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "krenkos-command", name: "Krenko's Command", identity: ["R"], commander: false },
  { slug: "jotun-grunt", name: "Jötun Grunt", identity: ["W"], commander: false },
  { slug: "ajanis-chosen", name: "Ajani's Chosen", identity: ["W"], commander: false },
];

/** NO VOCABULARY IN THIS FILE, AND IT MUST BE SAID OUT LOUD. `vocabulary` defaults to
 *  `sharedNameIndexVocabulary`, which fetches -- so a render that stubs `load` and forgets this one
 *  reaches undici with `/static/name-index.json`, a URL with no origin, and the rejection lands
 *  OUTSIDE the test as an unhandled error. The suite still reported every test passing and exited
 *  1, which is the shape that is easy to read as green. Empty tables are the old-artifact answer
 *  the component already handles; the tests that are ABOUT type and subtype pass their own. */
const NO_VOCABULARY = async () => ({ types: [], subtypes: [], keywords: [] });

const at = (index: NameIndexEntry[] = INDEX, props: Partial<Parameters<typeof CardSearch>[0]> = {}) =>
  render(<MemoryRouter><CardSearch load={async () => index} vocabulary={NO_VOCABULARY} {...props} /></MemoryRouter>);

/** ADDING A ROW IS NOW PART OF ASKING (owner, 2026-09-21). Nothing is drawn until it is asked for,
 *  so a test that clicks a colour chip has to create the colour row first -- which is exactly what
 *  a reader does, and the reason these seven tests changed rather than the behaviour they pin. */
const addFilter = async (label: string) => {
  await userEvent.click(await screen.findByText("Add a filter"));
  await userEvent.click(await screen.findByRole("button", { name: label }));
};

test("typing a name lists matching cards as links", async () => {
  at();
  await userEvent.type(await screen.findByRole("searchbox"), "krenko");
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ }))
    .toHaveAttribute("href", "/cards/krenko-mob-boss");
  expect(screen.getByRole("link", { name: /Krenko's Command/ })).toBeInTheDocument();
});

/** THE QUERY IS MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes,
 *  so a reader who types what they can reach on their keyboard finds the card -- and finds it under
 *  exactly the spelling the link will use. A raw substring match would answer "Jötun" and not
 *  "jotun", which is the one a reader is more likely to type. */
test("the search folds diacritics and punctuation, because the slug does", async () => {
  at();
  const box = await screen.findByRole("searchbox");
  await userEvent.type(box, "jotun");
  expect(await screen.findByRole("link", { name: /Jötun Grunt/ })).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, "ajanis");
  expect(await screen.findByRole("link", { name: /Ajani's Chosen/ })).toBeInTheDocument();
});

/** A SHARE LINK COPIED BEFORE THE SURFACES MOVED lands here, because `/cards` used to BE the
 *  report's card list. The hash never reaches the server, so no edge rule can tell that link from
 *  someone who typed `/cards` -- the check has to be in the client, and it is the same component
 *  the other two legacy paths use. */
test("a stale share link on /cards hands off to /analysis/cards", () => {
  const replace = vi.fn();
  at(INDEX, { hash: "#deck=abc", replace });
  expect(replace).toHaveBeenCalledWith("/analysis/cards#deck=abc");
});

test("someone who typed /cards is left alone", () => {
  const replace = vi.fn();
  at(INDEX, { hash: "", replace });
  expect(replace).not.toHaveBeenCalled();
});

/** THE BOX IS THE PAGE, so it takes focus on arrival and a reader can type without reaching for a
 *  mouse. It is labelled rather than placeholder-only: a placeholder disappears the moment anyone
 *  types, and is not an accessible name. */
test("the search box is labelled and holds focus on arrival", async () => {
  at();
  const box = await screen.findByRole("searchbox");
  expect(box).toHaveAccessibleName();
  expect(box).toHaveFocus();
});

/** AN EMPTY QUERY IS NOT AN EMPTY PAGE, AND IT IS NOT 15,350 LINKS EITHER. The index is the whole
 *  corpus; rendering it on mount would be the jank the cap exists to prevent, and rendering nothing
 *  reads as a page that failed to load. */
test("before anything is typed the page says what it holds, and lists nothing", async () => {
  at();
  // The figure leads and the sentence follows it, so they are two elements.
  expect(await screen.findByText("4")).toBeInTheDocument();
  expect(screen.getByText(/cards the engine has read/)).toBeInTheDocument();
  // Scoped to the results list: the page foot carries links of its own.
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

test("a query matching more than the cap shows the cap and says how many it found", async () => {
  const many = Array.from({ length: SEARCH_LIMIT + 7 }, (_, i) => ({
    slug: `goblin-${i}`, name: `Goblin ${i}`, identity: ["R"], commander: false,
  }));
  at(many);
  await userEvent.type(await screen.findByRole("searchbox"), "goblin");
  expect(await screen.findByText(new RegExp(`${SEARCH_LIMIT + 7} cards match`))).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Results" })).getAllByRole("link"))
    .toHaveLength(SEARCH_LIMIT);
});

/** THE PAGE TURNS ITSELF (owner, 2026-09-21). The deck-build agent read "798 cards match, showing
 *  the first 50", never found the button under the grid, and never saw the other 748.
 *
 *  THE RULE IS ASSERTED, NOT THE LAYOUT. jsdom lays nothing out, so the observer is driven by hand
 *  -- the same shape `ReportShell.test.tsx` uses for the chapter rail. What can actually be wrong
 *  is whether an intersection adds a page, whether the BUTTON survives for a keyboard, and whether
 *  loading stops so the footer below stays reachable. */
test("scrolling the end of the list into view loads the next page, and the button stays", async () => {
  let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: typeof fire) { fire = cb; }
    observe() {} disconnect() {}
  });
  const many = Array.from({ length: SEARCH_LIMIT + 7 }, (_, i) => ({
    slug: `goblin-${i}`, name: `Goblin ${i}`, identity: ["R"], commander: false,
  }));
  at(many);
  await userEvent.type(await screen.findByRole("searchbox"), "goblin");
  // THE LIST ANSWERS WHEN TYPING SETTLES, not on the last key (QUERY_SETTLE_MS) -- and the list is
  // ALREADY drawn before then, because "g" matches every goblin too. Waiting for the list alone
  // raced the settle: when it landed after the scroll below, the new `matches` reset the page to 50
  // (`setShown` on `[matches]`) and the assertion read 50 of 57. Failed on CI twice on 2026-09-23,
  // once per Node leg, never locally. So the settle is waited out, not guessed at.
  await act(() => new Promise((r) => setTimeout(r, QUERY_SETTLE_MS + 50)));
  await screen.findByRole("list", { name: "Results" });
  const results = () => within(screen.getByRole("list", { name: "Results" })).getAllByRole("link");
  expect(results()).toHaveLength(SEARCH_LIMIT);
  // A KEYBOARD STILL HAS A WAY THROUGH -- the half infinite scroll is known for breaking.
  expect(screen.getByRole("button", { name: /Show \d+ more/ })).toBeInTheDocument();

  act(() => { fire([{ isIntersecting: true }]); });
  await waitFor(() => expect(results()).toHaveLength(SEARCH_LIMIT + 7));

  // AND IT STOPS. With nothing left to show the button unmounts, so the list ends and `PageFoot`
  // below it is reachable -- a footer that retreats forever is this pattern's real defect.
  expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
});

test("a query that matches nothing says so", async () => {
  at();
  await userEvent.type(await screen.findByRole("searchbox"), "zzzz");
  expect(await screen.findByText(/No card/i)).toBeInTheDocument();
});

const COMMANDERS: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "kess-dissident-mage", name: "Kess, Dissident Mage", identity: ["B", "R", "U"], commander: true },
  { slug: "kozilek", name: "Kozilek, the Great Distortion", identity: [], commander: true },
  { slug: "sol-ring", name: "Sol Ring", identity: [], commander: false },
];

const commanders = (props: Partial<Parameters<typeof CardSearch>[0]> = {}) =>
  render(<MemoryRouter><CardSearch mode="commanders" load={async () => COMMANDERS} vocabulary={NO_VOCABULARY} {...props} /></MemoryRouter>);

/** THE INDEX IS EVERY CARD; ONLY 2,423 OF THE 15,350 CAN LEAD A DECK. A commander search that
 *  answered Sol Ring would be answering a different question. */
test("the commander search lists only cards that can lead a deck", async () => {
  commanders();
  await userEvent.type(await screen.findByRole("searchbox"), "s");
  expect(await screen.findByRole("link", { name: /Kess, Dissident Mage/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Sol Ring/ })).not.toBeInTheDocument();
});

test("a commander link goes to the commander page, not the card page", async () => {
  commanders();
  await userEvent.type(await screen.findByRole("searchbox"), "krenko");
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ }))
    .toHaveAttribute("href", "/commanders/krenko-mob-boss");
});

/** BROWSING BY COLOUR IS THE POINT OF THIS PAGE, so a facet alone lists results -- a reader
 *  choosing "red" has asked a complete question and should not have to type as well. */
test("an identity facet lists commanders without anything typed", async () => {
  commanders();
  await addFilter("Colour identity");
  await userEvent.click(await screen.findByRole("button", { name: /^Red$/ }));
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  // "Red" NAMES THE IDENTITY: mono-red, not everything with red in it. A Grixis commander is a
  // Grixis commander, and it is the answer to "Blue, Black, Red".
  expect(screen.queryByRole("link", { name: /Kess, Dissident Mage/ })).not.toBeInTheDocument();
  // A colourless commander has no red in it either.
  expect(screen.queryByRole("link", { name: /Kozilek/ })).not.toBeInTheDocument();
});

/** THE FACETS NAME THE IDENTITY EXACTLY (owner ruling 2026-09-04). "Red, Green" asks for Gruul, not
 *  for the Jund and Naya commanders that also contain both — a colour pair is how a player names a
 *  deck, and the chips answer with that pair and nothing wider. */
test("the facets name an identity exactly, not the ones that contain it", async () => {
  commanders();
  await addFilter("Colour identity");
  await userEvent.click(await screen.findByRole("button", { name: /^Blue$/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Black$/ }));
  // Two of Kess's three: Kess is Grixis, and Dimir is not Grixis.
  expect(await screen.findByText(/No commander matches/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^Red$/ }));
  expect(await screen.findByRole("link", { name: /Kess, Dissident Mage/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Krenko, Mob Boss/ })).not.toBeInTheDocument();
});

test("a facet toggles off again", async () => {
  commanders();
  await addFilter("Colour identity");
  const red = await screen.findByRole("button", { name: /^Red$/ });
  await userEvent.click(red);
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  await userEvent.click(red);
  // Scoped to the results list: the page foot carries links of its own.
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
});

/** THE CARD SEARCH HAS THE COLOUR CHIPS TOO (spec 2026-09-08 part 4). What they MEAN here changed
 *  on 2026-09-19: a card list is read while building a deck, so "Red" asks for the cards a red deck
 *  could play -- red, and colourless. The 2026-09-08 exact-on-both ruling survives on Commanders,
 *  which is read to CHOOSE a commander, where a mono-red commander is a different deck. */
test("the card search fits the identity in: a colourless card answers a colour query", async () => {
  const index: NameIndexEntry[] = [
    ...INDEX,
    { slug: "sol-ring", name: "Sol Ring", identity: [], commander: false },
  ];
  at(index);
  await screen.findByRole("searchbox");
  await addFilter("Colour identity");
  await userEvent.click(screen.getByRole("button", { name: /^Red$/ }));
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  // Playable in a red deck, and the whole point of the reversal.
  expect(screen.getByRole("link", { name: /Sol Ring/ })).toBeInTheDocument();
  // Still not playable in a red deck.
  expect(screen.queryByRole("link", { name: /Ajani's Chosen/ })).toBeNull();
});

/** A SEARCH IS A LINK. `/cards/krenko-mob` is a slug nobody minted and its page cannot guess what
 *  was meant -- but it hands the reader here with what they typed already in the box, which is the
 *  recovery from a truncated or misremembered name. It also makes any search shareable. */
test("the box is seeded from the URL, and typing puts the query back into it", async () => {
  render(
    <MemoryRouter initialEntries={["/cards?q=krenko%20mob"]}>
      <CardSearch load={async () => INDEX} vocabulary={NO_VOCABULARY} />
    </MemoryRouter>,
  );
  const box = await screen.findByRole("searchbox");
  expect(box).toHaveValue("krenko mob");
  // "krenko mob" slugs to `krenko-mob`, which is a prefix of `krenko-mob-boss` -- the near miss the
  // dead-end page could not resolve on its own.
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  await userEvent.type(box, "x");
  expect(await screen.findByText(/No card matches/)).toBeInTheDocument();
});

/** ONE RESULT IS NOT "1 commanders match", and a single result is the COMMON case here -- it is what
 *  the not-found page's seeded search produces when a reader mistyped one card's name. */
test("the count line agrees with itself when there is one result", async () => {
  render(
    <MemoryRouter initialEntries={["/cards?q=jotun"]}><CardSearch load={async () => INDEX} vocabulary={NO_VOCABULARY} /></MemoryRouter>,
  );
  expect(await screen.findByText("1 card matches.")).toBeInTheDocument();
});

/** COLOURLESS IS A REAL IDENTITY AND WAS UNREACHABLE (owner-reported 2026-09-04). 13 of the 2,428
 *  commanders have an empty identity -- Ulamog, Kozilek, Emrakul, Galactus -- and no combination of
 *  the five colours could ASK for them: an empty identity is a subset of every filter, so they
 *  appeared under "Red" and under nothing of their own. */
test("a colourless facet reaches the commanders no colour can ask for", async () => {
  commanders();
  await addFilter("Colour identity");
  await userEvent.click(await screen.findByRole("button", { name: /^Colourless$/ }));
  expect(await screen.findByRole("link", { name: /Kozilek/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Krenko, Mob Boss/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Kess/ })).not.toBeInTheDocument();
});

/** AND COLOURLESS IS EXCLUSIVE OF THE FIVE. Every identity already contains the colourless cards,
 *  so the two questions cannot be asked at once -- holding both selected would only ever draw an
 *  empty list. Ticking a colour unticks it, and it unticks every colour. */
test("ticking a colour unticks colourless, and colourless unticks the colours", async () => {
  commanders();
  await addFilter("Colour identity");
  const colourless = await screen.findByRole("button", { name: /^Colourless$/ });
  await userEvent.click(colourless);
  expect(colourless).toHaveAttribute("aria-pressed", "true");

  const red = screen.getByRole("button", { name: /^Red$/ });
  await userEvent.click(red);
  expect(colourless).toHaveAttribute("aria-pressed", "false");
  expect(await screen.findByRole("link", { name: /Krenko, Mob Boss/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Kozilek/ })).not.toBeInTheDocument();

  await userEvent.click(colourless);
  expect(red).toHaveAttribute("aria-pressed", "false");
  expect(await screen.findByRole("link", { name: /Kozilek/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Krenko, Mob Boss/ })).not.toBeInTheDocument();
});

/** AN EMPTY IDENTITY IS COLOURLESS, NOT ABSENT. Rendering nothing there made 1,354 cards look like
 *  rows whose identity had failed to load. */
test("a colourless row shows the colourless symbol rather than nothing", async () => {
  commanders();
  await addFilter("Colour identity");
  await userEvent.click(await screen.findByRole("button", { name: /^Colourless$/ }));
  const row = (await screen.findByRole("link", { name: /Kozilek/ })).closest("li")!;
  // `ManaSymbols` labels both the wrapper and the symbol itself, so this asserts presence rather
  // than uniqueness.
  expect(within(row).getAllByRole("img", { name: /colorless/i }).length).toBeGreaterThan(0);
});

/** FIND BY WHAT A CARD CAUSES (spec 2026-09-19, roadmap AJ3). The counts are read only once the
 *  pickers are touched; a member list is read only for an event actually chosen; every term ANDs.
 *
 *  THE IDS ARE POSITIONS IN THE NAME INDEX, which is exactly how the artifact ships them. */
const MILL = "mill|-|-|-";
const DIES = "dies|creature|-|-";
const FREQ: EventFrequencyFile = {
  supply: { [MILL]: 2, [DIES]: 1 },
  consume: { [DIES]: 2 },
  byIdentity: { [MILL]: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [DIES]: Array.from({ length: 32 }, () => 0) },
};
/** index 0 Fathom Mage (UG), 1 Inspiring Call (G), 2 Skullclamp (colourless). */
const MEMBERS: Record<string, EventMembers> = {
  [MILL]: { p: [1, 2], c: [] },
  [DIES]: { p: [0], c: [0, 1] },
};
const members = async (_base: string, key: string): Promise<EventMembers | null> => MEMBERS[key] ?? null;
const INDEX2: NameIndexEntry[] = [
  { slug: "fathom-mage", name: "Fathom Mage", identity: ["U", "G"], commander: true },
  { slug: "inspiring-call", name: "Inspiring Call", identity: ["G"], commander: false },
  { slug: "skullclamp", name: "Skullclamp", identity: [], commander: false },
];
const atUrl = (url: string, props: Partial<Parameters<typeof CardSearch>[0]> = {}, spy?: () => void) => {
  const path = url.split("?")[0]!;
  function Spy() { const loc = useLocation(); spy?.(); (Spy as unknown as { search: string }).search = loc.search; return null; }
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<><CardSearch load={async () => INDEX2} frequency={async () => FREQ} members={members} vocabulary={NO_VOCABULARY} {...props} /><Spy /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return Spy as unknown as { search: string };
};

/** THE BOX ASKS WHEN TYPING SETTLES, NOT PER KEY (owner, 2026-09-22). Bound to the URL, every key
 *  was a navigation, and on the live site a burst of them raced each other: "Snapcaster" arrived as
 *  `q=ar`. jsdom cannot reproduce that race, so the RULE is asserted instead -- the letters are all
 *  in the box at once, and the URL is written once, after the pause. Proven to fail on the old
 *  binding, which wrote `?q=Skull` before the pause was over. */
test("the name box keeps every letter at once and writes the URL only when typing settles", async () => {
  const url = atUrl("/cards");
  const box = await screen.findByRole("searchbox");
  await userEvent.type(box, "Skull", { delay: null });
  expect(box).toHaveValue("Skull");
  expect(url.search).not.toContain("q=");
  await waitFor(() => expect(url.search).toBe("?q=Skull"));
  expect(await screen.findByRole("link", { name: /Skullclamp/ })).toBeInTheDocument();
});

/** A CONTROL CHANGED MID-WORD KEEPS BOTH (review, 2026-09-22). The order select writes the URL
 *  from its render-time params while the name is still waiting to be written; neither may undo the
 *  other. */
test("changing the order while a name is still settling keeps the name and the order", async () => {
  const url = atUrl(`/cards?produce=${encodeURIComponent(MILL)}`);
  await screen.findByRole("link", { name: /Inspiring Call/ });
  await userEvent.type(screen.getByRole("searchbox"), "Insp", { delay: null });
  await userEvent.selectOptions(screen.getByLabelText("Order"), "name");
  await waitFor(() => expect(url.search).toContain("q=Insp"));
  expect(url.search).toContain("sort=name");
  expect(url.search).toContain("produce=");
  expect(screen.getByRole("searchbox")).toHaveValue("Insp");
});

/** AND THE BOX FOLLOWS A URL IT DID NOT WRITE. A shared link arrives with `q` and the box shows it. */
test("the name box shows the query a link arrived with", async () => {
  atUrl("/cards?q=fathom");
  expect(await screen.findByRole("searchbox")).toHaveValue("fathom");
});

test("a produce key lists that event's cards and nothing else", async () => {
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}`);
  expect(await screen.findByRole("link", { name: /Inspiring Call/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Skullclamp/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Fathom Mage/ })).toBeNull();
  expect(await screen.findByRole("status")).toHaveTextContent("2 cards match");
});

/** THE COUNT IS THE LIST. A chip that says 2 linking to a page that lists 3 is the AJ1 defect
 *  wearing a URL, so the status line is asserted against the rendered links. */
test("the count above the list is the length of the list", async () => {
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}`);
  await screen.findByRole("status");
  const links = within(screen.getByRole("list", { name: "Results" })).getAllByRole("link");
  expect(screen.getByRole("status")).toHaveTextContent(`${links.length} cards match`);
});

test("two events AND rather than widen", async () => {
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}&produce=${encodeURIComponent(DIES)}`);
  // Nothing both mills and causes a death in this fixture.
  expect(await screen.findByText(/No card matches/)).toBeInTheDocument();
});

test("produce and consume are different questions about the same event", async () => {
  atUrl(`/cards?consume=${encodeURIComponent(DIES)}`);
  expect(await screen.findByRole("link", { name: /Fathom Mage/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Inspiring Call/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Skullclamp/ })).toBeNull();
});

/** A MISSING LIST IS NOT AN EMPTY ONE. A shard that does not carry the key means the page cannot
 *  answer; rendering "no cards" there would be a claim, and a wrong one. */
test("an event the artifact does not carry says nothing rather than no cards", async () => {
  atUrl("/cards?produce=enters%7Cland%7C-%7C-");
  await waitFor(() => expect(screen.queryByText(/reading/i)).not.toBeNull());
  expect(screen.queryByRole("list", { name: "Results" })).toBeNull();
  expect(screen.queryByText(/No card matches/)).toBeNull();
});

test("the counts are not fetched until the pickers are touched", async () => {
  const frequency = vi.fn(async () => FREQ);
  atUrl("/cards?q=skull", { frequency });
  await screen.findByRole("link", { name: /Skullclamp/ });
  expect(frequency).not.toHaveBeenCalled();
});

test("a chosen event fetches its list, and only its list", async () => {
  const spy = vi.fn(members);
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}`, { members: spy });
  await screen.findByRole("link", { name: /Inspiring Call/ });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("/static", MILL);
});

/** TYPING A NAME USED TO ERASE THE REST OF THE QUERY: `setParams({ q })` replaced the whole search
 *  string. Harmless when the only other params were chips a reader could see; a silent loss now. */
test("typing a name keeps the events that are already chosen", async () => {
  const spy = atUrl(`/cards?produce=${encodeURIComponent(MILL)}`);
  await userEvent.type(await screen.findByRole("searchbox"), "skull");
  await waitFor(() => expect(new URLSearchParams(spy.search).get("q")).toBe("skull"));
  expect(new URLSearchParams(spy.search).getAll("produce")).toEqual([MILL]);
});

/** THE REVERSAL (owner 2026-09-19). A card list is read while building a deck, so it fits in; a
 *  commander list is read to choose a commander, so it stays exact. */
test("cards fit the identity in, commanders match it exactly", async () => {
  atUrl("/cards?colors=UG");
  expect(await screen.findByRole("link", { name: /Fathom Mage/ })).toBeInTheDocument();
  // Playable in a UG deck: mono-green, and the colourless card.
  expect(screen.getByRole("link", { name: /Inspiring Call/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Skullclamp/ })).toBeInTheDocument();
});

test("a commander query still names the identity exactly", async () => {
  atUrl("/commanders?colors=UG", { mode: "commanders" });
  expect(await screen.findByRole("link", { name: /Fathom Mage/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Inspiring Call/ })).toBeNull();
});

/** THE RESULT LIST PEEKS TOO (owner 2026-09-08: "the same issue with the new filters, you open a new
 *  page and so on"). A plain click on a result looks at the card beside the list; the filters, the
 *  count and the URL stay. A modifier click still opens the page. */
test("a plain click on a result peeks and keeps the filtered list and URL", async () => {
  const spy = atUrl(`/cards?colors=G&produce=${encodeURIComponent(MILL)}`, {
    peekLoad: async (slug: string) => ({
      name: slug === "inspiring-call" ? "Inspiring Call" : slug, typeLine: "Instant", manaCost: "{2}{G}", artCrop: null,
      backArtCrop: null, abilities: [], identity: ["G"], commander: false, emits: [], demands: [], partners: [], pool: {}, rarity: {},
    }),
  });
  const link = await screen.findByRole("link", { name: /Inspiring Call/ });
  fireEvent.click(link);
  expect(await screen.findByRole("dialog", { name: "Inspiring Call" })).toBeInTheDocument();
  expect(new URLSearchParams(spy.search).getAll("produce")).toEqual([MILL]);
  expect(new URLSearchParams(spy.search).get("colors")).toBe("G");
  // The row is still there, under the results; the peek's own Open control is the other link.
  expect(within(screen.getByRole("list", { name: "Results" })).getByRole("link", { name: /Inspiring Call/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

/** A COMMANDER PEEK OPENS THE COMMANDER VIEW (owner 2026-09-08: "choose a commander, the popup says
 *  open a card and opens a card view"). The list row already points at `/commanders/<slug>`; the
 *  peek's own Open control has to agree with it. */
test("on /commanders the peek's Open control goes to the commander page", async () => {
  commanders({
    peekLoad: async () => ({
      name: "Krenko, Mob Boss", typeLine: "Legendary Creature", manaCost: "{2}{R}{R}", artCrop: null,
      backArtCrop: null, abilities: [], identity: ["R"], commander: true, emits: [], demands: [],
      partners: [{ name: "Skullclamp", slug: "skullclamp", score: 0.3, event: "dies|creature|-|-", reason: "equip" }], pool: {}, rarity: {},
    }),
  });
  await userEvent.type(await screen.findByRole("searchbox"), "krenko");
  fireEvent.click(await screen.findByRole("link", { name: /Krenko/ }));
  await screen.findByRole("dialog", { name: "Krenko, Mob Boss" });
  expect(screen.getByRole("link", { name: "Open Krenko, Mob Boss" })).toHaveAttribute("href", "/commanders/krenko-mob-boss");
  expect(screen.getByRole("link", { name: "Open Krenko, Mob Boss" })).toHaveTextContent("Open commander");
  // A deeper look is one of its partners, and a partner is a card.
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Skullclamp" }));
  await screen.findByRole("button", { name: "Back" });
  expect(screen.getByRole("link", { name: /^Open / })).toHaveAttribute("href", "/cards/skullclamp");
});

test("a modifier click on a result opens the page", async () => {
  atUrl("/cards?q=skull");
  const link = await screen.findByRole("link", { name: /Skullclamp/ });
  fireEvent.click(link, { metaKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
});

/** THE PANEL IS A LIST OF ROWS YOU ADD (owner, 2026-09-21: "cards are like 20 % of the screen").
 *
 *  This replaces the phone disclosure and the `matchMedia` branch that chose it. Measured on the
 *  deployed page at 1920x1080 before the change: the first card sat at 772px of a 930px viewport,
 *  behind eight labelled groups. One model at every width now, so there is no narrow branch left
 *  to mock -- which is just as well, because a max-width media query reads false under jsdom and
 *  that branch was never really covered. */
test("nothing is asked, so no filter row is drawn", async () => {
  atUrl("/cards");
  await screen.findByRole("searchbox");
  expect(screen.getByText("Add a filter")).toBeInTheDocument();
  // The controls exist only once asked for. Colour identity included: no row is privileged.
  expect(screen.queryByRole("button", { name: /^Red$/ })).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("a filter is added from the menu, and leaves the menu once it is there", async () => {
  atUrl("/cards");
  await addFilter("Colour identity");
  expect(await screen.findByRole("button", { name: /^Red$/ })).toBeInTheDocument();
  // Offering it twice would be offering a row that already exists.
  await userEvent.click(screen.getByText("Add a filter"));
  expect(screen.queryByRole("button", { name: "Colour identity" })).toBeNull();
  expect(screen.getByRole("button", { name: "Mana value" })).toBeInTheDocument();
});

/** A SHARED LINK ARRIVES SHOWING WHAT IT ASKS. The rows come from the URL, not from what was
 *  clicked -- otherwise `?subtype=sliver&mv=3` would land on a page filtering by two things it
 *  does not mention, which is the worst of both: narrowed, and silent about why. */
test("a link carrying a question arrives with that question's rows open", async () => {
  atUrl("/cards?colors=G&mv=3");
  expect(await screen.findByRole("button", { name: /^Green$/ })).toHaveAttribute("aria-pressed", "true");
  // `?mv=3` was the ceiling, so it arrives as the range's TO end and its FROM end is open.
  expect(screen.getByLabelText("Mana value, to")).toHaveValue("3");
  expect(screen.getByLabelText("Mana value, from")).toHaveValue("");
  // And only those: an event row was not asked for.
  expect(screen.queryByText("events the card can cause")).toBeNull();
});

/** REMOVING A ROW CLEARS ITS QUESTION. Hiding the control while the param went on narrowing the
 *  list is the shape of "the filter I removed is still filtering". */
test("removing a row clears what it was asking", async () => {
  const spy = atUrl("/cards?colors=G&mv=3");
  await screen.findByRole("button", { name: /^Green$/ });
  await userEvent.click(screen.getByRole("button", { name: "Remove the Mana value filter" }));
  expect(screen.queryByLabelText("Mana value, to")).toBeNull();
  expect(spy.search).not.toContain("mv=");
  // Its neighbour is untouched -- a removal that widened two questions would be a silent one.
  expect(spy.search).toContain("colors=G");
});

/** AND THE COUNTS FOLLOW THE ROW. Nothing is fetched for a reader who never asks about an event;
 *  the fetch starts when the row is added rather than when a control happens to take focus. */
test("the event counts are read when an event row is added, not before", async () => {
  const freq = vi.fn(async () => FREQ);
  atUrl("/cards", { frequency: freq });
  await screen.findByRole("searchbox");
  expect(freq).not.toHaveBeenCalled();
  await addFilter("Causes");
  await waitFor(() => expect(freq).toHaveBeenCalled());
});

/** A ROW OUTLIVES ITS OWN VALUE (review, 2026-09-21). `shownKinds` was the URL's rows plus the ones
 *  added from the menu, so emptying a row that CAME from a link unmounted it -- untick the only
 *  colour to swap Red for Blue and the whole control vanished, taking the reader's place in the
 *  task with it. Reproduced in a browser before it was fixed: `/cards?colors=R`, click Red, and
 *  the row is gone. Destroying the control someone is operating is WCAG 3.2.2 territory, and the
 *  remove button is the only thing that should ever take a row away. */
test("emptying a row keeps the row, so a colour can be swapped for another", async () => {
  atUrl("/cards?colors=R");
  const red = await screen.findByRole("button", { name: /^Red$/ });
  await userEvent.click(red);
  expect(red).toHaveAttribute("aria-pressed", "false");
  // Still there, and still usable for the question the reader was in the middle of asking.
  const blue = screen.getByRole("button", { name: /^Blue$/ });
  await userEvent.click(blue);
  expect(blue).toHaveAttribute("aria-pressed", "true");
});

test("a mana value set back to any keeps its select", async () => {
  atUrl("/cards?mv=3");
  const select = await screen.findByLabelText("Mana value, to");
  await userEvent.selectOptions(select, "");
  expect(screen.getByLabelText("Mana value, to")).toBeInTheDocument();
});

test("the remove button is still the way a row goes away", async () => {
  atUrl("/cards?colors=R");
  await userEvent.click(await screen.findByRole("button", { name: /^Red$/ }));
  await userEvent.click(screen.getByRole("button", { name: "Remove the Colour identity filter" }));
  expect(screen.queryByRole("button", { name: /^Red$/ })).toBeNull();
});

/** THE ORDER SURVIVES A ZERO-RESULT ANSWER (review, 2026-09-21). It moved beside the count, and
 *  the count only exists when something matched -- so a shared `?sort=name` link that matches
 *  nothing had no control to undo the order it arrived with. */
/** THE TWO PRINTED-NUMBER ORDERS (2026-09-22). Descending, because "sort by power" is a reader
 *  looking for the biggest thing they can play -- and a card that prints no power (or prints `*`,
 *  which the index omits the same way) sorts LAST under both, never as a pretend zero. */
const STATS: NameIndexEntry[] = [
  { slug: "a-wall", name: "A Wall", identity: [], commander: false, pow: 0, tou: 4 },
  { slug: "big-beater", name: "Big Beater", identity: [], commander: false, pow: 7, tou: 2 },
  { slug: "no-power", name: "No Power", identity: [], commander: false },
];
const resultNames = () => within(screen.getByRole("list", { name: "Results" }))
  .getAllByRole("link").map((a) => a.textContent);

test("ordering by power puts the biggest first and the unprinted last", async () => {
  atUrl("/cards?mvmax=9&sort=pow", { load: async () => STATS });
  await screen.findByRole("link", { name: /Big Beater/ });
  expect(resultNames()).toEqual([
    expect.stringContaining("Big Beater"),
    expect.stringContaining("A Wall"),
    expect.stringContaining("No Power"),
  ]);
});

test("ordering by toughness is its own axis, not power again", async () => {
  atUrl("/cards?mvmax=9&sort=tou", { load: async () => STATS });
  await screen.findByRole("link", { name: /A Wall/ });
  expect(resultNames()).toEqual([
    expect.stringContaining("A Wall"),
    expect.stringContaining("Big Beater"),
    expect.stringContaining("No Power"),
  ]);
});

/** THE DIRECTION IS ITS OWN CONTROL (owner 2026-09-22), and the unprinted card stays last when the
 *  order is turned round -- lowest power first must not open on the card that has none. */
test("power lowest first keeps the unprinted last", async () => {
  atUrl("/cards?mvmax=9&sort=pow&dir=asc", { load: async () => STATS });
  await screen.findByRole("link", { name: /Big Beater/ });
  expect(screen.getByLabelText("Direction")).toHaveValue("asc");
  expect(resultNames()).toEqual([
    expect.stringContaining("A Wall"),
    expect.stringContaining("Big Beater"),
    expect.stringContaining("No Power"),
  ]);
});

test("the order names its axis, and changing it resets the direction", async () => {
  atUrl("/cards?mvmax=9&sort=mv&dir=desc", { load: async () => STATS });
  await screen.findByRole("link", { name: /Big Beater/ });
  const order = screen.getByLabelText("Order");
  expect(within(order).getByRole("option", { name: "Power" })).toBeInTheDocument();
  expect(within(order).getByRole("option", { name: "Toughness" })).toBeInTheDocument();
  await userEvent.selectOptions(order, "pow");
  expect(screen.getByLabelText("Direction")).toHaveValue("desc");
  await userEvent.selectOptions(screen.getByLabelText("Direction"), "asc");
  expect(resultNames()[0]).toEqual(expect.stringContaining("A Wall"));
});

test("the order control is there even when nothing matched", async () => {
  atUrl("/cards?q=zzzznothing&sort=name");
  expect(await screen.findByText(/No card matches/)).toBeInTheDocument();
  expect(screen.getByLabelText("Order")).toHaveValue("name");
});

/** THE MENU NEEDS A POSITIONED ANCESTOR, and this is a className assertion on purpose: jsdom does
 *  no layout, so nothing here can see where the menu actually paints. It shipped without one and
 *  a browser put the open menu at left:0, top:1084, width:1920 -- full-bleed and entirely below a
 *  1080px viewport, because `.site-search-list` is `position:absolute` and resolved against the
 *  initial containing block. The same trap `.claude/rules/ui.md` names for `.sr-only`. */
test("the add menu carries the positioning its list needs", async () => {
  atUrl("/cards");
  const summary = await screen.findByText("Add a filter");
  expect(summary.closest("details")).toHaveClass("relative");
});

/** THE WIDER VOCABULARY (owner, 2026-09-21: "if we have + add filter now, we should add all filter
 *  types that make sense"). A row costs a line of a menu instead of a band of chrome, so the four
 *  dimensions the corpus could already answer are offered. */
const VOCABULARY = async () => ({
  types: ["creature", "instant"], subtypes: ["sliver"], keywords: ["flying", "trample"],
});

test("the menu offers every dimension the corpus can answer", async () => {
  atUrl("/cards");
  await userEvent.click(await screen.findByText("Add a filter"));
  const offered = screen.getAllByRole("button").map((b) => b.textContent?.trim());
  for (const label of ["Colour identity", "Colour", "Type line", "Keywords", "Mana value", "Power", "Toughness", "Causes", "Asks for"]) {
    expect(offered).toContain(label);
  }
});

/** A RANGE IS THE POINT: "not everyone looks for just X or less". Both ends, and either alone. */
test("a mana value range asks for a span, not just a ceiling", async () => {
  const spy = atUrl("/cards?q=a");
  await screen.findByRole("searchbox");
  await addFilter("Mana value");
  await userEvent.selectOptions(await screen.findByLabelText("Mana value, from"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Mana value, to"), "4");
  expect(spy.search).toContain("mvmin=2");
  expect(spy.search).toContain("mvmax=4");
});

/** ZERO IS A REAL BOUND and must survive the round trip through the URL -- a falsy check anywhere
 *  on this path turns "power 0 to 0" into "no power filter" and answers a different question. */
test("a bound of zero is a question, not an absent filter", async () => {
  const spy = atUrl("/cards?q=a");
  await screen.findByRole("searchbox");
  await addFilter("Power");
  await userEvent.selectOptions(await screen.findByLabelText("Power, to"), "0");
  expect(spy.search).toContain("powmax=0");
});

/** A BACKWARDS RANGE SAYS SO. Left alone it answers "No card matches", which is true and useless:
 *  the reader reads it as "there are none" rather than as "you asked backwards". */
test("a backwards range explains itself", async () => {
  atUrl("/cards?mvmin=5&mvmax=2");
  expect(await screen.findByText(/backwards, so nothing can match/i)).toBeInTheDocument();
});

test("a keyword row is a typeahead over the keyword table", async () => {
  atUrl("/cards?q=a", { vocabulary: VOCABULARY });
  await screen.findByRole("searchbox");
  await addFilter("Keywords");
  await userEvent.type(await screen.findByLabelText("Keywords"), "fly");
  const shown = within(screen.getByRole("listbox", { name: "Keywords" })).getAllByRole("option");
  expect(shown.map((o) => o.textContent)).toEqual(["flying"]);
});

/** COLOUR AND COLOUR IDENTITY ARE TWO ROWS asking two questions, and they must not write the same
 *  param -- `colors` was identity the day it shipped, so the new one could not have it. */
test("colour and colour identity are separate rows and separate params", async () => {
  const spy = atUrl("/cards?q=a");
  await screen.findByRole("searchbox");
  await addFilter("Colour identity");
  await userEvent.click(await screen.findByRole("button", { name: /^Red$/ }));
  await addFilter("Colour");
  // Two rows are on screen now, so the colour chips are ambiguous by name -- scope to the fieldset.
  const own = screen.getByRole("group", { name: "Colour" });
  await userEvent.click(within(own).getByRole("button", { name: /^Blue$/ }));
  expect(spy.search).toContain("colors=R");
  expect(spy.search).toContain("cardcolors=U");
});

/** THE LANDING IS SEARCH-FIRST (owner, 2026-09-17: the chips were a wall), and since AJ3 the
 *  question is asked in events. The empty state offers three of them, built from real keys. */
test("an example question sets the events and lists its answer as tiles", async () => {
  atUrl("/cards");
  await screen.findByText(/cards the engine has read/);
  fireEvent.click(screen.getByRole("button", { name: "wants a creature to die" }));
  const link = await screen.findByRole("link", { name: "Fathom Mage" });
  expect(within(screen.getByRole("list", { name: "Results" })).getByRole("link", { name: "Fathom Mage" })).toBe(link);
});

/** EVERY LISTED CARD SAYS WHY IT IS THERE. A list with no reason is what this product refuses
 *  everywhere else, and the reason is the question that was asked, in the engine's own words. */
test("a listed card carries the event that put it there", async () => {
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}`);
  await screen.findByRole("link", { name: /Inspiring Call/ });
  // AK4: a produce term is named as the action a player would say.
  expect(screen.getAllByText(eventKeyAction(MILL)!).length).toBeGreaterThan(0);
});

/** THE COUNT IS A STATUS MESSAGE (WCAG 4.1.3). A chip changes the set and a sighted reader sees
 *  the number move; a screen reader heard nothing until this paragraph announced itself. */
test("the result count announces itself when the set changes", async () => {
  at();
  await userEvent.type(await screen.findByRole("searchbox"), "krenko");
  expect(await screen.findByRole("status")).toHaveTextContent(/card(s)? match/);
});

/** THE CAP IS A PAGE, NOT A WALL (UX review, 2026-09-17). "467 cards match, showing the first 50"
 *  with no way to the other 417 was a dead end for any name past the letter A. */
test("a query past the cap offers the next page, and the count line follows", async () => {
  const many = Array.from({ length: SEARCH_LIMIT + 7 }, (_, i) => ({
    slug: `goblin-${i}`, name: `Goblin ${i}`, identity: ["R"], commander: false,
  }));
  at(many);
  await userEvent.type(await screen.findByRole("searchbox"), "goblin");
  await screen.findByText(new RegExp(`showing the first ${SEARCH_LIMIT}`));
  await userEvent.click(screen.getByRole("button", { name: "Show 7 more" }));
  expect(within(screen.getByRole("list", { name: "Results" })).getAllByRole("link"))
    .toHaveLength(SEARCH_LIMIT + 7);
  expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  expect(screen.queryByText(/showing the first/)).toBeNull();
});

/** HOW MUCH IT DOES IS THE DEFAULT ORDER OF A CAUSE (owner 2026-09-23, AN3). The build ships each
 *  cause's list best doer first; the page follows that list, not the partner count -- Ashnod's
 *  Altar was 242nd on "sacrifices a creature" under the count. Connections is one choice away. */
test("a cause lists its cards in the order the build ranked them, and Connections undoes it", async () => {
  const ranked = async (_base: string, key: string): Promise<EventMembers | null> =>
    key === MILL ? { p: [2, 1], c: [] } : MEMBERS[key] ?? null;
  const connected = INDEX2.map((e) => ({ ...e, partners: e.slug === "inspiring-call" ? 9 : 1 }));
  atUrl(`/cards?produce=${encodeURIComponent(MILL)}`, { members: ranked, load: async () => connected });
  await screen.findByRole("link", { name: /Skullclamp/ });
  const names = () => within(screen.getByRole("list", { name: "Results" })).getAllByRole("link").map((l) => l.textContent);
  expect(names()[0]).toMatch(/Skullclamp/);
  expect(screen.getByLabelText("Order")).toHaveValue("effect");
  await userEvent.selectOptions(screen.getByLabelText("Order"), "partners");
  await waitFor(() => expect(names()[0]).toMatch(/Inspiring Call/));
});

test("with no cause asked there is nothing to measure, so the order is not offered", async () => {
  atUrl(`/cards?consume=${encodeURIComponent(DIES)}`);
  await screen.findByRole("link", { name: /Fathom Mage/ });
  expect(within(screen.getByLabelText("Order")).queryByRole("option", { name: "How much it does" })).toBeNull();
});
