-- Stage 4 follow-up (session-persistence-audit): widen credit_ledger's
-- reason check constraint to permit 'session_complete'.
--
-- Bug found and reproduced live on staging: the Stage 4 completion RPC
-- (20260906080000_create_complete_session_entitlement_rpc.sql) inserts
-- into credit_ledger with reason='session_complete' when deducting a
-- paid credit at genuine session completion. The live constraint at the
-- time only allowed:
--
--   CHECK ((reason = ANY (ARRAY['purchase'::text, 'session_start'::text, 'admin_grant'::text])))
--
-- ('session_start' predates Stage 4 -- it was the reason used by the now-
-- retired consume_session_credit path, called from the old mutating
-- session-start.js before that file was downgraded to a read-only
-- eligibility check. It is retained below for backward compatibility
-- with any pre-existing rows and per explicit instruction, even though
-- no current code path writes it anymore.)
--
-- Every real paid-credit completion therefore threw a 500
-- (credit_ledger_reason_check violation) once a user exhausted their
-- free sessions -- confirmed live via a disposable staging test user
-- seeded with free_sessions_used.count = 2 and a genuine credit balance.
-- The RPC's own transaction rolled back cleanly on the error (no partial
-- session/report/entitlement-usage state was left), but no paying user
-- could ever complete a session past their free allotment.
--
-- 'session_complete' is the semantically correct reason for this
-- deduction (it names the event that triggers it, matching the RPC's own
-- naming), so the fix widens the constraint rather than renaming the
-- RPC's insert to 'purchase' -- 'purchase' is reserved for the Square
-- webhook crediting a purchased pack, a distinct event from spending one
-- of its sessions.
alter table public.credit_ledger
  drop constraint if exists credit_ledger_reason_check;

alter table public.credit_ledger
  add constraint credit_ledger_reason_check
  check (reason = any (array['purchase'::text, 'admin_grant'::text, 'session_start'::text, 'session_complete'::text]));

comment on constraint credit_ledger_reason_check on public.credit_ledger is
  'Stage 4 follow-up (session-persistence-audit)-owned. Widened from {purchase, session_start, admin_grant} to also allow session_complete, the reason the Stage 4 completion RPC (complete_session_and_consume_entitlement) uses when deducting a paid credit at genuine session completion. session_start is retained only for backward compatibility with rows written by the now-retired consume_session_credit path; no current code writes it.';
