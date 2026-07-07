#!/usr/bin/env bash
# factory.sh — headless software factory for shipping GitHub issues.
#
# Successor to run-issues.sh (herdr/tmux panes) — workers are headless
# `claude -p` processes, so no pane scraping and no terminal required.
#
# Queue file: .factory/queue — lines of "<lane> <issue#>", priority-ordered.
# Lanes run in PARALLEL; issues within a lane run SERIALLY (lanes exist
# because issues in a lane touch the same files, e.g. app/renderer/index.html).
# Merges are globally serialized via a lockfile regardless of lane.
#
#   factory.sh run              process the whole queue (lanes in parallel)
#   factory.sh run-lane <lane>  process one lane serially (used by `run`)
#   factory.sh ship <N>         worktree + headless worker → ready PR for one issue
#   factory.sh land <N|PR#>     rebase-if-dirty, squash-merge, cleanup worktree
#   factory.sh status           queue progress, workers, open PRs
#   factory.sh stop             halt after current issues (creates STOP file)
#   factory.sh resume           remove STOP file
#
# Safety model:
#   - By default the factory STOPS each issue at a green, ready-for-review PR.
#     It only merges when FACTORY_MERGE=1 is set (explicit human authorization).
#     Without it, a lane parks after producing one ready PR and polls until a
#     human merges it, then continues to the next issue in the lane.
#   - Touch .factory/STOP (or `factory.sh stop`) to halt between issues.
#   - A worker that prints a line starting "ESCALATE:" parks its issue; the
#     lane moves on and the escalation is logged for the supervisor.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GH_REPO="on-par/sound-buddy"
MODEL="${FACTORY_MODEL:-claude-opus-4-8}"
WT_PARENT="$(dirname "$REPO")"
STATE="$REPO/.factory"
QUEUE="$STATE/queue"
EVENTS="$STATE/events.ndjson"
LOGS="$STATE/logs"
MERGE_LOCK="$STATE/merge.lock"
STOP_FILE="$STATE/STOP"
WORKER_TIMEOUT="${FACTORY_WORKER_TIMEOUT:-7200}"   # seconds per issue
MERGE_POLL="${FACTORY_MERGE_POLL:-120}"            # seconds between merge-wait polls

mkdir -p "$STATE" "$LOGS"

log_event() { # type issue msg
  printf '{"ts":"%s","type":"%s","issue":"%s","msg":%s}\n' \
    "$(date -u +%FT%TZ)" "$1" "$2" \
    "$(jq -Rn --arg m "$3" '$m')" >> "$EVENTS"
  echo "[factory] $1 #$2: $3"
}

slugify() { echo "$1" | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-32 | sed -E 's/-+$//'; }

branch_for() { echo "ship-it/$1-$(slugify "$(gh issue view "$1" --repo "$GH_REPO" --json title --jq .title)")"; }
wt_for()     { echo "$WT_PARENT/sound-buddy-factory-$1"; }

stopped() { [ -e "$STOP_FILE" ]; }

# Serialize critical sections. Lanes run concurrently, and git worktree/branch
# ops on the main repo contend on .git locks — every such op takes GIT_LOCK.
GIT_LOCK="$STATE/git.lock"
with_lock() { local lock="$1"; shift
  local waited=0
  until mkdir "$lock" 2>/dev/null; do
    sleep 5; waited=$((waited+5))
    [ "$waited" -ge 1800 ] && { echo "lock $lock stuck >30m" >&2; return 1; }
  done
  trap "rmdir '$lock' 2>/dev/null || true" RETURN
  "$@"
}

# ---------- worker prompt (headless: never wait for input) ----------
prompt_for() { local n="$1" br="$2"
  cat <<EOF | tr '\n' ' '
/ship-it $n — Run fully autonomously in headless mode. You are ALREADY inside the
isolated git worktree for issue $n (branch $br, cwd is this worktree), so SKIP
ship-it's worktree-creation step. Do NOT block on any plan gate: print your
go/no-go plan, then proceed immediately. Auto-fix only high-confidence review
findings; for uncertain findings apply the conservative default and note the
deferral in the PR body instead of asking. Never pause for permission or input —
nobody is watching this session. Stop at a green, ready-for-review PR — do NOT
merge (the factory handles merging). CRITICAL: your session terminates the moment
you end your turn, so NEVER end your turn after an intermediate step (reviews,
verify, commits). Before ending, run this checklist and keep working until every
item is true: (1) branch $br is pushed to origin, (2) an open PR exists with
"Closes #$n" in its body, (3) CI on the PR is green, (4) the PR is marked ready
for review. If and ONLY IF you hit something genuinely ambiguous that is unsafe
to default, print a line starting exactly with "ESCALATE:" followed by the
question, then STOP working and end your turn.
EOF
}

