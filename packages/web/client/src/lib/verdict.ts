import type { DeckReport } from "../types.js";
import { scoreBand } from "./score-band.js";
import { findings } from "./findings.js";

/** A short basic, in the words the verdict says it in. */
const GAP: Record<string, string> = { "Card advantage": "card advantage", Ramp: "ramp", Interaction: "answers", "Board wipes": "board wipes" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** THE BASICS THE SUGGESTIONS SAY ARE SHORT (persona round 2026-09-27: "Well built: it has the
 *  ramp, draw and answers a deck needs" sat above "You will run out of cards" and "3 short on
 *  interaction" on three seats' reports, and read as a pass the page then took back). Read off the
 *  same findings the suggestions are, so the two can never disagree. */
/** Each gap as the page says it, with its numbers where the role has them. */
function gaps(report: DeckReport): string[] {
  const out: string[] = [];
  for (const f of findings(report)) {
    if (f.kind === "build") {
      const name = f.id.replace(/^build:/, ""); const w = GAP[name];
      // THE ROLE'S OWN NUMBERS (#1086): "short on card advantage (12 of 15)" cannot be read against a
      // Roles shelf that says "Draw 11", because the count it names is the one the shelf's group shows.
      // Read from the build parent the finding was made from, never from the headline's words.
      const parent = report.buildParents?.find((p) => p.name === name);
      const said = w && parent ? `${w} (${parent.count} of ${parent.target})` : w;
      if (said && !out.includes(said)) out.push(said);
    }
    else if (f.kind === "lands" && /short|under/i.test(f.headline) && !out.includes("lands")) out.push("lands");
  }
  return out;
}

/** "IS MY DECK GOOD?" IN ONE SENTENCE (appeal review 2026-09-26). The top of the report showed
 *  "Synergy 2.9 developing" beside "Build 4.5 on target", then a first suggestion saying "you will
 *  run out of cards", and the beginner seat left "less sure than before, not more": "like two
 *  teachers giving opposite grades". The two scores measure different things, so the sentence says
 *  both and which is which: Build is whether the deck has the basics a deck needs (ramp, draw,
 *  interaction, lands), Synergy is whether its cards work with each other.
 *
 *  The bands are the header's own (`scoreBand`), so the sentence can never disagree with the words
 *  printed beside the numbers. A partly read deck gets no verdict: the scores it would rest on are
 *  already marked "too little of the deck read to call this". */
export function verdict(report: DeckReport): string | null {
  if (report.coverage) return null;
  const s = report.synergyOverall, b = report.buildScore;
  if (s === undefined || b === undefined) return null;
  const built = isGood(scoreBand(b, "build").tone);
  const together = isGood(scoreBand(s, "synergy").tone);
  const short = built ? gaps(report) : [];
  if (built && together) return short.length ? `A well-built deck whose cards work together, short only on ${list(short)}.` : "A well-built deck whose cards work together.";
  if (built) return short.length
    ? `Mostly well built, but short on ${list(short)}. Its cards don't work with each other much yet, which is what the synergy score measures.`
    : "Well built: it has the ramp, draw and answers a deck needs. Its cards don't work with each other much yet, which is what the synergy score measures.";
  if (together) return "Its cards work together well, but it is short on some basics a deck needs, like ramp, draw or answers.";
  return "Short on some basics a deck needs, and its cards don't work with each other much yet.";
}

const isGood = (tone: string): boolean => tone === "good" || tone === "high";
