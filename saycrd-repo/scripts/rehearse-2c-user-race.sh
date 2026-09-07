#!/usr/bin/env bash
# scripts/rehearse-2c-user-race.sh
#
# RUN ONLY ON A DISPOSABLE SUPABASE BRANCH.
#
# Races a REAL complete_session_and_consume_entitlement against a REAL
# full-refund process_square_refund for the same user, over exactly one
# credit, repeatedly.
#
# This is the test that was missing. Every earlier concurrency rehearsal raced
# refunds against refunds, and those all serialize on the order advisory lock,
# so no number of them could ever detect that session completion serializes on
# the USER instead. Before the per-user lock was added to process_square_refund
# the two paths shared no lock at all, and both could spend the same credit.
#
# Each round is a fresh user with a fresh order and one draft session, so the
# two racers contend for exactly one credit. Which one wins is nondeterministic
# and BOTH outcomes are correct:
#
#   completion wins -> session completed + report written, refund then finds a
#                      zero balance and removes nothing (no_credits_to_remove)
#   refund wins     -> credit clawed back, completion then finds no entitlement
#                      and leaves the session in draft
#
# What must be true every single time, whichever wins:
#   * the balance is 0 and never negative
#   * exactly ONE debit exists for that user, not two
#   * a completed session always has its report, and is never reverted
#   * the refund removed a credit at most once
#   * redelivering the refund changes nothing
#
# NEGATIVE CONTROL — this rehearsal has been shown to FAIL when the fix is
# absent, which is the only way to know it tests anything. Re-apply the Stage
# 2C migration with the single line
#
#   perform pg_advisory_xact_lock(hashtext(v_pay.user_id::text));
#
# removed from process_square_refund, then run this script. Round 1 reproduces
# the defect immediately: completion returns source=credit, the refund returns
# credits_removed with balance_before=1, and the verdict is
#
#   {"balance": -1, "session_debits": 1, "refund_debits": 1, ...}
#
# — two debits against one credit. With the lock in place, every round passes.
#
# ---------------------------------------------------------------------------
# ENFORCEMENT (this is what the repair changed)
#
# Every check in this script now feeds the exit code. Previously the block of
# global SQL assertions was printed as a `test | pass` table and never parsed,
# so a run could print `no_negative_balance_any_user | f` and still report
# "ALL ROUNDS PASSED" with exit 0 — only the per-round checks counted. A
# racer that died (a pooler connection error, say) was also invisible: its
# label became the cosmetic string "UNPARSED", and as long as the other racer
# spent the credit the round still passed, so a run could report full
# contention it never actually achieved.
#
# Now:
#   * every global assertion is declared by name and parsed; missing, false,
#     NULL, unrecognized and undeclared rows are all failures
#   * a nonzero psql exit from either racer is a failure
#   * an empty, unparseable, or out-of-contract racer result is a failure
#   * an outcome that is legal for the RPC but meaningless for THIS race is a
#     failure too — notably consumed:complimentary, which would mean the
#     fixture stopped exhausting the free allowance and the race never touched
#     the credit at all
#   * a round counts as valid contention only when both racers completed and
#     returned recognized results, and the run fails unless every round was
#     valid contention
#   * "ALL ROUNDS PASSED" is printed by exactly one code path, which requires
#     zero failures of any kind
#
# Diagnostics are run in a SEPARATE psql invocation from assertions, so a
# banner or detail table can never sit in the assertion stream.
# ---------------------------------------------------------------------------
#
# Usage:
#   BRANCH_URL="postgres://..." bash scripts/rehearse-2c-user-race.sh [ROUNDS]
#   ROUND_OFFSET=100 BRANCH_URL=... bash scripts/rehearse-2c-user-race.sh 12
#
# ROUND_OFFSET shifts the user/order namespace so a second run on the same
# branch starts from genuinely fresh state instead of inheriting the previous
# run's committed rows. Cleaning up instead is not an option: credit_ledger
# rows are referenced by session_entitlement_usage, so deleting them trips a
# foreign key.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/rehearse-assert.sh
. "$HERE/rehearse-assert.sh"

URL="${BRANCH_URL:?BRANCH_URL must be set to the disposable branch connection string}"
ROUNDS="${1:-12}"
OFFSET="${ROUND_OFFSET:-0}"
OUT="$(mktemp -d)"
VALID_ROUNDS=0
ROUND_ID=""

