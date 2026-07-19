#!/usr/bin/env bash
set -euo pipefail

seed="${WARDEN_FUZZ_SEED:-$(date +%s)}"
echo "Fuzz seed: ${seed}"
WARDEN_FUZZ_SEED="${seed}" npx vitest run tests/fuzz
