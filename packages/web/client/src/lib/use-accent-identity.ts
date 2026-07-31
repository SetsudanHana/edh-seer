import { useEffect, useState } from "react";
import { identityColor } from "./color-identity.js";

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
    document.documentElement.style.setProperty("--accent", identityColor(active));
  }, [active]);

  return { manualPick, setManualPick, active };
}
