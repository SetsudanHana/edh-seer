# LOCAL RESEARCH ONLY (#726): loops held to the owner's rules (2026-09-05): every step repeatable,
# each iteration's cost paid by the loop's own production, and something gained.
import json, re, collections, itertools, runpy, io, contextlib
with contextlib.redirect_stdout(io.StringIO()):
    L = runpy.run_path("research/combos/loops.py")
D = L["D"]; text = L["text"]; types = L["types"]; is_perm = L["is_perm"]
RECURS, UNTAPPER, STACK, FLICKER, ETB, BOUNCE = L["RECURS"], L["UNTAPPER"], L["STACK"], L["FLICKER"], L["ETB"], L["BOUNCE"]
TAGS = json.load(open("research/combos/tags.json"))

UNLIMITED = {"repeatable", "continuous"}

def abilities(n): return TAGS.get(n) or []
def mana_of(cost):
    """Mana a cost string asks for: generic digits plus coloured pips; X counts as 0."""
    if not cost: return 0
    return sum(int(x) for x in re.findall(r"\{(\d+)\}", cost)) + len(re.findall(r"\{[wubrgc]\}", cost.lower()))
def amount(a):
    m = re.search(r"\d+", a.get("amt") or "")
    return int(m.group()) if m else 1

def free_mana(n, t):
    """Mana this card makes each time round WITHOUT tapping itself: a sac outlet, a trigger, Treasure."""
    out = 0
    for a in abilities(n):
        if a["eff"] == "mana-generation" and a["rep"] in UNLIMITED and "{t}" not in (a["cost"] or "").lower():
            out = max(out, amount(a))
    if re.search(r"create (a|one|x|that many)? ?treasure", t) and re.search(r"whenever", t): out = max(out, 1)
    return out

def tap_mana(n, t):
    m = re.search(r"\{t\}[^:]*: add ((\{[wubrgc]\})+|(one|two|three) mana)", t)
    if not m: return 0
    return len(re.findall(r"\{[wubrgc]\}", m.group(1))) or {"one": 1, "two": 2, "three": 3}.get(m.group(3) or "", 1)

def strict_graph(d):
    C = {c["n"]: c for c in d["cards"] if not c["n"].startswith("token")}
    T = {n: text(c) for n, c in C.items()}
    names = list(C)
    spell = lambda n: "instant" in types(C[n]) or "sorcery" in types(C[n])
    repeats = lambda n: any(a["rep"] in UNLIMITED for a in abilities(n))
    edges = collections.defaultdict(dict)       # a -> b -> {"kind", "cost": mana spent at b, "gain": mana made at a}
    def add(a, b, kind):
        if a != b and kind not in edges[a].get(b, {}).get("kinds", set()):
            edges[a].setdefault(b, {"kinds": set()})["kinds"].add(kind)
    renewed = {n: set() for n in names}
    for n in names:
        if RECURS.search(T[n]): renewed[n].add("recurs")
    # RENEW STEPS, only from an ability that can repeat.
    for a, b in itertools.permutations(names, 2):
        ta, tb = T[a], T[b]
        can = repeats(a) or spell(a)
        if not can: continue
        if UNTAPPER.search(ta) and re.search(r"\{t\}[^:]*:", tb) and is_perm(C[b]): add(a, b, "untap"); renewed[b].add("untap")
        if STACK.search(ta) and spell(b): add(a, b, "stack"); renewed[b].add("stack")
        if FLICKER.search(ta) and is_perm(C[b]) and ETB.search(tb): add(a, b, "flicker"); renewed[b].add("flicker")
        if BOUNCE.search(ta) and is_perm(C[b]): add(a, b, "bounce"); renewed[b].add("bounce")
        if ETB.search(ta) and STACK.search(ta) and spell(b): add(a, b, "stack")
    # TRIGGER STEPS: the consumer's triggered ability repeats without a cap, and the producer can
    # make the event again (it repeats on its own, or something in the loop renews it).
    for r in d["reasons"]:
        a, b, ca = r["p"], r["c"], r.get("ca")
        if a not in C or b not in C or a == b or ca is None: continue
        ab = abilities(b)
        if ca >= len(ab): continue
        cons = ab[ca]
        if cons["k"] != "triggered" or cons["rep"] not in UNLIMITED: continue
        if r["rep"] == "oneshot" and not renewed[a]: continue
        add(a, b, "trigger")
    # ACTIVATED STEPS: another piece pays the cost.
    for a, b in itertools.permutations(names, 2):
        for ab in abilities(b):
            if ab["k"] != "activated" or ab["rep"] not in UNLIMITED: continue
            cost = (ab["cost"] or "").lower()
            if re.search(r"sacrifice (a|an|another) (creature|artifact|permanent|nonland|nontoken)", cost) and renewed[a] and is_perm(C[a]):
                add(a, b, "fodder")
            if mana_of(cost) and (free_mana(a, T[a]) or (renewed[a] and tap_mana(a, T[a]))):
                add(a, b, "mana")
        # MANA for a recast: the piece comes back by being CAST (graveyard cast, bounce to hand).
        if (free_mana(a, T[a]) or (renewed[a] and tap_mana(a, T[a]))) and (renewed[b] & {"recurs", "bounce"}):
            add(a, b, "mana")
    return edges, renewed, C, T

