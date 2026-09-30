# LOCAL RESEARCH ONLY (#726): loops at the ABILITY level. A cycle has to leave a card through the same
# ability it entered by (or through the card itself: cast, entering, dying, untapping), so two
# unrelated abilities of one card never close a loop between them.
import json, re, collections, itertools, runpy, io, contextlib, sys, os
with contextlib.redirect_stdout(io.StringIO()):
    L = runpy.run_path("research/combos/loops.py")
D = json.load(open("research/combos/decks.json"))
text, types, is_perm = L["text"], L["types"], L["is_perm"]
UNTAPPER, FLICKER, ETB, BOUNCE = L["UNTAPPER"], L["FLICKER"], L["ETB"], L["BOUNCE"]
TAGS = json.load(open("research/combos/tags.json"))
MV = {c["n"]: c["mv"] for d in json.load(open("research/lands/decks.json")) for c in d["cards"]}
UNLIMITED = {"repeatable", "continuous"}
SELF = "self"

# THE FIXES FROM THE 2026-09-30 TAG WORK (#726 comments), each switchable so its effect is measured
# on its own: FIXES=none python3 research/combos/abil.py reproduces the regex detector.
FIXES = set((os.environ.get("FIXES") or "cost,reduce,bounce,return,land,subject,cast,copyloop,top").split(","))
# A RETURN THAT MARKS WHAT IT RETURNS happens once per creature: a finality counter exiles it next time
# (Meathook Massacre II), a flying counter takes it out of "without flying" (Luminous Broodmoth). The
# tags do not say so yet, so it is read off the text.
ONCE_PER_OBJECT = re.compile(r"with a (finality|flying) counter")
CH = json.load(open("research/combos/chars.json")) if os.path.exists("research/combos/chars.json") else {}

def ab(n):
    # A DELAYED RETURN cannot turn a loop inside one turn (tag: `delayedUntil`, #801), and an instant's
    # or sorcery's non-cast abilities happen once (tag `repeats`, #803). The text workarounds for both
    # are gone: the tags now say it.
    return [({**a, "rep": "delayed"} if a.get("delayed") or a.get("until") else a) for a in (TAGS.get(n) or [])]
def mana_of(cost):
    if not cost: return 0
    c = cost.lower()
    return sum(int(x) for x in re.findall(r"\{(\d+)\}", c)) + len(re.findall(r"\{[wubrgc]\}", c))
def generic_of(cost):
    return sum(int(x) for x in re.findall(r"\{(\d+)\}", cost or ""))
def amount(a):
    m = re.search(r"\d+", a.get("amt") or "")
    return int(m.group()) if m else 1
def fits(sb, y):
    """Does card y answer a subject's class -- type, subtype, colour, legendary -- by its printed characteristics?"""
    ch = CH.get(y, {})
    if not ch or not sb: return bool(ch)
    ty = sb.get("type"); ty = ty if isinstance(ty, list) else [ty] if ty else []
    if ty and not any(t in ("permanent", "spell", "card") or t in ch.get("types", []) for t in ty): return False
    if "spell" in ty and ch.get("types") == ["land"]: return False
    nt = sb.get("notType") or []
    if any(t in ch.get("types", []) for t in nt): return False
    st = sb.get("subtype"); st = st if isinstance(st, list) else [st] if st else []
    if st and not any(t in ch.get("subtypes", []) for t in st): return False
    # "C" is COLORLESS, which a card carries as no colours at all (Mystic Forge's colorless artifacts).
    if sb.get("colors") and not set(sb["colors"]) & set(ch.get("colors", []) or ["C"]): return False
    if sb.get("legendary") and "legendary" not in ch.get("types", []): return False
    return True
def land_only(y):
    t = CH.get(y, {}).get("types", [])
    return bool(t) and all(x in ("land", "legendary", "basic", "snow") for x in t)

FROM_TOP = {}            # card that puts itself on top -> the permissions that cast it from there
TEXT = {}                # card -> its text with self-references as "~", for the rules in `good`
FROM_GRAVEYARD = set()   # cards whose recast needs no return edge: dying puts them where they are cast from

