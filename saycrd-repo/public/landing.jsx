/*
 * landing.jsx — the signed-out public surface.
 *
 * Moved verbatim out of app.jsx so a first-time visitor can paint the homepage
 * without downloading the application, Supabase, or session sync.
 *
 * Compiled into BOTH bundles:
 *   landing.compiled.js = landing.jsx + landing-shell.jsx   (signed-out first paint)
 *   app.compiled.js     = landing.jsx + app.jsx             (identical to the old app)
 *
 * The closure is self-contained: it references no app.jsx identifier, only these
 * declarations plus React and window.* helpers. api/__tests__/landing-split.test.js
 * enforces that, so an edit here cannot silently reintroduce a dependency.
 */

const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;

function getCurrentUid() { return (typeof window !== "undefined" && window.currentUser && window.currentUser.id) ? window.currentUser.id : "local"; }

function _isRealAccount() { return typeof window !== "undefined" && !!(window.currentUser && window.currentUser.id && window.currentUser.id !== "local-user"); }

var FREE_GUEST_SESSION_LIMIT = 2;

function _guestSessionCount() {
  var count = 0;
  try { count += JSON.parse(localStorage.getItem("saycrd-local-sessions") || "[]").length; } catch(e) {}
  try { count += JSON.parse(localStorage.getItem("saycrd-local-user-sessions") || "[]").length; } catch(e) {}
  return count;
}

function _canStartNewSession() { return _isRealAccount() || _guestSessionCount() < FREE_GUEST_SESSION_LIMIT; }

const FD = "'DM Serif Display', Georgia, serif";

const FB = "'DM Sans', sans-serif";

function _sessionKey() { return "saycrd-" + getCurrentUid() + "-sessions"; }

function exportUserData() {
try {
var uid = getCurrentUid();
var sessions = loadSessions();
var pe = null; try { pe = loadPatternEngine(); } catch(e) {}
var nar = null; try { nar = loadNarrativeArc(); } catch(e) {}
var reportHistory = []; try { reportHistory = JSON.parse(localStorage.getItem("saycrd-report-history-" + uid) || "[]"); } catch(e) {}
var payload = {
exportedAt: new Date().toISOString(),
userId: uid === "local" ? "local (no account)" : uid,
retentionNote: "Your data is stored locally and, if signed in, in Supabase. Reports are generated via AI; session content may be processed according to the API provider's policy. You can export or delete your data at any time.",
sessions: sessions,
patternEngine: pe,
narrativeArc: nar,
reportHistory: reportHistory,
sessionCount: sessions.length
};
var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
var a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "saycrd-export-" + new Date().toISOString().slice(0, 10) + ".json";
a.click();
URL.revokeObjectURL(a.href);
} catch(e) { console.error("[SAYCRD] Export failed:", e); }
}

function loadSessions() {
try {
var key = _sessionKey();
var data = JSON.parse(localStorage.getItem(key) || "[]");
if (data.length === 0 && key.indexOf("saycrd-local-") === 0) {
var legacyKeys = ["saycrd-sessions", "saycrd-local-sessions"];
for (var li = 0; li < legacyKeys.length; li++) {
var legacy = JSON.parse(localStorage.getItem(legacyKeys[li]) || "[]");
if (legacy.length > 0) {
localStorage.setItem(key, JSON.stringify(legacy));
return legacy;
}
}
}
return data;
} catch(e) { return []; }
}

function loadPatternEngine() {
try {
return JSON.parse(localStorage.getItem("saycrd-" + getCurrentUid() + "-pattern-engine") || "null");
} catch(e) { return null; }
}

function loadNarrativeArc() {
try {
return JSON.parse(localStorage.getItem("saycrd-" + getCurrentUid() + "-narrative-arc") || "null");
} catch(e) { return null; }
}

function BootGate() {
return (
<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg, #0A0814 0%, #120A1E 40%, #0E0C1A 100%)" }}>
<div role="status" aria-live="polite" style={{ textAlign: "center", animation: "pulse 1.6s ease-in-out infinite" }}>
<div style={{ fontSize: 11, letterSpacing: "0.55em", color: "rgba(184,107,255,0.65)", fontFamily: FB, fontWeight: 600 }}>BLINDSPOT</div>
<div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: FD, fontStyle: "italic" }}>Restoring your session</div>
</div>
</div>
);
}

