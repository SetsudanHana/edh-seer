import type { RunSnapshot } from "./run-diff.js";

/* THE SESSION STORE, SPLIT FROM `run-diff.ts` (2026-09-23). The landing page reads the remembered
 * deck before it has analysed anything, and importing it from `run-diff` dragged `findings` -- and
 * through it `@edh-seer/matcher/build`, the archetype table and `demand-sentence` -- into the entry
 * chunk. The diff itself is only computed after an analysis, so `App` imports that module lazily. */

const KEY = "mtg-synergy:last-run";

/** sessionStorage, and it is allowed to be absent: Safari private mode throws on access, and the
 *  test environment may not provide it. A missing store means no strip, never a crash. */
export function loadLastRun(): RunSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    return null;
  }
}

export function saveLastRun(snapshot: RunSnapshot): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* no store, no strip — see above */
  }
}

const DECK_KEY = "mtg-synergy:last-deck";

export interface LastDeck {
  commanders: string;
  decklist: string;
}

/** THE TEXT THE READER PASTED, so run two starts with it still in the box (roadmap S9).
 *
 *  Same store and same lifetime as the run snapshot above, deliberately: the box and the diff it
 *  will be measured against have to die together, or the reader gets their deck back with no
 *  statement of what their edit did. Same try/catch too -- a missing store means an empty box. */
export function saveLastDeck(deck: LastDeck): void {
  try {
    window.sessionStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch {
    /* no store, no memory -- see `saveLastRun` */
  }
}

/** START OVER: BOTH KEYS, IN ONE CALL (owner, 2026-09-03 -- "we do not have way to clear and start
 *  from the beginning").
 *
 *  `saveLastDeck`'s own comment is the reason this is not two exported clears: *"the box and the
 *  diff it will be measured against have to die together, or the reader gets their deck back with
 *  no statement of what their edit did"*. A caller that forgot one of them would produce exactly
 *  that, so the pair is not offered separately. */
export function clearLastRun(): void {
  try {
    window.sessionStorage.removeItem(KEY);
    window.sessionStorage.removeItem(DECK_KEY);
  } catch {
    /* no store, nothing to clear -- see `saveLastRun` */
  }
}

export function loadLastDeck(): LastDeck | null {
  try {
    const raw = window.sessionStorage.getItem(DECK_KEY);
    return raw ? (JSON.parse(raw) as LastDeck) : null;
  } catch {
    return null;
  }
}
