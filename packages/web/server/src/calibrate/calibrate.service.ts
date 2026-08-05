/** Serves one pair at a time for a human verdict, and records the answer.
 *  Spec: `docs/superpowers/specs/2026-08-06-pair-calibration-tool-design.md`.
 *
 *  LOCAL DEV TOOL. It writes into the repository, has no auth, and must never be exposed. */
import { Inject, Injectable } from "@nestjs/common";
import type { Stratum, TagDefect, Verdict } from "@mtg/matcher";

export const CALIBRATE_DEPS = "CALIBRATE_DEPS";

/** One side of a pair, as the judge sees it. */
export interface CalibrateCard {
  name: string;
  typeLine: string;
  oracleText: string;
  /** Derived tags in reader-facing lines ("triggers on a creature dying", "static: pump"). Half of
   *  what this tool catches is a MISTAGGED card, which is invisible without them. */
  tags: string[];
}

export interface CalibratePair {
  a: CalibrateCard;
  b: CalibrateCard;
  stratum: Stratum;
  /** What the engine currently says. The client holds this back until the judge asks, because
   *  showing it first anchors the answer to what the engine already believes. */
  engineReasons: string[];
}

export interface VerdictRequest {
  a: string;
  b: string;
  verdict: Verdict;
  stratum: Stratum;
  tagDefects?: TagDefect[];
  note?: string;
}

export interface CalibrateDeps {
  samplePair(): Promise<CalibratePair | null>;
  record(v: VerdictRequest): Promise<{ total: number; knownDefects: number }>;
}

@Injectable()
export class CalibrateService {
  constructor(@Inject(CALIBRATE_DEPS) private readonly deps: CalibrateDeps) {}

  async pair(): Promise<CalibratePair> {
    const p = await this.deps.samplePair();
    if (!p) throw new Error("no sampleable pair: is the derived corpus empty?");
    return p;
  }

  async record(v: VerdictRequest): Promise<{ total: number; knownDefects: number }> {
    return this.deps.record(v);
  }
}
