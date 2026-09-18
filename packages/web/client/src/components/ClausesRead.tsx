/** THE CLAUSES THE ENGINE READ, verbatim and in printed order (spec D2a option 2, 2026-09-18).
 *
 *  IT IS A COMPONENT BECAUSE TWO READERS MUST NOT DIVERGE, and they already did once. The block
 *  shipped inline in `CardPage` and `CommanderPage` never got it, so for one deploy the 2,665
 *  commander pages served the clauses to Googlebot inside `.prerendered` and hid them from every
 *  human the moment React booted -- `html[data-app-booted] .prerendered { display: none }`. That is
 *  cloaking, not an optimisation, and it was introduced by copying a block into one call site
 *  instead of writing it once.
 *
 *  UNATTRIBUTED, which is the only honest shape. One clause can derive several abilities -- Kogla
 *  and Yidaro's single activated line derives four -- so pinning an edge to a clause would be a
 *  guess wearing a citation's clothes. The heading says "read", not "proves": the reader does the
 *  matching, and the engine says only what it looked at. */
export function ClausesRead({ clauses }: { clauses?: string[] }) {
  if (clauses === undefined || clauses.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 max-w-[68ch]">
      <h2 className="text-2xl font-bold tracking-[-0.01em]">What the engine read</h2>
      <blockquote className="flex flex-col gap-2 border-l-2 border-(--separator) pl-4">
        {clauses.map((c, i) => <p key={i} className="text-(--muted)">{c}</p>)}
      </blockquote>
    </section>
  );
}