function LandingPhase({ onStart, onNavigateLegal }) {
// Evaluated once, ahead of any reveal state, because `show` seeds itself from
// it: on a phone the landing has to be fully painted on the very first render,
// with no state transition left to wait for.
var initialMobile = typeof window !== "undefined" && window.innerWidth < 480;
var [show, setShow] = useState(initialMobile);
var [authUser, setAuthUser] = useState(function(){ return typeof window !== "undefined" ? window.currentUser : null; });
// Same "local-user" bypass fake-account issue as UserMenu: `authUser` alone is
// truthy for a guest who only clicked "Continue without account", so the nav
// must not show the filled avatar / "start a session" copy for them — only for
// an actual Supabase account.
var isLandingRealAccount = !!(authUser && authUser.id && authUser.id !== "local-user");
var sessions = [];
try { sessions = JSON.parse(localStorage.getItem(_sessionKey()) || "[]"); } catch(e) {}
var returning = sessions.length > 0;
var SG = "Space Grotesk, " + FB;
// Phone breakpoint, following the convention already used by UserMenu and the
// session flow: a plain innerWidth check plus a resize listener.
var [isMobile, setIsMobile] = useState(initialMobile);
useEffect(function(){ function onResize(){ setIsMobile(window.innerWidth < 480); } window.addEventListener("resize", onResize); return function(){ window.removeEventListener("resize", onResize); }; }, []);

/* Phones render the landing complete and opaque on the first paint: no
   opacity:0 start state, no timer, no state gate, nothing that can strand the
   page mid-fade. `revealed` is unconditionally true when isMobile, so it does
   not read `show` at all on a phone -- a delayed, dropped or re-ordered state
   update cannot hide content. Desktop keeps the original staggered fade. */
var revealed = isMobile || show;
function desktopReveal(transition) { return isMobile ? "none" : transition; }

// Desktop keeps its deliberate 100ms beat before the fade begins. Phones never
// arm the timer, so on mobile there is no delay to survive in the first place.
useEffect(function() {
  if (isMobile) return;
  var t = setTimeout(function() { setShow(true); }, 100);
  return function(){ clearTimeout(t); };
}, [isMobile]);
useEffect(function(){ function onAuth(){ setAuthUser(window.currentUser || null); } window.addEventListener("saycrd-auth-change", onAuth); setAuthUser(window.currentUser || null); return function(){ window.removeEventListener("saycrd-auth-change", onAuth); }; }, []);
useEffect(function(){ var el=document.getElementById("ws-signout"); if(el){ el.style.setProperty("display","none","important"); } return function(){ var el=document.getElementById("ws-signout"); if(el) el.style.removeProperty("display"); }; }, []);

var [starting, setStarting] = useState(false);
function guardedStart() {
  // See JourneysPhase's guardedStart for why this guard exists: it's now
  // just a UX debounce against redundant eligibility checks, not a spend
  // guard -- entitlement is only ever consumed atomically at
  // session-complete time.
  if (starting || window._sessionStartInFlight) return;
  if (_isRealAccount()) {
    if (!window._consumeSessionCredit) { onStart(); return; }
    setStarting(true); window._sessionStartInFlight = true;
    window._consumeSessionCredit().then(function(result) {
      setStarting(false); window._sessionStartInFlight = false;
      if (result && result.ok === false) {
        if (window._showPaywall) window._showPaywall(); else onStart();
      } else {
        onStart();
      }
    }).catch(function() { setStarting(false); window._sessionStartInFlight = false; onStart(); }); /* fail open on unexpected errors too */
    return;
  }
  if (!_canStartNewSession()) {
    // Free guest sessions used up: hard wall requiring a real account, with
    // no "Continue without account" escape hatch offered.
    if (window._showAuthOverlay) window._showAuthOverlay(onStart, { requireAccount: true });
    return;
  }
  if (window.currentUser) { onStart(); return; }
  if (window._showAuthOverlay) { window._showAuthOverlay(onStart); }
  else { onStart(); }
}

return (
<div style={{ width:"100%", height:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch",
background:"#0A0914" }}>

<div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
<div style={{ position:"absolute", top:"-10%", right:"-5%", width:800, height:800,
borderRadius:"50%", background:"radial-gradient(circle, rgba(184,107,255,0.14), transparent 65%)",
filter:"blur(120px)", animation:"floatWord 22s ease-in-out infinite" }} />
<div style={{ position:"absolute", top:"30%", left:"-10%", width:700, height:700,
borderRadius:"50%", background:"radial-gradient(circle, rgba(232,67,147,0.11), transparent 65%)",
filter:"blur(100px)", animation:"floatWord 26s ease-in-out infinite", animationDelay:"-8s" }} />
<div style={{ position:"absolute", bottom:"-10%", right:"20%", width:600, height:600,
borderRadius:"50%", background:"radial-gradient(circle, rgba(107,184,255,0.1), transparent 65%)",
filter:"blur(90px)", animation:"floatWord 20s ease-in-out infinite", animationDelay:"-14s" }} />
<div style={{ position:"absolute", bottom:"20%", left:"20%", width:500, height:500,
borderRadius:"50%", background:"radial-gradient(circle, rgba(107,255,184,0.07), transparent 65%)",
filter:"blur(80px)", animation:"floatWord 18s ease-in-out infinite", animationDelay:"-4s" }} />
</div>

<nav style={{ position:"sticky", top:0, zIndex:20, display:"flex", justifyContent:"center",
padding:"calc(20px + env(safe-area-inset-top, 0px)) 0 20px",
background:"rgba(10,9,20,0.8)", backdropFilter:"blur(20px)",
borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
{/* 7vw side padding leaves only ~275px of usable width at 320px, which the
    logo and auth control alone overflow. Mobile uses a fixed 20px gutter and a
    slightly tighter wordmark so the two always fit with room to spare.
    Desktop keeps the original 7vw / 18px / 0.3em values untouched. */}
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%", maxWidth:1400, margin:"0 auto", padding: isMobile ? "0 20px" : "0 7vw" }}>
<div style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0 }}>
<div style={{ fontFamily:SG, fontSize: isMobile ? 16 : 18, fontWeight:700, letterSpacing: isMobile ? "0.18em" : "0.3em",
background:"linear-gradient(90deg, #E84393, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent", flexShrink:0 }}>BLINDSPOT</div>
{isLandingRealAccount ? (
<button onClick={function(){ if (window._signOut) window._signOut(); }} style={{ flexShrink:0, width:36, height:36, borderRadius:"50%", border:"1px solid rgba(255,255,255,0.12)", background:"rgba(0,0,0,0.35)", color:"rgba(247,241,231,0.7)", fontSize:14, fontWeight:600, fontFamily:FB, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
{(authUser.email || "").split("@")[0].charAt(0).toUpperCase() || "S"}
</button>
) : (
<button data-saycrd-boot="login" onClick={function(){ if (window._showAuthOverlay) window._showAuthOverlay(guardedStart); }} style={{ flexShrink:0, padding:"8px 16px", borderRadius:999, border:"1px solid rgba(255,255,255,0.2)", background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.9)", fontSize:13, fontWeight:600, fontFamily:FB, letterSpacing:"0.04em", cursor:"pointer" }}>
Log in / Sign up
</button>
)}
</div>
{/* The nav CTA is desktop-only. Its signed-out label was still the legacy
    "begin", and because neither it nor the left group could shrink it was
    drawn straight on top of "Log in / Sign up" on every phone width (96px of
    overlap at 320px, where it covered the control completely). On mobile the
    hero's own "start a session" button sits directly below the fold line and
    is the primary action, so the nav keeps just the wordmark and the single
    auth control. Desktop rendering is unchanged. */}
{!isMobile && (
<button onClick={guardedStart} disabled={starting} style={{ padding:"10px 26px", borderRadius:999,
background:"linear-gradient(135deg, rgba(232,67,147,0.15), rgba(184,107,255,0.15))",
border:"1px solid rgba(232,67,147,0.3)", color:"#E84393",
fontFamily:FB, fontSize:14, fontWeight:600, letterSpacing:"0.06em", cursor:starting?"default":"pointer", opacity:starting?0.6:1, flexShrink:0 }}>
{starting ? "starting…" : (isLandingRealAccount ? (returning ? "new session" : "start a session") : "begin")}
</button>
)}
</div>
</nav>

<div style={{ position:"relative", zIndex:1, maxWidth:1400, margin:"0 auto", padding:"0 7vw calc(80px + env(safe-area-inset-bottom, 0px))" }}>

<section style={{ padding:"72px 0 56px" }}>
<div style={{ fontSize:13, letterSpacing:"0.4em", fontFamily:FB, textTransform:"uppercase",
marginBottom:20, fontWeight:600,
background:"linear-gradient(90deg, #E84393, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent",
opacity:revealed?1:0, transition:desktopReveal("opacity 0.8s ease") }}>
A place to go in the moment
</div>

<h1 style={{ fontFamily:FD, fontSize:"clamp(42px,6.5vw,68px)", fontWeight:300,
lineHeight:1.1, color:"rgba(255,255,255,0.95)", marginBottom:28, letterSpacing:"-0.01em",
maxWidth:820,
opacity:revealed?1:0, transform:revealed?"translateY(0)":"translateY(24px)",
transition:desktopReveal("all 1s cubic-bezier(.25,.46,.45,.94) 0.1s") }}>
The space between your inner world and the next true move.
</h1>

<p style={{ fontFamily:FD, fontSize:21, fontWeight:300, fontStyle:"italic",
color:"rgba(200,185,230,0.7)", lineHeight:1.7, marginBottom:40, maxWidth:540,
opacity:revealed?1:0, transform:revealed?"translateY(0)":"translateY(16px)",
transition:desktopReveal("all 1s cubic-bezier(.25,.46,.45,.94) 0.25s") }}>
BLINDSPOT listens like a human, shapes what you say into a living visual, and remembers your patterns without turning you into a project.
</p>

<div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"center",
opacity:revealed?1:0, transition:desktopReveal("opacity 1s ease 0.4s"), marginBottom:16 }}>
<button data-saycrd-boot="start" onClick={guardedStart} disabled={starting} style={{ padding:"16px 36px", borderRadius:999,
background:"linear-gradient(135deg, #E84393, #B86BFF)", border:"none",
color:"#fff", fontFamily:FB, fontSize:16, fontWeight:700,
letterSpacing:"0.05em", cursor:starting?"default":"pointer", opacity:starting?0.6:1,
boxShadow:"0 12px 40px rgba(184,107,255,0.3)" }}>
{starting ? "starting…" : (authUser ? (returning ? "continue your journey" : "start a session") : (returning ? "continue" : "start a session"))}
</button>
<button data-saycrd-boot="concept" onClick={function(){ var el=document.getElementById("saycrd-why");
if(el) el.scrollIntoView({behavior:"smooth"}); }}
style={{ padding:"16px 28px", borderRadius:999, background:"transparent",
border:"1px solid rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.5)",
fontFamily:FB, fontSize:15, cursor:"pointer" }}>
see the concept
</button>
</div>

{!authUser && (
<div style={{ marginTop: 16, opacity: revealed ? 1 : 0, transition: desktopReveal("opacity 0.8s ease 0.5s") }}>
<button data-saycrd-boot="login" onClick={function(){ if (window._showAuthOverlay) window._showAuthOverlay(guardedStart); }} style={{ fontSize: 14, fontFamily: FB, color: "rgba(232,67,147,0.85)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 4 }}>
Log in or create an account to save your sessions
</button>
</div>
)}

{returning && (
<div style={{ fontSize:13, color:"rgba(232,67,147,0.5)", fontFamily:FB, letterSpacing:"0.06em" }}>
{sessions.length} session{sessions.length !== 1 ? "s" : ""} in your field{authUser ? "" : " · log in to sync across devices"}
</div>
)}

<div className="saycrd-landing-grid" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginTop:48 }}>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative", height:160,
background:"linear-gradient(160deg, #1A0A2E, #0E0618)",
border:"1px solid rgba(184,107,255,0.2)" }}>
<svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:0.6 }}>
{[12,28,18,35,22,8,30,16,25,20,14,32,10,26,19].map(function(x,i){
return <circle key={i} cx={x+"%"} cy={(15+i*5)+"%"} r={1.5+(i%3)*0.8}
fill="#B86BFF" opacity={0.3+i%4*0.15}/>;
})}
{[18,32,12,28,24,38,10,22].map(function(x,i){
return <circle key={i+20} cx={x+"%"} cy={(20+i*8)+"%"} r={1+(i%2)*1.2}
fill="#E84393" opacity={0.2+i%3*0.1}/>;
})}
</svg>
<div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"14px 16px",
background:"linear-gradient(0deg, rgba(14,6,24,0.95) 0%, transparent 100%)" }}>
<div style={{ fontSize:10, letterSpacing:"0.3em", color:"rgba(184,107,255,0.6)",
fontFamily:FB, marginBottom:4 }}>01</div>
<div style={{ fontSize:16, fontWeight:600, color:"#B86BFF", fontFamily:FB }}>The Pour</div>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic" }}>say everything</div>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative", height:160,
background:"linear-gradient(160deg, #2A0818, #160412)",
border:"1px solid rgba(232,67,147,0.2)" }}>
<svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:0.55 }}>
{[15,30,45,60,75,85,25,55,70].map(function(x,i){
return <g key={i}>
<circle cx={x+"%"} cy={(18+i*7)+"%"} r={2.5} fill="#E84393" opacity={0.4}/>
{i < 8 && <line x1={x+"%"} y1={(18+i*7)+"%"}
x2={[30,45,60,75,85,25,55,70,85][i]+"%"}
y2={(18+(i+1)*7)+"%"}
stroke="#E84393" strokeWidth="0.5" opacity="0.2"/>}
</g>;
})}
<circle cx="50%" cy="45%" r="12" fill="none" stroke="#B86BFF" strokeWidth="0.8" opacity="0.3"/>
<circle cx="50%" cy="45%" r="6" fill="rgba(232,67,147,0.3)"/>
</svg>
<div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"14px 16px",
background:"linear-gradient(0deg, rgba(22,4,18,0.95) 0%, transparent 100%)" }}>
<div style={{ fontSize:10, letterSpacing:"0.3em", color:"rgba(232,67,147,0.6)",
fontFamily:FB, marginBottom:4 }}>02</div>
<div style={{ fontSize:16, fontWeight:600, color:"#E84393", fontFamily:FB }}>The Synthesis</div>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic" }}>meaning emerges</div>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative", height:160,
background:"linear-gradient(160deg, #041A10, #020E0A)",
border:"1px solid rgba(107,255,184,0.2)" }}>
<div style={{ position:"absolute", top:"30%", left:"50%",
transform:"translate(-50%,-50%)",
width:60, height:60, borderRadius:"50%",
background:"radial-gradient(circle, rgba(107,255,184,0.4), transparent 70%)",
animation:"pulse 3s ease-in-out infinite" }}/>
{[0,60,120,180,240,300].map(function(deg,i){
var rad = deg * Math.PI / 180;
var cx = 50 + Math.cos(rad) * 28;
var cy = 30 + Math.sin(rad) * 22;
return <svg key={i} style={{ position:"absolute", inset:0, width:"100%", height:"100%",
pointerEvents:"none" }}>
<circle cx={cx+"%"} cy={cy+"%"} r="2" fill="#6BFFB8" opacity="0.4"/>
<line x1="50%" y1="30%" x2={cx+"%"} y2={cy+"%"}
stroke="#6BFFB8" strokeWidth="0.5" opacity="0.15"/>
</svg>;
})}
<div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"14px 16px",
background:"linear-gradient(0deg, rgba(2,14,10,0.95) 0%, transparent 100%)" }}>
<div style={{ fontSize:10, letterSpacing:"0.3em", color:"rgba(107,255,184,0.6)",
fontFamily:FB, marginBottom:4 }}>03</div>
<div style={{ fontSize:16, fontWeight:600, color:"#6BFFB8", fontFamily:FB }}>The Field</div>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic" }}>you, mapped</div>
</div>
</div>

