# LOCAL RESEARCH ONLY (#726): loops at the ABILITY level. A cycle has to leave a card through the same
# ability it entered by (or through the card itself: cast, entering, dying, untapping), so two
# unrelated abilities of one card never close a loop between them.
import json, re, collections, itertools, runpy, io, contextlib, sys
with contextlib.redirect_stdout(io.StringIO()):
    L = runpy.run_path("research/combos/loops.py")
D = json.load(open("research/combos/decks.json"))
text, types, is_perm = L["text"], L["types"], L["is_perm"]
UNTAPPER, FLICKER, ETB, BOUNCE = L["UNTAPPER"], L["FLICKER"], L["ETB"], L["BOUNCE"]
TAGS = json.load(open("research/combos/tags.json"))
MV = {c["n"]: c["mv"] for d in json.load(open("research/lands/decks.json")) for c in d["cards"]}
UNLIMITED = {"repeatable", "continuous"}
CARD_TEXT = {c["n"]: (c.get("o") or "").lower() for d in D for c in d["cards"]}
CARD_TYPE = {c["n"]: (c.get("t") or "").lower().split("//")[0] for d in D for c in d["cards"]}
SELF = "self"

def ab(n):
    # A DELAYED TRIGGER ("at the beginning of the next end step") cannot turn a loop inside one turn:
    # it is kept at its index so the matcher's ability numbers still line up, and never linked.
    # The tagger misses some (Shirei, Shizo's Caretaker), so a return "at the beginning of the next end
    # step" in the card's own text marks its returning abilities delayed too.
    late = re.search(r"(at the beginning of the next end step|at the beginning of your next upkeep)", (CARD_TEXT.get(n) or ""))
    # AN INSTANT OR SORCERY IS GONE ONCE IT RESOLVES: what it sets up (Undying Malice's "when that
    # creature dies this turn") happens once, unless the spell itself is cast again.
    spell = re.search(r"\b(instant|sorcery)\b", CARD_TYPE.get(n, ""))
    return [({**a, "rep": "delayed"} if a.get("delayed") or (late and a["eff"] in ("graveyard-recursion", "flicker"))
             else {**a, "rep": "once"} if spell and a["k"] != "on-cast" else a)
            for a in (TAGS.get(n) or [])]
def mana_of(cost):
    if not cost: return 0
    c = cost.lower()
    return sum(int(x) for x in re.findall(r"\{(\d+)\}", c)) + len(re.findall(r"\{[wubrgc]\}", c))
def amount(a):
    m = re.search(r"\d+", a.get("amt") or "")
    return int(m.group()) if m else 1

