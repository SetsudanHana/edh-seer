#!/usr/bin/env python3
"""Every script lives in the home that matches what it is FOR.

Settled 2026-09-07 (roadmap Z3/Z4, PRs #221 and #223) and documented in CONTRIBUTING.md:

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
import subprocess
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


RUNTIME_PATH = re.compile(r'new URL\(\s*"(\.\.?/[^"]+)"')


def broken_runtime_paths() -> list[str]:
    """Relative `new URL(...)` targets that do not exist.

    MOVING A FILE SILENTLY BREAKS THESE AND NOTHING ELSE NOTICES. The 2026-09-07 reorg rewrote
    every `import` specifier and left 16 runtime paths across 10 files pointing at directories
    that had never existed -- `packages/instruments/fixtures/gold-clauses.json`,
    `packages/instruments/goldpairs.json`, `cli/decks/`. TypeScript cannot see inside a string,
    these scripts have no tests by design, and the failure only shows when someone runs the tool
    months later. Found by accident while pricing something unrelated.

    A directory target is accepted when its PARENT exists: `.cs-cache/` and `.edhrec-cache/` are
    gitignored and created on demand, so requiring them would fail a clean checkout.
    """
    bad: list[str] = []
    for base in ("packages", "research"):
        root = ROOT / base
        if not root.is_dir():
            continue
        for f in sorted(root.rglob("*.ts")):
            if "node_modules" in f.parts or "dist" in f.parts:
                continue
            for m in RUNTIME_PATH.finditer(f.read_text(encoding="utf-8", errors="ignore")):
                target = (f.parent / m.group(1)).resolve()
                if target.exists() or target.parent.is_dir():
                    continue
                bad.append(f"{f.relative_to(ROOT)}: new URL(\"{m.group(1)}\") -> {target} does not exist")
    return bad


WRITTEN_PATH = re.compile(r"(?<![\w./-])((?:packages|research|scripts)/[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|mjs|py))\b")


def broken_written_paths() -> list[str]:
    """Script paths written out in prose -- a run instruction, a docstring, a cited command -- that
    point at nothing.

    THE SAME MOVE, THE OTHER HALF. `broken_runtime_paths` catches the strings a script reads; the
    2026-09-07 reorg also left 47 run instructions pointing at `packages/*/src/bin/` paths the files
    had moved out of, one of them quoted on the live How it works page (found 2026-09-25). A path
    counts as resolved from the repository root, from its own package, or from its own directory,
    which is how these are written. The engineering log is history and keeps the paths it had.
    """
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    bad: list[str] = []
    for rel in tracked:
        # This file's own self-test names a path that must not exist.
        if not rel or rel.startswith("docs/engineering-log/") or rel in {"package-lock.json", "scripts/check_bin_placement.py"}:
            continue
        f = ROOT / rel
        if f.suffix not in {".ts", ".tsx", ".mts", ".mjs", ".js", ".py", ".md", ".html", ".json", ".yml", ".txt"}:
            continue
        pkg = ROOT / "/".join(rel.split("/")[:2]) if rel.startswith("packages/") else None
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            for m in WRITTEN_PATH.finditer(line):
                target = m.group(1)
                if (ROOT / target).exists() or (f.parent / target).exists() or (pkg and (pkg / target).exists()):
                    continue
                bad.append(f"{rel}:{n}: {target}")
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
    assert RUNTIME_PATH.search('readFileSync(new URL("../x.json", import.meta.url))'), "must see a runtime path"
    assert not RUNTIME_PATH.search('from "../x.js"'), "an import specifier is not a runtime path"
    assert WRITTEN_PATH.search("npx tsx packages/matcher/src/bin/x.ts"), "must see a written script path"
    assert not WRITTEN_PATH.search("my-packages/x.ts"), "a path inside a longer word is not one"
    print("self-test: both directions fire")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    bad, orphans, paths = misplaced_bins(), orphaned_research_tests(), broken_runtime_paths()
    written = broken_written_paths()
    for f in bad:
        pkg = f.split("/")[1]
        print(
            f"{f}: nothing imports it, no package.json script runs it, it has no test and it "
            f"writes nothing -- that is a one-shot measurement. Move it to research/{pkg}/ "
            f"(see CONTRIBUTING.md, 'Where a script goes'), or give it the test or the write that "
            f"makes it pipeline.",
        )
    for f in orphans:
        print(
            f"{f}: research/ is not a vitest project, so this test is collected by NOTHING and "
            f"its coverage is silently absent from `npm test`. Move the module and its test into "
            f"a package -- packages/instruments/ for a scoring or verification instrument.",
        )
    for f in paths:
        print(f"{f} -- a relative runtime path that no longer resolves. Moving a file rewrites its "
              f"imports but NOT the strings inside `new URL(...)`, and nothing else can see them.")
    for f in written:
        print(f"{f} -- a written script path that no longer exists. A move rewrites imports, not the "
              f"run instructions and citations that name the file; point this at where it lives now.")
    if bad or orphans or paths or written:
        print(f"\n{len(bad) + len(orphans) + len(paths) + len(written)} problem(s).")
        return 1
    print("bin placement: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