</div>
</section>

<div style={{ position:"relative", height:220, borderRadius:24, overflow:"hidden",
marginBottom:72,
background:"linear-gradient(140deg, #0F0820 0%, #080514 50%, #060A18 100%)",
border:"1px solid rgba(184,107,255,0.15)",
boxShadow:"0 0 60px rgba(184,107,255,0.08), 0 20px 60px rgba(0,0,0,0.5)" }}>
<div style={{ position:"absolute", inset:0, display:"grid", placeItems:"center" }}>
<div style={{ width:76, height:76, borderRadius:"50%",
background:"radial-gradient(circle, rgba(232,67,147,0.7), rgba(184,107,255,0.3) 50%, transparent 70%)",
animation:"pulse 4s ease-in-out infinite", boxShadow:"0 0 40px rgba(232,67,147,0.3)" }} />
</div>
{[
{ text:"What matters", top:"15%", left:"8%", c:"rgba(184,107,255,0.15)" },
{ text:"The friction", top:"18%", right:"10%", c:"rgba(232,67,147,0.15)" },
{ text:"What I keep avoiding", top:"50%", left:"5%", c:"rgba(107,184,255,0.1)" },
{ text:"The pull", top:"42%", right:"12%", c:"rgba(232,67,147,0.12)" },
{ text:"Quiet hope", bottom:"18%", left:"26%", c:"rgba(107,255,184,0.1)" },
{ text:"Rest", bottom:"22%", right:"18%", c:"rgba(107,184,255,0.1)" },
].map(function(tag,i){
var s = { position:"absolute", padding:"5px 14px", borderRadius:999, fontSize:13,
fontFamily:FD, fontStyle:"italic", background:tag.c,
border:"1px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.6)" };
if(tag.top) s.top=tag.top;
if(tag.bottom) s.bottom=tag.bottom;
if(tag.left) s.left=tag.left;
if(tag.right) s.right=tag.right;
return <div key={i} style={s}>{tag.text}</div>;
})}
<div style={{ position:"absolute", bottom:12, left:0, right:0, textAlign:"center",
fontSize:11, letterSpacing:"0.2em", fontFamily:FB,
background:"linear-gradient(90deg, #6BB8FF, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent" }}>
MEANING · NOT RAW WORDS
</div>
</div>

