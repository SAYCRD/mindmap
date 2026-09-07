#!/usr/bin/env bash
# scripts/rehearse-2c-race.sh — Stage 2C concurrency rehearsal.
#
# RUN ONLY ON A DISPOSABLE SUPABASE BRANCH. Requires
# scripts/rehearse-square-refunds-cumulative.sql to have run first, which
# seeds both orders with a 2000-of-3300 partial already recorded.
#
# Each psql invocation is a SEPARATE connection and therefore a separate
# transaction, which is the only way to produce a genuine race. Doing this
# inside one session would serialize trivially and prove nothing.
#
# RACE A — the same crossing refund id delivered N times at once.
#   Expect exactly 1 credits_removed and N-1 already_processed.
#
# RACE B — N DIFFERENT refund ids, each individually valid (1300 on top of a
# recorded 2000, against a 3300 purchase), all racing to complete the total.
#   Expect exactly 1 credits_removed and N-1 conflict_over_refund: the first
#   to commit takes the total to 3300, after which every other 1300 would
#   push it to 4600. This is the case a non-cumulative design gets wrong in
#   the most expensive way — it would claw back N times.
#
# Usage: BRANCH_URL="postgres://..." bash scripts/rehearse-2c-race.sh [N]

set -uo pipefail

URL="${BRANCH_URL:?BRANCH_URL must be set to the disposable branch connection string}"
N="${1:-10}"
OUT="$(mktemp -d)"

run_one() {
  local label="$1" sql="$2" file="$3"
  psql "$URL" -At -v ON_ERROR_STOP=1 -c "$sql" >"$file" 2>&1
}

# ---------------------------------------------------------------------------
# RACE A
# ---------------------------------------------------------------------------
echo "== RACE A: same refund id x$N in parallel =="
for i in $(seq 1 "$N"); do
  run_one "a$i" \
    "select public.process_square_refund('RF-RA-CROSS','PAY-RACE-A','COMPLETED',1300,'USD','ORD-RACE-A','LG8FD2SPNNAVX') ->> 'result';" \
    "$OUT/a-$i.txt" &
done
wait

echo "-- outcome tally --"
cat "$OUT"/a-*.txt | sort | uniq -c | sed 's/^/   /'

# ---------------------------------------------------------------------------
# RACE B
# ---------------------------------------------------------------------------
echo ""
echo "== RACE B: $N distinct refund ids racing to complete the same total =="
for i in $(seq 1 "$N"); do
  run_one "b$i" \
    "select public.process_square_refund('RF-RB-$i','PAY-RACE-B','COMPLETED',1300,'USD','ORD-RACE-B','LG8FD2SPNNAVX') ->> 'result';" \
    "$OUT/b-$i.txt" &
done
wait

echo "-- outcome tally --"
cat "$OUT"/b-*.txt | sort | uniq -c | sed 's/^/   /'

# ---------------------------------------------------------------------------
# Verification. The tallies above are suggestive; these assertions are the
# actual proof, because they read the committed state.
# ---------------------------------------------------------------------------
echo ""
echo "== committed state =="
psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off

select 'raceA_exactly_one_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-RACE-A') = 1 as pass;

select 'raceA_balance_zero_not_negative' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000011') = 0 as pass;

select 'raceA_removed_exactly_the_grant' as test,
       (select -sum(delta) from public.credit_ledger
         where square_order_id = 'ORD-RACE-A' and reason = 'refund') = 5 as pass;

select 'raceA_one_row_for_the_crossing_id' as test,
       (select count(*) from public.square_refunds where square_refund_id = 'RF-RA-CROSS') = 1 as pass;

select 'raceA_payment_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-RACE-A') = 'refunded' as pass;

select 'raceB_exactly_one_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-RACE-B') = 1 as pass;

select 'raceB_balance_zero_not_negative' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000012') = 0 as pass;

-- The decisive one. Without cumulative accounting every racer would have
-- looked like a lone 1300 partial, or worse, each would have clawed back.
select 'raceB_exactly_one_winner_rest_flagged' as test,
       (select count(*) from public.square_refunds
         where square_order_id = 'ORD-RACE-B' and result_code = 'credits_removed') = 1
       and (select count(*) from public.square_refunds
         where square_order_id = 'ORD-RACE-B' and result_code = 'conflict_over_refund') > 0 as pass;

