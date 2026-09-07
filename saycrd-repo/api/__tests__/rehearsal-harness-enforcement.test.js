// api/__tests__/rehearsal-harness-enforcement.test.js
//
// Static assertions over the Stage 2C rehearsal harnesses, plus one live run
// of their self-test.
//
// These scripts are the only thing standing between a concurrency defect and
// production, and an audit found that they could not fail: the block of SQL
// assertions was printed as a `test | pass` table and never parsed, so a run
// could print `no_negative_balance_any_user | f` and still report
// "ALL ROUNDS PASSED" with exit 0. rehearse-2c-race.sh had no exit-code logic
// at all — it ended on `rm -rf`, so it exited 0 unconditionally, and its own
// comments instructed a human to scan the output for `| f`.
//
// The properties below are the ones that make the harness self-enforcing. They
// are checked as TEXT because that is what catches an assertion being added to
// the SQL and never declared, or a future edit reintroducing the count-wrapping
// `exit "$FAILURES"`. The behavioural proof that the harness can fail lives in
// scripts/rehearse-2c-harness-selftest.sh, which this file also executes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const LIB = path.join(SCRIPTS, 'rehearse-assert.sh');
const USER_RACE = path.join(SCRIPTS, 'rehearse-2c-user-race.sh');
const REFUND_RACE = path.join(SCRIPTS, 'rehearse-2c-race.sh');
const SELFTEST = path.join(SCRIPTS, 'rehearse-2c-harness-selftest.sh');

const read = (p) => fs.readFileSync(p, 'utf8');

// Pull out every `<PREFIX>_SQL="$( cat <<SQL ... SQL )"` heredoc.
//
// The delimiter may be quoted (<<'SQL', no expansion) or unquoted (<<SQL, which
// the globals block needs so it can interpolate $ROUND_LIST and scope itself to
// the current run). Matching only the quoted form meant the globals block
// stopped being extracted the moment it gained interpolation, which silently
// dropped it from every check in this file — caught only by re-running the
// suite from a clean checkout. Both forms must be recognized.
// One definition, used everywhere. This pattern was previously duplicated
// inline in the "no unenforced assertion heredoc" test, and the two copies
// drifted: fixing only this one still left that test blind to the unquoted
// form. A single source avoids that class of bug entirely.
const BLOCK_RE = () => /(\w+)_SQL="\$\(\s*\n\s*cat <<'?SQL'?\n([\s\S]*?)\nSQL\n\)"/g;

function sqlBlocks(src) {
  const out = {};
  const re = BLOCK_RE();
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2];
  return out;
}

