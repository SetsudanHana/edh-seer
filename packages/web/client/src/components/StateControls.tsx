import type { GameState, Marker } from "@edh-seer/engine";

const SPEEDS = [1, 2, 3, 4] as const;
const SWITCHES: { marker: Exclude<Marker, "speed">; label: string }[] = [
  { marker: "monarch", label: "the monarch" },
  { marker: "initiative", label: "the initiative" },
  { marker: "blessing", label: "city's blessing" },
  { marker: "dungeon", label: "completed a dungeon" },
  { marker: "night", label: "night" },
];

/** A GAME STATE THE OWNER SETS (roadmap W18). Speed is the PLAYER's (CR 702.179), one number for
 *  the deck: "none" is the deck before any engine card is out -- the report as it always was --
 *  and 4 is max speed. The monarch, the initiative, the city's blessing, a completed dungeon and
 *  night are switches. Each control shows only when the deck can reach the marker at all, so it
 *  never offers a choice that changes nothing. */
export function StateControls({ markers, state = {}, onState }: {
  markers: readonly Marker[];
  state?: GameState;
  onState: (state: GameState) => void;
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
      <span className="text-(--muted) text-sm">
        {any ? "dashed edges exist because of this state" : "no state set — conditional abilities are off"}
      </span>
    </div>
  );
}
