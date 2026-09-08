/*
 * auth-layer.js — Supabase configuration, storage adapter, session sync and
 * auth initialisation. Moved verbatim out of index.html so that a signed-out
 * visitor never downloads or executes any of it.
 *
 * Loaded on demand by __saycrdEnsureAuth() in index.html's boot loader: when a
 * persisted session token exists at boot, or when the visitor opens the auth
 * overlay. A guest who continues without an account never loads this file, and
 * runs on localStorage exactly as it already does when Supabase is unreachable.
 *
 * This is a classic <script>, NOT a module, and that is load-bearing: every
 * top-level declaration here has to stay a global. app.jsx reads window._authReady,
 * window.storage, window._sessionSync and window.currentUser, and index.html's
 * eager overlay block assigns the bare `currentUser`. As a module they would all
 * become module-local and silently break the boot gate.
 */

/* ====================================================================
   SAYCRD — Configuration

   The Supabase values are NOT hardcoded here. This file is one static asset
   shared by every deployment, so a literal project URL in it pointed Preview
   deployments at the production database — while the API half of the app reads
   process.env and could be pointed elsewhere, which would hand a staging API
   production-issued JWTs it cannot verify.

   They now come from env-config.js, generated per deployment by
   build/env-config.js from environment variables. That build step refuses to
   emit anything but a browser-safe anon/publishable key, refuses to build
   Preview against production, and refuses to build Production against
   anything else.
   ==================================================================== */
const SAYCRD_ENV = window.SAYCRD_ENV_CONFIG || null;
const SAYCRD_CONFIG = {
  SUPABASE_URL: (SAYCRD_ENV && SAYCRD_ENV.SUPABASE_URL) || "",
  SUPABASE_ANON_KEY: (SAYCRD_ENV && SAYCRD_ENV.SUPABASE_ANON_KEY) || "",
  API_ENDPOINT: "/api/claude",
};

/* ====================================================================
   Supabase Client + Auth
   ==================================================================== */
var sbClient = null;
window.sbClient = null;
var supabaseAvailable = false;
try {
  // Fail closed. With no browser configuration there is no authentication, so
  // do not build a client against empty values and appear half-working: leave
  // supabaseAvailable false so the app uses local-only storage, exactly as it
  // already does whenever Supabase is unreachable.
  if (!SAYCRD_CONFIG.SUPABASE_URL || !SAYCRD_CONFIG.SUPABASE_ANON_KEY) {
    throw new Error("env-config.js missing or incomplete — no browser Supabase configuration");
  }
  sbClient = window.supabase.createClient(
    SAYCRD_CONFIG.SUPABASE_URL,
    SAYCRD_CONFIG.SUPABASE_ANON_KEY
  );
  window.sbClient = sbClient;
  supabaseAvailable = true;
  console.log("Supabase client initialized");
} catch(sbInitErr) {
  console.warn("Supabase unavailable:", sbInitErr.message || sbInitErr);
}

/* Adopt whatever is already there instead of clearing it. This file now loads on
   demand, so it can arrive AFTER index.html's eager bypass block has already set
   window.currentUser — a guest who continued without an account and then opened
   the overlay to sign up. Resetting it to null here would silently sign that
   guest out mid-flow. On a normal first load window.currentUser is null anyway,
   so this is identical to the previous initialisation. */
var currentUser = window.currentUser || null;
window.currentUser = currentUser;

/* ── Storage Adapter (drop-in replacement for window.storage) ── */
/* Saves to Supabase if authenticated + available, otherwise localStorage */
/* AUTH GATE: storage ops wait for auth to resolve before executing */
var _authReady = null;
var _authResolve = null;
_authReady = new Promise(function(resolve) { _authResolve = resolve; });
window._authResolve = _authResolve;
/* Timeout: if auth doesn't resolve in 5s, proceed with whatever we have */
setTimeout(function() { _authResolve(); }, 5000);

