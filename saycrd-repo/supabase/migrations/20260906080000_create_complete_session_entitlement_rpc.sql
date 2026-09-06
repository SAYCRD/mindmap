-- Stage 4 (session-persistence-audit): atomic completion + entitlement
-- consumption RPC. Fixes the gap left by session-start.js's original
-- design (consume_session_credit, called BEFORE the session existed or
-- was ever guaranteed to finish): that gate could charge a free session or
-- a paid credit for a session that was then abandoned, crashed, or never
-- persisted -- a charge with no corresponding completed, saved session.
--
-- This function is the single place entitlement (free-session count /
-- paid credit) is ever consumed. It is called only from
-- api/session-complete.js, at the moment a session is genuinely
-- completed (session content + report both persisted), and it does so in
-- the same Postgres transaction as that persistence -- so a charge can
-- never survive a failed completion, and a completion can never succeed
-- without the entitlement check passing first. api/session-start.js is
-- downgraded to a pure, read-only eligibility check (see that file) used
-- only to decide whether to show the "start a session" UI or the
-- paywall; it performs no mutation and is safe to call any number of
-- times.
--
-- Concurrency: a per-user pg_advisory_xact_lock serializes every call for
-- the same user (matching consume_session_credit's existing pattern), and
-- `select ... for update` on the target sessions row means two concurrent
-- completion attempts for the SAME session fully serialize -- the second
-- one always observes the first's committed 'completed' status and takes
-- the idempotent-replay branch instead of double-consuming. The unique
-- index on session_entitlement_usage.session_ref (Stage 1) is a second,
-- independent backstop: if it is ever violated anyway, the whole call
-- rolls back (via the exception handler below) and returns a retryable
-- error rather than leaving a completed session without -- or a doubly
-- charged entitlement with -- a mismatched usage row.
create or replace function public.complete_session_and_consume_entitlement(
  p_session_id uuid,
  p_user_id uuid,
  p_session_content jsonb,
  p_report_content jsonb,
  p_verdict text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_session record;
  v_free_used integer;
  v_free_limit integer := 2;
  v_balance integer;
  v_source text;
  v_credit_ledger_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Row-lock the session for the duration of this transaction so a
  -- concurrent second call for the same session_id blocks here until
  -- this one commits (or rolls back), rather than racing the status
  -- check below.
  select id, status
  into v_session
  from public.sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_session.status = 'completed' then
    -- Idempotent replay: a retry after a successful completion (client
    -- never saw the response, duplicate click, the second half of a
    -- concurrent double-submit) applies no further writes and never
    -- re-consumes an entitlement -- matches session-complete.js's
    -- pre-existing idempotent-replay contract for the plain
    -- session/report update it used to do directly.
    return jsonb_build_object('ok', true, 'already_completed', true);
  end if;

  if v_session.status not in ('draft', 'processing') then
    -- failed/abandoned: never resurrect into completed through this path.
    return jsonb_build_object('ok', false, 'error', 'session_not_editable');
  end if;

  -- Determine and consume entitlement now, atomically with the
  -- persistence writes below -- never before this point, and never
  -- decided by application code.
  insert into public.free_sessions_used (user_id, count)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select count into v_free_used from public.free_sessions_used where user_id = p_user_id;

  if v_free_used < v_free_limit then
    update public.free_sessions_used set count = count + 1, updated_at = now() where user_id = p_user_id;
    v_source := 'complimentary';
  else
    select coalesce(sum(delta), 0) into v_balance from public.credit_ledger where user_id = p_user_id;
    if v_balance > 0 then
      insert into public.credit_ledger (user_id, delta, reason)
      values (p_user_id, -1, 'session_complete')
      returning id into v_credit_ledger_id;
      v_source := 'credit';
    else
      -- No mutation has happened yet at this point (the advisory lock and
      -- the row lock above take no data changes) other than an idempotent
      -- free_sessions_used seed insert, which is a safe no-op to leave in
      -- place -- so returning here leaves no orphaned charge or partial
      -- write behind.
      return jsonb_build_object('ok', false, 'error', 'no_entitlement');
    end if;
  end if;

  insert into public.session_entitlement_usage (session_id, user_id, entitlement_type, credit_ledger_id)
  values (p_session_id, p_user_id, v_source, v_credit_ledger_id);

  update public.sessions
  set content = p_session_content,
      status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = p_session_id;

  insert into public.reports (session_id, user_id, status, content, one_line_verdict)
  values (p_session_id, p_user_id, 'complete', p_report_content, p_verdict)
  on conflict (session_id) do update
    set content = excluded.content,
        status = 'complete',
        one_line_verdict = excluded.one_line_verdict,
        updated_at = now();

  return jsonb_build_object('ok', true, 'source', v_source, 'already_completed', false);
exception
  when unique_violation then
    -- Backstop only (see header comment): the advisory + row lock above
    -- should already make this unreachable in practice. Rolls back every
    -- write this call made (including the entitlement grant) and returns
    -- a retryable error instead of surfacing a raw constraint error --
    -- the caller retries the whole RPC call, which will then observe
    -- whichever concurrent call actually won as already-completed.
    return jsonb_build_object('ok', false, 'error', 'retry_needed');
end;
$function$;

comment on function public.complete_session_and_consume_entitlement(uuid, uuid, jsonb, jsonb, text) is
  'Stage 4 (session-persistence-audit)-owned. The only place a session''s free/paid entitlement is ever consumed, done atomically with marking the session completed and writing its report. Superseded consume_session_credit (called only by the now-retired mutating session-start.js path) as the sole entitlement-consuming function; that older function is left in place, unused, rather than dropped, in case any out-of-band tooling still depends on it.';

revoke all on function public.complete_session_and_consume_entitlement(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_session_and_consume_entitlement(uuid, uuid, jsonb, jsonb, text) to service_role;
