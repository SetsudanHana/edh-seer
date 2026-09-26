import type { DeckReport } from "../types.js";
import { scoreBand } from "./score-band.js";

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
  if (built && together) return "A well-built deck whose cards work together.";
  if (built) return "Well built: it has the ramp, draw and answers a deck needs. Its cards don't work with each other much yet, which is what the synergy score measures.";
  if (together) return "Its cards work together well, but it is short on some basics a deck needs, like ramp, draw or answers.";
  return "Short on some basics a deck needs, and its cards don't work with each other much yet.";
}

const isGood = (tone: string): boolean => tone === "good" || tone === "high";
