// api/__tests__/_mock-supabase.js — a small in-memory stand-in for the
// subset of the supabase-js query builder Stage 2's routes use (select,
// eq, or, order, limit, single, maybeSingle, insert, update, delete). Not
// a real Postgres client and does not evaluate `.or()` filter expressions
// (see the route contract table's "requires live staging verification"
// note on keyset-cursor SQL semantics) — it is good enough to unit-test
// route logic (validation, whitelisting, ownership filtering, response
// shaping, idempotency) without a database or network access, per Stage
// 2's requirement to use mocks or an isolated test configuration and never
// production credentials in automated tests.

function project(row, selectFields) {
  if (!selectFields || selectFields === "*") return { ...row };
  const fields = selectFields.split(",").map((f) => f.trim());
  const out = {};
  for (const f of fields) out[f] = row[f];
  return out;
}

class MockQueryBuilder {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this.mode = null; // 'select' | 'insert' | 'update' | 'delete'
    this.filters = [];
    this.insertPayload = null;
    this.updatePayload = null;
    this.selectFields = "*";
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.orderSpecs = [];
    this.limitN = null;
  }

  select(fields) {
    if (this.mode === null) this.mode = "select";
    this.selectFields = fields;
    return this;
  }
  insert(row) {
    this.mode = "insert";
    this.insertPayload = row;
    return this;
  }
  update(patch) {
    this.mode = "update";
    this.updatePayload = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(col, val) {
    this.filters.push({ col, val });
    return this;
  }
  or() {
    // Not evaluated by this mock — see file header.
    return this;
  }
  order(col, opts) {
    this.orderSpecs.push({ col, ascending: !!(opts && opts.ascending) });
    return this;
  }
  limit(n) {
    this.limitN = n;
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantMaybeSingle = true;
    return this;
  }

  _matches(row) {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  async _run() {
    const rows = this.state[this.table];

    if (this.mode === "insert") {
      const toInsert = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload];
      const inserted = [];
      for (const partial of toInsert) {
        if (partial.id && rows.some((r) => r.id === partial.id)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const row = {
          id: partial.id || `generated-${rows.length}-${Math.random().toString(36).slice(2)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "draft",
          schema_version: 1,
          content: {},
          note: null,
          label: null,
          session_id: null,
          source: "report",
          ...partial,
        };
        rows.push(row);
        inserted.push(row);
      }
      return this._shapeResult(inserted);
    }

    if (this.mode === "update") {
      const matched = rows.filter((r) => this._matches(r));
      matched.forEach((r) => Object.assign(r, this.updatePayload, { updated_at: new Date().toISOString() }));
      return this._shapeResult(matched);
    }

    if (this.mode === "delete") {
      const matched = rows.filter((r) => this._matches(r));
      const matchedIds = new Set(matched.map((r) => r.id));
      this.state[this.table] = rows.filter((r) => !matchedIds.has(r.id));
      return this._shapeResult(matched);
    }

    // select
    let matched = rows.filter((r) => this._matches(r));
    if (this.orderSpecs.length) {
      matched = [...matched].sort((a, b) => {
        for (const spec of this.orderSpecs) {
          const av = a[spec.col];
          const bv = b[spec.col];
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return spec.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    return this._shapeResult(matched);
  }

  _shapeResult(matchedRows) {
    const projected = matchedRows.map((r) => project(r, this.selectFields));
    if (this.wantSingle) {
      if (projected.length !== 1) return { data: null, error: { message: "not found or not unique" } };
      return { data: projected[0], error: null };
    }
    if (this.wantMaybeSingle) {
      if (projected.length === 0) return { data: null, error: null };
      return { data: projected[0], error: null };
    }
    return { data: projected, error: null };
  }

  then(resolve, reject) {
    this._run().then(resolve, reject);
  }
}

export function createMockSupabase(fixtures = {}) {
  const state = {
    sessions: [...(fixtures.sessions || [])],
    reports: [...(fixtures.reports || [])],
    captures: [...(fixtures.captures || [])],
    bookmarks: [...(fixtures.bookmarks || [])],
  };
  return {
    from(table) {
      return new MockQueryBuilder(table, state);
    },
    _state: state,
  };
}

// Fake getAuthedUser factories for tests: `authedAs(user)` returns a
// deps-shaped async function that always resolves to that user;
// `unauthenticated` always resolves to null, matching the real
// getAuthedUser's contract for a missing/invalid Authorization header.
export function authedAs(user) {
  return async function fakeGetAuthedUser() {
    return user;
  };
}

export async function unauthenticatedGetAuthedUser() {
  return null;
}
