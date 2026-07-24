#!/usr/bin/env bash
# Runs the direct-API tagging grind until 0 cards remain under CUTOFF (default 20000).
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export TAGGER_PROVIDER=anthropic
export ANTHROPIC_MAX_TOKENS="${ANTHROPIC_MAX_TOKENS:-16000}"
CUTOFF="${CUTOFF:-20000}"
DIR=/tmp/mtg-tag-batches
ROUND=0

while true; do
  REMAINING=$(npx tsx src/bin/status.ts | grep "remaining under" | sed -E 's/.*: ([0-9]+)/\1/')
  if [ -z "$REMAINING" ] || [ "$REMAINING" -eq 0 ]; then
    echo "grind: 0 remaining under cutoff $CUTOFF. done."
    break
  fi
  ROUND=$((ROUND+1))
  echo "=== round $ROUND ($REMAINING remaining) ==="
  npx tsx src/bin/dump-untagged.ts --batches 6 --size 40 --out "$DIR"
  npx tsx src/bin/tag-batch-api.ts --dir "$DIR" --batches 6
  for i in 0 1 2 3 4 5; do
    [ -f "$DIR/batch-$i-out.json" ] && npx tsx src/bin/upsert-batch.ts "$DIR/batch-$i.json" "$DIR/batch-$i-out.json" || true
  done
  npx tsx src/bin/reconcile.ts
  if [ $((ROUND % 10)) -eq 0 ]; then
    npx tsx src/bin/audit.ts --sample 15 || true
  fi
done
