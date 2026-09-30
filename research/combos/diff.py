# LOCAL RESEARCH ONLY (#726): which Spellbook combos one FIXES set of abil.py finds and another does not.
import json, runpy, io, contextlib, os, sys
def run(fixes):
    os.environ["FIXES"] = fixes
    with contextlib.redirect_stdout(io.StringIO()):
        M = runpy.run_path("research/combos/abil.py", run_name="x")
    return M
D = json.load(open("research/combos/decks.json"))
def found(M):
    out = set()
    for d in D:
        E, made, spend, lc, lg = M["build"](d)
        loops = {m for c in M["cycles"](E, 6) if M["good"](c, E, made, spend, lc, lg) for m in M["members"](c, E, made, spend)}
        for k in d["combos"]:
            if len(k["cards"]) >= 2 and any(s <= set(k["cards"]) for s in loops): out.add((d["id"], tuple(sorted(k["cards"]))))
    return out
a, b = found(run(sys.argv[1])), found(run(sys.argv[2]))
for x in sorted(a - b): print("LOST", x)
for x in sorted(b - a): print("GAINED", x)
