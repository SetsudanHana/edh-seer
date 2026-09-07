// THROWAWAY. Proves the CodeQL paths-ignore actually excludes research/. Never merged.
import { readFileSync, writeFileSync } from "node:fs";
const arg = process.argv[2]!;
// js/insecure-temporary-file + a path built straight from argv: unmistakable to the JS pack.
writeFileSync(`/tmp/${arg}.txt`, readFileSync(arg, "utf8"));