def build(d):
    C = {c["n"]: c for c in d["cards"] if not c["n"].startswith("token")}
    T = {n: text(c) for n, c in C.items()}
    TEXT.update(T)
    spell = lambda n: "instant" in types(C[n]) or "sorcery" in types(C[n])
    E = collections.defaultdict(dict)                 # node -> node -> kind
    made = {}                                         # mana node -> mana per activation
    lifecost, lifegain = {}, {}
    spend = collections.defaultdict(int)              # node -> mana it costs
    returns = set()                                   # cards some edge brings back to be cast again
    def add(a, b, k):
        if a != b: E[a].setdefault(b, k)
    def recast(y):
        # A RECAST PAYS THE CARD'S MANA COST; a land is played, never cast (CR 305.1), and a token is
        # never cast at all (CR 111.1) -- the regex detector charged both.
        if "land" in FIXES and (land_only(y) or CH.get(y, {}).get("token")): return False
        spend[(y, SELF)] = max(spend[(y, SELF)], mana_of(CH.get(y, {}).get("cost")) if "cost" in FIXES and CH.get(y) else int(round(MV.get(y, 1) or 1)))
        returns.add(y)
        return True
    for n in C:
        A = ab(n)
        for i, a in enumerate(A):
            node = (n, i)
            P = a.get("pay") or {}
            cost = (a["cost"] or "").lower()
            if "cost" in FIXES:
                if a["k"] == "activated" and a["rep"] in UNLIMITED and mana_of(P.get("mana")): spend[node] = mana_of(P.get("mana"))
                if (P.get("life") or "").isdigit(): lifecost[node] = int(P["life"])
            else:
                if a["k"] == "activated" and a["rep"] in UNLIMITED and mana_of(cost): spend[node] = mana_of(cost)
                life = re.search(r"pay (\d+) life", cost)
                if life: lifecost[node] = int(life.group(1))
            if a["eff"] == "graveyard-recursion" and re.search(r"you may pay (\d+) life", T[n]):
                lifecost[node] = int(re.search(r"you may pay (\d+) life", T[n]).group(1))
            if a["eff"] in ("lifegain", "drain") and a["rep"] in UNLIMITED: lifegain[node] = amount(a)
            # THE CARD ITSELF: coming back, entering, being cast or dying re-fires its self-triggers.
            if a["k"] == "triggered" and (a["tsub"] or {}).get("self"): add((n, SELF), node, "self-trigger")
            if a["k"] == "on-cast" and spell(n): add((n, SELF), node, "cast")
            # An ability that returns its own card (Reassembling Skeleton) renews it.
            if a["eff"] == "graveyard-recursion" and a["k"] in ("activated", "triggered") and (
                    (a.get("sub") or {}).get("self") if "return" in FIXES else re.search(r"return ~ from your graveyard|return ~ to the battlefield", T[n])):
                add(node, (n, SELF), "recursion")
            if a["eff"] == "mana-generation" and a["rep"] in UNLIMITED: made[node] = amount(a)
            tapped = P.get("tap") if "cost" in FIXES else "{t}" in cost
            if a["k"] == "activated" and tapped: add((n, SELF), node, "untapped")
            if a["eff"] == "token-generation" and re.search(r"treasure", T[n]) and a["rep"] in UNLIMITED: made[node] = 1
            # A SELF-BOUNCE (#802): Acererak returns itself to hand as it enters and is cast again.
            if "bounce" in FIXES and a["eff"] == "bounce" and (a.get("sub") or {}).get("self") and recast(n):
                add(node, (n, SELF), "bounce")
        # SENSEI'S DIVINING TOP puts itself on top of its library (a self `top-set`, #856), and a
        # `play-from-top` permission whose class it answers casts it again from there (`top` fix).
        if "top" in FIXES:
            perms = [m for m in C for b in ab(m) if b["eff"] == "play-from-top" and fits(b.get("sub"), n)]
            for i, a in enumerate(A):
                if perms and a["eff"] == "top-set" and (a.get("sub") or {}).get("self") and recast(n):
                    add((n, i), (n, SELF), "from-top"); FROM_TOP[n] = sorted(set(perms))
        # A card cast from the graveyard (Gravecrawler) comes back by being PAID FOR: dying is its return.
        if re.search(r"cast ~ from your graveyard|you may cast ~ from", T[n]):
            recast(n); FROM_GRAVEYARD.add(n)
    # TRIGGER AND COST LINKS from the matcher's own reasons, ability to ability.
    for r in d["reasons"]:
        a, b, ca, pa = r["p"], r["c"], r.get("ca"), r.get("pa")
        if a not in C or b not in C or a == b or ca is None: continue
        B = ab(b)
        if ca >= len(B): continue
        cons = B[ca]
        if cons["k"] not in ("triggered", "activated") or cons["rep"] not in UNLIMITED: continue
        src = (a, SELF) if (r.get("implied") or pa is None) else (a, pa)
        # A CAST TRIGGER heard off the card itself is its CASTING, not its entering (`cast` fix).
        heard_cast = "cast" in FIXES and src[1] == SELF and str(r.get("tag") or "").startswith("cast:")
        add(src, (b, ca), "cast-trigger" if heard_cast else "trigger" if cons["k"] == "triggered" else "cost")
    # RENEW, FODDER AND MANA LINKS.
    for x, y in itertools.permutations(C, 2):
        X, Y = ab(x), ab(y)
        for i, a in enumerate(X):
            src = (x, i)
            sb = a.get("sub") or {}
            if a["eff"] == "untap" and UNTAPPER.search(T[x]) and is_perm(C[y]) and ("subject" not in FIXES or fits(sb, y)):
                for j, b in enumerate(Y):
                    if b["k"] == "activated" and ((b.get("pay") or {}).get("tap") if "cost" in FIXES else "{t}" in (b["cost"] or "").lower()): add(src, (y, j), "untap")
            # A FLICKER reaches what its subject names; "nonland" is in the text when the subject lost it
            # (Displacer Kitten's derived subject is typeless).
            if a["eff"] == "flicker" and is_perm(C[y]) and ETB.search(T[y]) and (
                    "subject" not in FIXES or (fits(sb, y) and not (land_only(y) and "nonland" in T[x]))):
                add(src, (y, SELF), "flicker")
            # A COPY IS NOT CAST unless the copier casts it (Isochron Scepter, Mizzix's Mastery: "cast
            # the copy"): only then do the deck's cast triggers hear it (`cast` fix).
            if a["eff"] == "copy-spell" and spell(y):
                add(src, (y, SELF), "copy-cast" if "cast" in FIXES and "cast the copy" in T[x] else "copy")
            if a["eff"] == "graveyard-recursion" and "creature" in types(C[y]) and not sb.get("self"):
                if "subject" not in FIXES:
                    add(src, (y, SELF), "recursion")
                elif fits(sb, y) and not ONCE_PER_OBJECT.search(T[x]):
                    # TO HAND IS NOT BACK IN PLAY: the card must be cast again, and paid for (Evolution
                    # Witness). A return that enters says so in its emits.
                    if "enters" in a["emits"]: add(src, (y, SELF), "recursion")
                    elif recast(y): add(src, (y, SELF), "recursion-hand")
            if "bounce" in FIXES:
                # RETURNING A SPELL TO HAND (Narset's Reversal): the spell is cast again, and paid for.
                if a["eff"] == "bounce" and spell(y) and sb.get("zone") in ("stack", None) and not sb.get("self") and recast(y):
                    add(src, (y, SELF), "return-spell")
                # A BOUNCE IS A RECAST, PAID IN FULL (owner, 2026-09-30): only a repeatable one, only to
                # the cards its subject reaches.
                if (a["eff"] == "bounce" and a["rep"] in UNLIMITED and sb.get("zone") in ("battlefield", None)
                        and not sb.get("self") and sb.get("control") != "opp" and is_perm(C[y]) and fits(sb, y) and recast(y)):
                    add(src, (y, SELF), "bounce")
            else:
                if spell(y) and re.search(r"return target [^.]*spell[^.]*to (its owner's|your) hand", T[x]) and a["eff"] in ("copy-spell", ""):
                    add(src, (y, SELF), "return-spell"); spend[(y, SELF)] = max(spend[(y, SELF)], int(round(MV.get(y, 1) or 1)))
                if "leaves" in a["emits"] and BOUNCE.search(T[x]) and is_perm(C[y]):
                    add(src, (y, SELF), "bounce"); spend[(y, SELF)] = max(spend[(y, SELF)], int(round(MV.get(y, 1) or 1)))
        # A COST THAT TAPS OR SACRIFICES ANOTHER PERMANENT is paid by a piece that comes back.
        if is_perm(C[x]):
            for j, b in enumerate(Y):
                if b["k"] != "activated" or b["rep"] not in UNLIMITED: continue
                P = b.get("pay") or {}
                if "cost" in FIXES:
                    if any(fits(o["subject"], x) for o in P.get("tapOther") or [] if not o["subject"].get("self")): add((x, SELF), (y, j), "tap-fodder")
                    # A SACRIFICE COST EATS `amount` BODIES: Metalwork Colossus's "two artifacts" is not a
                    # one-body outlet.
                    if any(o["amount"] == "1" and fits(o["subject"], x) for o in P.get("sacrifice") or [] if not o["subject"].get("self")): add((x, SELF), (y, j), "fodder")
                else:
                    if re.search(r"tap an untapped", (b["cost"] or "").lower()): add((x, SELF), (y, j), "tap-fodder")
                    if re.search(r"sacrifice (a|an|another) (creature|artifact|permanent|nonland|nontoken)", (b["cost"] or "").lower()): add((x, SELF), (y, j), "fodder")
    # MANA PAYS A REPEAT. The regex detector made mana an EDGE into a card's recast, so "cast it,
    # sacrifice it for mana" closed a loop with no return at all.
    # With the `return` fix a bounced card's recast is entered only by the bounce that returns it: mana
    # still pays an activation, and still casts a card from the graveyard its death put it in
    # (Gravecrawler + Phyrexian Altar), but it is counted as a budget in `good`, not walked.
    for x in C:
        for i, a in enumerate(ab(x)):
            src = (x, i)
            if src not in made: continue
            for node in list(spend):
                if node[0] == x: continue
                if "return" in FIXES and node[1] == SELF and node[0] not in FROM_GRAVEYARD: continue
                add(src, node, "mana")
    # COST REDUCERS IN PLAY lower what a recast costs, GENERIC mana only (CR 118.7a), each only where
    # its subject reaches, and they stack (#804).
    if "reduce" in FIXES:
        reds = [(n, a["red"], a.get("sub")) for n in C for a in ab(n) if a["eff"] == "cost-reduction" and a.get("red") and a["k"] == "static"]
        for node in list(spend):
            if node[1] != SELF: continue
            cut = sum(mana_of(r["mana"]) for n, r, s in reds
                      if (node[0] == n if r.get("self") else (s and s.get("control") != "opp" and not s.get("abilityKind") and fits(s, node[0])))
                      and not re.search(r"\{[WUBRG]\}", r["mana"]))
            spend[node] -= min(cut, generic_of(CH.get(node[0], {}).get("cost")))
    else:
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