function _storageMode() {
  if (currentUser && supabaseAvailable && currentUser.id !== "local-user") return "supabase";
  return "local";
}
function _localGet(key) {
  var uid = (currentUser && currentUser.id) || "local-user";
  var v = localStorage.getItem("saycrd-" + uid + "-" + key);
  if (v === null) return null;
  return { key: key, value: v };
}
function _localSet(key, value) {
  var uid = (currentUser && currentUser.id) || "local-user";
  localStorage.setItem("saycrd-" + uid + "-" + key, value);
  return { key: key, value: value };
}
function _localDelete(key) {
  var uid = (currentUser && currentUser.id) || "local-user";
  localStorage.removeItem("saycrd-" + uid + "-" + key);
  return { key: key, deleted: true };
}
function _localList(prefix) {
  var uid = (currentUser && currentUser.id) || "local-user";
  var pfx = "saycrd-" + uid + "-";
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf(pfx) === 0) {
      var clean = k.slice(pfx.length);
      if (!prefix || clean.indexOf(prefix) === 0) keys.push(clean);
    }
  }
  return { keys: keys };
}

/* ── Sync local data up to Supabase (runs once after auth) ── */
async function _syncLocalToSupabase() {
  if (_storageMode() !== "supabase") return;
  var uid = currentUser.id;
  var pfx = "saycrd-" + uid + "-";
  var synced = 0;
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf(pfx) === 0) {
      var cleanKey = k.slice(pfx.length);
      var val = localStorage.getItem(k);
      if (!val) continue;
      try {
        /* Check if supabase already has this key */
        var { data } = await sbClient.from("user_data").select("key").eq("user_id", uid).eq("key", cleanKey).limit(1);
        if (!data || data.length === 0) {
          /* Supabase doesn't have it — push local up */
          var parsed; try { parsed = JSON.parse(val); } catch(e) { parsed = val; }
          await sbClient.from("user_data").upsert({ user_id: uid, key: cleanKey, value: parsed }, { onConflict: "user_id,key" });
          synced++;
        }
      } catch(e) { /* skip silently */ }
    }
  }
  if (synced > 0) console.log("Synced " + synced + " local keys to Supabase");
}

/* ── Migrate pre-auth "Continue without account" localStorage into the real  */
/* signed-in uid ── */
/* Only the explicit "Continue without account" bypass ("local-user") gets    */
/* carried over into a newly created/logged-in real account, so someone who  */
/* deliberately continued as a guest keeps continuity if they later sign up. */
/* Plain anonymous browsing ("local" — no bypass, no account) never migrates: */
/* real accounts are meant to start online with a clean slate, never         */
/* inheriting whatever guest history happens to be sitting in that browser.  */
function _migrateLegacyLocalKeys(uid) {
  if (!uid || uid === "local-user" || uid === "local") return;
  var legacyUids = ["local-user"];
  var localUserPfx = "saycrd-local-user-";
  var newPfx = "saycrd-" + uid + "-";
  var migrated = 0;
  legacyUids.forEach(function(legacyUid) {
    var legacyPfx = "saycrd-" + legacyUid + "-";
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf(legacyPfx) !== 0) continue;
      /* "saycrd-local-" is a prefix of "saycrd-local-user-" — when scanning
         the shorter "local" uid, skip keys that actually belong to the more
         specific "local-user" uid (already migrated in the prior pass). */
      if (legacyUid === "local" && k.indexOf(localUserPfx) === 0) continue;
      keys.push(k);
    }
    keys.forEach(function(k) {
      var cleanKey = k.slice(legacyPfx.length);
      var newKey = newPfx + cleanKey;
      var legacyVal = localStorage.getItem(k);
      if (!legacyVal) return;
      if (cleanKey === "sessions") {
        /* Merge by the session's own date timestamp — the same dedup key
           _hydrateFromServer uses — so re-running this on a later sign-in
           can't duplicate sessions. */
        var existing = [];
        try { existing = JSON.parse(localStorage.getItem(newKey) || "[]"); } catch(e) {}
        if (!Array.isArray(existing)) existing = [];
        var legacySessions = [];
        try { legacySessions = JSON.parse(legacyVal || "[]"); } catch(e) {}
        if (!Array.isArray(legacySessions) || legacySessions.length === 0) return;
        var seen = {};
        existing.forEach(function(s) { if (s && s.date) seen[s.date] = true; });
        var added = 0;
        legacySessions.forEach(function(s) {
          if (!s || !s.date || seen[s.date]) return;
          seen[s.date] = true;
          existing.push(s);
          added++;
        });
        if (added > 0) {
          existing.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
          localStorage.setItem(newKey, JSON.stringify(existing));
          migrated += added;
        }
      } else if (localStorage.getItem(newKey) === null) {
        /* Non-session key: only copy if the real account doesn't already have it. */
        localStorage.setItem(newKey, legacyVal);
        migrated++;
      }
      /* Leave the old anonymous-uid key in place — harmless leftover,
         avoids data loss if migration partially fails. Just stop reading
         from it going forward (loadSessions()/_sessionKey() already key
         off getCurrentUid(), which resolves to the real uid post-migration). */
    });
  });
  if (migrated > 0) console.log("[SAYCRD] Migrated " + migrated + " item(s) from anonymous storage into account " + uid);
}

