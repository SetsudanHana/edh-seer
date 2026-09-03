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

/** THE CAP GUARDED ONLY THE WRITING END, AND THE DANGEROUS END IS THE READING ONE.
 *
 *  `encodeShare` refuses to hand out a payload over `MAX_PAYLOAD`, so nothing this app writes is
 *  ever long. `decodeShare` inflated whatever it was handed. `deflate-raw` reaches 1029:1 on
 *  repeated bytes -- measured in a real browser, not assumed -- so a hand-written link with a 43,000
 *  character hash expands to 32MB in the recipient's tab, and the ratio is linear from there. The
 *  fragment never reaches a server, so this costs nobody but the person who opened the link, which
 *  is exactly the person the link was aimed at.
 *
 *  The guard is the constant that already existed, applied to the other direction. */
/** A VALID payload, forged the way an attacker would rather than the way the app does -- the app
 *  cannot produce one this long, which is the whole point. `random` garbage would compress badly;
 *  a repeated byte is what makes the ratio, so the bomb is built from one. */
async function forgeDeflated(text: string): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
  // The same cast the module documents: a compression stream's writable side is wider than the
  // invariant pair `pipeThrough` asks for.
  const reader = source
    .pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let binary = "";
  for (const chunk of chunks) for (const b of chunk) binary += String.fromCharCode(b);
  return "1" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("a payload longer than one this app would ever write is refused, uninflated", async () => {
  // Deflates well enough to clear the cap while still being a payload that WOULD decode -- so what
  // is asserted is the length guard and not `atob` throwing on nonsense.
  // With the separator in it, so it is a payload that WOULD have decoded to a deck -- otherwise the
  // test passes on the missing-separator refusal and proves nothing about the length.
  const bomb = await forgeDeflated(`1 Krenko, Mob Boss\f${"1 Sol Ring\n".repeat(400_000)}`);
  expect(bomb.length).toBeGreaterThan(MAX_PAYLOAD);
  expect(await decodeShare(bomb)).toBeNull();
});

test("and the cap does not refuse a real deck", async () => {
  const payload = await encodeShare(DECK);
  expect(payload!.length).toBeLessThanOrEqual(MAX_PAYLOAD);
  expect(await decodeShare(payload!)).toEqual(DECK);
});