<section id="saycrd-why" style={{ marginBottom:72 }}>
<div style={{ fontSize:22, fontWeight:700, fontFamily:FB, marginBottom:28,
letterSpacing:"0.02em",
background:"linear-gradient(90deg, #6BFFB8, #6BB8FF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent" }}>Why it exists</div>

<div style={{ display:"flex", flexDirection:"column", gap:12 }}>

<div style={{ borderRadius:20, overflow:"hidden",
background:"linear-gradient(135deg, rgba(232,67,147,0.08), rgba(184,107,255,0.04))",
border:"1px solid rgba(232,67,147,0.15)", display:"flex", alignItems:"stretch", minHeight:140 }}>
<div style={{ width:140, flexShrink:0, position:"relative", overflow:"hidden",
borderRight:"1px solid rgba(232,67,147,0.1)" }}>
<svg width="140" height="100%" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
{[
[20,20],[45,35],[70,15],[90,40],[15,55],[55,60],[80,50],[30,75],[60,80],[85,70],
[10,35],[40,10],[75,65],[95,25],[25,90],[50,45],[65,30],[35,60],[82,85],[12,70]
].map(function(p,i){
var size = 1.5 + (i%4)*0.8;
return React.createElement("circle",{key:i,cx:p[0]+"%",cy:p[1]+"%",r:size,
fill:"#E84393",opacity:0.15+i%5*0.1});
})}
{[[20,20,35,35],[55,60,40,75],[70,15,85,30],[30,75,20,90],[80,50,95,55]].map(function(l,i){
return React.createElement("line",{key:i,x1:l[0]+"%",y1:l[1]+"%",x2:l[2]+"%",y2:l[3]+"%",
stroke:"#E84393",strokeWidth:"0.8",opacity:"0.2",strokeDasharray:"2 4"});
})}
<circle cx="50%" cy="50%" r="18" fill="none" stroke="#E84393" strokeWidth="0.5" opacity="0.1"/>
</svg>
</div>
<div style={{ padding:"28px 28px" }}>
<h2 style={{ fontFamily:FD, fontSize:28, fontWeight:300,
color:"#E84393", marginBottom:10, lineHeight:1.15 }}>The gap in the world</h2>
<p style={{ fontFamily:FD, fontSize:16, fontWeight:300, fontStyle:"italic",
color:"rgba(220,180,200,0.65)", lineHeight:1.72, margin:0 }}>
There is a moment when you are scattered and nothing feels clear. Journals are blank pages. To-do apps are laughable. Friends are tired. BLINDSPOT is the place you go in that moment.
</p>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden",
background:"linear-gradient(135deg, rgba(107,255,184,0.06), rgba(107,184,255,0.04))",
border:"1px solid rgba(107,255,184,0.15)", display:"flex", alignItems:"stretch", minHeight:140 }}>
<div style={{ width:140, flexShrink:0, position:"relative", overflow:"hidden",
borderRight:"1px solid rgba(107,255,184,0.1)" }}>
<svg width="140" height="100%" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
<circle cx="50%" cy="50%" r="38" fill="none" stroke="#6BFFB8" strokeWidth="0.6" opacity="0.12"/>
<circle cx="50%" cy="50%" r="24" fill="none" stroke="#6BB8FF" strokeWidth="0.8" opacity="0.18"/>
<circle cx="50%" cy="50%" r="12" fill="rgba(107,255,184,0.12)" stroke="#6BFFB8" strokeWidth="1" opacity="0.4"/>
{[0,60,120,180,240,300].map(function(deg,i){
var rad=deg*Math.PI/180;
var ox=50+Math.cos(rad)*38, oy=50+Math.sin(rad)*38;
var ix=50+Math.cos(rad)*26, iy=50+Math.sin(rad)*26;
return React.createElement("line",{key:i,
x1:ox+"%",y1:oy+"%",x2:ix+"%",y2:iy+"%",
stroke:"#6BFFB8",strokeWidth:"0.7",opacity:"0.25"});
})}
{[30,90,150,210,270,330].map(function(deg,i){
var rad=deg*Math.PI/180;
return React.createElement("circle",{key:i+10,
cx:(50+Math.cos(rad)*38)+"%",cy:(50+Math.sin(rad)*38)+"%",
r:"2",fill:"#6BFFB8",opacity:"0.5"});
})}
<circle cx="50%" cy="50%" r="4" fill="#6BFFB8" opacity="0.9"/>
</svg>
</div>
<div style={{ padding:"28px 28px" }}>
<h2 style={{ fontFamily:FD, fontSize:28, fontWeight:300,
color:"#6BFFB8", marginBottom:10, lineHeight:1.15 }}>The loop closes</h2>
<p style={{ fontFamily:FD, fontSize:16, fontWeight:300, fontStyle:"italic",
color:"rgba(180,220,200,0.65)", lineHeight:1.72, margin:0 }}>
Internal becomes external, in real time. Seeing the map changes how you relate to it. That shift is the mechanism. It is not productivity. It is clarity.
</p>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden",
background:"linear-gradient(135deg, rgba(184,107,255,0.08), rgba(107,184,255,0.04))",
border:"1px solid rgba(184,107,255,0.15)", display:"flex", alignItems:"stretch", minHeight:140 }}>
<div style={{ width:140, flexShrink:0, position:"relative", overflow:"hidden",
borderRight:"1px solid rgba(184,107,255,0.1)" }}>
<svg width="140" height="100%" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}>
{[45,35,25,16,8].map(function(r,i){
return React.createElement("ellipse",{key:i,cx:"50%",cy:"50%",rx:r,ry:r*0.55,
fill:"none",stroke:"#B86BFF",strokeWidth:1-i*0.1,
opacity:0.5-i*0.07,strokeDasharray:i>2?"2 3":undefined});
})}
{[
{deg:30,r:45},{deg:110,r:45},{deg:200,r:45},{deg:290,r:45},
{deg:60,r:35},{deg:180,r:35},{deg:300,r:35},
{deg:90,r:25},{deg:230,r:25},
{deg:45,r:16},
].map(function(s,i){
var rad=s.deg*Math.PI/180;
var x=50+Math.cos(rad)*s.r, y=50+Math.sin(rad)*s.r*0.55;
return React.createElement("circle",{key:i,cx:x+"%",cy:y+"%",
r:i<4?2.5:2,fill:"#B86BFF",opacity:0.3+i%3*0.15});
})}
<circle cx="50%" cy="50%" r="4" fill="rgba(184,107,255,0.5)"/>
<circle cx="50%" cy="50%" r="2" fill="#B86BFF"/>
</svg>
</div>
<div style={{ padding:"28px 28px" }}>
<h2 style={{ fontFamily:FD, fontSize:28, fontWeight:300,
color:"#B86BFF", marginBottom:10, lineHeight:1.15 }}>The system remembers</h2>
<p style={{ fontFamily:FD, fontSize:16, fontWeight:300, fontStyle:"italic",
color:"rgba(200,180,230,0.65)", lineHeight:1.72, margin:0 }}>
The map stays with you. It recognizes patterns across sessions without feeling like surveillance. You build a living map of your inner life.
</p>
</div>
</div>