cleanup() { rm -rf "$OUT"; }
trap cleanup EXIT

# assert_round <name> <expected> <actual> — quiet on success; the per-round
# table already shows the outcome. Sets ROUND_BAD on failure.
assert_round() {
  REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
  if [ "$2" = "$3" ]; then
    return 0
  fi
  rehearse_fail "round $ROUND_ID/$1: expected '$2', got '$3'"
  ROUND_BAD=1
  return 1
}

echo "== installing race fixtures =="
if ! psql "$URL" -v ON_ERROR_STOP=1 -q --no-psqlrc -f "$HERE/rehearse-2c-user-race-setup.sql"; then
  echo "FATAL: fixture installation failed" >&2
  exit 1
fi

echo ""
echo "== $ROUNDS rounds: session completion vs full refund, one credit each =="
printf '%-6s %-22s %-24s %-8s %-8s %s\n' round completion refund balance debits verdict

for i in $(seq 1 "$ROUNDS"); do
  r=$((OFFSET + i))
  ROUND_ID="$r"
  ROUND_BAD=0

  # Seed and capture the draft session id. Committed before the racers start.
  SESSION="$(psql "$URL" -At -q --no-psqlrc -v ON_ERROR_STOP=1 \
    -c "select public.rehearse2c_race_seed_round($r);")"
  if [ $? -ne 0 ] || [ -z "${SESSION//[[:space:]]/}" ]; then
    rehearse_fail "round $r: seed failed (fixture refused or connection died): ${SESSION:-<empty>}"
    printf '%-6s %-22s %-24s %-8s %-8s %s\n' "$r" "SEED-FAILED" "-" "-" "-" "FAIL"
    continue
  fi

  # Two SEPARATE connections. This is the only way to get a real race: issuing
  # both calls from one session would serialize trivially and prove nothing.
  psql "$URL" -At -q --no-psqlrc -v ON_ERROR_STOP=1 -c \
    "select public.complete_session_and_consume_entitlement(
       '$SESSION'::uuid,
       public.rehearse2c_race_user($r),
       '{\"race\":true}'::jsonb, '{\"race\":true}'::jsonb, null
     )::text;" >"$OUT/c-$r.txt" 2>&1 &
  CPID=$!

  psql "$URL" -At -q --no-psqlrc -v ON_ERROR_STOP=1 -c \
    "select public.process_square_refund(
       'RF-UR-$r', 'PAY-UR-$r', 'COMPLETED', 1000, 'USD', 'ORD-UR-$r', 'LG8FD2SPNNAVX'
     )::text;" >"$OUT/r-$r.txt" 2>&1 &
  RPID=$!

  wait "$CPID"
  CRC=$?
  wait "$RPID"
  RRC=$?

  COMP="$(tr -d '\n' <"$OUT/c-$r.txt")"
  REF="$(tr -d '\n' <"$OUT/r-$r.txt")"

  # A racer that failed to run at all is a failure, not a cosmetic label.
  RACERS_OK=1
  rehearse_check_racer "round $r completion" "$CRC" "$COMP" || { ROUND_BAD=1; RACERS_OK=0; }
  rehearse_check_racer "round $r refund" "$RRC" "$REF" || { ROUND_BAD=1; RACERS_OK=0; }

  COMP_LABEL="$(rehearse_classify_completion "$COMP")"
  if [ $? -ne 0 ]; then
    rehearse_fail "round $r completion: unrecognized payload: $COMP"
    ROUND_BAD=1
    RACERS_OK=0
  fi
  REF_LABEL="$(rehearse_classify_refund "$REF")"
  if [ $? -ne 0 ]; then
    rehearse_fail "round $r refund: unrecognized payload: $REF"
    ROUND_BAD=1
    RACERS_OK=0
  fi

  # Legal for the RPC is not the same as meaningful for THIS race.
  # consumed:complimentary would mean the free allowance was not exhausted and
  # the round never contended for the credit — a silently worthless round.
  case "$COMP_LABEL" in
    consumed:credit | refused:no_entitlement | refused:retry_needed) ;;
    *)
      rehearse_fail "round $r completion: '$COMP_LABEL' is not a legal outcome for this race (want consumed:credit, refused:no_entitlement or refused:retry_needed)"
      ROUND_BAD=1
      RACERS_OK=0
      ;;
  esac
  case "$REF_LABEL" in
    credits_removed | no_credits_to_remove) ;;
    *)
      rehearse_fail "round $r refund: '$REF_LABEL' is not a legal outcome for a full refund of a fully-credited order"
      ROUND_BAD=1
      RACERS_OK=0
      ;;
  esac

  V="$(psql "$URL" -At -q --no-psqlrc -v ON_ERROR_STOP=1 \
    -c "select public.rehearse2c_race_verdict($r)::text;")"
  VRC=$?
  if [ "$VRC" -ne 0 ] || [ -z "${V//[[:space:]]/}" ]; then
    rehearse_fail "round $r: verdict query failed (exit $VRC): ${V:-<empty>}"
    printf '%-6s %-22s %-24s %-8s %-8s %s\n' "$r" "$COMP_LABEL" "$REF_LABEL" "-" "-" "FAIL"
    continue
  fi

  jkey() { sed -n "s/.*\"$1\" *: *\"\{0,1\}\(-\{0,1\}[a-z0-9_]*\)\"\{0,1\}.*/\1/p" <<<"$V"; }
  BAL="$(jkey balance)"
  SD="$(jkey session_debits)"
  RD="$(jkey refund_debits)"
  CS="$(jkey completed_sessions)"
  DS="$(jkey draft_sessions)"
  RP="$(jkey reports)"
  RR="$(jkey refund_rows)"
  CR="$(jkey credits_removed)"
  PS="$(jkey payment_status)"

  # Every numeric field must actually be a number. An empty capture used to
  # sail through `$((SD + RD))`, because bash silently treats "" as 0.
  for pair in "balance:$BAL" "session_debits:$SD" "refund_debits:$RD" \
    "completed_sessions:$CS" "draft_sessions:$DS" "reports:$RP" \
    "refund_rows:$RR" "credits_removed:$CR"; do
    REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
    if ! rehearse_is_int "${pair#*:}"; then
      rehearse_fail "round $r/${pair%%:*}: not an integer ('${pair#*:}') — verdict shape changed or query truncated"
      ROUND_BAD=1
    fi
  done

  if [ "$ROUND_BAD" -eq 0 ]; then
    # Core invariants.
    assert_round balance 0 "$BAL"
    assert_round total_debits 1 "$((SD + RD))"
    assert_round refund_debits_at_most_one 1 "$((RD <= 1 ? 1 : 0))"
    assert_round completed_matches_reports "$CS" "$RP"
    assert_round exactly_one_session 1 "$((CS + DS))"
    assert_round refund_recorded_once 1 "$RR"
    assert_round refund_report_matches_ledger "$RD" "$CR"
    # A full refund of a fully-credited order marks the payment refunded in
    # BOTH outcomes: 2C sets it whenever the cumulative total covers the
    # purchase, independently of whether any credit was left to remove.
    assert_round payment_status refunded "$PS"
    # Cross-check the RPC's own answer against committed state.
    assert_round completion_claim_matches_ledger \
      "$([ "$COMP_LABEL" = "consumed:credit" ] && echo 1 || echo 0)" "$SD"
    assert_round refund_claim_matches_ledger \
      "$([ "$REF_LABEL" = "credits_removed" ] && echo 1 || echo 0)" "$RD"
  fi

  if [ "$ROUND_BAD" -eq 0 ] && [ "$RACERS_OK" -eq 1 ]; then
    VALID_ROUNDS=$((VALID_ROUNDS + 1))
    ROUND_VERDICT=pass
  else
    ROUND_VERDICT=FAIL
    echo "  --- round $r detail ---"
    echo "  completion: $COMP"
    echo "  refund    : $REF"
    echo "  verdict   : $V"
  fi

  printf '%-6s %-22s %-24s %-8s %-8s %s\n' \
    "$r" "$COMP_LABEL" "$REF_LABEL" "$BAL" "$((SD + RD))" "$ROUND_VERDICT"
