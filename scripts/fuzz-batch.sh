#!/usr/bin/env bash
set -u

seed_count="${WARDEN_FUZZ_SEED_COUNT:-50}"
start_seed="${WARDEN_FUZZ_START_SEED:-$(date +%s)}"
failure_log="${WARDEN_FUZZ_FAILURE_LOG:-fuzz-failures.log}"
failures=0

: > "${failure_log}"
echo "Running ${seed_count} fuzz seeds starting at ${start_seed}"

for ((offset = 0; offset < seed_count; offset++)); do
  seed=$((start_seed + offset))
  echo "[${offset}/${seed_count}] seed ${seed}"
  if ! WARDEN_FUZZ_SEED="${seed}" npx vitest run tests/fuzz --reporter=dot >>"${failure_log}" 2>&1; then
    failures=$((failures + 1))
    printf 'FAILED seed %s\n' "${seed}" >>"${failure_log}"
  fi
done

if (( failures > 0 )); then
  echo "${failures} fuzz seed(s) failed. Details: ${failure_log}"
  exit 1
fi

printf 'No failures across %s seeds.\n' "${seed_count}"
