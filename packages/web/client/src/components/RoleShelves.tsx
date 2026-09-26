import { useMemo } from "react";
import type { CardGraph, DeckReport } from "../types.js";
import type { EngineCard } from "../lib/engine-model.js";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import { CardFace } from "./engine-parts.js";

/** THE CARDS IN EACH ROLE, IN THE ROLES CHAPTER (owner, 2026-09-26: "it does not make any sense to
 *  have 2 times the same report"). The Graph tab's Overview had a "Cards judged by their job" box;
 *  its cards move here, beside the counts they make up, as one shelf of card images per role.
 *
 *  ONE CARD, ONE PLACE ON A SHELF. Every face row of a two-faced card carries the card's roles, so
 *  counting rows put Fell the Profane and its land back Fell Mire on the removal shelf twice, and
 *  Rani's removal read 10 against the chapter's 7. A card is counted once, by its front face, which
 *  is the rule the chapter's own counts are made by.
 *
 *  Ordered by mana value, then name: these are the cards a player weighs against each other for
 *  the same slot, and cost is the first thing that weighing looks at. Lands have their own chapter.
 *  Every card shows, wrapped: a phone scrolled each shelf sideways, and the phone seat never found
 *  the cards past the fourth (appeal review 2026-09-26). */
export function RoleShelves({ report, graph }: { report: DeckReport; graph?: CardGraph }) {
  const shelves = useMemo(() => roleShelves(report, graph), [report, graph]);
  if (!shelves.length) return null;
  // COUNT BESIDE TARGET, ON THE SHELF (appeal review 2026-09-26): the targets sat in the Scores
  // dials and the suggestions, so "is 7 ramp enough?" took two chapters to answer. A target is the
  // engine's, and it is set per GROUP ("Interaction", not "Removal"): a group of one role puts it on
  // that role's shelf, a group of several heads its shelves with it.
  const parents = (report.buildParents ?? []).filter((p) => p.target > 0);
  const parentOf = new Map(parents.flatMap((p) => p.leaves.map((l) => [l, p] as const)));
  const own = new Map((report.buildCategories ?? []).filter((c) => c.target > 0).map((c) => [c.category, c.target]));
  const headed = new Set<string>();
  return (
    <ul className="flex flex-col gap-4 text-sm">
      {shelves.map(({ category, cards }) => {
        const label = BUILD_CATEGORY_LABEL[category] ?? category;
        const p = parentOf.get(category);
        const group = p && p.leaves.length > 1 ? p : undefined;
        const head = group && !headed.has(group.name) ? group : undefined;
        if (head) headed.add(head.name);
        const target = group ? undefined : p?.target ?? own.get(category);
        return (
          <li key={category} className="flex flex-col gap-2">
            {head ? (
              <p data-testid={`shelf-group-${head.name}`} className="flex flex-wrap items-baseline gap-x-3 border-t border-(--separator) pt-3">
                <b className="text-base">{head.name}</b>
                <Against count={head.count} target={head.target} />
                {/* Said, because the shelves below add up to more than the group's count. */}
                {head.leaves.length > 1 ? <span className="text-xs text-(--muted)">a card that does two of these sits on both shelves</span> : null}
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
              <span className="shrink-0 sm:w-36 sm:pt-2">
                <b className="block">{label}</b>
                {target
                  ? <Against count={cards.length} target={target} />
                  : <span className="text-(--muted) tabular-nums">{cards.length} card{cards.length === 1 ? "" : "s"}</span>}
              </span>
              <ul className="flex min-w-0 flex-1 flex-wrap gap-2 pb-1" aria-label={`${label}: ${cards.length} card${cards.length === 1 ? "" : "s"}`}>
                {cards.map((c) => (
                  <li key={c.id} className="flex w-[76px] shrink-0 flex-col gap-1 sm:w-[88px]">
                    <CardFace card={c} className="w-full" />
                    {/* A card with no art already prints its name in the frame. */}
                    {c.art ? <span className="line-clamp-2 text-xs leading-tight text-(--muted)">{c.name}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "7 cards · aim for 10 (3 short)": the shortfall in the warning colour, as the dials paint it. */
function Against({ count, target }: { count: number; target: number }) {
  return (
    <span className="text-(--muted) tabular-nums">
      {count} card{count === 1 ? "" : "s"} · aim for {target}
      {count < target ? <span className="text-(--warning)">{` (${target - count} short)`}</span> : null}
    </span>
  );
}

/** The shelves, in the chapter's order: each role group's leaves as the engine lists them, then the
 *  roles in no group. Empty roles and lands are left out. */
export function roleShelves(report: DeckReport, graph?: CardGraph): { category: string; cards: EngineCard[] }[] {
  // By what the board prints: a two-faced card's front node is keyed by the whole card's name.
  const nodes = new Map((graph?.nodes ?? []).filter((n) => !n.isToken && !n.face).map((n) => [n.label, n]));
  const commanders = new Set(report.commanders ?? []);
  const byRole = new Map<string, { card: EngineCard; mv: number }[]>();
  const seen = new Set<string>();
  for (const row of report.cards) {
    // A back face stands for a card its front already counts.
    if (row.face || !row.roles?.length) continue;
    const physical = row.cardName ?? row.name;
    if (seen.has(physical)) continue;
    seen.add(physical);
    const n = nodes.get(row.name);
    const card: EngineCard = {
      id: row.name, name: row.name, typeLine: n?.typeLine ?? "", text: n?.oracleText ?? "", art: n?.artCrop ?? n?.faces?.[0]?.artCrop,
      isToken: false, isCommander: row.isCommander || commanders.has(physical),
      isLand: (n?.types ?? []).includes("land"), isFace: false,
      roles: row.roles, score: row.score ?? 0, manaCost: row.manaCost ?? "", physical,
    };
    const mv = row.manaValue ?? n?.cmc ?? 0;
    for (const role of row.roles) {
      if (role === "lands") continue;
      let list = byRole.get(role);
      if (!list) byRole.set(role, (list = []));
      list.push({ card, mv });
    }
  }
  const order: string[] = [];
  for (const p of report.buildParents ?? []) for (const l of p.leaves) if (!order.includes(l)) order.push(l);
  for (const c of report.buildCategories ?? []) if (!order.includes(c.category)) order.push(c.category);
  for (const r of byRole.keys()) if (!order.includes(r)) order.push(r);
  return order.filter((r) => byRole.has(r)).map((category) => ({
    category,
    cards: byRole.get(category)!.sort((a, b) => a.mv - b.mv || a.card.name.localeCompare(b.card.name)).map((x) => x.card),
  }));
}