done

# Contention is the premise of the whole exercise, so it is asserted, not
# assumed: every round must have been a genuine two-racer contest.
REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
if [ "$VALID_ROUNDS" -ne "$ROUNDS" ]; then
  rehearse_fail "valid contention rounds: expected $ROUNDS, got $VALID_ROUNDS"
else
  rehearse_ok "all $ROUNDS rounds were valid contention"
fi

echo ""
echo "== replay: redeliver every refund, nothing may change =="
# Batched at 8. Supabase's session-mode pooler caps concurrent clients at 15,
# and exceeding it produces EMAXCONNSESSION connection errors that look like
# refund failures but are purely a harness limit. The races above stay under
# the cap because they use two connections per round.
BATCH=8
RP_PIDS=()
RP_ROUNDS=()

drain_replay() {
  local k rc
  for k in "${!RP_PIDS[@]}"; do
    wait "${RP_PIDS[$k]}"
    rc=$?
    REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
    if [ "$rc" -ne 0 ]; then
      rehearse_fail "replay round ${RP_ROUNDS[$k]}: psql exited $rc"
    fi
  done
  RP_PIDS=()
  RP_ROUNDS=()
}

for i in $(seq 1 "$ROUNDS"); do
  r=$((OFFSET + i))
  psql "$URL" -At -q --no-psqlrc -v ON_ERROR_STOP=1 -c \
    "select public.process_square_refund(
       'RF-UR-$r', 'PAY-UR-$r', 'COMPLETED', 1000, 'USD', 'ORD-UR-$r', 'LG8FD2SPNNAVX'
     ) ->> 'result';" >"$OUT/replay-$r.txt" 2>&1 &
  RP_PIDS+=("$!")
  RP_ROUNDS+=("$r")
  if [ "${#RP_PIDS[@]}" -ge "$BATCH" ]; then drain_replay; fi