/* ── Hydrate localStorage from Supabase (runs after auth on new/different device) ── */
/* Fetches sessions from server and merges with local.                                */
async function _hydrateFromServer() {
  if (!currentUser || !supabaseAvailable || currentUser.id === "local-user") return;
  var uid = currentUser.id;
  try {
    var { data, error } = await sbClient
      .from("user_data")
      .select("value, updated_at")
      .eq("user_id", uid)
      .eq("key", "sessions")
      .limit(1);
    if (error || !data || data.length === 0) return;
    var serverSessions = Array.isArray(data[0].value) ? data[0].value : JSON.parse(data[0].value || "[]");
    if (!Array.isArray(serverSessions) || serverSessions.length === 0) return;

    var localKey = "saycrd-" + uid + "-sessions";
    var localSessions = [];
    try { localSessions = JSON.parse(localStorage.getItem(localKey) || "[]"); } catch(e) {}

    // Merge by date string. This used to concat server-then-local and keep
    // whichever copy of a shared date appeared FIRST — i.e. the server's.
    // This function runs on every SIGNED_IN event, which supabase-js also
    // fires on a plain page reload/relaunch (not just a fresh sign-in on a
    // new device) whenever it restores a persisted session. So on ANY
    // reload, if the local copy has a just-generated field report (or
    // sentence-feedback edit) that hasn't finished its own async push to
    // Supabase yet — very easy on mobile, where the app gets backgrounded
    // or relaunched moments after finishing a session — the server's older,
    // report-less copy of that same date SILENTLY OVERWROTE the local one.
    // The cached report was gone, so every later "Read Your Report" click
    // looked like it was generating from scratch again, even for a report
    // that had already been written once. Fix: for a shared date, merge the
    // two objects with the LOCAL fields taking priority — local always has
    // everything the server does (it's the source every push comes from)
    // plus anything generated since the last successful push, so it can
    // only ever be equal to or richer than the server's copy.
    var localByDate = {};
    localSessions.forEach(function(s) { if (s && s.date) localByDate[s.date] = s; });
    var merged = serverSessions.map(function(s) {
      if (s && s.date && localByDate[s.date]) return Object.assign({}, s, localByDate[s.date]);
      return s;
    }).filter(function(s) { return s && s.date; });
    var mergedDates = {};
    merged.forEach(function(s) { mergedDates[s.date] = true; });
    localSessions.forEach(function(s) {
      if (s && s.date && !mergedDates[s.date]) { merged.push(s); mergedDates[s.date] = true; }
    });
    merged.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    if (merged.length > 100) merged = merged.slice(-100);

    if (merged.length > localSessions.length) {
      localStorage.setItem(localKey, JSON.stringify(merged));
      console.log("[SAYCRD] Hydrated from server:", merged.length, "sessions (had", localSessions.length, "locally)");
      // Trigger app re-read by firing a custom event React can listen to
      try { window.dispatchEvent(new CustomEvent("saycrd-sessions-hydrated", { detail: { count: merged.length } })); } catch(e) {}
    }

    // Push any local-only sessions back to server
    if (merged.length > serverSessions.length) {
      await sbClient.from("user_data").upsert(
        { user_id: uid, key: "sessions", value: merged },
        { onConflict: "user_id,key" }
      );
      console.log("[SAYCRD] Pushed merged sessions back to server.");
    }
  } catch(e) {
    console.warn("[SAYCRD] Hydration failed (not critical):", e);
  }
}

