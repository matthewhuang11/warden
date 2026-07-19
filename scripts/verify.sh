#!/usr/bin/env bash
set -euo pipefail

echo '== Build =='
npm run build

echo '== Tests =='
npm test

echo '== Dependency audit =='
npm audit --audit-level=high

echo '== Lockfile check =='
git diff --exit-code -- package-lock.json

echo 'Verification passed.'
