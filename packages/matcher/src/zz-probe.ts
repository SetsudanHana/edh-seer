// THROWAWAY. The control: the SAME pattern inside packages/, which must still be reported.
import { readFileSync, writeFileSync } from "node:fs";
const arg = process.argv[2]!;
writeFileSync(`/tmp/${arg}.txt`, readFileSync(arg, "utf8"));
