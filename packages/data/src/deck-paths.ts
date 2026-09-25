import { join } from "node:path";

/** WHERE THE REPOSITORY'S DECKLISTS LIVE, as absolute paths (2026-09-25).
 *
 *  Fifty-odd scripts each wrote their own: `"packages/cli/decks/calibration"` (right only from the
 *  repository root), `join(process.cwd(), "..", "cli", "decks")` (right only from inside a package),
 *  and a few `new URL(...)` forms. A script run from the wrong directory read nothing and reported
 *  zero decks. These are anchored to this file, so they are right from anywhere. */
export const DECKS_DIR = join(import.meta.dirname, "..", "..", "cli", "decks");

/** The 71 real decks the engine is calibrated and measured against. */
export const CALIBRATION_DECKS = join(DECKS_DIR, "calibration");

/** EDHREC's average and real decks by theme, for the archetype and template research. */
export const EDHREC_DECKS = join(DECKS_DIR, "edhrec");
