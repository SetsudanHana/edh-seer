/** Whether the pair-judging tool is mounted at all.
 *
 *  IT IS A WRITE ENDPOINT ON THE PANEL'S OWN INPUTS. `POST /api/calibrate/verdict` writes
 *  `pair-calibration`'s pairs file AND its clause fixture, both of which back a RATCHET the test
 *  suite enforces (`KNOWN_DEFECT_CAP`), and the panel those feed is owner-denominated end to end
 *  since round 4. Anyone who can reach the server could inject judged pairs into the instrument this
 *  project measures itself with — which is why exposing the app to anyone at all was blocked on this
 *  (`specs/2026-08-23-first-exposure-plan.md`).
 *
 *  DEFAULT OFF, AND THE OWNER OPTS IN PER RUN. `#calibrate` is a local dev tool — `main.tsx` has
 *  said so since it shipped — so the deployed default should not carry it. There is no auth here to
 *  hang it on and inventing one for a single-user tool is the machinery this repo refuses; an env
 *  flag is the whole fix.
 *
 *  EXACTLY "1", NOTHING ELSE. A gate that accepts "true", "yes" or any non-empty string is a gate
 *  that opens on `MTG_CALIBRATE=false`, which is the classic way one of these fails open. */
export function calibrateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MTG_CALIBRATE === "1";
}
