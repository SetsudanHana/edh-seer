import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** THE PROSE PAGE SAYS WHAT THE README SAYS, OR IT FAILS. The site carried "34,433 cards read from
 *  oracle text" for a week while the README said 21,317 of them were actually read -- two readers,
 *  two levels of honesty, and nothing between them. The README is the sourced document (every
 *  figure carries its command and its date), so the page is held to it rather than the other way
 *  round, and there is no third file for the two to drift from. */
const CLIENT = join(process.cwd(), "client");
const page = readFileSync(join(CLIENT, "how-it-works", "index.html"), "utf8");
const readme = readFileSync(join(process.cwd(), "..", "..", "README.md"), "utf8");
const repo = join(process.cwd(), "..", "..");

const pick = (re: RegExp, label: string): string[] => {
  const m = re.exec(readme);
  expect(m, `README carries ${label}`).not.toBeNull();
  return m!.slice(1);
};

test("the trust figures on the page are the README's, digit for digit", () => {
  const [precision, interval, claims] = pick(
    /synergy-claim precision \| \*\*([\d.]+%)\*\* `(\[[\d., ]+\])` on (\d+) live claims/,
    "precision",
  );
  const [retention, held, lost] = pick(
    /retention of pairs judged real \| \*\*([\d.]+%)\*\* — (\d+) held, (\d+) lost/,
    "retention",
  );
  const [date] = pick(/Measured (\d{4}-\d{2}-\d{2}) by/, "the measurement date");
  const [corpus, derived] = pick(
    /corpus is \*\*([\d,]+)\*\* cards, of which \*\*([\d,]+)\*\* carry derived tags/,
    "corpus coverage",
  );
  for (const s of [precision, interval, claims, retention, held, lost, date, corpus, derived]) {
    expect(page, `the page carries ${s}`).toContain(s);
  }
});

/** EVERY ENGINEERING LINK POINTS AT A FILE THAT EXISTS. The links table is the technical reader's
 *  whole route into the repository, and a renamed doc would otherwise 404 from the live site with
 *  nothing here going red. Paths are resolved against the checkout, not fetched. */
test("the engineering links resolve to files in this repository", () => {
  const blob = "https://github.com/SetsudanHana/edh-seer/blob/main/";
  const tree = "https://github.com/SetsudanHana/edh-seer/tree/main/";
  const linked = [...page.matchAll(/href="(https:\/\/github\.com\/SetsudanHana\/edh-seer\/(?:blob|tree)\/main\/[^"]+)"/g)]
    .map((m) => m[1]!);
  for (const required of [
    "docs/HOW-IT-WORKS.md",
    "docs/pipeline/1-segment.md",
    "docs/pipeline/2-normalize.md",
    "docs/pipeline/3-derive.md",
    "docs/pipeline/4-match.md",
    "docs/reference/SCHEMA.md",
    "docs/RUNBOOK.md",
    "docs/engineering-log",
    "CONTRIBUTING.md",
    "SECURITY.md",
  ]) {
    const url = (required.endsWith(".md") ? blob : tree) + required;
    expect(linked, `the page links ${required}`).toContain(url);
  }
  for (const url of linked) {
    const rel = url.replace(blob, "").replace(tree, "").split("#")[0]!;
    expect(existsSync(join(repo, rel)), `${rel} exists`).toBe(true);
  }
  expect(page).toContain("issues/new?template=wrong-edge.yml");
});

/** THE DEVICES ARE THE PAGE, for the reader who does not read. The claim card is the first thing a
 *  player sees and the only one that answers "what do I get"; the refusal grid replaced five
 *  paragraphs; the gate stepper is the matcher's actual decision order. A future edit that returns
 *  any of them to prose should fail here rather than ship. */
test("the page carries the player devices and the engineering devices", () => {
  for (const block of ["claim", "refusals", "gates", "stages", "docs-table"]) {
    expect(page, `the ${block} block is present`).toContain(`class="${block}"`);
  }
  // The claim is the real sentence the report prints, worked through every stage of the docs.
  // Read as text, because the page sets the card names in bold and the sentence still has to read.
  const text = page.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  expect(text).toContain("When Siege-Gang Commander dies, Skullclamp draws you 2 cards");
  // Two audiences, one page, and the split is a heading a reader can jump to.
  expect(page).toMatch(/<h2 id="under-the-hood">/);
});
