// public/session-sync.js — Stage 3 (session-persistence-audit): pure,
// dependency-injected client-side sync layer between localStorage (the
// always-on offline/cache layer -- never cleared by this file) and the
// server API (/api/sessions, /api/session-complete, /api/reports).
//
// Every dependency (fetch, auth-token lookup, storage, clock) is injected,
// so this file's logic -- idempotent create+complete, guest-to-account
// transfer, retry-on-failure bookkeeping, server-authoritative merge for
// Dashboard loading -- is fully unit tested with no browser, no network,
// and no database (see api/__tests__/session-sync.test.js).
//
// Loaded as a plain <script> in index.html (this app has no bundler --
// see build/compile.js's own header comment) and also require()-able
// directly from Node tests: this directory has no package.json, so
// Node's default module resolution treats this file as CommonJS, which
// is why it uses module.exports instead of ESM import/export.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SessionSync = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function isRealAccountUid(uid) {
    return !!uid && uid !== "local" && uid !== "local-user";
  }

  function sessionStorageKey(uid) {
    return "saycrd-" + uid + "-sessions";
  }

  // Fields that exist on a local session object only for this sync
  // layer's own bookkeeping (or are sent to the server separately, like
  // fieldReport) -- never part of "session content" sent to /api/sessions
  // or /api/session-complete's session_content.
  var LOCAL_ONLY_KEYS = ["_syncStage", "_syncError", "_syncedAt", "id", "fieldReport"];

  function sessionToContent(session) {
    var out = {};
    Object.keys(session || {}).forEach(function (k) {
      if (LOCAL_ONLY_KEYS.indexOf(k) === -1) out[k] = session[k];
    });
    return out;
  }

  function readLocalSessions(storage, uid) {
    var raw = null;
    try {
      raw = storage.getItem(sessionStorageKey(uid));
    } catch (e) {}
    var parsed;
    try {
      parsed = JSON.parse(raw || "[]");
    } catch (e) {
      parsed = [];
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  function writeLocalSessions(storage, uid, sessions) {
    try {
      storage.setItem(sessionStorageKey(uid), JSON.stringify(sessions));
    } catch (e) {}
  }

  function newFallbackId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for environments without crypto.randomUUID -- still
    // sufficiently unique for session identity/idempotency, never used
    // for anything security-sensitive.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function createSessionSync(deps) {
    deps = deps || {};
    var fetchImpl = deps.fetchImpl;
    var getToken = deps.getToken || function () { return Promise.resolve(null); };
    var storage = deps.storage;
    var now = deps.now || function () { return new Date().toISOString(); };

    function authedRequest(path, opts) {
      return getToken().then(function (token) {
        if (!token) return { noToken: true };
        var headers = Object.assign({ "Content-Type": "application/json" }, opts && opts.headers, {
          Authorization: "Bearer " + token,
        });
        return fetchImpl(path, Object.assign({}, opts, { headers: headers }))
          .then(function (res) {
            return Promise.resolve(res.json ? res.json().catch(function () { return null; }) : null).then(function (body) {
              return { ok: res.ok, status: res.status, body: body };
            });
          })
          .catch(function (err) {
            return { networkError: true, error: err && err.message };
          });
      });
    }

    function createDraftSession(session) {
      var body = { id: session.id, content: sessionToContent(session) };
      return authedRequest("/api/sessions", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
        if (r.noToken) return { ok: false, retry: false, reason: "no_token" };
        if (r.networkError) return { ok: false, retry: true, reason: "network" };
        if (r.status === 200 || r.status === 201) return { ok: true, session: r.body && r.body.session };
        if (r.status >= 500) return { ok: false, retry: true, reason: "server_error" };
        return { ok: false, retry: false, reason: (r.body && r.body.error) || "request_failed" };
      });
    }

    function completeSession(session, reportContent, verdict) {
      var body = {
        session_id: session.id,
        session_content: sessionToContent(session),
        report_content: reportContent || {},
      };
      if (verdict) body.one_line_verdict = verdict;
      return authedRequest("/api/session-complete", { method: "POST", body: JSON.stringify(body) }).then(function (r) {
        if (r.noToken) return { ok: false, retry: false, reason: "no_token" };
        if (r.networkError) return { ok: false, retry: true, reason: "network" };
        if (r.status === 200) return { ok: true, session: r.body && r.body.session, report: r.body && r.body.report };
        if (r.status >= 500) return { ok: false, retry: true, reason: "server_error" };
        return { ok: false, retry: false, reason: (r.body && r.body.error) || "request_failed" };
      });
    }

    // Advances one local session as far toward "fully synced" as it can
    // go in one call: create (if not already created server-side) then,
    // if a field report exists locally, complete. Safe to call
    // repeatedly -- never re-sends a stage that already succeeded
    // (session._syncStage), and the server-side create/complete routes
    // are themselves idempotent, so a retry after a partial success (e.g.
    // create succeeded, complete's network call then failed) can never
    // duplicate the session server-side.
    function syncOneSession(session) {
      if (session._syncStage === "complete") return Promise.resolve({ ok: true, stage: "complete", unchanged: true });

      var createStep = session._syncStage === "draft" ? Promise.resolve({ ok: true }) : createDraftSession(session);

      return createStep.then(function (createResult) {
        if (!createResult.ok) {
          return { ok: false, stage: session._syncStage || null, retry: createResult.retry, reason: createResult.reason };
        }
        if (!session.fieldReport) return { ok: true, stage: "draft" };
        var verdict = session.fieldReport.oneLineVerdict || session.fieldReport.one_line_verdict || null;
        return completeSession(session, session.fieldReport, verdict).then(function (completeResult) {
          if (!completeResult.ok) {
            return { ok: false, stage: "draft", retry: completeResult.retry, reason: completeResult.reason };
          }
          return { ok: true, stage: "complete" };
        });
      });
    }

    // Syncs every not-yet-fully-synced local session for a real account,
    // in place, without ever deleting a local session -- this is the
    // guest-to-account-transfer path (call right after sign-up/sign-in)
    // and the ongoing "keep syncing as sessions/reports complete" path
    // (call after every local save). Persists progress back to
    // localStorage after every session, one at a time, so a page
    // close/crash mid-sync can never lose already-confirmed server state.
    function syncPendingSessions(uid) {
      if (!isRealAccountUid(uid)) return Promise.resolve({ synced: 0, failed: 0, pending: 0 });
      var sessions = readLocalSessions(storage, uid);
      var synced = 0;
      var failed = 0;

      function step(i) {
        if (i >= sessions.length) return Promise.resolve();
        var session = sessions[i];
        if (!session || session._syncStage === "complete") return step(i + 1);
        if (!session.id) {
          // Safety net only: every session created going forward is
          // assigned a UUID at save time (see saveSession in app.jsx).
          // This covers a session saved by an older build before that
          // existed, so it can still be synced instead of silently
          // skipped forever.
          session.id = newFallbackId();
        }
        return syncOneSession(session)
          .then(function (result) {
            if (result.stage) session._syncStage = result.stage;
            if (result.ok) {
              session._syncError = null;
              session._syncedAt = now();
              if (result.stage === "complete") synced++;
            } else {
              session._syncError = result.reason || "unknown";
              failed++;
            }
            writeLocalSessions(storage, uid, sessions);
          })
          .then(function () {
            return step(i + 1);
          });
      }

      return step(0).then(function () {
        var pending = sessions.filter(function (s) {
          return s && s._syncStage !== "complete";
        }).length;
        return { synced: synced, failed: failed, pending: pending };
      });
    }

    function loadSessionsFromServer(opts) {
      opts = opts || {};
      var qs = [];
      if (opts.limit) qs.push("limit=" + encodeURIComponent(opts.limit));
      if (opts.cursor) qs.push("cursor=" + encodeURIComponent(opts.cursor));
      var path = "/api/sessions" + (qs.length ? "?" + qs.join("&") : "");
      return authedRequest(path, { method: "GET" }).then(function (r) {
        if (r.noToken) return { ok: false, reason: "no_token" };
        if (r.networkError) return { ok: false, reason: "network" };
        if (r.status !== 200) return { ok: false, reason: (r.body && r.body.error) || "request_failed" };
        return { ok: true, sessions: (r.body && r.body.sessions) || [], nextCursor: r.body && r.body.next_cursor };
      });
    }

    function loadReportFromServer(sessionId) {
      return authedRequest("/api/reports?session_id=" + encodeURIComponent(sessionId), { method: "GET" }).then(function (r) {
        if (r.noToken) return { ok: false, reason: "no_token" };
        if (r.networkError) return { ok: false, reason: "network" };
        if (r.status === 404) return { ok: true, report: null };
        if (r.status !== 200) return { ok: false, reason: (r.body && r.body.error) || "request_failed" };
        return { ok: true, report: (r.body && r.body.report) || null };
      });
    }

    // Server is authoritative for a real account's session history: a
    // server row not present locally (e.g. this is a new browser/device)
    // is added; a server row that IS also present locally is merged with
    // LOCAL fields taking priority for any overlapping key (local always
    // has everything already pushed to the server plus anything generated
    // since the last successful sync) -- the same "local wins on
    // conflict" rule index.html's existing _hydrateFromServer already
    // uses for the older blob-storage sync path. This function never
    // removes a local session, synced or not.
    function mergeServerSessionsIntoLocal(uid, serverSessions) {
      var local = readLocalSessions(storage, uid);
      var byId = {};
      local.forEach(function (s, i) {
        if (s && s.id) byId[s.id] = i;
      });

      (serverSessions || []).forEach(function (srv) {
        var content = srv.content || {};
        var stage = srv.status === "completed" ? "complete" : "draft";
        var serverAsLocal = Object.assign({}, content, { id: srv.id, _syncStage: stage, _syncedAt: now() });
        if (byId[srv.id] === undefined) {
          local.push(serverAsLocal);
        } else {
          var idx = byId[srv.id];
          local[idx] = Object.assign({}, serverAsLocal, local[idx], { _syncStage: stage, _syncedAt: now() });
        }
      });

      local.sort(function (a, b) {
        return (a && a.date ? a.date : "") < (b && b.date ? b.date : "") ? -1 : 1;
      });
      writeLocalSessions(storage, uid, local);
      return local;
    }

    return {
      sessionToContent: sessionToContent,
      createDraftSession: createDraftSession,
      completeSession: completeSession,
      syncOneSession: syncOneSession,
      syncPendingSessions: syncPendingSessions,
      loadSessionsFromServer: loadSessionsFromServer,
      loadReportFromServer: loadReportFromServer,
      mergeServerSessionsIntoLocal: mergeServerSessionsIntoLocal,
    };
  }

  return {
    createSessionSync: createSessionSync,
    isRealAccountUid: isRealAccountUid,
    sessionStorageKey: sessionStorageKey,
  };
});