// Pull out every `<PREFIX>_NAMES=( ... )` array.
function nameArrays(src) {
  const out = {};
  const re = /(\w+)_NAMES=\(([\s\S]*?)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out[m[1]] = m[2]
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

// Assertion names are mixed case (raceA_*, raceB_*), so the class must not be
// lowercase-only — an earlier version of this regex silently matched only the
// two all-lowercase names and made the comparison look broken.
const assertionNames = (sql) =>
  [...sql.matchAll(/select\s+'([A-Za-z0-9_]+)'\s+as test/g)].map((m) => m[1]);

// `-- ...` comment text is documentation, not executable SQL. The comments
// inside these blocks deliberately name the wrong column (seu.source) to
// record the failure that motivated the schema check, so a column scan that
// includes comments flags the explanation as the defect.
const stripSqlComments = (sql) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

// ---------------------------------------------------------------------------
// Column references in the assertion SQL must exist in the real schema.
//
// A rehearsal run failed with `column seu.source does not exist`, and because
// psql aborts the rest of the block on error, twelve genuine assertions
// collapsed into "not evaluated" at once. The enforcement layer caught it (the
// run exited nonzero), but a single invented column name should not be able to
// take out the whole block. The migrations are the schema's source of truth, so
// the column names used in the SQL are checked against the CREATE TABLE bodies.
// ---------------------------------------------------------------------------

// The catalog is dumped from information_schema on a branch carrying Stage
// 2B+2C. Parsing the migrations was tried first and is not viable: several of
// these tables (credit_ledger, square_payments) are created by migrations that
// predate this repo's supabase/migrations directory, so the parser reported
// zero or partial columns and silently skipped the very checks it was added to
// perform. A dumped catalog is exact.
const CATALOG = path.join(ROOT, 'scripts', 'schema', 'rehearsal-columns.json');
const catalog = JSON.parse(read(CATALOG)).tables;

const columnsOf = (table) => new Set(catalog[table] || []);

test('assertion SQL only references columns that exist', () => {
  // alias -> table, for the aliases the assertion SQL actually binds.
  const aliases = {
    seu: 'session_entitlement_usage',
    l: 'credit_ledger',
    r: 'square_refunds',
    p: 'square_payments',
    s: 'sessions',
  };
  // Only the SQL heredocs are scanned. Scanning whole files also picked up
  // prose in the header comments and shell paths like "$OUT/r-$r.txt", which
  // parsed as the column reference r.txt.
  const sources = [USER_RACE, REFUND_RACE].map((f) =>
    stripSqlComments(Object.values(sqlBlocks(read(f))).join('\n'))
  );
  const problems = [];

  for (const src of sources) {
    for (const [alias, table] of Object.entries(aliases)) {
      const cols = columnsOf(table);
      if (cols.size === 0) continue; // table not defined in migrations; skip
      const refs = [...src.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, 'g'))];
      for (const ref of refs) {
        if (!cols.has(ref[1])) problems.push(`${alias}.${ref[1]} (${table})`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(problems)],
    [],
    'assertion SQL references columns absent from the migrations'
  );
});

test('the credit-source assertion uses entitlement_type, not a source column', () => {
  // Scoped to the SQL heredocs on purpose: the file's header comment quotes
  // `seu.source` when documenting the failure this replaced, and a whole-file
  // match would flag that prose as a defect.
  const blocks = stripSqlComments(Object.values(sqlBlocks(read(USER_RACE))).join('\n'));
  assert.match(blocks, /seu\.entitlement_type <> 'credit'/);
  assert.doesNotMatch(blocks, /seu\.source/);
});

// ---------------------------------------------------------------------------
// Both harnesses must be syntactically valid and share the enforcement library.
// ---------------------------------------------------------------------------

for (const [label, file] of [
  ['assertion library', LIB],
  ['user-race harness', USER_RACE],
  ['refund-race harness', REFUND_RACE],
  ['harness self-test', SELFTEST],
]) {
  test(`${label} is valid bash`, () => {
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  });
}

for (const [label, file] of [
  ['user-race harness', USER_RACE],
  ['refund-race harness', REFUND_RACE],
]) {
  const src = read(file);

  test(`${label} sources the shared assertion library`, () => {
    assert.match(src, /\.\s+"\$HERE\/rehearse-assert\.sh"/);
  });

  test(`${label} exits through rehearse_exit`, () => {
    assert.match(src, /^rehearse_exit /m);
  });

  // The old harness did `exit "$FAILURES"`, which wraps modulo 256: a run with
  // exactly 256 failures would have exited 0.
  test(`${label} does not exit with a raw failure count`, () => {
    assert.doesNotMatch(src, /exit\s+"?\$\{?(FAILURES|REHEARSE_FAILURES)\}?"?/);
  });

  test(`${label} declares every SQL assertion it runs`, () => {
    const blocks = sqlBlocks(src);
    const arrays = nameArrays(src);
    assert.ok(Object.keys(blocks).length > 0, 'no *_SQL heredoc found');

    for (const [prefix, sql] of Object.entries(blocks)) {
      const inSql = assertionNames(sql);
      assert.ok(inSql.length > 0, `${prefix}_SQL contains no assertions`);
      const declared = arrays[prefix];
      assert.ok(declared, `${prefix}_NAMES array is missing`);
      assert.deepEqual(
        [...inSql].sort(),
        [...declared].sort(),
        `${prefix}: SQL assertions and declared names disagree`
      );
      // And the pairing must actually be handed to the enforcer.
      assert.match(
        src,
        new RegExp(
          `rehearse_assert_sql "\\$URL" \\S+ "\\$${prefix}_SQL" "\\$\\{${prefix}_NAMES\\[@\\]\\}"`
        ),
        `${prefix}: not passed to rehearse_assert_sql`
      );
    }
  });

  // Assertions and diagnostics must not share an output stream, because an
  // undeclared row is a failure and a \echo banner would become one.
  test(`${label} keeps \\echo out of assertion blocks`, () => {
    for (const [prefix, sql] of Object.entries(sqlBlocks(src))) {
      assert.doesNotMatch(sql, /\\echo/, `${prefix}_SQL contains \\echo`);
      assert.doesNotMatch(sql, /\\pset/, `${prefix}_SQL contains \\pset`);
    }
  });

  // No `as pass` assertion may be piped to psql anywhere except through the
  // declared blocks — that is how the unenforced heredoc got there originally.
  test(`${label} runs no unenforced assertion heredoc`, () => {
    const withoutBlocks = src.replace(BLOCK_RE(), '');
    assert.doesNotMatch(
      withoutBlocks,
      /psql[^\n]*<<'?SQL'?/,
      'a heredoc is piped straight into psql outside the enforced blocks'
    );
    assert.doesNotMatch(withoutBlocks, /\bas pass\b/);
  });
}

test('the block extractor recognizes quoted and unquoted heredocs', () => {
  // Regression guard. The globals block uses the unquoted form so it can
  // interpolate $ROUND_LIST; an extractor that only understood <<'SQL' skipped
  // it entirely and every check in this file silently stopped covering it.
  const quoted = `A_SQL="$(\n  cat <<'SQL'\nselect 'x' as test, true as pass;\nSQL\n)"`;
  const unquoted = `B_SQL="$(\n  cat <<SQL\nselect 'y' as test, true as pass;\nSQL\n)"`;
  assert.deepEqual(Object.keys(sqlBlocks(quoted)), ['A']);
  assert.deepEqual(Object.keys(sqlBlocks(unquoted)), ['B']);
  assert.deepEqual(Object.keys(sqlBlocks(`${quoted}\n${unquoted}`)), ['A', 'B']);

  // And the real harness's globals block must actually be among them.
  assert.ok(
    'GLOBAL' in sqlBlocks(read(USER_RACE)),
    'the user-race globals block is not being extracted'
  );
});

// ---------------------------------------------------------------------------
// Library semantics.
// ---------------------------------------------------------------------------

test('library fails on false, null and unrecognized assertion values', () => {
  const lib = read(LIB);
  assert.match(lib, /f\)\s*rehearse_fail "\$label\/\$name: returned FALSE"/);
  assert.match(lib, /""\)\s*rehearse_fail "\$label\/\$name: returned NULL\/empty/);
  assert.match(lib, /\*\)\s*rehearse_fail "\$label\/\$name: returned unrecognized value/);
});

test('library fails on a missing or undeclared assertion row', () => {
  const lib = read(LIB);
  assert.match(lib, /produced NO ROW/);
  assert.match(lib, /UNDECLARED output row/);
});

test('library fails when the assertion block aborts', () => {
  const lib = read(LIB);
  assert.match(lib, /psql exited \$rc — the assertion block did not run to completion/);
  assert.match(lib, /not evaluated \(block aborted\)/);
});

test('library refuses to run a block with no declared names', () => {
  const lib = read(LIB);
  assert.match(lib, /refusing to run an unenforced block/);
});

test('library exits 1 rather than the failure count', () => {
  const lib = read(LIB);
  assert.match(lib, /rehearse_exit\(\)/);
  assert.doesNotMatch(lib, /exit "\$REHEARSE_FAILURES"/);
  assert.match(lib, /NO CHECKS RAN — treating as failure/);
});

test('library treats a connection-level racer error as a failure', () => {
  const lib = read(LIB);
  assert.match(lib, /EMAXCONNSESSION/);
  assert.match(lib, /connection-level error, not an RPC result/);
});

// ---------------------------------------------------------------------------
// User-race specifics: the checks that make a round genuine contention.
// ---------------------------------------------------------------------------

test('user-race harness captures both racers exit statuses', () => {
  const src = read(USER_RACE);
  assert.match(src, /wait "\$CPID"\s*\n\s*CRC=\$\?/);
  assert.match(src, /wait "\$RPID"\s*\n\s*RRC=\$\?/);
  assert.match(src, /rehearse_check_racer "round \$r completion" "\$CRC"/);
  assert.match(src, /rehearse_check_racer "round \$r refund" "\$RRC"/);
});

test('user-race harness requires every round to be valid contention', () => {
  const src = read(USER_RACE);
  assert.match(src, /VALID_ROUNDS=\$\(\(VALID_ROUNDS \+ 1\)\)/);
  assert.match(src, /valid contention rounds: expected \$ROUNDS, got \$VALID_ROUNDS/);
});

test('user-race harness rejects a complimentary consumption', () => {
  const src = read(USER_RACE);
  // consumed:complimentary is legal for the RPC but means the round never
  // contended for the credit, so it must not be an accepted outcome.
  assert.match(src, /consumed:credit \| refused:no_entitlement \| refused:retry_needed/);
  assert.match(src, /race_completions_consumed_credit_not_complimentary/);
});

test('user-race harness enforces every replay result', () => {
  const src = read(USER_RACE);
  assert.match(src, /replay round \$r: expected 'already_processed'/);
});

test('user-race harness prints its success banner from exactly one place', () => {
  const src = read(USER_RACE);
  const hits = [...src.matchAll(/ALL \$ROUNDS ROUNDS PASSED/g)];
  assert.equal(hits.length, 1, 'success banner appears more than once');
  assert.match(src, /rehearse_exit "user-race rehearsal \(\$ROUNDS rounds\)" "ALL \$ROUNDS ROUNDS PASSED"/);
});

test('refund-race harness enforces its outcome tallies', () => {
  const src = read(REFUND_RACE);
  assert.match(src, /assert_tally "raceA_tally_one_winner" a credits_removed 1/);
  assert.match(src, /assert_tally "raceB_tally_one_winner" b credits_removed 1/);
  assert.match(src, /assert_all_recognized "RACE A" a/);
  assert.match(src, /assert_all_recognized "RACE B" b/);
});

test('refund-race harness checks every parallel client exit status', () => {
  const src = read(REFUND_RACE);
  assert.match(src, /wait "\$\{pids\[\$k\]\}"\s*\n\s*rc=\$\?/);
  assert.match(src, /racer \$\{idx\[\$k\]\}: psql exited \$rc/);
});

// ---------------------------------------------------------------------------
// The self-test must actually cover the mechanisms, and must pass.
// ---------------------------------------------------------------------------

test('self-test covers each enforcement mechanism, with healthy controls', () => {
  const src = read(SELFTEST);
  const required = [
    ['healthy', 'zero'],
    ['false_global', 'nonzero'],
    ['missing_global', 'nonzero'],
    ['undeclared_global', 'nonzero'],
    ['global_sql_error', 'nonzero'],
    ['racer_exit', 'nonzero'],
    ['unparseable', 'nonzero'],
    ['complimentary', 'nonzero'],
    ['replay_drift', 'nonzero'],
    ['verdict_negative', 'nonzero'],
    ['race_healthy', 'zero'],
    ['race_false_global', 'nonzero'],
    ['race_tally_drift', 'nonzero'],
    ['race_racer_exit', 'nonzero'],
  ];
  for (const [scenario, expect] of required) {
    assert.match(
      src,
      new RegExp(`run_scenario ${scenario}\\s+${expect}\\s`),
      `scenario ${scenario} (${expect}) is not exercised`
    );
  }
});

test('self-test passes: every failure mode is detected, healthy runs stay green', () => {
  const out = execFileSync('bash', [SELFTEST], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.match(out, /HARNESS SELF-TEST PASSED/);
  assert.doesNotMatch(out, /^ {2}\S+\s+expect=\S+\s+exit=\S+\s+FAIL/m);
});
