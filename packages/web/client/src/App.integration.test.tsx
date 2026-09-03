import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import App from "./App.js";
import { SAMPLE } from "./fixtures.js";
import * as api from "./api.js";
import { decodeShare, payloadFromHash } from "./lib/share-link.js";
import { loadLastDeck } from "./lib/run-diff.js";

test("typing commander + decklist and clicking Analyze renders the ranked report", async () => {
  const spy = vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  render(<App />);
  await userEvent.type(screen.getByRole("textbox", { name: /commander/i }), "1 Krenko, Mob Boss");
  await userEvent.type(screen.getByRole("textbox", { name: /decklist/i }), "1 Impact Tremors");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByTestId("recognition-theme")).toHaveTextContent("Tokens")); // chapter 1, in the scroll
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument(); // unresolved banner
  await userEvent.click(screen.getAllByRole("link", { name: /^Cards/ })[0]!);
  // "Krenko, Mob Boss" appears in the commander textarea value, in the sticky header and in the
  // Cards surface's list.
  expect(screen.getAllByText(/Krenko, Mob Boss/).length).toBeGreaterThan(1);
  // commanders passed as the 2nd arg
  expect(spy).toHaveBeenCalledWith("1 Impact Tremors", "1 Krenko, Mob Boss");
});

/** THE EXPLAINER IS FOR SOMEONE WHO HAS NOT PASTED A DECK YET. It is static HTML outside `#root`,
 *  so it rendered under a finished report too -- a 5,000px analysis ending on marketing copy. This
 *  was found in a design audit, filed Minor, and hit twice by the owner afterwards. */
test("the static explainer stops rendering once an analysis is on screen", async () => {
  const spy = vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  window.history.replaceState(null, "", "/");
  render(<App />);
  expect(document.documentElement.dataset.report).toBeUndefined();
  await userEvent.type(screen.getByRole("textbox", { name: /commander/i }), "1 Krenko, Mob Boss");
  await userEvent.type(screen.getByRole("textbox", { name: /decklist/i }), "1 Impact Tremors");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByTestId("recognition-theme")).toHaveTextContent("Tokens")); // chapter 1, in the scroll
  expect(document.documentElement.dataset.report).toBe("1");
  expect(spy).toHaveBeenCalledWith("1 Impact Tremors", "1 Krenko, Mob Boss");

  // THE OTHER HALF: a reader who clears the analysis gets the explainer back. The UI's own way to
  // clear it is Back -- see "the first analysis is a history entry" below -- which lands on a URL
  // with no deck hash, and `onPop` responds with `setData(null)`. Reused rather than invented.
  await act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByLabelText("Decklist");
  expect(document.documentElement.dataset.report).toBeUndefined();
});

test("shows an error banner when the api throws", async () => {
  vi.spyOn(api, "analyzeDeck").mockRejectedValue(new Error("Cannot reach MongoDB..."));
  render(<App />);
  await userEvent.type(screen.getByRole("textbox", { name: /decklist/i }), "1 Sol Ring");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByText(/Cannot reach MongoDB/)).toBeInTheDocument());
});

test("input collapses to a summary after a successful analysis", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
  // the large textarea is no longer visible
  expect(screen.queryByLabelText("Decklist")).not.toBeInTheDocument();
});

/** BOTH OF THE NEXT TWO ARE CLS RATCHETS, and they assert a MOMENT rather than an end state, which
 *  is the only thing that separates them from the test above.
 *
 *  Cumulative Layout Shift ignores anything that moves within 500ms of a real interaction, and
 *  counts everything else. So WHEN the ~420px paste box becomes a ~128px bar decides whether the
 *  290px it drags the page by is charged to the page or to the reader. Measured on the production
 *  build at 390x844: shared link 0.1771 -> 0.0201, paste-and-click 0.0385 -> 0.0201, and the
 *  remaining 0.0174 in both is the webfont, not this. */
test("the paste box closes on the click, not on the answer", async () => {
  // The response never arrives: what is on screen while it is in flight is the whole assertion.
  vi.spyOn(api, "analyzeDeck").mockReturnValue(new Promise(() => {}));
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
  expect(screen.queryByLabelText("Decklist")).not.toBeInTheDocument();
});

/** ...and the same box is never OPEN on a shared link, where there is no click to charge the shift
 *  to. `decodeShare` is async, so this asserts the very first render -- no `await` before it. */
test("a shared link renders no empty state and no open paste box", () => {
  vi.spyOn(api, "analyzeDeck").mockReturnValue(new Promise(() => {}));
  window.history.replaceState(null, "", "/#deck=whatever");
  render(<App />);
  expect(screen.queryByLabelText("Decklist")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /example deck/i })).toBeNull();
  window.history.replaceState(null, "", "/");
});

