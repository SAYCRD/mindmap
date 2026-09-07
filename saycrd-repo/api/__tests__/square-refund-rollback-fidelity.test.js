// api/__tests__/square-refund-rollback-fidelity.test.js
//
// Static assertions over the refund SQL. These are the checks a reviewer would
// otherwise have to perform by eye on ~600 lines of migration, and that an
// audit already caught once: the Stage 2C rollback dropped columns the
// still-installed Stage 2C function required, while its "restore Stage 2B"
// step was only a comment.
//
// Nothing here executes SQL. That is deliberate — these are properties of the
// TEXT (is the restore real, is the copy identical, is the lock taken in the
// right order), and text is exactly what a mocked database cannot check. The
// behavioural proofs live in scripts/rehearse-*.sql against real Postgres.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const STAGE_2B = path.join(MIGRATIONS, '20260907140000_square_refund_support.sql');
const STAGE_2C = path.join(MIGRATIONS, '20260907160000_square_refund_cumulative.sql');
const ROLLBACK_2C = path.join(MIGRATIONS, 'ROLLBACK_20260907160000_REVIEW_ONLY.sql');
const SESSION_RPC = path.join(
  MIGRATIONS,
  '20260906080000_create_complete_session_entitlement_rpc.sql'
);

const read = (p) => fs.readFileSync(p, 'utf8');

// Extract a `create or replace function <name>(` ... `$function$;` block.
function extractFunction(sql, name) {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) =>
    l.startsWith(`create or replace function public.${name}(`)
  );
  assert.notEqual(start, -1, `definition of ${name} not found`);
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === '$function$;') {
      end = i;
      break;
    }
  }
  assert.notEqual(end, -1, `end of ${name} not found`);
  return lines.slice(start, end + 1).join('\n');
}

// Strip comment-only lines, so an assertion about executable SQL cannot be
// satisfied (or broken) by prose.
function executableLines(sql) {
  return sql
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('--'));
}

test('the 2C rollback actually executes a function restore, not a comment describing one', () => {
  const rollback = read(ROLLBACK_2C);
  const exec = executableLines(rollback);

  assert.ok(
    exec.some((l) => l.startsWith('create or replace function public.process_square_refund(')),
    'the rollback must contain a real CREATE OR REPLACE for process_square_refund. ' +
      'A comment instructing the operator to re-run the Stage 2B migration is not a restore: ' +
      'if they skip it, the Stage 2C function stays installed.'
  );
});

test('the rollback restores a function byte-identical to Stage 2B', () => {
  const canonical = extractFunction(read(STAGE_2B), 'process_square_refund');
  const inlined = extractFunction(read(ROLLBACK_2C), 'process_square_refund');

  assert.equal(
    inlined,
    canonical,
    'the Stage 2B function inlined into the rollback has drifted from the canonical ' +
      'definition in 20260907140000_square_refund_support.sql. Re-inline it rather than ' +
      'hand-editing the copy.'
  );
});

test('the restored function is Stage 2B, not a second copy of Stage 2C', () => {
  const inlined = extractFunction(read(ROLLBACK_2C), 'process_square_refund');

  assert.ok(
    !inlined.includes('cumulative_refunded_cents'),
    'the rollback inlined the Stage 2C function; rolling back would then be a no-op'
  );
  assert.ok(
    !inlined.includes('conflict_over_refund'),
    'the rollback inlined cumulative over-refund handling, which Stage 2B does not have'
  );
});

test('the rollback never drops the reconciliation columns in executable SQL', () => {
  const exec = executableLines(read(ROLLBACK_2C)).join('\n');

  for (const column of ['cumulative_refunded_cents', 'purchase_amount_cents']) {
    assert.ok(
      !new RegExp(`drop\\s+column\\s+(if\\s+exists\\s+)?${column}`, 'i').test(exec),
      `the rollback drops ${column} unconditionally. That column is the only record of how ` +
        'an already-decided refund was decided, and a rollback must not delete the audit ' +
        'trail of decisions it is reversing. The guarded, opt-in block must stay commented out.'
    );
  }

  assert.ok(
    !/drop\s+index\s+(if\s+exists\s+)?public\.ix_square_refunds_open_reconciliation/i.test(exec),
    'the rollback drops the reconciliation index, which Stage 2B also needs for its review queue'
  );
});

test('the destructive column-drop block is guarded by an evidence check', () => {
  const rollback = read(ROLLBACK_2C);

  // The block is commented out. What matters is that anyone who uncomments it
  // gets the guard along with it, rather than a bare ALTER TABLE.
  const dropIdx = rollback.indexOf('drop column if exists cumulative_refunded_cents');
  assert.notEqual(dropIdx, -1, 'the optional drop block is missing entirely');

  // Everything before the DROP must already contain the refusal: the count of
  // rows carrying evidence, a raise, and the message explaining it. `raise
  // exception` precedes its own message string, so both are checked against
  // the whole preamble rather than a slice from one of them.
  const preamble = rollback.slice(0, dropIdx);

  assert.ok(
    preamble.includes('Refusing to drop the Stage 2C reconciliation columns'),
    'the optional drop is not preceded by a guard that refuses when evidence exists'
  );
  assert.ok(
    preamble.includes('raise exception'),
    'the guard must raise, not merely warn'
  );
  assert.ok(
    preamble.includes('where cumulative_refunded_cents is not null'),
    'the guard must actually count the rows that would lose evidence'
  );
});