# A PAYER leaves the card alive: it hears the card (a trigger, Carnival of Souls) or taps it (Relic of
# Legends). A sacrifice outlet one hop off is no payer -- it ends the card instead of paying for it.
PAYING = {"trigger", "tap-fodder", "cost"}

def payers(cyc, E, made):
    """The cards one hop off a cycle whose mana pays for it (`return` fix): card -> mana per round."""
    on = {n for n, _ in cyc}
    out = collections.Counter()
    for n in cyc:
        for m, k in E.get(n, {}).items():
            if k in PAYING and made.get(m, 0) and m[0] not in on: out[m[0]] += made[m]
    return out

def members(cyc, E, made, spend=None):
    """What a loop is made of: its cycle's cards. A ONE-card cycle (Acererak) is no loop without a
    payer, so it is one loop per payer that covers the recast alone. A longer cycle's side mana is not
    part of its identity: Gravecrawler + Phyrexian Altar is those two cards whatever else makes mana."""
    on = frozenset(n for n, _ in cyc)
    if not ("return" in FIXES and len(on) == 1): return [on]
    card = next(iter(on))
    bases = [on | {perm} for perm in FROM_TOP[card]] if card in FROM_TOP and "from-top" in {E[cyc[k]][cyc[(k + 1) % len(cyc)]] for k in range(len(cyc))} else [on]
    need = sum((spend or {}).get(n, 0) for n in cyc)
    return [b | extra for b in bases for extra in ([set()] if need == 0 else []) + [{p} for p, g in payers(cyc, E, made).items() if g >= need]] or bases