/** THE OTHER DIRECTION, because `fromLink` hides the introduction on nothing more than the presence
 *  of a hash. A link that does not decode has to give the ordinary page back rather than leave a
 *  reader on a summary bar for a deck that was never loaded. */
test("a shared link that does not decode falls back to the empty state", async () => {
  vi.spyOn(api, "analyzeDeck").mockReturnValue(new Promise(() => {}));
  window.history.replaceState(null, "", "/#deck=not-a-real-payload");
  render(<App />);
  expect(await screen.findByLabelText("Decklist")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /example deck/i })).toBeInTheDocument();
  window.history.replaceState(null, "", "/");
});

/** THERE WAS NO WAY BACK. `analyse` wrote the share hash with `replaceState`, chosen so that
 *  re-analysing does not fill the back button with near-identical entries -- but that also meant the
 *  FIRST analysis created no entry either, so Back left the site entirely. Owner report,
 *  2026-08-31: *"after we added the url there is no easy way to go back from the analysis"*.
 *
 *  The rule is now about which analysis it is: the first one pushes, so Back has somewhere on this
 *  site to go; every re-analysis replaces, which is the original reasoning, unchanged. */
test("the first analysis is a history entry, so Back returns to the paste box", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  // WAIT FOR THE HASH, NOT FOR THE BUTTON, because the button is not evidence the hash exists.
  // Read `analyse` (App.tsx): `setEditing(false)` -- which paints Edit -- happens BEFORE
  // `await encodeShare(...)`, and the history write happens after it. So the Edit button resolving
  // says nothing about whether the hash has been written; the ordering this assertion depended on
  // does not exist in the code.
  //
  // FOUND AS A FLAKE, AND THE SCHEDULE THAT TRIPS IT IS UNREPRODUCED LOCALLY. It failed both node
  // legs on main at d0d1797, before the branch that hit it existed, and passed on two pushes of
  // that same branch -- so it is nondeterministic on CI. Delaying `encodeShare` by 50ms here did
  // NOT reproduce it, because testing-library's async act flushes the timer inside `findByRole`.
  // The fix does not depend on knowing which schedule wins: waiting for the thing being asserted
  // is correct under all of them.
  await waitFor(() => expect(window.location.hash).toMatch(/^#deck=/));

  // What a browser does on Back: the URL changes first, then `popstate` fires.
  await act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // THE DECK SURVIVES. Back means "out of the report", not "start over" -- landing on an empty box
  // would throw away the list the reader just pasted.
  expect(await screen.findByLabelText("Decklist")).toHaveValue("1 Sol Ring");
  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
});

/** Forward again, or any Back that lands ON a shared analysis, has to re-open it -- otherwise the
 *  history entry exists and does nothing when you reach it. */
test("popstate onto a deck hash re-opens that analysis", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  // Same race as the test above -- this one READS the hash it is about to navigate back to, so a
  // premature read left `withDeck` empty and the final assertion passed for the wrong reason.
  await waitFor(() => expect(window.location.hash).toMatch(/^#deck=/));
  const withDeck = window.location.hash;

  await act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByLabelText("Decklist");

  await act(async () => {
    window.history.replaceState(null, "", withDeck);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
});

/** WHAT YOU PASTED BECOMES THE URL, AND IT SHOULD NOT WHEN IT WAS NEVER A DECK.
 *
 *  Owner-reported, 2026-09-03: *"if I paste something that is not decklist to areabox, it is still
 *  hashed in the url"*. Verified on the live page -- a paste box holding three lines of private
 *  notes analysed, resolved nothing, and still produced `#deck=...` plus a Copy link button. The
 *  fragment never reaches a server, so nothing leaked outward; what it does reach is the address
 *  bar, browser history, and whatever the reader pastes that link into next, believing it to be a
 *  deck.
 *
 *  `resolvedCount` is the honest test of "was that a decklist": it counts cards the engine actually
 *  found, and a real list always finds at least one. */
const NOT_A_DECK = "a private note, not a deck";

test("text that resolved no cards never becomes a URL or a share link", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue({ ...SAMPLE, resolvedCount: 0 });
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: NOT_A_DECK } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();

  // NOT `hash === ""`: an earlier test in this file has an analysis still in flight whose own hash
  // write lands here. What is asserted is that no hash on the bar is OURS.
  const payload = payloadFromHash(window.location.hash);
  const carried = payload ? await decodeShare(payload) : null;
  expect(carried?.decklist).not.toBe(NOT_A_DECK);
  expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
  // AND IT DOES NOT COME BACK NEXT VISIT: `loadLastDeck` refills the box from what was saved here.
  expect(loadLastDeck()?.decklist).not.toBe(NOT_A_DECK);
});
