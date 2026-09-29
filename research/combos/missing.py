# LOCAL RESEARCH ONLY (#726): which edges between a combo's pieces our graph lacks, by the mechanism
# the oracle text says connects them. Spellbook's own step descriptions are not reachable from here.
import json, re, collections, itertools

D = json.load(open("research/combos/decks.json"))
card = {}
for d in D:
    for c in d["cards"]: card[c["n"]] = c
has = collections.defaultdict(set)           # (deck, producer, consumer) -> tags
for d in D:
    for r in d["reasons"]:
        if r["p"] and r["c"]: has[(d["id"], r["p"], r["c"])].add(r["tag"])

T = lambda n: (card.get(n, {}).get("t") or "").lower()
O = lambda n: (card.get(n, {}).get("o") or "").lower().replace(card.get(n, {}).get("n", "").lower(), "~")
is_ = lambda n, w: re.search(rf"\b{w}\b", T(n).split("//")[0]) is not None
PERM = lambda n: any(is_(n, w) for w in ["creature", "artifact", "enchantment", "planeswalker", "land"])

def links(a, b):
    """What A does to or for B, read off the text. Each rule names a mechanism a loop runs on."""
    oa, ob = O(a), O(b)
    out = []
    if re.search(r"copy (target|that|it|each|the next)[^.]*(spell|instant|sorcery)|magecraft", oa) and (is_(b, "instant") or is_(b, "sorcery")):
        out.append("copies a spell")
    if re.search(r"return target [^.]*spell[^.]*to (its owner's|your) hand|return (it|that spell) to its owner's hand", oa) and (is_(b, "instant") or is_(b, "sorcery")):
        out.append("returns a spell to hand")
    if re.search(r"(exile|blink|flicker)[^.]*(then )?return[^.]*to the battlefield|exile (up to one |two )?target[^.]*creature[^.]*return", oa) and PERM(b) and re.search(r"when(ever)? ~ enters|enters the battlefield|when ~ enters", ob):
        out.append("flickers an ETB permanent")
    if re.search(r"(sacrifice (a|an|another) (creature|artifact|permanent|nonland))", oa) and (is_(b, "creature") or is_(b, "artifact")):
        out.append("sacrifices it (outlet)")
    if re.search(r"(return|cast|put)[^.]*~[^.]*from your graveyard|~ can't block|you may cast ~ from your graveyard|persist|undying|return ~ to the battlefield", ob) and re.search(r"sacrifice (a|an|another)", oa):
        out.append("outlet for a self-recurring card")
    if re.search(r"untap (target|another|all|each|up to)[^.]*(artifact|creature|permanent|land)", oa) and re.search(r"\{t\}", ob) and PERM(b):
        out.append("untaps a tapper")
    if re.search(r"add \{|add (one|two|three|x) mana|mana of any", oa) and (re.search(r"\{[0-9x]\}[^:]*:", ob) or re.search(r"cast ~ from|return ~ to (its owner's|your) hand", ob)):
        out.append("mana pays a repeatable cost")
    if re.search(r"return (target|another|up to)[^.]*(permanent|creature|artifact|nonland)[^.]*to (its owner's|your) hand|whenever you cast[^.]*return", oa) and PERM(b):
        out.append("bounces for a recast")
    if re.search(r"whenever [^.]*(dies|is put into a graveyard)", oa) and (is_(b, "creature") or "token" in ob):
        out.append("death trigger fed by it")
    if re.search(r"whenever [^.]*enters", oa) and (PERM(b) and re.search(r"create|return|put[^.]*onto the battlefield", ob)):
        out.append("ETB trigger fed by it")
    if re.search(r"whenever you (gain|lose) life|whenever an opponent loses life", oa) and re.search(r"(gain|lose|loses) [0-9x]+ life|lifelink", ob):
        out.append("life trigger fed by it")
    if re.search(r"(costs? \{?[0-9]\}? less|cost \{?[0-9]\}? less|without paying)", oa):
        out.append("cost reduction / free cast")
    if re.search(r"(put|remove) [^.]*counter|proliferate", oa) and re.search(r"counter", ob):
        out.append("counters")
    if re.search(r"copy of|token that's a copy|create[^.]*copy", oa) and PERM(b):
        out.append("copies a permanent")
    if re.search(r"whenever you cast", oa) and not PERM(b) or re.search(r"whenever you cast (a|an|your)", oa):
        out.append("cast trigger fed by it")
    return out

pairs = total = 0
miss_by = collections.Counter(); have_by = collections.Counter(); unexplained = 0
combo_close = collections.Counter()          # mechanisms whose addition closes a combo
per_combo = []
seen = set()
for d in D:
    for c in d["combos"]:
        pieces = c["cards"]
        if len(pieces) < 2: continue
        key = tuple(sorted(pieces))
        if key in seen: continue
        seen.add(key); total += 1
        missing_here = set(); ok_edges = set()
        for a, b in itertools.permutations(pieces, 2):
            L = links(a, b)
            if has[(d["id"], a, b)]: ok_edges.add((a, b))
            for m in L:
                # A TRIGGER FED BY B is an edge FROM B (the producer) TO A; an outlet's edge may run
                # either way (the fodder is the producer in `fodderEdges`).
                if "fed by it" in m: edge = bool(has[(d["id"], b, a)])
                elif "outlet" in m or "sacrifices" in m: edge = bool(has[(d["id"], a, b)] or has[(d["id"], b, a)])
                else: edge = bool(has[(d["id"], a, b)])
                pairs += 1
                (have_by if edge else miss_by)[m] += 1
                if not edge: missing_here.add(m)
        if not missing_here and len(ok_edges) == 0: unexplained += 1
        per_combo.append((key, c["result"][:60], sorted(missing_here), len(ok_edges)))
        for m in missing_here: combo_close[m] += 1

print(f"{total} distinct combos, {pairs} (pair, mechanism) readings\n")
print(f"{'mechanism':34s} {'edge missing':>12s} {'edge present':>13s} {'combos it touches':>18s}")
for m in sorted(set(miss_by) | set(have_by), key=lambda m: -miss_by[m]):
    print(f"{m:34s} {miss_by[m]:12d} {have_by[m]:13d} {combo_close[m]:18d}")
print(f"\ncombos where no rule reads any link and the graph has none: {unexplained}")
json.dump(per_combo, open("research/combos/missing-per-combo.json", "w"))
