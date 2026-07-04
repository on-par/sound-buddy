#!/usr/bin/env bash
# run-issues.sh — deterministic herdr-driven orchestrator for shipping GitHub issues.
#
# Owns the MECHANICS only (worktree, herdr pane/agent, rebase-merge, cleanup,
# usage check). A human/Claude supervisor watches for blocks/ESCALATE and drives
# merges. Commands are intentionally small so the supervisor can stop between them.
#
#   run-issues.sh start   <N>      fetch main, worktree, launch autonomous /ship-it agent
#   run-issues.sh status  <N>      print herdr agent status + last pane lines
#   run-issues.sh watch   <N>      block until agent goes idle/blocked (for background use)
#   run-issues.sh answer  <N> TXT  relay a supervisor answer into the agent pane
#   run-issues.sh merge   <N>      rebase onto origin/main, squash-merge, delete branch
#   run-issues.sh cleanup <N>      remove the worktree + stop the herdr agent
#   run-issues.sh usage            print ccusage active-block token % (0..1)
#
# Queue (curated leaves, dependency-ordered — epics/PRDs excluded):
#   Gate: 36  (solo — must merge before lanes start)
#   Lane A (renderer, serial): 37 39 41 40 38 43 46
#   Lane B (python,   serial): 42 44 45
set -euo pipefail

REPO="/Users/moltbot/repos/on-par/sound-buddy"
MODEL="claude-opus-4-8"
WT_PARENT="$(dirname "$REPO")"
STATE_DIR="$REPO/.orchestrator"
EVENTS="$STATE_DIR/events.ndjson"
USAGE_THRESHOLD="0.90"

mkdir -p "$STATE_DIR"

log_event() { # type, issue, msg
  printf '{"ts":"%s","type":"%s","issue":"%s","msg":%s}\n' \
    "$(date -u +%FT%TZ)" "$1" "$2" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$3")" \
    >> "$EVENTS"
}

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-32 | sed -E 's/-+$//'; }

branch_for() { echo "issue-$1-$(slugify "$(gh issue view "$1" --json title --jq .title)")"; }
wt_for()     { echo "$WT_PARENT/sound-buddy-issue-$1"; }
agent_for()  { echo "ship-$1"; }

# raw_status takes a LITERAL agent name; agent_status takes an ISSUE number.
raw_status() { herdr agent get "$1" 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["agent"]["agent_status"])' 2>/dev/null || echo "absent"; }
agent_status() { raw_status "$(agent_for "$1")"; }

pane_id_for() { herdr agent get "$(agent_for "$1")" 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["agent"]["pane_id"])'; }

pane_text() { herdr agent read "$(agent_for "$1")" --source visible --lines "${2:-40}" 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["read"]["text"])'; }

# ---- autonomous ship-it prompt (single line; overrides ship-it's asky gates) ----
prompt_for() { local n="$1" br="$2"
  cat <<EOF | tr '\n' ' '
/ship-it $n — Run fully autonomously. You are ALREADY inside the isolated git worktree
for issue $n (branch $br, cwd is this worktree), so SKIP ship-it step 1 (worktree creation).
Do NOT block on the step-0 plan gate: print your go/no-go plan, then proceed immediately
without waiting for approval. Auto-fix only high-confidence review findings; for uncertain
findings apply the conservative default and note the deferral in the PR body rather than
asking. Never pause for permission. Stop at a green, ready-for-review PR — do NOT merge
(the orchestrator handles merge). If and ONLY IF you hit something genuinely ambiguous that
is unsafe to default, print a line starting exactly with "ESCALATE:" then the question, and wait.
EOF
}

cmd_start() { local n="$1"
  git -C "$REPO" fetch origin -q
  local br wt; br="$(branch_for "$n")"; wt="$(wt_for "$n")"
  # idempotent: clear any stale worktree/branch from a prior attempt
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  git -C "$REPO" branch -D "$br" 2>/dev/null || true
  git -C "$REPO" worktree add -b "$br" "$wt" origin/main
  herdr agent start "$(agent_for "$n")" --cwd "$wt" --no-focus -- \
    claude --model "$MODEL" --dangerously-skip-permissions >/dev/null
  herdr agent wait "$(agent_for "$n")" --status idle --timeout 60000 >/dev/null 2>&1 || true
  herdr agent send "$(agent_for "$n")" "$(prompt_for "$n" "$br")" >/dev/null
  sleep 1
  herdr pane send-keys "$(pane_id_for "$n")" Enter >/dev/null
  log_event start "$n" "launched autonomous /ship-it on branch $br"
  echo "started ship-$n on $br (worktree $wt)"
}

cmd_status() { local n="$1"
  echo "status: $(agent_status "$n")"; echo "---"; pane_text "$n" "${2:-30}"; }

# Block until the agent stops working (idle/blocked) or emits ESCALATE. For background use.
cmd_watch() { local n="$1"; local a
  while :; do
    a="$(agent_status "$n")"
    if pane_text "$n" 60 | grep -q '^ESCALATE:'; then
      log_event escalate "$n" "agent emitted ESCALATE"; echo "ESCALATE"; return 0; fi
    case "$a" in
      done)    log_event done "$n" "agent done (ship-it complete)"; echo "done"; return 0 ;;
      idle)    log_event idle "$n" "agent idle (awaiting input)"; echo "idle"; return 0 ;;
      blocked) log_event blocked "$n" "agent blocked"; echo "blocked"; return 0 ;;
      absent)  echo "absent"; return 0 ;;
    esac
    sleep 30
  done
}