window.storage = {
  async get(key) {
    await _authReady;
    if (!currentUser) throw new Error("Not authenticated");
    if (_storageMode() === "local") return _localGet(key);
    try {
      const { data, error } = await sbClient
        .from("user_data")
        .select("key, value")
        .eq("user_id", currentUser.id)
        .eq("key", key)
        .limit(1);
      if (error) { console.warn("Supabase get error for '" + key + "':", error.message); return _localGet(key); }
      var row = data && data.length > 0 ? data[0] : null;
      if (row) {
        /* Got from Supabase — also update local cache */
        var val = JSON.stringify(row.value);
        _localSet(key, val);
        return { key: row.key, value: val };
      }
      /* Supabase returned nothing — check if local has it (migration case) */
      var local = _localGet(key);
      if (local && local.value) {
        /* Push local data up to Supabase */
        try {
          var parsed; try { parsed = JSON.parse(local.value); } catch(e) { parsed = local.value; }
          await sbClient.from("user_data").upsert({ user_id: currentUser.id, key: key, value: parsed }, { onConflict: "user_id,key" });
          console.log("Migrated '" + key + "' from local to Supabase");
        } catch(e) { /* migration failed, no big deal */ }
        return local;
      }
      return null;
    } catch(e) { console.warn("Supabase get failed for '" + key + "':", e); return _localGet(key); }
  },

  async set(key, value) {
    await _authReady;
    if (!currentUser) throw new Error("Not authenticated");
    /* Always write to localStorage as backup */
    _localSet(key, value);
    if (_storageMode() === "local") return { key: key, value: value };
    try {
      let parsed;
      try { parsed = JSON.parse(value); } catch(e) { parsed = value; }
      const { error } = await sbClient
        .from("user_data")
        .upsert({
          user_id: currentUser.id,
          key: key,
          value: parsed
        }, { onConflict: "user_id,key" });
      if (error) { console.warn("Supabase set error for '" + key + "':", error.message); }
      return { key: key, value: value };
    } catch(e) { console.warn("Supabase set failed for '" + key + "':", e); return { key: key, value: value }; }
  },

  async delete(key) {
    await _authReady;
    if (!currentUser) throw new Error("Not authenticated");
    _localDelete(key);
    if (_storageMode() === "local") return { key: key, deleted: true };
    try {
      const { error } = await sbClient
        .from("user_data")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("key", key);
      if (error) console.warn("Supabase delete error:", error.message);
    } catch(e) { console.warn("Supabase delete failed:", e); }
    return { key: key, deleted: true };
  },

  async list(prefix) {
    await _authReady;
    if (!currentUser) throw new Error("Not authenticated");
    if (_storageMode() === "local") return _localList(prefix);
    try {
      let query = sbClient
        .from("user_data")
        .select("key")
        .eq("user_id", currentUser.id);
      if (prefix) query = query.like("key", prefix + "%");
      const { data, error } = await query;
      if (error) { console.warn("Supabase list error:", error.message); return _localList(prefix); }
      return { keys: (data || []).map(function(d) { return d.key; }) };
    } catch(e) { console.warn("Supabase list failed:", e); return _localList(prefix); }
  }
};