def build(d):
    C = {c["n"]: c for c in d["cards"] if not c["n"].startswith("token")}
    T = {n: text(c) for n, c in C.items()}
    spell = lambda n: "instant" in types(C[n]) or "sorcery" in types(C[n])
    E = collections.defaultdict(dict)                 # node -> node -> kind
    made = {}                                         # mana node -> mana per activation
    lifecost, lifegain = {}, {}
    spend = collections.defaultdict(int)              # node -> mana it costs
    def add(a, b, k):
        if a != b: E[a].setdefault(b, k)
    for n in C:
        A = ab(n)
        for i, a in enumerate(A):
            node = (n, i)
            cost = (a["cost"] or "").lower()
            if a["k"] == "activated" and a["rep"] in UNLIMITED and mana_of(cost): spend[node] = mana_of(cost)
            # LIFE IS A COST TOO, and nothing pays it back unless the loop gains life.
            life = re.search(r"pay (\d+) life", cost) or (a["eff"] == "graveyard-recursion" and re.search(r"you may pay (\d+) life", T[n]))
            if life: lifecost[node] = int(life.group(1))
            if a["eff"] in ("lifegain", "drain") and a["rep"] in UNLIMITED: lifegain[node] = amount(a)
            # THE CARD ITSELF: coming back, entering, being cast or dying re-fires its self-triggers,
            # whatever their once-per-object cap says -- a new object is a new "once".
            if a["k"] == "triggered" and (a["tsub"] or {}).get("self"): add((n, SELF), node, "self-trigger")
            if a["k"] == "on-cast" and spell(n): add((n, SELF), node, "cast")
            # An ability that returns its own card (Reassembling Skeleton) renews it.
            if a["eff"] == "graveyard-recursion" and a["k"] in ("activated", "triggered") and re.search(r"return ~ from your graveyard|return ~ to the battlefield", T[n]):
                add(node, (n, SELF), "recursion")
            if a["eff"] == "mana-generation" and a["rep"] in UNLIMITED:
                made[node] = amount(a)
            # A {T} ability runs again when the card untaps.
            if a["k"] == "activated" and "{t}" in cost: add((n, SELF), node, "untapped")
            # Treasure made on a trigger pays like mana.
            if a["eff"] == "token-generation" and re.search(r"treasure", T[n]) and a["rep"] in UNLIMITED: made[node] = 1
        # A card cast from the graveyard (Gravecrawler) comes back by being PAID FOR.
        if re.search(r"cast ~ from your graveyard|you may cast ~ from", T[n]):
            spend[(n, SELF)] = int(round(MV.get(n, 1) or 1))
    # TRIGGER AND COST LINKS from the matcher's own reasons, ability to ability.
    for r in d["reasons"]:
        a, b, ca, pa = r["p"], r["c"], r.get("ca"), r.get("pa")
        if a not in C or b not in C or a == b or ca is None: continue
        B = ab(b)
        if ca >= len(B): continue
        cons = B[ca]
        if cons["k"] not in ("triggered", "activated") or cons["rep"] not in UNLIMITED: continue
        src = (a, SELF) if (r.get("implied") or pa is None) else (a, pa)
        add(src, (b, ca), "trigger" if cons["k"] == "triggered" else "cost")
    # RENEW, FODDER AND MANA LINKS.
    for x, y in itertools.permutations(C, 2):
        X, Y = ab(x), ab(y)
        for i, a in enumerate(X):
            src = (x, i)
            if a["eff"] == "untap" and UNTAPPER.search(T[x]) and is_perm(C[y]):
                for j, b in enumerate(Y):
                    if b["k"] == "activated" and "{t}" in (b["cost"] or "").lower(): add(src, (y, j), "untap")
            if a["eff"] == "flicker" and is_perm(C[y]) and ETB.search(T[y]): add(src, (y, SELF), "flicker")
            if a["eff"] == "copy-spell" and spell(y): add(src, (y, SELF), "copy")
            if a["eff"] == "graveyard-recursion" and "creature" in types(C[y]) and not re.search(r"return ~", T[x]): add(src, (y, SELF), "recursion")
            # RETURNING A SPELL TO HAND (Narset's Reversal) is what lets a stack loop go round: the spell
            # is cast again, and paid for again.
            if spell(y) and re.search(r"return target [^.]*spell[^.]*to (its owner's|your) hand", T[x]) and a["eff"] in ("copy-spell", ""):
                add(src, (y, SELF), "return-spell"); spend[(y, SELF)] = max(spend[(y, SELF)], int(round(MV.get(y, 1) or 1)))
            if "leaves" in a["emits"] and BOUNCE.search(T[x]) and is_perm(C[y]):
                add(src, (y, SELF), "bounce"); spend[(y, SELF)] = max(spend[(y, SELF)], int(round(MV.get(y, 1) or 1)))
            if src in made:
                for j, b in enumerate(Y):
                    if (y, j) in spend: add(src, (y, j), "mana")
                if (y, SELF) in spend: add(src, (y, SELF), "mana")
        # A COST THAT TAPS ANOTHER PERMANENT (Relic of Legends: "Tap an untapped legendary creature you
        # control") is paid by a piece that comes back untapped.
        if is_perm(C[x]):
            for j, b in enumerate(Y):
                if b["k"] == "activated" and b["rep"] in UNLIMITED and re.search(r"tap an untapped", (b["cost"] or "").lower()):
                    add((x, SELF), (y, j), "tap-fodder")
        # FODDER: the card itself is the cost of an unlimited sacrifice outlet.
        if is_perm(C[x]):
            for j, b in enumerate(Y):
                if b["k"] == "activated" and b["rep"] in UNLIMITED and re.search(r"sacrifice (a|an|another) (creature|artifact|permanent|nonland|nontoken)", (b["cost"] or "").lower()):
                    add((x, SELF), (y, j), "fodder")
    # COST REDUCERS IN PLAY lower what a recast costs (Heartless Summoning, Urza's Incubator), never
    # below zero; the reduction is read off the reducer's text, 1 when it names no number.
    cut = 0
    for n in C:
        for a in ab(n):
            if a["eff"] == "cost-reduction" and a["k"] == "static":
                m = re.search(r"cost[s]? \{(\d+)\} less", T[n]); cut = max(cut, int(m.group(1)) if m else 1)
    for node in list(spend):
        if node[1] == SELF: spend[node] = max(0, spend[node] - cut)
    return E, made, spend, lifecost, lifegain

