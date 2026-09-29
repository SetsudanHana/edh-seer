// Test fixture for parallel.ts: multiplies its item by a factor a broadcast sets.
import { serveWorker } from "../parallel.js";

let factor = 1;
serveWorker(async (n: number) => n * factor, async (msg: { factor: number }) => { factor = msg.factor; });