-- The winner is the racer whose cumulative landed EXACTLY on the purchase
-- price. Every later racer sees a total above it and is frozen out.
select 'raceB_winner_landed_exactly_on_purchase_price' as test,
       (select cumulative_refunded_cents from public.square_refunds
         where square_order_id = 'ORD-RACE-B' and result_code = 'credits_removed') = 3300 as pass;

select 'raceB_losers_removed_nothing_and_are_all_flagged' as test,
       (select bool_and(credits_removed = 0 and requires_review)
          from public.square_refunds
         where square_order_id = 'ORD-RACE-B' and result_code = 'conflict_over_refund') as pass;

select 'raceB_removed_exactly_the_grant_once' as test,
       (select -sum(delta) from public.credit_ledger
         where square_order_id = 'ORD-RACE-B' and reason = 'refund') = 5 as pass;

-- Note on the recorded totals: the losers' cumulative figures cascade
-- (4600, 5900, ... ) because each flagged row is preserved with its real
-- COMPLETED status and therefore still counts in the next racer's baseline.
-- That is deliberate. Once an order is over-refunded it stays frozen: no
-- later refund on it can ever produce another claw-back, which is the
-- fail-safe direction. The figures are honest about the order being far past
-- its purchase price — and this 10-way race is synthetic anyway, since Square
-- will not issue ten separate 1300 refunds against a 3300 payment.
select 'raceB_order_frozen_after_over_refund' as test,
       (select count(*) from public.square_refunds
         where square_order_id = 'ORD-RACE-B'
           and result_code = 'credits_removed') = 1 as pass;

select 'raceB_payment_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-RACE-B') = 'refunded' as pass;

select 'race_no_negative_balance_anywhere' as test,
       not exists (select 1 from public.credit_ledger group by user_id having sum(delta) < 0) as pass;

-- No claw-back on an order the customer has not been made whole on. Stated
-- as `<` rather than `<>`, because preserved over-refund rows legitimately
-- push a total above the purchase price.
select 'race_no_claw_back_on_under_refunded_order' as test,
       not exists (
         select 1
         from public.credit_ledger l
         join public.square_payments p on p.square_order_id = l.square_order_id
         where l.reason = 'refund'
           and coalesce((select sum(r.amount_cents) from public.square_refunds r
                         where r.square_order_id = l.square_order_id
                           and r.refund_status = 'COMPLETED'), 0) < p.amount_cents
       ) as pass;

-- Convergence under the cascade. WHICH racer wins is nondeterministic, so
-- the winner and a loser are discovered from the committed state rather than
-- hardcoded — an earlier version of this script asserted RF-RB-1 was the
-- winner and failed the moment a different racer got there first.
select 'raceB_winner_redelivery_converges' as test,
       (public.process_square_refund(
          (select square_refund_id from public.square_refunds
            where square_order_id = 'ORD-RACE-B' and result_code = 'credits_removed' limit 1),
          'PAY-RACE-B', 'COMPLETED', 1300, 'USD', 'ORD-RACE-B', 'LG8FD2SPNNAVX')
         ->> 'result') = 'already_processed' as pass;

-- A loser recomputes rather than short-circuiting, because
-- conflict_over_refund is deliberately non-terminal: if a human repairs the
-- data, the next delivery should get a fresh answer. It must still refuse.
select 'raceB_loser_redelivery_converges' as test,
       (public.process_square_refund(
          (select square_refund_id from public.square_refunds
            where square_order_id = 'ORD-RACE-B' and result_code = 'conflict_over_refund' limit 1),
          'PAY-RACE-B', 'COMPLETED', 1300, 'USD', 'ORD-RACE-B', 'LG8FD2SPNNAVX')
         ->> 'result') = 'conflict_over_refund' as pass;

select 'raceB_state_unchanged_after_redeliveries' as test,
       public.rehearse2c_refund_ledger_rows('ORD-RACE-B') = 1
       and public.rehearse2c_balance('c0000000-0000-0000-0000-000000000012') = 0 as pass;

\echo ''
\echo '-- per-refund detail for ORD-RACE-B --'
-- Boolean columns are rendered as words here, not t/f, so this diagnostic
-- table cannot be mistaken for a failed assertion when the output is scanned
-- for a `| f` pass column.
select square_refund_id, refund_status, amount_cents, cumulative_refunded_cents,
       result_code,
       case when requires_review then 'review' else 'clear' end as review,
       credits_removed
from public.square_refunds
where square_order_id = 'ORD-RACE-B'
order by id;
SQL

rm -rf "$OUT"
