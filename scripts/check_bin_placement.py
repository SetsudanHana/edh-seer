#!/usr/bin/env python3
"""Every script lives in the home that matches what it is FOR.

Settled 2026-09-07 (roadmap Z3/Z4, PRs #221 and #223) and documented in CLAUDE.md:

    packages/*/src/bin/     pipeline   - writes Mongo or a tracked artifact the product ships,
                                         or is a module with a test
    packages/instruments/   scoring    - judges the engine's output; its tests run in `npm test`
    research/<package>/     one-shot   - a census, sweep, audit, dump or probe that PRINTS
                                         and that nothing imports

`src/bin` went 110 files to 53 on that split. Without a gate it goes back: a new census dropped
into `packages/matcher/src/bin` merges green, and the rule becomes a paragraph nobody reads.

TWO DIRECTIONS, because only one of them has actually bitten:

  1. A one-shot in `src/bin` is untidy.
  2. A file under `research/` with a test beside it is WORSE THAN UNTIDY. `research/` has no
     vitest project, so its tests are collected by nothing -- the file looks covered, `npm test`
     stays green, and the coverage is simply gone. That is the shape of the "75 tests fail on a
     clean checkout" era, where the reported number and the real one had quietly parted company.

DECIDE BY WHAT A SCRIPT WRITES, NEVER BY ITS NAME. A name-based pass put `build-static` -- the
deploy artifact builder -- in the move list, because it resolves its output directory at runtime.
So the test below is for write CALLS, not for a `gen-`/`build-` prefix.

Run: python3 scripts/check_bin_placement.py [--self-test]
Stdlib only, no pip step, same as the other gates in this directory.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# A write to Mongo, or a write to the filesystem. Either makes a script something the product or
# the corpus DEPENDS ON having been run, which is what "pipeline" means here.
WRITES = re.compile(
    r"\b(writeFileSync|writeFile|createWriteStream|mkdirSync|cpSync|copyFileSync"
    r"|updateOne|updateMany|insertOne|insertMany|bulkWrite|replaceOne|deleteOne|deleteMany"
    r"|createIndex|upsert[A-Z]\w*)\s*\(",
)
IMPORTS_BIN = re.compile(r'from\s+"[^"]*\bbin/([A-Za-z0-9_-]+)\.js"')


def package_script_targets() -> set[str]:
    """Bin stems named by any package.json `scripts` entry."""
    out: set[str] = set()
    for pkg in sorted((ROOT / "packages").glob("*/package.json")):
        blob = json.dumps(json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {}))
        for m in re.finditer(r"src/bin/([A-Za-z0-9_-]+)\.ts", blob):
            out.add(f"{pkg.parent.name}/{m.group(1)}")
    return out


def imported_by_product() -> set[str]:
    """Bin stems imported from a source file that is NOT itself a bin."""
    out: set[str] = set()
    for pkg in sorted((ROOT / "packages").iterdir()):
        src = pkg / "src"
        if not src.is_dir():
            continue
        for f in src.rglob("*.ts*"):
            if f.parent.name == "bin":
                continue
            for m in IMPORTS_BIN.finditer(f.read_text(encoding="utf-8", errors="ignore")):
                out.add(f"{pkg.name}/{m.group(1)}")
    return out


def misplaced_bins() -> list[str]:
    """Files in `packages/*/src/bin` that nothing depends on and that write nothing."""
    scripted, imported = package_script_targets(), imported_by_product()
    bad: list[str] = []
    for pkg in sorted((ROOT / "packages").iterdir()):
        bindir = pkg / "src" / "bin"
        if not bindir.is_dir():
            continue
        for f in sorted(bindir.glob("*.ts")):
            if f.name.endswith(".test.ts"):
                continue
            key = f"{pkg.name}/{f.stem}"
            if f.with_name(f"{f.stem}.test.ts").exists():
                continue
            if key in scripted or key in imported:
                continue
            if WRITES.search(f.read_text(encoding="utf-8", errors="ignore")):
                continue
            bad.append(f"{f.relative_to(ROOT)}")
    return bad


def orphaned_research_tests() -> list[str]:
    """Test files under `research/`, which no vitest project collects."""
    research = ROOT / "research"
    if not research.is_dir():
        return []
    return sorted(str(f.relative_to(ROOT)) for f in research.rglob("*.test.ts*"))


def self_test() -> None:
    """Prove BOTH directions fire. A gate nobody has watched fail is decoration."""
    assert WRITES.search('writeFileSync(target, "x")'), "a file writer must read as pipeline"
    assert WRITES.search("await col.updateOne({}, {})"), "a Mongo write must read as pipeline"
    assert WRITES.search("await upsertCardTags(a, b)"), "an upsert helper must read as pipeline"
    assert not WRITES.search('console.log("just a census")'), "a printer must NOT read as pipeline"
    # The trap this rule exists to avoid: the decision is the write call, never the name.
    assert not WRITES.search("const outDir = argv[i + 1];"), "naming an out dir is not writing"
    print("self-test: both directions fire")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    bad, orphans = misplaced_bins(), orphaned_research_tests()
    for f in bad:
        pkg = f.split("/")[1]
        print(
            f"{f}: nothing imports it, no package.json script runs it, it has no test and it "
            f"writes nothing -- that is a one-shot measurement. Move it to research/{pkg}/ "
            f"(see CLAUDE.md, 'Where a script lives'), or give it the test or the write that "
            f"makes it pipeline.",
        )
    for f in orphans:
        print(
            f"{f}: research/ is not a vitest project, so this test is collected by NOTHING and "
            f"its coverage is silently absent from `npm test`. Move the module and its test into "
            f"a package -- packages/instruments/ for a scoring or verification instrument.",
        )
    if bad or orphans:
        print(f"\n{len(bad) + len(orphans)} misplaced file(s).")
        return 1
    print("bin placement: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
