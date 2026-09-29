# LOCAL RESEARCH ONLY (#726): a LOOP LAYER over the synergy graph, and its recall against Spellbook.
#
# The synergy graph says what one card does for another. A loop also needs to know what a repeat
# COSTS and what pays for it, which the graph never recorded. Four edge kinds are added here, read off
# printed text, and one promotion:
#   - mana:    a card that makes mana without tapping itself (a sac outlet, a trigger, Treasure)
#              pays for a card whose repeat costs mana (a recursion cost, an activated ability, a recast)
#   - recast:  a card that can come back (cast from graveyard, return itself, persist/undying) makes
#              its own entering, casting and dying REPEATABLE, so its once-only edges are promoted
#   - untap:   a card that untaps a permanent feeds anything with a {T} ability
#   - stack:   a card that copies or returns a spell feeds the instants and sorceries it can target
import json, re, collections, itertools

D = json.load(open("research/combos/decks.json"))

def card_index(d):
    return {c["n"]: c for c in d["cards"]}

SELF = re.compile(r"\bthis (card|creature|artifact|enchantment|permanent|spell|land|planeswalker)\b")
def text(c):
    o = (c.get("o") or "").lower()
    o = o.replace(c["n"].lower(), "~").replace(c["n"].split(",")[0].lower(), "~")
    return SELF.sub("~", o)

def types(c):
    return (c.get("t") or "").lower().split("//")[0]

def is_perm(c):
    return any(w in types(c) for w in ("creature", "artifact", "enchantment", "planeswalker", "land"))

RECURS = re.compile(
    r"cast ~ from your graveyard|return ~ from your graveyard|return ~ to (its owner's|your) hand|"
    r"\bpersist\b|\bundying\b|return ~ to the battlefield|~ returns to the battlefield|"
    r"put ~ (on|onto) (the battlefield|top of)|escape—|\bencore\b|you may cast [^.]*from your graveyard")
FREE_MANA = re.compile(
    r"sacrifice (a|an|another)[^:]*: add|whenever [^.]*, add \{|create (a|an|x|one|two|that many)? ?treasure|"
    r"whenever [^.]*(dies|enters|is put into)[^.]*add")
MANA_COST_REPEAT = re.compile(r"\{[0-9xwubrgc]\}[^:\n]*:")
UNTAPPER = re.compile(r"untap (target|another|up to|all|each|two|that)[^.]*(artifact|creature|permanent|land|nonland)")
STACK = re.compile(r"copy (target|that|it|each)[^.]*(spell|instant|sorcery)|return target [^.]*spell[^.]*to (its owner's|your) hand|copy target instant or sorcery")
FLICKER = re.compile(r"exile [^.]*(creature|permanent|artifact)[^.]*(then )?return (it|them|that card|those cards)")
ETB = re.compile(r"when(ever)? ~ enters|when ~ enters the battlefield|enters the battlefield, ")

BOUNCE = re.compile(r"return (target|up to one target|another target|each)[^.]*(nonland permanent|permanent|artifact|creature|spell)[^.]*to (its owner's|their owners'|your) hand")
OUTLET = re.compile(r"sacrifice (a|an|another) (creature|artifact|permanent|nonland permanent|nontoken creature)[^:]*:")
CAST_TRIGGER = re.compile(r"whenever you cast (a|an|your)([^.,]*?)spell")
DIES_TRIGGER = re.compile(r"whenever (a|another|one or more)[^.]*(creature|permanent)[^.]*(dies|is put into a graveyard)")
ENTERS_TRIGGER = re.compile(r"whenever (a|another|one or more)[^.]*(creature|permanent|artifact)[^.]*enters")

def loop_graph(d, promote=True, extra=True):
    C = card_index(d)
    T = {n: text(c) for n, c in C.items()}
    g = collections.defaultdict(set)
    kinds = collections.defaultdict(set)
    def add(a, b, k):
        if a != b: g[a].add(b); kinds[(a, b)].add(k)
    names = list(C)
    spell = lambda n: "instant" in types(C[n]) or "sorcery" in types(C[n])
    # WHAT MAKES A PIECE REPEAT: it recurs on its own, or another piece bounces, flickers, copies or
    # untaps it. Its once-only edges then fire every time round.
    renewed_by = collections.defaultdict(set)
    if extra:
        for a, b in itertools.permutations(names, 2):
            ta, tb = T[a], T[b]
            if UNTAPPER.search(ta) and "{t}" in tb and is_perm(C[b]): add(a, b, "untap"); renewed_by[b].add("untap")
            if STACK.search(ta) and spell(b): add(a, b, "stack"); renewed_by[b].add("stack")
            if FLICKER.search(ta) and is_perm(C[b]) and ETB.search(tb): add(a, b, "flicker"); renewed_by[b].add("flicker")
            if BOUNCE.search(ta) and is_perm(C[b]): add(a, b, "bounce"); renewed_by[b].add("bounce")
    recurs = {n for n in names if RECURS.search(T[n])}
    renewed = recurs | set(renewed_by)
    for r in d["reasons"]:
        p, c = r["p"], r["c"]
        if not p or not c or p == c: continue
        if r["rep"] == "oneshot" and not (promote and p in renewed): continue
        add(p, c, "synergy" if r["rep"] != "oneshot" else "renewed")
    if extra:
        for a, b in itertools.permutations(names, 2):
            ta, tb = T[a], T[b]
            # MANA without tapping itself pays for a repeat that costs mana.
            if FREE_MANA.search(ta) and (b in renewed or MANA_COST_REPEAT.search(tb)): add(a, b, "mana")
            # A tapped mana source that is renewed (untapped, bounced and recast) pays too.
            if a in renewed and re.search(r"\{t\}[^:]*: add", ta) and (b in renewed or MANA_COST_REPEAT.search(tb)): add(a, b, "mana")
            # RECURRING FODDER feeds a sacrifice outlet.
            if a in renewed and OUTLET.search(tb) and is_perm(C[a]): add(a, b, "fodder")
            # A PIECE CAST AGAIN feeds "whenever you cast"; one that dies again feeds a death trigger;
            # one that enters again feeds an entering trigger. Only renewed pieces, so an ordinary card
            # never edges to every payoff.
            if a in renewed and CAST_TRIGGER.search(tb): add(a, b, "cast")
            if a in renewed and "creature" in types(C[a]) and DIES_TRIGGER.search(tb): add(a, b, "dies")
            if a in renewed and is_perm(C[a]) and ENTERS_TRIGGER.search(tb): add(a, b, "enters")
            # A PERMANENT WHOSE ETB COPIES A SPELL (Dualcaster Mage) feeds the spell that flickered it.
            if ETB.search(ta) and STACK.search(ta) and spell(b): add(a, b, "stack")
    return g, kinds

def sccs(nodes, g):
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

def recall(**kw):
    tot = cyc = ok = 0
    for d in D:
        g, _ = loop_graph(d, **kw)
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
            if all(und[p] & core for p in pieces - core): ok += 1
    return tot, cyc, ok

if __name__ == "__main__":
    for label, kw in [("synergy only, no one-shot", dict(promote=False, extra=False)),
                      ("+ recast promotion", dict(promote=True, extra=False)),
                      ("+ mana, untap, stack, flicker edges", dict(promote=True, extra=True))]:
        tot, cyc, ok = recall(**kw)
        print(f"{label:40s} loop among pieces {cyc:3d}/{tot} ({cyc/tot:.0%})  loop + payoffs attached {ok:3d} ({ok/tot:.0%})")