</div>
</section>

<section style={{ marginBottom:72 }}>
<div style={{ fontSize:22, fontWeight:700, fontFamily:FB, marginBottom:24,
letterSpacing:"0.02em",
background:"linear-gradient(90deg, #6BB8FF, #E84393)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent" }}>What the system does</div>

<div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:14 }}>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative",
background:"linear-gradient(160deg, #1A0614, #0E040E)",
border:"1px solid rgba(232,67,147,0.2)" }}>
<div style={{ height:130, position:"relative" }}>
<svg width="100%" height="130" style={{ position:"absolute", inset:0 }}>
{[0.15,0.3,0.55,0.85,0.65,0.4,0.7,0.3,0.5,0.9,0.4,0.6,0.25,0.75,0.45,0.8,0.35,0.6,0.5,0.7].map(function(h,i){
var barH = h * 70; var y = (130 - barH) / 2;
return React.createElement("rect",{key:i,x:(5+i*4.8)+"%",y:y,width:"2.5",height:barH,rx:"1.5",fill:"#E84393",opacity:0.2+h*0.5});
})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"18",fill:"none",stroke:"#E84393",strokeWidth:"1",opacity:"0.15"})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"28",fill:"none",stroke:"#E84393",strokeWidth:"0.5",opacity:"0.08"})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"8",fill:"rgba(232,67,147,0.4)"})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"3",fill:"#E84393"})}
</svg>
</div>
<div style={{ padding:"0 22px 22px" }}>
<h3 style={{ fontFamily:FB, fontSize:17, fontWeight:700, color:"#E84393", marginBottom:8 }}>AI that listens</h3>
<p style={{ fontFamily:FD, fontSize:15, fontStyle:"italic", color:"rgba(220,180,200,0.55)", lineHeight:1.65, margin:0 }}>
It hears what is underneath, collapses related themes, and keeps the map clean even when the dump is long.
</p>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative",
background:"linear-gradient(160deg, #041A10, #020E0C)",
border:"1px solid rgba(107,255,184,0.2)" }}>
<div style={{ height:130, position:"relative" }}>
<svg width="100%" height="130" style={{ position:"absolute", inset:0 }}>
{[[50,50],[22,30],[78,28],[20,70],[80,72],[50,90],[35,15],[65,12],[88,50],[12,50]].map(function(n,i){
return React.createElement("circle",{key:i,cx:n[0]+"%",cy:n[1]*130/100,r:[7,4,5,3,4,3,2.5,3,2.5,2][i],fill:"#6BFFB8",opacity:[0.9,0.6,0.7,0.5,0.6,0.4,0.4,0.5,0.4,0.35][i]});
})}
{[[50,50,22,30],[50,50,78,28],[50,50,20,70],[50,50,80,72],[50,50,50,90],[22,30,35,15],[78,28,65,12],[22,30,12,50],[80,72,88,50]].map(function(l,i){
return React.createElement("line",{key:i,x1:l[0]+"%",y1:l[1]*130/100,x2:l[2]+"%",y2:l[3]*130/100,stroke:"#6BFFB8",strokeWidth:"0.7",opacity:"0.2"});
})}
</svg>
</div>
<div style={{ padding:"0 22px 22px" }}>
<h3 style={{ fontFamily:FB, fontSize:17, fontWeight:700, color:"#6BFFB8", marginBottom:8 }}>Visual that is alive</h3>
<p style={{ fontFamily:FD, fontSize:15, fontStyle:"italic", color:"rgba(180,220,200,0.55)", lineHeight:1.65, margin:0 }}>
A living field that holds vagueness, weight, proximity, and change over time.
</p>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative",
background:"linear-gradient(160deg, #0E0820, #08061A)",
border:"1px solid rgba(184,107,255,0.2)" }}>
<div style={{ height:130, position:"relative" }}>
<svg width="100%" height="130" style={{ position:"absolute", inset:0 }}>
{[52,38,26,16].map(function(r,i){
return React.createElement("circle",{key:i,cx:"50%",cy:"65",r:r,fill:"none",stroke:"#B86BFF",strokeWidth:1.2-i*0.25,strokeDasharray:i%2===0?"4 3":"2 5",opacity:0.5-i*0.08});
})}
{[0,72,144,216,288].map(function(deg,i){
var rad=deg*Math.PI/180;
return React.createElement("circle",{key:i+10,cx:(50+Math.cos(rad)*28)+"%",cy:65+Math.sin(rad)*20,r:"2.5",fill:"#B86BFF",opacity:"0.6"});
})}
{[0,45,90,160,250].map(function(deg,i){
var rad=deg*Math.PI/180;
return React.createElement("circle",{key:i+20,cx:(50+Math.cos(rad)*20)+"%",cy:65+Math.sin(rad)*15,r:"1.8",fill:"#6BB8FF",opacity:"0.45"});
})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"5",fill:"rgba(184,107,255,0.5)"})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"2",fill:"#B86BFF"})}
</svg>
</div>
<div style={{ padding:"0 22px 22px" }}>
<h3 style={{ fontFamily:FB, fontSize:17, fontWeight:700, color:"#B86BFF", marginBottom:8 }}>Memory with care</h3>
<p style={{ fontFamily:FD, fontSize:15, fontStyle:"italic", color:"rgba(200,180,230,0.55)", lineHeight:1.65, margin:0 }}>
Patterns are remembered, not tracked. The system knows what to surface and what to leave alone.
</p>
</div>
</div>

