import { dedupeReasonsByText, type DeckReport } from "@mtg/engine";

/** A probability as a whole percent. Never rounded to 0% for a real chance: a reader treats 0% as
 *  "cannot happen", and the model's refusals are printed as an em dash instead. */
const pct = (p: number): string => `${Math.max(1, Math.round(p * 100))}%`;

export function formatReport(report: DeckReport, trim = 0): string {
  const lines: string[] = [];

  lines.push("=== Commanders ===");
  lines.push(report.commanders.length ? `  ${report.commanders.join(", ")}` : "  (none specified)");
  // WHEN IS IT ONLINE (roadmap K5). A RANGE, never one number, and an em dash when the model refuses
  // the cost -- a 0% would tell a reader their commander is uncastable.
  const cmdCast = report.deckMath?.castability.commanders ?? [];
  for (const c of cmdCast) {
    // The name is repeated only for a PARTNER PAIR, where two rows need telling apart.
    const who = cmdCast.length > 1 ? `${c.name}: ` : "";
    const odds = c.mana === null
      ? `— (${c.refused})`
      : `${pct(c.mana)} – ${pct(c.manaWithRocks ?? c.mana)} to have ${c.turn} mana by turn ${c.turn}`;
    lines.push(`  ${who}${odds}`);
    if (c.commandZoneCaveat) lines.push(`    note: ${c.commandZoneCaveat}`);
  }
  // THE RANGE SHIPS WITH WHAT IS WRONG WITH IT, or it should not ship. `manaWithRocks` counts only
  // permanents that produce mana, so a deck that ramps with Farseek and Cultivate reads LOW -- on
  // the owner's own Samut deck the range is 34-43% against a simulated 55.8%, outside it entirely
  // (roadmap I11). The panel carries this in `castability.biases`; the CLI never prints that, so
  // without this line a reader gets a bare percentage the engine already knows is wrong.
  if (cmdCast.some((c) => c.mana !== null)) {
    lines.push("  (lands and mana rocks only — land-fetch ramp like Cultivate is not counted, so this reads low)");
  }

  lines.push("");
  // THE THREE-SLOT SENTENCE FIRST (roadmap A16): win route · engine · means. It leads because it is
  // the only line that answers "what is this deck" without picking one coordinate to be the whole
  // position -- the cohesion block below is the ENGINE slot on its own, and reading it alone is what
  // scored a one-slot instrument against a composite for four naming designs running.
  if (report.identity) {
    const clauses = [report.identity.win, report.identity.engine, report.identity.means].filter(Boolean);
    if (clauses.length > 0) {
      lines.push("=== What this deck is ===");
      for (const c of clauses) lines.push(`  ${c}`);
      lines.push("");
    }
  }
  // "N CARDS DO THIS DECK'S THING" (roadmap K2), and it sits with the identity sentence because it
  // is the same question with a number attached. ABSENT when the theme layer declined to name the
  // deck -- a count under a withdrawn claim would hand the reader back the sentence just taken away.
  //
  // THE CEILING IS PRINTED WITH IT (K3b): owner-judged at 95.0% precision on the cards it lists, and
  // it misses about one in six that an owner would count. Both halves ship or neither does.
  if (report.thing) {
    lines.push("=== Does the deck do its thing? ===");
    lines.push(`  ${report.thing.count} cards do this deck's thing (${report.thing.theme})`);
    lines.push(`  ${pct(report.thing.probability)} to have ${report.thing.k} of them by turn ${report.thing.turn}`);
    if (report.thing.fromCommandZone.length > 0) {
      lines.push(`  plus ${report.thing.fromCommandZone.join(", ")} from the command zone, every game`);
    }
    lines.push("  (counts the cards on your main theme; it misses roughly one in six a player would count)");
    lines.push("");
  }
  lines.push("=== Deck cohesion ===");
  if (report.cohesion) {
    const secondary = report.cohesion.secondary ? ` / ${report.cohesion.secondary}` : "";
    // NAMING A DECK IS A CLAIM, AND THIS ONE CAN BE DECLINED (roadmap A15). Below the floor the
    // theme is carried by one or two cards -- `venser` reads 0.02 -- and leading with it tells a
    // player their deck is about something nothing in it does twice. The tag is still printed,
    // because it IS the deck's best-supported theme and withholding it entirely would be a
    // different lie.
    // EXPLICIT `false` ONLY. An absent field is a caller that predates it (the flat engine builds a
    // Cohesion by hand), and an absent opinion must not read as a negative one -- defaulting the
    // other way made a 0.50-cohesion fixture abstain, which the CLI test caught.
    if (report.cohesion.dominant === false) lines.push(`  Theme: no dominant theme (strongest: ${report.cohesion.theme})`);
    else lines.push(`  Theme: ${report.cohesion.theme}${secondary}`);
    lines.push(`  Cohesion: ${report.cohesion.score.toFixed(2)} (${report.cohesion.label})`);
    // A NAME CAN BE SPECIFIC WHILE THE PLAN IS BROAD, and one number cannot say both (roadmap A10).
    // Printed only when they differ, i.e. only when the primary is a specific tag inside a wider
    // family: "daleks entering" at 0.08 of the deck but 0.46 of the creature family.
    if (Math.abs(report.cohesion.familyScore - report.cohesion.score) > 0.005) {
      lines.push(`  (its wider family: ${report.cohesion.familyScore.toFixed(2)})`);
    }
  } else {
    lines.push("  (no themes)");
  }

  lines.push("");
  lines.push("=== Card synergies (ranked) ===");
  for (const c of report.cards.slice(0, 20)) {
    const tag = c.isCommander ? " [commander]" : "";
    const plural = c.partnerCount === 1 ? "" : "s";
    // ONE ROW PER CARD, with its count: the analyzer collapses copies into a single node so six
    // basics are one relation and not six identical ones, and the count is how the row still says
    // the deck runs six. The graph has shown this as a "x6" badge since it shipped.
    const copies = report.quantities?.[c.name];
    const qty = copies ? ` x${copies}` : "";
    lines.push(`[${c.score.toFixed(2)}] ${c.name}${qty}${tag} — synergizes with ${c.partnerCount} card${plural}`);
    for (const p of c.topPartners.slice(0, 3)) {
      // ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE CLAIM. The reason OBJECTS survive on purpose --
      // `effectKind` is load-bearing for archetype detection -- so the dedupe belongs at the reader,
      // where the graph wire has always done it. Bontu's Monument printed the identical sentence
      // three times per partner before this.
      for (const r of dedupeReasonsByText(p.reasons)) {
        lines.push(`    - ${p.name}: ${r.text}`);
      }
    }
  }

  lines.push("");
  lines.push("=== Combos ===");
  if (report.combos.length === 0) {
    lines.push("  (none found)");
  } else {
    for (const c of report.combos) {
      lines.push(`  ${c.cards.join(" + ")} => ${c.result}`);
    }
  }

  lines.push("");
  lines.push("=== Themes ===");
  for (const t of report.themes.slice(0, 10)) {
    lines.push(`  ${t.tag}: ${t.count}`);
  }

  lines.push("");
  lines.push("=== Roles ===");
  lines.push(`  ramp: ${report.roles.ramp}  draw: ${report.roles.draw}  removal: ${report.roles.removal}`);

  // CANDIDATES, with the argument attached — never a verdict. See matcher's `cut-list.ts` for the
  // three ways this list is wrong, all of which point the same direction: a relation the engine
  // cannot express looks exactly like a card doing nothing.
  if (report.cutList && report.cutList.length > 0) {
    lines.push("");
    lines.push("=== Cut candidates ===");
    lines.push("  Not a verdict: a card the engine cannot connect looks the same as one that does nothing.");
    for (const c of report.cutList) {
      // Mana value beside the rating: two cards nothing connects to are different cut candidates
      // when one costs 9 and the other 1. It orders the list and never admits a row to it.
      lines.push(`  [${c.rating.toFixed(1)}] ${c.name} (${c.manaValue} mana)`);
      lines.push(`      ${c.reasons.join("; ")}`);
    }
  }
  // TRIM MODE — printed only when asked for, because it always has an answer and an unasked-for
  // "here are 5 cards to cut" is a verdict. `--trim N`.
  if (trim > 0 && report.trim && report.trim.length > 0) {
    lines.push("");
    lines.push(`=== Trim ${trim} ===`);
    lines.push("  Weakest first, with what argues each one STAYS. Rows tied on every measured axis are");
    lines.push("  ordered by name: nothing here ranks two ramp cards against each other.");
    for (const t of report.trim.slice(0, trim)) {
      lines.push(`  [${t.rating.toFixed(1)}] ${t.name} (${t.manaValue} mana)`);
      lines.push(`      why: ${t.reasons.join("; ")}`);
      lines.push(`      keeps it: ${t.protections.length > 0 ? t.protections.join("; ") : "\u2014 nothing"}`);
    }
  }
  if (report.slack && report.slack.length > 0) {
    lines.push("");
    lines.push("=== Where the slack is ===");
    lines.push("  Categories you carry more of than the Command Zone template's floor — a deckbuilding");
    lines.push("  convention someone typed, not a number measured from any deck. The category, never a");
    lines.push("  member — nothing here ranks two ramp cards against each other.");
    for (const s of report.slack) {
      lines.push(`  ${s.category}: ${s.count}/${s.target} (+${s.over})`);
    }
  }

  // WHAT YOUR LIBRARY IS WORTH to a payoff that reads a random card off the top. Deck level and
  // naming no member, for the reason `topdeck.ts` gives at length: the trigger chooses nothing, so
  // an edge to one expensive spell would be true of every one of them equally.
  if (report.deckMath && report.deckMath.topdeck.length > 0) {
    lines.push("");
    lines.push("=== Off the top ===");
    for (const t of report.deckMath.topdeck) {
      const land = Math.round(t.landShare * 100);
      lines.push(`  ${t.card}: a random card off your library is worth ${t.meanManaValue} mana`);
      lines.push(`      ${t.nonlandMeanManaValue} when it is not a land, and ${land}% of the time it is one`);
      if (t.castable) {
        lines.push(`      ${Math.round(t.castable.share * 100)}% of your library is ${t.castable.types.join(" or ")} — what it can cast for free`);
      }
    }
  }

  return lines.join("\n");
}