test('both refund functions take the per-user lock with session completion’s exact key', () => {
  // The bug this pins: locking the order is not enough, because session
  // completion serializes on the USER. Two different keys means no mutual
  // exclusion, and a refund plus a completion can both spend the last credit.
  const sessionSql = read(SESSION_RPC);
  assert.ok(
    sessionSql.includes('pg_advisory_xact_lock(hashtext(p_user_id::text))'),
    'session completion no longer uses hashtext(p_user_id::text); the refund lock key ' +
      'must be updated to match whatever it uses now'
  );

  for (const [label, file] of [
    ['Stage 2B', STAGE_2B],
    ['Stage 2C', STAGE_2C],
    ['2C rollback', ROLLBACK_2C],
  ]) {
    const fn = extractFunction(read(file), 'process_square_refund');
    assert.ok(
      fn.includes('pg_advisory_xact_lock(hashtext(v_pay.user_id::text))'),
      `${label}'s process_square_refund does not take the per-user advisory lock. ` +
        'hashtext(v_pay.user_id::text) must match session completion’s ' +
        'hashtext(p_user_id::text) exactly — a similar-looking key serializes nothing.'
    );
  }
});

test('the order lock is always acquired before the user lock', () => {
  // Deadlock freedom rests entirely on a consistent acquisition order. Any
  // future edit that reverses these two lines reintroduces the possibility of
  // a cycle, so the order is asserted rather than trusted to review.
  for (const [label, file] of [
    ['Stage 2B', STAGE_2B],
    ['Stage 2C', STAGE_2C],
    ['2C rollback', ROLLBACK_2C],
  ]) {
    const fn = extractFunction(read(file), 'process_square_refund');
    const orderLock = fn.indexOf('pg_advisory_xact_lock(hashtext(v_order_id))');
    const userLock = fn.indexOf('pg_advisory_xact_lock(hashtext(v_pay.user_id::text))');

    assert.notEqual(orderLock, -1, `${label}: order lock missing`);
    assert.notEqual(userLock, -1, `${label}: user lock missing`);
    assert.ok(
      orderLock < userLock,
      `${label}: the user lock is acquired before the order lock. Every caller must take ` +
        'these in the same order (order, then user) or two transactions can deadlock.'
    );
  }
});

test('the user lock is held before any balance read or ledger write', () => {
  // Acquiring the lock after reading the balance would be worthless: the read
  // it is meant to protect would already have happened.
  for (const [label, file] of [
    ['Stage 2B', STAGE_2B],
    ['Stage 2C', STAGE_2C],
  ]) {
    const fn = extractFunction(read(file), 'process_square_refund');
    const userLock = fn.indexOf('pg_advisory_xact_lock(hashtext(v_pay.user_id::text))');

    const balanceRead = fn.indexOf('select coalesce(sum(delta), 0) into v_balance');
    assert.notEqual(balanceRead, -1, `${label}: balance read not found`);
    assert.ok(
      userLock < balanceRead,
      `${label}: the balance is read before the per-user lock is held, so the value can be ` +
        'stale by the time it is used'
    );

    const ledgerWrite = fn.indexOf('insert into public.credit_ledger');
    assert.notEqual(ledgerWrite, -1, `${label}: ledger insert not found`);
    assert.ok(
      userLock < ledgerWrite,
      `${label}: credits are written before the per-user lock is held`
    );
  }
});

test('the payment path still shares the order key, and takes no user lock', () => {
  // The deadlock argument depends on process_square_payment holding only the
  // order lock. If it ever starts taking the user lock too, it must take them
  // in the same order, and this test should be updated to assert that.
  const paySql = read(path.join(MIGRATIONS, '20260907120000_square_payment_atomicity.sql'));
  const fn = extractFunction(paySql, 'process_square_payment');

  assert.ok(
    fn.includes('pg_advisory_xact_lock(hashtext(btrim(p_square_order_id)))'),
    'process_square_payment no longer locks the order id, so refunds and payments for one ' +
      'order would stop serializing'
  );
  assert.ok(
    !fn.includes('user_id::text)'),
    'process_square_payment now takes a per-user advisory lock. Verify it acquires the order ' +
      'lock FIRST, then update this test — otherwise it can deadlock against a refund.'
  );
});

test('session completion takes no order lock, so it cannot invert the order', () => {
  const fn = extractFunction(read(SESSION_RPC), 'complete_session_and_consume_entitlement');

  assert.ok(
    !fn.includes('v_order_id'),
    'session completion now references an order lock. If it acquires the user lock first and ' +
      'then an order lock, it inverts the refund path’s order and the two can deadlock.'
  );
});
