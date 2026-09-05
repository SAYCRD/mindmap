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

### Fixed defect: `service_role` privileges were never actually narrowed

The first version of this batch applied to staging (`lbydmtgeojnozzhwsava`)
had a real bug in every one of the six `revoke all on ... from public,
anon, authenticated;` statements: they omitted `service_role`. This
schema has a pre-existing `ALTER DEFAULT PRIVILEGES` entry (owned by
`postgres`, not modified by this batch) that auto-grants full CRUD
(`select, insert, update, delete, truncate, references, trigger`) to
`service_role` on every newly created table. Because the revoke never
named `service_role`, the follow-up `grant select, insert, ... to
service_role;` line only **added** to that pre-existing full-CRUD grant
instead of narrowing it -- so tables documented as append-only or
no-update (`session_entitlement_usage`, and `reports`/`captures`/
`bookmarks`'s "no update" or "no delete" comments) were never actually
enforced at the database level; `service_role` silently retained full
CRUD on all six tables regardless of what was granted afterward.

**Fix:** every table's `revoke all on ... from public, anon, authenticated,
service_role;` now explicitly includes `service_role`, so the immediately
following `grant` line is the complete, authoritative statement of that
table's effective `service_role` privileges -- nothing is inherited
silently from the schema-level default. `ALTER DEFAULT PRIVILEGES` itself
is intentionally left unchanged, since other, pre-existing production
tables may depend on it; each Stage 1 table now normalizes its own
privileges explicitly instead.

**Final privilege matrix** (per-table `service_role` grant, after the fix):

| Table | `service_role` privileges | Rationale |
|---|---|---|
| `sessions` | `select, insert, update, delete` | full CRUD; delete supports the staged account-deletion flow |
| `reports` | `select, insert, update` | no delete -- removed only via cascade from `sessions` |
| `captures` | `select, insert, delete` | no update -- immutable once saved, but user-deletable |
| `bookmarks` | `select, insert, delete` | no update -- immutable once saved, but user-deletable |
| `session_entitlement_usage` | `select, insert` | write-once audit trail; no update/delete for any role |
| `migration_runs` | `select, insert, update, delete` | account-linked operational metadata, not permanent financial history -- must remain deletable by the trusted deletion API |

No role other than `service_role` (i.e. `public`, `anon`, `authenticated`)
has any privilege on any of the six tables. `REFERENCES`, `TRIGGER`, and
`TRUNCATE` are not granted to `service_role` on any Stage 1 table.

This fix was applied to the migration files only; the staging branch that
had the original (buggy) version applied was reset/recreated and Stage 1
was reapplied from these corrected files. See the audit trail entry for
that reset for the resulting staging project reference.

## Account deletion: resolved FK/privilege design

An initial version of this batch had a real contradiction: deleting a
private session was blocked by `session_entitlement_usage.session_id`'s
`on delete restrict`, `reports` had no `DELETE` grant even though its
removal path assumed one, and `migration_runs` was described as
"permanent" even though account deletion is expected to remove it. This
was corrected as follows (all in the same review-only migration files,
never applied):

- **`session_entitlement_usage`** is the only table whose rows are
  genuinely **retained** (never deleted) across account deletion -- it is
  the minimum financial/entitlement audit evidence for a completed
  session. Its `session_id` and `user_id` columns are now nullable with
  `on delete set null` (previously `not null` / `restrict`), so deleting
  the session or the `auth.users` row clears those columns instead of
  being blocked. A new, non-FK `session_ref uuid not null` column, set by
  a `before insert` trigger (`blindspot_set_entitlement_session_ref`, never
  from a client-supplied value) and protected by a permanent unique index,
  preserves "which session was this for" forever, independent of whether
  the session row itself still exists. `entitlement_type`,
  `credit_ledger_id` / `subscription_id` / `granted_by`, and `session_ref`
  remain the durable evidence; no update/delete grant exists on this table
  for any role, so nothing but the FK's own internal `SET NULL` action can
  ever change a row after insert.
- **`reports`** keeps its existing `session_id ... on delete cascade` and
  still has **no** `DELETE` grant for `service_role` -- deleting a user's
  sessions (`service_role` has `DELETE` on `sessions`) is sufficient on
  its own to also remove that user's reports, since Postgres performs the
  cascade internally as part of enforcing the foreign key and only needs
  `DELETE` privilege on the table actually named in the `DELETE`
  statement (`sessions`), not on the cascaded-into table.
- **`migration_runs`** is no longer described as permanent: it has no
  financial retention requirement, so `service_role` now also has
  `DELETE`, and account deletion removes this user's rows directly and
  explicitly (its `user_id` FK stays `on delete restrict` deliberately,
  as a safeguard that forces this explicit deletion step rather than
  allowing it to happen silently via cascade).

**Account deletion sequence** (server API route, Stage 2+; JWT-verified
`user_id`, never accepted from the request body):

1. `DELETE FROM public.migration_runs WHERE user_id = :verified_user_id;`
2. `DELETE FROM public.bookmarks WHERE user_id = :verified_user_id;`
3. `DELETE FROM public.captures WHERE user_id = :verified_user_id;`
4. `DELETE FROM public.sessions WHERE user_id = :verified_user_id;` --
   cascades to that user's `reports` automatically, and sets
   `session_entitlement_usage.session_id` to `null` (via `on delete set
   null`) for any retained audit rows that referenced those sessions,
   without deleting those audit rows.
5. Delete the `auth.users` row itself (e.g. `supabase.auth.admin.deleteUser`).
   This now succeeds: steps 1-4 already removed every row that had a
   `restrict`-FK reference to this user, and `session_entitlement_usage`'s
   remaining rows (the retained audit evidence) have `on delete set null`
   on `user_id`, so they no longer block this step -- they simply lose
   their `user_id` attribution while keeping `session_ref`,
   `entitlement_type`, and the financial linkage (`credit_ledger_id` /
   `subscription_id` / `granted_by`) intact.

Confirmed: a user's private session and report content is fully
deletable (steps 4, via cascade). The minimum non-content entitlement/
accounting evidence (`session_entitlement_usage` rows) remains retained
and intact after full account deletion, no longer requiring the private
session row to continue existing. Idempotency (`session_ref`'s unique
index) holds permanently, not just while the session exists. No ordinary
application API can modify or delete entitlement history -- only the
internal FK `SET NULL` action triggered by step 4/5 can ever touch those
rows, and even that only clears `session_id`/`user_id`, never
`entitlement_type` or the financial linkage columns.

## Deliberate deviation: `user_id ... on delete restrict`, not `cascade`

A live, read-only query against production (`pg_constraint`/`pg_attribute`)
confirms every existing foreign key referencing `auth.users(id)` in this
database -- both Supabase's own auth-internal tables (`auth.identities`,
`auth.sessions`, `auth.mfa_factors`, etc.) and every one of this app's own
existing tables (`subscriptions`, `credit_ledger`, `free_sessions_used`,
`square_payments`) -- uses `on delete cascade`, with no exceptions.

Stage 1's `user_id` FKs on `sessions`, `reports`, `captures`, `bookmarks`,
and `migration_runs` deliberately do **not** follow that convention; they
use `on delete restrict` instead (`session_entitlement_usage.user_id` is
the one exception, using `on delete set null` for the retained-audit-row
reason documented above). **This is intentional, not an oversight or an
inconsistency to "fix" back to `cascade`:**

- Every existing `cascade` FK governs either Supabase auth-internal state
  or purely financial/entitlement bookkeeping rows -- content where
  silently vanishing on account deletion is the same in either direction
  (present) or arguably already a separate, pre-existing, out-of-Stage-1
  -scope question (should `credit_ledger`/`square_payments` really
  auto-cascade-delete their own audit trail?).
- Stage 1's tables hold actual private user content (session
  transcripts, generated reports, saved captures/bookmarks). This design
  has already committed to deleting that content only through the
  explicit, ordered account-deletion sequence documented above -- never
  implicitly. `restrict` is what makes an accidental or out-of-order
  deletion (e.g. some future code path calling
  `supabase.auth.admin.deleteUser` directly, skipping steps 1-4) fail
  loudly at the database level, instead of silently cascading away a
  user's session content with no record that it happened.
- If a future stage decides `cascade` is actually preferable here, that
  is a legitimate, separate decision to make explicitly and knowingly --
  not something to "correct" on the assumption that Stage 1 simply
  forgot to match the rest of the schema.