done
drain_replay

echo "-- replay outcomes --"
cat "$OUT"/replay-*.txt | sort | uniq -c | sed 's/^/   /'

# Every refund in this race reaches a terminal result (credits_removed or
# no_credits_to_remove), and 2C short-circuits terminal results, so every
# redelivery must answer already_processed. Anything else — including a
# connection error dressed up as output — is a failure.
for i in $(seq 1 "$ROUNDS"); do
  r=$((OFFSET + i))
  REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
  RPV="$(tr -d '\n' <"$OUT/replay-$r.txt" 2>/dev/null)"
  if [ "$RPV" != "already_processed" ]; then
    rehearse_fail "replay round $r: expected 'already_processed', got '${RPV:-<empty>}'"
  fi
done

echo ""
echo "== global assertions over every round =="

GLOBAL_SQL="$(
  cat <<'SQL'
-- The headline invariant. A single negative balance anywhere is the bug this
-- whole exercise exists to rule out.
select 'no_negative_balance_any_user' as test,
       not exists (
         select 1 from public.credit_ledger group by user_id having sum(delta) < 0
       ) as pass;

select 'every_race_user_landed_on_zero' as test,
       not exists (
         select 1 from public.credit_ledger l
         join auth.users u on u.id = l.user_id
         where u.email like 'c2c-race-%@rehearsal.test'
         group by l.user_id having sum(l.delta) <> 0
       ) as pass;

-- Exactly one debit per round: the credit was spent once, by one of the two
-- racers. Two debits would mean both spent it.
select 'exactly_one_debit_per_race_user' as test,
       not exists (
         select 1 from public.credit_ledger l
         join auth.users u on u.id = l.user_id
         where u.email like 'c2c-race-%@rehearsal.test' and l.delta < 0
         group by l.user_id having count(*) <> 1
       ) as pass;

-- At most one refund ledger row per order, regardless of replays.
select 'at_most_one_refund_row_per_order' as test,
       not exists (
         select 1 from public.credit_ledger
         where reason = 'refund' and square_order_id like 'ORD-UR-%'
         group by square_order_id having count(*) > 1
       ) as pass;

-- Completed sessions are never reverted, and completing one always writes a
-- report. (Asserted as a match, not as "refunds create no reports" — an
-- earlier version of a sibling script got that backwards.)
select 'completed_sessions_match_reports' as test,
       (select count(*) from public.sessions s join auth.users u on u.id = s.user_id
         where u.email like 'c2c-race-%@rehearsal.test' and s.status = 'completed')
       =
       (select count(*) from public.reports r join auth.users u on u.id = r.user_id
         where u.email like 'c2c-race-%@rehearsal.test') as pass;

