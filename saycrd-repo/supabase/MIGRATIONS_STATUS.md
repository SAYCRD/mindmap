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

## Stage 1 required rehearsal before any production migration

Before any of the six Stage 1 migration files are ever applied to
production, they must be rehearsed from scratch (a clean `apply_migration`
replay, not a hand-corrected live database) on a fresh, isolated branch.
The current staging project (`lbydmtgeojnozzhwsava`) was hand-corrected
directly after its branch reset replayed stale migration content instead
of picking up the `service_role`-grant fix above -- it is suitable for
continued Stage 2+ development against, but it is **not** the clean-replay
proof production migration requires. That rehearsal is tracked as a
standalone, separate step, not yet performed.

## Stage 2: server API routes for session/report/capture/bookmark CRUD (authored, not deployed)

Stage 2 authors the JWT-verified server API routes that read and write the
Stage 1 tables, plus their shared validation helpers and unit tests. It
does **not** connect to any live database, deploy anything, wire the
browser client, or merge to `main` -- see each route file's own header
comment for its exact scope. Explicitly excluded from Stage 2 (owned by
later stages): guest migration, completion/credit consumption,
reservations, Dashboard integration, export, account deletion, admin
features, analytics, and Square/payment changes.

| File | Purpose |
|---|---|
| `api/_validate.js` | Pure, dependency-free validation/pagination helpers shared by every Stage 2 route (UUID checks, content size/shape checks, per-field length caps, keyset-cursor encode/decode). No I/O, so it is unit-tested directly with no mocking. |
| `api/sessions.js` | Session create, autosave/update (`PATCH`), list, and retrieve-one. |
| `api/reports.js` | Retrieve a report by its owning `session_id`. Read-only. |
| `api/captures.js` | Capture create, list, delete. No update route exists. |
| `api/bookmarks.js` | Bookmark create, list, delete. No update route exists. |
| `api/package.json` (`{"type":"module"}`) | Scopes Node's module resolution to ESM for everything under `api/`, matching the `import`/`export` syntax these files (and the pre-existing Stage-1-adjacent routes such as `_lib.js`) already use. Vercel's Node builder already auto-detects and runs this ESM syntax in production regardless of this file, so it changes no deployed behavior -- it only makes `api/__tests__`'s `node --test` runs work locally without a bundler, since plain Node needs an explicit `"type": "module"` (or a `.mjs` extension) to parse `import`/`export` itself. Scoped to `api/` only, not the repo root, so `build/compile.js`'s own `require(...)` calls are unaffected. |
| `api/__tests__/*.test.js`, `api/__tests__/_mock-supabase.js`, `api/__tests__/_http.js` | Unit tests (Node's built-in `node:test` runner -- no new dependency) plus a small in-memory mock Supabase query builder and fake req/res, so every test exercises route logic with zero network or database access. Run with `npm test`. |

Every route follows the same security shape: `getAuthedUser` (from
`_lib.js`) verifies the caller's Supabase JWT and is the **only** source
of `user_id` -- never the request body, query string, or URL. Every
service-role query is filtered by that verified `user_id`, "not found"
and "belongs to another user" always produce the identical response
(generic 404/409, never a distinguishable 403), and every mutating route
whitelists request-body keys explicitly rather than trusting the caller
not to send `status`, `user_id`, `id`, or migration/reservation
bookkeeping fields it should never be able to set.

### Route contract table

| Route | Method | Auth | Ownership check | Notable behavior |
|---|---|---|---|---|
| `/api/sessions` | `POST` | required | `user_id` from JWT only | Create. Body whitelist: `id?`, `content?`. Client-supplied `id` (UUID) is optional; retrying the same id while it is still `draft` and owned by the caller is idempotent (200, content unchanged) -- never accepted from the body: `status`, `user_id`. Existing id owned by another user -> generic `409 conflict`. Existing id no longer `draft` -> `409 session_not_draft`. |
| `/api/sessions?id=` | `PATCH` | required | row fetched `WHERE id=? AND user_id=verified` | Autosave. Body whitelist: `content?`, `schema_version?` (forward-only). Any other key -> `400 unsupported_field`. Session not `draft`/`processing` (i.e. `completed`/`failed`/`abandoned`) -> `409 session_not_editable`, update never applied. |
| `/api/sessions?id=` | `GET` | required | `WHERE id=? AND user_id=verified` | Retrieve one. Not found or not owned -> identical `404 not_found`. |
| `/api/sessions?status=&limit=&cursor=` | `GET` | required | `WHERE user_id=verified` | List. Keyset-paginated on `(created_at desc, id desc)`; `limit` capped at 100 per page (default 20), `cursor` opaque/base64url. No cap on total retrievable history across pages. |
| `/api/reports?session_id=` | `GET` | required | session ownership AND report's own `user_id`, both checked | Retrieve by session. No report yet -> `404 not_found` (Stage 2 never generates one). Immutable through this route. |
| `/api/captures` | `POST` | required | `session_id` (if given) must resolve `WHERE id=? AND user_id=verified` | Create. Body whitelist: `text` (<=300 chars), `note?` (<=800 chars), `source?` (allowlist: `report`/`manual`/`session`), `session_id?`. |
| `/api/captures?session_id=&limit=&cursor=` | `GET` | required | `WHERE user_id=verified` | List, same keyset pagination as sessions. |
| `/api/captures?id=` | `DELETE` | required | `WHERE id=? AND user_id=verified` in the delete statement itself | Not found/not owned -> `404 not_found`. Never touches the source session row. |
| `/api/bookmarks` | `POST` | required | same as captures | Create. Body whitelist: `text` (<=2000 chars, matches DB check), `label?` (<=500 chars, app-level only -- DB has no check constraint on `label`), `session_id?`. |
| `/api/bookmarks?session_id=&limit=&cursor=` | `GET` | required | `WHERE user_id=verified` | List, same keyset pagination. |
| `/api/bookmarks?id=` | `DELETE` | required | `WHERE id=? AND user_id=verified` | Not found/not owned -> `404 not_found`. Never touches the source session row. |

All methods not listed above for a given route return `405
method_not_allowed`; `OPTIONS` returns `200` per `setCors`'s existing CORS
convention (unchanged from Stage-1-adjacent routes). Every response body
is one of the listed generic string error codes or the resource's
minimal public field set (see each route file's `*_PUBLIC_FIELDS`
constant) -- never a raw exception message, session content, report
content, capture/bookmark text, or any internal/migration/reservation
column.

### Test results

`npm test` (Node's built-in `node --test`, no new dependency): **50
passed, 0 failed.** Covers, per route: unauthenticated rejection,
unsupported-method rejection, request-body whitelisting, size/shape
validation, cross-user ownership isolation (never able to read, modify,
or delete another user's row), idempotent session creation (no
duplicate row), the `session_not_draft` / `session_not_editable` /
`invalid_schema_version` conflict paths, and minimal-field response
shaping (asserts internal fields like `user_id`, `migration_source`,
`last_error`, `attempt_count` are never present in a response body). The
mock Supabase client does not evaluate `.or()` filter expressions (used
for keyset-cursor pagination), so the exact SQL semantics of cursor-based
paging past a page boundary are exercised structurally (cursor
encode/decode round-trip, `next_cursor` presence tied to page fullness)
but not against a real Postgres query planner.

### Remaining items requiring live staging verification

- Cursor-based (`.or()`-driven) pagination's exact SQL behavior across a
  real page boundary, including behavior when rows share an identical
  `created_at` timestamp.
- The `sessions_content_size_ck` DB constraint and this route's
  independent ~200KB application-level check agreeing at the boundary
  (the DB is authoritative; the app check exists only to fail fast with a
  clean error before a request ever reaches Postgres).
- End-to-end JWT verification against a real Supabase project (unit tests
  inject a fake `getAuthedUser`, never a real token).
- Confirming `service_role`'s actual per-table grants on whichever
  database these routes are ultimately pointed at match the corrected
  Stage 1 matrix above (this is exactly the class of defect the Stage 1
  fix addressed) -- and, per the required-rehearsal note above, that this
  has been proven via a clean migration replay, not a hand-corrected
  database.

## Stage 3: client integration and the session-completion route (authored, no schema change)

Stage 3 connects the browser client to the Stage 2 API and adds the one
write path Stage 2 deliberately left unbuilt: transitioning a session
from `draft`/`processing` to `completed` and writing its `reports` row.
The original Stage 2 section above called this a future "Stage 5
completion RPC" -- Stage 3 (per the approved session-persistence-audit
plan) builds it now as a plain, additive API route instead of a Postgres
RPC, using **only privileges already granted in the Stage 1 migration
files**: `sessions` already grants `service_role` `update`, and `reports`
already grants `service_role` `insert, update`. No new migration file,
no new grant, no schema change.

| File | Purpose |
|---|---|
| `api/session-complete.js` | `POST` only. Verifies ownership the same way every Stage 2 route does (JWT-derived `user_id`, generic 404 for not-found-or-not-owned). Updates the session to `completed` and upserts (insert, falling back to update on a `23505` unique-violation race) the session's one `reports` row in the same request. Idempotent: retrying the same `session_id` after a successful completion returns the existing session+report unchanged, never re-applying writes. |
| `public/session-sync.js` | Dependency-injected client module (loaded as a plain `<script>`, also `require()`-able from tests). Owns: UUID session identity assigned at save time, idempotent create (`/api/sessions`) + complete (`/api/session-complete`) with a local `_syncStage` marker so a session already synced is never re-sent, retry-safe failure tracking (`_syncError`, never cleared silently), and a server-authoritative merge (`mergeServerSessionsIntoLocal`) for Dashboard loading that never erases a local-only session. |
| `api/__tests__/session-complete.test.js`, `api/__tests__/session-sync.test.js` | New unit tests (same `node --test` + mock-Supabase / fake-fetch pattern as Stage 2), covering guest-to-account transfer, duplicate prevention, failed-upload recovery, and server-to-Dashboard merge. |

Client wiring (`public/app.jsx`, `public/index.html`): every locally
saved session gets a UUID at save time; a fire-and-forget sync runs after
each local save and after a field report attaches; the guest-to-account
transfer runs once, right after sign-up/sign-in, from index.html's
`SIGNED_IN` handler (after the existing `_migrateLegacyLocalKeys` guest
-bucket merge); `JourneysPhase`/`CompletionPhase`/`ReportViewerPhase`
(the Dashboard-equivalent screens) now read through a shared
`useSyncedSessions()` hook that shows the local cache immediately, then
merges in the server's copy for a real account; a persistent
`SyncStatusBanner` with a manual Retry button appears whenever a session
has a recorded sync error, and never disappears on a timer -- only once
that session actually syncs. The older single-blob `window.storage`
sync path (`user_data` table) is untouched and keeps running alongside
this as an additional redundancy layer, not replaced.

### Stage 3 test results

`npm test`: **67 passed, 0 failed** (the 50 pre-existing Stage 2 tests,
unaffected, plus 17 new Stage 3 tests across `session-complete.test.js`
and `session-sync.test.js`).

### Stage 3 items requiring live staging verification

- The `reports.session_id` unique-violation (`23505`) fallback path in
  `session-complete.js` -- the in-memory mock Supabase used by unit tests
  only enforces uniqueness on `id`, not on an arbitrary column, so this
  defensive branch is exercised by code review and by the real DB
  constraint (`reports` migration's `session_id uuid not null unique`),
  not by a mock-backed unit test.
- End-to-end guest-to-account transfer and cross-device Dashboard
  loading against a real Supabase project and real browser (unit tests
  use a fake fetch/localStorage; no live staging or production run has
  been performed as part of this stage).