def cycles(E, kmax=6, cap=200000):
    out = []
    nodes = sorted(E, key=str)
    rank = {n: i for i, n in enumerate(nodes)}
    def walk(path, seen):
        if len(out) >= cap: return
        for nxt in E.get(path[-1], {}):
            if nxt == path[0] and len(path) >= 2: out.append(tuple(path))
            elif nxt not in seen and len(path) < kmax and rank.get(nxt, -1) > rank[path[0]]:
                seen.add(nxt); walk(path + [nxt], seen); seen.discard(nxt)
    for s in nodes: walk([s], {s})
    return out

def good(cyc, E, made, spend, lifecost=None, lifegain=None):
    cards = {n for n, _ in cyc}
    if len(cards) < 2: return False
    kinds = [E[cyc[k]][cyc[(k + 1) % len(cyc)]] for k in range(len(cyc))]
    # A COPY RESOLVES ONCE: a stack loop needs a spell to come back to hand as well.
    if "copy" in kinds and "return-spell" not in kinds: return False
    gain = sum(made.get(n, 0) for n in cyc if E[n].get(cyc[(cyc.index(n) + 1) % len(cyc)]) == "mana")
    cost = sum(spend.get(n, 0) for n in cyc)
    life_out = sum((lifecost or {}).get(n, 0) for n in cyc)
    # A PAYOFF THE LOOP FEEDS pays its costs too: Blood Artist's lifegain covers Warren Soultrader's
    # "pay 1 life" each time round.
    fed = {m for n in cyc for m in E.get(n, {}) if m not in cyc and m[1] != SELF}
    life_in = sum((lifegain or {}).get(n, 0) for n in list(cyc) + list(fed))
    return gain >= cost and life_in >= life_out

if __name__ == "__main__":
    kmax = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    tk = fk = tf = inside = 0; per = []; fp = []
    for d in D:
        E, made, spend, lc, lg = build(d)
        loops = {frozenset(n for n, _ in c) for c in cycles(E, kmax) if good(c, E, made, spend, lc, lg)}
        known = [set(c["cards"]) for c in d["combos"] if len(c["cards"]) >= 2]
        tf += len(loops); ins = [s for s in loops if any(s <= k or k <= s for k in known)]; inside += len(ins)
        for k in known:
            tk += 1; fk += any(s <= k for s in loops)
        per.append((d["id"], len(loops), len(ins), len(known)))
        fp += [(d["id"], sorted(s)) for s in loops if s not in ins][:3]
    print(f"RECALL {fk}/{tk} ({fk/tk:.0%})   PRECISION {inside}/{tf} ({inside/max(tf,1):.0%})")
    nc = [p for p in per if p[3] == 0]
    print(f"decks without a Spellbook combo: {len(nc)}, loops found in them {sum(p[1] for p in nc)}")
    for p in sorted(per, key=lambda p: -p[1])[:6]: print("  ", p)
    for x in fp[:15]: print("   not a known combo:", x)
