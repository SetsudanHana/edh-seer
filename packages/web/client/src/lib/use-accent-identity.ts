import { useEffect, useState } from "react";
import { identityColor, identityGradient } from "./color-identity.js";

const STORAGE_KEY = "mtg-synergy:preferred-identity";

function readStoredIdentity(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** Resolves the page's accent color and keeps `--accent` applied to the document root.
 *  Precedence: the analyzed deck's own color identity wins whenever a report is present
 *  (even an empty/colorless one, which falls back to the neutral old-gold via
 *  identityColor); the player's pinned preference is the resting default before or
 *  between analyses. */
export function useAccentIdentity(analyzedIdentity: string[] | undefined) {
  const [manualPick, setManualPick] = useState<string[]>(() => readStoredIdentity());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manualPick));
    } catch {
      // Storage can be unavailable (private browsing, disabled cookies) — the pick
      // still works for the session, it just won't survive a reload.
    }
  }, [manualPick]);

  const active = analyzedIdentity ?? manualPick;

  useEffect(() => {
    // --accent: solid, for text/icons (gradient text stays off the table).
    // --accent-gradient / --accent-gradient-y: the full identity, for anything
    // that's a fillable shape — buttons, bars, borders — via
    // background-image: var(--accent-gradient) (horizontal) or the -y variant
    // for a bar whose dominant dimension is height (mana curve, land math).
    document.documentElement.style.setProperty("--accent", identityColor(active));
    document.documentElement.style.setProperty("--accent-gradient", identityGradient(active));
    document.documentElement.style.setProperty("--accent-gradient-y", identityGradient(active, "180deg"));
  }, [active]);

  return { manualPick, setManualPick, active };
}
