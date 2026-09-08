import { expect, test } from "vitest";
import { CANONICAL_HOST, canonicalHostRedirect } from "./origin.js";

/** THE OLD HOST ANSWERED EVERY PATH WITH A 200 (measured 2026-09-08: `edhseer.pages.dev/` and
 *  `/cards/skullclamp` both rendered in full). The canonical tag mitigated the duplicate, but the
 *  project's rule since the domain moved has been "keep pages.dev alive and 301 it", and nothing
 *  did. A preview deployment lives on `<branch>.edhseer.pages.dev` and must keep working, so the
 *  match is the bare host and nothing under it. */
test("the bare pages.dev host redirects to the canonical host, path and query intact", () => {
  expect(canonicalHostRedirect(new URL("https://edhseer.pages.dev/cards/skullclamp?x=1#deck=abc")))
    .toBe(`https://${CANONICAL_HOST}/cards/skullclamp?x=1#deck=abc`);
  expect(canonicalHostRedirect(new URL("https://edhseer.pages.dev/"))).toBe(`https://${CANONICAL_HOST}/`);
});

test("the canonical host, a preview alias and localhost are left alone", () => {
  for (const u of [
    `https://${CANONICAL_HOST}/cards/skullclamp`,
    "https://how-it-works-codeql.edhseer.pages.dev/",
    "https://04d62a7c.edhseer.pages.dev/cards/x",
    "http://localhost:8788/",
  ]) expect(canonicalHostRedirect(new URL(u)), u).toBeNull();
});
