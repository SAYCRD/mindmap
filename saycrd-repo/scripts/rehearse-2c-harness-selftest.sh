#!/usr/bin/env bash
# scripts/rehearse-2c-harness-selftest.sh
#
# Proves that the Stage 2C rehearsal harnesses can actually FAIL.
#
# A green concurrency suite proves nothing about a lock it never contends, and
# a harness that cannot fail proves nothing at all. Before the repair, both
# rehearsal scripts could report success while their SQL assertions returned
# `f`: the assertion block was printed and never parsed, and
# rehearse-2c-race.sh had no exit-code logic whatsoever. So the harness needs
# its own negative controls, exactly as the migration does.
#
# This runs the REAL harness scripts unmodified against a canned `psql` shim
# placed first on PATH. No database, no network, no branch — every scenario is
# deterministic, so this can run in the normal test suite and in CI.
#
# The shim answers the harness's queries with a healthy, self-consistent set
# of results, EXCEPT for the one thing each scenario deliberately breaks. That
# isolation matters: if a scenario broke two things at once, a pass would not
# tell you which mechanism caught it.
#
# Scenarios (user-race harness):
#   healthy            everything consistent                     -> expect 0
#   false_global       one global assertion returns f            -> expect nonzero
#   missing_global     one declared assertion emits no row       -> expect nonzero
#   undeclared_global  an extra, undeclared assertion appears    -> expect nonzero
#   global_sql_error   the assertion block dies part-way         -> expect nonzero
#   racer_exit         one racer's psql exits nonzero            -> expect nonzero
#   unparseable        one racer returns an unreadable payload   -> expect nonzero
#   complimentary      completion consumes a free session, so
#                      the round never contended for the credit  -> expect nonzero
#   replay_drift       a redelivery answers something new        -> expect nonzero
#   verdict_negative   the committed verdict shows balance -1
#                      and two debits: the real defect signature -> expect nonzero
#
# Scenarios (refund-race harness):
#   race_healthy       everything consistent                     -> expect 0
#   race_false_global  one committed-state assertion returns f   -> expect nonzero
#   race_tally_drift   no racer wins, so the tally is wrong      -> expect nonzero
#   race_racer_exit    one parallel client exits nonzero         -> expect nonzero
#
# Usage: bash scripts/rehearse-2c-harness-selftest.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
STATE="$(mktemp -d)"
STUB="$STATE/bin"
FAILED=0
PASSED=0

cleanup() { rm -rf "$STATE"; }
trap cleanup EXIT

mkdir -p "$STUB"

# ---------------------------------------------------------------------------
# The canned psql. Reads the scenario from SELFTEST_SCENARIO and shared
# cross-process state from SELFTEST_STATE.
# ---------------------------------------------------------------------------
cat >"$STUB/psql" <<'STUB'
#!/usr/bin/env bash
SC="${SELFTEST_SCENARIO:-healthy}"
ST="${SELFTEST_STATE:-/tmp}"
SQL=""
MODE=stdin
while [ $# -gt 0 ]; do
  case "$1" in
    -c) SQL="$2"; MODE=cmd; shift 2 ;;
    -f) SQL="FILE"; MODE=file; shift 2 ;;
    *) shift ;;
  esac
done
[ "$MODE" = stdin ] && SQL="$(cat)"
[ "$MODE" = file ] && exit 0

USER_GLOBALS="no_negative_balance_any_user every_race_user_landed_on_zero
exactly_one_debit_per_race_user at_most_one_refund_row_per_order
completed_sessions_match_reports no_race_session_left_in_limbo
no_claw_back_on_under_refunded_order refund_reports_match_the_ledger
both_outcomes_observed race_completions_consumed_credit_not_complimentary
all_race_payments_marked_refunded exactly_one_refund_row_per_race_order"

RACE_GLOBALS="raceA_exactly_one_ledger_row raceA_balance_zero_not_negative
raceA_removed_exactly_the_grant raceA_one_row_for_the_crossing_id
raceA_payment_refunded raceB_exactly_one_ledger_row
raceB_balance_zero_not_negative raceB_exactly_one_winner_rest_flagged
raceB_winner_landed_exactly_on_purchase_price
raceB_losers_removed_nothing_and_are_all_flagged
raceB_removed_exactly_the_grant_once raceB_order_frozen_after_over_refund
raceB_payment_refunded race_no_negative_balance_anywhere
race_no_claw_back_on_under_refunded_order raceB_winner_redelivery_converges
raceB_loser_redelivery_converges raceB_state_unchanged_after_redeliveries"

emit_globals() {
  local list="$1" n
  if [ "$SC" = global_sql_error ]; then
    echo "psql:<stdin>:7: ERROR:  relation \"public.credit_ledger\" does not exist" >&2
    exit 3
  fi
  for n in $list; do
    if [ "$SC" = false_global ] && [ "$n" = no_negative_balance_any_user ]; then
      echo "$n|f"; continue
    fi
    if [ "$SC" = race_false_global ] && [ "$n" = race_no_negative_balance_anywhere ]; then
      echo "$n|f"; continue
    fi
    if [ "$SC" = missing_global ] && [ "$n" = both_outcomes_observed ]; then
      continue
    fi
    echo "$n|t"
  done
  [ "$SC" = undeclared_global ] && echo "surprise_undeclared_assertion|t"
  exit 0
}