def cycles(edges, kmax=4):
    out = set()
    def walk(path):
        last = path[-1]
        for nxt in edges.get(last, {}):
            if nxt == path[0] and len(path) >= 2: out.add(tuple(path))
            elif nxt not in path and len(path) < kmax and nxt > path[0]: walk(path + [nxt])
    for s in edges: walk([s])
    return out

def balanced(cyc, edges, renewed, C, T):
    """Mana made each time round covers the mana spent: recasts at their mana value, activations at
    their cost. Colour ignored. A loop that spends nothing is balanced by definition."""
    made = spent = 0
    for i, a in enumerate(cyc):
        b = cyc[(i + 1) % len(cyc)]
        kinds = edges[a][b]["kinds"]
        if "mana" in kinds:
            made += free_mana(a, T[a]) or tap_mana(a, T[a])
            recast = renewed[b] & {"recurs", "bounce"}
            act = [mana_of(x["cost"]) for x in abilities(b) if x["k"] == "activated" and x["rep"] in UNLIMITED and mana_of(x["cost"])]
            # A recast's price is unknown here (no mana value in this data): priced at 1, the cheapest.
            spent += min(act) if act else (1 if recast else 0)
    return made >= spent

if __name__ == "__main__":
    tot_known = found_known = 0
    tot_found = in_known = 0
    per = []
    miss = []
    for d in D:
        edges, renewed, C, T = strict_graph(d)
        cyc = [c for c in cycles(edges) if balanced(c, edges, renewed, C, T)]
        sets = {frozenset(c) for c in cyc}
        known = [set(c["cards"]) for c in d["combos"] if len(c["cards"]) >= 2]
        tot_found += len(sets)
        in_known += sum(1 for s in sets if any(s <= k for k in known))
        for k in known:
            tot_known += 1
            if any(s <= k and len(s) >= 2 for s in sets): found_known += 1
            else: miss.append((d["id"], sorted(k)))
        per.append((d["id"], len(sets), len(known)))
    print(f"RECALL: known combos with a loop inside them {found_known}/{tot_known} ({found_known/tot_known:.0%})")
    print(f"PRECISION: loops found {tot_found}, inside a known combo {in_known} ({in_known/max(tot_found,1):.0%})")
    nc = [p for p in per if p[2] == 0]
    print(f"decks without a Spellbook combo: {len(nc)}, loops in them: {sum(p[1] for p in nc)}")
    for p in sorted(per, key=lambda p: -p[1])[:8]: print("  ", p)
    json.dump(miss, open("research/combos/strict-miss.json", "w"))
