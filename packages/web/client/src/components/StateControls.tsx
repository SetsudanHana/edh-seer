import type { Marker } from "@edh-seer/engine";

const SPEEDS = [1, 2, 3, 4] as const;

/** A GAME STATE THE OWNER SETS (roadmap W18). Speed is the PLAYER's (CR 702.179), one number for
 *  the deck: "none" is the deck before any engine card is out -- the report as it always was --
 *  and 4 is max speed, where "Max speed —" abilities exist and "X is your speed" is 4. Shown only
 *  when the deck can reach the marker at all, so it never offers a choice that changes nothing. */
export function StateControls({ markers, speed, onSpeed }: {
  markers: readonly Marker[];
  speed?: 1 | 2 | 3 | 4;
  onSpeed: (speed: 1 | 2 | 3 | 4 | undefined) => void;
}) {
  if (!markers.includes("speed")) return null;
  const pill = (pressed: boolean) =>
    `inline-flex min-w-9 justify-center rounded-(--radius) border px-3 py-1.5 text-sm hover:border-(--accent) hover:text-(--accent) ${
      pressed ? "border-(--accent) text-(--accent)" : "border-(--separator)"}`;
  return (
    <div role="group" aria-label="speed" className="flex flex-wrap items-center gap-2">
      <span className="eyebrow text-(--muted)">speed</span>
      <button type="button" className={pill(speed === undefined)} aria-pressed={speed === undefined} onClick={() => onSpeed(undefined)}>none</button>
      {SPEEDS.map((n) => (
        <button key={n} type="button" className={pill(speed === n)} aria-pressed={speed === n} onClick={() => onSpeed(n)}>{n}</button>
      ))}
      <span className="text-(--muted) text-sm">
        {speed === undefined
          ? "no engine running — Max speed abilities are off"
          : "dashed edges exist because of this speed"}
      </span>
    </div>
  );
}
