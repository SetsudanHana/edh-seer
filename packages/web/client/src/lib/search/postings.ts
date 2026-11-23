// Posting lists: sorted unique row indices, delta + LEB128 varint, base64 in JSON.
// Browser-safe: btoa/atob only.

export function encodePostings(rows: readonly number[]): string {
  const bytes: number[] = [];
  let prev = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!Number.isInteger(row) || row < 0) throw new Error(`posting row must be a non-negative integer, got ${row}`);
    if (i > 0 && row <= prev) throw new Error("posting rows must be strictly ascending");
    let d = row - prev;
    prev = row;
    while (d >= 0x80) {
      bytes.push((d % 0x80) | 0x80);
      d = Math.floor(d / 0x80);
    }
    bytes.push(d);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.slice(i, i + 0x2000));
  return btoa(bin);
}

export function decodePostings(b64: string): number[] {
  const bin = atob(b64);
  const out: number[] = [];
  let prev = 0;
  let cur = 0;
  let mul = 1;
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    cur += (b & 0x7f) * mul;
    if (b & 0x80) {
      mul *= 0x80;
    } else {
      prev += cur;
      out.push(prev);
      cur = 0;
      mul = 1;
    }
  }
  return out;
}