<div style={{ borderRadius:20, overflow:"hidden", position:"relative",
background:"linear-gradient(160deg, #140E04, #0C0A02)",
border:"1px solid rgba(214,178,109,0.2)" }}>
<div style={{ height:130, position:"relative" }}>
<svg width="100%" height="130" style={{ position:"absolute", inset:0 }}>
{[42,32,20,10].map(function(r,i){
return React.createElement("circle",{key:i,cx:"50%",cy:"65",r:r,fill:"none",stroke:"#D6B26D",strokeWidth:1.2-i*0.2,opacity:0.1+i*0.06});
})}
{[0,45,90,135,180,225,270,315].map(function(deg,i){
var rad=deg*Math.PI/180;
return React.createElement("line",{key:i,x1:(50+Math.cos(rad)*12)+"%",y1:65+Math.sin(rad)*12,x2:(50+Math.cos(rad)*22)+"%",y2:65+Math.sin(rad)*22,stroke:"#D6B26D",strokeWidth:"0.8",opacity:"0.2"});
})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"10",fill:"rgba(214,178,109,0.2)",stroke:"#D6B26D",strokeWidth:"1.2",opacity:"0.6"})}
{React.createElement("circle",{cx:"50%",cy:"65",r:"4",fill:"#D6B26D",opacity:"0.8"})}
</svg>
</div>
<div style={{ padding:"0 22px 22px" }}>
<h3 style={{ fontFamily:FB, fontSize:17, fontWeight:700, color:"#D6B26D", marginBottom:8 }}>Practice, not features</h3>
<p style={{ fontFamily:FD, fontSize:15, fontStyle:"italic", color:"rgba(220,200,160,0.55)", lineHeight:1.65, margin:0 }}>
A breath, a pause, a reflection ��� only when needed. The experience stays whole.
</p>
</div>
</div>

</div>
</section>

<section style={{ textAlign:"center", padding:"56px 32px",
borderRadius:28,
background:"linear-gradient(135deg, rgba(184,107,255,0.08), rgba(232,67,147,0.08))",
border:"1px solid rgba(184,107,255,0.15)",
marginBottom:48 }}>
<h2 style={{ fontFamily:FD, fontSize:"clamp(30px,4.5vw,44px)", fontWeight:300,
color:"rgba(255,255,255,0.88)", marginBottom:14, lineHeight:1.2 }}>
Ready to listen to yourself?
</h2>
<p style={{ fontFamily:FD, fontSize:19, fontWeight:300, fontStyle:"italic",
color:"rgba(200,185,230,0.5)", marginBottom:36, lineHeight:1.7 }}>
No account needed. Your session stays private. Just start.
</p>
<button onClick={exportUserData} style={{ marginBottom:20, padding:"8px 16px", borderRadius:999,
background:"transparent", border:"1px solid rgba(255,255,255,0.15)", color:"rgba(255,255,255,0.4)",
fontFamily:FB, fontSize:11, letterSpacing:"0.12em", cursor:"pointer",
transition:"all 0.2s" }} title="Download your sessions and patterns as JSON">Download my data</button>
<button data-saycrd-boot="start" onClick={guardedStart} style={{ padding:"18px 48px", borderRadius:999,
background:"linear-gradient(135deg, #E84393, #B86BFF)", border:"none",
color:"#fff", fontFamily:FB, fontSize:17, fontWeight:700,
letterSpacing:"0.05em", cursor:"pointer",
boxShadow:"0 16px 48px rgba(184,107,255,0.25)" }}>
{returning ? "continue your journey" : "start a session"}
</button>
</section>

<footer style={{ display:"flex", justifyContent:"center", gap:24, flexWrap:"wrap",
padding:"8px 0 32px" }}>
{[
{ label:"Privacy", page:"privacy" },
{ label:"Terms", page:"terms" },
{ label:"Disclaimer", page:"disclaimer-info" },
].map(function(l){
return <button key={l.page} onClick={function(){ if (onNavigateLegal) onNavigateLegal(l.page); }}
style={{ background:"none", border:"none", cursor:"pointer", padding:0,
fontFamily:FB, fontSize:12, letterSpacing:"0.06em",
color:"rgba(255,255,255,0.32)" }}>{l.label}</button>;
})}
</footer>

</div>
</div>
);
}

