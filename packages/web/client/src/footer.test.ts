import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** THE NOTICE IS A CONDITION OF SHOWING THE CARDS, so these are assertions about a legal obligation
 *  rather than about copy.
 *
 *  IT READS `index.html` NOW, not a rendered component. The footer moved into static markup for two
 *  reasons: inside `main` it stopped being at the foot the moment the intro section existed, and a
 *  notice required in order to display Wizards' property should not depend on a 700 KB bundle
 *  loading. Testing the file is testing what a reader with JavaScript off actually receives. */
/** EVERY PAGE THAT NAMES A CARD CARRIES IT. The prose page names Krenko and Impact Tremors in its
 *  own sentences, so the notice is as much a condition there as on the app. Running the same
 *  assertions over both files is what stops the two copies drifting. */
const PAGES = ["index.html", "how-it-works/index.html"] as const;
const read = (page: string) => readFileSync(join(process.cwd(), "client", page), "utf8");
const footerOf = (html: string) => html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
const textOf = (html: string) => footerOf(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const HTML = read("index.html");
const footer = footerOf(HTML);
const text = textOf(HTML);

test.each(PAGES)("%s carries the Fan Content Policy wording Wizards requires, verbatim", (page) => {
  const t = textOf(read(page));
  expect(t).toContain("EDH Seer is unofficial Fan Content permitted under the");
  expect(t).toContain("Not approved or endorsed by Wizards");
  expect(t).toContain("Portions of the materials used are property of Wizards of the Coast");
  expect(t).toContain("©Wizards of the Coast LLC");
});

test.each(PAGES)("%s disclaims affiliation", (page) => {
  expect(textOf(read(page))).toContain("not affiliated with, endorsed, sponsored, or specifically approved by");
});

test("disclaims affiliation and names the trademark holder", () => {
  expect(text).toContain("not affiliated with, endorsed, sponsored, or specifically approved by");
  expect(text).toMatch(/trademarks of Wizards of the Coast LLC/);
});

test("credits the data sources the app actually uses, and claims no prices", () => {
  expect(text).toContain("Scryfall");
  expect(text).toContain("Commander Spellbook");
  // A price disclaimer would be a claim about data this app does not show. If prices are ever added,
  // this assertion is the thing that says the notice must change with them.
  expect(text).toContain("shows no card prices");
});

/** A wrong edge is a reportable bug, and this is the only route to reporting it: the site has no
 *  server, no account and no contact form. */
test("points a reader at the repository when a claim is wrong", () => {
  expect(text).toMatch(/wrong edge/i);
  expect(text).toMatch(/two card names/i);
  expect(footer).toContain('href="https://github.com/SetsudanHana/edh-seer/issues/new"');
  expect(footer).toContain('href="https://github.com/SetsudanHana/edh-seer"');
});

test("every outbound link opens away from the app and leaks no referrer", () => {
  const links = [...footer.matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const attrs of links) {
    expect(attrs).toContain('target="_blank"');
    expect(attrs).toContain("noopener");
    expect(attrs).toContain("noreferrer");
    expect(attrs).toMatch(/href="https:\/\//);
  }
});

/** THE ORDER IS THE DEFECT THIS FIXES. A footer that renders before a page's last section is not a
 *  footer; the intro has to come first and the notice has to be last. */
test("the footer is the last thing on the page", () => {
  expect(HTML.indexOf('class="intro"')).toBeLessThan(HTML.indexOf("<footer"));
  expect(HTML.indexOf("</footer>")).toBeGreaterThan(HTML.indexOf('id="root"'));
});