/* ====================================================================
   Stage 3 (session-persistence-audit): the new relational
   sessions/reports sync client (public/session-sync.js). Entirely
   separate from window.storage above (that still runs, unchanged, as
   the older single-blob "user_data" sync path) -- this is the bridge to
   the JWT-verified /api/sessions, /api/session-complete, and
   /api/reports routes that Stage 1/2 built and verified.
   ==================================================================== */
window._sessionSync = window.SessionSync && window.SessionSync.createSessionSync({
  fetchImpl: function(url, opts) { return fetch(url, opts); },
  getToken: async function() {
    if (window._saycrdToken) return window._saycrdToken;
    if (window.sbClient && window.sbClient.auth) {
      try {
        var ss = await window.sbClient.auth.getSession();
        if (ss && ss.data && ss.data.session) return ss.data.session.access_token;
      } catch(e) {}
    }
    return null;
  },
  storage: window.localStorage,
  now: function() { return new Date().toISOString(); },
});

function _syncPendingSessionsToServer(uid) {
  if (!window._sessionSync || !uid) return;
  window._sessionSync.syncPendingSessions(uid).then(function(result) {
    try { window.dispatchEvent(new CustomEvent("saycrd-sync-status", { detail: { pendingErrors: (result && result.failed) || 0 } })); } catch(e) {}
  }).catch(function(e) { console.warn("[SAYCRD] Session sync failed:", e); });
}


/* ====================================================================
   Session-pack paywall
   Real accounts get 2 free sessions (tracked server-side), then must buy
   a pack via Square Checkout. guardedStart() (in app.jsx) calls
   _consumeSessionCredit() before letting a real account start a session
   -- despite the name, this is a read-only eligibility check against
   /api/session-start (it consumes nothing): it lets the client show the
   paywall up front instead of the user investing time in a session that
   can't be completed. The entitlement itself is only ever actually
   consumed atomically, at session-complete time, by the
   complete_session_and_consume_entitlement RPC (see
   api/session-complete.js) -- so this check's answer is advisory only,
   and a "yes" here followed by running out of entitlement before
   completion (e.g. two tabs finishing concurrently) is handled safely by
   session-complete.js, not by this function. Any network/server hiccup
   here fails OPEN so an outage never strands a paying user mid-session.
   ==================================================================== */
window._consumeSessionCredit = async function() {
  var tok = window._saycrdToken;
  if (!tok && window.sbClient && window.sbClient.auth) {
    try {
      var ss = await window.sbClient.auth.getSession();
      if (ss && ss.data && ss.data.session) tok = ss.data.session.access_token;
    } catch(e) {}
  }
  if (!tok) return { ok: true }; /* no token shouldn't happen for a real account — fail open */
  try {
    var r = await fetch("/api/session-start", { method: "POST", headers: { "Authorization": "Bearer " + tok } });
    if (r.status === 402) return { ok: false };
    if (!r.ok) return { ok: true }; /* fail open on server error */
    return await r.json();
  } catch(e) {
    return { ok: true }; /* fail open on network error */
  }
};

window._showPaywall = function() {
  window.dispatchEvent(new CustomEvent("saycrd-show-paywall"));
};

window._showAdminTiers = function() {
  window.dispatchEvent(new CustomEvent("saycrd-show-admin-tiers"));
};