# ---------- ship one issue to a ready PR ----------
cmd_ship() { local n="$1"
  local br wt log; br="$(branch_for "$n")"; wt="$(wt_for "$n")"; log="$LOGS/issue-$n.log"

  # already merged/closed? skip.
  local istate; istate="$(gh issue view "$n" --repo "$GH_REPO" --json state --jq .state)"
  if [ "$istate" = "CLOSED" ]; then log_event skip "$n" "issue already closed"; return 0; fi
  # already has an open PR? treat as shipped (resume case).
  if gh pr list --repo "$GH_REPO" --state open --search "in:body #$n" --json number,body \
      --jq ".[] | select(.body | test(\"[Cc]loses #$n\\\\b\")) | .number" | grep -q .; then
    log_event skip "$n" "open PR already exists for issue"; return 0
  fi

  # NB: callers invoke cmd_ship under `|| rc=$?`, which disables errexit in
  # here — every step below must handle its own failure explicitly.
  with_lock "$GIT_LOCK" setup_worktree "$br" "$wt" \
    || { log_event fail "$n" "worktree setup failed for $br"; return 14; }

  log_event start "$n" "headless worker started on $br (model $MODEL, log $log)"
  local rc=0
  ( cd "$wt" && timeout "$WORKER_TIMEOUT" \
      claude -p "$(prompt_for "$n" "$br")" \
        --model "$MODEL" --dangerously-skip-permissions ) >"$log" 2>&1 || rc=$?

  if grep -q '^ESCALATE:' "$log"; then
    log_event escalate "$n" "$(grep -m1 '^ESCALATE:' "$log")"; return 10
  fi
  if [ "$rc" -eq 124 ]; then log_event timeout "$n" "worker exceeded ${WORKER_TIMEOUT}s"; return 11; fi
  if [ "$rc" -ne 0 ]; then log_event fail "$n" "worker exited rc=$rc (see $log)"; return 12; fi

  local pr; pr="$(pr_for_branch "$br" || true)"
  if [ -z "$pr" ]; then log_event fail "$n" "worker finished but no PR found for $br"; return 13; fi
  log_event ready "$n" "PR #$pr ready for review"
  return 0
}

pr_for_branch() { gh pr list --repo "$GH_REPO" --state open --head "$1" --json number --jq '.[0].number' | grep .; }

setup_worktree() { local br="$1" wt="$2"
  git -C "$REPO" fetch origin -q || return 1
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  git -C "$REPO" branch -D "$br" 2>/dev/null || true
  git -C "$REPO" worktree add -b "$br" "$wt" origin/main >/dev/null
}

# ---------- merge (globally serialized) ----------
do_land() { local n="$1"
  local br wt pr ms; br="$(branch_for "$n")"; wt="$(wt_for "$n")"
  git -C "$REPO" fetch origin -q || true
  pr="$(pr_for_branch "$br" || true)"
  [ -z "$pr" ] && { log_event fail "$n" "land: no open PR for $br"; return 4; }
  timeout 600 gh pr checks "$pr" --repo "$GH_REPO" --watch --fail-fast >/dev/null 2>&1 || true
  ms="$(gh pr view "$pr" --repo "$GH_REPO" --json mergeStateStatus --jq .mergeStateStatus)"
  if [ "$ms" = "DIRTY" ]; then
    if [ -d "$wt" ]; then
      ( cd "$wt" && git rebase origin/main && git push --force-with-lease origin "$br" ) || {
        ( cd "$wt" && git rebase --abort ) 2>/dev/null || true
        log_event conflict "$n" "rebase conflict on $br — parked"; return 3; }
      timeout 600 gh pr checks "$pr" --repo "$GH_REPO" --watch --fail-fast >/dev/null 2>&1 || true
    else
      log_event conflict "$n" "PR #$pr DIRTY and worktree gone"; return 3
    fi
  fi
  gh pr merge "$pr" --squash --delete-branch --repo "$GH_REPO" \
    || { log_event fail "$n" "merge failed for PR #$pr"; return 5; }
  log_event merged "$n" "squash-merged $br (PR #$pr)"
  with_lock "$GIT_LOCK" cleanup_worktree "$wt" || true
  return 0
}

