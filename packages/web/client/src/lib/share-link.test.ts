import { expect, test } from "vitest";
import { decodeShare, encodeShare, MAX_PAYLOAD, payloadFromHash, shareUrl, tidyDecklist } from "./share-link.js";

const DECK = {
  commanders: "1 Krenko, Mob Boss",
  decklist: "1 Impact Tremors\n1 Goblin Chieftain\n34 Mountain",
};

test("a deck survives the round trip", async () => {
  const payload = await encodeShare(DECK);
  expect(payload).not.toBeNull();
  expect(await decodeShare(payload!)).toEqual(DECK);
});

/** Card names carry accents and punctuation, and a naive base64 of a UTF-16 string mangles both.
 *  `TextEncoder` is what makes this a byte problem rather than a character one. */
test("names outside ASCII survive it too", async () => {
  const deck = { commanders: "1 Æther Vial", decklist: "1 Ach! Hans, Run!\n1 Jötun Grunt" };
  expect(await decodeShare((await encodeShare(deck))!)).toEqual(deck);
});

/** 34 Mountains and one Mountain are different decks, so the quantity is the one part of a line
 *  that must survive tidying. */
test("quantities survive, set codes and foil markers do not", () => {
  expect(tidyDecklist("1 Sol Ring (LCC) 411 *F*")).toBe("1 Sol Ring");
  expect(tidyDecklist("34 Mountain (M21) 269")).toBe("34 Mountain");
  // Blank lines and stray padding go; the quantity never does.
  expect(tidyDecklist("  1 Krenko, Mob Boss  \n\n1 Impact Tremors")).toBe("1 Krenko, Mob Boss\n1 Impact Tremors");
});

test("a link that does not decode gives null rather than a broken deck", async () => {
  expect(await decodeShare("")).toBeNull();
  expect(await decodeShare("1not-base64!!")).toBeNull();
  expect(await decodeShare("9anything")).toBeNull(); // unknown encoding marker
  // Valid base64 of something that is not one of ours: it decodes to bytes but has no separator.
  expect(await decodeShare("0" + btoa("just some text").replace(/=+$/, ""))).toBeNull();
});

/** A LINK THAT LOSES ITS TAIL IS WORSE THAN NO LINK: it fails at the far end, in someone else's
 *  browser, as a deck quietly missing cards. Measured worst case over the 71 calibration decks is
 *  1,972 characters, so a real deck never reaches this. */
test("refuses a payload longer than a platform will carry", async () => {
  const huge = { commanders: "1 Krenko, Mob Boss", decklist: Array.from({ length: 9_000 }, (_, i) => `1 Card Number ${i}`).join("\n") };
  const payload = await encodeShare(huge);
  expect(payload).toBeNull();
  expect(MAX_PAYLOAD).toBe(2_000);
});

/** `#calibrate` is an existing route on this same fragment, which is why the payload is a key=value
 *  pair: the two cannot be read as each other. */
test("reads its own key out of a hash and ignores anything else", () => {
  expect(payloadFromHash("#deck=abc")).toBe("abc");
  expect(payloadFromHash("deck=abc")).toBe("abc");
  expect(payloadFromHash("#calibrate")).toBeNull();
  expect(payloadFromHash("")).toBeNull();
});

test("builds a url the app can read back", async () => {
  const payload = (await encodeShare(DECK))!;
  const url = shareUrl("https://edhseer.pages.dev", "/", payload);
  expect(url.startsWith("https://edhseer.pages.dev/#deck=")).toBe(true);
  expect(payloadFromHash(new URL(url).hash)).toBe(payload);
});

/** The measurement the whole design rests on: a real 100-card list has to fit. */
test("a hundred-card deck fits inside a shareable url", async () => {
  const decklist = Array.from({ length: 99 }, (_, i) => `1 ${["Sol Ring", "Arcane Signet", "Command Tower", "Mountain", "Goblin Chieftain"][i % 5]} ${i}`).join("\n");
  const payload = (await encodeShare({ commanders: "1 Krenko, Mob Boss", decklist }))!;
  expect(payload).not.toBeNull();
  expect(shareUrl("https://edhseer.pages.dev", "/", payload).length).toBeLessThan(2_100);
});