/* ── Auth: restore session + sign out (all form handlers are inline in HTML) ── */
(function() {
  try {
    if (sbClient && sbClient.auth) {
      sbClient.auth.getSession().then(function(result) {
        if (result.data.session) {
          currentUser = result.data.session.user;
          window.currentUser = currentUser;
          window._saycrdToken = result.data.session.access_token;
          var o = document.getElementById("auth-overlay");
          if (o) { o.classList.remove("is-visible"); o.style.transition = "opacity .4s ease"; setTimeout(function(){ o.style.display = "none"; }, 400); }
          window.dispatchEvent(new CustomEvent("saycrd-auth-change"));
          console.log("Session restored for:", currentUser.email);
          /* Resolve auth gate so storage ops proceed */
          if (_authResolve) _authResolve();
          /* Sync any local-only data up to Supabase */
          _syncLocalToSupabase().catch(function(e) { console.warn("Sync failed:", e); });
          /* Stage 3: retry anything left pending from a previous visit
             (e.g. a save that failed mid-session last time). */
          _syncPendingSessionsToServer(currentUser.id);
        } else {
          /* No session — resolve gate anyway so local mode works */
          if (_authResolve) _authResolve();
        }
      }).catch(function(e) {
        console.warn("Session restore failed:", e);
        if (_authResolve) _authResolve();
      });

      sbClient.auth.onAuthStateChange(function(event, session) {
        /* Password-recovery links log the user in via a special "recovery"
           session so they can call updateUser() — but they still need to
           actually pick a new password before we let them into the app.
           Show the "set a new password" form instead of the normal
           sign-in flow, and hold the overlay open until they've done so. */
        if (event === "PASSWORD_RECOVERY") {
          window._passwordRecoveryPending = true;
          currentUser = session && session.user;
          window.currentUser = currentUser;
          if (session) window._saycrdToken = session.access_token;
          if (_authResolve) _authResolve();
          var ro = document.getElementById("auth-overlay");
          if (ro) { ro.style.transition = "none"; ro.style.display = "flex"; ro.style.opacity = "1"; ro.classList.add("is-visible"); void ro.offsetHeight; ro.style.transition = ""; }
          ["auth-login","auth-signup","auth-reset"].forEach(function(id){ var el=document.getElementById(id); if(el) el.style.display="none"; });
          var bypassRow = document.getElementById("auth-bypass-row"); if (bypassRow) bypassRow.style.display = "none";
          var npForm = document.getElementById("auth-new-password"); if (npForm) npForm.style.display = "block";
          setTimeout(function(){ var f=document.getElementById("auth-new-password-input"); if (f) f.focus(); }, 80);
          return;
        }
        if (window._passwordRecoveryPending) return; /* don't let a stray event close the form early */
        if (session && session.user) {
          currentUser = session.user;
          window.currentUser = currentUser;
          window._saycrdToken = session.access_token;
          var o = document.getElementById("auth-overlay");
          if (o) { o.classList.remove("is-visible"); o.style.transition = "opacity .4s ease"; setTimeout(function(){ o.style.display = "none"; }, 400); }
          window.dispatchEvent(new CustomEvent("saycrd-auth-change"));
          /* Resolve auth gate on sign-in too */
          if (_authResolve) _authResolve();
          /* On sign-in: hydrate from server first (new device recovery),
             then push any local-only data up. Both are non-blocking. */
          if (event === "SIGNED_IN") {
            try { _migrateLegacyLocalKeys(session.user.id); } catch(e) { console.warn("[SAYCRD] Legacy key migration failed:", e); }
            _hydrateFromServer().then(function() {
              return _syncLocalToSupabase();
            }).catch(function(e) { console.warn("[SAYCRD] Post-login sync failed:", e); });
            /* Stage 3 (session-persistence-audit): the guest-to-account
               transfer. Runs after _migrateLegacyLocalKeys so a
               "Continue without account" guest's sessions have already
               been merged under this real uid before syncing them up to
               the relational sessions/reports API. */
            _syncPendingSessionsToServer(session.user.id);
          }
        }
      });
    } else {
      /* No supabase — resolve immediately */
      if (_authResolve) _authResolve();
    }
  } catch(e) {
    console.warn("Auth init:", e);
    if (_authResolve) _authResolve();
  }

  function doSignOut() {
    try { if (sbClient && sbClient.auth) sbClient.auth.signOut(); } catch(e) {}
    currentUser = null;
    window.currentUser = null;
    /* Signing out is not an attempt to sign in: clear the intent flag so the
       next background session resolution cannot be mistaken for a login. */
    window._authUserInitiated = false;
    window.dispatchEvent(new CustomEvent("saycrd-auth-change"));
    var o = document.getElementById("auth-overlay");
    if (o) { o.style.display = ""; o.style.opacity = "1"; }
  }
  window._signOut = doSignOut;
})();