case "$SQL" in
  # Assertion blocks are matched FIRST. They are the most specific inputs, and
  # the refund-race block legitimately mentions refund ids like RF-RA-CROSS in
  # its SQL, so a racer pattern placed earlier would swallow it and answer with
  # a tally instead of assertion rows.
  *no_negative_balance_any_user*) emit_globals "$USER_GLOBALS" ;;
  *raceA_exactly_one_ledger_row*) emit_globals "$RACE_GLOBALS" ;;

  *rehearse2c_race_seed_round*)
    echo "11111111-1111-1111-1111-111111111111"; exit 0 ;;

  *complete_session_and_consume_entitlement*)
    case "$SC" in
      racer_exit)
        echo "psql: error: connection to server failed: FATAL: EMAXCONNSESSION" >&2
        exit 2 ;;
      unparseable)
        echo '{"unexpected": "shape"}'; exit 0 ;;
      complimentary)
        echo '{"ok": true, "source": "complimentary", "already_completed": false}'; exit 0 ;;
      *)
        echo '{"ok": true, "source": "credit", "already_completed": false}'; exit 0 ;;
    esac ;;

  *rehearse2c_race_verdict*)
    if [ "$SC" = verdict_negative ]; then
      echo '{"round": 1, "balance": -1, "session_debits": 1, "refund_debits": 1, "completed_sessions": 1, "draft_sessions": 0, "reports": 1, "refund_rows": 1, "refund_result": "credits_removed", "credits_removed": 1, "payment_status": "refunded"}'
    else
      echo '{"round": 1, "balance": 0, "session_debits": 1, "refund_debits": 0, "completed_sessions": 1, "draft_sessions": 0, "reports": 1, "refund_rows": 1, "refund_result": "no_credits_to_remove", "credits_removed": 0, "payment_status": "refunded"}'
    fi
    exit 0 ;;

  *RF-UR-*)
    if [[ "$SQL" == *"->> 'result'"* ]]; then
      # Replay pass.
      if [ "$SC" = replay_drift ]; then echo "credits_removed"; else echo "already_processed"; fi
      exit 0
    fi
    if [ "$SC" = verdict_negative ]; then
      echo '{"ok": true, "result": "credits_removed", "credits_removed": 1, "balance_before": 1}'
    else
      echo '{"ok": true, "result": "no_credits_to_remove", "credits_removed": 0}'
    fi
    exit 0 ;;

  *RF-RA-CROSS*)
    if [ "$SC" = race_racer_exit ] && mkdir "$ST/a-died" 2>/dev/null; then
      echo "psql: error: could not connect to server" >&2; exit 2
    fi
    if [ "$SC" != race_tally_drift ] && mkdir "$ST/a-winner" 2>/dev/null; then
      echo "credits_removed"
    else
      echo "already_processed"
    fi
    exit 0 ;;

  *RF-RB-*)
    if [ "$SC" != race_tally_drift ] && mkdir "$ST/b-winner" 2>/dev/null; then
      echo "credits_removed"
    else
      echo "conflict_over_refund"
    fi
    exit 0 ;;

  *)
    # Diagnostics block.
    echo " (diagnostic output suppressed in selftest)"
    exit 0 ;;
esac
STUB
chmod +x "$STUB/psql"

# ---------------------------------------------------------------------------
# run_scenario <scenario> <expect: zero|nonzero> <script> [args...]
# ---------------------------------------------------------------------------
run_scenario() {
  local sc="$1" expect="$2"
  shift 2
  local log="$STATE/log-$sc.txt" rc verdict

  rm -rf "$STATE"/a-winner "$STATE"/b-winner "$STATE"/a-died

  (
    cd "$ROOT" || exit 99
    SELFTEST_SCENARIO="$sc" SELFTEST_STATE="$STATE" \
      PATH="$STUB:$PATH" BRANCH_URL="postgres://selftest/stub" \
      bash "$@"
  ) >"$log" 2>&1
  rc=$?

  if [ "$expect" = zero ]; then
    if [ "$rc" -eq 0 ]; then verdict="pass"; else verdict="FAIL"; fi
  else
    if [ "$rc" -ne 0 ]; then verdict="pass"; else verdict="FAIL"; fi
  fi

  if [ "$verdict" = pass ]; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi

  printf '  %-18s expect=%-8s exit=%-3s %s\n' "$sc" "$expect" "$rc" "$verdict"

  # Show the evidence: the first failure line the harness produced, or the
  # success banner. This is what makes the proof readable in a report.
  if [ "$expect" = nonzero ]; then
    grep -m2 '^   FAIL' "$log" | sed 's/^/       /'
  else
    grep -m1 -E 'ALL .* PASSED' "$log" | sed 's/^/       /'
  fi
  if [ "$verdict" = FAIL ]; then
    echo "       --- full log for failed scenario ---"
    sed 's/^/       /' "$log" | tail -25
  fi
}

echo "== harness self-test: user-race script =="
run_scenario healthy           zero    scripts/rehearse-2c-user-race.sh 2
run_scenario false_global      nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario missing_global    nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario undeclared_global nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario global_sql_error  nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario racer_exit        nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario unparseable       nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario complimentary     nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario replay_drift      nonzero scripts/rehearse-2c-user-race.sh 2
run_scenario verdict_negative  nonzero scripts/rehearse-2c-user-race.sh 2

echo ""
echo "== harness self-test: refund-race script =="
run_scenario race_healthy      zero    scripts/rehearse-2c-race.sh 3
run_scenario race_false_global nonzero scripts/rehearse-2c-race.sh 3
run_scenario race_tally_drift  nonzero scripts/rehearse-2c-race.sh 3
run_scenario race_racer_exit   nonzero scripts/rehearse-2c-race.sh 3

echo ""
echo "== self-test summary: $PASSED passed, $FAILED failed =="
if [ "$FAILED" -ne 0 ]; then
  echo "HARNESS SELF-TEST FAILED"
  exit 1
fi
echo "HARNESS SELF-TEST PASSED"
exit 0
