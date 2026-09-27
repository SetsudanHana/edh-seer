import { useId } from "react";
import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import { useCardDrawer } from "./card-drawer.js";

/** Partners drawn around a cut; a cut has few by definition, and the count says the rest. */
const CAP = 8;
const W = 250, H = 210, CX = W / 2, CY = 105, R = 80, MID = 26, PART = 14;

const short = (name: string) => {
  const front = name.split(" // ")[0]!;
  const comma = front.indexOf(",");
  const s = comma > 0 ? front.slice(0, comma) : front;
  return s.length > 16 ? `${s.slice(0, 15).trimEnd()}…` : s;
};

/** WHY A CUT IS A CUT, DRAWN (report cohesion audit, 2026-09-27: "rely more on data visualisation
 *  than the text"). The card sits in the middle of its own few links; a thin constellation is the
 *  case for cutting it. A card with no links at all is a lone disc in a dashed ring. */
export function CutMap({ model, card }: { model: EngineModel; card: EngineCard }) {
  const { open } = useCardDrawer();
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // The partners that keep working first: they are the ones the "keeps working with" line counts.
  const pairs = [...(model.partners.get(card.id)?.entries() ?? [])]
    .map(([id, pair]) => ({ c: model.cards.get(id), once: pair.once }))
    .filter((x): x is { c: EngineCard; once: boolean } => !!x.c)
    .sort((a, b) => Number(a.once) - Number(b.once));
  const shown = pairs.slice(0, CAP);
  const dashed = shown.some((x) => x.once);
  const partners = shown.map((x) => x.c);
  const total = pairs.length;
  const at = partners.map((_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(partners.length, 1) + (partners.length === 2 ? Math.PI / 2 : 0);
    return { x: CX + Math.cos(t) * R, y: CY + Math.sin(t) * R * 0.72 };
  });
  const disc = (c: EngineCard, x: number, y: number, r: number, k: string, ring: string) => (
    <g key={k} className="cursor-pointer" onClick={() => open(c.name)}>
      <clipPath id={`${clip}-${k}`}><circle cx={x} cy={y} r={r} /></clipPath>
      <circle cx={x} cy={y} r={r} fill="var(--surface-secondary)" />
      {c.art ? <image href={c.art} x={x - r} y={y - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip}-${k})`} /> : null}
      <circle cx={x} cy={y} r={r} fill="none" stroke={ring} strokeWidth={2} />
    </g>
  );
  return (
    <figure className="m-0 flex shrink-0 flex-col items-center" data-testid="cut-map">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={total ? `${card.name} and the cards it works with` : `${card.name} works with no other card`}>
        {!partners.length ? <circle cx={CX} cy={CY} r={R * 0.7} fill="none" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 4" /> : null}
        {at.map((p, i) => <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="var(--accent)" strokeWidth={1.5} opacity={0.7}
          strokeDasharray={shown[i]!.once ? "3 3" : undefined} data-once={shown[i]!.once || undefined} />)}
        {partners.map((c, i) => disc(c, at[i]!.x, at[i]!.y, PART, `p${i}`, "var(--foreground)"))}
        {disc(card, CX, CY, MID, "mid", "var(--warning)")}
        {partners.map((c, i) => (
          // Above the top half's discs, below the bottom half's, so no name runs into the middle card.
          <text key={`t${i}`} x={at[i]!.x} y={at[i]!.y < CY - 1 ? at[i]!.y - PART - 4 : at[i]!.y + PART + 10} textAnchor="middle" fontSize={9.5} fill="var(--muted)"
            stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">{short(c.name)}</text>
        ))}
      </svg>
      {/* A LEGEND, NOT A COUNT: the sentence beside the map carries the count, by the cut
        *  ranking's own rules (helpers and unread links left out); a second number here disagreed. */}
      <figcaption className="text-xs text-(--muted)">
        {total ? <>solid: keeps working{dashed ? " · dashed: works once" : ""}{total > CAP ? ` · +${total - CAP} more` : ""}</> : "works with nothing here"}
      </figcaption>
    </figure>
  );
}
