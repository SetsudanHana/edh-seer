import { expect, test } from "vitest";
import { effectText, printedPreamble } from "./preamble.js";

test("the preamble ends at the comma that ends the trigger, not inside a short list", () => {
  expect(printedPreamble("Whenever you cast an instant, sorcery, or Wizard spell, draw a card.", "X")).toBe("Whenever you cast an instant, sorcery, or Wizard spell");
  expect(printedPreamble("Whenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1.", "X")).toBe("Whenever you cast a noncreature spell");
  expect(printedPreamble("When Gisela, the Broken Blade enters, draw a card.", "Gisela, the Broken Blade")).toBe("When ~ enters");
  expect(printedPreamble("Draw a card.", "X")).toBeNull();
});

test("the effect is what follows the preamble and its intervening if, the name as ~", () => {
  expect(effectText("When this creature enters, if it was kicked, draw two cards.", "X")).toBe("draw two cards.");
  expect(effectText("Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.", "Ayara, First of Locthwain"))
    .toBe("each opponent loses 1 life and you gain 1 life.");
  // A spell or an activated ability's effect (its cost is segmented apart) is the whole text.
  expect(effectText("Destroy target creature.", "X")).toBe("Destroy target creature.");
});