function LegalPage({ page, onBack }) {
var SG = "Space Grotesk, " + FB;
var LEGAL_ENTITY = "Sedona Heartfelt Journeys, LLC";
var LEGAL_CONTACT = "you@sedonaheartfeltjourneys.com";
var LEGAL_STATE = "Arizona";
var CONTENT = {
privacy: {
title:"Privacy",
body:[
"Blindspot is a product of " + LEGAL_ENTITY + " (\"we,\" \"us,\" or \"our\"). This policy explains what we collect, how we use it, and the choices you have.",
"What we collect: the reflections, themes, and other content you write during a session; your email address if you create an account; and basic technical data (like device and browser type) needed to run the app.",
"What we don't collect: if you choose \"Continue without account,\" your sessions stay on your device only — we don't receive or store that content on our servers.",
"How we use it: session content is used to generate your personal reflections and, for account holders, to recognize patterns across your sessions over time. Your email is used only for account access, service updates, and — if you subscribe — billing.",
"We do not sell your personal data, and we do not use your reflections to build advertising profiles. Session content is sent to our AI provider solely to generate your reflections and is not used to train their models beyond that purpose.",
"You can request an export or deletion of your account and its data at any time by emailing " + LEGAL_CONTACT + ". We'll respond within a reasonable time and confirm once it's done.",
"Blindspot is intended for users 18 years of age or older. We do not knowingly collect information from anyone under 18.",
"This policy may be updated as the product evolves; the version in effect is always the one posted here.",
"Questions about this policy? Reach us at " + LEGAL_CONTACT + ".",
]
},
terms: {
title:"Terms",
body:[
"These Terms of Service govern your use of Blindspot, a product of " + LEGAL_ENTITY + " (\"we,\" \"us,\" or \"our\"). By using Blindspot, you agree to these terms.",
"Eligibility. You must be 18 years of age or older to use Blindspot.",
"What Blindspot is. Blindspot is a space for personal reflection, using AI to help you explore patterns, connections, and possibilities in what you share. It is not a substitute for professional, medical, or mental health advice, diagnosis, or treatment. If you are in crisis, please contact a crisis line or emergency services directly.",
"Your responsibility. You are responsible for what you choose to share and for how you act on your own reflections. Blindspot's AI-generated content is offered as a mirror, not a directive — you remain the authority on your own experience.",
"Accounts and subscriptions. If you create an account, you're responsible for keeping your login secure. If you subscribe to a paid plan, charges are billed as described at checkout, and you may cancel at any time; see our Privacy Policy for how we handle your data if you cancel or delete your account.",
"No warranties. Blindspot is provided \"as is\" and \"as available,\" without warranties of any kind, express or implied.",
"Limitation of liability. To the fullest extent permitted by law, " + LEGAL_ENTITY + " is not liable for any indirect, incidental, or consequential damages, or for decisions made based on reflections generated within the product.",
"Changes to these terms. We may update these terms as the product evolves. Continued use after an update means you accept the current terms.",
"Governing law. These terms are governed by the laws of the State of " + LEGAL_STATE + ", without regard to its conflict-of-laws principles.",
"Contact. Questions about these terms? Reach us at " + LEGAL_CONTACT + ".",
]
},
"disclaimer-info": {
title:"Disclaimer",
body:[
"This is a space for reflection, not diagnosis.",
"Blindspot uses AI to explore patterns, connections, and possibilities in what you share. Its reflections may not always be accurate, and they should not be treated as professional, medical, or mental health advice.",
"You are always the authority on your own experience. Keep what feels useful. Question what doesn't.",
"If you are in crisis or thinking about harming yourself, please reach out to a crisis line — in the US, call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 (Crisis Text Line).",
]
}
};
var c = CONTENT[page] || CONTENT.privacy;
return (
<div style={{ width:"100%", height:"100%", overflowY:"auto", WebkitOverflowScrolling:"touch",
background:"#0A0914" }}>
<div style={{ maxWidth:680, margin:"0 auto", padding:"calc(64px + env(safe-area-inset-top, 0px)) 7vw 80px" }}>
<button onClick={onBack} style={{ marginBottom:40, padding:"8px 18px", borderRadius:999,
background:"transparent", border:"1px solid rgba(255,255,255,0.14)",
color:"rgba(255,255,255,0.55)", fontFamily:SG, fontSize:13,
letterSpacing:"0.04em", cursor:"pointer" }}>← Back</button>
<div style={{ fontSize:13, letterSpacing:"0.4em", fontFamily:FB, textTransform:"uppercase",
marginBottom:16, fontWeight:600,
background:"linear-gradient(90deg, #E84393, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent" }}>{c.title}</div>
<h1 style={{ fontFamily:FD, fontSize:"clamp(32px,5vw,46px)", fontWeight:300,
color:"rgba(255,255,255,0.95)", marginBottom:36, letterSpacing:"-0.01em" }}>
{page==="disclaimer-info" ? "Before we begin" : c.title}
</h1>
{c.body.map(function(p,i){
return <p key={i} style={{ fontFamily:FD, fontSize:18, fontWeight:300,
fontStyle: page==="disclaimer-info" ? "italic" : "normal",
color:"rgba(210,200,225,0.72)", lineHeight:1.75, marginBottom:24 }}>{p}</p>;
})}
</div>
</div>
);
}

function DisclaimerGate({ onBegin, onNavigateLegal }) {
var [show, setShow] = useState(false);
useEffect(function(){ setTimeout(function(){ setShow(true); }, 60); }, []);
var SG = "Space Grotesk, " + FB;
return (
<div style={{ position:"fixed", inset:0, zIndex:1000, background:"#0A0914",
display:"flex", alignItems:"center", justifyContent:"center", padding:"7vw",
opacity:show?1:0, transition:"opacity 0.6s ease" }}>
<div style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
<div style={{ position:"absolute", top:"-10%", right:"-5%", width:700, height:700,
borderRadius:"50%", background:"radial-gradient(circle, rgba(184,107,255,0.12), transparent 65%)",
filter:"blur(120px)" }} />
</div>
<div style={{ position:"relative", maxWidth:560, textAlign:"center" }}>
<div style={{ fontSize:12, letterSpacing:"0.4em", fontFamily:FB, textTransform:"uppercase",
marginBottom:28, fontWeight:600, color:"rgba(200,185,230,0.5)" }}>
Before we begin
</div>
<p style={{ fontFamily:FD, fontSize:23, fontWeight:300, fontStyle:"italic",
color:"rgba(255,255,255,0.92)", lineHeight:1.6, marginBottom:28 }}>
This is a space for reflection, not diagnosis.
</p>
<p style={{ fontFamily:FD, fontSize:17, fontWeight:300,
color:"rgba(210,200,225,0.68)", lineHeight:1.8, marginBottom:24 }}>
Blindspot uses AI to explore patterns, connections, and possibilities in what you share. Its reflections may not always be accurate, and they should not be treated as professional, medical, or mental health advice.
</p>
<p style={{ fontFamily:FD, fontSize:17, fontWeight:300,
color:"rgba(210,200,225,0.68)", lineHeight:1.8, marginBottom:44 }}>
You are always the authority on your own experience. Keep what feels useful. Question what doesn't.
</p>
<button onClick={onBegin} style={{ padding:"16px 52px", borderRadius:999,
background:"linear-gradient(135deg, #E84393, #B86BFF)", border:"none",
color:"#fff", fontFamily:FB, fontSize:16, fontWeight:700,
letterSpacing:"0.05em", cursor:"pointer",
boxShadow:"0 16px 48px rgba(184,107,255,0.25)", marginBottom:28 }}>
Begin
</button>
<div style={{ display:"flex", justifyContent:"center", gap:16 }}>
<button onClick={function(){ if (onNavigateLegal) onNavigateLegal("privacy"); }}
style={{ background:"none", border:"none", cursor:"pointer", padding:0,
fontFamily:SG, fontSize:12, letterSpacing:"0.04em", color:"rgba(255,255,255,0.32)",
textDecoration:"underline", textUnderlineOffset:3 }}>Privacy</button>
<span style={{ color:"rgba(255,255,255,0.2)", fontSize:12 }}>·</span>
<button onClick={function(){ if (onNavigateLegal) onNavigateLegal("terms"); }}
style={{ background:"none", border:"none", cursor:"pointer", padding:0,
fontFamily:SG, fontSize:12, letterSpacing:"0.04em", color:"rgba(255,255,255,0.32)",
textDecoration:"underline", textUnderlineOffset:3 }}>Terms</button>
</div>
</div>
</div>
);
}

