import { dedupeReasonsByText, type DeckReport } from "@mtg/engine";
import { band as range, percent } from "@mtg/engine/percent";

/** SHARED WITH THE WEB, one copy (roadmap N6). This file floored a probability at 1% and
 *  `CardList.tsx` did not, so a measured-impossible cast read "1%" here and "0%" there. The floor
 *  belongs on the REFUSAL path -- an unpriceable card prints an em dash -- and a measured zero is a
 *  measurement. */
const pct = percent;
const band = (b: { low: number; high: number }): string => range(b.low, b.high);

/** How far `mana` must sit above `castable` before the report says the problem is COLOUR. Below
 *  this the two numbers say the same thing and the second one is noise. */
const COLOUR_GAP = 0.05;

export function formatReport(report: DeckReport, trim = 0): string {
  const lines: string[] = [];

  lines.push("=== Commanders ===");
  lines.push(report.commanders.length ? `  ${report.commanders.join(", ")}` : "  (none specified)");
  // WHEN IS IT ONLINE (roadmap K5). A RANGE, never one number, and an em dash when the model REFUSES
  // the cost. A MEASURED zero is a different thing and prints 0% (N6): 20,000 trials of no, on a cost
  // this model can price, is a measurement, and flooring it at 1% claims the cast is possible.
  const cmdCast = report.deckMath?.castability.commanders ?? [];
  for (const c of cmdCast) {
    // The name is repeated only for a PARTNER PAIR, where two rows need telling apart.
    const who = cmdCast.length > 1 ? `${c.name}: ` : "";
    const odds = c.castable === null
      ? `— (${c.refused})`
      : `${band(c.castable)} to cast it by turn ${c.turn}`;
    lines.push(`  ${who}${odds}`);
    // WHICH PROBLEM IT IS. `castable` folds mana and colour together; `mana` is the same cell with
    // colours ignored, so a wide gap says the deck cannot make the COLOURS and a narrow one says it
    // cannot make the MANA. Printed only when the gap is worth acting on -- otherwise it is a second
    // number saying the same thing, which is how a report stops being read.
    if (c.castable && c.mana && c.mana.high - c.castable.high >= COLOUR_GAP) {
      lines.push(`    the mana is there ${band(c.mana)} of the time — what is missing is the colours`);
    }
    if (c.commandZoneCaveat) lines.push(`    note: ${c.commandZoneCaveat}`);
  }
  // THE RANGE SHIPS WITH WHAT IS WRONG WITH IT, or it should not ship. The range is the PLAY POLICY
  // now (hold up two mana, or spend everything on acceleration) rather than the old pair of
  // arithmetic biases, and the old "reads low, land-fetch ramp is not counted" caveat is GONE
  // because the simulation models land-fetch ramp -- it was the measured defect that motivated it.
  if (cmdCast.some((c) => c.castable !== null)) {
    lines.push("  (simulated: the low end holds up two mana, the high end spends everything on ramp)");
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
      // …AND "EVERY GAME" IS TRUE ONCE (CR 903.8, roadmap J5). The line invites being read as free
      // and repeatable; the tax is what makes the second and third casts expensive, and nothing here
      // models how often the commander dies.
      if (report.commanderTax) lines.push(`    (${report.commanderTax.caveat})`);
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

  // HOW YOUR RAMP SURVIVES BEING ATTACKED, beside the count and never folded into it. The ordering
  // is measured, not asserted: `answer-pool.json` counts 1,839 cards in the format that answer a
  // creature, 755 an artifact and 306 a land, and one board wipe takes every dork at once and no
  // rock and no land. Printed only when the deck runs ramp at all -- three zeroes state nothing.
  const rr = report.rampResilience;
  if (rr && rr.landShare !== undefined) {
    lines.push("");
    lines.push("=== How resilient your ramp is ===");
    lines.push(`  lands ${rr.land}  ·  rocks ${rr.rock}  ·  dorks ${rr.dork}  —  ${Math.round(100 * rr.landShare)}% land-shaped`);
    lines.push("  A fetched land survives what a rock does not, and a rock survives what a dork does not:");
    lines.push("  306 cards in the format answer a land, 755 answer an artifact, 1,839 answer a creature —");
    lines.push("  and a board wipe takes every dork at once. Not scored: a deck without green cannot run");
    lines.push("  green land ramp, and docking it for that would be charging it for its colours.");
  }

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

  // DECK LEGALITY AS A REPORT, NEVER A GATE (roadmap J4, CR 903.3 / 903.5a-d). A partial paste is a
  // normal thing to hand this tool, so refusing to analyse would be the wrong failure direction —
  // the same ruling `cutCandidates` ships. Silence means nothing was FOUND, not that the deck is
  // legal: five rules are checked and the format has more.
  if (report.legality && report.legality.length > 0) {
    lines.push("");
    lines.push("=== Against the format ===");
    for (const l of report.legality) {
      lines.push(`  ${l.detail}`);
      if (l.cards.length > 0) lines.push(`      ${l.cards.slice(0, 8).join(" · ")}${l.cards.length > 8 ? ` … and ${l.cards.length - 8} more` : ""}`);
    }
    lines.push("  (five rules of many — this is a report, not a verdict, and nothing here stops the analysis)");
  }

  // MANA AVAILABILITY (roadmap I11's report wiring). A SIMULATION, NOT A FORMULA, and an INTERVAL
  // rather than a point because the model's own falsifier fired: policy sensitivity measured 27.6pp
  // against a 32.7pp median ramp signal, so this is a POLICY property at deck scale. Both ends or
  // neither — the low end holds up two mana, the high end spends everything on acceleration.
  if (report.manaAvailability && report.manaAvailability.rows.length > 0) {
    const m = report.manaAvailability;
    lines.push("");
    lines.push("=== Mana availability ===");
    lines.push(`  ${m.trials} simulated games under two play policies, with ${m.accelerants} accelerants in the deck`);
    // ONE FIGURE WHEN THE TWO POLICIES AGREE, never "100% - 100%" — the same collapse
    // `castability.ts`'s range already ships, for the same reason.
    const lo = Math.round(m.headline.low * 100), hi = Math.round(m.headline.high * 100);
    const odds = lo === hi ? `${lo}%` : `${lo}% - ${hi}%`;
    lines.push(`  by turn ${m.headline.turn} you can make ${m.headline.mana} mana ${odds} of the time`);
    lines.push("    (the range is the PLAY POLICY: the low end holds up two mana, the high end spends");
    lines.push("     everything on acceleration and is a CEILING no real deck plays to)");
    lines.push("");
    lines.push("  turn   mana (p25-median-p75)   spells you could pay for");
    for (const r of m.rows) {
      const mana = `${r.mana.p25}-${r.mana.median}-${r.mana.p75}`;
      const sh = (v: number): string => `${Math.round(v * 100)}%`;
      lines.push(`  ${String(r.turn).padStart(4)}   ${mana.padEnd(20)}   ${sh(r.payableShare.p25)}-${sh(r.payableShare.median)}-${sh(r.payableShare.p75)}`);
    }
    // THE CAVEATS ARE NOT DECORATION. Every one is a stated ceiling from the model's own design, and
    // a reader who does not see them will take the high end as the answer.
    lines.push("  the per-turn rows are the spend-everything policy; the two policies agree on every");
    lines.push("    median, and disagree only in the tail — which is what the range above is");
    lines.push("  colour is ignored entirely, so this is MANA and never castability: a {3}{R}{G}{W}");
    lines.push("    spell needs three specific colours nothing here checks");
  }

  // TWENTY-ONE COMMANDER DAMAGE (CR 903.10a), and it is NOT the clock — that curve is total board
  // power against 40 life, while this must come from ONE creature. A range, because the two ends are
  // two assumptions: a bare commander, and one carrying everything the deck can attach.
  if (report.commanderDamage && report.commanderDamage.length > 0) {
    lines.push("");
    lines.push("=== 21 commander damage ===");
    for (const c of report.commanderDamage) {
      lines.push(`  ${c.commander} (power ${c.power}): ${c.bare} connections bare, ${c.kitted} carrying all ${c.attachableCount} of the deck's Equipment and Auras`);
      lines.push(`      +${c.attachable} power is attachable in total — the kitted end assumes you draw, cast and attach every piece`);
    }
  }

  // WHAT THE DECK CANNOT TURN ON (roadmap I9's deck-level half). The pairwise pass says "Rootbound
  // Crag enters untapped because you run Steam Vents" and can say NOTHING when the answer is zero,
  // so a land that never turns on reads exactly like a land with no condition. A reason, not a gate.
  if (report.landConditions && report.landConditions.length > 0) {
    lines.push("");
    lines.push("=== Conditions this deck cannot meet ===");
    for (const l of report.landConditions) {
      lines.push(`  ${l.card}: wants ${l.wants} — ${l.has}`);
    }
  }

  // WHICH TABLE THIS DECK IS FOR (roadmap L3). WotC's published bracket rule, read off two lists the
  // engine already carries. It DESCRIBES and never grades: a 4-5 deck is not a worse deck than a
  // 1-2 deck, it is a deck for a different table, and the wording has to carry that or the number
  // reads as a score out of five.
  if (report.bracket) {
    const b = report.bracket;
    lines.push("");
    lines.push("=== Commander bracket ===");
    lines.push(`  Bracket ${b.band} — what this deck's contents allow, not how good it is`);
    for (const r of b.reasons) lines.push(`    ${r}`);
    if (b.band === "1-2") {
      lines.push("    no Game Changers and no infinite combo");
    }
    // The bands are 1-2 and 4-5 rather than 1, 2, 4 and 5 because the halves differ on facts no
    // list settles, and saying so beats printing a number that looks more precise than it is.
    lines.push("    (1 vs 2 is about how the deck was built, 4 vs 5 about the table — neither is a list)");
  }

  return lines.join("\n");
}
