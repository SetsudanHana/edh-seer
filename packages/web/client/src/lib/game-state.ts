import type { GameState, Marker } from "@edh-seer/engine";

/** THE STATE LIVES IN THE QUERY so a shared link carries it: `?speed=4&monarch=1` (roadmap W18).
 *  Speed is a number 1 to 4; every other marker is a flag written as `1`. Anything else is ignored. */
export const MARKERS: readonly Marker[] = ["speed", "monarch", "initiative", "blessing", "dungeon", "night"];

export function stateFromSearch(search: string): GameState {
  const q = new URLSearchParams(search);
  const out: GameState = {};
  const speed = Number(q.get("speed"));
  if (speed === 1 || speed === 2 || speed === 3 || speed === 4) out.speed = speed;
  for (const m of MARKERS) if (m !== "speed" && q.get(m) === "1") out[m] = true;
  return out;
}

/** The query with the state written in and every other parameter kept; "" when nothing is left. */
export function searchWithState(search: string, state: GameState): string {
  const q = new URLSearchParams(search);
  for (const m of MARKERS) q.delete(m);
  if (state.speed) q.set("speed", String(state.speed));
  for (const m of MARKERS) if (m !== "speed" && state[m]) q.set(m, "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}
