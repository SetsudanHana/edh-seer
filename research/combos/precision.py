# LOCAL RESEARCH ONLY (#726): the loops the layer finds, and how many are Spellbook combos.
import json, runpy, io, contextlib, collections, itertools
with contextlib.redirect_stdout(io.StringIO()):
    L = runpy.run_path("research/combos/loops.py")
D = L["D"]; loop_graph = L["loop_graph"]

def short_cycles(g, nodes, kmax=3):
    out = set()
    for a in nodes:
        for b in g.get(a, ()):
            if b.startswith("token:"): continue
            if a in g.get(b, ()): out.add(frozenset((a, b)))
            if kmax >= 3:
                for c in g.get(b, ()):
                    if c in (a,) or c.startswith("token:"): continue
                    if a in g.get(c, ()): out.add(frozenset((a, b, c)))
    return out

tot = hit = 0; per_deck = []; examples = []
for d in D:
    g, kinds = loop_graph(d)
    names = [c["n"] for c in d["cards"] if not c["n"].startswith("token")]
    cyc = short_cycles(g, names)
    known = [set(c["cards"]) for c in d["combos"] if len(c["cards"]) >= 2]
    h = [x for x in cyc if any(x <= k for k in known)]
    tot += len(cyc); hit += len(h)
    per_deck.append((d["id"], len(cyc), len(h), len(known)))
    for x in list(cyc - set(h))[:2]:
        ks = sorted({k for a, b in itertools.permutations(x, 2) for k in kinds.get((a, b), ())})
        examples.append((d["id"], sorted(x), ks))
print(f"short loops found: {tot} across {len(D)} decks; inside a known combo: {hit} ({hit/max(tot,1):.0%})")
no_combo = [p for p in per_deck if p[3] == 0]
print(f"decks with no Spellbook combo: {len(no_combo)}, loops found in them: {sum(p[1] for p in no_combo)} (median {sorted(p[1] for p in no_combo)[len(no_combo)//2]})")
for p in sorted(per_deck, key=lambda p: -p[1])[:6]: print("  ", p)
print("\nsample loops that are not Spellbook combos:")
for e in examples[:14]: print("  ", e)
