import { expect, test } from "vitest";
import { renderQualitySheet, VERDICTS } from "./quality-sheet-html.js";

const card = (name: string, percentile: number) => ({ name, cost: "{W}", typeLine: "Instant", oracle: "Exile target creature.", percentile, ingredients: { manaValue: 1, timing: 2 }, preconLists: 3 });

test("every card gets the four verdicts, in our order, under its role", () => {
  const html = renderQualitySheet([{ role: "targetedRemoval", fallback: false, note: "n", cards: [card("Swords to Plowshares", 92), card("Crib Swap", 40)] }], "t");
  expect(html).toContain('id="role-targetedRemoval"');
  expect(html.match(/data-v="/g)?.length).toBe(2 * VERDICTS.length);
  expect(html.indexOf("Swords to Plowshares")).toBeLessThan(html.indexOf("Crib Swap"));
  expect(html).toContain("2 cards across 1 roles");
});

test("card text is escaped, so a name cannot inject markup", () => {
  const html = renderQualitySheet([{ role: "burn", fallback: true, note: "", cards: [card("<script>x</script>", 50)] }], "t");
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
});