/* ── Shared app chrome ───────────────────────────────────────────────────────
 * The outer frame every page renders inside: the shell wrapper, the webfont
 * stylesheet and the global @keyframes.
 *
 * This lives here, in the file compiled into BOTH bundles, so the standalone
 * homepage and the full application share ONE definition. It was briefly
 * duplicated into landing-shell.jsx instead, and the copy immediately drifted:
 * it omitted the keyframes below, so every animation on the landing page
 * silently resolved to nothing. A DOM comparison against the pre-split build
 * caught it, and api/__tests__/landing-split.test.js now pins the rule.
 *
 * Child order matters and matches the pre-split markup exactly: link, then the
 * page, then the styles.
 */
function SaycrdShell(props) {
  return (
<div className="saycrd-app-shell" style={{width:"100%",background:props.background,display:"flex",justifyContent:"center",alignItems:"stretch"}}>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap" rel="stylesheet"/>
{props.children}
<style>{`
@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes phaseIn{from{opacity:0.6}to{opacity:1}}
@keyframes morphIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
@keyframes riseUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:200px}}
@keyframes pulse{0%,100%{opacity:0.7}50%{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes growWidth{from{width:0%}}
@keyframes floatParticle{0%,100%{transform:translateY(0) translateX(0)}33%{transform:translateY(-10px) translateX(5px)}66%{transform:translateY(5px) translateX(-7px)}}
@keyframes fieldFloat{0%,100%{transform:translateY(0) translateX(0)}33%{transform:translateY(-12px) translateX(6px)}66%{transform:translateY(6px) translateX(-8px)}}
@keyframes floatWord{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes connBlink{0%,100%{opacity:0.65;filter:brightness(1)}50%{opacity:1;filter:brightness(1.4)}}
@keyframes ringPulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:0.7;transform:scale(1.15)}}
@keyframes nodeBreathe{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
@keyframes flowLine{0%{stroke-dashoffset:0}100%{stroke-dashoffset:24}}
@keyframes shaftPulse { 0%,100%{opacity:0.7;transform:skewX(-8deg) scaleX(1)} 50%{opacity:1.4;transform:skewX(-5deg) scaleX(1.3)} }
@keyframes breathe{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:0.7}50%{transform:translate(-50%,-50%) scale(1.15);opacity:1}}
@keyframes drawerIn{from{opacity:0;transform:translate(-50%,24px) scale(0.95)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes drawerInSheet{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes sweep{0%,100%{transform:translateX(-100%)}50%{transform:translateX(100%)}}
@keyframes tapeEq{0%,100%{transform:scaleY(0.35)}50%{transform:scaleY(1)}}
@keyframes navGlimmer{0%,100%{opacity:0.92;box-shadow:0 0 12px rgba(255,255,255,0.03)}50%{opacity:1;box-shadow:0 0 18px rgba(255,255,255,0.08)}}
@keyframes fallIn{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:translateY(0)}}
@keyframes themeReveal{0%{opacity:0;transform:translateY(6px) scale(0.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes connectionReveal{0%{stroke-dashoffset:300}100%{stroke-dashoffset:0}}
@keyframes mapTitleReveal{0%{opacity:0;transform:scale(0.97);filter:blur(2px)}100%{opacity:1;transform:scale(1);filter:blur(0)}}
@keyframes revealFadeOut{0%{opacity:1}15%{opacity:1}100%{opacity:0}}
@keyframes reportRibbon{0%{transform:translateX(-20%) skewX(-12deg);opacity:0.15}50%{transform:translateX(10%) skewX(-8deg);opacity:0.35}100%{transform:translateX(-20%) skewX(-12deg);opacity:0.15}}
@keyframes reportStreamBar{0%,100%{transform:scaleX(0.4);-webkit-transform:scaleX(0.4)}50%{transform:scaleX(0.95);-webkit-transform:scaleX(0.95)}}
@-webkit-keyframes reportStreamBar{0%,100%{transform:scaleX(0.4);-webkit-transform:scaleX(0.4)}50%{transform:scaleX(0.95);-webkit-transform:scaleX(0.95)}}
@keyframes reportAurora{0%,100%{opacity:0.2;transform:translateY(0) scale(1)}50%{opacity:0.5;transform:translateY(-8%) scale(1.1)}}
*{box-sizing:border-box;-webkit-font-smoothing:antialiased}
body{margin:0;background:linear-gradient(160deg,#0A0A2E 0%,#1A1A4B 40%,#2D1B6B 100%);overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}
.saycrd-app-shell{height:100vh;height:100dvh;min-height:100vh;min-height:100dvh;overflow:hidden;max-width:100vw}
textarea::placeholder{color:rgba(255,255,255,0.15)}
.pour-input::placeholder{color:rgba(255,255,255,0.28);font-style:italic}
textarea{caret-color:#6BB8FF}
button:active{transform:scale(0.97)}
::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
@media (prefers-reduced-motion: reduce){
*:not(.saycrd-loading-indicator){animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important}
}
/* Touch devices have no hover state, so the tap-to-react sentences in HighlightableText
   are invisible as interactive until this gives them a permanent, subtle dotted underline
   affordance (skipped once feedback is set, since that already shows its own colored border). */
@media (hover: none){
.hl-sentence[data-dark="true"][data-fb="false"]{border-bottom:1px dotted rgba(255,255,255,0.28)!important}
.hl-sentence[data-dark="false"][data-fb="false"]{border-bottom:1px dotted rgba(0,0,0,0.28)!important}
}
.saycrd-loading-indicator{will-change:transform;-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);-webkit-transform:translateZ(0);animation-play-state:running!important;-webkit-animation-play-state:running!important}
@media (max-width:640px){
.saycrd-landing-grid{grid-template-columns:repeat(2,1fr)!important}
}
@media (max-width:420px){
.saycrd-landing-grid{grid-template-columns:1fr!important}
}
`}</style>
</div>
  );
}

// The shell's default background. app.jsx overrides it on the map phase only.
var SAYCRD_SHELL_BG = "linear-gradient(160deg, #0A0A2E 0%, #1A1A4B 40%, #2D1B6B 100%)";