cmd_answer() { local n="$1"; shift
  herdr agent send "$(agent_for "$n")" "$*" >/dev/null
  sleep 1
  herdr pane send-keys "$(pane_id_for "$n")" Enter >/dev/null
  log_event answer "$n" "relayed supervisor answer"; }

# Rebase the PR branch onto latest main and squash-merge. Lanes are file-disjoint,
# so cross-lane rebases are clean by construction; abort loudly on any conflict.
cmd_merge() { local n="$1"; local br wt num ms; br="$(branch_for "$n")"; wt="$(wt_for "$n")"
  git -C "$REPO" fetch origin -q
  num="$(gh pr view "$br" --repo on-par/sound-buddy --json number --jq .number 2>/dev/null)"
  [ -z "$num" ] && { echo "NO_PR for $br"; return 4; }
  # Let CI settle. squash-merge applies onto latest main server-side, so a local
  # rebase+force-push is only needed when GitHub reports an actual conflict (DIRTY).
  timeout 300 gh pr checks "$num" --watch --fail-fast >/dev/null 2>&1 || true
  ms="$(gh pr view "$br" --repo on-par/sound-buddy --json mergeStateStatus --jq .mergeStateStatus)"
  if [ "$ms" = "DIRTY" ]; then
    if [ -d "$wt" ]; then
      ( cd "$wt" && git rebase origin/main && git push --force-with-lease origin "$br" ) || {
        ( cd "$wt" && git rebase --abort ) 2>/dev/null || true
        log_event conflict "$n" "rebase conflict on $br — parking"; echo "REBASE_CONFLICT"; return 3; }
      timeout 300 gh pr checks "$num" --watch --fail-fast >/dev/null 2>&1 || true
    else
      log_event conflict "$n" "DIRTY but worktree gone — cannot rebase"; echo "NEEDS_REBASE_NO_WT"; return 3
    fi
  fi
  gh pr merge "$num" --squash --delete-branch --repo on-par/sound-buddy || { echo "MERGE_FAILED"; return 5; }
  log_event merged "$n" "squash-merged $br (#$num)"; echo "merged $br (#$num)"; }

cmd_cleanup() { local n="$1"; local wt pane; wt="$(wt_for "$n")"
  pane="$(herdr agent get "$(agent_for "$n")" 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["agent"]["pane_id"])' 2>/dev/null || true)"
  [ -n "${pane:-}" ] && herdr pane close "$pane" >/dev/null 2>&1 || true
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  git -C "$REPO" worktree prune
  log_event cleanup "$n" "removed worktree $wt + closed pane ${pane:-none}"
  echo "cleaned up $n"; }

# Real plan usage via Claude Code's /usage panel, scraped from a persistent
# scratch pane. ccusage token totals are cache-inflated and have no plan
# denominator; /usage is the only source of the true rate-limit %.
USAGE_AGENT="usage-probe"
ensure_usage_agent() {
  if [ "$(raw_status "$USAGE_AGENT")" = "absent" ]; then
    herdr agent start "$USAGE_AGENT" --cwd "$REPO" --no-focus -- \
      claude --model "$MODEL" --dangerously-skip-permissions >/dev/null 2>&1
    herdr agent wait "$USAGE_AGENT" --status idle --timeout 45000 >/dev/null 2>&1 || true
  fi
}
cmd_usage() {
  ensure_usage_agent
  local pane; pane="$(herdr agent get "$USAGE_AGENT" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["agent"]["pane_id"])')"
  herdr agent send "$USAGE_AGENT" "/usage" >/dev/null
  sleep 1; herdr pane send-keys "$pane" Enter >/dev/null   # 1st Enter: accept autocomplete
  sleep 1; herdr pane send-keys "$pane" Enter >/dev/null   # 2nd Enter: execute
  sleep 4
  local text; text="$(herdr agent read "$USAGE_AGENT" --source visible --lines 80 \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["read"]["text"])')"
  herdr pane send-keys "$pane" Escape >/dev/null 2>&1 || true  # dismiss panel
  echo "$text" | python3 -c '
import sys,re
lines=sys.stdin.read().splitlines()
def pct(label):
    for i,l in enumerate(lines):
        if label in l:
            for j in range(i,min(i+6,len(lines))):
                m=re.search(r"(\d+)% used",lines[j])
                if m: return int(m.group(1))
    return None
sess=pct("Current session"); week=pct("Current week (all models)")
vals=[x for x in (sess,week) if x is not None]
gate=max(vals) if vals else None
print(f"session={sess} week={week} gate={gate}")
'; }

case "${1:-}" in
  start)   cmd_start   "$2" ;;
  status)  cmd_status  "$2" "${3:-30}" ;;
  watch)   cmd_watch   "$2" ;;
  answer)  cmd_answer "$2" "${@:3}" ;;
  merge)   cmd_merge   "$2" ;;
  cleanup) cmd_cleanup "$2" ;;
  usage)   cmd_usage ;;
  *) echo "usage: $0 {start|status|watch|answer|merge|cleanup|usage} [issue] [args]" >&2; exit 2 ;;
esac
