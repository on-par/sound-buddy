#!/usr/bin/env bash
# Applies .github/rulesets/main.json to the live GitHub branch ruleset (#408).
# This MUTATES live repository settings and requires repo admin — run by
# hand only, never from CI, never from scripts/verify.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

RULESET_ID="${RULESET_ID:-18622811}"

gh api --method PUT "repos/on-par/sound-buddy/rulesets/${RULESET_ID}" \
  --input .github/rulesets/main.json
