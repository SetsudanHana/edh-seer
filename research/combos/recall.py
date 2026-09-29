# LOCAL RESEARCH ONLY (#726): do Spellbook's combos show up as cycles in our reason graph?
import json, collections, itertools

D = json.load(open("research/combos/decks.json"))

def graph(reasons, allow):
    g = collections.defaultdict(set)
    for r in reasons:
        if r["p"] and r["c"] and r["p"] != r["c"] and allow(r):
            g[r["p"]].add(r["c"])
    return g

def sccs(nodes, g):
    """Tarjan over the subgraph on `nodes`."""
    index, low, stack, on, out, i = {}, {}, [], set(), [], [0]
    def visit(v):
        index[v] = low[v] = i[0]; i[0] += 1; stack.append(v); on.add(v)
        for w in g.get(v, ()):
            if w not in nodes: continue
            if w not in index: visit(w); low[v] = min(low[v], low[w])
            elif w in on: low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = set()
            while True:
                w = stack.pop(); on.discard(w); comp.add(w)
                if w == v: break
            out.append(comp)
    for v in nodes:
        if v not in index: visit(v)
    return out

ALLOW = {
    "any link": lambda r: True,
    "no one-shot": lambda r: r["rep"] != "oneshot",
}
for name, allow in ALLOW.items():
    tot = full = part = 0
    missing = collections.Counter()
    for d in D:
        g = graph(d["reasons"], allow)
        tokens = {n for n in set(g) | {c for v in g.values() for c in v} if str(n).startswith("token:")}
        for c in d["combos"]:
            pieces = set(c["cards"])
            if len(pieces) < 2: continue
            tot += 1
            comps = sccs(pieces | tokens, g)
            best = max((len(x & pieces) for x in comps), default=0)
            if best == len(pieces): full += 1
            elif best >= 2: part += 1
            else:
                # which pairs have ANY link at all
                linked = sum(1 for a, b in itertools.permutations(pieces, 2) if b in g.get(a, ()))
                missing["no link among pieces" if linked == 0 else "links but no cycle"] += 1
    print(f"[{name}] combos {tot}: every piece on one cycle {full} ({full/tot:.0%}), a cycle through 2+ pieces {part} ({part/tot:.0%}), none {tot-full-part}  {dict(missing)}")

print("\n== LOOP + PAYOFFS: a cycle through 2+ pieces, every other piece edged to or from it ==")
for name, allow in ALLOW.items():
    tot = ok = cyc = 0
    for d in D:
        g = graph(d["reasons"], allow)
        tokens = {n for n in set(g) | {c for v in g.values() for c in v} if str(n).startswith("token:")}
        und = collections.defaultdict(set)
        for a, bs in g.items():
            for b in bs: und[a].add(b); und[b].add(a)
        for c in d["combos"]:
            pieces = set(c["cards"])
            if len(pieces) < 2: continue
            tot += 1
            comps = [x for x in sccs(pieces | tokens, g) if len(x & pieces) >= 2]
            if not comps: continue
            cyc += 1
            core = max(comps, key=lambda x: len(x & pieces))
            rest = pieces - core
            if all(und[p] & core for p in rest): ok += 1
    print(f"[{name}] combos {tot}: loop among pieces {cyc} ({cyc/tot:.0%}); loop + every payoff attached {ok} ({ok/tot:.0%})")
