#!/usr/bin/env bash
# scripts/rehearse-assert.sh — shared assertion enforcement for the Stage 2C
# rehearsal harnesses. SOURCE this file; do not execute it.
#
# WHY THIS EXISTS
#
# Both rehearsal harnesses used to emit their SQL assertions as a table of
# `test | pass` rows and leave a human to scan the output for `f`. That is not
# an assertion, it is a suggestion. A run could print
#
#   no_negative_balance_any_user | f
#
# and still finish with "ALL ROUNDS PASSED" and exit 0, because nothing parsed
# the block. The exit code was computed only from the per-round checks, and
# rehearse-2c-race.sh had no exit-code logic at all. Worse, an assertion that
# was renamed, commented out, or lost to an editing accident produced no output
# at all, which was indistinguishable from a pass.
#
# Every assertion now flows through rehearse_assert_sql, which forces the caller
# to DECLARE the assertion names it expects:
#
#   * a declared assertion that produces no row is a FAILURE (missing)
#   * a row that was never declared is a FAILURE (undeclared drift, or
#     diagnostic output leaking into the machine-read stream)
#   * anything other than exactly `t` is a FAILURE, including `f`, NULL/empty,
#     and any unrecognized token
#   * a nonzero psql exit is a FAILURE, so a block that dies halfway through
#     can never be mistaken for a block that passed
#
# Because an undeclared row fails, diagnostic queries MUST be run in a separate
# psql invocation from assertions. That separation is the point: it is no longer
# possible for a `\echo` banner or a detail table to sit in the same output
# stream as the assertions and be visually mistaken for one.
#
# All state is in shell globals so the sourcing script can consult it:
#   REHEARSE_FAILURES  total failures seen
#   REHEARSE_CHECKS    total checks performed

REHEARSE_FAILURES=0
REHEARSE_CHECKS=0

# ---------------------------------------------------------------------------
# Result vocabularies, transcribed from the RPC contracts. An outcome outside
# these lists is treated as unrecognized rather than assumed benign: a new
# result code appearing in a rehearsal is exactly the kind of change that
# should stop the run and be looked at.
# ---------------------------------------------------------------------------

# process_square_refund, Stage 2C.
REHEARSE_REFUND_RESULTS="already_processed ambiguous_attribution conflict_amount \
conflict_not_credited conflict_over_refund conflict_payment_id \
conflict_refund_mismatch credits_removed currency_mismatch invalid_amount \
invalid_currency invalid_payment_id invalid_refund_id invalid_refund_status \
location_mismatch no_credits_to_remove recorded_not_completed recorded_partial \
retry_needed unmatched_payment"

# complete_session_and_consume_entitlement.
REHEARSE_COMPLETION_SOURCES="complimentary credit"
REHEARSE_COMPLETION_ERRORS="no_entitlement not_found retry_needed session_not_editable"

rehearse_fail() {
  REHEARSE_FAILURES=$((REHEARSE_FAILURES + 1))
  printf '   FAIL  %s\n' "$*"
}

rehearse_ok() {
  printf '   pass  %s\n' "$*"
}

rehearse_note() {
  printf '   note  %s\n' "$*"
}

# rehearse_in_list <needle> <space-delimited list>
rehearse_in_list() {
  local needle="$1" list="$2"
  case " $list " in
    *" $needle "*) return 0 ;;
  esac
  return 1
}

# rehearse_is_int <value>
rehearse_is_int() {
  [[ "${1:-}" =~ ^-?[0-9]+$ ]]
}

# ---------------------------------------------------------------------------
# rehearse_assert_sql <url> <label> <sql> <declared-name>...
#
# Runs <sql> as a machine-read assertion block. The SQL must emit exactly one
# row per assertion, shaped `select '<name>' as test, <boolean> as pass;`, and
# must contain no \echo, no diagnostic selects and nothing else that writes to
# stdout.
# ---------------------------------------------------------------------------
rehearse_assert_sql() {
  local url="$1" label="$2" sql="$3"
  shift 3
  local declared=("$@")
  local so se rc line name val

  if [ "${#declared[@]}" -eq 0 ]; then
    rehearse_fail "$label: no assertion names declared (refusing to run an unenforced block)"
    return 1
  fi

  so="$(mktemp)"
  se="$(mktemp)"

  printf '%s\n' "$sql" | psql "$url" -At -F '|' -q --no-psqlrc -v ON_ERROR_STOP=1 >"$so" 2>"$se"
  rc=$?

  if [ "$rc" -ne 0 ]; then
    rehearse_fail "$label: psql exited $rc — the assertion block did not run to completion"
    sed 's/^/         /' "$se" | head -20
    # Every declared assertion is unproven, so count each one as failed rather
    # than letting a dead block look like a short one.
    for name in "${declared[@]}"; do
      REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
      rehearse_fail "$label/$name: not evaluated (block aborted)"
    done
    rm -f "$so" "$se"
    return 1
  fi

  if [ -s "$se" ]; then
    rehearse_note "$label: psql wrote to stderr (not fatal, shown for context):"
    sed 's/^/         /' "$se" | head -10
  fi

  # Declared assertions must each have produced exactly one usable row.
  for name in "${declared[@]}"; do
    REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
    local matches
    matches="$(grep -c -- "^${name}|" "$so" || true)"
    if [ "${matches:-0}" -eq 0 ]; then
      rehearse_fail "$label/$name: produced NO ROW (assertion missing, renamed or commented out)"
      continue
    fi
    if [ "${matches:-0}" -gt 1 ]; then
      rehearse_fail "$label/$name: produced $matches rows (expected exactly 1)"
      continue
    fi
    line="$(grep -m1 -- "^${name}|" "$so")"
    val="${line#*|}"
    case "$val" in
      t) rehearse_ok "$label/$name" ;;
      f) rehearse_fail "$label/$name: returned FALSE" ;;
      "") rehearse_fail "$label/$name: returned NULL/empty (assertion could not be evaluated)" ;;
      *) rehearse_fail "$label/$name: returned unrecognized value '$val' (expected t)" ;;
    esac
  done

  # Anything the caller did not declare is drift and must not pass silently.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="${line%%|*}"
    if ! rehearse_in_list "$name" "${declared[*]}"; then
      REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
      rehearse_fail "$label: UNDECLARED output row '$line' (add it to the declared names, or move it to the diagnostics block)"
    fi
  done <"$so"

  rm -f "$so" "$se"
  return 0
}

