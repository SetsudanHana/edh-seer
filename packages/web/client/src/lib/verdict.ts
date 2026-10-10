import type { DeckReport } from "../types.js";
import { scoreBand } from "./score-band.js";
import { findings, rankedFindings, type Finding } from "./findings.js";
import { groupKey } from "./role-group.js";

/** A short basic, in the words the verdict says it in. */
export const GAP_WORD_BY_KEY: Record<string, string> = { consistency: "card advantage", ramp: "ramp", interaction: "answers", boardWipes: "board wipes" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** THE BASICS THE SUGGESTIONS SAY ARE SHORT (persona round 2026-09-27: "Well built: it has the
 *  ramp, draw and answers a deck needs" sat above "You will run out of cards" and "3 short on
 *  interaction" on three seats' reports, and read as a pass the page then took back). Read off the
 *  same findings the suggestions are, so the two can never disagree. */
/** A basic the deck is short on: the word the page says it in, the figures the role's own tile
 *  shows, and how many cards short. */
export interface ShortRole { word: string; /** The Roles shelf's own heading, lowercased; the header says this. */ shelfWord: string; count: number; target: number; short: number }

/** THE ONE READ OF "WHICH ROLES ARE SHORT, AND BY HOW MUCH", in findings order. The Glance verdict
 *  and the report header (#1087) both read it, so the two can never name different gaps. */
export function shortRoles(report: DeckReport): ShortRole[] {
  return rolesOf(report, findings(report));
}

/** THE HEADER'S ORDER: the one Improve leads with (`rankedFindings().scored`, by impact), where the
 *  verdict keeps `findings()` order (by shortfall). Same roles, same words, same figures. */
export function headerGaps(report: DeckReport): ShortRole[] {
  return rolesOf(report, rankedFindings(report).scored);
}

/** THE BUILD SCORE'S GAP IN WORDS ("3 short on card advantage and 1 more"), said by the report
 *  header and the Scores chapter's Build dial alike (#1160, #1164) so the two cannot drift. Empty
 *  when nothing is short. */
export function gapText(gaps: readonly ShortRole[]): string {
  const first = gaps[0];
  return first ? `${first.short} short on ${first.shelfWord}${gaps.length > 1 ? ` and ${gaps.length - 1} more` : ""}` : "";
}

function rolesOf(report: DeckReport, list: readonly Finding[]): ShortRole[] {
  const out: ShortRole[] = [];
  const add = (word: string, shelfWord: string, count: number, target: number): void => {
    if (!out.some((o) => o.word === word)) out.push({ word, shelfWord, count, target, short: target - count });
  };
  for (const f of list) {
    if (f.kind === "build") {
      const name = f.id.replace(/^build:/, ""); const key = groupKey(name); const w = key ? GAP_WORD_BY_KEY[key] : undefined;
      // THE ROLE'S OWN NUMBERS (#1086): "short on card advantage (12 of 15)" cannot be read against a
      // Roles shelf that says "Draw 11", because the count it names is the one the shelf's group shows.
      // Read from the build parent the finding was made from, never from the headline's words.
      const parent = report.buildParents?.find((p) => p.name === name);
      if (w) add(w, name.toLowerCase(), parent?.count ?? NaN, parent?.target ?? NaN);
    }
    else if (f.kind === "lands" && /short|under/i.test(f.headline)) {
      // The Lands tile's own figures: what is run, against the modelled target.
      const l = report.deckMath?.lands;
      add("lands", "lands", l?.actual ?? NaN, l?.target ?? NaN);
    }
  }
  return out;
}

/** Each gap as the verdict says it, with its numbers where the role has them. */
function gaps(report: DeckReport): string[] {
  return shortRoles(report).map((g) => (Number.isNaN(g.target) ? g.word : `${g.word} (${g.count} of ${g.target})`));
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
    : "Well built: it has the ramp, card advantage and answers a deck needs. Its cards don't work with each other much yet, which is what the synergy score measures.";
  if (together) return "Its cards work together well, but it is short on some basics a deck needs, like ramp, card advantage or answers.";
  return "Short on some basics a deck needs, and its cards don't work with each other much yet.";
}

const isGood = (tone: string): boolean => tone === "good" || tone === "high";
