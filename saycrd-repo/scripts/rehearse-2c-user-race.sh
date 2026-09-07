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
# — two debits against one credit. With the lock in place, 12/12 rounds pass.
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

URL="${BRANCH_URL:?BRANCH_URL must be set to the disposable branch connection string}"
ROUNDS="${1:-12}"
OFFSET="${ROUND_OFFSET:-0}"
OUT="$(mktemp -d)"
FAILURES=0

echo "== installing race fixtures =="
psql "$URL" -v ON_ERROR_STOP=1 -q -f scripts/rehearse-2c-user-race-setup.sql || exit 1

echo ""
echo "== $ROUNDS rounds: session completion vs full refund, one credit each =="
printf '%-6s %-22s %-24s %-8s %-8s %s\n' round completion refund balance debits verdict

for i in $(seq 1 "$ROUNDS"); do
  r=$((OFFSET + i))
  # Seed and capture the draft session id. Committed before the racers start.
  SESSION="$(psql "$URL" -At -v ON_ERROR_STOP=1 \
    -c "select public.rehearse2c_race_seed_round($r);")" || { echo "seed failed"; exit 1; }

  # Two SEPARATE connections. This is the only way to get a real race: issuing
  # both calls from one session would serialize trivially and prove nothing.
  psql "$URL" -At -c \
    "select public.complete_session_and_consume_entitlement(
       '$SESSION'::uuid,
       public.rehearse2c_race_user($r),
       '{\"race\":true}'::jsonb, '{\"race\":true}'::jsonb, null
     )::text;" >"$OUT/c-$r.txt" 2>&1 &
  CPID=$!

  psql "$URL" -At -c \
    "select public.process_square_refund(
       'RF-UR-$r', 'PAY-UR-$r', 'COMPLETED', 1000, 'USD', 'ORD-UR-$r', 'LG8FD2SPNNAVX'
     )::text;" >"$OUT/r-$r.txt" 2>&1 &
  RPID=$!

  wait $CPID; wait $RPID

  COMP="$(tr -d '\n' < "$OUT/c-$r.txt")"
  REF="$(tr -d '\n' < "$OUT/r-$r.txt")"

  # Compact labels for the table; the raw JSON is kept for failures.
  COMP_LABEL="$(sed -n 's/.*"source" *: *"\([a-z_]*\)".*/consumed:\1/p' <<<"$COMP")"
  [ -z "$COMP_LABEL" ] && COMP_LABEL="$(sed -n 's/.*"error" *: *"\([a-z_]*\)".*/refused:\1/p' <<<"$COMP")"
  [ -z "$COMP_LABEL" ] && COMP_LABEL="UNPARSED"
  REF_LABEL="$(sed -n 's/.*"result" *: *"\([a-z_]*\)".*/\1/p' <<<"$REF")"
  [ -z "$REF_LABEL" ] && REF_LABEL="UNPARSED"

  V="$(psql "$URL" -At -c "select public.rehearse2c_race_verdict($r)::text;")"
  BAL="$(sed -n 's/.*"balance" *: *\(-\?[0-9]*\).*/\1/p' <<<"$V")"
  SD="$(sed -n 's/.*"session_debits" *: *\([0-9]*\).*/\1/p' <<<"$V")"
  RD="$(sed -n 's/.*"refund_debits" *: *\([0-9]*\).*/\1/p' <<<"$V")"
  CS="$(sed -n 's/.*"completed_sessions" *: *\([0-9]*\).*/\1/p' <<<"$V")"
  RP="$(sed -n 's/.*"reports" *: *\([0-9]*\).*/\1/p' <<<"$V")"

  ROUND_OK=pass
  [ "$BAL" = "0" ] || ROUND_OK="FAIL(balance=$BAL)"
  [ "$((SD + RD))" = "1" ] || ROUND_OK="FAIL(debits=$((SD + RD)))"
  [ "$CS" = "$RP" ] || ROUND_OK="FAIL(completed=$CS reports=$RP)"
  [ "$RD" -le 1 ] || ROUND_OK="FAIL(refund_debits=$RD)"

  if [ "$ROUND_OK" != "pass" ]; then
    FAILURES=$((FAILURES + 1))
    echo "  --- round $r detail ---"
    echo "  completion: $COMP"
    echo "  refund    : $REF"
    echo "  verdict   : $V"
  fi

  printf '%-6s %-22s %-24s %-8s %-8s %s\n' \
    "$r" "$COMP_LABEL" "$REF_LABEL" "$BAL" "$((SD + RD))" "$ROUND_OK"
done

echo ""
echo "== replay: redeliver every refund, nothing may change =="
# Batched at 8. Supabase's session-mode pooler caps concurrent clients at 15,
# and exceeding it produces EMAXCONNSESSION connection errors that look like
# refund failures but are purely a harness limit. The races above stay under
# the cap because they use two connections per round.
BATCH=8
PENDING=0
for i in $(seq 1 "$ROUNDS"); do
  r=$((OFFSET + i))
  psql "$URL" -At -c \
    "select public.process_square_refund(
       'RF-UR-$r', 'PAY-UR-$r', 'COMPLETED', 1000, 'USD', 'ORD-UR-$r', 'LG8FD2SPNNAVX'
     ) ->> 'result';" >"$OUT/replay-$r.txt" 2>&1 &
  PENDING=$((PENDING + 1))
  if [ "$PENDING" -ge "$BATCH" ]; then wait; PENDING=0; fi
done
wait
echo "-- replay outcomes --"
cat "$OUT"/replay-*.txt | sort | uniq -c | sed 's/^/   /'

if grep -qi "EMAXCONNSESSION\|connection to server" "$OUT"/replay-*.txt; then
  echo "   WARNING: pooler connection limit hit; replay results above are incomplete"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "== global assertions over every round =="
psql "$URL" -v ON_ERROR_STOP=1 <<SQL
\pset pager off

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

\echo ''
\echo '-- outcome distribution across rounds --'
select result_code, count(*) as rounds, sum(credits_removed) as credits_removed
from public.square_refunds
where square_order_id like 'ORD-UR-%'
group by result_code
order by result_code;

\echo ''
\echo '-- per-round ledger shape --'
select l.square_order_id,
       string_agg(l.reason || ':' || l.delta, ' ' order by l.id) as ledger
from public.credit_ledger l
where l.square_order_id like 'ORD-UR-%'
   or l.user_id in (select id from auth.users where email like 'c2c-race-%@rehearsal.test')
group by l.square_order_id
order by l.square_order_id;
SQL

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL $ROUNDS ROUNDS PASSED"
else
  echo "$FAILURES ROUND(S) FAILED"
fi

rm -rf "$OUT"
exit "$FAILURES"