cleanup_worktree() { local wt="$1"
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  git -C "$REPO" worktree prune
}

cmd_land() { with_lock "$MERGE_LOCK" do_land "$1"; }

# Wait until the issue's PR is merged — by us (FACTORY_MERGE=1) or by a human.
wait_landed() { local n="$1"
  local br; br="$(branch_for "$n")"
  while :; do
    stopped && { log_event stopped "$n" "STOP file present during merge-wait"; return 20; }
    local st
    st="$(gh pr list --repo "$GH_REPO" --state merged --head "$br" --json number --jq '.[0].number' || true)"
    [ -n "$st" ] && { log_event landed "$n" "PR merged — lane continues"; return 0; }
    if [ "${FACTORY_MERGE:-0}" = "1" ]; then
      cmd_land "$n" && return 0
      return 21   # conflict/failure already logged — park the lane
    fi
    echo "[factory] #$n ready PR awaiting human merge (poll ${MERGE_POLL}s; set FACTORY_MERGE=1 to self-merge)"
    sleep "$MERGE_POLL"
  done
}

# ---------- lane / queue processing ----------
lane_issues() { grep -Ev '^\s*(#|$)' "$QUEUE" | awk -v l="$1" '$1==l {print $2}'; }
lanes()       { grep -Ev '^\s*(#|$)' "$QUEUE" | awk '{print $1}' | awk '!seen[$0]++'; }

cmd_run_lane() { local lane="$1"
  for n in $(lane_issues "$lane"); do
    stopped && { log_event stopped "$n" "STOP file present — lane $lane halting"; return 0; }
    local rc=0; cmd_ship "$n" || rc=$?
    case "$rc" in
      0)  wait_landed "$n" || { log_event parked "$n" "lane $lane parked (merge-wait rc)"; return 0; } ;;
      10|11|12|13) log_event parked "$n" "lane $lane parked on worker failure rc=$rc"; return 0 ;;
    esac
  done
  log_event lane-done "$lane" "lane complete"
}

cmd_run() {
  [ -s "$QUEUE" ] || { echo "queue is empty: $QUEUE" >&2; exit 2; }
  rm -f "$STOP_FILE"
  local pids=()
  for lane in $(lanes); do
    "$0" run-lane "$lane" &
    pids+=("$!")
    echo "[factory] lane '$lane' started (pid $!)"
  done
  local rc=0
  for p in "${pids[@]}"; do wait "$p" || rc=1; done
  log_event run-done all "all lanes finished"
  return "$rc"
}

cmd_status() {
  echo "== queue ($QUEUE) =="; [ -s "$QUEUE" ] && grep -Ev '^\s*(#|$)' "$QUEUE" || echo "(empty)"
  echo; echo "== last events =="; tail -12 "$EVENTS" 2>/dev/null || echo "(none)"
  echo; echo "== open PRs =="
  gh pr list --repo "$GH_REPO" --state open --json number,title,mergeStateStatus,isDraft \
    --jq '.[] | [.number, (if .isDraft then "draft" else "ready" end), .mergeStateStatus, .title] | @tsv'
  echo; echo "== worktrees =="; git -C "$REPO" worktree list
  if [ -e "$STOP_FILE" ]; then echo; echo "!! STOP file present — factory halting between issues"; fi
}

case "${1:-}" in
  run)      cmd_run ;;
  run-lane) cmd_run_lane "$2" ;;
  ship)     cmd_ship "$2" ;;
  land)     cmd_land "$2" ;;
  status)   cmd_status ;;
  stop)     touch "$STOP_FILE"; echo "STOP set — lanes halt between issues" ;;
  resume)   rm -f "$STOP_FILE"; echo "STOP cleared" ;;
  *) sed -n '2,30p' "$0"; exit 2 ;;
esac
