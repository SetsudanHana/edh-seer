import type { GameState, Marker } from "@edh-seer/engine";

/** An edge as the report lists it -- only the fields the summary reads. */
export interface StateEdge { a: string; b: string; enabledBy?: readonly string[] }

const SPEEDS = [1, 2, 3, 4] as const;
const SWITCHES: { marker: Exclude<Marker, "speed">; label: string }[] = [
  { marker: "monarch", label: "the monarch" },
  { marker: "initiative", label: "the initiative" },
  { marker: "blessing", label: "city's blessing" },
  { marker: "dungeon", label: "completed a dungeon" },
  { marker: "night", label: "night" },
];

/** The state in words: "speed 4", "the monarch + speed 2". */
export function stateLabel(state: GameState): string {
  const parts: string[] = [];
  if (state.speed) parts.push(`speed ${state.speed}`);
  for (const s of SWITCHES) if (state[s.marker]) parts.push(s.label);
  return parts.join(" + ");
}

/** WHAT THE STATE DID, READ OFF THE REPORT (roadmap W18c, owner 2026-09-06: "it should re-run in
 *  place and say what changed"). Every edge the analysis drew only because of the state carries
 *  `enabledBy`, so the count and the cards that gained the most partners come straight from the
 *  run on screen -- no snapshot of a previous run, nothing to get out of sync. Cards are named
 *  because "+2 edges" is a number and "Garruk's Uprising +2" is a claim a reader can go and check. */
export function stateSummary(edges: readonly StateEdge[], state: GameState): string | null {
  const label = stateLabel(state);
  if (!label) return null;
  const enabled = edges.filter((e) => e.enabledBy && e.enabledBy.length > 0);
  if (enabled.length === 0) return `${label}: no edge in this deck depends on it`;
  const gained = new Map<string, number>();
  for (const e of enabled) for (const n of [e.a, e.b]) gained.set(n, (gained.get(n) ?? 0) + 1);
  const movers = [...gained.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3)
    // "+N PARTNERS": an edge is counted once in the total and once per endpoint here, so the movers
    // can add up to more than the total, and the word says why.
    .map(([n, k]) => `${n} +${k} ${k === 1 ? "partner" : "partners"}`).join(" · ");
  return `${label}: ${enabled.length} ${enabled.length === 1 ? "edge exists" : "edges exist"} because of it · ${movers}`;
}

/** A GAME STATE THE OWNER SETS (roadmap W18). Speed is the PLAYER's (CR 702.179), one number for
 *  the deck: "none" is the deck before any engine card is out -- the report as it always was --
 *  and 4 is max speed. The monarch, the initiative, the city's blessing, a completed dungeon and
 *  night are switches. Each control shows only when the deck can reach the marker at all, so it
 *  never offers a choice that changes nothing. */
export function StateControls({ markers, state = {}, onState, edges, busy = false }: {
  markers: readonly Marker[];
  state?: GameState;
  onState: (state: GameState) => void;
  /** The report's edges, for the "what the state did" line. Absent keeps the old sentence. */
  edges?: readonly StateEdge[];
  /** The re-run under a new state is in flight. Said HERE, on the control that caused it, rather
   *  than by re-collapsing the deck bar into "Analyzing…" -- which read as a page reload. */
  busy?: boolean;
}) {
  const switches = SWITCHES.filter((s) => markers.includes(s.marker));
  const hasSpeed = markers.includes("speed");
  if (!hasSpeed && switches.length === 0) return null;
  const pill = (pressed: boolean) =>
    `inline-flex min-w-9 justify-center rounded-(--radius) border px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent) ${
      pressed ? "border-(--accent) text-(--accent)" : "border-(--separator)"}`;
  // The next state carries only what is on: a cleared marker leaves the object, so "{}" is "none".
  const set = (patch: Partial<GameState>) => {
    const next: GameState = { ...state, ...patch };
    for (const k of Object.keys(next) as (keyof GameState)[]) if (!next[k]) delete next[k];
    onState(next);
  };
  const any = Object.keys(state).length > 0;
  return (
    <div className="flex flex-col gap-2">
      {hasSpeed && (
        <div role="group" aria-label="speed" className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-(--muted)">speed</span>
          <button type="button" className={pill(state.speed === undefined)} aria-pressed={state.speed === undefined} onClick={() => set({ speed: undefined })}>none</button>
          {SPEEDS.map((n) => (
            <button key={n} type="button" className={pill(state.speed === n)} aria-pressed={state.speed === n} onClick={() => set({ speed: n })}>{n}</button>
          ))}
        </div>
      )}
      {switches.length > 0 && (
        <div role="group" aria-label="you have" className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-(--muted)">you have</span>
          {switches.map((s) => (
            <button key={s.marker} type="button" className={pill(state[s.marker] === true)} aria-pressed={state[s.marker] === true}
              onClick={() => set({ [s.marker]: !state[s.marker] } as Partial<GameState>)}>{s.label}</button>
          ))}
        </div>
      )}
      <span className="text-(--muted) text-sm" aria-live="polite">
        {busy
          ? `re-reading the deck under ${stateLabel(state) || "no state"}…`
          : any
            ? (edges ? stateSummary(edges, state) : "dashed edges exist because of this state")
            : "no state set — conditional abilities are off"}
      </span>
    </div>
  );
}
