# LOCAL RESEARCH ONLY (#726): a known loop's repeated events, and every payoff in the deck that eats them.
import json, re, collections
D = json.load(open("research/combos/decks.json"))
TAGS = json.load(open("research/combos/tags.json"))
UNLIMITED = {"repeatable", "continuous"}
EVENT = [  # Spellbook result phrase -> the trigger verbs it feeds
    (r"death triggers|creature ltb|ltb", ["dies", "leaves"]),
    (r"etb", ["enters"]),
    (r"lifegain", ["gain-life"]),
    (r"lifeloss|life loss", ["lose-life"]),
    (r"sacrifice", ["sacrifice"]),
    (r"card draw|draw triggers", ["draw"]),
    (r"storm count|magecraft|cast triggers", ["cast"]),
    (r"tokens", ["create-token", "enters"]),
    (r"\+1/\+1 counters|counters", ["counter-added"]),
    (r"damage", ["damage", "damaged"]),
    (r"mill", ["mill"]),
    (r"untap", ["untaps"]),
]
tot = with_payoff = extra = 0; ex = []
for d in D:
    names = {c["n"] for c in d["cards"] if not c["n"].startswith("token")}
    for c in d["combos"]:
        if len(c["cards"]) < 2: continue
        infinite = [p.strip() for p in c["result"].lower().split(",") if "infinite" in p]
        verbs = sorted({v for p in infinite for rx, vs in EVENT if re.search(rx, p) for v in vs})
        tot += 1
        pay = sorted(n for n in names - set(c["cards"])
                     if any(a["k"] == "triggered" and a["rep"] in UNLIMITED and set(a["tv"] or []) & set(verbs)
                            and a["eff"] in ("player-life-loss", "drain", "damage", "lifegain", "draw-card", "token-generation", "counter-placement", "mill")
                            for a in TAGS.get(n) or []))
        if pay: with_payoff += 1; extra += len(pay)
        if pay and len(ex) < 8: ex.append((d["id"], " + ".join(c["cards"]), verbs, pay[:6]))
print(f"{tot} known combos in the 71 decks; {with_payoff} ({with_payoff/tot:.0%}) have payoffs elsewhere in the deck, {extra} payoff cards in all")
for e in ex: print("  ", e)
