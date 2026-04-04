#!/usr/bin/env bash
# End-to-end smoke test for the broker.
#
# Flow:
#   1. Seed a test mesh with 2 members → writes /tmp/smoke-seed.json
#   2. Start peer B (receiver) in background
#   3. Start peer A (sender)
#   4. Wait for B → exit code is the test result
#
# Assumes: broker is running on ws://localhost:7900/ws, DATABASE_URL
# is in env. Run from the broker workspace:
#   cd apps/broker && ./scripts/smoke-test.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "── seeding test mesh ──"
bun "$DIR/seed-test-mesh.ts" > /tmp/smoke-seed.json
cat /tmp/smoke-seed.json

echo ""
echo "── starting peer-b (receiver) ──"
bun "$DIR/peer-b.ts" &
B_PID=$!

sleep 1

echo ""
echo "── starting peer-a (sender) ──"
bun "$DIR/peer-a.ts"

echo ""
echo "── waiting for peer-b ──"
if wait $B_PID; then
  echo "✓ smoke test PASSED"
  exit 0
else
  echo "✗ smoke test FAILED"
  exit 1
fi