select 'no_race_session_left_in_limbo' as test,
       not exists (
         select 1 from public.sessions s join auth.users u on u.id = s.user_id
         where u.email like 'c2c-race-%@rehearsal.test'
           and s.status not in ('draft', 'completed')
       ) as pass;

-- A claw-back may only exist where the customer was actually made whole.
select 'no_claw_back_on_under_refunded_order' as test,
       not exists (
         select 1 from public.credit_ledger l
         join public.square_payments p on p.square_order_id = l.square_order_id
         where l.reason = 'refund' and l.square_order_id like 'ORD-UR-%'
           and coalesce((select sum(r.amount_cents) from public.square_refunds r
                          where r.square_order_id = l.square_order_id
                            and r.refund_status = 'COMPLETED'), 0) < p.amount_cents
       ) as pass;

-- Where the refund reported removing credits, the ledger must agree; where it
-- reported removing none, there must be no refund row at all.
select 'refund_reports_match_the_ledger' as test,
       not exists (
         select 1 from public.square_refunds r
         where r.square_order_id like 'ORD-UR-%'
           and r.credits_removed <>
               coalesce((select -sum(l.delta) from public.credit_ledger l
                          where l.square_order_id = r.square_order_id
                            and l.reason = 'refund'), 0)
       ) as pass;

-- Both outcomes must actually have occurred across the rounds, otherwise the
-- race never really raced and the run proves much less than it appears to.
select 'both_outcomes_observed' as test,
       (select count(distinct result_code) from public.square_refunds
         where square_order_id like 'ORD-UR-%') > 1 as pass;

-- The race is only meaningful if completion drew on the CREDIT. If the
-- fixture ever stopped exhausting the complimentary allowance, every round
-- would still show one debit and silently prove nothing.
select 'race_completions_consumed_credit_not_complimentary' as test,
       not exists (
         select 1 from public.session_entitlement_usage seu
         join auth.users u on u.id = seu.user_id
         where u.email like 'c2c-race-%@rehearsal.test'
           and seu.source <> 'credit'
       ) as pass;

-- A full refund covers the purchase in both outcomes, so every race payment
-- must end up marked refunded. This also closes the purchase path: Stage 2A
-- treats 'refunded' as conflict_status, so a replayed payment webhook cannot
-- re-credit any of these orders.
select 'all_race_payments_marked_refunded' as test,
       not exists (
         select 1 from public.square_payments
         where square_order_id like 'ORD-UR-%' and status <> 'refunded'
       ) as pass;

-- One refund row per order, no duplicates from the replay pass.
select 'exactly_one_refund_row_per_race_order' as test,
       not exists (
         select 1 from public.square_refunds
         where square_order_id like 'ORD-UR-%'
         group by square_order_id having count(*) <> 1
       ) as pass;
SQL
)"

GLOBAL_NAMES=(
  no_negative_balance_any_user
  every_race_user_landed_on_zero
  exactly_one_debit_per_race_user
  at_most_one_refund_row_per_order
  completed_sessions_match_reports
  no_race_session_left_in_limbo
  no_claw_back_on_under_refunded_order
  refund_reports_match_the_ledger
  both_outcomes_observed
  race_completions_consumed_credit_not_complimentary
  all_race_payments_marked_refunded
  exactly_one_refund_row_per_race_order
)

rehearse_assert_sql "$URL" globals "$GLOBAL_SQL" "${GLOBAL_NAMES[@]}"

rehearse_run_diagnostics "$URL" "outcome distribution and ledger shape" "$(
  cat <<'SQL'
select result_code, count(*) as rounds, sum(credits_removed) as credits_removed
from public.square_refunds
where square_order_id like 'ORD-UR-%'
group by result_code
order by result_code;

select l.square_order_id,
       string_agg(l.reason || ':' || l.delta, ' ' order by l.id) as ledger
from public.credit_ledger l
where l.square_order_id like 'ORD-UR-%'
   or l.user_id in (select id from auth.users where email like 'c2c-race-%@rehearsal.test')
group by l.square_order_id
order by l.square_order_id;
SQL
)"

rehearse_exit "user-race rehearsal ($ROUNDS rounds)" "ALL $ROUNDS ROUNDS PASSED"