def good(cyc, E, made, spend, lifecost=None, lifegain=None):
    cards = {n for n, _ in cyc}
    kinds = [E[cyc[k]][cyc[(k + 1) % len(cyc)]] for k in range(len(cyc))]
    # ONE CARD CAN BE THE WHOLE CYCLE when it returns itself and another card pays: Acererak enters,
    # bounces itself, and Carnival of Souls' {B} on its entry casts it again (`return` fix). Without a
    # payer off the cycle it is only a card that returns itself, which is no loop.
    need1 = sum(spend.get(n, 0) for n in cyc)
    if len(cards) < 2 and not ("return" in FIXES and {"bounce", "recursion", "recursion-hand", "from-top"} & set(kinds)
                               and (need1 == 0 or any(g >= need1 for g in payers(cyc, E, made).values()))):
        return False

    # A CARD RE-ENTERED IS NOT A CARD RE-CAST (`cast` fix): a flicker or a recursion puts it back on the
    # battlefield without casting it, so its cast triggers (Displacer Kitten's "whenever you cast a
    # noncreature spell") and its own on-cast abilities do not fire again.
    if "cast" in FIXES and any(cyc[k][1] == SELF and kinds[k] in ("cast", "cast-trigger")
                               and kinds[k - 1] in ("flicker", "recursion", "untapped", "self-trigger")
                               and cyc[k][0] not in FROM_GRAVEYARD for k in range(len(cyc))):
        return False
    # ...a copy's cast triggers do not fire unless the copier CAST it, and "when ~ enters, IF YOU CAST
    # IT" (Lutri, the Spellchaser) does not fire on a flicker.
    if "cast" in FIXES and any(cyc[k][1] == SELF and (
            (kinds[k] == "cast-trigger" and kinds[k - 1] == "copy")
            or (kinds[k] == "self-trigger" and kinds[k - 1] in ("flicker", "recursion") and "if you cast it" in TEXT.get(cyc[k][0], "")))
            for k in range(len(cyc))):
        return False
    # A COPY RESOLVES ONCE: a stack loop needs a spell to come back to hand as well.
    # ...OR a copier that RE-ENTERS on the cycle and copies FROM ITS ENTRY (`copyloop` fix): Dualcaster
    # Mage copies Ghostly Flicker, the copy flickers Dualcaster, and its ETB copies the original again,
    # still on the stack. An activated copier does not count: a flickered Isochron Scepter is a new
    # object with nothing imprinted.
    n = len(cyc)
    reenters = any(kinds[k - 1] in ("flicker", "bounce") and cyc[k][1] == SELF and kinds[k] == "self-trigger"
                   and kinds[(k + 1) % n] in ("copy", "copy-cast") for k in range(n))
    copies = "copy" in kinds or "copy-cast" in kinds
    if copies and "return-spell" not in kinds and not ("copyloop" in FIXES and reenters): return False
    if "return" in FIXES:
        # MANA IS A BUDGET, NOT A STEP: what the cycle's own abilities make, and what one hop off it makes
        # (Sol Ring tapped as it comes back untapped, Pitiless Plunderer's Treasure off a death).
        near = set(cyc) | {m for n in cyc for m in E.get(n, {})}
        gain = sum(made.get(n, 0) for n in near)
    else:
        gain = sum(made.get(n, 0) for n in cyc if E[n].get(cyc[(cyc.index(n) + 1) % len(cyc)]) == "mana")
    # A RECAST IS PAID ONLY WHEN THE CYCLE CASTS THE CARD: entered by a bounce, a returned spell, a
    # return to hand, or the mana that casts it from the graveyard. A flicker or a battlefield return
    # puts it back for free -- Dualcaster Mage was charged its own mana cost each time Ghostly Flicker
    # blinked it, because something else in the deck can bounce it.
    if "return" in FIXES:
        cost = sum(spend.get(n, 0) for k, n in enumerate(cyc)
                   if n[1] != SELF or kinds[k - 1] in ("bounce", "return-spell", "recursion-hand", "mana", "from-top"))
    else:
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
        loops = {m for c in cycles(E, kmax) if good(c, E, made, spend, lc, lg) for m in members(c, E, made, spend)}
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
