# Supabase schema status

## `schema.sql` is historical and superseded

`supabase/schema.sql` in this directory does **not** reflect the current
production database. It predates several tables that exist in production
today (`subscriptions`, `session_tiers`, `credit_ledger`, `free_sessions_used`,
`square_payments`, `anonymous_session_log`), none of which were ever
committed as tracked migration files in this repository -- they were
applied directly to production out-of-band.

**Do not edit or run `schema.sql`.** It is left in place, unmodified, as a
historical artifact. Its disposition (delete vs. keep-with-a-superseded
comment) is an open decision, tracked separately from the Stage 1
persistence work below -- see the design discussion for options.

## `migrations/` is the canonical, version-controlled source going forward

Starting with this Stage 1 batch, all new schema changes for the
session-persistence-audit effort are authored as ordered, timestamped
files under `supabase/migrations/`, following the standard Supabase CLI
migration filename convention (`<14-digit-timestamp>_<name>.sql`).

**Stage 1 batch (authored, reviewed, NOT applied to any database):**

| File | Table(s) |
|---|---|
| `20260905070000_create_sessions_table.sql` | `sessions` |
| `20260905070100_create_reports_table.sql` | `reports` |
| `20260905070200_create_captures_table.sql` | `captures` |
| `20260905070300_create_bookmarks_table.sql` | `bookmarks` |
| `20260905070400_create_session_entitlement_usage_table.sql` | `session_entitlement_usage` |
| `20260905070500_create_migration_runs_table.sql` | `migration_runs` |

These files were **not** applied via `apply_migration` or `execute_sql`.
Production and any other database remain unchanged until each file is
explicitly approved and applied in a later stage.

Explicitly out of scope for this batch (per the approved Stage 1 plan):
`session_tiers` changes, `subscriptions` changes, reservation RPCs,
completion RPCs, changes to `consume_session_credit`, API routes, client
code, Dashboard changes, admin tables/UI, analytics, Square changes,
privacy-copy changes, and any execution against staging or production.

## Access model: server-API-only

All six Stage 1 tables use one consistent privilege model, applied
explicitly in each table's own migration file (not left to "implicit"
`service_role` access):

- `PUBLIC`, `anon`, and `authenticated` have **all privileges revoked** on
  every table. Browser clients cannot read or write any of these tables
  directly through the Supabase Data API, regardless of RLS policy state.
- `service_role` is granted only the specific privileges its future API
  routes need per table (see each migration file's grant comment for the
  exact rationale -- e.g. `session_entitlement_usage` gets `select, insert`
  only, since it is a write-once audit trail with no update/delete path).
- RLS remains enabled on every table as defense in depth, and each table
  keeps its own-row `select` policy for `authenticated` -- but that policy
  is currently inert, since `authenticated` has no table-level grant to
  execute a `select` against these tables at all. The policy is retained
  only as a documented option for a possible future direct-authenticated
  -read feature; enabling it for real requires a separate, later migration
  that deliberately adds the grant.
- All authenticated access to this data happens through server API routes
  (Stage 2+) that verify the caller's JWT, derive `user_id` from that
  verified JWT only (never from the request body), and filter every
  service-role query by that verified `user_id`.
