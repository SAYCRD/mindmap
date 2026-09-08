/*
 * landing-shell.jsx — the entry point of landing.compiled.js.
 *
 * Renders the public homepage on its own, without the application: React,
 * ReactDOM, landing.jsx and this file are the whole signed-out first paint.
 * Compiled ONLY into landing.compiled.js (never into app.compiled.js), because
 * app.jsx has its own root and its own routing for these same screens.
 *
 * It owns exactly two decisions and delegates everything else:
 *
 *   legal navigation  handled here, so reading the privacy/terms pages never
 *                     downloads the application.
 *   handing over      any point where the visitor stops being a passive reader
 *                     — starting a session, or signing in — loads app.compiled.js
 *                     and lets it take the screen.
 *
 * No entitlement, credit, paywall or disclaimer logic lives here. LandingPhase's
 * own guardedStart() still runs, and its `!window._consumeSessionCredit` branch
 * already falls through to onStart() when the app is not loaded yet, so the real
 * check happens once in app.jsx's beginSessionOrGate() — the same call the
 * unsplit build made.
 */

var _landingRoot = null;
/* Latched so a double-tap on "start a session", or a login landing at the same
   moment, cannot start two handovers. __saycrdLoadApp() dedupes the request
   itself; this also stops us re-entering the state changes around it. */
var _handingOff = false;

/* The four GRADIENTS entries this bundle can actually render, copied rather than
   imported because app.jsx's full GRADIENTS map is not part of the landing
   closure. api/__tests__/landing-split.test.js asserts these stay equal to
   app.jsx's own values, so the homepage cannot end up a different colour
   depending on which bundle drew it. */
var LANDING_GRADIENTS = {
  landing: "#000",
  privacy: "#0A0914",
  terms: "#0A0914",
  "disclaimer-info": "#0A0914",
};

function _handOffToApp(opts) {
  if (_handingOff) return;
  _handingOff = true;
  /* Read by app.jsx on mount: it means "this visitor already asked to begin",
     so the app must not re-present the homepage it was just handed over from. */
  if (opts && opts.startSession) window.__SAYCRD_START_REQUESTED = true;
  if (window.__saycrdLoadApp) window.__saycrdLoadApp();
}

function LandingShell() {
  /* "landing" | "privacy" | "terms" | "disclaimer-info" — the same page names
     app.jsx uses in PHASES, so LegalPage receives exactly the prop it expects. */
  var legalBoot = typeof window !== "undefined" ? window.__SAYCRD_LEGAL_PAGE : "";
  var [page, setPage] = useState(
    legalBoot === "privacy" || legalBoot === "terms" || legalBoot === "disclaimer-info" ? legalBoot : "landing"
  );

  /* phaseIn fades this wrapper from opacity 0.6 to 1. On a phone that is the
     LAST thing still standing between the visitor and a readable homepage:
     LandingPhase already renders fully opaque on its first paint on mobile
     (`revealed = isMobile || show`, no timers, no transitions), so the inner
     content is ready and the outer wrapper dims all of it anyway. Measured on
     production: the h1's own opacity was 1 while its ancestor sat at 0.6.

     Plain `innerWidth`, matching LandingPhase's own breakpoint, and deliberately
     NOT state with a resize listener: this is an entrance animation, so only its
     value at mount can ever matter. Under the build-time prerender this
     evaluates at the snapshot width, so the HTML ships with animation:none and
     the homepage in it is opaque from the first frame. */
  var isMobile = typeof window !== "undefined" && window.innerWidth < 480;

  useEffect(function () {
    function onAuthChange() {
      /* A guest bypass ("local-user") is NOT a login: it stays on the landing
         and only hands over when the visitor actually starts a session. */
      if (!_isRealAccount()) return;
      /* A real account signed in while the homepage was showing. Hand over and
         let app.jsx decide where they land: by now the session token is in
         localStorage, so its boot gate opens and routes to the Dashboard on its
         own — the behaviour the routing repairs were built around. Deciding
         that here would duplicate it and let the two drift. */
      _handOffToApp();
    }
    window.addEventListener("saycrd-auth-change", onAuthChange);
    /* index.html can dispatch this from getSession() before React commits, which
       for a cached token resolves with no network at all. Re-read on mount
       instead of trusting that the event was still to come. */
    onAuthChange();
    return function () { window.removeEventListener("saycrd-auth-change", onAuthChange); };
  }, []);

  /* SaycrdShell is the SHARED chrome from landing.jsx — the same component
     app.jsx renders — so the outer gradient, the webfont stylesheet and the
     global @keyframes are one definition rather than a copy. The inner wrappers
     mirror the app's: same full-bleed width, same safe-area padding, same
     scroll container, so the homepage is laid out identically in both bundles.

     This block used to inline its own copy of the shell, and the copy silently
     lost the @keyframes — every landing animation resolved to nothing. Render
     shared chrome here; do not re-inline it. */
  return (
    <SaycrdShell background={SAYCRD_SHELL_BG}>
      <div style={{width:"100%",maxWidth:"100%",height:"100%",minHeight:0,background:LANDING_GRADIENTS[page],position:"relative",display:"flex",flexDirection:"column",overflow:"hidden",transition:"background 0.8s ease",paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
        <div key={page} style={{width:"100%",flex:1,minHeight:0,overflow:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",animation:isMobile?"none":"phaseIn 0.25s ease-out"}}>
          {page === "landing"
            /* Kept mounted while app.compiled.js downloads. Swapping in a spinner
               here would show, then remove, a page the visitor is reading. */
            ? <LandingPhase
                onStart={function () { _handOffToApp({ startSession: true }); }}
                onNavigateLegal={function (p) { setPage(p); }}
              />
            : <LegalPage page={page} onBack={function () { setPage("landing"); }} />}
        </div>
      </div>
    </SaycrdShell>
  );
}

/* app.compiled.js calls this immediately before creating its own root. React
   refuses to hand the same container to createRoot() twice, so the landing has
   to release it first. */
window.__saycrdUnmountLanding = function () {
  if (!_landingRoot) return;
  try { _landingRoot.unmount(); } catch (e) {}
  _landingRoot = null;
};

_landingRoot = ReactDOM.createRoot(document.getElementById("root"));
_landingRoot.render(React.createElement(LandingShell));