# ---------------------------------------------------------------------------
# rehearse_run_diagnostics <url> <label> <sql>
#
# Human-readable output only. Never contributes a pass, but a nonzero exit is
# still reported so a broken diagnostic query cannot masquerade as empty.
# ---------------------------------------------------------------------------
rehearse_run_diagnostics() {
  local url="$1" label="$2" sql="$3" rc
  printf '\n-- %s --\n' "$label"
  printf '%s\n' "$sql" | psql "$url" -q --no-psqlrc -v ON_ERROR_STOP=1 2>&1 | sed 's/^/   /'
  rc="${PIPESTATUS[1]:-0}"
  [ "$rc" -ne 0 ] && rehearse_fail "$label: diagnostics psql exited $rc"
  return 0
}

# ---------------------------------------------------------------------------
# Racer classification. Each echoes a compact label and returns nonzero when
# the payload is not a shape the RPC contract can produce, so an unparseable or
# unexpected result is a hard failure rather than a cosmetic "UNPARSED" cell.
# ---------------------------------------------------------------------------

# rehearse_classify_completion <raw jsonb text>
rehearse_classify_completion() {
  local raw="$1" src err
  if [ -z "${raw//[[:space:]]/}" ]; then
    printf 'EMPTY'
    return 1
  fi
  case "$raw" in
    *'"ok": true'* | *'"ok":true'*)
      src="$(sed -n 's/.*"source" *: *"\([a-z_]*\)".*/\1/p' <<<"$raw")"
      if [ -n "$src" ]; then
        printf 'consumed:%s' "$src"
        rehearse_in_list "$src" "$REHEARSE_COMPLETION_SOURCES" || return 1
        return 0
      fi
      case "$raw" in
        *'"already_completed": true'* | *'"already_completed":true'*)
          printf 'already_completed'
          return 0
          ;;
      esac
      printf 'UNPARSED'
      return 1
      ;;
    *'"ok": false'* | *'"ok":false'*)
      err="$(sed -n 's/.*"error" *: *"\([a-z_]*\)".*/\1/p' <<<"$raw")"
      if [ -n "$err" ]; then
        printf 'refused:%s' "$err"
        rehearse_in_list "$err" "$REHEARSE_COMPLETION_ERRORS" || return 1
        return 0
      fi
      printf 'UNPARSED'
      return 1
      ;;
  esac
  printf 'UNPARSED'
  return 1
}

# rehearse_classify_refund <raw jsonb text>
rehearse_classify_refund() {
  local raw="$1" res
  if [ -z "${raw//[[:space:]]/}" ]; then
    printf 'EMPTY'
    return 1
  fi
  res="$(sed -n 's/.*"result" *: *"\([a-z_]*\)".*/\1/p' <<<"$raw")"
  if [ -z "$res" ]; then
    printf 'UNPARSED'
    return 1
  fi
  printf '%s' "$res"
  rehearse_in_list "$res" "$REHEARSE_REFUND_RESULTS" || return 1
  return 0
}

# rehearse_check_racer <label> <exit-status> <raw output>
# Fails on a nonzero psql exit, on empty output, and on anything that looks
# like a connection-level error rather than an RPC answer.
rehearse_check_racer() {
  local label="$1" status="$2" raw="$3" bad=0
  REHEARSE_CHECKS=$((REHEARSE_CHECKS + 1))
  if [ "$status" -ne 0 ]; then
    rehearse_fail "$label: psql exited $status"
    bad=1
  fi
  if [ -z "${raw//[[:space:]]/}" ]; then
    rehearse_fail "$label: produced no output"
    bad=1
  fi
  case "$raw" in
    *EMAXCONNSESSION* | *"connection to server"* | *"could not connect"* | *"server closed the connection"*)
      rehearse_fail "$label: connection-level error, not an RPC result: $raw"
      bad=1
      ;;
    *ERROR:*)
      rehearse_fail "$label: SQL error: $raw"
      bad=1
      ;;
  esac
  return "$bad"
}

# ---------------------------------------------------------------------------
# rehearse_exit <label> [success-message]
#
# The single exit point. Exits 1 (not the failure count) because the count can
# exceed 255 and would wrap to a false success — the old harness did
# `exit "$FAILURES"`, so 256 failures would have exited 0.
# ---------------------------------------------------------------------------
rehearse_exit() {
  local label="${1:-rehearsal}" success="${2:-ALL CHECKS PASSED}"
  printf '\n== %s: %d checks, %d failure(s) ==\n' "$label" "$REHEARSE_CHECKS" "$REHEARSE_FAILURES"
  if [ "$REHEARSE_CHECKS" -eq 0 ]; then
    echo "NO CHECKS RAN — treating as failure"
    exit 1
  fi
  if [ "$REHEARSE_FAILURES" -eq 0 ]; then
    echo "$success"
    exit 0
  fi
  echo "REHEARSAL FAILED"
  exit 1
}
