import type { EngineCard, EngineModel } from "../lib/engine-model.js";
import type { TopPair } from "../lib/top-pairs.js";
import { CardName } from "./card-drawer.js";
import { Lines, ReadCards } from "./engine-parts.js";

/** THE PAIRS THAT WORK BEST TOGETHER, named on Glance (owner ruling 2026-10-10, #1159): the persona
 *  task "the two cards that work together most strongly" had no answer on the page. The only figures
 *  are the ones said in words: how many ways the pair helps each other, and the combo's mana. */
export function StrongestPairs({ pairs, model }: { pairs: TopPair[]; model: EngineModel | null }) {
  if (!pairs.length) return null;
  // By the name the pair carries (front face), the card itself before a face or a token.
  const find = (name: string): EngineCard | undefined => {
    let any: EngineCard | undefined;
    for (const c of model?.cards.values() ?? []) {
      if (c.name.split(" // ")[0] !== name) continue;
      if (!c.isFace && !c.faceOf && !c.isToken) return c;
      any ??= c;
    }
    return any;
  };
  return (
    <section aria-labelledby="strongest-pairs-title" className="flex flex-col gap-3">
      <h3 id="strongest-pairs-title" className="eyebrow">Cards that work best together</h3>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
        {pairs.map((p) => {
          const both = p.cards.map(find);
          const read = both.every((c): c is EngineCard => !!c) ? both as EngineCard[] : undefined;
          return (
            <li key={p.cards.join("|")} className="flex min-w-0 flex-col gap-1.5 rounded-(--radius) border border-(--separator) px-3 py-2.5 text-sm">
              <p className="font-medium"><CardName name={p.cards[0]} /> + <CardName name={p.cards[1]} /></p>
              {p.kind === "combo" ? (
                <p className="text-(--muted)">A two-card combo: {p.manaTogether} mana together, {p.kill}</p>
              ) : (
                <>
                  <p className="text-(--muted)">Work together in {p.ways.length} {p.ways.length === 1 ? "way" : "ways"}{p.both ? " · each helps the other" : ""}</p>
                  {p.lines.length ? <Lines links={p.lines} /> : null}
                </>
              )}
              {read ? <ReadCards cards={read} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
