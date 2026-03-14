const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;

async function callClaudeClient(sys, usr, max) {
  if (window.callClaude) return window.callClaude(sys, usr, max);
  throw new Error("API unavailable. Please sign in and try again.");
}



function parseJSON(raw) {
if (!raw) return null;
try { var c = raw.replace(/```json|```/g, "").trim(); var m = c.match(/\{[\s\S]*\}/) || c.match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : null; } catch (e) { return null; }
}
function getCurrentUid() { return (typeof window !== "undefined" && window.currentUser && window.currentUser.id) ? window.currentUser.id : "local"; }
function normalizeThemeLabel(label) { return String(label || "").trim().toLowerCase(); }
var THEME_COLORS = ["#FF6B9D","#FFB86B","#6BFFB8","#6BB8FF","#B86BFF","#FFD700","#E84393","#7DB7AE"];
function getThemeColor(theme, index) { return (theme && theme.color) ? theme.color : THEME_COLORS[(index || 0) % THEME_COLORS.length]; }
var NC = THEME_COLORS;

var LIFE_DOMAINS = { work: ["work","job","career","tasks","project","boss","colleague","email","meeting","deadline","productivity"], relationship: ["partner","relationship","love","family","friend","parent","child","connection","intimacy","marriage"], self: ["self","identity","worth","body","health","energy","rest","boundary","voice","permission"], creativity: ["create","creative","art","write","build","make","idea","vision","dream"], money: ["money","financial","income","abundance","scarcity","worth","value"] };
function inferLifeDomain(shortDesc, label) {
var text = ((shortDesc || "") + " " + (label || "")).toLowerCase();
for (var domain in LIFE_DOMAINS) {
if (LIFE_DOMAINS[domain].some(function(w) { return text.indexOf(w) >= 0; })) return domain;
}
return "life";
}

const FD = "'DM Serif Display', Georgia, serif";
const FB = "'DM Sans', sans-serif";
const PHASES = ["landing", "pour", "synthesize", "map", "cosynth", "session", "field"];
const GRADIENTS = {
landing: "#000",
pour: "linear-gradient(160deg, #0A0A2E 0%, #1A1A4B 40%, #2D1B6B 100%)",
synthesize: "linear-gradient(160deg, #1A0A2E 0%, #3D1D6B 40%, #E84393 100%)",
cosynth: "linear-gradient(160deg, #080818 0%, #1A0A3E 50%, #2D1060 100%)",
map: "linear-gradient(160deg, #060810 0%, #0B1020 40%, #111830 100%)",
session: "linear-gradient(160deg, #0A0A1E 0%, #1A1A3B 40%, #2D1B5B 100%)",
field: "#000",
};

function FloatingWords({ words, color = "#6BB8FF" }) {
const v = Array.from(new Set(words.filter(function(w){ return w.length > 4; }))).slice(-12);
if (!v.length) return null;
return <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
{v.map((w, i) => <span key={""+w+"-"+i} style={{ position: "absolute", left: `${10+(i/Math.max(v.length-1,1))*80}%`, top: `${45+(Math.sin(i*0.8)*15+(i%3)*10)}%`, fontSize: 13+(i%3)*2, color, opacity: 0.04+(i/v.length)*0.08, fontFamily: FD, fontStyle: "italic", animation: `floatWord ${18+(i%4)*3}s ease-in-out infinite`, animationDelay: `${-i*1.5}s`, whiteSpace: "nowrap" }}>{w}</span>)}
</div>;
}

function Particles({ color, count = 20 }) {
return <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
{Array.from({length:count}).map((_,i) => { const s=(i*37+13)%100; return <div key={i} style={{ position: "absolute", left: `${s}%`, top: `${(s*53)%100}%`, width: 2+(s%4), height: 2+(s%4), borderRadius: "50%", background: color, opacity: 0.12+(s%20)*0.015, animation: `floatParticle ${5+s%6}s ease-in-out infinite`, animationDelay: `${-(s%5)}s` }}/>; })}
</div>;
}

function ImaginalCells({ stage, velocity, color }) {
var ratios = { nigredo: 0.18, albedo: 0.42, citrinitas: 0.70, rubedo: 0.92 };
var imaginalRatio = ratios[stage] || 0.3;
var N = 30;
var seed = 54321;
function rng() { seed = (seed * 1664525 + 1013904223) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }
var cells = [];
for (var i2 = 0; i2 < N; i2++) {
var angle = rng() * Math.PI * 2;
var dist = rng() * 52 + 6;
var cx2 = 130 + Math.cos(angle) * dist;
var cy2 = 105 + Math.sin(angle) * dist * 0.72;
var isIm = i2 < Math.floor(N * imaginalRatio);
var sz = isIm ? (rng() * 5 + 4) : (rng() * 4 + 2.5);
var dur = (rng() * 3 + 2.5).toFixed(2);
var del = (rng() * 5).toFixed(2);
var dx = ((rng() - 0.5) * 5).toFixed(2);
var dy = ((rng() - 0.5) * 4).toFixed(2);
cells.push({ cx: cx2, cy: cy2, isIm, sz, dur, del, dx, dy, id: i2 });
}
var showWings = stage === "rubedo" || stage === "citrinitas";
var wingOpacity = stage === "rubedo" ? 0.4 : 0.18;
return (
<svg viewBox="0 0 260 210" style={{ width: "100%", maxWidth: 290, display: "block" }}>
<defs>
<radialGradient id="ig_bg" cx="50%" cy="50%" r="50%">
<stop offset="0%" stopColor={color} stopOpacity="0.07"/>
<stop offset="100%" stopColor={color} stopOpacity="0"/>
</radialGradient>
<filter id="ig_glow" x="-50%" y="-50%" width="200%" height="200%">
<feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="ig_softglow" x="-100%" y="-100%" width="300%" height="300%">
<feGaussianBlur in="SourceGraphic" stdDeviation="6"/>
</filter>
</defs>

<ellipse cx="130" cy="105" rx="90" ry="72" fill="url(#ig_bg)"/>

{[1.0, 1.12, 1.24].map(function(scale, si) {
return (
<ellipse key={si} cx="130" cy="105" rx={72 * scale} ry={58 * scale}
fill="none" stroke={color} strokeWidth={si === 0 ? 1.2 : 0.5} strokeOpacity={si === 0 ? 0.22 : 0.06}>
<animate attributeName="rx" values={72*scale+";"+74*scale+";"+72*scale} dur={(4+si)+"s"} repeatCount="indefinite"/>
<animate attributeName="ry" values={58*scale+";"+60*scale+";"+58*scale} dur={(4+si)+"s"} repeatCount="indefinite"/>
</ellipse>
);
})}

<path d="M 130 45 Q 133 32 131 20" stroke={color} strokeWidth="1.4" fill="none" strokeOpacity="0.3" strokeLinecap="round">
<animate attributeName="d" values="M 130 45 Q 133 32 131 20;M 130 45 Q 127 32 132 20;M 130 45 Q 133 32 131 20" dur="3.5s" repeatCount="indefinite"/>
</path>

{cells.map(function(cell) {
if (!cell.isIm) {
var pts = [0,1,2,3,4,5].map(function(j) {
var a = j * Math.PI / 3 + 0.2;
return (cell.cx + Math.cos(a) * cell.sz).toFixed(1) + "," + (cell.cy + Math.sin(a) * cell.sz).toFixed(1);
}).join(" ");
return (
<polygon key={cell.id} points={pts}
fill="rgba(190,180,168,0.14)" stroke="rgba(210,200,188,0.28)" strokeWidth="0.5">
<animateTransform attributeName="transform" type="translate"
values={"0,0;"+cell.dx+","+cell.dy+";0,0"} dur={cell.dur+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
<animate attributeName="opacity" values="0.7;0.3;0.7" dur={(parseFloat(cell.dur)*1.4).toFixed(1)+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
</polygon>
);
}
return (
<g key={cell.id} filter="url(#ig_glow)">
<circle cx={cell.cx} cy={cell.cy} r={cell.sz} fill={color} fillOpacity="0.45">
<animate attributeName="r" values={cell.sz+";"+(cell.sz*1.35)+";"+cell.sz} dur={cell.dur+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
<animate attributeName="fill-opacity" values="0.4;0.8;0.4" dur={cell.dur+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate"
values={"0,0;"+cell.dx+","+cell.dy+";0,0"} dur={(parseFloat(cell.dur)*0.9).toFixed(1)+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
</circle>
<circle cx={cell.cx} cy={cell.cy} r={cell.sz * 0.42} fill={color} fillOpacity="0.95">
<animate attributeName="r" values={cell.sz*0.42+";"+(cell.sz*0.56)+";"+cell.sz*0.42} dur={(parseFloat(cell.dur)*0.7).toFixed(1)+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate"
values={"0,0;"+cell.dx+","+cell.dy+";0,0"} dur={(parseFloat(cell.dur)*0.9).toFixed(1)+"s"} begin={cell.del+"s"} repeatCount="indefinite"/>
</circle>
</g>
);
})}

{showWings && (
<g opacity={wingOpacity}>
<filter id="wingBlur"><feGaussianBlur stdDeviation="3"/></filter>
<path d="M 130 108 Q 94 82 76 100 Q 62 118 88 132 Q 112 140 130 120"
fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1" strokeOpacity="0.5">
<animate attributeName="d"
values="M 130 108 Q 94 82 76 100 Q 62 118 88 132 Q 112 140 130 120;M 130 108 Q 92 79 74 97 Q 60 115 86 129 Q 110 137 130 117;M 130 108 Q 94 82 76 100 Q 62 118 88 132 Q 112 140 130 120"
dur="3.2s" repeatCount="indefinite"/>
</path>
<path d="M 130 108 Q 166 82 184 100 Q 198 118 172 132 Q 148 140 130 120"
fill={color} fillOpacity="0.22" stroke={color} strokeWidth="1" strokeOpacity="0.5">
<animate attributeName="d"
values="M 130 108 Q 166 82 184 100 Q 198 118 172 132 Q 148 140 130 120;M 130 108 Q 168 79 186 97 Q 200 115 174 129 Q 150 137 130 117;M 130 108 Q 166 82 184 100 Q 198 118 172 132 Q 148 140 130 120"
dur="3.2s" repeatCount="indefinite"/>
</path>
</g>
)}
</svg>
);
}

function SeasonTree({ stage, velocity, color }) {
var isSummer = stage === "rubedo";
var leafCount = isSummer ? 38 : 16;
var seed = 77665;
function rng() { seed = (seed * 1664525 + 1013904223) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }
var leaves = [];
for (var i3 = 0; i3 < leafCount; i3++) {
var t = rng();
var branchAngle = (t - 0.5) * Math.PI * 0.85;
var dist2 = rng() * 52 + 20;
var lx = 130 + Math.sin(branchAngle) * dist2;
var ly = 80 - Math.cos(branchAngle) * dist2 * 0.88 + rng() * 18;
var lr = isSummer ? (rng() * 11 + 7) : (rng() * 4 + 2.5);
var ldur = (rng() * 2.5 + 2.2).toFixed(2);
var ldel = (rng() * 5).toFixed(2);
var ldx = ((rng() - 0.5) * 4).toFixed(2);
leaves.push({ lx, ly, lr, ldur, ldel, ldx, id: i3 });
}
var branches = [
{ d: "M 130 130 Q 107 115 90 122", w: 2.8, side: -1, pivot: "90 130" },
{ d: "M 130 115 Q 153 96 170 100", w: 2.4, side: 1, pivot: "170 130" },
{ d: "M 130 100 Q 110 80 97 83", w: 2.0, side: -1, pivot: "97 130" },
{ d: "M 130 88 Q 150 70 162 73", w: 1.7, side: 1, pivot: "162 130" },
{ d: "M 130 78 Q 124 60 121 52", w: 1.4, side: -0.5, pivot: "121 130" },
{ d: "M 130 78 Q 136 62 139 54", w: 1.2, side: 0.5, pivot: "139 130" },
];
return (
<svg viewBox="0 0 260 210" style={{ width: "100%", maxWidth: 290, display: "block" }}>
<defs>
<radialGradient id="st_groundglow" cx="50%" cy="90%" r="50%">
<stop offset="0%" stopColor={color} stopOpacity="0.14"/>
<stop offset="100%" stopColor={color} stopOpacity="0"/>
</radialGradient>
<radialGradient id="st_crownGlow" cx="50%" cy="40%" r="55%">
<stop offset="0%" stopColor={color} stopOpacity="0.07"/>
<stop offset="100%" stopColor={color} stopOpacity="0"/>
</radialGradient>
<filter id="st_glow" x="-60%" y="-60%" width="220%" height="220%">
<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/>
<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
</defs>

<ellipse cx="130" cy="182" rx="72" ry="18" fill="url(#st_groundglow)">
<animate attributeName="rx" values="70;78;70" dur="5s" repeatCount="indefinite"/>
</ellipse>

<ellipse cx="130" cy="88" rx={isSummer ? 72 : 45} ry={isSummer ? 60 : 38} fill="url(#st_crownGlow)">
<animate attributeName="rx" values={isSummer?"70;78;70":"43;50;43"} dur="4.5s" repeatCount="indefinite"/>
<animate attributeName="ry" values={isSummer?"58;66;58":"36;44;36"} dur="4.5s" repeatCount="indefinite"/>
</ellipse>

{[[-1.3,1.0,18], [-0.6,0.95,14], [0.2,1.0,14], [0.9,0.95,16], [1.5,1.05,18]].map(function(r, ri) {
var endX = (130 + r[0] * r[2]).toFixed(1);
var endY = (180 + r[1] * 14).toFixed(1);
var ctrlX = (130 + r[0] * 10).toFixed(1);
var ctrlY = (172 + r[1] * 6).toFixed(1);
return (
<path key={ri} d={"M 130 168 Q "+ctrlX+" "+ctrlY+" "+endX+" "+endY}
stroke={color} strokeWidth="1.2" fill="none" strokeOpacity="0.18" strokeLinecap="round">
<animate attributeName="stroke-opacity" values="0.12;0.25;0.12" dur={(2.5+ri*0.6)+"s"} begin={(ri*0.4)+"s"} repeatCount="indefinite"/>
</path>
);
})}

<path d="M 126 168 Q 128 135 129 110 Q 130 82 130 60"
stroke="rgba(180,155,110,0.4)" strokeWidth="6" fill="none" strokeLinecap="round"/>
<path d="M 134 168 Q 132 135 131 110 Q 130 82 130 60"
stroke="rgba(155,130,90,0.22)" strokeWidth="3.5" fill="none" strokeLinecap="round"/>

{branches.map(function(b, bi) {
return (
<path key={bi} d={b.d} stroke="rgba(180,155,110,0.32)" strokeWidth={b.w} fill="none" strokeLinecap="round">
<animateTransform attributeName="transform" type="rotate"
values={"0 130 160;"+b.side*1.8+" 130 160;0 130 160"}
dur={(3.5+bi*0.7)+"s"} begin={(bi*0.5)+"s"} repeatCount="indefinite"/>
</path>
);
})}

{leaves.map(function(leaf) {
if (!isSummer) {
return (
<g key={leaf.id} filter="url(#st_glow)">
<circle cx={leaf.lx} cy={leaf.ly} r={leaf.lr} fill={color} fillOpacity="0.6">
<animate attributeName="r" values={leaf.lr+";"+(leaf.lr*1.5)+";"+leaf.lr} dur={leaf.ldur+"s"} begin={leaf.ldel+"s"} repeatCount="indefinite"/>
<animate attributeName="fill-opacity" values="0.5;0.85;0.5" dur={leaf.ldur+"s"} begin={leaf.ldel+"s"} repeatCount="indefinite"/>
</circle>
</g>
);
}
return (
<g key={leaf.id}>
<circle cx={leaf.lx} cy={leaf.ly} r={leaf.lr} fill={color} fillOpacity="0.42">
<animate attributeName="fill-opacity" values="0.38;0.55;0.38" dur={leaf.ldur+"s"} begin={leaf.ldel+"s"} repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate"
values={"0,0;"+leaf.ldx+","+(parseFloat(leaf.ldx)*0.5)+";0,0"}
dur={leaf.ldur+"s"} begin={leaf.ldel+"s"} repeatCount="indefinite"/>
</circle>
</g>
);
})}

{[0,1,2,3,4].map(function(pi) {
var px = (108 + pi * 10).toFixed(0);
return (
<circle key={pi} cx={px} cy="155" r="1.5" fill={color} fillOpacity="0">
<animate attributeName="cy" values="155;70" dur={(3.2+pi*0.7)+"s"} begin={(pi*1.1)+"s"} repeatCount="indefinite"/>
<animate attributeName="fill-opacity" values="0;0.5;0" dur={(3.2+pi*0.7)+"s"} begin={(pi*1.1)+"s"} repeatCount="indefinite"/>
</circle>
);
})}
</svg>
);
}

function CustomArchViz({ archName, sourceNodes, themeColors, alchColor }) {
var nodes = (sourceNodes || []).slice(0, 4);
if (nodes.length === 0) nodes = ["something", "unnamed"];
var nodeCount = nodes.length;

var seed = 0;
for (var si = 0; si < (archName || "").length; si++) seed = (seed * 31 + (archName || "").charCodeAt(si)) & 0x7FFFFFFF;
function rng() { seed = (seed * 1664525 + 1013904223) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }

var nodeData = nodes.map(function(n, ni) {
var baseAngle = (ni / nodeCount) * Math.PI * 2 - Math.PI / 2 + rng() * 0.4;
var dist = 54 + rng() * 24;
var cx = 130 + Math.cos(baseAngle) * dist;
var cy = 110 + Math.sin(baseAngle) * dist * 0.78;
var col = themeColors[n.toLowerCase()] || themeColors[n] || alchColor || "#B86BFF";
var r = 14 + rng() * 10;
var dur = (2.8 + rng() * 2.5).toFixed(2);
var del = (rng() * 4).toFixed(2);
var dx = ((rng() - 0.5) * 6).toFixed(2);
var dy = ((rng() - 0.5) * 4).toFixed(2);
return { n, col, cx, cy, r, dur, del, dx, dy };
});

var lines = [];
for (var li = 0; li < nodeData.length; li++) {
for (var lj = li + 1; lj < nodeData.length; lj++) {
lines.push({ x1: nodeData[li].cx, y1: nodeData[li].cy, x2: nodeData[lj].cx, y2: nodeData[lj].cy,
col: nodeData[li].col, dur: (3.5 + li * 0.8).toFixed(2), del: (li * 0.6).toFixed(2) });
}
}

return (
<svg viewBox="0 0 260 210" style={{ width: "100%", maxWidth: 290, display: "block" }}>
<defs>
<filter id="cav_glow" x="-60%" y="-60%" width="220%" height="220%">
<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="cav_softglow">
<feGaussianBlur in="SourceGraphic" stdDeviation="8"/>
</filter>
</defs>

{nodeData.map(function(nd, i) {
return (
<circle key={"halo"+i} cx={nd.cx} cy={nd.cy} r={nd.r * 2.8} fill={nd.col} fillOpacity="0.05"
filter="url(#cav_softglow)">
<animate attributeName="r" values={nd.r*2.8+";"+(nd.r*3.4)+";"+nd.r*2.8} dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
</circle>
);
})}

{lines.map(function(l, li) {
return (
<line key={"l"+li} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
stroke={l.col} strokeWidth="0.7" strokeOpacity="0.18">
<animate attributeName="stroke-opacity" values="0.1;0.3;0.1" dur={l.dur+"s"} begin={l.del+"s"} repeatCount="indefinite"/>
</line>
);
})}

<circle cx="130" cy="110" r="3" fill="white" fillOpacity="0.35">
<animate attributeName="r" values="3;6;3" dur="4s" repeatCount="indefinite"/>
<animate attributeName="fill-opacity" values="0.2;0.55;0.2" dur="4s" repeatCount="indefinite"/>
</circle>
<circle cx="130" cy="110" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8">
<animate attributeName="r" values="20;26;20" dur="5s" repeatCount="indefinite"/>
</circle>

{nodeData.map(function(nd, i) {
var label = nd.n.toUpperCase();
return (
<g key={"n"+i} filter="url(#cav_glow)">
<circle cx={nd.cx} cy={nd.cy} r={nd.r + 6} fill="none" stroke={nd.col} strokeWidth="0.5" strokeOpacity="0.18">
<animate attributeName="r" values={(nd.r+5)+";"+(nd.r+10)+";"+((nd.r+5))} dur={(parseFloat(nd.dur)*1.3).toFixed(1)+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values={"0,0;"+nd.dx+","+nd.dy+";0,0"} dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
</circle>
<circle cx={nd.cx} cy={nd.cy} r={nd.r} fill={nd.col} fillOpacity="0.28">
<animate attributeName="fill-opacity" values="0.22;0.4;0.22" dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values={"0,0;"+nd.dx+","+nd.dy+";0,0"} dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
</circle>
<circle cx={nd.cx} cy={nd.cy} r={nd.r * 0.3} fill={nd.col} fillOpacity="0.9">
<animateTransform attributeName="transform" type="translate" values={"0,0;"+nd.dx+","+nd.dy+";0,0"} dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
</circle>
<text x={nd.cx} y={nd.cy + nd.r + 14} textAnchor="middle" fontSize="7.5"
fill={nd.col} fillOpacity="0.7" fontFamily="'DM Sans', sans-serif" letterSpacing="0.12em">
<animateTransform attributeName="transform" type="translate" values={"0,0;"+nd.dx+","+nd.dy+";0,0"} dur={nd.dur+"s"} begin={nd.del+"s"} repeatCount="indefinite"/>
{label}
</text>
</g>
);
})}
</svg>
);
}

function FieldParticles({ color, count = 20 }) {
const particles = useMemo(() =>
Array.from({ length: count }).map(() => ({
left: Math.random() * 100,
top: Math.random() * 100,
size: 2 + Math.random() * 3,
opacity: 0.15 + Math.random() * 0.25,
dur: 4 + Math.random() * 6,
delay: Math.random() * 5,
})), [count]);
return (
<div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
{particles.map((p, i) => (
<div key={i} style={{
position: "absolute", left: `${p.left}%`, top: `${p.top}%`,
width: p.size, height: p.size, borderRadius: "50%",
background: color, opacity: p.opacity,
animation: `fieldFloat ${p.dur}s ease-in-out infinite`,
animationDelay: `${p.delay}s`,
}} />
))}
</div>
);
}

function BreathingOrb({ color, size = 80 }) {
return <svg viewBox="0 0 160 160" style={{ width: size, height: size }}>
{[50,40,30,20].map((r,i) => <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth={i===3?2:0.8} opacity={0.08+i*0.06}><animate attributeName="r" values={`${r};${r+5};${r}`} dur={`${3+i*0.4}s`} repeatCount="indefinite"/></circle>)}
<circle cx="80" cy="80" r="6" fill={color} opacity="0.7"><animate attributeName="r" values="6;8;6" dur="2.5s" repeatCount="indefinite"/></circle>
</svg>;
}

function PhaseIndicator({ current, phases }) {
return <div style={{ display: "flex", gap: 3, padding: "14px 20px 0", position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 }}>
{phases.map((p, i) => <div key={p} style={{ flex: 1, height: 3, borderRadius: 2, background: i<current?"rgba(255,255,255,0.6)":i===current?"rgba(255,255,255,0.85)":"rgba(255,255,255,0.1)" }}/>)}
</div>;
}

function PourPhase({ onComplete }) {
const [text, setText] = useState("");
const [words, setWords] = useState([]);
useEffect(() => { setWords(text.split(/\s+/).filter(x => x.length > 3)); }, [text]);
const wc = text.split(/\s+/).filter(Boolean).length;
const canContinue = wc >= 20;
return (
<div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}>
<FloatingWords words={words} color="#6BB8FF"/><Particles color="#6BB8FF" count={15}/>
<div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", padding: "24px 20px 32px", paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}>
<div style={{ fontSize: 12, letterSpacing: "0.4em", fontWeight: 600, color: "#6BB8FF", marginBottom: 12, fontFamily: FB, zIndex: 1 }}>POUR</div>
<h1 style={{ fontSize: "clamp(26px, 7vw, 36px)", fontFamily: FD, fontStyle: "italic", color: "white", margin: "0 0 8px", textAlign: "center", zIndex: 1, fontWeight: 400, lineHeight: 1.15 }}>What's alive<br/>in you right now?</h1>
<p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", fontFamily: FD, fontStyle: "italic", margin: "0 0 24px", textAlign: "center", zIndex: 1, letterSpacing: "0.02em" }}>Don't think. Just pour.</p>
<textarea className="pour-input" value={text} onChange={function(e){setText(e.target.value);}} placeholder="Let the words flow through you…" autoCorrect="on" autoCapitalize="sentences" spellCheck={true} autoComplete="off" style={{ width: "100%", minHeight: 140, background: "transparent", border: "none", outline: "none", resize: "none", color: "rgba(255,255,255,0.95)", fontSize: "clamp(17px, 4.5vw, 22px)", fontFamily: "'Lora', Georgia, 'Times New Roman', serif", fontWeight: 400, fontStyle: "normal", padding: "0 4px", margin: 0, lineHeight: 1.85, display: "block", letterSpacing: "0.01em", WebkitAppearance: "none", appearance: "none" }}/>
<div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: FB }}>{wc} words{wc>0&&wc<20&&<span style={{color:"rgba(107,184,255,0.6)"}}> · keep going</span>}</div>
<button onClick={function(){ if(canContinue) onComplete(text); }} disabled={!canContinue} style={{ width: "100%", maxWidth: 320, background: canContinue ? "linear-gradient(135deg, #6BB8FF, #3D8BFF)" : "rgba(107,184,255,0.12)", border: canContinue ? "none" : "1px solid rgba(107,184,255,0.25)", borderRadius: 24, padding: "14px 24px", minHeight: 48, color: canContinue ? "white" : "rgba(255,255,255,0.5)", fontSize: 15, fontFamily: FB, fontWeight: 600, cursor: canContinue ? "pointer" : "default", touchAction: "manipulation", boxShadow: canContinue ? "0 4px 20px rgba(107,184,255,0.35)" : "none", WebkitTapHighlightColor: "transparent", opacity: canContinue ? 1 : 0.9 }}>{canContinue ? "Synthesize →" : "20 words to continue"}</button>
</div>
</div>
</div>
);
}

function SynthesizePhase({ rawText, onComplete, onSynthesis }) {
const [step, setStep] = useState(0);
const [err, setErr] = useState(null);
const ran = useRef(false);
useEffect(() => {
if (ran.current) return; ran.current = true;
var t1 = setTimeout(function() { setStep(1); }, 800);

var prevSessions = [];
try { prevSessions = loadSessions(); } catch(e) {}
var temporalContext = "";
if (prevSessions.length > 0) {
var now = Date.now();
temporalContext = "\n\nPREVIOUS SESSIONS (for temporal awareness — respect time gaps):\n";
prevSessions.slice(-6).forEach(function(s) {
var d = new Date(s.date);
var daysAgo = Math.round((now - d.getTime()) / 86400000);
var when = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : daysAgo < 7 ? daysAgo + " days ago" : daysAgo < 30 ? Math.round(daysAgo / 7) + " weeks ago" : Math.round(daysAgo / 30) + " months ago";
var themes = (s.themes || []).map(function(t) { return t.label; }).join(", ");
var archs = (s.archetypes || []).map(function(a) {
var key = typeof a === "string" ? a : a.key;
var phase = a.phase || "";
var resp = s.archetypeResponse && s.archetypeResponse.key === key ? s.archetypeResponse.response : "";
return key + (phase ? "@" + phase : "") + (resp ? "(" + resp + ")" : "");
}).join(", ");
var line = "- " + when + ": themes=[" + themes + "]";
if (archs) line += " archetypes=[" + archs + "]";
if (s.alchemy) line += " alchemy=" + s.alchemy.stage;
if (s.synthesis) line += " insight: " + s.synthesis;
if (s.tension) line += " tension: " + s.tension.a + " vs " + s.tension.b;
var pastRejections = [];
var pastCorrections = [];
if (s.mapResponses) {
Object.keys(s.mapResponses).forEach(function(connKey) {
var mr = s.mapResponses[connKey];
if (!mr) return;
var parts = connKey.split("::");
var connLabel = (parts[0]||"") + " ↔ " + (parts[1]||"");
if (mr.value === "no") {
if (mr.comment && mr.comment.trim()) {
pastCorrections.push("[" + connLabel + "]: user said \"" + mr.comment.trim() + "\"");
} else {
pastRejections.push(connLabel);
}
}
});
}
if (s.reactions) {
Object.keys(s.reactions).forEach(function(rk) {
if (s.reactions[rk] === "resisted") pastRejections.push("reading: \"" + rk.slice(0,60) + "\"");
});
}
if (s.corrections) {
Object.keys(s.corrections).forEach(function(ck) {
if (s.corrections[ck] && s.corrections[ck].trim()) {
pastCorrections.push("on \"" + ck.slice(0,40) + "\": user said \"" + s.corrections[ck].trim().slice(0,80) + "\"");
}
});
}
if (pastRejections.length > 0) line += " | USER REJECTED: " + pastRejections.join("; ");
if (pastCorrections.length > 0) line += " | USER CORRECTIONS (their words ARE the truth): " + pastCorrections.join("; ");
temporalContext += line + "\n";
});
var archCounts = {};
prevSessions.forEach(function(s) {
(s.archetypes || []).forEach(function(a) {
var key = typeof a === "string" ? a : (a.name || a.key || "");
if (!archCounts[key]) archCounts[key] = { count: 0, names: [], lastResponse: "" };
archCounts[key].count++;
if (a.name) archCounts[key].names.push(a.name);
if (s.archetypeResponse && (s.archetypeResponse.key === key || s.archetypeResponse.key === a.key)) archCounts[key].lastResponse = s.archetypeResponse.response;
});
});
var allArchNames = [];
prevSessions.forEach(function(s) {
(s.archetypes || []).forEach(function(a) {
if (a.name) allArchNames.push(a.name);
});
});
if (allArchNames.length > 0) {
temporalContext += "\nPREVIOUS ARCHETYPE NAMES (for evolution tracking — generate evolution_from if pattern evolved):\n";
temporalContext += allArchNames.join(" → ") + "\n";
}
var recurring = Object.keys(archCounts).filter(function(k) { return archCounts[k].count >= 2; });
if (recurring.length > 0) {
temporalContext += "\nRECURRING PATTERNS:\n";
recurring.forEach(function(k) {
var a = archCounts[k];
temporalContext += "- " + k + ": appeared " + a.count + "x";
if (a.lastResponse) temporalContext += " (user " + a.lastResponse + " it last time)";
temporalContext += "\n";
});
}
}

var fieldState = computeFieldState();
if (fieldState && fieldState.sessionCount >= 2) {
temporalContext += "\nFIELD STATE (living signals — use these to deepen your reading):\n";
if (fieldState.rising.length > 0) temporalContext += "RISING themes (getting louder): " + fieldState.rising.map(function(r){return r.label + " (+" + r.delta + ")";}).join(", ") + "\n";
if (fieldState.fading.length > 0) temporalContext += "FADING themes (loosening grip): " + fieldState.fading.map(function(f){return f.label + " (" + f.delta + ")";}).join(", ") + "\n";
if (fieldState.absent.length > 0) temporalContext += "ABSENT themes (disappeared — avoidance or completion?): " + fieldState.absent.join(", ") + "\n";
if (fieldState.chronic.length > 0) temporalContext += "CHRONIC themes (always present): " + fieldState.chronic.join(", ") + "\n";
if (fieldState.anchor) {
var sig = fieldState.archSignals[fieldState.anchor] || {};
var userRejectedAnchor = sig.lastResponse === "resisted" || sig.lastResponse === "pushed back" || sig.lastResponse === "no";
if (userRejectedAnchor) {
temporalContext += "PATTERN ALERT: \"" + fieldState.anchor + "\" appeared " + fieldState.anchorCount + "x BUT USER REJECTED IT last time. Do NOT repeat this archetype or its themes. Evolve past it.\n";
} else {
temporalContext += "ANCHOR archetype: " + fieldState.anchor + " (appeared " + fieldState.anchorCount + "x";
if (sig.velocity && sig.velocity !== "stable") temporalContext += ", " + sig.velocity;
if (sig.currentPhase) temporalContext += ", currently @" + sig.currentPhase;
temporalContext += ")\n";
if (sig.phaseHistory) temporalContext += " Phase journey: " + sig.phaseHistory + "\n";
}
}
if (fieldState.tensionShape && fieldState.tensionAge >= 2) temporalContext += "RECURRING TENSION: " + fieldState.tensionShape + " (present " + fieldState.tensionAge + " sessions)\n";
if (fieldState.energies.length >= 2) temporalContext += "ENERGY PATTERN: " + fieldState.energies.join(" → ") + " (trend: " + fieldState.energyTrend + ")\n";
if (fieldState.alchemyStage) temporalContext += "ALCHEMY: " + fieldState.alchemyStage + " (" + fieldState.alchemyVelocity + ")\n";
if (fieldState.lastBlindSpot) temporalContext += "LAST BLIND SPOT: " + fieldState.lastBlindSpot.slice(0, 100) + "\n";
if (fieldState.constellations.length > 0) temporalContext += "CONSTELLATIONS: " + fieldState.constellations.map(function(c){return c.pair + " (" + c.count + "x)";}).join(", ") + "\n";
}

var prompt = "You are the reflective engine behind SAYCRD — a co-creation tool, not a diagnosis tool.\n" +
"Your role is WITNESS, not analyst. COMPANION, not judge. MIRROR, not authority.\n\n" +
"══ AUTHORITY HIERARCHY — FOLLOW THIS EXACTLY ══\n" +
"1. USER SIGNALS (highest) — if user pushed back on a connection, corrected a reading, or gave their own words: those words ARE the truth. Your interpretation was wrong. Update accordingly. Do not defend your original read.\n" +
"2. USER BEHAVIOR — what they connected manually, held, returned to. This is unconscious truth.\n" +
"3. USER TEXT — their exact words from the dump. Quote them. Mirror them. Do not paraphrase into your own voice.\n" +
"4. AI INFERENCE (lowest) — patterns, archetypes, connections. Useful, not sovereign. Offer, never declare.\n\n" +
"IF USER SIGNALS EXIST IN THE INPUT: MANDATORY OVERRIDE. You must completely replace your reading with theirs. \n" +
"- If user pushed back on a connection: that connection is WRONG. Your interpretation was wrong. Do not reference it, defend it, or find a 'nuanced' version of it.\n" +
"- If user rejected an archetype or theme: DROP IT ENTIRELY. Do not bring it back in disguise.\n" +
"- If user gave their own words: THOSE WORDS ARE THE SYNTHESIS. Reflect them back directly.\n" +
"- If past sessions show USER REJECTED markers: those readings are PERMANENTLY retired.\n" +
"- PATTERN ALERT sections mean: this archetype has overstayed. Find what's NEW.\n\n" +
"TEMPORAL AWARENESS:\n" +
"- Current session + user signals are PRIMARY. Past sessions are CONTEXT only.\n" +
"- If the user gave feedback on a past reading, their feedback is the truth about that moment.\n\n" +
"LANGUAGE RULES — CRITICAL:\n" +
"- Every insight must pass: Is this rooted in THEIR actual words? If not, rewrite.\n" +
"- Be SHORT. DIRECT. Root every line in their language.\n" +
"- BAD: 'You are in a space where rest and creativity are integrating.'\n" +
"- GOOD: 'Rest is driving it now. That's what you wrote.'\n" +
"- Write as a witness who was paying close attention, not someone revealing hidden truths.\n" +
"- BANNED: navigating, intentional, sacred, container, grounding, healing, inner work, your journey, meaningful way, deeper sense, space where, emerging, integration, cultivating.\n" +
"- NEVER EVER say: 'you are not ready', 'you resist', 'you avoid', 'you cannot', 'you're not open', 'you're closed', 'you refuse', 'you struggle with', 'you haven't', 'not yet ready'. These are projections from a position of superiority. You do not know what the user is ready for. \n" +
"- If you see a pattern that LOOKS like resistance — ASK about it. Never declare it.\n" +
"- Example wrong: 'You're not ready to partner.' Example right: 'Something about partnership keeps showing up — what does that word actually mean to you?'\n\n" +
"1. THEMES: Extract 5-7 core themes. Prefer 2-word labels (e.g. 'digital tasks' not 'email' and 'website' separately). When multiple items are instances of the same category (email+website, calls+meetings), consolidate into ONE node (e.g. 'digital tasks', 'people contact'). Weight 1-5. For each theme add 'why' (brief phrase from user's words) and 'short_desc' (4-8 words, factual, the area of life the user shared — e.g. 'tasks involving screens and inboxes').\n" +
"2. CONNECTIONS: 3-5 connections. Not every theme needs a connection — isolated nodes create interesting negative space. 1-word label, one-sentence insight (punchy, not generic).\n" +
"3. GUIDE: 3-5 items. Types: act, notice, deepen, release. Max 12 words.\n" +
"4. MAP_TITLE: 3-6 words.\n" +
"5. DESCENT_CARDS: 4 cards. Mix energy, binary, spectrum. Make prompts SHORT (under 8 words). Each must be immediately clear.\n" +
"6. ARCHETYPE: Generate ONE archetype that captures who this person IS BEING right now — not a label, a specific character.\\n" +
" Could be anyone: Disney, myth, fairy tale, film, history, a mother, a son, a completely invented role. The test: reading it feels like \'oh — that IS them\'.\\n" +
" Examples: The Mother Who Stays, Sisyphus at the Summit, Moana Before the Horizon, The Reluctant King, The Child Who Grew Up Too Fast, The Architect of Beautiful Ruins, Inanna Mid-Descent.\\n" +
" Base it ONLY on what they actually wrote and confirmed patterns. No hero unless they wrote something heroic.\\n" +
" - name (specific character or invented role), line (1 sentence — what this character DOES, present tense active voice), source_nodes (1-3 theme labels), classical_resonance (brief reference or null), evolution_from (null or prior archetype name)\\n" +
"7. ALCHEMY: Stage nigredo|albedo|citrinitas|rubedo + 1 sentence evidence.\n" +
"8. SYNTHESIS: 1-2 sentences rooted in THEIR exact words. If user signals exist, your synthesis MUST reflect them — not your original AI read. Mirror what they said, not what you inferred. Make them feel HEARD first. If you offer a new angle, frame it as a question, not a declaration.\n" +
"9. UNDERNEATH: Array of EXACTLY 3 short strings (max 10 words each). These are PATTERN INTELLIGENCE — what is difficult for the person to notice themselves: subtle or strong patterns that psychology or careful reading can see but are 'in hiding' to them. Look for: repetition (same move, word, or structure), what they keep circling without naming, contradictions between stated intent and pattern, blind spots implied by the structure of their words. Root each in their actual words/behavior but name what they have not said. NOT what the subject thinks is underneath; what the pattern reveals.\n" +
"10. TENSION: Object {a, b, text}. a/b = opposing poles (1-3 words each). text = 1 punchy sentence about the cost of this specific tension for this specific person. Max 18 words.\n" +
"11. BLIND_SPOT: 1 sentence. A pattern they may not have named yet — offered as a question if possible. If user signals suggest they DO see this, skip it and offer something genuinely unseen. Max 14 words.\n" +
"12. OPENING: 1 question. Specific, uncomfortable, cracks it open. Under 12 words. Don\'t soften.\n" +
"13. NOTICING: 1 observation about HOW they write — rhythm, avoidance, repetition, what\'s missing. Max 18 words.\n\n" +
"14. FIELD_CARDS — THIS IS THE MOST IMPORTANT PART.\n" +
"You are designing Spotify Wrapped for the soul. Each card is a visual moment that BUILDS on the last.\n" +
"Like Wrapped: '47,000 minutes' → 'top genre: indie' → 'but December was all jazz' — each card recontextualizes what came before.\n\n" +
"THE NARRATIVE ARC (follow this order):\n" +
"1. Energy card — arrival word, huge. Sub_text quotes 5-10 words the user ACTUALLY WROTE that reveal the energy.\n" +
"2. Themes card — type=themes_reveal. hero_text = the dominant theme name. sub_text names ALL themes. This is the 'top genre' moment.\n" +
"3. Insight card — the synthesis. References the energy: 'You arrived [energy] because...' \n" +
"4. Tension card — the core pull. hero_text = 'X vs Y'. Sub_text names the stakes.\n" +
"5. Blind spot card — what they cannot see. References the tension.\n" +
"6. Pattern/shift card — what is recurring or changing.\n" +
"7. Identity card — the archetype. This is the CONCLUSION of everything above. The punchline.\n\n" +
"EVERY CARD MUST HAVE:\n" +
"- type: energy|insight|tension|pattern|identity|blind_spot|shift|themes_reveal\n" +
"- hero_text: 1-5 words max. The dominant visual element.\n" +
"- sub_text: 1-2 sentences. Small context.\n" +
"- color: hex color that FITS this card's emotion. BE CREATIVE. Never same color twice.\n" +
"- user_fragment: 5-15 words the user ACTUALLY WROTE that this card is based on. Direct quote. This grounds every card in THEIR words.\n" +
"- whisper: barely visible text (or null).\n\n" +
"DESIGN RULES:\n" +
"- ONE dominant element per card. 60-80% visual space.\n" +
"- The user_fragment is CRITICAL. It shows 'we heard you'. Pull real phrases from their text.\n" +
"- Each card should make the NEXT card hit harder. Build tension.\n" +
"- The insight card should reference the energy card. The blind spot should reference the tension.\n" +
"- Would someone screenshot this? If not, make it bolder.\n\n" +
"THEMES_REVEAL CARD:\n" +
"- hero_text = the single most dominant theme name (1-2 words, HUGE)\n" +
"- sub_text = a sentence that names ALL themes: 'alongside [theme2], [theme3], and [theme4]'\n" +
"- This is the 'your top genre' moment. Make it feel like a reveal.\n\n" +
"CRITICAL: FROM and TO in connections must EXACTLY match a theme label. Optionally add evidence_quote (brief phrase from user's words) or mechanism (one-line explanation) so the user sees why this connection emerged.\n" +
`Respond with ONLY valid JSON, no markdown:\n{"themes":[{"label":"...","weight":1,"why":"...","short_desc":"4-8 words factual area of life"}],"connections":[{"from":"exact label","to":"exact label","label":"...","insight":"..."}],"guide":[{"type":"act","text":"..."}],"map_title":"...","descent_cards":[{"type":"energy","phrase":"wanting to be seen but not watched","color":"#FFB86B"},{"type":"binary","prompt":"lately you seem drawn to","option_a":"building slowly","option_b":"leaping first","color":"#FF6B9D"},{"type":"spectrum","prompt":"where does this live?","pole_a":"still forming","pole_b":"ready to move","color":"#6BFFB8"}],"archetype":{"name":"The Attuned Builder","line":"Builds through listening, not force.","source_nodes":["rest","creativity"],"classical_resonance":"hermit","evolution_from":null},"synthesis":"You\'re not building a product. You\'re building proof you\'re allowed to take up space.",
"underneath":["Proof and worthiness collapsed into the same word","The thing you\'re building is the question you keep circling","Rest appears as something you\'re rationing"],
"tension":{"a":"Control","b":"Trust","text":"You\'re trying to engineer outcomes that only surrender can reach."},
"blind_spot":"You think the audience is watching. It\'s a mirror.",
"opening":"What would you make if no one would ever know?",
"noticing":"You use \'I want\' four times and \'I should\' seven. The gap is the work.",
"alchemy":{"stage":"nigredo","evidence":"..."},"field_cards":[{"type":"energy","hero_text":"TENDER","sub_text":"You arrived softer than last time.","color":"#c070f0","user_fragment":"i feel like something cracked open today","whisper":"session 4"},{"type":"themes_reveal","hero_text":"SURRENDER","sub_text":"alongside control, trust, and making","color":"#B86BFF","user_fragment":"i keep coming back to letting go","whisper":"what surfaced"},{"type":"insight","hero_text":"Your best ideas come when you stop pushing.","sub_text":"You arrived tender — and that tenderness is the source.","color":"#6BFFB8","user_fragment":"when i stop trying it flows","whisper":null},{"type":"tension","hero_text":"control vs trust","sub_text":"You keep choosing control. Trust keeps winning anyway.","color":"#6BB8FF","user_fragment":"i want to let go but i keep gripping","whisper":null},{"type":"blind_spot","hero_text":"You are performing strength.","sub_text":"The control vs trust war has a third player: the audience you imagine watching.","color":"#888890","user_fragment":"i need to show them i can do this","whisper":"what you cannot see"},{"type":"identity","hero_text":"The Reluctant Opener","sub_text":"Opens doors but stands in the frame.","color":"#E84393","user_fragment":"i opened the door but didnt walk through","whisper":"your pattern"}]}`;
var _looksLikeLog = (rawText||"").match(/^(Supabase|LOCAL BYPASS|\[SAYCRD\]|console\.log)/);
if (_looksLikeLog) {
console.warn("[SAYCRD] rawText looks like console output — aborting synthesis");
setErr("It looks like console output was pasted instead of your writing. Please go back and write your pour.");
setStep(2);
return;
}
console.log("[SAYCRD] Synthesizing dump:", (rawText||"").slice(0,80) + "...");
(async function() {
try {
var userSignals = "";
var mapR = {}; 
var signalLines = [];
Object.keys(mapR).forEach(function(k) {
var r = mapR[k];
if (!r) return;
var parts = k.split("::");
var from = parts[0] || "", to = parts[1] || "";
var resonance = r.value === "yes" ? "confirmed" : r.value === "partly" ? "partial" : "pushed back";
var line = "Connection [" + from + " ↔ " + to + "]: " + resonance;
if (r.comment && r.comment.trim()) {
line += " — USER SAID: \"" + r.comment.trim() + "\"";
}
if (r.correction && r.correction.trim() && r.correction !== r.comment) {
line += " (USER CORRECTION: \"" + r.correction.trim() + "\")";
}
signalLines.push(line);
});
var bannedReadings = [];
var pastUserWords = [];
try {
var pastSessions = loadSessions();


pastSessions.forEach(function(ps) {
if (ps.mapResponses) {
Object.keys(ps.mapResponses).forEach(function(ck) {
var mr = ps.mapResponses[ck];
if (mr && mr.value === "no" && mr.comment && mr.comment.trim()) {
pastUserWords.push(mr.comment.trim());
}
if (mr && mr.value === "no" && !mr.comment) {
var pts = ck.split("::");
bannedReadings.push("the connection between " + (pts[0]||"") + " and " + (pts[1]||""));
}
});
}
if (ps.reactions) {
Object.keys(ps.reactions).forEach(function(rk) {
if (ps.reactions[rk] === "resisted") bannedReadings.push(rk.slice(0, 80));
});
}
if (ps.corrections) {
Object.keys(ps.corrections).forEach(function(ck) {
var correction = ps.corrections[ck];
if (correction && correction.trim()) pastUserWords.push(correction.trim());
});
}
if (ps.cardFeedback) {
Object.keys(ps.cardFeedback).forEach(function(cardKey) {
var fb = ps.cardFeedback[cardKey];
if (!fb) return;
if (fb.slider !== undefined && fb.slider <= 32) {
bannedReadings.push("the " + cardKey + " reading (user pushed this away)");
}
if (fb.comment && fb.comment.trim()) {
pastUserWords.push(fb.comment.trim());
}
});
}
});
} catch(e) {}

var userSignalParts = [];
if (signalLines.length > 0) {
userSignalParts.push("══ CURRENT SESSION USER SIGNALS (HIGHEST AUTHORITY) ══\n" +
"These are the user's direct words RIGHT NOW. They override everything — past sessions, AI patterns, recurring themes.\n" +
signalLines.join("\n"));
}
if (bannedReadings.length > 0) {
userSignalParts.push("══ BANNED READINGS (user rejected these — permanently retired) ══\n" +
bannedReadings.slice(-10).map(function(b){return "- " + b;}).join("\n"));
}
if (pastUserWords.length > 0) {
userSignalParts.push("══ USER'S OWN WORDS FROM PAST SESSIONS (carry forward) ══\n" +
"These are corrections the user gave. They are more accurate than any AI read.\n" +
pastUserWords.slice(-8).map(function(w){return "\"" + w + "\"";}).join("\n"));
}

if (userSignalParts.length > 0) {
userSignals = "\n\n" + userSignalParts.join("\n\n") + "\n══ END USER AUTHORITY ══";
}
console.log("[SAYCRD] Sending to Claude, awaiting response...");
var raw = await callClaudeClient(prompt, (rawText || "") + temporalContext + userSignals, 3500);
console.log("[SAYCRD] AI raw response:", (raw||"").slice(0, 200));
setStep(2);
var data = parseJSON(raw);
console.log("[SAYCRD] Parsed data:", data ? "OK - " + (data.themes||[]).length + " themes" : "FAILED");
if (data && data.themes && data.themes.length > 0) {
data.themes = data.themes.map(function(t, i) { return Object.assign({}, t, { color: NC[i % NC.length] }); });
if (data.archetype && !data.archetypes) {
data.archetypes = [data.archetype];
}
if (!data.archetypes) data.archetypes = [];
if (data.connections) data.connections = data.connections.map(function(c) {
var ft = (data.themes || []).find(function(t) { return t.label === c.from; });
return Object.assign({}, c, { color: ft ? ft.color : NC[0] });
});
onSynthesis(data);
setTimeout(onComplete, 1200);
} else { throw new Error("No themes parsed from AI response"); }
} catch (e) {
console.error("[SAYCRD] Synthesis error:", e);
if (e.message && (e.message.includes("empty response") || e.message.includes("timed out") || e.message.includes("JSON parse failed"))) {
console.warn("[SAYCRD] Retrying synthesis in 2s...");
setStep(1);
await new Promise(function(w) { setTimeout(w, 2000); });
try {
var retryResponse = await callClaudeClient(prompt, rawText, 4000);
var retryData = parseJSON(retryResponse);
if (retryData && retryData.themes && retryData.themes.length > 0) {
retryData.themes = retryData.themes.map(function(t, i) { return Object.assign({}, t, { color: NC[i % NC.length] }); });
if (Array.isArray(retryData.archetypes)) retryData.archetypes = retryData.archetypes.slice(0,1);
else if (retryData.archetype) retryData.archetypes = [retryData.archetype];
retryData.connections = (retryData.connections || []).map(function(c) {
var ft = (retryData.themes || []).find(function(t) { return t.label === c.from; });
return Object.assign({}, c, { color: ft ? ft.color : NC[0] });
});
onSynthesis(retryData);
onComplete();
return;
}
} catch(e2) { console.error("[SAYCRD] Retry also failed:", e2); }
}
setErr(e.message || "API error");
setStep(2);
}
})();
return function() { clearTimeout(t1); };
}, []);
return (
<div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden" }}>
<Particles color="#E84393" count={25}/>
<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
<div style={{ textAlign: "center" }}>
<BreathingOrb color="#E84393" size={100}/>
<div style={{ marginTop: 28, fontSize: 22, fontFamily: FD, fontStyle: "italic", color: "white", animation: "pulse 2s ease infinite" }}>
{step===0&&"Reading your words..."}
{step===1&&"Finding what's underneath..."}
{step===2&&(err?"Error: " + (err.length > 90 ? err.slice(0,90)+"…" : err):"Building your map...")}
{err && <button onClick={function(){ window.location.reload(); }} style={{ marginTop:16, padding:"8px 22px", borderRadius:999, border:"1px solid rgba(255,107,107,0.3)", background:"transparent", color:"rgba(255,107,107,0.6)", fontFamily:FB, fontSize:12, cursor:"pointer", display:"block", margin:"16px auto 0" }}>go back and retry</button>}
</div>
<div style={{ marginTop: 16, fontSize: 13, color: err?"rgba(255,107,107,0.5)":"rgba(255,255,255,0.25)", fontFamily: FB }}>
{err ? err.slice(0,60) : step < 2 ? "analyzing patterns…" : "themes found"}
</div>
</div>
</div>
</div>
);
}

function InsightDrawer({ connection, position, onClose, onRespond, initialResponse, rawText }) {
const [value, setValue] = useState(initialResponse ? (typeof initialResponse.slider === "number" ? initialResponse.slider : (initialResponse.value==="yes"?80:initialResponse.value==="partly"?50:20)) : null);
const [done, setDone] = useState(!!initialResponse);
const [comment, setComment] = useState(initialResponse && initialResponse.comment ? initialResponse.comment : "");
const [showComment, setShowComment] = useState(!!(initialResponse && (initialResponse.comment || initialResponse.correction)));
const ref = useRef(null);
const [dragOff, setDragOff] = useState(null);
const [dragPos, setDragPos] = useState(null);
var handlePD = function(e) { if(e.target.closest("[data-slider]"))return; var r=ref.current?ref.current.getBoundingClientRect():null; if(!r)return; setDragOff({x:e.clientX-r.left,y:e.clientY-r.top}); };
useEffect(function() { if(!dragOff)return; function m(e){setDragPos({x:e.clientX-dragOff.x,y:e.clientY-dragOff.y});} function u(){setDragOff(null);} window.addEventListener("pointermove",m); window.addEventListener("pointerup",u); return function(){window.removeEventListener("pointermove",m);window.removeEventListener("pointerup",u);}; }, [dragOff]);

function handleSet(v) {
setValue(v);
var mapped = v < 33 ? "no" : v < 66 ? "partly" : "yes";
onRespond(mapped, null, v, "");
setDone(true);
if (v < 33) setShowComment(true);
}
useEffect(function() {
if (!done) return;
function onKey(e) {
if (e.key !== "Enter") return;
e.preventDefault();
onClose();
}
window.addEventListener("keydown", onKey);
return function() { window.removeEventListener("keydown", onKey); };
}, [done]);
function submitComment() {
var mapped = value < 33 ? "no" : value < 66 ? "partly" : "yes";
var userWord = comment.trim();

onRespond(mapped, userWord||null, value, userWord);
}

const accent = connection.color || "#6BB8FF";
const s = dragPos ? { left: dragPos.x, top: dragPos.y, transform: "none" }
: { left: "50%", top: Math.max(10, Math.min(position.y - 60, 240)), transform: "translate(-50%, 0)" };
return (
<div ref={ref} onPointerDown={handlePD} onClick={function(e){e.stopPropagation();}} style={{
position: "absolute", ...s, width: 320, maxWidth: "94%",
background: `linear-gradient(160deg, rgba(10,12,20,0.98), rgba(20,15,35,0.96))`,
border: `1.5px solid ${accent}55`, borderRadius: 18, backdropFilter: "blur(20px)",
zIndex: 30, cursor: dragOff?"grabbing":"grab",
animation: "drawerIn 0.4s cubic-bezier(.25,.46,.45,.94) forwards",
touchAction: "none", boxShadow: `0 0 50px ${accent}20, 0 20px 60px rgba(0,0,0,0.6)`,
}}>
<div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 2, background: `linear-gradient(90deg, transparent, ${accent}88, transparent)`, borderRadius: 1 }}/>
<button onClick={function(e){e.stopPropagation();onClose();}} style={{ position: "absolute", top: 12, right: 14, width: 26, height: 26, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", display: "grid", placeItems: "center" }}>{"\u2715"}</button>
<div style={{ padding: "22px 22px 20px" }}>
<div style={{ fontSize: 10, letterSpacing: "0.2em", color: `${accent}99`, fontFamily: FB, textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>{connection.nodeA} {"\u2194"} {connection.nodeB}</div>
<div style={{ marginBottom:20 }}>
<div style={{ fontSize:9, letterSpacing:"0.18em", color:accent+"55", fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>ai read</div>
<div style={{ fontSize:17, color:"rgba(255,255,255,0.85)", fontFamily:FD, fontStyle:"italic", lineHeight:1.55 }}>{connection.insight}</div>
</div>
{!done && <div data-slider="true">
<div style={{ fontSize: 11, color: `${accent}88`, fontFamily: FB, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, textAlign: "center" }}>how much does this feel like your life?</div>
<SpectrumSlider color={accent} poleA="not how it lives in me" poleB="very alive in me" onSet={handleSet} value={value} />
</div>}
{done && !showComment && <div style={{textAlign:"center",padding:"8px 0",animation:"riseUp 0.5s ease"}}>
{value > 66
? <div style={{fontSize:14,fontFamily:FB,color:accent,fontWeight:600}}>very alive right now ✓</div>
: value > 33
? <div style={{fontSize:14,fontFamily:FB,color:accent,fontWeight:600}}>there's something real here ✓</div>
: <div style={{fontSize:13,fontFamily:FB,color:"rgba(214,178,100,0.8)",fontWeight:600}}>not quite how it lives in you</div>
}
{value >= 33 && <button onClick={function(e){e.stopPropagation();setShowComment(true);}} style={{display:"block",margin:"10px auto 0",fontSize:11,color:"rgba(255,255,255,0.22)",fontFamily:FB,background:"transparent",border:"none",cursor:"pointer",letterSpacing:"0.08em",textDecoration:"underline",textUnderlineOffset:3}}>add a note →</button>}
<div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:FB,letterSpacing:"0.08em",marginTop:12}}>Enter to close</div>
</div>}
{done && showComment && <div style={{animation:"riseUp 0.4s ease",marginTop:8}}>
{value <= 33
? <div style={{fontSize:11,color:"rgba(214,178,100,0.7)",fontFamily:FB,letterSpacing:"0.1em",marginBottom:10}}>in your words, what’s here between these?</div>
: <div style={{fontSize:11,color:accent+"88",fontFamily:FB,letterSpacing:"0.1em",marginBottom:10}}>anything you’d add to this pull?</div>
}
<textarea value={comment} onChange={function(e){setComment(e.target.value);}}
onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submitComment();}}}
placeholder={value<=33?"put the connection in your own words...":"small note, if anything wants to be said..."}
style={{width:"100%",minHeight:64,
background:value<=33?"rgba(40,30,8,0.6)":"rgba(255,255,255,0.04)",
border:"1px solid "+(value<=33?"rgba(214,178,100,0.3)":accent+"33"),
borderRadius:10,color:"rgba(255,255,255,0.9)",fontFamily:FD,fontSize:15,
fontStyle:"italic",padding:"10px 12px",resize:"none",outline:"none",
lineHeight:1.6,boxSizing:"border-box"}}
/>
<div style={{display:"flex",justifyContent:"space-between",marginTop:8,alignItems:"center"}}>
{value<=33
? <div style={{fontSize:10,color:"rgba(214,178,100,0.4)",fontFamily:FB}}>your words are how this lives in you</div>
: <button onClick={onClose} style={{fontSize:11,color:"rgba(255,255,255,0.22)",fontFamily:FB,background:"transparent",border:"none",cursor:"pointer",letterSpacing:"0.06em"}}>close without note</button>
}
<button onClick={function(){submitComment();onClose();}}
style={{fontSize:12,fontFamily:FB,background:"transparent",
border:"1px solid "+(comment.trim()?(value<=33?"rgba(214,178,100,0.6)":accent+"44"):"rgba(255,255,255,0.1)"),
borderRadius:16,padding:"6px 18px",cursor:"pointer",
color:comment.trim()?(value<=33?"#D6B264":accent):"rgba(255,255,255,0.2)"
}}>{value<=33?"this is how it lives":"noted"}</button>
<div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:FB,letterSpacing:"0.08em",marginTop:8}}>Enter to close</div>
</div>
</div>}
</div>
</div>
);
}

function MapPhase({ onComplete, synthesisData, rawText, onPatchSynthesis }) {
const [activeConn, setActiveConn] = useState(null);
const [responses, setResponses] = useState({});
const [dragging, setDragging] = useState(null);
const [selectedNode, setSelectedNode] = useState(null);
const [discoveredConns, setDiscoveredConns] = useState([]);
const [snapTarget, setSnapTarget] = useState(null);
const [mapInputOpen, setMapInputOpen] = useState(false);
const [mapInputText, setMapInputText] = useState("");
const [mapInputBusy, setMapInputBusy] = useState(false);
const SNAP_DIST = 130;

const sd = synthesisData;
const nodes = useMemo(() => {
if (sd && sd.themes) return sd.themes.map(function(t, i) {
var label = t.label || "";
var shortDesc = t.short_desc || t.why || "";
var domain = inferLifeDomain(shortDesc, label);
return { key: t.label, display: label, color: t.color || NC[i % NC.length], w: Math.min(t.weight / 5, 1), shortDesc: shortDesc, domain: domain };
});
return [];
}, [sd]);

const conns = useMemo(() => {
if (sd && sd.connections) return sd.connections.map(function(c) {
return {
from: c.from,
to: c.to,
label: (c.label || c.operator || "linked").toUpperCase(),
operator: c.operator || null,
claim: c.claim || null,
evidence_quote: c.evidence_quote || c.quote || null,
mechanism: c.mechanism || null,
cost: c.cost || null,
unlock: c.unlock || null,
question: c.question || null,
voltage: c.voltage || null,
insight: c.insight || "",
color: c.color || NC[0]
};
});
return [];
}, [sd]);

function extractSnippet(txt, label) {
try {
if (!txt || !label) return "";
var clean = String(txt);
var term = String(label).trim();
if (!term) return "";
var re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "\\b", "i");
var m = re.exec(clean);
if (!m || m.index === undefined) return "";
var i = m.index;
var start = Math.max(0, i - 90);
var end = Math.min(clean.length, i + term.length + 160);
var chunk = clean.slice(start, end).replace(/\s+/g, " ").trim();
if (start > 0) chunk = "\u2026 " + chunk;
if (end < clean.length) chunk = chunk + " \u2026";
return chunk;
} catch(e) { return ""; }
}

function bestFallbackInsight(label) {
try {
if (!label) return "";
var rel = conns.filter(function(c){ return c.from === label || c.to === label; });
for (var i = 0; i < rel.length; i++) {
if (rel[i] && rel[i].insight && String(rel[i].insight).trim().length > 12) return String(rel[i].insight).trim();
}
return "";
} catch(e) { return ""; }
}

const selectedDetail = useMemo(() => {
if (!selectedNode) return null;
var related = conns.filter(function(c){ return c.from === selectedNode || c.to === selectedNode; });
var notes = related.map(function(c){
var k = c.from + "::" + c.to;
var r = responses && responses[k];
if (!r || !r.comment || !String(r.comment).trim()) return null;
return { k: k, other: (c.from === selectedNode ? c.to : c.from), value: r.value, comment: String(r.comment).trim() };
}).filter(Boolean);
var theme = sd && sd.themes ? sd.themes.find(function(t){ return t.label === selectedNode; }) : null;
var whyNode = theme && (theme.why || theme.evidence || theme.source) ? String(theme.why || theme.evidence || theme.source).trim() : null;
if (!whyNode) whyNode = extractSnippet(rawText || "", selectedNode) || bestFallbackInsight(selectedNode);
return {
label: selectedNode,
whyNode: whyNode,
snippet: extractSnippet(rawText || "", selectedNode) || bestFallbackInsight(selectedNode),
related: related,
notes: notes
};
}, [selectedNode, conns, responses, rawText, sd]);

// Map of theme label -> weight for connection strength scoring
const nodeWeightByKey = useMemo(() => {
var m = {};
nodes.forEach(function(n) { m[n.key] = (sd && sd.themes ? (sd.themes.find(function(t){return t.label===n.key;}) || {}).weight : null) || 1; });
return m;
}, [nodes, sd]);

function strengthScore(c) {
var wa = nodeWeightByKey[c.from] || 1;
var wb = nodeWeightByKey[c.to] || 1;
var baseScore = (wa + wb) / 2;
var k = c.from + "::" + c.to;
var r = responses && responses[k];
var bonus = 0;
if (r) {
if (r.value === "yes") bonus += 3;
else if (r.value === "partly") bonus += 1.5;
else if (r.value === "no") bonus += 0.5;
if (r.comment && r.comment.trim()) bonus += 1;
if (r.correction && r.correction.trim()) bonus += 1;
}
if (c.userDiscovered || c.discovered) bonus += 2;
var v = c.voltage != null ? (parseFloat(c.voltage) || 0) : 0;
if (v) bonus += v;
return baseScore + bonus;
}

const [pos, setPos] = useState({});
const prevNodeCount = useRef(0);
useEffect(function() {
if (nodes.length !== prevNodeCount.current) {
prevNodeCount.current = nodes.length;
setPos({}); 
}
}, [nodes.length]);
const [fieldSize, setFieldSize] = useState(null);
const fieldRef = useRef(null);
const NR = 50;

useLayoutEffect(() => {
var attempts = 0;
var rafId = null;
var tryMeasure = function() {
var el = fieldRef.current;
if (!el) { if (attempts++ < 20) rafId = requestAnimationFrame(tryMeasure); return; }
var w = el.offsetWidth, h = el.offsetHeight;
if (w > 50 && h > 50) {
setFieldSize({ w: w, h: h }); fieldRef._fieldSizeSet = true;
return;
}
var r = el.getBoundingClientRect();
if (r.width > 50 && r.height > 50) {
setFieldSize({ w: r.width, h: r.height }); fieldRef._fieldSizeSet = true;
} else if (attempts++ < 20) {
rafId = requestAnimationFrame(tryMeasure);
}
};
rafId = requestAnimationFrame(tryMeasure);

return function() { if (rafId) cancelAnimationFrame(rafId); };
}, []);

useLayoutEffect(() => {
if (nodes.length === 0 || !fieldSize) return;
if (fieldSize.w < 50 || fieldSize.h < 50) return; 
if (Object.keys(pos).length >= nodes.length) return; 
var n = nodes.length;
var W = fieldSize.w;
var H = fieldSize.h;
var cx = W / 2;
var cy = H / 2;
var NODE_W = 120; 
var NODE_H = 40; 
var PAD_X = NODE_W / 2 + 10;
var PAD_Y = NODE_H / 2 + 10;

var adj = {};
nodes.forEach(function(_, i) { adj[i] = []; });
var edges = [];
var allConns = (sd && sd.connections) ? sd.connections : [];
allConns.forEach(function(c) {
var ai = -1, bi = -1;
nodes.forEach(function(nd, i) {
if (nd.key === c.from) ai = i;
if (nd.key === c.to) bi = i;
});
if (ai >= 0 && bi >= 0 && ai !== bi) {
edges.push([ai, bi]);
adj[ai].push(bi);
adj[bi].push(ai);
}
});

var degree = nodes.map(function(_, i) { return adj[i].length; });
var maxDegree = Math.max.apply(null, degree.concat([1]));

var order = [];
var seen = {};
function visit(i) {
if (seen[i]) return;
seen[i] = true;
order.push(i);
(adj[i] || []).forEach(visit);
}
for (var i = 0; i < n; i++) { if (order.length >= n) break; visit(i); }
for (var i = 0; i < n; i++) { if (order.indexOf(i) < 0) order.push(i); }
var invOrder = order.map(function(_, i) { return order.indexOf(i); });

var positions = nodes.map(function(nd, i) {
var idx = invOrder[i];
var angle = (idx / n) * 2 * Math.PI - Math.PI / 2;
var radius = Math.min(W, H) * 0.32;
var jitter = function() { return (Math.random() - 0.5) * 12; };
return {
x: cx + Math.cos(angle) * radius + jitter() - NODE_W / 2,
y: cy + Math.sin(angle) * radius + jitter() - NODE_H / 2,
vx: 0, vy: 0
};
});

var IDEAL_EDGE_LEN = Math.min(W, H) * 0.38;
var K_ATTRACT = 0.022;
var K_REPEL = 32000;
var K_CENTER = 0.006; 
var K_DAMP = 0.72;
var MARGIN_X = PAD_X + 20;
var MARGIN_Y = PAD_Y + 20;

var STEPS = 250;
for (var step = 0; step < STEPS; step++) {
var cooling = 1 - (step / STEPS) * 0.85;

var fx = new Array(n).fill(0);
var fy = new Array(n).fill(0);

for (var a = 0; a < n; a++) {
for (var b = a + 1; b < n; b++) {
var dx = positions[b].x - positions[a].x;
var dy = positions[b].y - positions[a].y;
var dist2 = dx * dx + dy * dy;
var dist = Math.sqrt(dist2) || 0.1;
var force = K_REPEL / dist2 * (dist < 140 ? 3 : 1);
var ux = dx / dist, uy = dy / dist;
fx[a] -= ux * force;
fy[a] -= uy * force;
fx[b] += ux * force;
fy[b] += uy * force;
}
}

for (var ei = 0; ei < edges.length; ei++) {
var a = edges[ei][0], b = edges[ei][1];
var dx = positions[b].x - positions[a].x;
var dy = positions[b].y - positions[a].y;
var dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
var stretch = dist - IDEAL_EDGE_LEN;
var force = K_ATTRACT * stretch;
var ux = dx / dist, uy = dy / dist;
fx[a] += ux * force;
fy[a] += uy * force;
fx[b] -= ux * force;
fy[b] -= uy * force;
}

for (var ii = 0; ii < n; ii++) {
fx[ii] += (cx - (positions[ii].x + NODE_W / 2)) * K_CENTER;
fy[ii] += (cy - (positions[ii].y + NODE_H / 2)) * K_CENTER;
}

for (var ii = 0; ii < n; ii++) {
positions[ii].vx = (positions[ii].vx + fx[ii]) * K_DAMP;
positions[ii].vy = (positions[ii].vy + fy[ii]) * K_DAMP;
positions[ii].x += positions[ii].vx * cooling;
positions[ii].y += positions[ii].vy * cooling;
positions[ii].x = Math.max(MARGIN_X, Math.min(W - MARGIN_X - NODE_W, positions[ii].x));
positions[ii].y = Math.max(MARGIN_Y, Math.min(H - MARGIN_Y - NODE_H, positions[ii].y));
}
}


for (var pass = 0; pass < 40; pass++) {
var moved = false;
for (var a = 0; a < n; a++) {
for (var b = a + 1; b < n; b++) {
var dx = positions[b].x - positions[a].x;
var dy = positions[b].y - positions[a].y;
var minSepX = NODE_W + 48;
var minSepY = NODE_H + 36;
var overlapX = minSepX - Math.abs(dx);
var overlapY = minSepY - Math.abs(dy);
if (overlapX > 0 && overlapY > 0) {
moved = true;
if (overlapX < overlapY) {
var shift = overlapX / 2 + 2;
if (dx >= 0) { positions[a].x -= shift; positions[b].x += shift; }
else { positions[a].x += shift; positions[b].x -= shift; }
} else {
var shift = overlapY / 2 + 2;
if (dy >= 0) { positions[a].y -= shift; positions[b].y += shift; }
else { positions[a].y += shift; positions[b].y -= shift; }
}
positions[a].x = Math.max(MARGIN_X, Math.min(W - MARGIN_X - NODE_W, positions[a].x));
positions[a].y = Math.max(MARGIN_Y, Math.min(H - MARGIN_Y - NODE_H, positions[a].y));
positions[b].x = Math.max(MARGIN_X, Math.min(W - MARGIN_X - NODE_W, positions[b].x));
positions[b].y = Math.max(MARGIN_Y, Math.min(H - MARGIN_Y - NODE_H, positions[b].y));
}
}
}
if (!moved) break;
}

var result = {};
nodes.forEach(function(nd, i) {
result[nd.key] = { x: positions[i].x, y: positions[i].y };
});
setPos(result);
}, [nodes, fieldSize]);

var hasConn = function(a,b){ return conns.some(function(c){ return (c.from===a&&c.to===b)||(c.from===b&&c.to===a); }); };
var hasDiscovered = function(a,b){ return discoveredConns.some(function(c){ return (c.from===a&&c.to===b)||(c.from===b&&c.to===a); }); };
var anyConn = function(a,b){ return hasConn(a,b) || hasDiscovered(a,b); };
var getDiscovered = function(a,b){ return discoveredConns.find(function(c){ return (c.from===a&&c.to===b)||(c.from===b&&c.to===a); }); };

const makeConn = async (a, b) => {
var nodeB = nodes.find(function(n) { return n.key === b; });
var col = nodeB ? nodeB.color : "#7DB7AE";
var temp = { from: a, to: b, label: "READING…", insight: "…", color: col, discovered: true };
setDiscoveredConns(function(prev) { return prev.concat([temp]); });
var ctx = rawText ? "\nContext: " + rawText.slice(0, 400) : "";
var p = "The user connected two themes on their map: \"" + a + "\" and \"" + b + "\"." + ctx + "\nGenerate a 2-4 word label and 1-2 sentence insight. JSON only: {\"label\":\"...\",\"insight\":\"...\"}";
try {
var raw = await callClaudeClient(p, "Themes: " + a + " + " + b, 300);
var d = parseJSON(raw);
if (d && d.label) {
var real = { from: a, to: b, label: d.label.toUpperCase(), insight: d.insight || "", color: col, discovered: true };
setDiscoveredConns(function(prev) { return prev.map(function(c) { return (c.from===a && c.to===b) ? real : c; }); });
return;
}
} catch (e) {}
var fb = { from: a, to: b, label: "LINKED", insight: a + " and " + b + " — you see a relationship here. What does one reveal about the other?", color: col, discovered: true };
setDiscoveredConns(function(prev) { return prev.map(function(c) { return (c.from===a && c.to===b) ? fb : c; }); });
setTimeout(function() { setActiveConn(fb); }, 900);
};

const makeConnFromText = async (text) => {
var t = String(text || "").trim();
if (!t || !nodes.length) return;
setMapInputBusy(true);
var themeList = nodes.map(function(n){ return n.key; }).join(", ");
var ctx = rawText ? "\nContext from their share: " + rawText.slice(0, 300) : "";
var p = "The user typed on their map: \"" + t + "\"\nTheir themes are: " + themeList + ctx + "\nSummarize what they're really saying. If it suggests 1-2 connections between existing themes, return them. JSON: {\"edges\":[{\"from\":\"exact theme label\",\"to\":\"exact theme label\",\"label\":\"2-6 word label\",\"insight\":\"1-2 sentence insight\"}]}\nIf no clear connection to existing themes, return {\"edges\":[]}. Use only theme labels that exist in the list."
try {
var raw = await callClaudeClient(p, "Map typing: " + t.slice(0, 80), 400);
var d = parseJSON(raw);
if (d && d.edges && Array.isArray(d.edges)) {
  var added = [];
  var themeKeys = nodes.map(function(n){ return n.key; });
  d.edges.forEach(function(e) {
    if (e.from && e.to && e.from !== e.to) {
      var fa = themeKeys.find(function(k){ return k.toLowerCase()===String(e.from).trim().toLowerCase(); }) || (themeKeys.includes(e.from) ? e.from : null);
      var ta = themeKeys.find(function(k){ return k.toLowerCase()===String(e.to).trim().toLowerCase(); }) || (themeKeys.includes(e.to) ? e.to : null);
      if (fa && ta && !anyConn(fa, ta)) {
        var col = nodes.find(function(n){ return n.key === ta; })?.color || "#7DB7AE";
        var conn = { from: fa, to: ta, label: (e.label || "LINKED").toUpperCase(), insight: e.insight || "", color: col, discovered: true };
        setDiscoveredConns(function(prev) { return prev.concat([conn]); });
        added.push(conn);
      }
    }
  });
  if (added.length > 0) { setMapInputText(""); setMapInputOpen(false); setTimeout(function(){ setActiveConn(added[0]); }, 400); }
}
} catch (e) {}
setMapInputBusy(false);
};

var handleNodeTap = function(key) {
if (dragging) return;
if (!selectedNode) { setSelectedNode(key); return; }
if (selectedNode === key) { setSelectedNode(null); return; }
const a = selectedNode, b = key;
if (hasConn(a, b)) {
const c = conns.find(c => (c.from===a&&c.to===b)||(c.from===b&&c.to===a));
if (c) setActiveConn(c);
setSelectedNode(null);
return;
}
if (!anyConn(a, b)) makeConn(a, b);
setSelectedNode(null);
};
var posReady = fieldSize && Object.keys(pos).length >= nodes.length;
var ctr = function(key) { var p=pos[key]; if(p) return { x: p.x+60, y: p.y+20 }; var fs=fieldSize; return fs ? {x:fs.w/2, y:fs.h/2} : {x:200,y:200}; };
var mid = function(c) { var a=ctr(c.from),b=ctr(c.to); return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; };
var edgePt = function(from, to) { var a=ctr(from),b=ctr(to); var dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1; const r=40; return { x1: a.x+(dx/d)*r, y1: a.y+(dy/d)*r, x2: b.x-(dx/d)*r, y2: b.y-(dy/d)*r }; };
const allConns = [...conns, ...discoveredConns];
var K = function(c) { return c.from+"::"+c.to; };
const explored = Object.keys(responses).length + discoveredConns.length;
const didDrag = useRef(false);
const snapRef = useRef(null); 
var startDrag = function(key, e) { e.stopPropagation(); e.preventDefault(); didDrag.current = false; snapRef.current = null; const r=fieldRef.current?.getBoundingClientRect(); if(!r)return; var _pi2=nodes.findIndex(function(nd){return nd.key===key;}); var _fbc2=nodes.length; var _fbr2=90; var _fpx=fieldSize?(fieldSize.w/2-55+Math.cos(2*Math.PI*_pi2/_fbc2)*_fbr2):100; var _fpy=fieldSize?(fieldSize.h/2-18+Math.sin(2*Math.PI*_pi2/_fbc2)*_fbr2):100; const p=pos[key]||{x:_fpx,y:_fpy}; setDragging({key,ox:(e.clientX||e.touches&&e.touches[0]&&e.touches[0].clientX)-r.left-p.x,oy:(e.clientY||e.touches&&e.touches[0]&&e.touches[0].clientY)-r.top-p.y}); };
useEffect(() => {
if(!dragging) return;
const m = e => {
didDrag.current = true;
const r = fieldRef.current?.getBoundingClientRect(); if(!r) return;
const cx = (e.clientX||e.touches?.[0]?.clientX) - r.left - dragging.ox;
const cy = (e.clientY||e.touches?.[0]?.clientY) - r.top - dragging.oy;
const newX = Math.max(0, Math.min(cx, r.width - 120));
const newY = Math.max(0, Math.min(cy, r.height - 40));
setPos(p => ({...p, [dragging.key]: {x: newX, y: newY}}));
const dragCtr = { x: newX + 50, y: newY + 18 };
let closest = null, closeDist = Infinity;
nodes.forEach(n => {
if (n.key === dragging.key) return;
const np = pos[n.key]; if(!np) return;
const nc = { x: np.x + 60, y: np.y + 20 };
const dist = Math.hypot(nc.x - dragCtr.x, nc.y - dragCtr.y);
if (dist < SNAP_DIST && dist < closeDist && !anyConn(dragging.key, n.key)) {
closeDist = dist; closest = n.key;
}
});
snapRef.current = closest;
setSnapTarget(closest);
};
var u = function() {
if (!didDrag.current) {
handleNodeTap(dragging.key);
} else if (snapRef.current) {
var sa = dragging.key, sb = snapRef.current;
if (!anyConn(sa, sb)) makeConn(sa, sb);
var MIN_CONN_DIST = 200;
setPos(function(prev) {
var pa = prev[sa], pb = prev[sb];
if (!pa || !pb) return prev;
var cax = pa.x + 60, cay = pa.y + 20;
var cbx = pb.x + 60, cby = pb.y + 20;
var dx = cbx - cax, dy = cby - cay;
var dist = Math.sqrt(dx*dx + dy*dy) || 1;
if (dist >= MIN_CONN_DIST) return prev;
var need = (MIN_CONN_DIST - dist) / 2;
var ux = dx/dist, uy = dy/dist;
var next = Object.assign({}, prev);
next[sa] = { x: pa.x - ux*need, y: pa.y - uy*need };
next[sb] = { x: pb.x + ux*need, y: pb.y + uy*need };
return next;
});
}
setDragging(null);
setSnapTarget(null);
snapRef.current = null;
};
window.addEventListener("pointermove", m);
window.addEventListener("pointerup", u);
return () => { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); };
}, [dragging, selectedNode]);

return (
<div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column", padding: "22px 0 0", overflow: "hidden",
background: "linear-gradient(180deg, #060810 0%, #080c18 25%, #0a0e1c 50%, #070a14 100%)" }}>
<div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 100% 80% at 50% 30%, rgba(80,60,140,0.06) 0%, transparent 55%)", pointerEvents: "none", zIndex: 0 }}/>
<div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 50% at 80% 70%, rgba(107,184,255,0.04) 0%, transparent 60%)", pointerEvents: "none", zIndex: 0 }}/>
<Particles color="rgba(107,184,255,0.25)" count={14}/>
<div style={{ textAlign: "center", zIndex: 2, marginBottom: 0, flexShrink: 0, padding: "0 16px", height: 56 }}>
<div style={{ fontSize: 12, letterSpacing: "0.35em", color: "rgba(255,255,255,0.5)", fontFamily: FB, textTransform: "uppercase", marginBottom: 4 }}>Your constellation</div>
<div style={{ fontSize: 16, fontWeight: 500, color: "#F7F5F0", fontFamily: FD, letterSpacing: "0.03em" }}>
What’s pulling you right now
</div>
{sd && sd.tension && sd.tension.a && sd.tension.b && (
<div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 999, background: "rgba(10,30,60,0.7)", border: "1px solid rgba(123,183,255,0.5)", fontSize: 12, fontFamily: FB, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(205,227,255,0.96)" }}>
{sd.tension.a} &nbsp;↔&nbsp; {sd.tension.b}
</div>
)}
<p style={{ fontSize: 13, color: snapTarget?"#7DB7AE":selectedNode?"#6BFFB8":explored===0?"rgba(178,216,255,0.95)":"rgba(255,255,255,0.55)", fontFamily: FB, margin: "6px 0 0", fontWeight: 500, transition: "color 0.3s" }}>
{snapTarget
  ? `Release to connect → ${snapTarget}`
  : selectedNode
    ? `${selectedNode} · tap another to link`
    : explored===0
      ? "Drag the circles · connect what feels related"
      : `${explored} connections explored`}
</p>
{(()=>{ var growthCount = allConns.filter(function(c){ var r=responses[K(c)]; return r&&(r.value==="partly"||r.value==="no"); }).length; return growthCount>0 ? (
<div style={{ marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", gap:12, flexWrap:"wrap" }}>
<span style={{ fontSize:12, letterSpacing:"0.2em", color:"rgba(165,235,220,0.8)", fontFamily:FB }}>● partly</span>
<span style={{ fontSize:12, letterSpacing:"0.2em", color:"rgba(214,178,100,0.8)", fontFamily:FB }}>● resisted</span>
<span style={{ fontSize:11, letterSpacing:"0.15em", color:"rgba(255,255,255,0.45)", fontFamily:FB }}>— growth edges</span>
</div>
) : null; })()}
</div>
<div ref={fieldRef} onClick={function(){setActiveConn(null);setSelectedNode(null);}} style={{ flex: 1, position: "relative", zIndex: 1, minHeight: 0, overflow: "hidden", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.15), inset 0 0 80px rgba(0,0,0,0.08)" }}>
<div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)", pointerEvents: "none", zIndex: 2 }}/>
<div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(40,50,90,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }}/>
<div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 55% at 50% 50%, transparent 50%, rgba(0,0,0,0.35) 100%)", pointerEvents: "none", zIndex: 1 }}/>
<div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 0%, transparent 60%, rgba(0,0,0,0.15) 100%)", pointerEvents: "none", zIndex: 1 }}/>
<><svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }}>
{posReady && allConns.map(function(c) {
var k=K(c), resp=responses[k], ep=edgePt(c.from,c.to);
var _sva=pos[c.from],_svb=pos[c.to];
if(!_sva||!_svb)return null;
{var _svdx=(_svb.x+60)-(_sva.x+60),_svdy=(_svb.y+20)-(_sva.y+20);if(Math.sqrt(_svdx*_svdx+_svdy*_svdy)<90)return null;}
const isAct = activeConn && K(activeConn)===k;
let stroke="rgba(255,255,255,0.18)", sw=2, dash="8 5", op=1, glowStroke="rgba(255,255,255,0.06)";
if(resp?.value==="yes"){stroke="rgba(107,211,198,0.72)";sw=3;dash="none";glowStroke="rgba(107,211,198,0.15)";}
else if(resp?.value==="partly"){stroke="rgba(165,235,220,0.5)";sw=2.5;dash="none";glowStroke="rgba(165,235,220,0.12)";}
else if(resp?.value==="no"){
var hasWord=resp.comment&&resp.comment.trim().length>0;
stroke=hasWord?"rgba(214,178,100,0.75)":"rgba(214,178,100,0.35)";
sw=hasWord?2.5:1.5; dash="5 4";glowStroke="rgba(214,178,100,0.08)";
}
if(isAct){stroke=`${c.color}88`;sw=3;dash="none"; op=1;glowStroke=c.color+"22";}
var flowStroke = resp?.value==="yes" ? "rgba(107,211,198,0.55)" : resp?.value==="partly" ? "rgba(165,235,220,0.4)" : "rgba(255,255,255,0.06)";
return <g key={k}><line x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2} stroke={glowStroke} strokeWidth={sw+6} strokeLinecap="round" strokeDasharray={dash} opacity={0.8} style={{transition:"all 0.6s ease"}}/><line x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} opacity={op} style={{transition:"all 0.6s ease"}}/><line x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2} stroke={flowStroke} strokeWidth={resp?.value==="yes"||resp?.value==="partly"?1.8:1} strokeLinecap="round" strokeDasharray="6 18" style={{animation:"flowLine "+(resp?.value==="yes"||resp?.value==="partly"?"2.2":"4")+"s linear infinite"}}/></g>;
})}
{selectedNode && (() => {
const sc = ctr(selectedNode);
return <circle cx={sc.x} cy={sc.y} r={48} fill="none" stroke="#6BFFB8" strokeWidth="1.5" opacity="0.5" strokeDasharray="4 4">
<animate attributeName="r" values="46;52;46" dur="1.5s" repeatCount="indefinite" />
<animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite" />
</circle>;
})()}
{snapTarget && dragging && (() => {
const ep = edgePt(dragging.key, snapTarget);
return <line x1={ep.x1} y1={ep.y1} x2={ep.x2} y2={ep.y2} stroke="#7DB7AE" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.7" style={{animation:"connBlink 1s ease-in-out infinite"}}/>;
})()}
</svg>
{allConns.map(c => {
const m=mid(c), k=K(c), resp=responses[k];
const isAct = activeConn && K(activeConn)===k;
var isUserDefined = resp && resp.value==="no" && resp.comment && resp.comment.trim();
var isExp = !!resp; var accent = isUserDefined ? "#D6B264" : c.color;
var _lpa=pos[c.from],_lpb=pos[c.to];
if(!_lpa||!_lpb)return null;
{var _ldx=(_lpb.x+60)-(_lpa.x+60),_ldy=(_lpb.y+20)-(_lpa.y+20);if(Math.sqrt(_ldx*_ldx+_ldy*_ldy)<90)return null;}
return (
<div key={k} onClick={function(e){e.stopPropagation();setActiveConn(c);}} style={{
position: "absolute", left: m.x, top: m.y, transform: "translate(-50%, -50%)",
padding: "6px 12px", borderRadius: 8, fontSize: 9, fontWeight: 700, fontFamily: FB,
letterSpacing: "0.06em", textTransform: "uppercase",
color: isAct?"white":isUserDefined?"#D6B264":isExp?accent+"cc":accent,
background: isAct?accent+"33":isUserDefined?"rgba(40,30,10,0.9)":"rgba(8,10,20,0.85)",
border:"1.5px solid "+(isAct?accent:isUserDefined?"rgba(214,178,100,0.5)":isExp?accent+"44":accent+"66"),
cursor: "pointer", whiteSpace: "normal", maxWidth: 160, textAlign: "center", lineHeight: 1.25,
zIndex: isAct ? 15 : 5,
transition: "all 0.3s ease",
animation: !isExp ? "connBlink 2s ease-in-out infinite" : "none",
boxShadow: isAct ? `0 4px 16px rgba(0,0,0,0.35), 0 0 20px ${accent}33` : !isExp ? `0 4px 12px rgba(0,0,0,0.3), 0 0 12px ${accent}15` : "0 4px 12px rgba(0,0,0,0.25)",
}}>
{!isExp && <div style={{ position:"absolute", inset:-5, borderRadius:10, border:"1px solid "+accent+"44", animation:"ringPulse 2s ease-in-out infinite", pointerEvents:"none" }}/>}
{isUserDefined
? <span title={"you: "+resp.comment}>{resp.comment.trim()}</span>
: c.label
}
</div>
);
})}
{allConns.map(c => {
const m=mid(c), k=K(c), resp=responses[k];
if(!resp?.correction) return null;
return <div key={"a-"+k} style={{ position:"absolute",left:m.x,top:m.y+16,transform:"translate(-50%,0)",fontSize:10,fontFamily:FD,fontStyle:"italic",color:"rgba(165,235,220,0.65)",maxWidth:140,textAlign:"center",lineHeight:1.3,animation:"riseUp 0.5s ease" }}>"{resp.correction.length>45?resp.correction.slice(0,43)+"…":resp.correction}"</div>;
})}
{nodes.map((n, ni) => {
var _pi=nodes.indexOf(n); var _fbc=nodes.length; var _fbr=90; var p=pos[n.key]||{x:fieldSize?(fieldSize.w/2-55+Math.cos(2*Math.PI*_pi/_fbc)*_fbr):100, y:fieldSize?(fieldSize.h/2-18+Math.sin(2*Math.PI*_pi/_fbc)*_fbr):100}; const isDrag=dragging&&dragging.key===n.key;
const isSel = selectedNode === n.key;
const isSnap = snapTarget === n.key;
const canLink = selectedNode && selectedNode !== n.key && !hasConn(selectedNode, n.key) && !hasDiscovered(selectedNode, n.key);
var domainColors = { work: "#6BB8FF", relationship: "#E84393", self: "#6BFFB8", creativity: "#FFB86B", money: "#B86BFF", life: "rgba(255,255,255,0.2)" };
return (
<div key={n.key}
title={n.shortDesc ? String(n.shortDesc).trim() : ""}
onPointerDown={function(e){startDrag(n.key,e);}}
style={{
position: "absolute", left: p.x, top: p.y,
borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
fontSize: (function(){
var l = String(n.display || n.key || "").trim().length;
return l <= 10 ? 12 : l <= 14 ? 11 : l <= 18 ? 10 : 9;
})(),
fontWeight: 700, fontFamily: FB, color: "white",
textAlign: "center", lineHeight: 1.2,
padding: "10px 18px",
textTransform: "uppercase", letterSpacing: "0.06em",
whiteSpace: "nowrap", maxWidth: 140,
background: isSnap
? "rgba(125,183,174,0.18)"
: n.w > 0.7 ? `rgba(214,178,109,0.25)` : "rgba(244,241,234,0.12)",
border: isSnap ? "1.5px solid rgba(125,183,174,0.7)"
: isSel ? "1.5px solid #6BFFB8"
: canLink ? `1.5px solid ${n.color}aa`
: n.w > 0.7 ? "1.5px solid rgba(214,178,109,0.45)"
: `1.5px solid rgba(244,241,234,0.22)`,
backdropFilter: "blur(12px)",
WebkitBackdropFilter: "blur(12px)",
cursor: isDrag?"grabbing":"pointer", zIndex: isDrag?20: isSel||isSnap?10 :3,
transition: isDrag?"none":"all 0.4s cubic-bezier(.25,.46,.45,.94)",
transform: isDrag?"scale(1.12)": isSnap?"scale(1.15)": isSel?"scale(1.08)" :"scale(1)",
boxShadow: isSnap
? "inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 24px rgba(0,0,0,0.4), 0 0 28px rgba(125,183,174,0.5), 0 0 12px rgba(125,183,174,0.25)"
: isSel
? "inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 24px rgba(0,0,0,0.4), 0 0 28px rgba(107,255,184,0.35), 0 0 10px rgba(107,255,184,0.2)"
: `inset 0 1px 0 rgba(255,255,255,0.1), 0 6px 20px rgba(0,0,0,0.35), 0 0 ${isDrag?32:20}px ${n.color}${isDrag?"66":"35"}, 0 0 8px ${n.color}22`,
touchAction: "none", userSelect: "none",
animation: isDrag||isSel||isSnap ? "none" : "nodeBreathe 8s ease-in-out infinite",
animationDelay: `${ni*-1.5}s`,
overflow: "hidden",
textOverflow: "ellipsis",
}}>
<div style={{ position:"relative" }}>
{n.display || n.key}
{n.domain && n.domain !== "life" && <div style={{ position:"absolute", bottom:2, right:2, width:5, height:5, borderRadius:3, background:domainColors[n.domain]||domainColors.life, opacity:0.85 }} title={n.domain}/>}
</div>
</div>
);
})}

{selectedDetail && !activeConn && (
<div onClick={function(e){e.stopPropagation();}} style={{
position:"absolute", left:16, right:16, bottom:14,
zIndex:30,
background:"rgba(8,10,20,0.9)",
border:"1px solid rgba(255,255,255,0.12)",
borderRadius:14,
padding:"12px 14px",
backdropFilter:"blur(10px)",
boxShadow:"0 12px 40px rgba(0,0,0,0.35)"
}}>
<div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
<div style={{ minWidth:0 }}>
<div style={{ fontSize:10, letterSpacing:"0.18em", color:"rgba(255,255,255,0.35)", fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>Selected</div>
<div style={{ fontSize:18, color:"rgba(255,255,255,0.9)", fontFamily:FB, fontWeight:800, letterSpacing:"0.04em", textTransform:"uppercase", lineHeight:1.15, wordBreak:"break-word" }}>
{selectedDetail.label}
</div>
</div>
<button onClick={function(){ setSelectedNode(null); }} style={{
fontSize:12, color:"rgba(255,255,255,0.4)", fontFamily:FB,
background:"transparent", border:"1px solid rgba(255,255,255,0.12)",
borderRadius:12, padding:"6px 10px", cursor:"pointer", flexShrink:0
}}>close</button>
</div>

{selectedDetail.whyNode && (
<div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.08)" }}>
<div style={{ fontSize:10, letterSpacing:"0.18em", color:"rgba(107,184,255,0.85)", fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>Where this came from</div>
<div style={{ fontSize:14, color:"rgba(255,255,255,0.82)", fontFamily:FD, fontStyle:"italic", lineHeight:1.55 }}>
{selectedDetail.whyNode}
</div>
</div>
)}

{selectedDetail.notes && selectedDetail.notes.length > 0 && (
<div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.08)" }}>
<div style={{ fontSize:10, letterSpacing:"0.18em", color:"rgba(255,255,255,0.28)", fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>Your notes</div>
<div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:120, overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
{selectedDetail.notes.slice(0,4).map(function(n) {
var tone = n.value === "yes" ? "rgba(107,255,184,0.85)" : n.value === "partly" ? "rgba(165,235,220,0.75)" : "rgba(214,178,100,0.85)";
return (
<div key={n.k} style={{ fontSize:13, color:"rgba(255,255,255,0.62)", fontFamily:FD, lineHeight:1.45 }}>
<span style={{ fontFamily:FB, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:tone }}>{n.other}</span>
<span style={{ color:"rgba(255,255,255,0.35)" }}> — </span>
{n.comment}
</div>
);
})}
</div>
</div>
)}

{selectedDetail.related && selectedDetail.related.length > 0 && (
<div style={{ marginTop:10, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.08)" }}>
<div style={{ fontSize:10, letterSpacing:"0.18em", color:"rgba(255,255,255,0.28)", fontFamily:FB, textTransform:"uppercase", marginBottom:8 }}>Links</div>
<div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
{selectedDetail.related.slice(0,8).map(function(c) {
var other = c.from === selectedDetail.label ? c.to : c.from;
return (
<div key={c.from+"::"+c.to} onClick={function(e){ e.stopPropagation(); setActiveConn(c); }} style={{
fontSize:10, fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase",
padding:"6px 10px", borderRadius:999,
border:"1px solid rgba(255,255,255,0.12)",
background:"rgba(255,255,255,0.03)",
color:"rgba(255,255,255,0.6)", cursor:"pointer"
}} title={"open link: "+other}>
{other}
</div>
);
})}
</div>
</div>
)}
</div>
)}
{activeConn && <InsightDrawer
connection={{nodeA:activeConn.from,nodeB:activeConn.to,label:activeConn.label,insight:activeConn.insight,color:activeConn.color,evidence_quote:activeConn.evidence_quote,whyFromShare:activeConn.whyFromShare,mechanism:activeConn.mechanism}}
position={mid(activeConn)}
initialResponse={responses[K(activeConn)]}
onClose={function(){setActiveConn(null);}}
onRespond={function(v,c,slider,cmt){
setResponses(function(prev){
var k=K(activeConn);var next=Object.assign({},prev);
next[k]={value:v,correction:c,slider:slider,comment:cmt||"",from:activeConn.from,to:activeConn.to,insight:activeConn.insight};
return next;
});
if (slider < 50 && cmt && cmt.trim() && onPatchSynthesis && activeConn) {
var uw = cmt.trim(), fn = activeConn.from, tn = activeConn.to;
onPatchSynthesis({connections:[{from:fn,to:tn,insight:uw,label:activeConn.label,userAuthored:true}]});
(async function(){
try{
var pr="User corrected an AI connection reading. Their words are PRIMARY — reflect them back, do not reinterpret.\n"
+"USER SAID the connection between ["+fn+"] and ["+tn+"] is: \""+uw+"\"\n"
+"Write ONE sentence (max 18 words) that mirrors their words as the connection insight. JSON: {\"insight\":\"...\"}";
var rw=await callClaudeClient(pr,"Connection: "+fn+" + "+tn+"\nUser said: "+uw,150);
var dw=parseJSON(rw);
if(dw&&dw.insight) onPatchSynthesis({connections:[{from:fn,to:tn,insight:dw.insight,label:activeConn.label,userAuthored:true}]});
}catch(e){}
})();
}
}}
/>}
</>}
</div>
{mapInputOpen ? (
<div style={{ position:"absolute", bottom: 16, left: 16, right: 16, zIndex: 20, background: "rgba(10,15,25,0.96)", border: "1px solid rgba(107,184,255,0.35)", borderRadius: 16, padding: 14, backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
<div style={{ fontSize: 10, letterSpacing: "0.12em", color: "rgba(107,184,255,0.9)", fontFamily: FB, textTransform: "uppercase", marginBottom: 8 }}>Type to add a connection</div>
<textarea value={mapInputText} onChange={function(e){setMapInputText(e.target.value);}} placeholder="e.g. rest and proof feel like the same thing when I'm tired" 
style={{ width: "100%", minHeight: 56, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(107,184,255,0.25)", borderRadius: 10, color: "rgba(255,255,255,0.9)", fontFamily: FD, fontSize: 14, padding: "10px 12px", resize: "none", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }}
onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();makeConnFromText(mapInputText);}}}
/>
<div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, alignItems: "center" }}>
<button onClick={function(){setMapInputOpen(false);setMapInputText("");}} style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: FB, background: "transparent", border: "none", cursor: "pointer" }}>cancel</button>
<button onClick={function(){makeConnFromText(mapInputText);}} disabled={!mapInputText.trim()||mapInputBusy} style={{ fontSize: 12, fontFamily: FB, background: mapInputText.trim()&&!mapInputBusy ? "rgba(107,184,255,0.25)" : "rgba(255,255,255,0.06)", border: "1px solid rgba(107,184,255,0.4)", borderRadius: 8, padding: "6px 16px", color: "rgba(107,184,255,0.95)", cursor: mapInputText.trim()&&!mapInputBusy ? "pointer" : "not-allowed" }}>{mapInputBusy ? "reading…" : "add"}</button>
</div>
</div>
) : (
<button onClick={function(){setMapInputOpen(true);}} style={{ position:"absolute", bottom: explored>=1 ? "calc(72px + env(safe-area-inset-bottom, 0px))" : 16, right: 16, zIndex: 20, width: 44, height: 44, borderRadius: 999, background: "rgba(107,184,255,0.15)", border: "1px solid rgba(107,184,255,0.35)", color: "rgba(107,184,255,0.9)", fontSize: 20, cursor: "pointer", display: "grid", placeItems: "center", fontFamily: "system-ui", touchAction: "manipulation" }} title="Type to add connection">+</button>
)}
{explored>=1&&(
<div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420, padding: "12px 20px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", background: "linear-gradient(0deg, rgba(6,9,16,0.98) 0%, rgba(6,9,16,0.95) 90%, transparent)", borderTop: "1px solid rgba(107,184,255,0.15)", zIndex: 30, display: "flex", justifyContent: "center", alignItems: "center", boxSizing: "border-box" }}>
<button onClick={function(){var merged=Object.assign({},responses);discoveredConns.forEach(function(c){var k2=c.from+"::"+c.to;if(!merged[k2]) merged[k2]={value:"discovered",from:c.from,to:c.to,insight:c.insight||"",label:c.label||"",userDiscovered:true,comment:""};});onComplete(merged);}} style={{ width: "100%", maxWidth: 340, background: "linear-gradient(135deg, rgba(107,184,255,0.25), rgba(61,139,255,0.2))", border: "1px solid rgba(107,184,255,0.5)", borderRadius: 24, padding: "14px 28px", minHeight: 48, color: "rgba(255,255,255,0.95)", fontSize: 15, fontFamily: FB, fontWeight: 600, cursor: "pointer", letterSpacing: "0.06em", boxShadow: "0 4px 24px rgba(0,0,0,0.4)", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>continue →</button>
</div>
)}
</div>
);
}

const GUIDE_TYPES = {
act: { color: "#6BFFB8", icon: "→" },
sit: { color: "#6BB8FF", icon: "◎" },
deepen: { color: "#FFB86B", icon: "◇" },
release: { color: "#FF6B9D", icon: "↺" },
notice: { color: "#9FB2D8", icon: "◈" },
};

const GUIDE_ITEMS = [
{ type: "act", text: "Write down the one thing you'd build if money were irrelevant. Put it somewhere you'll see it tomorrow." },
{ type: "sit", text: "Sit with the question: when you say 'proof,' who are you proving it to? Don't answer. Just hold it." },
{ type: "deepen", text: "The word 'control' appeared 12 times. Ask yourself — what am I actually afraid of losing?" },
{ type: "release", text: "Name one expectation about SAYCRD you're ready to set down. You don't have to drop it — just set it down." },
{ type: "notice", text: "This week, notice when you use the word 'should.' Write down what you actually feel instead." },
];

function SpectrumSlider({ color, poleA, poleB, onSet, value }) {
var [p, setP] = useState(value != null ? value : 50);
var [d, setD] = useState(false);
var [confirmed, setConfirmed] = useState(value != null);
var tr = useRef(null);
function upd(e) {
var r = tr.current ? tr.current.getBoundingClientRect() : null;
if (!r) return;
var cx = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
setP(Math.max(0, Math.min(100, (cx - r.left) / r.width * 100)));
}
function hd(e) { e.preventDefault(); setD(true); upd(e); if (tr.current && e.pointerId != null) tr.current.setPointerCapture(e.pointerId); }
useEffect(function() {
if (!d) return;
function m(e) { upd(e); }
function u() { setD(false); onSet(Math.round(p)); setConfirmed(true); }
window.addEventListener("pointermove", m);
window.addEventListener("pointerup", u);
return function() { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); };
}, [d]);
function confirm() {
setConfirmed(true);
onSet(Math.round(p));
}
return <div>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
<span style={{ fontSize:13, color: p < 40 ? color : "rgba(255,255,255,0.35)", fontFamily:FB, fontWeight:500, transition:"color 0.3s" }}>{poleA}</span>
<span style={{ fontSize:13, color: p > 60 ? color : "rgba(255,255,255,0.35)", fontFamily:FB, fontWeight:500, transition:"color 0.3s" }}>{poleB}</span>
</div>
<div ref={tr} onPointerDown={hd} style={{ position:"relative", height:36, display:"flex", alignItems:"center", cursor:"pointer", touchAction:"none" }}>
<div style={{ position:"absolute", left:0, right:0, height:3, background:"rgba(255,255,255,0.06)", borderRadius:2 }} />
<div style={{ position:"absolute", left:0, height:3, width:p+"%", background:"linear-gradient(90deg,"+color+"33,"+color+"88)", borderRadius:2, transition:d?"none":"width 0.1s" }} />
<div style={{ position:"absolute", left:p+"%", transform:"translateX(-50%)",
width:confirmed?30:26, height:confirmed?30:26, borderRadius:"50%",
background: confirmed ? color+"66" : "rgba(255,255,255,0.1)",
border:"2px solid "+(confirmed ? color : "rgba(255,255,255,0.2)"),
cursor:d?"grabbing":"grab",
boxShadow: confirmed ? "0 0 18px "+color+"44" : "none",
transition:d?"none":"all 0.2s", zIndex:2 }} />
</div>
{!confirmed
? <div style={{ textAlign:"center", marginTop:14 }}>
<button onClick={confirm} style={{ fontSize:13, color:color, fontFamily:FB, fontWeight:600,
background:color+"18", border:"1px solid "+color+"44", borderRadius:20,
padding:"8px 28px", cursor:"pointer", letterSpacing:"0.08em", transition:"all 0.2s" }}>
confirm
</button>
</div>
: <div style={{ textAlign:"center", marginTop:10, fontSize:11, color:color+"88", fontFamily:FB, letterSpacing:"0.1em" }}>
✓ set — drag to adjust
</div>
}
</div>;
}

function GuideHoldSave({ color, onSave }) {
var [prog, setProg] = useState(0);
var [holding, setHolding] = useState(false);
var ref = useRef(null);
var startT = useRef(0);
function start(e) {
e.stopPropagation(); setHolding(true); startT.current = Date.now();
ref.current = setInterval(function() {
var p = Math.min((Date.now() - startT.current) / 900, 1);
setProg(p);
if (p >= 1) { clearInterval(ref.current); setHolding(false); setProg(0); onSave(); }
}, 30);
}
function end() { if (ref.current) clearInterval(ref.current); setHolding(false); setProg(0); }
return <div
onMouseDown={start} onMouseUp={end} onMouseLeave={end}
onTouchStart={start} onTouchEnd={end}
style={{ position: "relative", padding: "6px 18px", borderRadius: 20, background: color + (Math.round(8 + prog * 40)).toString(16).padStart(2, "0"), border: "1px solid " + color + "44", color: color, fontSize: 12, fontFamily: FB, cursor: "pointer", userSelect: "none", WebkitUserSelect: "none", overflow: "hidden" }}
>
<div style={{ position: "absolute", bottom: 0, left: 0, width: prog * 100 + "%", height: 2, background: color, transition: holding ? "none" : "width 0.2s" }} />
{holding ? "..." : "hold"}
</div>;
}

function GuideItem({ item, index, onPatchSynthesis, allGuide }) {
const [expanded, setExpanded] = useState(false);
const [response, setResponse] = useState("");
const [saved, setSaved] = useState(false);
const [echo, setEcho] = useState(null);
const gt = GUIDE_TYPES[item.type] || GUIDE_TYPES.act;
const submit = async () => {
if (!response.trim()) return;
setSaved(true);
var ur = response.trim();
try {
var p = "User responded to a guide suggestion. Their response is primary truth.\n"
+ "Do not praise. Do not validate. Mirror or sharpen. If they correct or reframe — honor the correction.\n"
+ "ONE sentence, max 25 words. JSON: {\"echo\":\"...\"}";
var raw = await callClaudeClient(p, "Suggestion: \""+item.text+"\"\nUser said: \""+ur+"\"", 180);
var d = parseJSON(raw);
var echoText = d && d.echo ? d.echo : null;
if (echoText) setEcho(echoText);
if (onPatchSynthesis && allGuide) {
var updatedGuide = allGuide.map(function(g) {
if (g.text === item.text && g.type === item.type) {
return Object.assign({}, g, { userResponse: ur, echo: echoText, userAuthored: true });
}
return g;
});
onPatchSynthesis({ guide: updatedGuide });
}
} catch (e) {}
};
return (
<div onClick={function(){ if(!expanded && !saved) setExpanded(true); }} style={{
padding: "16px 18px", borderRadius: 14, background: "rgba(16,20,26,0.8)",
border: `1px solid ${saved ? `${gt.color}33` : expanded ? `${gt.color}22` : "rgba(255,255,255,0.06)"}`,
cursor: expanded || saved ? "default" : "pointer", transition: "all 0.3s",
animation: `riseUp 0.5s ease ${0.1 + index * 0.15}s both`,
}}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
<span style={{ fontSize: 14, color: gt.color }}>{gt.icon}</span>
<span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: gt.color, fontFamily: FB }}>{item.type}</span>
{saved && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: FB, marginLeft: "auto" }}>responded</span>}
{!expanded && !saved && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", fontFamily: FB, marginLeft: "auto" }}>tap to respond</span>}
</div>
<p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", fontFamily: FD, fontStyle: "italic", lineHeight: 1.6, margin: 0 }}>{item.text}</p>
{expanded && !saved && (
<div style={{ marginTop: 14, animation: "riseUp 0.3s ease" }}>
<textarea value={response} onChange={function(e){ setResponse(e.target.value); }}
onKeyDown={function(e){ if (e.key === "Enter" && !e.shiftKey && response.trim()) { e.preventDefault(); submit(); } }}
placeholder="In your words…" rows={2} autoFocus
style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: `1px solid ${gt.color}33`, borderRadius: 10, color: "rgba(255,255,255,0.8)", padding: "10px 14px", fontFamily: FB, fontSize: 14, resize: "none", outline: "none", lineHeight: 1.5 }} />
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
<span style={{ fontSize: 11, color: "rgba(255,255,255,0.1)", fontFamily: FB }}>hold to save</span>
{response.trim() && <GuideHoldSave color={gt.color} onSave={submit} />}
</div>
</div>
)}
{saved && (
<div style={{ marginTop: 10 }}>
<div style={{ padding:"12px 14px", borderRadius:10,
background:gt.color+"0a", border:"1px solid "+gt.color+"25",
animation:"riseUp 0.4s ease" }}>
<div style={{ fontSize:9, letterSpacing:"0.18em", color:gt.color+"66",
fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>you said</div>
<p style={{ fontSize:15, color:"rgba(255,255,255,0.88)", fontFamily:FD,
fontStyle:"italic", margin:0, lineHeight:1.6 }}>{response}</p>
</div>
{echo && (
<div style={{ marginTop:8, paddingLeft:4, animation:"riseUp 0.5s ease 0.2s both" }}>
<p style={{ fontSize:13, color:gt.color+"66", fontFamily:FD,
fontStyle:"italic", lineHeight:1.6, margin:0 }}>{echo}</p>
</div>
)}
</div>
)}
</div>
);
}

function DescentGame({ cards: propCards, onDone }) {
const DESCENT_CARDS = (propCards && propCards.length > 0 ? propCards.slice(0, 4) : [
{ type: "energy", phrase: "wanting to be seen but not watched", color: "#FFB86B" },
{ type: "binary", prompt: "right now you're drawn to", option_a: "building slowly", option_b: "leaping first", color: "#FF6B9D" },
{ type: "spectrum", prompt: "where does this live?", pole_a: "still forming", pole_b: "ready to move", color: "#6BFFB8" },
{ type: "binary", prompt: "the tension feels more like", option_a: "two things pulling apart", option_b: "one thing trying to split", color: "#6BB8FF" },
]).map(function(c,i){return Object.assign({},c,{color:c.color||NC[i%NC.length]});});
const [ci, setCi] = useState(0);
const [answers, setAnswers] = useState({});
const [showCompletion, setShowCompletion] = useState(false);
const c = DESCENT_CARDS[ci], ans = answers[ci] !== undefined;
function record(v) {
var newAnswers = Object.assign({}, answers, {[ci]: v});
setAnswers(newAnswers);
if (ci < DESCENT_CARDS.length - 1) {
setTimeout(function(){ setCi(ci + 1); }, 1600);
} else {
setTimeout(function(){ setShowCompletion(true); }, 1200);
}
}
const allDone = Object.keys(answers).length >= DESCENT_CARDS.length;
useEffect(function() {
if (showCompletion) setTimeout(function(){ onDone({ answers: answers, cards: DESCENT_CARDS }); }, 3500);
}, [showCompletion]);

const [swipeX, setSwipeX] = useState(0);
const [swiping, setSwiping] = useState(false);
const swipeStart = useRef(0);
const swipeThreshold = 80;

function onTouchStart(e) { swipeStart.current = e.touches[0].clientX; setSwiping(true); setSwipeX(0); }
function onTouchMove(e) { if (!swiping) return; var dx = e.touches[0].clientX - swipeStart.current; setSwipeX(dx); }
function onTouchEnd() {
if (!swiping) return;
setSwiping(false);
if (swipeX < -swipeThreshold) { record("a"); }
else if (swipeX > swipeThreshold) { record("b"); }
setSwipeX(0);
}
function onMouseDown(e) { swipeStart.current = e.clientX; setSwiping(true); setSwipeX(0); }
function onMouseMove(e) { if (!swiping) return; setSwipeX(e.clientX - swipeStart.current); }
function onMouseUp() { onTouchEnd(); }

useEffect(function() {
setSwipeX(0); setSwiping(false); setHoldProg(0); setEnergyHolding(false);
}, [ci]);

useEffect(function() {
if (!swiping) return;
function m(e) { var cx = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : swipeStart.current); setSwipeX(cx - swipeStart.current); }
function u() { onTouchEnd(); }
window.addEventListener("pointermove", m);
window.addEventListener("pointerup", u);
return function() { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); };
}, [swiping]);

const [holdProg, setHoldProg] = useState(0);
const [energyHolding, setEnergyHolding] = useState(false);
const holdRef = useRef(null);
const holdStartT = useRef(0);

function startEnergyHold(e) {
if (ans) return;
e.stopPropagation();
setEnergyHolding(true);
holdStartT.current = Date.now();
holdRef.current = setInterval(function() {
var p = Math.min((Date.now() - holdStartT.current) / 1800, 1);
setHoldProg(p);
if (p >= 1) { clearInterval(holdRef.current); setEnergyHolding(false); record(5); }
}, 30);
}
function endEnergyHold() {
if (holdRef.current) clearInterval(holdRef.current);
if (energyHolding) {
setEnergyHolding(false);
if (holdProg >= 1) return;
if (holdProg > 0.08) {
var val = Math.max(1, Math.ceil(holdProg * 5));
record(val);
}
setHoldProg(0);
}
}

useEffect(function() {
if (!energyHolding) return;
function u() { endEnergyHold(); }
window.addEventListener("pointerup", u);
window.addEventListener("touchend", u);
return function() { window.removeEventListener("pointerup", u); window.removeEventListener("touchend", u); };
}, [energyHolding]);

var swipeRatio = Math.min(Math.abs(swipeX) / swipeThreshold, 1);
var swipeDir = swipeX < 0 ? "a" : swipeX > 0 ? "b" : null;

return (
<div style={{ padding: "20px 0" }}>
{showCompletion && <div style={{ textAlign: "center", padding: "28px 0", animation: "riseUp 0.6s ease" }}>
<div style={{ fontSize: 32, marginBottom: 16 }}>◆</div>
<div style={{ fontSize: 18, color: "rgba(214,178,109,0.85)", fontFamily: FD, fontStyle: "italic", lineHeight: 1.5, marginBottom: 12 }}>Descent complete.</div>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontFamily: FB, letterSpacing: "0.1em" }}>
{Object.keys(answers).length} questions, {Object.keys(answers).length} honest answers.
</div>
<div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", maxWidth: 280, margin: "20px auto 0" }}>
{DESCENT_CARDS.map(function(card, i) {
var ans = answers[i];
var display;
if (ans === undefined || ans === null) { display = "—"; }
else if (card.type === "energy" && typeof ans === "number") {
var lvl = Math.max(0, Math.min(5, Math.round(ans)));
display = "●".repeat(lvl) + "○".repeat(5 - lvl);
} else if (card.type === "spectrum" && typeof ans === "number") {
display = ans + "% → " + (ans >= 50 ? (card.pole_b || "b") : (card.pole_a || "a"));
} else if (card.type === "binary" && typeof ans === "string") {
display = ans === "a" ? (card.option_a || "a") : (card.option_b || "b");
} else { display = String(ans); }
return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
<div style={{ width: 6, height: 6, borderRadius: "50%", background: card.color, opacity: 0.5, flexShrink: 0 }} />
<div style={{ fontSize: 12, color: card.color + "AA", fontFamily: FB, letterSpacing: "0.04em" }}>{display}</div>
</div>;
})}
</div>
</div>}

{!showCompletion && <><div style={{ display: "flex", gap: 8, marginBottom: 20, justifyContent: "center" }}>
{DESCENT_CARDS.map(function(_, i) { return <div key={i} style={{ width: i === ci ? 12 : 7, height: 7, borderRadius: 4, background: i < ci ? DESCENT_CARDS[i].color + "88" : i === ci ? "white" : "rgba(255,255,255,0.1)", transition: "all 0.4s" }} />; })}
</div>

<div key={ci} style={{ animation: "slideIn 0.4s ease" }}>
{c.type === "energy" && <div
onMouseDown={startEnergyHold} onMouseUp={endEnergyHold} onMouseLeave={endEnergyHold}
onTouchStart={startEnergyHold} onTouchEnd={endEnergyHold}
style={{ borderRadius: 22, padding: "40px 24px", background: "linear-gradient(160deg," + c.color + "12,rgba(10,10,30,0.9)," + c.color + "08)", border: "1px solid " + c.color + "22", textAlign: "center", cursor: "pointer", userSelect: "none", WebkitUserSelect: "none", position: "relative", overflow: "hidden", touchAction: "none" }}
>
<div style={{ position:"absolute", bottom:0, left:0, width:(ans ? 100 : holdProg * 100)+"%", height:4, background:c.color, transition:energyHolding?"none":"width 0.3s ease", opacity:0.7, borderRadius:"0 0 22px 22px" }} />
<div style={{ display:"flex", gap:12, justifyContent:"center", marginBottom:20 }}>
{[1,2,3,4,5].map(function(dot) {
var lit = ans ? (answers[ci] || 0) >= dot : holdProg * 5 >= dot;
return <div key={dot}
onClick={function(e){ if(!ans){ e.stopPropagation(); record(dot); } }}
style={{ width:18, height:18, borderRadius:"50%",
background: lit ? c.color : "rgba(255,255,255,0.08)",
boxShadow: lit ? "0 0 12px "+c.color+"88" : "none",
border:"1px solid "+(lit ? c.color+"88" : "rgba(255,255,255,0.12)"),
cursor: ans ? "default" : "pointer",
transition:"all 0.2s" }} />;
})}
</div>
{!ans && <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.08em", marginBottom:8 }}>tap a dot or hold to fill</div>}
<div style={{ fontSize: 22, fontFamily: FD, fontStyle: "italic", color: "rgba(255,255,255,0.92)", lineHeight: 1.45, marginBottom: 20 }}>{c.phrase}</div>
{!ans && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", fontFamily: FB, letterSpacing: "0.12em" }}>
{energyHolding ? "hold longer = stronger..." : "hold to mark how much this matters"}
</div>}
{ans && <div style={{ fontSize: 11, color: c.color + "88", fontFamily: FB, letterSpacing: "0.12em", animation: "riseUp 0.3s ease" }}>
{"●".repeat(answers[ci])}{"○".repeat(5 - answers[ci])} marked
</div>}
</div>}

{c.type === "binary" && <div
onTouchStart={!ans ? onTouchStart : undefined}
onTouchMove={!ans ? onTouchMove : undefined}
onTouchEnd={!ans ? onTouchEnd : undefined}
onMouseDown={!ans ? onMouseDown : undefined}
onMouseMove={!ans ? onMouseMove : undefined}
onMouseUp={!ans ? onMouseUp : undefined}
onMouseLeave={!ans ? onMouseUp : undefined}
style={{ borderRadius: 22, padding: "36px 24px", background: "linear-gradient(160deg," + c.color + "12,rgba(10,10,30,0.9)," + c.color + "08)", border: "1px solid " + c.color + "22", textAlign: "center", userSelect: "none", WebkitUserSelect: "none", cursor: ans ? "default" : "grab", position: "relative", overflow: "hidden", transform: ans ? "none" : "translateX(" + swipeX * 0.3 + "px) rotate(" + swipeX * 0.02 + "deg)", transition: swiping ? "none" : "transform 0.3s ease" }}
>
<div style={{ fontSize: 22, fontFamily: FD, fontStyle: "italic", color: "rgba(255,255,255,0.92)", lineHeight: 1.45, marginBottom: 24 }}>{c.prompt}</div>

{!ans && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
<div style={{ fontSize: 14, fontFamily: FB, fontWeight: 600, color: swipeDir === "a" ? c.color : "rgba(255,255,255,0.25)", opacity: swipeDir === "a" ? 0.3 + swipeRatio * 0.7 : 0.4, transition: swiping ? "none" : "all 0.3s", transform: "scale(" + (swipeDir === "a" ? 1 + swipeRatio * 0.15 : 1) + ")", maxWidth:"48%", lineHeight:1.25, textAlign:"left", wordBreak:"break-word", overflowWrap:"anywhere" }}>← {c.option_a}</div>
<div style={{ fontSize: 14, fontFamily: FB, fontWeight: 600, color: swipeDir === "b" ? c.color : "rgba(255,255,255,0.25)", opacity: swipeDir === "b" ? 0.3 + swipeRatio * 0.7 : 0.4, transition: swiping ? "none" : "all 0.3s", transform: "scale(" + (swipeDir === "b" ? 1 + swipeRatio * 0.15 : 1) + ")", maxWidth:"48%", lineHeight:1.25, textAlign:"right", wordBreak:"break-word", overflowWrap:"anywhere" }}>{c.option_b} →</div>
</div>}
{!ans && <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
<button onClick={function(e){ e.stopPropagation(); record("a"); }}
style={{ flex:1, padding:"12px 8px", borderRadius:14,
background: swipeDir==="a" ? c.color+"22" : "rgba(255,255,255,0.04)",
border:"1px solid "+(swipeDir==="a" ? c.color+"66" : "rgba(255,255,255,0.1)"),
color: swipeDir==="a" ? c.color : "rgba(255,255,255,0.55)",
fontSize:13, fontFamily:FB, fontWeight:600, cursor:"pointer",
whiteSpace:"normal", lineHeight:1.2, wordBreak:"break-word", overflowWrap:"anywhere",
transition:"all 0.2s" }}>{c.option_a}</button>
<button onClick={function(e){ e.stopPropagation(); record("b"); }}
style={{ flex:1, padding:"12px 8px", borderRadius:14,
background: swipeDir==="b" ? c.color+"22" : "rgba(255,255,255,0.04)",
border:"1px solid "+(swipeDir==="b" ? c.color+"66" : "rgba(255,255,255,0.1)"),
color: swipeDir==="b" ? c.color : "rgba(255,255,255,0.55)",
fontSize:13, fontFamily:FB, fontWeight:600, cursor:"pointer",
whiteSpace:"normal", lineHeight:1.2, wordBreak:"break-word", overflowWrap:"anywhere",
transition:"all 0.2s" }}>{c.option_b}</button>
</div>}
{!ans && <div style={{ fontSize:10, color:"rgba(255,255,255,0.12)", fontFamily:FB, letterSpacing:"0.1em", marginTop:10, textAlign:"center" }}>tap or swipe</div>}

{ans && <div style={{ animation: "riseUp 0.4s ease" }}>
<div style={{ fontSize: 16, fontFamily: FB, fontWeight: 600, color: c.color }}>{answers[ci] === "a" ? c.option_a : c.option_b}</div>
</div>}
</div>}

{c.type === "spectrum" && <div style={{ borderRadius: 22, padding: "32px 24px", background: "linear-gradient(160deg," + c.color + "12,rgba(10,10,30,0.9)," + c.color + "08)", border: "1px solid " + c.color + "22", position: "relative", overflow: "hidden" }}>
<div style={{ fontSize: 22, fontFamily: FD, fontStyle: "italic", color: "rgba(255,255,255,0.92)", lineHeight: 1.45, textAlign: "center", marginBottom: 24 }}>{c.prompt}</div>
<SpectrumSlider color={c.color} poleA={c.pole_a} poleB={c.pole_b} onSet={function(v){ record(v); }} value={answers[ci] !== undefined ? answers[ci] : null} />
</div>}
</div>

<div style={{ display: "flex", gap: 12, marginTop: 14, justifyContent: "space-between" }}>
{ci > 0 && <button onClick={function() { setCi(ci - 1); }} style={{ padding: "8px 16px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: "rgba(255,255,255,0.25)", fontSize: 12, fontFamily: FB, cursor: "pointer" }}>←</button>}
<div style={{ flex: 1 }} />
{ans && ci < DESCENT_CARDS.length - 1 && <button onClick={function() { setCi(ci + 1); }} style={{ padding: "8px 20px", borderRadius: 20, border: "none", background: c.color + "22", color: c.color + "cc", fontSize: 12, fontFamily: FB, fontWeight: 500, cursor: "pointer" }}>→</button>}
</div>
</>}
</div>
);
}

function TappableSentence({ text, synthesisData, onReact }) {
var [state, setState] = useState("idle"); 
var [swipeX, setSwipeX] = useState(0);
var [swiping, setSwiping] = useState(false);
var swipeStart = useRef(0);
var holdTimer = useRef(null);
var holdStartT = useRef(0);
var [holdProg, setHoldProg] = useState(0);
var [noteOpen, setNoteOpen] = React.useState(false);
var [noteDraft, setNoteDraft] = React.useState("");
var [noteSaved, setNoteSaved] = React.useState("");
var threshold = 60;

function onStart(clientX, e) {
if (state !== "idle") return;
e.stopPropagation();
setState("active");
swipeStart.current = clientX;
setSwiping(true);
setSwipeX(0);
holdStartT.current = Date.now();
holdTimer.current = setInterval(function() {
var p = Math.min((Date.now() - holdStartT.current) / 1200, 1);
setHoldProg(p);
if (p >= 1) { clearInterval(holdTimer.current); setState("held"); setSwiping(false); setSwipeX(0); setHoldProg(0); if (onReact) onReact(text, "held"); }
}, 30);
}
function onMove(clientX) {
if (!swiping || state !== "active") return;
var dx = clientX - swipeStart.current;
setSwipeX(dx);
if (Math.abs(dx) > 10 && holdTimer.current) { clearInterval(holdTimer.current); setHoldProg(0); }
}
function onEnd() {
if (holdTimer.current) clearInterval(holdTimer.current);
setHoldProg(0);
if (!swiping) return;
setSwiping(false);
if (state === "held") return;
if (swipeX < -threshold) { setState("landed"); if (onReact) onReact(text, "landed"); }
else if (swipeX > threshold) { setState("resisted"); if (onReact) onReact(text, "resisted"); }
else if (Math.abs(swipeX) < 15) { setState("landed"); if (onReact) onReact(text, "landed"); }
else { setState("idle"); } 
setSwipeX(0);
}

useEffect(function() {
if (!swiping || state !== "active") return;
function m(e) { var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0); onMove(x); }
function u() { onEnd(); }
window.addEventListener("pointermove", m);
window.addEventListener("pointerup", u);
return function() { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); };
}, [swiping, state]);

var ratio = Math.min(Math.abs(swipeX) / threshold, 1);
var dir = swipeX < 0 ? "land" : swipeX > 0 ? "resist" : null;

if (state === "idle") {
return <span
onTouchStart={function(e) { onStart(e.touches[0].clientX, e); }}
onTouchMove={function(e) { onMove(e.touches[0].clientX); }}
onTouchEnd={onEnd}
onMouseDown={function(e) { onStart(e.clientX, e); }}
onMouseMove={function(e) { onMove(e.clientX); }}
onMouseUp={onEnd}
onMouseLeave={onEnd}
style={{ cursor: "pointer", color: "inherit", borderBottom: "1px dotted rgba(214,178,109,0.15)", paddingBottom: 1, transition: "color 0.2s" }}
>{text} </span>;
}

if (state === "active") {
return <span
onTouchMove={function(e) { onMove(e.touches[0].clientX); }}
onTouchEnd={onEnd}
onMouseMove={function(e) { onMove(e.clientX); }}
onMouseUp={onEnd}
onMouseLeave={onEnd}
style={{
display: "inline-block", cursor: "grabbing",
transform: "translateX(" + swipeX * 0.4 + "px)",
color: dir === "land" ? "#7DB7AE" : dir === "resist" ? "#ff6090" : holdProg > 0.3 ? "#D6B26D" : "inherit",
transition: swiping ? "none" : "all 0.3s",
background: holdProg > 0 ? "rgba(214,178,109," + holdProg * 0.08 + ")" : dir === "land" ? "rgba(125,183,174," + ratio * 0.08 + ")" : dir === "resist" ? "rgba(255,96,144," + ratio * 0.08 + ")" : "transparent",
borderRadius: 4, padding: "0 2px",
}}
>{text} {holdProg > 0.3 && <span style={{ fontSize: 9, color: "#D6B26D88", fontFamily: FB }}>holding...</span>}</span>;
}

function saveNote() {
var n = noteDraft.trim();
if (n) {
setNoteSaved(n);
if (onReact) onReact(text, state, n);
}
setNoteOpen(false);
setNoteDraft("");
}

var stateColor = state === "landed" ? "#6BFFB8"
: state === "held" ? "#D6B26D"
: state === "resisted" ? "rgba(255,96,144,0.55)" : "inherit";
var stateMark = state === "landed" ? " ✓" : state === "held" ? " ●" : state === "resisted" ? " ✕" : "";
var stateLabel = state === "landed" ? "resonates" : state === "held" ? "marked" : state === "resisted" ? "not quite" : "";
var notePrompt = state === "landed" ? "Add signal"
: state === "held" ? "Add signal"
: "Add signal — what's different?";
var notePlaceholder = "type anything — this won't be shown back to you";

return (
<span style={{ display:"inline" }}>
<span style={{ color: stateColor, transition:"color 0.3s" }}>
{text}<span style={{ fontSize:9, fontFamily:FB, opacity:0.6, letterSpacing:"0.05em" }}>{stateMark}</span>{" "}
</span>
{!noteSaved && !noteOpen && (
<span onClick={function(e){e.stopPropagation(); setNoteOpen(true);}}
style={{ display:"inline-block", fontSize:10, color: stateColor, fontFamily:FB,
background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
borderRadius:10, padding:"2px 10px", cursor:"pointer", marginLeft:4,
letterSpacing:"0.05em", verticalAlign:"middle", opacity:0.75 }}>
+ note
</span>
)}
{noteSaved && (
<span style={{ display:"inline-block", marginLeft:6, fontSize:10,
color:stateColor, fontFamily:FB, letterSpacing:"0.08em", opacity:0.7 }}>
incorporated
</span>
)}
{noteOpen && (
<span onClick={function(e){e.stopPropagation();}} style={{ display:"block", marginTop:8 }}>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:FB,
letterSpacing:"0.08em", marginBottom:6 }}>{notePrompt}</div>
<textarea value={noteDraft} onChange={function(e){setNoteDraft(e.target.value);}}
onKeyDown={function(e){ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();saveNote();}
if(e.key==="Escape"){setNoteOpen(false);setNoteDraft("");} }}
placeholder={notePlaceholder} autoFocus
style={{ width:"100%", minHeight:56, background:"rgba(255,255,255,0.04)",
border:"1px solid "+stateColor+"44", borderRadius:8,
color:"rgba(255,255,255,0.88)", fontFamily:FD, fontSize:14,
padding:"9px 12px", resize:"none", outline:"none", lineHeight:1.55,
boxSizing:"border-box" }} />
<div style={{ display:"flex", justifyContent:"space-between", marginTop:5 }}>
<button onClick={function(){setNoteOpen(false);setNoteDraft("");}}
style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:FB,
background:"transparent", border:"none", cursor:"pointer" }}>cancel</button>
<button onClick={saveNote}
style={{ fontSize:11, color:stateColor, fontFamily:FB,
background:"rgba(255,255,255,0.04)", border:"1px solid "+stateColor+"44",
borderRadius:12, padding:"4px 14px", cursor:"pointer" }}>save note</button>
</div>
</span>
)}
</span>
);
}

function TappableReading({ text, synthesisData, onReact }) {
if (!text || text.trim().length === 0) return <span>{text}</span>;
var sentences = text.match(/[^.!?]+[.!?]+[\u201D\u201C\u2019\u2018"']?\s*/g);
if (!sentences || sentences.length === 0) {
return <TappableSentence text={text.trim()} synthesisData={synthesisData} onReact={onReact} />;
}
return <span>{sentences.map(function(s, i) {
return <TappableSentence key={i} text={s.trim()} synthesisData={synthesisData} onReact={onReact} />;
})}</span>;
}

function ClarityHoldInput({ value, onChange, onSave }) {
var [holdProg, setHoldProg] = useState(0);
var [holding, setHolding] = useState(false);
var holdRef = useRef(null);
var holdStartT = useRef(0);

function startHold(e) {
if (!value.trim()) return;
e.stopPropagation();
setHolding(true);
holdStartT.current = Date.now();
holdRef.current = setInterval(function() {
var p = Math.min((Date.now() - holdStartT.current) / 1200, 1);
setHoldProg(p);
if (p >= 1) { clearInterval(holdRef.current); setHolding(false); setHoldProg(0); onSave(); }
}, 30);
}
function endHold() {
if (holdRef.current) clearInterval(holdRef.current);
setHolding(false);
setHoldProg(0);
}

return <div>
<input type="text" value={value} onChange={function(e) { onChange(e.target.value); }}
placeholder="Name it plainly\u2026" maxLength={140}
style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid rgba(214,178,109,0.15)", borderRadius: 0, color: "rgba(255,255,255,0.9)", padding: "12px 0", fontFamily: FB, fontSize: 16, outline: "none", letterSpacing: "0.02em" }} />
{value.trim() && <div style={{ marginTop: 16, position: "relative" }}>
<div
onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold}
onTouchStart={startHold} onTouchEnd={endHold}
style={{
padding: "14px 24px", borderRadius: 20, textAlign: "center", cursor: "pointer",
background: "rgba(214,178,109," + (0.04 + holdProg * 0.12) + ")",
border: "1px solid rgba(214,178,109," + (0.15 + holdProg * 0.35) + ")",
color: "#D6B26D", fontSize: 13, fontFamily: FB, userSelect: "none", WebkitUserSelect: "none",
transition: holding ? "none" : "all 0.3s",
transform: "scale(" + (1 + holdProg * 0.04) + ")",
}}
>
{holding ? "locking in\u2026" : "hold to keep this"}
</div>
<div style={{ position: "absolute", bottom: 0, left: 0, width: holdProg * 100 + "%", height: 2, borderRadius: 1, background: "#D6B26D", transition: holding ? "none" : "width 0.2s ease", opacity: 0.6 }} />
</div>}
</div>;
}

function SessionPhase({ onComplete, synthesisData, onPatchSynthesis }) {
const [descentOpen, setDescentOpen] = useState(false);
const [descentDone, setDescentDone] = useState(false);
const [descentResult, setDescentResult] = useState(null);
const [clarity, setClarity] = useState("");
const [claritySaved, setClaritySaved] = useState(false);
const [showNoticing, setShowNoticing] = useState(false);
const scrollRef = useRef(null);


const [reactions, setReactions] = useState({});
const [corrections, setCorrections] = useState({}); 

const [signals, setSignals] = useState({ resisted_count:0, held_count:0, landed_count:0, counter_topics:[], shifted_tension:false });
const [revisedSynthesis, setRevisedSynthesis] = useState(null);
const [isRevising, setIsRevising] = useState(false);
const [signalStatus, setSignalStatus] = useState(null); 

function extractTopics(note) {
if (!note) return [];
var stop = new Set(["that","this","with","have","from","they","been","were","what","when","about","just","also","into","more","some","than","them","then","very","will","your","their","which","would","could","there"]);
return note.toLowerCase().replace(/[^a-z\s]/g,"").split(/\s+/).filter(function(w){ return w.length >= 4 && !stop.has(w); }).slice(0,4);
}



function handleReact(sentenceOrId, reaction, note) {
setReactions(function(prev) { return Object.assign({}, prev, { [sentenceOrId]: reaction }); });
setSignals(function(prev) {
var s = Object.assign({}, prev);
if (reaction === "resisted") s.resisted_count = (s.resisted_count||0) + 1;
if (reaction === "held") s.held_count = (s.held_count||0) + 1;
if (reaction === "landed") s.landed_count = (s.landed_count||0) + 1;
if (note) {
var topics = extractTopics(note);
s.counter_topics = Array.from(new Set((s.counter_topics||[]).concat(topics))).slice(0,10);
if (reaction === "resisted") s.shifted_tension = true;
}
return s;
});
if (note && note.trim()) {
setCorrections(function(prev) { return Object.assign({}, prev, { [sentenceOrId]: note.trim() }); });
}
if (reaction === "resisted" && note && note.trim()) {
fireRevision(note.trim(), sentenceOrId);
}
}

async function fireRevision(counterEvidence, originalSentence) {
setIsRevising(true);
setSignalStatus("recomputing");
try {
var themes = (sd.themes||[]).map(function(t){return t.label;}).join(", ");
var tension = sd.tension ? sd.tension.a + " vs " + sd.tension.b : "none";
var raw = await callClaudeClient(
"The user has pushed back on part of your reading. Their pushback is the truth — not counter-evidence to be managed, but correction to be honored.\n"
+ "RULE: The resisted sentence was YOUR interpretation. The user knows their experience better than you do.\n"
+ "RULE: Do not defend or reframe the original reading. Update it.\n"
+ "RULE: The new synthesis should INCORPORATE what they said, not find a clever way around it.\n"
+ "RULE: If they gave words, their words are the new truth for that area. Reflect them back.\n"
+ "Return ONLY JSON: {\"synthesis\": \"1-2 sentences that honor both the original patterns AND the user's correction\", \"new_connection\": \"one link that emerges from THEIR words (or null)\", \"tension_text\": \"...\"}",
"Original reading: \"" + (sd.synthesis||"") + "\"\n"
+ "Resisted sentence: \"" + originalSentence + "\"\n"
+ "Counter-evidence topics (do not quote): " + extractTopics(counterEvidence).join(", ") + "\n"
+ "Themes: " + themes + "\n"
+ "Tension: " + tension,
280
);
var d = parseJSON(raw);
if (d && d.synthesis) {
setRevisedSynthesis({ synthesis: d.synthesis, new_connection: d.new_connection||null, tension_text: d.tension_text||null });
setSignalStatus(d.new_connection ? "new_connection" : null);
if (onPatchSynthesis) {
var lp = { synthesis: d.synthesis };
if (d.tension_text) lp.tension = { text: d.tension_text };
onPatchSynthesis(lp);
}
}
} catch(e) { setSignalStatus(null); }
setIsRevising(false);
}

function sectionResisted(sentencePrefix) {
return Object.keys(reactions).some(function(k) {
return k.startsWith(sentencePrefix) && reactions[k] === "resisted";
});
}
var saveClarity = function() {
if (clarity.trim()) {
setClaritySaved(true);
setTimeout(function() { setShowNoticing(true); }, 1200);
}
};

const sd = synthesisData || {};
var archData = sd.archetype || (sd.archetypes && sd.archetypes[0]) || null;
var sessions = []; try { sessions = JSON.parse(localStorage.getItem(_sessionKey()) || "[]"); } catch(e) {}
var sessionNum = sessions.length + 1;
const THEMES = (sd.themes || []).map(function(t, i) { return { name: t.label, color: t.color || NC[i % NC.length], weight: Math.min((t.weight || 1) / 5, 1) }; });
const GUIDE_ITEMS = (sd.guide || []).map(function(g) { return { type: g.type || "notice", text: g.text || "" }; });
const synthesis = sd.synthesis || null;
const underneath = sd.underneath || [];
var tension = sd.tension || null;
var opening = sd.opening || null;
var noticing = sd.noticing || null;
var mapTitle = sd.map_title || "";
var descentCards = (sd.descent_cards && sd.descent_cards.length > 0) ? sd.descent_cards : null;

return (
<div style={{ width: "100%", height: "100%", position: "relative", overflow: "auto", WebkitOverflowScrolling: "touch" }} ref={scrollRef}>
<Particles color="rgba(214,178,109,0.15)" count={8} />
<div style={{ maxWidth: 380, margin: "0 auto", padding: "60px 20px calc(40px + env(safe-area-inset-bottom, 0px))", position: "relative", zIndex: 1 }}>

<div style={{ marginBottom: archData ? 18 : 28, animation: "riseUp 0.5s ease" }}>
<div style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", fontFamily: FB }}>
SESSION {sessionNum} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase()}
</div>
</div>

{archData && <div style={{ marginBottom: 36, animation: "riseUp 0.7s ease 0.05s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", color: "rgba(232,67,147,0.75)", fontFamily: FB, marginBottom: 10, textTransform: "uppercase" }}>your pattern</div>
<div style={{ fontSize: 34, color: "white", fontFamily: FB, fontWeight: 900, letterSpacing: "0.01em", lineHeight: 1.1, marginBottom: 8 }}>{archData.name}</div>
{archData.line && <div style={{ fontSize: 17, color: "rgba(255,255,255,0.72)", fontFamily: FD, lineHeight: 1.55 }}>{archData.line}</div>}
</div>}

{THEMES.length > 0 && <div style={{ marginBottom: 32, animation: "riseUp 0.5s ease 0.08s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#E84393", marginBottom: 14, fontFamily: FB, textTransform: "uppercase", opacity: 0.75 }}>
{THEMES.length} forces
</div>
<div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
{THEMES.map(function(t, i) {
var sz = Math.round(11 + t.weight * 10);
var pad = t.weight > 0.7 ? "11px 22px" : "8px 16px";
return <div key={t.name} style={{ padding: pad, borderRadius: 24, background: t.color + "18", border: "1px solid " + t.color + "40", fontSize: sz, color: t.color, fontFamily: FB, fontWeight: 700, letterSpacing: "0.04em", animation: "riseUp 0.5s ease " + (i * 0.07) + "s both", lineHeight: 1 }}>{t.name}</div>;
})}
</div>
</div>}

{synthesis && <div style={{ marginBottom: 32, animation: "riseUp 0.6s ease 0.12s both" }}>
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#D6B26D", fontFamily: FB, opacity: 0.6, textTransform: "uppercase" }}>the reading</div>
{isRevising && <div style={{ fontSize:14, color:"rgba(214,178,109,0.6)", fontFamily:FB, letterSpacing:"0.14em", animation:"pulse 1.5s ease infinite" }}>recomputing...</div>}
{!isRevising && signalStatus === "new_connection" && <div style={{ fontSize:14, color:"rgba(107,184,255,0.65)", fontFamily:FB, letterSpacing:"0.12em" }}>new connection found ↓</div>}
{!isRevising && signals.resisted_count > 0 && signalStatus !== "new_connection" && <div style={{ fontSize:14, color:"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.1em" }}>incorporated</div>}
</div>

{mapTitle && <div style={{ fontSize: 15, color: "rgba(214,178,109,0.3)", fontFamily: FD, marginBottom: 10 }}>{mapTitle}</div>}

{revisedSynthesis
? <div style={{ animation: "riseUp 0.6s ease" }}>
<p style={{ fontSize: 20, color: "rgba(255,255,255,0.9)", fontFamily: FD, lineHeight: 1.75, margin: 0 }}>
<TappableReading text={revisedSynthesis.synthesis} synthesisData={sd} onReact={handleReact} />
</p>
{revisedSynthesis.new_connection && <div style={{ marginTop:16, padding:"12px 16px", borderRadius:10,
background:"rgba(107,184,255,0.06)", border:"1px solid rgba(107,184,255,0.15)", animation:"riseUp 0.5s ease both" }}>
<div style={{ fontSize:14, color:"rgba(107,184,255,0.6)", fontFamily:FB, letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:6 }}>new connection</div>
<div style={{ fontSize:16, color:"rgba(107,184,255,0.85)", fontFamily:FD, lineHeight:1.6 }}>{revisedSynthesis.new_connection}</div>
</div>}
</div>
: <p style={{ fontSize: 20, color: "rgba(255,255,255,0.88)", fontFamily: FD, lineHeight: 1.75, margin: 0 }}>
<TappableReading text={synthesis} synthesisData={sd} onReact={handleReact} />
</p>
}
</div>}

{underneath.length > 0 && <div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", animation: "riseUp 0.6s ease 0.2s both" }}>
<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#B86BFF", fontFamily: FB, opacity: 0.6, textTransform: "uppercase" }}>what{"'"}s underneath</div>
<div style={{ fontSize: 14, color: "rgba(183,107,255,0.38)", fontFamily: FB, letterSpacing: "0.05em" }}>swipe right to push back</div>
</div>
{underneath.map(function(t, i) {
var uKey = "underneath_" + i;
var uReaction = reactions[uKey];
return <div key={i} style={{ padding: "12px 14px 12px 20px", borderRadius: 12,
background: uReaction === "resisted" ? "rgba(255,96,144,0.03)" : "rgba(183,107,255,0.04)",
border: "1px solid " + (uReaction === "landed" ? "rgba(107,255,184,0.15)" : uReaction === "resisted" ? "rgba(255,96,144,0.12)" : "rgba(183,107,255,0.08)"),
marginBottom: 8, position: "relative", animation: "riseUp 0.5s ease " + (0.3 + i * 0.1) + "s both", transition: "all 0.3s" }}>
<div style={{ position: "absolute", left: 10, top: 16, width: 3, height: 3, borderRadius: "50%",
background: uReaction === "landed" ? "#6BFFB8" : uReaction === "resisted" ? "rgba(255,96,144,0.6)" : "#B86BFF", opacity: 0.5 }} />
<p style={{ fontSize: 15, color: uReaction === "resisted" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)", fontFamily: FD, lineHeight: 1.65, margin: "0 0 6px" }}>
<TappableSentence text={t} onReact={function(_, r) { handleReact(uKey, r); }} />
</p>
{uReaction === "landed" && <div style={{ fontSize: 14, color: "rgba(107,255,184,0.4)", fontFamily: FB, letterSpacing: "0.12em" }}>← yes</div>}

</div>;
})}
</div>}

{tension && <div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", animation: "riseUp 0.6s ease 0.3s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#FFB86B", marginBottom: 14, fontFamily: FB, opacity: 0.6, textTransform: "uppercase" }}>the tension</div>
<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: tension.text ? 12 : 0 }}>
<div style={{ flex: "1 1 0", minWidth: 0, minHeight: 56, padding: "14px 18px", borderRadius: 12, background: "rgba(255,184,107,0.07)", border: "1px solid rgba(255,184,107,0.18)", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
<div style={{ fontSize: 19, color: "#FFB86B", fontFamily: FB, fontWeight: 900, overflowWrap: "break-word", wordBreak: "break-word", lineHeight: 1.3 }}>{tension.a}</div>
</div>
<div style={{ fontSize: 15, color: "rgba(255,255,255,0.12)", fontFamily: FB, flexShrink: 0 }}>↔</div>
<div style={{ flex: "1 1 0", minWidth: 0, minHeight: 56, padding: "14px 18px", borderRadius: 12, background: "rgba(107,184,255,0.07)", border: "1px solid rgba(107,184,255,0.18)", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
<div style={{ fontSize: 19, color: "#6BB8FF", fontFamily: FB, fontWeight: 900, overflowWrap: "break-word", wordBreak: "break-word", lineHeight: 1.3 }}>{tension.b}</div>
</div>
</div>
{(revisedSynthesis && revisedSynthesis.tension_text
? <p style={{ fontSize: 15, color: "rgba(255,255,255,0.72)", fontFamily: FD, lineHeight: 1.6, margin: "0 0 4px" }}>
{revisedSynthesis.tension_text}
<span style={{ fontSize: 9, color: "rgba(255,96,144,0.4)", fontFamily: FB, letterSpacing: "0.2em", marginLeft: 8 }}>revised</span>
</p>
: tension.text && <p style={{ fontSize: 15, color: reactions["tension"] === "resisted" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.62)", fontFamily: FD, lineHeight: 1.6, margin: "0 0 12px" }}>{tension.text}</p>
)}
{!reactions["tension"] && <div style={{ display: "flex", gap: 8 }}>
<button onClick={function() { handleReact("tension", "landed"); }} style={{ flex: 1, fontSize: 15, color: "rgba(107,255,184,0.45)", fontFamily: FB, background: "rgba(107,255,184,0.04)", border: "1px solid rgba(107,255,184,0.1)", borderRadius: 16, padding: "8px 0", cursor: "pointer", letterSpacing: "0.06em" }}>this lands ←</button>
<button onClick={function() { handleReact("tension", "resisted"); }} style={{ flex: 1, fontSize: 15, color: "rgba(255,96,144,0.45)", fontFamily: FB, background: "rgba(255,96,144,0.04)", border: "1px solid rgba(255,96,144,0.1)", borderRadius: 16, padding: "8px 0", cursor: "pointer", letterSpacing: "0.06em" }}>→ not right</button>
</div>}
{reactions["tension"] === "landed" && <div style={{ fontSize: 14, color: "rgba(107,255,184,0.4)", fontFamily: FB, letterSpacing: "0.15em", animation: "riseUp 0.3s ease" }}>← noted</div>}
{reactions["tension"] === "resisted" && <div style={{ fontSize:14, color:"rgba(255,255,255,0.3)", fontFamily:FB, letterSpacing:"0.12em", animation:"riseUp 0.3s ease" }}>signal incorporated</div>}
</div>}

{opening && <div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", animation: "riseUp 0.6s ease 0.35s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#6BFFB8", marginBottom: 14, fontFamily: FB, opacity: 0.6, textTransform: "uppercase" }}>what{"'"}s opening</div>
<p style={{ fontSize: 19, color: "rgba(107,255,184,0.88)", fontFamily: FD, lineHeight: 1.65, margin: 0 }}>{opening}</p>
</div>}

{GUIDE_ITEMS.length > 0 && <div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", animation: "riseUp 0.6s ease 0.4s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.45em", fontWeight: 600, color: "#7DB7AE", marginBottom: 14, fontFamily: FB, opacity: 0.6, textTransform: "uppercase" }}>your guide</div>
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
{GUIDE_ITEMS.map(function(item, i) { return <GuideItem key={i} item={item} index={i} onPatchSynthesis={onPatchSynthesis} allGuide={sd.guide||[]} />; })}
</div>
</div>}

<div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
{!descentOpen && !descentDone && (
<div onClick={function(){ setDescentOpen(true); }} style={{
display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
fontFamily: FB, fontSize: 15, color: "rgba(214,178,109,0.7)", textAlign: "center",
cursor: "pointer", padding: "18px 20px", borderRadius: 14,
border: "1px solid rgba(214,178,109,0.08)", background: "rgba(214,178,109,0.015)",
transition: "all 0.3s", fontWeight: 600, letterSpacing: "0.03em",
animation: "riseUp 0.5s ease 0.6s both",
}}>
<span style={{ fontSize: 16 }}>◆</span> See what's underneath
</div>
)}
{descentOpen && !descentDone && (
<div style={{ animation: "riseUp 0.5s ease" }}>
<div style={{ fontSize: 14, letterSpacing: "0.3em", fontWeight: 600, color: "#D6B26D", marginBottom: 8, fontFamily: FB, textAlign: "center" }}>THE DESCENT</div>
<DescentGame cards={descentCards} onDone={function(data) { setDescentResult(data); setDescentDone(true); }} />
</div>
)}
{descentDone && <div style={{ textAlign: "center", padding: "20px 0", animation: "riseUp 0.5s ease" }}>
<div style={{ fontSize: 15, color: "rgba(214,178,109,0.5)", fontFamily: FB, letterSpacing: "0.2em" }}>◆ DESCENT COMPLETE ◆</div>
{descentResult && descentResult.cards && <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
{descentResult.cards.map(function(card, i) {
var ans = descentResult.answers ? descentResult.answers[i] : null;
if (ans === null || ans === undefined) return null;
var display;
if (card.type === "energy" && typeof ans === "number") {
var lvl2 = Math.max(0, Math.min(5, Math.round(ans)));
display = "●".repeat(lvl2) + "○".repeat(5 - lvl2);
} else if (card.type === "spectrum" && typeof ans === "number") {
display = Math.round(ans) + "%";
} else if (card.type === "binary") { display = String(ans); }
else { display = String(ans); }
return <div key={i} style={{ padding: "6px 12px", borderRadius: 16, background: (card.color || "#D6B26D") + "15", border: "1px solid " + (card.color || "#D6B26D") + "30", fontSize: 14, color: (card.color || "#D6B26D") + "88", fontFamily: FB, letterSpacing: "0.08em" }}>{display}</div>;
})}
</div>}
</div>}
</div>

<div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
<div style={{ fontSize: 14, letterSpacing: "0.3em", fontWeight: 600, color: "rgba(214,178,109,0.35)", marginBottom: 14, fontFamily: FB }}>WHAT ARE YOU TAKING WITH YOU?</div>
{!claritySaved ? (
<ClarityHoldInput value={clarity} onChange={setClarity} onSave={saveClarity} />
) : (
<div style={{ animation: "riseUp 0.5s ease" }}>
<div style={{ fontSize: 16, color: "#D6B26D", fontFamily: FB, lineHeight: 1.55, letterSpacing: "0.02em" }}>{clarity}</div>
<div style={{ fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "#7DB7AE", marginTop: 8, opacity: 0.4 }}>SAVED</div>
</div>
)}
</div>

{showNoticing && noticing && (
<div style={{ marginBottom: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.04)", animation: "riseUp 1s ease" }}>
<div style={{ fontSize: 9, letterSpacing: "0.35em", color: "rgba(214,178,109,0.35)", fontFamily: FB, marginBottom: 8, textTransform: "uppercase" }}>the system notices</div>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.38)", fontFamily: FD, lineHeight: 1.7 }}>
✦ {noticing}
</div>
</div>
)}

<button onClick={function(){ onComplete({ descent: descentResult, clarity: clarity, claritySaved: claritySaved, reactions: reactions, corrections: corrections, signals: signals, revisedSynthesis: revisedSynthesis }); }} style={{
width: "100%", background: claritySaved ? "linear-gradient(135deg, #6BFFB8, #3DFFAA)" : "rgba(107,255,184,0.08)",
border: claritySaved ? "none" : "1px solid rgba(107,255,184,0.15)",
borderRadius: 24, padding: "14px 28px", minHeight: 48,
color: claritySaved ? "#0A2E1A" : "rgba(107,255,184,0.3)",
fontSize: 15, fontFamily: FB, fontWeight: claritySaved ? 600 : 400,
cursor: "pointer", transition: "all 0.4s", touchAction: "manipulation",
}}>
{claritySaved ? "See Your Field →" : "Continue to What's Growing →"}
</button>
</div>
</div>
);
}

function ChrysalisButterfly({ phase }) {
var stg = phase || "dissolving";
var isEmerged = stg === "emergence";
var isDissolved = stg === "dissolving";
var isClustering = stg === "clustering";
var cocoonRx = isDissolved ? 20 : isClustering ? 26 : isEmerged ? 30 : 18;
var cocoonRy = isDissolved ? 38 : isClustering ? 50 : isEmerged ? 54 : 34;
var glowStr = isDissolved ? 0.12 : isClustering ? 0.22 : isEmerged ? 0 : 0.06;
return (
<svg viewBox="0 0 280 240" style={{ width:"100%", maxWidth:240 }}>
<defs>
<radialGradient id="cocoon2">
<stop offset="0%" stopColor={isClustering?"#7B5BE0":isDissolved?"#6B5B4B":"#8B7B5B"} />
<stop offset="100%" stopColor={isClustering?"#3B1A7A":isDissolved?"#3B2B25":"#5B4B35"} />
</radialGradient>
<radialGradient id="cGlow" cx="50%" cy="50%" r="50%">
<stop offset="0%" stopColor="#9060E0" stopOpacity={glowStr} />
<stop offset="100%" stopColor="#9060E0" stopOpacity="0" />
</radialGradient>
<linearGradient id="wL2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#E8A0D4" /><stop offset="50%" stopColor="#C470E8" /><stop offset="100%" stopColor="#7744CC" /></linearGradient>
<linearGradient id="wR2" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8A0D4" /><stop offset="50%" stopColor="#C470E8" /><stop offset="100%" stopColor="#7744CC" /></linearGradient>
</defs>

{!isEmerged ? (
<g>
<ellipse cx="140" cy="120" rx={60} ry={70} fill="url(#cGlow)" />
<path d="M 140 42 Q 143 55 138 68" stroke="#A09070" strokeWidth="2" fill="none" />
<ellipse cx="138" cy="115" rx={cocoonRx} ry={cocoonRy} fill="url(#cocoon2)" opacity="0.9">
<animate attributeName="ry" values={cocoonRy+";"+( cocoonRy+4)+";"+cocoonRy} dur="4s" repeatCount="indefinite" />
</ellipse>
{[0,1,2,3].map(function(i) {
var cy = 92 + i*16;
return <path key={i} d={"M "+(138-cocoonRx*0.7)+" "+cy+" Q 138 "+(cy-5)+" "+(138+cocoonRx*0.7)+" "+cy}
stroke={isClustering?"rgba(180,120,255,0.25)":"rgba(200,180,140,0.18)"} strokeWidth="1" fill="none" />;
})}
<ellipse cx="138" cy="108" rx={cocoonRx*0.4} ry={cocoonRy*0.3}
fill={isClustering?"rgba(180,120,255,0.2)":"rgba(255,255,255,0.06)"}>
<animate attributeName="opacity" values="0.4;1;0.4" dur={isClustering?"1.8s":"3s"} repeatCount="indefinite" />
</ellipse>
{isClustering && [[-30,10],[30,-15],[0,30],[-20,-20]].map(function(xy,i) {
return <circle key={i} cx={138+xy[0]} cy={115+xy[1]} r="2"
fill="rgba(180,120,255,0.5)" opacity="0.6">
<animate attributeName="opacity" values="0.2;0.8;0.2" dur={(1.5+i*0.3)+"s"} repeatCount="indefinite" />
</circle>;
})}
</g>
) : (
<g style={{ animation:"riseUp 1.2s ease" }}>
<path d="M 140 118 Q 68 62 50 100 Q 30 138 66 168 Q 96 188 140 144" fill="url(#wL2)" opacity="0.88">
<animateTransform attributeName="transform" type="rotate" values="-3 140 120;3 140 120;-3 140 120" dur="2.4s" repeatCount="indefinite" />
</path>
<path d="M 140 118 Q 212 62 230 100 Q 250 138 214 168 Q 184 188 140 144" fill="url(#wR2)" opacity="0.88">
<animateTransform attributeName="transform" type="rotate" values="3 140 120;-3 140 120;3 140 120" dur="2.4s" repeatCount="indefinite" />
</path>
{[[96,116,9],[184,116,9],[78,140,6],[202,140,6]].map(function(spot,i) {
return <circle key={i} cx={spot[0]} cy={spot[1]} r={spot[2]} fill="rgba(255,255,255,0.22)" />;
})}
<ellipse cx="140" cy="130" rx="3" ry="16" fill="#1A0A2A" />
<path d="M 138 114 Q 124 94 118 88" stroke="#1A0A2A" strokeWidth="1.5" fill="none" />
<path d="M 142 114 Q 156 94 162 88" stroke="#1A0A2A" strokeWidth="1.5" fill="none" />
<circle cx="118" cy="88" r="2.5" fill="#FFE060" />
<circle cx="162" cy="88" r="2.5" fill="#FFE060" />
</g>
)}
</svg>
);
}

function TensionPull({ clicked }) {
return (
<svg viewBox="0 0 320 180" style={{ width: "100%", maxWidth: 320 }}>
{[80,60,40].map((r,i) => (
<ellipse key={i} cx="160" cy="90" rx={clicked ? r+60 : r} ry={clicked ? r*0.45+10 : r*0.45}
fill="none" stroke="url(#tf)" strokeWidth="0.8" opacity={0.15-i*0.04}
style={{ transition: "all 0.8s ease" }} />
))}
<g style={{ transform: `translateX(${clicked ? -35 : 0}px)`, transition: "transform 0.8s ease" }}>
<circle cx="75" cy="90" r="28" fill="url(#pL)" />
<circle cx="75" cy="90" r="34" fill="none" stroke="#FF6B6B" strokeWidth="0.5" opacity="0.3">
<animate attributeName="r" values="34;40;34" dur="2s" repeatCount="indefinite" />
</circle>
</g>
<g style={{ transform: `translateX(${clicked ? 35 : 0}px)`, transition: "transform 0.8s ease" }}>
<circle cx="245" cy="90" r="28" fill="url(#pR)" />
<circle cx="245" cy="90" r="34" fill="none" stroke="#6BC5FF" strokeWidth="0.5" opacity="0.3">
<animate attributeName="r" values="34;40;34" dur="2.3s" repeatCount="indefinite" />
</circle>
</g>
{clicked && (
<g style={{ animation: "riseUp 0.6s ease" }}>
<circle cx="160" cy="50" r="22" fill="url(#gG)" />
<text x="160" y="56" textAnchor="middle" fontSize="18" fill="#FFD700" fontFamily="serif">✦</text>
</g>
)}
{clicked && [0,1,2].map(i => (
<line key={i} x1={120+i*20} y1={75+i*5} x2={135+i*18} y2={80+i*3}
stroke="#FFD700" strokeWidth="1.5" opacity="0.5" fill="none">
<animate attributeName="opacity" values="0.3;0.7;0.3" dur={`${0.6+i*0.2}s`} repeatCount="indefinite" />
</line>
))}
<defs>
<linearGradient id="tf"><stop offset="0%" stopColor="#FF6B6B" /><stop offset="50%" stopColor="#FFD700" /><stop offset="100%" stopColor="#6BC5FF" /></linearGradient>
<radialGradient id="pL"><stop offset="0%" stopColor="#FF8888" /><stop offset="100%" stopColor="#CC3333" /></radialGradient>
<radialGradient id="pR"><stop offset="0%" stopColor="#88CCFF" /><stop offset="100%" stopColor="#3388CC" /></radialGradient>
<radialGradient id="gG"><stop offset="0%" stopColor="rgba(255,215,0,0.4)" /><stop offset="100%" stopColor="rgba(255,215,0,0)" /></radialGradient>
</defs>
</svg>
);
}

function SessionPortrait() {
const rings = [
{ r: 100, color: "#FF6B9D", width: 4, dash: "8 4", speed: 60 },
{ r: 78, color: "#FFB86B", width: 3, dash: "12 8", speed: 45 },
{ r: 56, color: "#6BFFB8", width: 2.5, dash: "4 12", speed: 80 },
{ r: 38, color: "#B86BFF", width: 2, dash: "20 4", speed: 35 },
{ r: 22, color: "#FFD700", width: 6, dash: "2 6", speed: 50 },
];
return (
<svg viewBox="0 0 260 260" style={{ width: "100%", maxWidth: 240 }}>
{rings.map((ring, i) => (
<circle key={i} cx="130" cy="130" r={ring.r} fill="none"
stroke={ring.color} strokeWidth={ring.width}
strokeDasharray={ring.dash} strokeLinecap="round" opacity="0.7">
<animateTransform attributeName="transform" type="rotate"
from={`0 130 130`} to={`${i%2===0?360:-360} 130 130`} dur={`${ring.speed}s`} repeatCount="indefinite" />
</circle>
))}
<circle cx="130" cy="130" r="6" fill="white" opacity="0.8" />
<circle cx="130" cy="130" r="12" fill="none" stroke="white" strokeWidth="0.5" opacity="0.3">
<animate attributeName="r" values="12;18;12" dur="3s" repeatCount="indefinite" />
</circle>
</svg>
);
}

function ThreadTimeline() {
const points = [
{ s: 3, strength: 0.2 }, { s: 7, strength: 0.3 }, { s: 12, strength: 0.1 },
{ s: 18, strength: 0.15 }, { s: 28, strength: 0.6 }, { s: 29, strength: 0.7 },
{ s: 30, strength: 0.8 }, { s: 32, strength: 0.9 },
];
const w = 300, h = 100;
return (
<svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: 300 }}>
<line x1="0" y1={h-10} x2={w} y2={h-10} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
<path d={points.map((p, i) => {
const x = (p.s / 32) * w; const y = h - 10 - (p.strength * (h - 20));
return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
}).join(' ')} fill="none" stroke="url(#threadG)" strokeWidth="2.5" strokeLinecap="round" />
{points.map((p, i) => {
const x = (p.s / 32) * w; const y = h - 10 - (p.strength * (h - 20));
return <circle key={i} cx={x} cy={y} r={3 + p.strength * 4} fill="#FFB86B" opacity={0.4 + p.strength * 0.6} />;
})}
<text x="0" y={h} fontSize="10" fill="rgba(255,255,255,0.3)" fontFamily={FB}>1</text>
<text x={w-10} y={h} fontSize="10" fill="#FFB86B" fontFamily={FB}>32</text>
<defs>
<linearGradient id="threadG" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stopColor="rgba(255,184,107,0.3)" /><stop offset="100%" stopColor="#FFB86B" />
</linearGradient>
</defs>
</svg>
);
}

function SeedToTree({ morphed }) {
return (
<svg viewBox="0 0 280 300" style={{ width: "100%", maxWidth: 260 }}>
<ellipse cx="140" cy="260" rx={morphed ? 100 : 40} ry="8" fill="rgba(107,255,184,0.1)" style={{ transition: "all 1.2s ease" }} />
{!morphed ? (
<g>
<ellipse cx="140" cy="240" rx="14" ry="10" fill="#8B7B5B" />
<ellipse cx="140" cy="238" rx="10" ry="6" fill="#A09070" opacity="0.5" />
<path d="M 140 230 Q 140 222 142 218" stroke="#6BFFB8" strokeWidth="2" fill="none" opacity="0.5" />
<ellipse cx="140" cy="240" rx="24" ry="18" fill="none" stroke="#6BFFB8" strokeWidth="0.5" opacity="0.2">
<animate attributeName="rx" values="24;30;24" dur="3s" repeatCount="indefinite" />
</ellipse>
</g>
) : (
<g style={{ animation: "riseUp 1.2s ease" }}>
<path d="M 140 258 Q 138 200 140 140" stroke="#6B8B5B" strokeWidth="5" fill="none" strokeLinecap="round" />
<path d="M 140 180 Q 110 160 90 150" stroke="#6B8B5B" strokeWidth="3" fill="none" strokeLinecap="round" />
<path d="M 140 180 Q 170 155 195 148" stroke="#6B8B5B" strokeWidth="3" fill="none" strokeLinecap="round" />
<path d="M 140 155 Q 120 135 100 128" stroke="#6B8B5B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
<path d="M 140 155 Q 165 130 180 125" stroke="#6B8B5B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
<path d="M 140 140 Q 130 120 125 108" stroke="#6B8B5B" strokeWidth="2" fill="none" strokeLinecap="round" />
<path d="M 140 140 Q 155 118 162 108" stroke="#6B8B5B" strokeWidth="2" fill="none" strokeLinecap="round" />
{[[90,145,22],[195,143,20],[100,122,18],[180,120,18],[125,102,16],[162,102,16],[140,90,20]].map(([cx,cy,r],i) => (
<circle key={i} cx={cx} cy={cy} r={r} fill={`rgba(107,255,184,${0.12+i*0.02})`}>
<animate attributeName="r" values={`${r};${r+2};${r}`} dur={`${2.5+i*0.3}s`} repeatCount="indefinite" />
</circle>
))}
{[[95,140],[188,138],[105,118],[175,116],[130,98],[155,98],[140,85]].map(([x,y],i) => (
<circle key={i} cx={x} cy={y} r="2" fill="#6BFFB8" opacity="0.6">
<animate attributeName="opacity" values="0.3;0.8;0.3" dur={`${1.5+i*0.4}s`} repeatCount="indefinite" />
</circle>
))}
<path d="M 136 258 Q 120 268 105 272" stroke="#5B7B4B" strokeWidth="2" fill="none" opacity="0.5" />
<path d="M 144 258 Q 160 268 175 272" stroke="#5B7B4B" strokeWidth="2" fill="none" opacity="0.5" />
</g>
)}
</svg>
);
}

function SunriseViz() {
return (
<svg viewBox="0 0 320 200" style={{ width: "100%", maxWidth: 320 }}>
<rect x="0" y="0" width="320" height="200" fill="url(#sky)" rx="8" />
<circle cx="160" cy="110" r="35" fill="url(#sun)">
<animate attributeName="cy" values="110;95;110" dur="6s" repeatCount="indefinite" />
</circle>
{[0,30,60,90,120,150,180,210,240,270,300,330].map((angle, i) => {
const rad = (angle * Math.PI) / 180;
const x1 = 160 + 42 * Math.cos(rad), y1 = 105 + 42 * Math.sin(rad);
const x2 = 160 + (55 + i%3*8) * Math.cos(rad), y2 = 105 + (55 + i%3*8) * Math.sin(rad);
return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFD700" strokeWidth="1.5" opacity="0.3" strokeLinecap="round">
<animate attributeName="opacity" values="0.15;0.4;0.15" dur={`${2+i*0.2}s`} repeatCount="indefinite" />
</line>;
})}
<line x1="0" y1="145" x2="320" y2="145" stroke="rgba(255,215,0,0.2)" strokeWidth="1" />
<ellipse cx="160" cy="170" rx="60" ry="8" fill="rgba(255,215,0,0.08)" />
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stopColor="rgba(30,20,60,0.8)" /><stop offset="50%" stopColor="rgba(80,40,20,0.4)" /><stop offset="100%" stopColor="rgba(255,180,80,0.15)" />
</linearGradient>
<radialGradient id="sun"><stop offset="0%" stopColor="#FFE44D" /><stop offset="60%" stopColor="#FFB830" /><stop offset="100%" stopColor="#FF8800" /></radialGradient>
</defs>
</svg>
);
}

function ArchSisyphus({ morphed, color }) {
var c = color || "#FFB86B";
return <svg viewBox="0 0 280 260" style={{ width: "100%", maxWidth: 240 }}>
<defs>
<radialGradient id="bld"><stop offset="0%" stopColor={c} stopOpacity="0.5" /><stop offset="100%" stopColor={c} stopOpacity="0.15" /></radialGradient>
<linearGradient id="hill" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor={c} stopOpacity="0.05" /><stop offset="100%" stopColor={c} stopOpacity="0.15" /></linearGradient>
</defs>
<path d="M 20 240 Q 140 60 260 240" fill="url(#hill)" stroke={c} strokeWidth="1" opacity="0.3" />
{!morphed ? (<g>
<circle cx="100" cy="195" r="30" fill="url(#bld)" stroke={c} strokeWidth="2" opacity="0.7">
<animate attributeName="cx" values="100;105;100" dur="2s" repeatCount="indefinite" />
</circle>
<line x1="100" y1="210" x2="85" y2="230" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.4" />
<line x1="100" y1="210" x2="115" y2="232" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.4" />
<circle cx="100" cy="200" r="7" fill={c} opacity="0.2" />
{[0,1,2].map(function(i) { return <circle key={i} cx={100} cy={195} r={38+i*8} fill="none" stroke={c} strokeWidth="0.5" opacity={0.08}>
<animate attributeName="r" values={(38+i*8)+";"+(42+i*8)+";"+(38+i*8)} dur={(3+i)+"s"} repeatCount="indefinite" />
</circle>; })}
</g>) : (<g style={{ animation: "riseUp 1s ease" }}>
<circle cx="140" cy="80" r="30" fill="url(#bld)" stroke={c} strokeWidth="2.5" opacity="0.9">
<animate attributeName="cy" values="80;75;80" dur="3s" repeatCount="indefinite" />
</circle>
<circle cx="140" cy="80" r="12" fill={c} opacity="0.15"><animate attributeName="r" values="12;18;12" dur="2s" repeatCount="indefinite" /></circle>
{[0,1,2,3,4,5].map(function(i) {
var a = i * 60 * Math.PI / 180; var x = 140 + Math.cos(a) * 45; var y = 80 + Math.sin(a) * 45;
return <circle key={i} cx={x} cy={y} r="3" fill={c} opacity="0.5">
<animate attributeName="opacity" values="0.2;0.7;0.2" dur={(1.5+i*0.3)+"s"} repeatCount="indefinite" />
</circle>;
})}
<text x="140" y="250" textAnchor="middle" fontSize="11" fill={c} fontFamily="DM Sans" opacity="0.5" letterSpacing="0.15em">IT REACHED THE TOP</text>
</g>)}
</svg>;
}

function ArchMagician({ morphed, color }) {
var c = color || "#B86BFF";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
<defs><radialGradient id="mglow"><stop offset="0%" stopColor={c} stopOpacity="0.4" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient></defs>
{!morphed ? (<g>
<circle cx="140" cy="140" r="40" fill="url(#mglow)" opacity="0.3" />
<circle cx="140" cy="140" r="5" fill={c} opacity="0.4"><animate attributeName="r" values="4;7;4" dur="2.5s" repeatCount="indefinite" /></circle>
{[0,72,144,216,288].map(function(a,i) {
var rad = a * Math.PI / 180; var x = 140 + Math.cos(rad) * 55; var y = 140 + Math.sin(rad) * 55;
return <circle key={i} cx={x} cy={y} r="3" fill={c} opacity="0.25">
<animate attributeName="opacity" values="0.1;0.4;0.1" dur={(2+i*0.4)+"s"} repeatCount="indefinite" />
</circle>;
})}
<circle cx="140" cy="140" r="55" fill="none" stroke={c} strokeWidth="0.5" opacity="0.1" strokeDasharray="4 8" />
</g>) : (<g style={{ animation: "riseUp 0.8s ease" }}>
<circle cx="140" cy="130" r="65" fill="url(#mglow)"><animate attributeName="r" values="60;70;60" dur="2.5s" repeatCount="indefinite" /></circle>
{[0,45,90,135,180,225,270,315].map(function(a,i) {
var rad = a * Math.PI / 180; var r1 = 30; var r2 = 70;
return <line key={i} x1={140+Math.cos(rad)*r1} y1={130+Math.sin(rad)*r1} x2={140+Math.cos(rad)*r2} y2={130+Math.sin(rad)*r2}
stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.6">
<animate attributeName="opacity" values="0.3;0.8;0.3" dur={(1.2+i*0.2)+"s"} repeatCount="indefinite" />
</line>;
})}
{[0,60,120,180,240,300].map(function(a,i) {
var rad = a * Math.PI / 180; var x = 140 + Math.cos(rad) * 50; var y = 130 + Math.sin(rad) * 50;
return <circle key={"o"+i} cx={x} cy={y} r="6" fill={c} opacity="0.6">
<animate attributeName="r" values="4;8;4" dur={(1.5+i*0.3)+"s"} repeatCount="indefinite" />
<animateTransform attributeName="transform" type="rotate" from="0 140 130" to="360 140 130" dur="20s" repeatCount="indefinite" />
</circle>;
})}
<circle cx="140" cy="130" r="12" fill={c} opacity="0.7"><animate attributeName="r" values="10;15;10" dur="2s" repeatCount="indefinite" /></circle>
</g>)}
</svg>;
}

function ArchThreshold({ morphed, color }) {
var c = color || "#FFD700";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
{!morphed ? (<g>
<rect x="90" y="40" width="12" height="190" rx="6" fill={c} opacity="0.2" />
<rect x="178" y="40" width="12" height="190" rx="6" fill={c} opacity="0.2" />
<path d="M 96 46 Q 140 22 184 46" fill="none" stroke={c} strokeWidth="1.5" opacity="0.2" />
<rect x="102" y="46" width="76" height="184" rx="2" fill={c} opacity="0.03" stroke={c} strokeWidth="0.5" strokeOpacity="0.08" />
<circle cx="170" cy="140" r="4" fill={c} opacity="0.3" />
<circle cx="140" cy="140" r="3" fill={c} opacity="0.15"><animate attributeName="opacity" values="0.1;0.3;0.1" dur="3s" repeatCount="indefinite" /></circle>
</g>) : (<g style={{ animation: "riseUp 0.8s ease" }}>
<rect x="70" y="40" width="12" height="190" rx="6" fill={c} opacity="0.3" />
<rect x="198" y="40" width="12" height="190" rx="6" fill={c} opacity="0.3" />
<path d="M 76 46 Q 140 22 204 46" fill="none" stroke={c} strokeWidth="2" opacity="0.4" />
<rect x="82" y="46" width="116" height="184" rx="2" fill={c} opacity="0.06" />
{[0,1,2,3,4,5,6].map(function(i) {
return <line key={i} x1="140" y1={60+i*22} x2={140+(i%2===0?-1:1)*((i+1)*6)} y2={55+i*22} stroke={c} strokeWidth="1.5" opacity={0.15+i*0.06} strokeLinecap="round">
<animate attributeName="opacity" values={(0.1+i*0.05)+";"+(0.4+i*0.05)+";"+(0.1+i*0.05)} dur={(1+i*0.3)+"s"} repeatCount="indefinite" />
</line>;
})}
<circle cx="140" cy="140" r="20" fill={c} opacity="0.08"><animate attributeName="r" values="18;25;18" dur="3s" repeatCount="indefinite" /></circle>
<circle cx="140" cy="140" r="6" fill={c} opacity="0.6"><animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite" /></circle>
<text x="140" y="260" textAnchor="middle" fontSize="10" fill={c} fontFamily="DM Sans" opacity="0.4" letterSpacing="0.15em">THE DOOR IS OPEN</text>
</g>)}
</svg>;
}

function ArchTower({ morphed, color }) {
var c = color || "#E84393";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
<defs><linearGradient id="twr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity="0.3" /><stop offset="100%" stopColor={c} stopOpacity="0.05" /></linearGradient></defs>
{!morphed ? (<g>
<rect x="115" y="40" width="50" height="180" rx="4" fill="url(#twr)" stroke={c} strokeWidth="1" opacity="0.6" />
{[0,1,2,3,4,5].map(function(i) { return <line key={i} x1="120" y1={55+i*28} x2="160" y2={55+i*28} stroke={c} strokeWidth="0.7" opacity="0.15" />; })}
<line x1="130" y1="38" x2="150" y2="38" stroke={c} strokeWidth="2" opacity="0.3" />
<circle cx="140" cy="140" r="6" fill={c} opacity="0.15"><animate attributeName="opacity" values="0.1;0.25;0.1" dur="3s" repeatCount="indefinite" /></circle>
</g>) : (<g style={{ animation: "riseUp 0.6s ease" }}>
<rect x="115" y="40" width="50" height="180" rx="4" fill="url(#twr)" opacity="0.2" />
{[0,1,2,3,4,5,6,7].map(function(i) {
var x = 110 + Math.random() * 60; var y = 50 + i * 22; var rot = -30 + Math.random() * 60; var dx = (Math.random()-0.5)*40;
return <rect key={"f"+i} x={x} y={y} width={6+Math.random()*8} height={4+Math.random()*6} rx="1" fill={c} opacity="0.25"
transform={"rotate("+rot+" "+x+" "+y+")"}>
<animate attributeName="x" values={x+";"+String(x+dx)+";"+(x+dx*1.5)} dur={(2+i*0.3)+"s"} fill="freeze" />
<animate attributeName="opacity" values="0.3;0.15;0.05" dur={(2+i*0.3)+"s"} fill="freeze" />
</rect>;
})}
{[0,1,2].map(function(i) { return <circle key={"sp"+i} cx={120+i*20} cy={230-i*10} r="3" fill={c} opacity="0.4">
<animate attributeName="cy" values={(230-i*10)+";"+(240-i*10)+";"+(230-i*10)} dur={(2+i*0.5)+"s"} repeatCount="indefinite" />
</circle>; })}
<line x1="115" y1="220" x2="165" y2="220" stroke={c} strokeWidth="1" opacity="0.2" />
<circle cx="140" cy="240" r="8" fill={c} opacity="0.2"><animate attributeName="r" values="6;12;6" dur="3s" repeatCount="indefinite" /></circle>
<circle cx="140" cy="240" r="3" fill={c} opacity="0.6"><animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite" /></circle>
<text x="140" y="270" textAnchor="middle" fontSize="10" fill={c} fontFamily="DM Sans" opacity="0.4" letterSpacing="0.15em">WHAT REMAINS IS REAL</text>
</g>)}
</svg>;
}

function ArchDescent({ morphed, color }) {
var c = color || "#6BB8FF";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
<defs><radialGradient id="cave"><stop offset="0%" stopColor={c} stopOpacity="0.02" /><stop offset="80%" stopColor={c} stopOpacity="0.08" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient></defs>
<path d="M 60 80 Q 70 180 140 230 Q 210 180 220 80" fill="url(#cave)" stroke={c} strokeWidth="1" opacity="0.15" />
{!morphed ? (<g>
<circle cx="140" cy="50" r="6" fill={c} opacity="0.5" />
<circle cx="140" cy="50" r="12" fill="none" stroke={c} strokeWidth="0.5" opacity="0.2" />
{[0,1,2].map(function(i) { return <circle key={i} cx={140} cy={80+i*35} r="2" fill={c} opacity={0.3-i*0.08}>
<animate attributeName="opacity" values={(0.15-i*0.04)+";"+(0.35-i*0.04)+";"+(0.15-i*0.04)} dur={(2+i*0.5)+"s"} repeatCount="indefinite" />
</circle>; })}
<text x="140" y="270" textAnchor="middle" fontSize="10" fill={c} fontFamily="DM Sans" opacity="0.25" letterSpacing="0.15em">GOING DOWN</text>
</g>) : (<g style={{ animation: "riseUp 1s ease" }}>
{[0,1,2,3,4].map(function(i) { return <circle key={i} cx={140} cy={60+i*35} r="2" fill={c} opacity={0.1+i*0.05}>
<animate attributeName="opacity" values={(0.05+i*0.03)+";"+(0.2+i*0.05)+";"+(0.05+i*0.03)} dur={(1.5+i*0.3)+"s"} repeatCount="indefinite" />
</circle>; })}
<circle cx="140" cy="210" r="25" fill={c} opacity="0.06"><animate attributeName="r" values="22;30;22" dur="3s" repeatCount="indefinite" /></circle>
<circle cx="140" cy="210" r="10" fill={c} opacity="0.15"><animate attributeName="r" values="8;14;8" dur="2.5s" repeatCount="indefinite" /></circle>
<circle cx="140" cy="210" r="4" fill={c} opacity="0.7"><animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" /></circle>
{[0,1,2,3,4,5].map(function(i) {
var a = i * 60 * Math.PI / 180; return <line key={"r"+i} x1={140+Math.cos(a)*15} y1={210+Math.sin(a)*15} x2={140+Math.cos(a)*35} y2={210+Math.sin(a)*35}
stroke={c} strokeWidth="1" opacity="0.2" strokeLinecap="round">
<animate attributeName="opacity" values="0.1;0.35;0.1" dur={(1.8+i*0.3)+"s"} repeatCount="indefinite" />
</line>;
})}
<text x="140" y="268" textAnchor="middle" fontSize="10" fill={c} fontFamily="DM Sans" opacity="0.5" letterSpacing="0.15em">FOUND SOMETHING</text>
</g>)}
</svg>;
}

function ArchWeaver({ morphed, color }) {
var c = color || "#7DB7AE";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
{!morphed ? (<g>
{[0,1,2,3,4,5].map(function(i) {
var y = 50 + i * 35;
return <path key={i} d={"M 50 "+y+" Q "+(100+(i%2===0?-20:20))+" "+(y+15)+" 140 "+y+" Q "+(180+(i%2===0?20:-20))+" "+(y+15)+" 230 "+y}
fill="none" stroke={c} strokeWidth="1" opacity="0.15" strokeLinecap="round" />;
})}
{[0,1,2].map(function(i) { return <circle key={i} cx={90+i*50} cy={100+i*25} r="2" fill={c} opacity="0.2" />; })}
</g>) : (<g style={{ animation: "riseUp 0.8s ease" }}>
{[0,1,2,3,4,5,6].map(function(i) {
var y = 40 + i * 30;
return <path key={i} d={"M 50 "+y+" Q "+(95+(i%2===0?-15:15))+" "+(y+(i%2===0?-12:12))+" 140 "+y+" Q "+(185+(i%2===0?15:-15))+" "+(y+(i%2===0?12:-12))+" 230 "+y}
fill="none" stroke={c} strokeWidth={1.5+i*0.15} opacity={0.15+i*0.06} strokeLinecap="round">
<animate attributeName="d" values={
"M 50 "+y+" Q "+(95+(i%2===0?-15:15))+" "+(y+(i%2===0?-12:12))+" 140 "+y+" Q "+(185+(i%2===0?15:-15))+" "+(y+(i%2===0?12:-12))+" 230 "+y+";"+
"M 50 "+y+" Q "+(95+(i%2===0?-20:20))+" "+(y+(i%2===0?-16:16))+" 140 "+(y+2)+" Q "+(185+(i%2===0?20:-20))+" "+(y+(i%2===0?16:-16))+" 230 "+y+";"+
"M 50 "+y+" Q "+(95+(i%2===0?-15:15))+" "+(y+(i%2===0?-12:12))+" 140 "+y+" Q "+(185+(i%2===0?15:-15))+" "+(y+(i%2===0?12:-12))+" 230 "+y
} dur={(4+i*0.5)+"s"} repeatCount="indefinite" />
</path>;
})}
{[0,1,2,3,4].map(function(i) {
return <circle key={"kn"+i} cx={70+i*40} cy={60+i*35+(i%2===0?0:15)} r={3+i*0.5} fill={c} opacity={0.3+i*0.08}>
<animate attributeName="opacity" values={(0.2+i*0.05)+";"+(0.6+i*0.05)+";"+(0.2+i*0.05)} dur={(1.5+i*0.4)+"s"} repeatCount="indefinite" />
</circle>;
})}
<text x="140" y="268" textAnchor="middle" fontSize="10" fill={c} fontFamily="DM Sans" opacity="0.4" letterSpacing="0.15em">THE PATTERN HOLDS</text>
</g>)}
</svg>;
}

function ArchPlanets({ morphed, color }) {
var c = color || "#FFD700";
var orbits = [{r:35,s:8,d:10,col:c},{r:60,s:5,d:16,col:"#6BB8FF"},{r:85,s:6,d:24,col:"#FF6B9D"},{r:110,s:4,d:35,col:"#6BFFB8"}];
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
{!morphed ? (<g>
<circle cx="140" cy="140" r="6" fill={c} opacity="0.3" />
{orbits.map(function(o,i) { return <g key={i}>
<circle cx="140" cy="140" r={o.r} fill="none" stroke={o.col} strokeWidth="0.5" opacity="0.08" strokeDasharray="4 8" />
<circle cx={140+o.r} cy="140" r={o.s*0.6} fill={o.col} opacity="0.2" />
</g>; })}
</g>) : (<g style={{ animation: "riseUp 0.8s ease" }}>
<circle cx="140" cy="140" r="10" fill={c} opacity="0.6"><animate attributeName="r" values="8;12;8" dur="3s" repeatCount="indefinite" /></circle>
<circle cx="140" cy="140" r="20" fill={c} opacity="0.08"><animate attributeName="r" values="18;25;18" dur="3s" repeatCount="indefinite" /></circle>
{orbits.map(function(o,i) { return <g key={i}>
<circle cx="140" cy="140" r={o.r} fill="none" stroke={o.col} strokeWidth="0.8" opacity="0.15" />
<circle cx={140+o.r} cy="140" r={o.s} fill={o.col} opacity="0.6">
<animateTransform attributeName="transform" type="rotate" from="0 140 140" to="360 140 140" dur={o.d+"s"} repeatCount="indefinite" />
<animate attributeName="r" values={o.s+";"+(o.s+2)+";"+o.s} dur="2s" repeatCount="indefinite" />
</circle>
</g>; })}
</g>)}
</svg>;
}

function ArchPhoenix({ morphed, color }) {
var c = color || "#E84393";
return <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 240 }}>
<defs>
<radialGradient id="pfire"><stop offset="0%" stopColor={c} stopOpacity="0.4" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient>
<linearGradient id="pfeath" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={c} stopOpacity="0.1" /><stop offset="100%" stopColor={c} stopOpacity="0.5" /></linearGradient>
</defs>
{!morphed ? (<g>
<circle cx="140" cy="210" r="25" fill="url(#pfire)" opacity="0.3" />
{[0,1,2,3,4].map(function(i) { var x = 120 + i * 10; return <line key={i} x1={x} y1="210" x2={x} y2={200-i*2} stroke={c} strokeWidth="1" opacity={0.1+i*0.03}>
<animate attributeName="y2" values={(200-i*2)+";"+(195-i*3)+";"+(200-i*2)} dur={(1.5+i*0.3)+"s"} repeatCount="indefinite" />
</line>; })}
<circle cx="140" cy="210" r="8" fill={c} opacity="0.15" />
<circle cx="140" cy="210" r="3" fill={c} opacity="0.3"><animate attributeName="opacity" values="0.2;0.5;0.2" dur="2s" repeatCount="indefinite" /></circle>
</g>) : (<g style={{ animation: "riseUp 1s ease" }}>
<circle cx="140" cy="180" r="45" fill="url(#pfire)"><animate attributeName="r" values="40;50;40" dur="2s" repeatCount="indefinite" /></circle>
<path d="M 140 170 Q 80 120 60 80" fill="none" stroke={c} strokeWidth="2.5" opacity="0.6" strokeLinecap="round">
<animate attributeName="d" values="M 140 170 Q 80 120 60 80;M 140 160 Q 75 105 50 60;M 140 170 Q 80 120 60 80" dur="2.5s" repeatCount="indefinite" />
</path>
<path d="M 140 170 Q 200 120 220 80" fill="none" stroke={c} strokeWidth="2.5" opacity="0.6" strokeLinecap="round">
<animate attributeName="d" values="M 140 170 Q 200 120 220 80;M 140 160 Q 205 105 230 60;M 140 170 Q 200 120 220 80" dur="2.5s" repeatCount="indefinite" />
</path>
<path d="M 110 130 Q 125 80 140 50 Q 155 80 170 130" fill="url(#pfeath)" stroke={c} strokeWidth="1.5" opacity="0.7">
<animate attributeName="d" values="M 110 130 Q 125 80 140 50 Q 155 80 170 130;M 105 125 Q 122 70 140 40 Q 158 70 175 125;M 110 130 Q 125 80 140 50 Q 155 80 170 130" dur="2.5s" repeatCount="indefinite" />
</path>
{[0,1,2,3].map(function(i) { var x = 125+i*10; return <circle key={i} cx={x} cy={100+i*15} r={2+i} fill={c} opacity={0.3+i*0.1}>
<animate attributeName="opacity" values={(0.2+i*0.1)+";"+(0.6+i*0.1)+";"+(0.2+i*0.1)} dur={(1+i*0.3)+"s"} repeatCount="indefinite" />
</circle>; })}
<circle cx="140" cy="65" r="6" fill={c} opacity="0.8"><animate attributeName="opacity" values="0.5;1;0.5" dur="1.2s" repeatCount="indefinite" /></circle>
</g>)}
</svg>;
}

function ArchetypeGlyph({ name, sourceNodes, energy, morphed, size }) {
var sz = size || 260;
var cx = sz / 2, cy = sz / 2;

var hash = 0;
var nm = (name || "pattern").toLowerCase();
for (var i = 0; i < nm.length; i++) { hash = ((hash << 5) - hash) + nm.charCodeAt(i); hash = hash & hash; }
hash = Math.abs(hash);

var sides = 3 + (hash % 5); 
var layers = 2 + (hash % 3); 
var baseRotation = (hash % 60) - 30; 
var pulseSpeed = 4 + (hash % 3);

var palette = ["#E84393","#6BFFB8","#B86BFF","#6BB8FF","#ff6090","#FFB86B","#50c0ff","#f0c860","#c070f0","#4ae88a"];
var c1 = palette[hash % palette.length];
var c2 = palette[(hash + 3) % palette.length];
var c3 = palette[(hash + 7) % palette.length];

var energyMap = { heavy: 8, electric: 1.5, shattered: 2, still: 10, quiet: 7, warm: 5, grounded: 6, restless: 2, tender: 6, fierce: 1.8 };
var animSpeed = energyMap[energy] || pulseSpeed;

var rings = [];
for (var L = 0; L < layers; L++) {
var r = 30 + L * 28;
var pts = [];
var n = sides + L; 
for (var p = 0; p < n; p++) {
var angle = (p / n) * Math.PI * 2 + (baseRotation * Math.PI / 180) + (L * 0.2);
pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle: angle });
}
rings.push({ r: r, points: pts, color: L === 0 ? c1 : L === 1 ? c2 : c3 });
}

var nodePositions = (sourceNodes || []).slice(0, sides).map(function(label, i) {
var angle = (i / Math.max(sides, 1)) * Math.PI * 2 + (baseRotation * Math.PI / 180);
var r = 30 + (layers - 1) * 28 + 22;
return { label: label, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
});

var uid = "g" + hash;

return (
<svg viewBox={"0 0 " + sz + " " + sz} style={{ width: "100%", maxWidth: sz }}>
<defs>
<radialGradient id={uid + "glow"}>
<stop offset="0%" stopColor={c1} stopOpacity={morphed ? "0.35" : "0.2"} />
<stop offset="100%" stopColor={c1} stopOpacity="0" />
</radialGradient>
<filter id={uid + "blur"}><feGaussianBlur stdDeviation="3" /></filter>
</defs>

<circle cx={cx} cy={cy} r={morphed ? 90 : 65} fill={"url(#" + uid + "glow)"}>
<animate attributeName="r" values={(morphed ? "85;95;85" : "60;70;60")} dur={animSpeed + "s"} repeatCount="indefinite" />
</circle>

{rings.map(function(ring, ri) {
return <g key={ri}>
<circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ring.color} strokeWidth={ri === 0 ? "1.5" : "0.5"} opacity={morphed ? 0.25 : 0.1} strokeDasharray={ri > 0 ? "3 6" : "none"}>
<animate attributeName="r" values={(ring.r - 2) + ";" + (ring.r + 2) + ";" + (ring.r - 2)} dur={(animSpeed + ri) + "s"} repeatCount="indefinite" />
</circle>

{ring.points.map(function(pt, pi) {
var dotSize = ri === 0 ? 4 : 2.5;
return <circle key={pi} cx={pt.x} cy={pt.y} r={dotSize} fill={ring.color} opacity={morphed ? 0.7 : 0.35}>
<animate attributeName="opacity" values={(morphed ? "0.5;0.9;0.5" : "0.2;0.5;0.2")} dur={(animSpeed * 0.7 + pi * 0.3) + "s"} repeatCount="indefinite" />
<animate attributeName="r" values={(dotSize - 0.5) + ";" + (dotSize + 1) + ";" + (dotSize - 0.5)} dur={(animSpeed + pi * 0.2) + "s"} repeatCount="indefinite" />
</circle>;
})}

{ring.points.map(function(pt, pi) {
var next = ring.points[(pi + 1) % ring.points.length];
return <line key={"l" + pi} x1={pt.x} y1={pt.y} x2={next.x} y2={next.y} stroke={ring.color} strokeWidth="0.8" opacity={morphed ? 0.2 : 0.08}>
<animate attributeName="opacity" values={(morphed ? "0.1;0.3;0.1" : "0.04;0.12;0.04")} dur={(animSpeed + 1) + "s"} repeatCount="indefinite" />
</line>;
})}
</g>;
})}

{rings.length >= 2 && rings[0].points.map(function(pt, pi) {
var outerRing = rings[rings.length - 1];
var oi = pi % outerRing.points.length;
var opt = outerRing.points[oi];
return <line key={"cr" + pi} x1={pt.x} y1={pt.y} x2={opt.x} y2={opt.y} stroke={c1} strokeWidth="0.5" opacity={morphed ? 0.12 : 0.04} strokeDasharray="2 4">
<animate attributeName="opacity" values={(morphed ? "0.06;0.18;0.06" : "0.02;0.08;0.02")} dur={(animSpeed + 2) + "s"} repeatCount="indefinite" />
</line>;
})}

<circle cx={cx} cy={cy} r={morphed ? 8 : 5} fill={c1} opacity={morphed ? 0.6 : 0.3}>
<animate attributeName="r" values={(morphed ? "6;10;6" : "4;7;4")} dur={animSpeed + "s"} repeatCount="indefinite" />
<animate attributeName="opacity" values={(morphed ? "0.4;0.8;0.4" : "0.2;0.4;0.2")} dur={animSpeed + "s"} repeatCount="indefinite" />
</circle>
<circle cx={cx} cy={cy} r={morphed ? 3 : 2} fill="#fff" opacity="0.6" />

{morphed && nodePositions.map(function(np, ni) {
return <text key={ni} x={np.x} y={np.y + 4} textAnchor="middle" fontSize="9" fill={c2} fontFamily="DM Sans" opacity="0.4" letterSpacing="0.08em">
{np.label}
</text>;
})}
</svg>
);
}

var ARCH_REGISTRY = {
chrysalis: { name: "Imaginal Cells", icon: "??", color: "#4ae88a", bg: "linear-gradient(160deg, #0D1A12 0%, #1a3a2a 40%, #4ae88a44 100%)",
phases: { consuming: "Still building mass. The hunger is the work.", dissolving: "The old form can't hold. Dissolution IS the work.", clustering: "Imaginal cells found each other. Something coherent forming.", emergence: "Wings taking shape. The caterpillar wouldn't recognize what's coming." },
Viz: ChrysalisButterfly },
tower: { name: "The Tower", icon: "??", color: "#ff8a3a", bg: "linear-gradient(160deg, #1A0D06 0%, #3a1a08 40%, #ff8a3a44 100%)",
phases: { trembling: "Cracks showing. Something isn't as solid as you believed.", falling: "Coming down. Let it fall. Can't hold what wasn't real.", rubble: "Standing in the aftermath. Clearest view you've had.", clearing: "Ground is bare. Now you can build on what's real." },
Viz: ArchTower },
kintsugi: { name: "Kintsugi", icon: "✦", color: "#e8b830", bg: "linear-gradient(160deg, #1A1408 0%, #2a2010 40%, #e8b83044 100%)",
phases: { breaking: "Something broke. The instinct is to hide the crack. Don't.", holding: "Looking at the pieces. Not fixing yet — just seeing.", filling: "Gold poured into the break. The repair is the art.", whole: "More beautiful than before it shattered. The scar shines." },
Viz: ArchMagician },
dark_night: { name: "Dark Night", icon: "??", color: "#9070d0", bg: "linear-gradient(160deg, #0D0A18 0%, #14102a 40%, #9070d044 100%)",
phases: { trigger: "Old framework shattered. What made sense doesn't anymore.", crisis: "Everything questioned. Who are you if not what you believed?", transformation: "In the wreckage, a different way of seeing emerges.", emergence: "Old meaning gone. Something deeper replaced it." },
Viz: ArchMagician },
persephone: { name: "Persephone", icon: "??", color: "#c070f0", bg: "linear-gradient(160deg, #0D0618 0%, #2a1040 40%, #c070f044 100%)",
phases: { descending: "Something pulled you under. Not punishment — initiation.", underworld: "Learning the rules of a realm you didn't choose.", pomegranate: "Ate the seeds. Can't unknow it. The wound became wisdom.", returning: "Not the maiden anymore. The queen." },
Viz: ArchThreshold },
phoenix: { name: "The Phoenix", icon: "??", color: "#ff5030", bg: "linear-gradient(160deg, #1A0606 0%, #3a0a08 40%, #ff503044 100%)",
phases: { burning: "Let it burn. Not everything survives this version of you.", ash: "What's left is what was always real.", stirring: "Movement in the ash. Not repetition — reinvention.", rising: "Airborne again. Same matter, utterly reconfigured." },
Viz: ArchTower },
hermit: { name: "The Hermit", icon: "??", color: "#f0c860", bg: "linear-gradient(160deg, #0D0C10 0%, #1a1820 40%, #f0c86044 100%)",
phases: { withdrawing: "Stepped away. Something needs quiet.", listening: "A signal getting clearer.", seeing: "The lamp illuminates what was always there.", returning: "Carrying the light back." },
Viz: SeedToTree },
sisyphus: { name: "Sisyphus", icon: "??", color: "#c0a078", bg: "linear-gradient(160deg, #0D0B08 0%, #201c18 40%, #c0a07844 100%)",
phases: { pushing: "Same weight. Same hill. Something in your grip changed.", rolling_back: "Came down again. What do you notice on the walk back?", pausing: "Stopped mid-slope. Choosing to feel it.", meaning: "Boulder didn't get lighter. You got stronger." },
Viz: ArchSisyphus },
magician: { name: "The Magician", icon: "✧", color: "#a060ff", bg: "linear-gradient(160deg, #0D0818 0%, #1c1030 40%, #a060ff44 100%)",
phases: { awakening: "Realizing you have the tools. Always there.", practicing: "Testing what transforms.", transforming: "The transmutation is happening.", mastery: "Seeing what's possible in what already exists." },
Viz: ArchMagician },
lover: { name: "The Lover", icon: "??", color: "#ff6090", bg: "linear-gradient(160deg, #1A0810 0%, #2a1020 40%, #ff609044 100%)",
phases: { guarding: "Walls keeping out more than danger.", opening: "A crack in the armor. The bravest thing.", feeling: "Letting it all in.", merging: "Connection isn't losing yourself." },
Viz: ChrysalisButterfly },
star: { name: "The Star", icon: "⭐", color: "#50c0ff", bg: "linear-gradient(160deg, #060C18 0%, #0c1830 40%, #50c0ff44 100%)",
phases: { darkness: "Dark. But a point of light you haven't noticed.", glimmer: "Hope isn't optimism. It's stubbornness.", pouring: "Quietly tending what's left.", shining: "Effortless, steady, real." },
Viz: SeedToTree },
threshold: { name: "The Threshold", icon: "??", color: "#b8a880", bg: "linear-gradient(160deg, #0D0D0A 0%, #181814 40%, #b8a88044 100%)",
phases: { approaching: "Edge of something. The old room shrinking.", standing: "At the door. Not through yet.", crossing: "One foot on each side.", arrived: "Other side. The room is bigger." },
Viz: ArchThreshold },
weaver: { name: "The Weaver", icon: "??", color: "#a080c0", bg: "linear-gradient(160deg, #0D0A10 0%, #1a1420 40%, #a080c044 100%)",
phases: { gathering: "Threads from different parts collecting.", seeing: "A pattern emerging.", weaving: "Actively connecting them.", wearing: "The pattern is complete enough to wear." },
Viz: ArchMagician },
tree: { name: "The Tree", icon: "??", color: "#6BFFB8", bg: "linear-gradient(160deg, #0A1A12 0%, #0D2E1A 40%, #6BFFB844 100%)",
phases: { seed: "Something planted.", roots: "Going deep before going up.", growing: "Slow, steady expansion.", canopy: "The patience paid off." },
Viz: SeedToTree },
descent: { name: "The Descent", icon: "⬇", color: "#6BB8FF", bg: "linear-gradient(160deg, #060C1A 0%, #0D1A2E 40%, #6BB8FF44 100%)",
phases: { approaching: "Edge of the underworld.", entering: "Going under.", depths: "In the deepest place.", returning: "Rising with what you found." },
Viz: ArchThreshold },
planets: { name: "Forces in Orbit", icon: "??", color: "#FFB86B", bg: "linear-gradient(160deg, #1A120A 0%, #2E1A0D 40%, #FFB86B44 100%)",
phases: { approaching: "Forces circling.", conjunction: "Aligned.", opposition: "Pulling apart.", integration: "New orbit." },
Viz: ArchSisyphus },
};

function CrossSessionCard({ pastSessions, currentSd, advance }) {
var [view, setView] = React.useState("loading"); 
var [insight, setInsight] = React.useState(null);
var [sliderVal, setSliderVal] = React.useState(50);
var [sliderDone, setSliderDone] = React.useState(false);

var sd = currentSd || {};
var allSessions = pastSessions.slice(-4).concat([{
themes: (sd.themes || []).map(function(t) { return { label: t.label, weight: t.weight || 1 }; }),
alchemy: sd.alchemy || null,
tension: sd.tension || null,
mapResponses: {},
}]);
var N = allSessions.length;

var themeMap = {};
allSessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
if (!t.label) return;
if (!themeMap[t.label]) themeMap[t.label] = [];
themeMap[t.label].push({ si: si, w: t.weight || 1 });
});
});

var persistent = [], growing = [], chrysalis = [], arriving = [];
Object.keys(themeMap).forEach(function(label) {
var entries = themeMap[label];
var inCurrent = entries.some(function(e) { return e.si === N - 1; });
var cnt = entries.length;
var firstW = entries[0].w, lastW = entries[entries.length-1].w;
if (cnt >= 3 && inCurrent) persistent.push({ label: label, entries: entries });
else if (cnt >= 2 && inCurrent && lastW > firstW + 0.3) growing.push({ label: label, entries: entries });
else if (cnt >= 2 && !inCurrent) chrysalis.push({ label: label });
else if (cnt === 1 && inCurrent && lastW > 0.6) arriving.push({ label: label, w: lastW });
});

var connFreq = {};
allSessions.forEach(function(s) {
Object.keys(s.mapResponses || {}).forEach(function(k) {
var r = s.mapResponses[k];
if (r && (r.value === "yes" || r.value === "partly")) connFreq[k] = (connFreq[k] || 0) + 1;
});
});
var diamondKey = Object.keys(connFreq).sort(function(a,b){return connFreq[b]-connFreq[a];})[0];
var diamondParts = diamondKey ? diamondKey.split("::") : null;
var silverLining = arriving[0] || null;

var ALCH_COLORS = { nigredo: "#666680", albedo: "#AAAACC", citrinitas: "#D6B26D", rubedo: "#E84393" };
var ALCH_LABELS = { nigredo: "dissolving", albedo: "clearing", citrinitas: "forming", rubedo: "arriving" };
var alchArc = allSessions.map(function(s) { return s.alchemy ? s.alchemy.stage : null; });
var currentAlch = alchArc[alchArc.length-1];

React.useEffect(function() {
if (pastSessions.length < 1) { setView("stats"); return; }

var sumLines = allSessions.map(function(s, i) {
var th = (s.themes || []).map(function(t) { return t.label + (t.w > 3 || t.weight > 3 ? "*" : ""); }).join(", ");
var al = s.alchemy ? s.alchemy.stage : "";
var tn = s.tension ? "[" + s.tension.a + " vs " + s.tension.b + "]" : "";
var fb = s.cardFeedback ? Object.keys(s.cardFeedback).map(function(k) {
var f = s.cardFeedback[k];
var score = f.slider !== undefined ? (f.slider >= 68 ? k + "=landed" : f.slider <= 32 ? k + "=pushed_away" : null) : null;
return score;
}).filter(Boolean).join(",") : "";
return "Session " + (i+1) + ": [" + th + "]" + (al ? " " + al : "") + (tn ? " tension=" + tn : "") + (fb ? " feedback={" + fb + "}" : "");
}).join("\n");

var analysisBits = [];
if (persistent.length) analysisBits.push("Persistent: " + persistent.map(function(t){return t.label;}).join(", "));
if (growing.length) analysisBits.push("Growing: " + growing.map(function(t){return t.label;}).join(", "));
if (chrysalis.length) analysisBits.push("In chrysalis: " + chrysalis.map(function(t){return t.label;}).join(", "));
if (diamondParts) analysisBits.push("Most confirmed link: " + diamondParts[0] + " \u2194 " + diamondParts[1]);

var prompt = "You are reading someone's psychological sessions over time.\n\n" +
"DATA:\n" + sumLines + "\n\n" +
(analysisBits.length ? "PATTERNS DETECTED:\n" + analysisBits.join("\n") + "\n\n" : "") +
"TASK: Find the ONE most revealing cross-session pattern. The insight that, if named, would feel like something clicked into place.\n\n" +
"If there is a clear pattern: respond {\"has_insight\":true,\"insight\":\"...\",\"pattern_name\":\"THE ...\",\"color\":\"#hex\"}\n" +
"insight: 1-2 sentences, direct. Start with 'you'. No hedging.\n" +
"pattern_name: 2-3 caps words\n" +
"color: a hex that feels emotionally right for this pattern\n\n" +
"If too sparse (only 1 prior session or no clear signal): respond {\"has_insight\":false}\n\n" +
"Respond ONLY with valid JSON, no markdown.";

callClaudeClient(prompt, "", 400)
.then(function(res) {
var d = parseJSON(res);
if (d && d.has_insight && d.insight) { setInsight(d); setView("poster"); }
else setView("stats");
})
.catch(function() { setView("stats"); });
}, []);

var accent = insight ? (insight.color || "#B86BFF") : "#B86BFF";
var topColor = (sd.themes && sd.themes[0]) ? (sd.themes[0].color || "#E84393") : "#E84393";

if (view === "loading") return (
<FC>
<FieldParticles color="#B86BFF" count={14}/>
<BreathingOrb color="#B86BFF" size={64}/>
<div style={{ marginTop: 28, fontSize: 11, letterSpacing: "0.38em", textTransform: "uppercase",
color: "rgba(184,107,255,0.45)", fontFamily: FB, animation: "pulse 2s ease infinite" }}>
reading the arc
</div>
</FC>
);

if (view === "poster") return (
<div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column",
alignItems: "center", justifyContent: "center", padding: "56px 28px 40px", overflow: "hidden" }}>
<FieldParticles color={accent} count={22}/>

<svg style={{ position: "absolute", opacity: 0.055, width: "100%", height: "100%", pointerEvents: "none" }}
viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
{[0, 30, 60, 90].map(function(rot, i) {
return <polygon key={i} points="200,70 330,300 200,530 70,300" fill="none" stroke={accent}
strokeWidth="1.2" transform={"rotate(" + rot + " 200 300)"} opacity={0.55 - i * 0.1}/>;
})}
<circle cx="200" cy="300" r="115" fill="none" stroke={accent} strokeWidth="0.6" opacity="0.4"/>
<circle cx="200" cy="300" r="68" fill="none" stroke={accent} strokeWidth="0.4" opacity="0.3"/>
<circle cx="200" cy="300" r="32" fill="none" stroke={accent} strokeWidth="0.3" opacity="0.25"/>
</svg>

<svg viewBox="0 0 120 144" style={{ width: 86, height: 104, marginBottom: 28, zIndex: 1,
filter: "drop-shadow(0 0 22px " + accent + "66)",
animation: "nodeBreathe 6s ease-in-out infinite" }}>
<defs>
<linearGradient id="dia1" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stopColor="white" stopOpacity="0.18"/>
<stop offset="100%" stopColor={accent} stopOpacity="0.85"/>
</linearGradient>
<linearGradient id="dia2" x1="0%" y1="100%" x2="0%" y2="0%">
<stop offset="0%" stopColor={accent} stopOpacity="0.35"/>
<stop offset="100%" stopColor={accent} stopOpacity="0.9"/>
</linearGradient>
</defs>
<polygon points="60,6 102,54 60,46 18,54" fill="url(#dia1)"/>
<polygon points="60,6 102,54 60,46" fill="white" opacity="0.08"/>
<polygon points="60,6 18,54 60,46" fill={accent} opacity="0.55"/>
<polygon points="18,54 60,46 102,54 60,138" fill="url(#dia2)"/>
<polygon points="18,54 60,46 60,138" fill={accent} opacity="0.4"/>
<polygon points="102,54 60,46 60,138" fill="white" opacity="0.04"/>
<circle cx="60" cy="6" r="3" fill="white" opacity="0.95"/>
<circle cx="60" cy="138" r="2" fill={accent} opacity="0.7"/>
</svg>

<div style={{ fontSize: 9, letterSpacing: "0.5em", color: accent + "99", fontFamily: FB,
textTransform: "uppercase", marginBottom: 16, zIndex: 1 }}>
{insight.pattern_name || "THE PATTERN"}
</div>

<div style={{ fontSize: 18, color: "rgba(255,255,255,0.92)", fontFamily: FD, fontStyle: "italic",
lineHeight: 1.68, maxWidth: 300, marginBottom: 36, zIndex: 1,
animation: "riseUp 0.8s ease 0.1s both" }}>
{insight.insight}
</div>

{!sliderDone ? (
<div data-noadvance="true" style={{ width: "100%", maxWidth: 290, zIndex: 1 }}>
<div style={{ fontSize: 10, letterSpacing: "0.28em", color: "rgba(255,255,255,0.28)",
fontFamily: FB, textTransform: "uppercase", marginBottom: 14, textAlign: "center" }}>
does this land?
</div>
<SpectrumSlider color={accent} value={sliderVal} poleA="not quite" poleB="that\u2019s it"
onSet={function(v) { setSliderVal(v); setSliderDone(true); }}/>
</div>
) : (
<div style={{ zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
<div style={{ fontSize: 12, color: accent + "99", fontFamily: FB, letterSpacing: "0.18em" }}>
{sliderVal >= 70 ? "marked \u2713" : sliderVal <= 30 ? "noted \u2014 not quite" : "partially"}
</div>
<button data-noadvance="true" onClick={function(e) { e.stopPropagation(); setView("stats"); }}
style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
borderRadius: 20, padding: "8px 22px", color: "rgba(255,255,255,0.45)", fontSize: 11,
fontFamily: FB, cursor: "pointer", letterSpacing: "0.18em" }}>
view the arc \u2192
</button>
</div>
)}
</div>
);

var stagnant = Object.keys(themeMap).filter(function(l) {
var e = themeMap[l];
if (e.length < 3) return false;
return Math.abs(e[e.length-1].w - e[0].w) < 0.3;
});

return (
<div style={{ position: "absolute", inset: 0, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
<FieldParticles color={topColor} count={10}/>
<div style={{ maxWidth: 380, margin: "0 auto", padding: "56px 24px 48px", position: "relative", zIndex: 1 }}>

<div style={{ fontSize: 9, letterSpacing: "0.5em", color: "rgba(255,255,255,0.28)",
fontFamily: FB, textTransform: "uppercase", marginBottom: 32, textAlign: "center" }}>THE ARC</div>

<div style={{ marginBottom: 36 }}>
<div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 52 }}>
{allSessions.map(function(s, si) {
var al = s.alchemy ? s.alchemy.stage : null;
var col = al ? (ALCH_COLORS[al] || "#555") : topColor + "55";
var h = 10 + (si / Math.max(N - 1, 1)) * 38;
var isLast = si === N - 1;
return (
<div key={si} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
<div style={{ width: "100%", height: h, borderRadius: 3, background: col,
opacity: isLast ? 1 : 0.5, animation: "riseUp 0.5s ease " + (si * 0.09) + "s both" }}/>
<div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", fontFamily: FB,
letterSpacing: "0.05em" }}>{si + 1}</div>
</div>
);
})}
</div>
{currentAlch && (
<div style={{ marginTop: 10, fontSize: 11, color: ALCH_COLORS[currentAlch] || topColor,
fontFamily: FB, letterSpacing: "0.2em" }}>
now: {ALCH_LABELS[currentAlch] || currentAlch}
</div>
)}
</div>

{(persistent.length > 0 || growing.length > 0) && (
<div style={{ marginBottom: 28, animation: "riseUp 0.6s ease 0.05s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.42em", color: "#6BFFB8", fontFamily: FB,
marginBottom: 12, textTransform: "uppercase" }}>\u2191 pulling forward</div>
<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
{persistent.concat(growing).slice(0, 6).map(function(t, i) {
var tc = (sd.themes || []).find(function(th) { return th.label === t.label; });
var col = tc ? tc.color : "#6BFFB8";
return <div key={t.label} style={{ padding: "6px 14px", borderRadius: 20,
background: col + "18", border: "1px solid " + col + "44",
fontSize: 12, color: col, fontFamily: FB, fontWeight: 600, letterSpacing: "0.06em",
animation: "riseUp 0.5s ease " + (i * 0.08) + "s both" }}>{t.label}</div>;
})}
</div>
</div>
)}

{diamondParts && (connFreq[diamondKey] || 0) >= 2 && (
<div style={{ marginBottom: 28, animation: "riseUp 0.6s ease 0.1s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.42em", color: "#FFD700", fontFamily: FB,
marginBottom: 12, textTransform: "uppercase" }}>\u25c6 diamond forming</div>
<div style={{ padding: "14px 18px", borderRadius: 12,
background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.18)" }}>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.72)", fontFamily: FD, fontStyle: "italic" }}>
{diamondParts[0]} \u2194 {diamondParts[1]}
</div>
<div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,215,0,0.5)", fontFamily: FB,
letterSpacing: "0.12em" }}>confirmed {connFreq[diamondKey]}\u00d7</div>
</div>
</div>
)}

{chrysalis.length > 0 && (
<div style={{ marginBottom: 28, animation: "riseUp 0.6s ease 0.15s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.42em", color: "#B86BFF", fontFamily: FB,
marginBottom: 12, textTransform: "uppercase" }}>\u25ce in chrysalis</div>
<div style={{ fontSize: 14, color: "rgba(184,107,255,0.72)", fontFamily: FD, fontStyle: "italic",
lineHeight: 1.6 }}>{chrysalis.slice(0, 3).map(function(t){return t.label;}).join(", ")}</div>
<div style={{ marginTop: 5, fontSize: 11, color: "rgba(184,107,255,0.38)", fontFamily: FB }}>
appeared. then went quiet. not gone.
</div>
</div>
)}

{silverLining && (
<div style={{ marginBottom: 28, animation: "riseUp 0.6s ease 0.2s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.42em", color: "#C8E6C9", fontFamily: FB,
marginBottom: 12, textTransform: "uppercase" }}>\u2736 silver lining</div>
<div style={{ padding: "12px 16px", borderRadius: 12,
background: "rgba(200,230,200,0.04)", border: "1px solid rgba(200,230,200,0.15)" }}>
<div style={{ fontSize: 15, color: "rgba(200,230,200,0.82)", fontFamily: FD, fontStyle: "italic" }}>
{silverLining.label}
</div>
<div style={{ marginTop: 4, fontSize: 10, color: "rgba(200,230,200,0.38)", fontFamily: FB,
letterSpacing: "0.1em" }}>new this session</div>
</div>
</div>
)}

{stagnant.length > 0 && (
<div style={{ marginBottom: 28, animation: "riseUp 0.6s ease 0.25s both" }}>
<div style={{ fontSize: 9, letterSpacing: "0.42em", color: "rgba(255,255,255,0.22)",
fontFamily: FB, marginBottom: 12, textTransform: "uppercase" }}>\u2014 holding still</div>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", fontFamily: FD, fontStyle: "italic" }}>
{stagnant.join(", ")}
</div>
<div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: FB }}>
consistent. not shifting. worth noticing.
</div>
</div>
)}

{insight && (
<div style={{ marginTop: 20, textAlign: "center" }}>
<button data-noadvance="true" onClick={function(e) { e.stopPropagation(); setView("poster"); }}
style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
borderRadius: 20, padding: "8px 22px", color: "rgba(255,255,255,0.3)", fontSize: 11,
fontFamily: FB, cursor: "pointer", letterSpacing: "0.18em" }}>
\u2190 the insight
</button>
</div>
)}

<div style={{ marginTop: 40, fontSize: 10, color: "rgba(255,255,255,0.14)", fontFamily: FB,
textAlign: "center", letterSpacing: "0.15em" }}>tap to continue</div>
</div>
</div>
);
}

function FC({ children }) {
return <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", height:"100%", padding:"60px 28px", textAlign:"center", position:"relative" }}>{children}</div>;
}
function FLabel({ color, children }) {
return <div style={{ fontSize:14, letterSpacing:"0.18em", fontWeight:700, color, marginBottom:20, fontFamily:FB, zIndex:1, textTransform:"uppercase" }}>{children}</div>;
}
function FHero({ size=42, color="white", children }) {
return <h1 style={{ fontSize:size, fontWeight:400, lineHeight:1.2, margin:0, color, fontFamily:FD, zIndex:1 }}>{children}</h1>;
}
function FBody({ color, style={}, children }) {
return <p style={{ fontSize:19, margin:0, lineHeight:1.6, fontFamily:FD, color, zIndex:1, ...style }}>{children}</p>;
}
function FTap({ color, children }) {
return <div style={{ fontSize:15, marginTop:24, fontFamily:FB, color, opacity:0.7, zIndex:1 }}>{children}</div>;
}
function FOrb({ color, children }) {
return <div style={{ width:72, height:72, borderRadius:"50%", background:`${color}22`, border:`2px solid ${color}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color, fontFamily:FB, fontWeight:500 }}>{children}</div>;
}

function DataPortrait({ themes }) {
var [active, setActive] = useState(null);
var rings = (themes || []).slice(0, 7).map(function(t, i) {
var base = 110 - i * 16;
return {
r: Math.max(16, base),
color: t.color || NC[i % NC.length],
width: 2 + (t.weight || 1) * 0.8,
dash: [8, 12, 4, 20, 6, 14][i % 6] + " " + [4, 8, 12, 4, 10, 6][i % 6],
speed: 30 + i * 12,
label: t.label || t.name || "",
weight: t.weight || 1,
};
});
var activeRing = active !== null ? rings[active] : null;
return (
<div data-noadvance="true" style={{ position:"relative", width:"100%", maxWidth:240 }}>
<svg viewBox="0 0 260 260" style={{ width:"100%", cursor:"pointer" }}
onClick={function(e){ e.stopPropagation(); setActive(null); }}>
{rings.map(function(ring, i) {
var isActive = active === i;
return <circle key={i} cx="130" cy="130" r={ring.r} fill="none"
stroke={ring.color} strokeWidth={isActive ? ring.width + 2 : ring.width}
strokeDasharray={ring.dash} strokeLinecap="round"
opacity={isActive ? 1 : 0.65}
style={{ cursor:"pointer" }}
onClick={function(e){ e.stopPropagation(); setActive(active === i ? null : i); }}>
<animateTransform attributeName="transform" type="rotate"
from="0 130 130" to={(i%2===0?"360":"-360")+" 130 130"}
dur={ring.speed+"s"} repeatCount="indefinite" />
</circle>;
})}
<circle cx="130" cy="130" r="6" fill="white" opacity="0.8" />
<circle cx="130" cy="130" r="12" fill="none" stroke="white" strokeWidth="0.5" opacity="0.3">
<animate attributeName="r" values="12;18;12" dur="3s" repeatCount="indefinite" />
</circle>
</svg>
{activeRing
? <div onClick={function(e){e.stopPropagation();setActive(null);}}
style={{ marginTop:14, padding:"14px 20px", borderRadius:14,
background:"rgba(8,10,20,0.92)",
border:"1.5px solid "+activeRing.color+"55",
boxShadow:"0 0 28px "+activeRing.color+"22",
animation:"riseUp 0.3s ease both", cursor:"pointer" }}>
<div style={{ fontSize:18, color:activeRing.color, fontFamily:FB, fontWeight:700, marginBottom:8 }}>{activeRing.label}</div>
<div style={{ height:4, borderRadius:2, background:"rgba(255,255,255,0.06)", marginBottom:8 }}>
<div style={{ height:"100%", width:Math.min(100,activeRing.weight/5*100)+"%", background:activeRing.color, borderRadius:2, transition:"width 0.4s ease" }} />
</div>
<div style={{ display:"flex", justifyContent:"space-between" }}>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", fontFamily:FB }}>weight {activeRing.weight.toFixed(1)}</div>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:FB }}>tap to close</div>
</div>
</div>
: <div style={{ textAlign:"center", marginTop:8, fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.1em" }}>
tap any ring
</div>
}
</div>
);
}

function saveSession(data) {
try {
var sessions = JSON.parse(localStorage.getItem(_sessionKey()) || "[]");
var themes = (data.themes || []).slice(0, 5).map(function(t) {
var lbl = String(t.label || "").trim();
var sd = (t.short_desc || t.why || "").slice(0, 80);
return { label: lbl, weight: t.weight || 1, short_desc: sd || undefined };
});
var avgWeight = themes.length > 0 ? themes.reduce(function(s, t) { return s + t.weight; }, 0) / themes.length : 0;
sessions.push({
date: new Date().toISOString(),
rawText: (data.rawText || "").slice(0, 4000),
sessionSummary: null,
archetypes: (data.archetypes || []).map(function(a) {
return {
name: a.name || a.key || "",
line: a.line || "",
key: a.classical_resonance || a.key || "",
source_nodes: a.source_nodes || [],
evolution_from: a.evolution_from || null,
};
}),
themes: themes,
mapTitle: data.map_title || "",
synthesis: (data.synthesis || "").slice(0, 1200),
tension: data.tension ? { a: data.tension.a, b: data.tension.b, text: (data.tension.text || "").slice(0, 500) } : null,
intensity: Math.round(avgWeight * 20) / 10,
arrival: data.arrival || null,
alchemy: data.alchemy ? { stage: data.alchemy.stage, evidence: (data.alchemy.evidence || "").slice(0, 400) } : null,
underneath: (data.underneath || []).slice(0, 2).map(function(u) { return (typeof u === "string" ? u : u.observation || "").slice(0, 400); }),
blind_spot: (data.blind_spot || "").slice(0, 500),
opening: (typeof data.opening === "string" ? data.opening : (data.opening || {}).text || "").slice(0, 500),
mapResponses: data.mapResponses || {},
cardFeedback: data.cardFeedback || {}, 
clarity: data.clarity || "",
descent: data.descent || null,
signals: data.signals || null,
reactions: data.reactions || {},
corrections: data.corrections || {},
revisedSynthesis: data.revisedSynthesis || null,
});
if (sessions.length > 100) sessions = sessions.slice(-100);
localStorage.setItem(_sessionKey(), JSON.stringify(sessions));
if (sessions.length >= 2) try { computePatternEngine(); } catch(pe) {}
if (sessions.length >= 3) try { computeNarrativeArc(); } catch(na) {}
console.log("[SAYCRD] Session saved locally. Total sessions:", sessions.length);

(function() {
try {
if (window.storage && window.currentUser && window.currentUser.id !== "local-user") {
window.storage.set("sessions", JSON.stringify(sessions)).then(function() {
console.log("[SAYCRD] Session synced to server.");
}).catch(function(e) {
console.warn("[SAYCRD] Server sync failed (session saved locally):", e);
});
}
} catch(e) { }
})();

(function generateSummaryAsync() {
var d = data;
var themesStr = (d.themes || []).slice(0, 4).map(function(t){ return t.label; }).join(", ");
var syn = (d.synthesis || "").slice(0, 300);
var tens = d.tension && d.tension.a ? d.tension.a + " vs " + d.tension.b : "";
var clar = (d.clarity || "").slice(0, 120);
if (!themesStr && !syn) return;
var userMsg = "Themes: " + themesStr + ". Synthesis: " + syn + (tens ? ". Tension: " + tens : "") + (clar ? ". Clarity: " + clar : "");
var sysMsg = "Summarize this reflective session in 1-2 short sentences (max 25 words total). Plain third person, past tense. JSON only: {\"summary\":\"...\"}";
try {
callClaudeClient(sysMsg, userMsg, 80).then(function(res) {
try {
var parsed = parseJSON(res);
var sum = parsed && parsed.summary ? String(parsed.summary).trim().slice(0, 200) : null;
if (sum) {
var sess = JSON.parse(localStorage.getItem(_sessionKey()) || "[]");
if (sess.length > 0) {
sess[sess.length - 1].sessionSummary = sum;
localStorage.setItem(_sessionKey(), JSON.stringify(sess));
if (window.storage && window.currentUser && window.currentUser.id !== "local-user") {
window.storage.set("sessions", JSON.stringify(sess)).catch(function() {});
}
}
}
} catch(e) { console.warn("[SAYCRD] Summary update failed:", e); }
}).catch(function() {});
} catch(e) {}
})();
} catch (e) { console.error("[SAYCRD] Save error:", e); }
}

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

function getArchetypeHistory() {
var sessions = loadSessions(); var counts = {};
sessions.forEach(function(s) {
(s.archetypes || []).forEach(function(a) {
var key = typeof a === "string" ? a : a.key;
counts[key] = (counts[key] || 0) + 1;
});
});
return counts;
}
function getThemeHistory() {
var sessions = loadSessions();
var themeMap = {};
sessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
var k = normalizeThemeLabel(t.label);
if (!k) return;
if (!themeMap[k]) themeMap[k] = { label: t.label, appearances: [] };
themeMap[k].appearances.push({ session: si, weight: t.weight || 1, date: s.date });
});
});
return themeMap;
}
function getSessionTimeline() {
var sessions = loadSessions();
return sessions.map(function(s, i) {
var archs = (s.archetypes || []).map(function(a) { return typeof a === "string" ? a : a.key; });
return { index: i, date: s.date, archetypes: archs, intensity: s.intensity || 0, mapTitle: s.mapTitle || "", themes: s.themes || [] };
});
}

var PHASE_ORDER = {
chrysalis: ["consuming","dissolving","clustering","emergence"],
tower: ["trembling","falling","rubble","clearing"],
kintsugi: ["breaking","holding","filling","whole"],
dark_night: ["trigger","crisis","transformation","emergence"],
persephone: ["descending","underworld","pomegranate","returning"],
phoenix: ["burning","ash","stirring","rising"],
hermit: ["withdrawing","listening","seeing","returning"],
sisyphus: ["pushing","rolling_back","pausing","meaning"],
magician: ["awakening","practicing","transforming","mastery"],
lover: ["guarding","opening","feeling","merging"],
star: ["darkness","glimmer","pouring","shining"],
threshold: ["approaching","standing","crossing","arrived"],
weaver: ["gathering","seeing","weaving","wearing"],
tree: ["seed","roots","growing","canopy"],
};
var ALCHEMY_ORDER = ["nigredo","albedo","citrinitas","rubedo"];

function computeFieldState() {
var sessions = loadSessions();
var n = sessions.length;
if (n === 0) return null;

var now = Date.now();
var firstDate = new Date(sessions[0].date).getTime();
var daysActive = Math.max(1, Math.round((now - firstDate) / 86400000));
var gaps = [];
for (var i = 1; i < n; i++) {
gaps.push(Math.round((new Date(sessions[i].date).getTime() - new Date(sessions[i-1].date).getTime()) / 86400000));
}
var avgGap = gaps.length > 0 ? Math.round(gaps.reduce(function(a,b){return a+b;},0) / gaps.length * 10) / 10 : 0;

var themeTrack = {};
sessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
var k = normalizeThemeLabel(t.label);
if (!k) return;
if (!themeTrack[k]) themeTrack[k] = { label: t.label, weights: [], sessions: [] };
themeTrack[k].weights.push(t.weight || 1);
themeTrack[k].sessions.push(si);
});
});

var rising = [], fading = [], chronic = [], absent = [];
Object.keys(themeTrack).forEach(function(k) {
var t = themeTrack[k];
var w = t.weights;
if (w.length >= 2) {
var recent = w.slice(-2);
var delta = recent[recent.length - 1] - recent[0];
if (delta >= 1.5) rising.push({ label: t.label, delta: delta });
if (delta <= -1.5) fading.push({ label: t.label, delta: delta });
if (w.length >= 3 && t.sessions[t.sessions.length - 1] >= n - 1) chronic.push(t.label);
}
if (t.sessions.length >= 2 && t.sessions[t.sessions.length - 1] < n - 2) {
absent.push(t.label);
}
});

var archTrack = {};
sessions.forEach(function(s, si) {
(s.archetypes || []).forEach(function(a) {
var key = typeof a === "string" ? a : a.key;
var phase = a.phase || "";
var resp = s.archetypeResponse && s.archetypeResponse.key === key ? s.archetypeResponse.response : "";
if (!archTrack[key]) archTrack[key] = { appearances: [], phases: [], responses: [] };
archTrack[key].appearances.push(si);
archTrack[key].phases.push(phase);
archTrack[key].responses.push(resp);
});
});

var anchor = null, anchorCount = 0;
var archSignals = {};
Object.keys(archTrack).forEach(function(key) {
var a = archTrack[key];
if (a.appearances.length > anchorCount) { anchor = key; anchorCount = a.appearances.length; }

var order = PHASE_ORDER[key] || [];
var indices = a.phases.map(function(p) { return order.indexOf(p); }).filter(function(x) { return x >= 0; });

var velocity = "stable";
if (indices.length >= 2) {
var last2 = indices.slice(-2);
if (last2[1] > last2[0]) velocity = "advancing";
else if (last2[1] < last2[0]) velocity = "regressing";
else if (indices.length >= 3 && indices[indices.length-1] === indices[indices.length-2] && indices[indices.length-2] === indices[indices.length-3]) velocity = "stuck";
}

archSignals[key] = {
count: a.appearances.length,
currentPhase: a.phases[a.phases.length - 1] || "",
velocity: velocity,
phaseHistory: a.phases.join(" \u2192 "),
lastResponse: a.responses.filter(Boolean).pop() || "",
};
});

var tensions = sessions.map(function(s) { return s.tension; }).filter(Boolean);
var tensionAge = 0;
var tensionShape = null;
if (tensions.length >= 2) {
var last = tensions[tensions.length - 1];
tensionShape = last.a + " vs " + last.b;
for (var ti = tensions.length - 1; ti >= 0; ti--) {
var t = tensions[ti];
if (t.a === last.a || t.b === last.b || t.a === last.b || t.b === last.a) tensionAge++;
else break;
}
}

var energies = sessions.map(function(s) { return s.arrival ? s.arrival.energy : null; }).filter(Boolean);
var energyTrend = "unknown";
if (energies.length >= 2) {
var last = energies[energies.length - 1];
var prev = energies[energies.length - 2];
if (last === prev) {
energyTrend = energies.length >= 3 && energies[energies.length - 3] === last ? "sustained" : "holding";
} else {
var heavy = ["heavy","shattered","restless"];
var light = ["warm","tender","still","quiet","grounded"];
var lastH = heavy.indexOf(last) >= 0, prevH = heavy.indexOf(prev) >= 0;
var lastL = light.indexOf(last) >= 0, prevL = light.indexOf(prev) >= 0;
if (prevH && lastL) energyTrend = "softening";
else if (prevL && lastH) energyTrend = "intensifying";
else energyTrend = "shifting";
}
}

var alchemies = sessions.map(function(s) { return s.alchemy ? s.alchemy.stage : null; }).filter(Boolean);
var alchemyStage = alchemies.length > 0 ? alchemies[alchemies.length - 1] : null;
var alchemyVelocity = "stable";
if (alchemies.length >= 2) {
var ai1 = ALCHEMY_ORDER.indexOf(alchemies[alchemies.length - 2]);
var ai2 = ALCHEMY_ORDER.indexOf(alchemies[alchemies.length - 1]);
if (ai2 > ai1) alchemyVelocity = "advancing";
else if (ai2 < ai1) alchemyVelocity = "regressing";
}

var blindSpots = sessions.map(function(s) { return s.blind_spot || ""; }).filter(Boolean);
var lastBlindSpot = blindSpots.length > 0 ? blindSpots[blindSpots.length - 1] : "";

var pairCounts = {};
sessions.forEach(function(s) {
var archs = (s.archetypes || []).map(function(a) { return typeof a === "string" ? a : a.key; });
for (var i = 0; i < archs.length; i++) {
for (var j = i + 1; j < archs.length; j++) {
var pair = [archs[i], archs[j]].sort().join("+");
pairCounts[pair] = (pairCounts[pair] || 0) + 1;
}
}
});
var constellations = Object.keys(pairCounts).filter(function(k) { return pairCounts[k] >= 2; }).map(function(k) { return { pair: k, count: pairCounts[k] }; });

var state = {
sessionCount: n,
daysActive: daysActive,
avgGapDays: avgGap,
rising: rising.slice(0, 3),
fading: fading.slice(0, 3),
absent: absent.slice(0, 3),
chronic: chronic.slice(0, 3),
anchor: anchor,
anchorCount: anchorCount,
archSignals: archSignals,
tensionShape: tensionShape,
tensionAge: tensionAge,
energies: energies.slice(-5),
energyTrend: energyTrend,
alchemyStage: alchemyStage,
alchemyVelocity: alchemyVelocity,
lastBlindSpot: lastBlindSpot,
constellations: constellations,
};

try { localStorage.setItem("saycrd-field-state", JSON.stringify(state)); } catch(e) {}
return state;
}

function getRecurringThreshold(n) {
if (n < 20) return 2;
if (n < 50) return 3;
if (n < 100) return 5;
return Math.max(5, Math.floor(n / 20));
}
function getRepeatingGoalsThreshold(n) {
if (n < 20) return 2;
if (n < 50) return 3;
return 4;
}
function getEmergingDeltaThreshold(n) {
if (n < 20) return 1.5;
if (n < 50) return 1.8;
return 2;
}
function computeConnectionArcs(sessions) {
var arcs = {};
sessions.forEach(function(s, si) {
Object.keys(s.mapResponses || {}).forEach(function(k) {
var mr = s.mapResponses[k];
if (!mr || !mr.value) return;
var val = mr.value === "yes" ? 2 : mr.value === "partly" ? 1 : 0;
if (!arcs[k]) arcs[k] = [];
arcs[k].push({ sessionIndex: si, value: mr.value, numeric: val });
});
});
var result = [];
Object.keys(arcs).forEach(function(k) {
var seq = arcs[k];
if (seq.length < 2) return;
var vals = seq.map(function(x) { return x.numeric; });
var trend = "stable";
var last3 = vals.slice(-3);
if (last3.length >= 2 && last3[last3.length - 1] > last3[0]) trend = "improving";
else if (last3.length >= 2 && last3[last3.length - 1] < last3[0]) trend = "regressing";
var summary = seq.map(function(x) { return "S" + (x.sessionIndex + 1) + ":" + x.value; }).join(" ");
result.push({ connectionKey: k, values: seq, trend: trend, summary: summary });
});
return result;
}
function computePatternMorphology(sessions) {
var blindSpotHistory = [];
var correctionHistory = {};
sessions.forEach(function(s, si) {
var bs = s.blind_spot ? String(s.blind_spot).trim() : "";
if (bs) blindSpotHistory.push({ sessionIndex: si, text: bs.slice(0, 120) });
if (s.corrections) {
Object.keys(s.corrections).forEach(function(key) {
var c = s.corrections[key];
if (typeof c === "string" && c.length > 10) {
if (!correctionHistory[key]) correctionHistory[key] = [];
correctionHistory[key].push({ sessionIndex: si, text: c.slice(0, 100) });
}
});
}
});
var evolved = [];
if (blindSpotHistory.length >= 2) {
for (var i = 1; i < blindSpotHistory.length; i++) {
var prev = blindSpotHistory[i - 1].text.toLowerCase();
var curr = blindSpotHistory[i].text.toLowerCase();
if (curr && prev && curr !== prev && (curr.indexOf(prev.slice(0, 20)) >= 0 || prev.indexOf(curr.slice(0, 20)) >= 0)) {
evolved.push({ type: "blind_spot", before: blindSpotHistory[i - 1].text.slice(0, 60), after: blindSpotHistory[i].text.slice(0, 60), sessionIndex: i });
}
}
}
Object.keys(correctionHistory).forEach(function(key) {
if (correctionHistory[key].length >= 2) {
evolved.push({ type: "correction_refinement", key: key, count: correctionHistory[key].length, sessions: correctionHistory[key].map(function(x) { return x.sessionIndex + 1; }) });
}
});
return evolved;
}
function computeRegressionContext(sessions) {
var regressions = [];
var themeWeights = {};
sessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
var k = normalizeThemeLabel(t.label);
if (!k) return;
if (!themeWeights[k]) themeWeights[k] = [];
themeWeights[k].push({ si: si, w: t.weight || 1 });
});
});
Object.keys(themeWeights).forEach(function(k) {
var arr = themeWeights[k];
for (var i = 1; i < arr.length; i++) {
if (arr[i].w < arr[i - 1].w - 1) {
var prev = sessions[arr[i].si - 1];
var ctx = (prev && (prev.opening || prev.synthesis || prev.tension)) ? (String(prev.opening || "").slice(0, 80) + " | " + (prev.tension && prev.tension.a ? prev.tension.a + " vs " + prev.tension.b : "") + " | " + String(prev.synthesis || "").slice(0, 60)).trim() : "";
regressions.push({ type: "theme", key: k, sessionIndex: arr[i].si, priorWeight: arr[i - 1].w, newWeight: arr[i].w, priorContext: ctx });
}
}
});
var connArcs = computeConnectionArcs(sessions);
connArcs.forEach(function(arc) {
var seq = arc.values;
for (var i = 1; i < seq.length; i++) {
if (seq[i].numeric < seq[i - 1].numeric) {
var prev = sessions[seq[i].sessionIndex - 1];
var ctx = prev ? (String(prev.opening || "").slice(0, 80) + " | " + (prev.tension && prev.tension.a ? prev.tension.a + " vs " + prev.tension.b : "")).trim() : "";
regressions.push({ type: "map", key: arc.connectionKey, sessionIndex: seq[i].sessionIndex, priorValue: seq[i - 1].value, newValue: seq[i].value, priorContext: ctx });
}
}
});
return regressions.slice(0, 8);
}
function computeLifeDomainSignals(sessions) {
var byDomain = {};
sessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
var d = inferLifeDomain(t.short_desc, t.label);
if (!byDomain[d]) byDomain[d] = { themes: [], totalWeight: 0 };
byDomain[d].themes.push({ label: t.label, weight: t.weight || 1, sessionIndex: si });
byDomain[d].totalWeight += (t.weight || 1);
});
});
var result = [];
Object.keys(byDomain).forEach(function(d) {
if (d === "life") return;
var arr = byDomain[d].themes;
var top = arr.sort(function(a, b) { return (b.weight || 0) - (a.weight || 0); }).slice(0, 3).map(function(x) { return x.label; });
result.push({ domain: d, topThemes: top, totalWeight: byDomain[d].totalWeight });
});
return result.sort(function(a, b) { return b.totalWeight - a.totalWeight; }).slice(0, 5);
}
function computePatternEngine() {
var sessions = loadSessions();
if (sessions.length < 2) return null;
var n = sessions.length;
var recurThresh = getRecurringThreshold(n);
var goalsThresh = getRepeatingGoalsThreshold(n);
var emergingThresh = getEmergingDeltaThreshold(n);
var engine = {
repeating_goals: [],
emotional_cycles: [],
recurring_obstacles: [],
identity_shifts: [],
emerging_strengths: []
};
var rejected = {};
sessions.forEach(function(s) {
Object.keys(s.mapResponses || {}).forEach(function(k) {
var mr = s.mapResponses[k];
if (mr && mr.value === "no") {
var label = k + (mr.comment && mr.comment.trim() ? ": \"" + String(mr.comment).trim().slice(0, 60) + "\"" : "");
rejected[label] = (rejected[label] || 0) + 1;
}
});
Object.keys(s.reactions || {}).forEach(function(rk) {
if (s.reactions[rk] === "resisted") {
rejected[rk] = (rejected[rk] || 0) + 1;
}
});
});
engine.recurring_obstacles = Object.entries(rejected).filter(function(e) { return e[1] >= recurThresh; }).map(function(e) { return { key: e[0], count: e[1], confidence: e[1] >= recurThresh + 1 ? "high" : "medium" }; }).slice(0, 8);
var archs = sessions.map(function(s) { return (s.archetypes && s.archetypes[0]) ? (s.archetypes[0].name || s.archetypes[0].key) : ""; });
engine.identity_shifts = [];
for (var i = 1; i < archs.length; i++) {
if (archs[i] && archs[i] !== archs[i - 1]) {
engine.identity_shifts.push({ from: archs[i - 1], to: archs[i], sessionIndex: i, confidence: "high" });
}
}
var fs = computeFieldState();
if (fs && fs.rising && fs.rising.length > 0) {
engine.emerging_strengths = fs.rising.filter(function(r) { return r.delta >= emergingThresh; }).map(function(r) { return { label: r.label, delta: r.delta, confidence: r.delta >= emergingThresh + 1 ? "high" : "medium" }; });
}
var energies = sessions.map(function(s) {
var e = s.arrival && s.arrival.energy ? s.arrival.energy : null;
if (!e && s.descent && s.descent.cards && s.descent.answers) {
var c0 = s.descent.cards[0];
if (c0 && c0.type === "energy" && s.descent.answers[0] != null) e = "energy_" + s.descent.answers[0];
}
return { session: s.date, energy: e };
});
var seq = energies.map(function(x) { return x.energy; }).filter(Boolean);
if (seq.length >= 3) {
var heavy = ["heavy", "shattered", "restless", "electric"];
var light = ["warm", "tender", "still", "quiet", "grounded"];
var last3 = seq.slice(-3);
var pattern = last3.map(function(e) {
var h = heavy.some(function(x) { return String(e).indexOf(x) >= 0; });
var l = light.some(function(x) { return String(e).indexOf(x) >= 0; });
return h ? "H" : l ? "L" : "M";
}).join("→");
engine.emotional_cycles = { recent: pattern, sequence: last3, confidence: "low" };
}
var clarityWords = [];
sessions.forEach(function(s) {
var c = (s.clarity || "").toLowerCase().split(/\s+/).filter(function(w) { return w.length >= 4; });
clarityWords.push.apply(clarityWords, c);
});
var wordFreq = {};
clarityWords.forEach(function(w) { wordFreq[w] = (wordFreq[w] || 0) + 1; });
var topClarity = Object.entries(wordFreq).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5).filter(function(e) { return e[1] >= goalsThresh; });
if (topClarity.length) engine.repeating_goals = topClarity.map(function(e) { return { word: e[0], count: e[1], confidence: e[1] >= goalsThresh + 2 ? "medium" : "low" }; });
engine.connection_arcs = computeConnectionArcs(sessions);
engine.pattern_morphology = computePatternMorphology(sessions);
engine.life_domain_signals = computeLifeDomainSignals(sessions);
engine.regression_context = computeRegressionContext(sessions);
var peKey = "saycrd-" + getCurrentUid() + "-pattern-engine";
try { localStorage.setItem(peKey, JSON.stringify(engine)); } catch(e) {}
return engine;
}

function loadPatternEngine() {
try {
return JSON.parse(localStorage.getItem("saycrd-" + getCurrentUid() + "-pattern-engine") || "null");
} catch(e) { return null; }
}

function computeNarrativeArc() {
var sessions = loadSessions();
if (sessions.length < 3) return null;
var arc = { chapters: [], turning_points: [], recurring_storylines: [] };
var CHUNK = Math.max(3, Math.floor(sessions.length / 4));
for (var start = 0; start < sessions.length; start += CHUNK) {
var end = Math.min(start + CHUNK, sessions.length);
var chunk = sessions.slice(start, end);
var themes = {};
chunk.forEach(function(s) {
(s.themes || []).forEach(function(t) {
var k = normalizeThemeLabel(t.label);
if (k) themes[k] = (themes[k] || 0) + (t.weight || 1);
});
});
var topThemes = Object.entries(themes).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 3).map(function(e) { return e[0]; });
var arch = chunk[chunk.length - 1];
var archName = arch && arch.archetypes && arch.archetypes[0] ? (arch.archetypes[0].name || arch.archetypes[0].key) : "";
var tens = chunk[chunk.length - 1];
var tensionStr = tens && tens.tension && tens.tension.a ? tens.tension.a + " vs " + tens.tension.b : "";
arc.chapters.push({ sessionRange: [start, end - 1], dominantThemes: topThemes, archetype: archName, tension: tensionStr });
}
var archs = sessions.map(function(s) { return (s.archetypes && s.archetypes[0]) ? (s.archetypes[0].name || s.archetypes[0].key) : ""; });
for (var i = 1; i < archs.length; i++) {
if (archs[i] && archs[i] !== archs[i - 1]) {
arc.turning_points.push({ sessionIndex: i, type: "archetype_change", description: archs[i - 1] + " → " + archs[i] });
}
}
var themeTrack = {};
sessions.forEach(function(s, si) {
(s.themes || []).forEach(function(t) {
var k = normalizeThemeLabel(t.label);
if (!k) return;
if (!themeTrack[k]) themeTrack[k] = { label: t.label, sessions: [] };
themeTrack[k].sessions.push(si);
});
});
var recurring = Object.entries(themeTrack).filter(function(e) { return e[1].sessions.length >= 3; }).sort(function(a, b) { return b[1].sessions.length - a[1].sessions.length; }).slice(0, 5);
arc.recurring_storylines = recurring.map(function(e) { return { label: e[1].label, sessions: e[1].sessions, count: e[1].sessions.length }; });
var tensionShape = null;
var tensionCount = 0;
sessions.forEach(function(s) {
if (!s.tension || !s.tension.a) return;
var sh = s.tension.a + " vs " + s.tension.b;
if (sh === tensionShape) tensionCount++;
else if (!tensionShape || tensionCount < 2) { tensionShape = sh; tensionCount = 1; }
});
if (tensionShape && tensionCount >= 2) {
var firstIdx = -1;
for (var ti = 0; ti < sessions.length; ti++) {
if (sessions[ti].tension && sessions[ti].tension.a && (sessions[ti].tension.a + " vs " + sessions[ti].tension.b) === tensionShape) { firstIdx = ti; break; }
}
if (firstIdx >= 0) arc.turning_points.push({ sessionIndex: firstIdx, type: "recurring_tension", description: tensionShape });
}
try { localStorage.setItem("saycrd-" + getCurrentUid() + "-narrative-arc", JSON.stringify(arc)); } catch(e) {}
return arc;
}

function loadNarrativeArc() {
try {
return JSON.parse(localStorage.getItem("saycrd-" + getCurrentUid() + "-narrative-arc") || "null");
} catch(e) { return null; }
}

function computeEmergentSignals() {
var fs = computeFieldState();
if (!fs) return null;
var lastSession = (function() { var s = loadSessions(); return s.length > 0 ? s[s.length - 1] : null; })();
return {
opening_question: lastSession && lastSession.opening ? String(lastSession.opening).slice(0, 120) : "",
fading: (fs.fading || []).map(function(f) { return { label: f.label, delta: f.delta }; }),
rising: (fs.rising || []).map(function(r) { return { label: r.label, delta: r.delta }; }),
blind_spot: fs.lastBlindSpot ? String(fs.lastBlindSpot).slice(0, 200) : "",
chronic: (fs.chronic || []).slice(0, 3),
absent: (fs.absent || []).slice(0, 3)
};
}

var ARCH_EVOLUTION = {
chrysalis: ["Something is dissolving. You're in the space between.", "The chrysalis recognizes you. Deeper this time.", "You keep returning to transformation. The dissolving IS the work."],
tower: ["Something is falling apart. Look at what's revealed.", "The tower visits again. What's built on false ground?", "You keep outgrowing structures. The collapse is graduation."],
kintsugi: ["Something broke. The gold is coming.", "You've broken before. The repairs keep getting more beautiful.", "The cracks are your signature now."],
dark_night: ["The old meaning dissolved. Stay in the dark.", "This darkness knows you. It's deeper this time.", "Each dark night strips another false floor."],
persephone: ["Descending. Not punishment — initiation.", "The underworld recognizes you. You've been here.", "Queen of both worlds now. The descent is home."],
phoenix: ["Burning. What survives is real.", "You've burned before. The rising gets faster.", "Fire is your element. Each version is truer."],
hermit: ["Withdrew to hear something. Listen.", "The lamp is brighter. You've been here before.", "Solitude is your workshop now."],
sisyphus: ["Same weight. Your grip is changing.", "The boulder knows your hands. What's different this time?", "You and the weight have an understanding now."],
magician: ["Tools awakening. Watch what transforms.", "Your transmutation skills are growing.", "Lead into gold. You make it look easy now."],
lover: ["The armor cracked. Let it.", "Opening wider. The terror and tenderness together.", "Vulnerability became your superpower."],
star: ["Light in the dark. Notice it.", "You keep finding light. That's not luck.", "You ARE the light now. Steady, real."],
threshold: ["Standing at the door.", "You've crossed thresholds before. This one's familiar.", "Doorways are your natural habitat."],
weaver: ["Threads connecting.", "The pattern is getting clearer with each session.", "Master weaver. Seeing what others can't."],
tree: ["Growth happening underground.", "Roots before branches — the tree grows in you.", "The patience IS the power."],
descent: ["Going under. Treasure is down there.", "You've descended before. Faster each time.", "The underworld gives up its secrets to you."],
planets: ["Forces in orbit around you.", "The cycles are getting familiar.", "You ride these forces now."],
};

var FIELD_ALCHEMY = {
nigredo: { label: "Nigredo", sub: "The Blackening", season: "Autumn", color: "#888", bg: "linear-gradient(160deg, #0D0A10 0%, #1a1018 40%, #44405030 100%)" },
albedo: { label: "Albedo", sub: "The Whitening", season: "Winter", color: "#e0e8f0", bg: "linear-gradient(160deg, #101418 0%, #1c2028 40%, #c0c8d030 100%)" },
citrinitas: { label: "Citrinitas", sub: "The Yellowing", season: "Spring", color: "#f0c840", bg: "linear-gradient(160deg, #141008 0%, #2a2010 40%, #d4a83030 100%)" },
rubedo: { label: "Rubedo", sub: "The Reddening", season: "Summer", color: "#ff5040", bg: "linear-gradient(160deg, #1A0608 0%, #2a0c10 40%, #cc303030 100%)" },
};

function JourneyRiver({ timeline, currentArchetypes }) {
var sessions = timeline || [];
var totalSessions = sessions.length;
if (totalSessions < 2) return null;

var w = 300, h = 200, pad = 20;
var usable = w - pad * 2;
var maxShow = Math.min(totalSessions, 12);
var recent = sessions.slice(-maxShow);
var step = usable / Math.max(maxShow - 1, 1);

var points = recent.map(function(s, i) {
var x = pad + i * step;
var y = h * 0.5 - (s.intensity || 3) * 8;
return { x: x, y: Math.max(30, Math.min(h - 40, y)), archetypes: s.archetypes || [], intensity: s.intensity || 0 };
});

var pathD = points.map(function(p, i) {
if (i === 0) return "M " + p.x + " " + p.y;
var prev = points[i - 1];
var cx = (prev.x + p.x) / 2;
return "C " + cx + " " + prev.y + " " + cx + " " + p.y + " " + p.x + " " + p.y;
}).join(" ");

var pathD2 = points.map(function(p, i) {
var y2 = p.y + 12 + (p.intensity || 0) * 3;
if (i === 0) return "M " + p.x + " " + y2;
var prev = points[i - 1];
var prevY2 = prev.y + 12 + (prev.intensity || 0) * 3;
var cx = (prev.x + p.x) / 2;
return "C " + cx + " " + prevY2 + " " + cx + " " + y2 + " " + p.x + " " + y2;
}).join(" ");

return React.createElement("svg", { viewBox: "0 0 " + w + " " + h, style: { width: "100%", maxWidth: 300 } }, [
React.createElement("defs", { key: "defs" }, [
React.createElement("linearGradient", { key: "rg", id: "riverGrad", x1: "0", y1: "0", x2: "1", y2: "0" }, [
React.createElement("stop", { key: "s0", offset: "0%", stopColor: "rgba(107,255,184,0.1)" }),
React.createElement("stop", { key: "s1", offset: "100%", stopColor: "#6BFFB8" })
])
]),
React.createElement("path", { key: "river-top", d: pathD, fill: "none", stroke: "url(#riverGrad)", strokeWidth: "2.5", strokeLinecap: "round", opacity: "0.8" }),
React.createElement("path", { key: "river-bot", d: pathD2, fill: "none", stroke: "url(#riverGrad)", strokeWidth: "1", strokeLinecap: "round", opacity: "0.3" }),
React.createElement("path", { key: "river-fill", d: pathD + " " + points.slice().reverse().map(function(p, i) {
var y2 = p.y + 12 + (p.intensity || 0) * 3;
return (i === 0 ? "L " : "L ") + p.x + " " + y2;
}).join(" ") + " Z", fill: "rgba(107,255,184,0.04)", stroke: "none" }),
].concat(points.map(function(p, i) {
var archs = p.archetypes || [];
var isLast = i === points.length - 1;
var mainColor = "#6BFFB8";
if (archs.length > 0 && ARCH_REGISTRY[archs[0]]) mainColor = ARCH_REGISTRY[archs[0]].color;
return React.createElement("g", { key: "dot-" + i }, [
React.createElement("circle", { key: "c", cx: p.x, cy: p.y, r: isLast ? 6 : 3.5, fill: mainColor, opacity: isLast ? 0.9 : 0.4 + i * 0.04 }),
isLast ? React.createElement("circle", { key: "pulse", cx: p.x, cy: p.y, r: "10", fill: "none", stroke: mainColor, strokeWidth: "1", opacity: "0.3", children: [
React.createElement("animate", { key: "a", attributeName: "r", values: "8;14;8", dur: "2s", repeatCount: "indefinite" }),
React.createElement("animate", { key: "b", attributeName: "opacity", values: "0.3;0.1;0.3", dur: "2s", repeatCount: "indefinite" })
]}) : null,
archs.length > 1 && ARCH_REGISTRY[archs[1]] ? React.createElement("circle", { key: "c2", cx: p.x + 6, cy: p.y - 5, r: 2.5, fill: ARCH_REGISTRY[archs[1]].color, opacity: 0.5 }) : null,
]);
})).concat([
React.createElement("text", { key: "lbl-start", x: pad, y: h - 8, fontSize: "9", fill: "rgba(255,255,255,0.2)", fontFamily: FB }, totalSessions > maxShow ? "..." + (totalSessions - maxShow + 1) : "1"),
React.createElement("text", { key: "lbl-end", x: w - pad, y: h - 8, fontSize: "9", fill: "#6BFFB8", fontFamily: FB, textAnchor: "end" }, "now"),
React.createElement("text", { key: "lbl-title", x: w / 2, y: h - 8, fontSize: "9", fill: "rgba(255,255,255,0.15)", fontFamily: FB, textAnchor: "middle", letterSpacing: "0.15em" }, totalSessions + " SESSIONS")
]));
}

function PatternWeave({ themeHistory, sessionCount }) {
if (!themeHistory) return null;
var keys = Object.keys(themeHistory);
var recurring = keys.filter(function(k) { return themeHistory[k].appearances.length >= 2; })
.sort(function(a, b) { return themeHistory[b].appearances.length - themeHistory[a].appearances.length; })
.slice(0, 5);
if (recurring.length === 0) return null;

return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 300 } },
recurring.map(function(key, i) {
var theme = themeHistory[key];
var apps = theme.appearances;
var latest = apps[apps.length - 1];
var first = apps[0];
var weightShift = latest.weight - first.weight;
var color = NC[i % NC.length];
var direction = weightShift > 0 ? "↑" : weightShift < 0 ? "↓" : "→";
var dirColor = weightShift > 0 ? "#FF6B9D" : weightShift < 0 ? "#6BFFB8" : "rgba(255,255,255,0.3)";
return React.createElement("div", { key: key, style: { display: "flex", alignItems: "center", gap: 12, animation: "riseUp 0.5s ease " + (i * 0.1) + "s both" } }, [
React.createElement("div", { key: "dot", style: { width: 8, height: 8, borderRadius: "50%", background: color, opacity: 0.6, flexShrink: 0 } }),
React.createElement("div", { key: "info", style: { flex: 1 } }, [
React.createElement("div", { key: "label", style: { fontSize: 15, color: "white", fontFamily: FD, fontStyle: "italic" } }, theme.label),
React.createElement("div", { key: "meta", style: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: FB, marginTop: 2 } },
apps.length + " sessions" + (apps.length >= 3 ? " — this keeps returning" : ""))
]),
React.createElement("div", { key: "shift", style: { fontSize: 18, color: dirColor, fontFamily: FD, flexShrink: 0 } }, direction)
]);
})
);
}

function TensionCard({ poleA, poleB, subText, whisper, color, userFragment }) {
var c = color || "#6BB8FF";
var [active, setActive] = useState(null); 
var [pulseA, setPulseA] = useState(1);
var [pulseB, setPulseB] = useState(1);

function tapA(e) {
e.stopPropagation();
setActive("a");
setPulseA(1.35);
setPulseB(0.7);
setTimeout(function() { setPulseA(1.15); setPulseB(0.85); }, 600);
}
function tapB(e) {
e.stopPropagation();
setActive("b");
setPulseB(1.35);
setPulseA(0.7);
setTimeout(function() { setPulseB(1.15); setPulseA(0.85); }, 600);
}

var lineOpacity = active ? 0.35 : 0.15;
return <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
<svg style={{ position: "absolute", width: "100%", height: "100%", opacity: lineOpacity, transition: "opacity 0.6s" }}>
<line x1="12%" y1="50%" x2="88%" y2="50%" stroke={c} strokeWidth={active ? 2 : 1} strokeDasharray="6 10"><animate attributeName="strokeDashoffset" values="0;32" dur="2s" repeatCount="indefinite"/></line>
{[0.35,0.42,0.5,0.58,0.65].map(function(y,i) {
return <line key={i} x1="18%" y1={y*100+"%"} x2="82%" y2={y*100+"%"} stroke={c} strokeWidth={0.5} opacity={0.8-Math.abs(y-0.5)*3} strokeDasharray="3 14"><animate attributeName="strokeDashoffset" values={"0;"+(16+i*4)} dur={(1.8+i*0.4)+"s"} repeatCount="indefinite"/></line>;
})}
</svg>

<div style={{ fontSize: 10, color: c + "55", fontFamily: FB, letterSpacing: "0.3em", marginBottom: 24, zIndex: 1, animation: "riseUp 0.6s ease both" }}>TAP A SIDE</div>

<div style={{ display: "flex", alignItems: "center", width: "100%", padding: "0 24px", zIndex: 1 }}>
<div onClick={tapA} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", animation: "riseUp 0.7s ease 0.1s both" }}>
<div style={{
width: 100, height: 100, borderRadius: "50%",
background: "radial-gradient(circle at 40% 40%, " + c + (active === "a" ? "55" : "25") + ", " + c + "08)",
border: "2px solid " + c + (active === "a" ? "88" : "44"),
display: "flex", alignItems: "center", justifyContent: "center",
boxShadow: "0 0 " + (active === "a" ? 60 : 25) + "px " + c + (active === "a" ? "44" : "15"),
transform: "scale(" + pulseA + ")",
transition: "all 0.5s cubic-bezier(.34,1.56,.64,1)",
}}>
<span style={{ fontFamily: FB, fontSize: 16, fontWeight: 800, color: active === "a" ? "white" : c, textAlign: "center", lineHeight: 1.2, padding: 8 }}>{poleA}</span>
</div>
</div>

<div style={{ width: 14, height: 14, borderRadius: "50%", background: c, flexShrink: 0, opacity: active ? 0.6 : 0.25, transform: "scale(" + (active ? 1.3 : 1) + ")", transition: "all 0.5s", boxShadow: active ? "0 0 20px " + c + "66" : "none" }} />

<div onClick={tapB} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", animation: "riseUp 0.7s ease 0.2s both" }}>
<div style={{
width: 100, height: 100, borderRadius: "50%",
background: "radial-gradient(circle at 60% 40%, " + c + (active === "b" ? "55" : "25") + ", " + c + "08)",
border: "2px solid " + c + (active === "b" ? "88" : "44"),
display: "flex", alignItems: "center", justifyContent: "center",
boxShadow: "0 0 " + (active === "b" ? 60 : 25) + "px " + c + (active === "b" ? "44" : "15"),
transform: "scale(" + pulseB + ")",
transition: "all 0.5s cubic-bezier(.34,1.56,.64,1)",
}}>
<span style={{ fontFamily: FB, fontSize: 16, fontWeight: 800, color: active === "b" ? "white" : c, textAlign: "center", lineHeight: 1.2, padding: 8 }}>{poleB}</span>
</div>
</div>
</div>

{subText && <div style={{ fontFamily: FD, fontSize: 17, fontStyle: "italic", color: "rgba(255,255,255," + (active ? "0.65" : "0.5") + ")", maxWidth: 320, textAlign: "center", lineHeight: 1.7, marginTop: 28, zIndex: 1, transition: "color 0.4s", animation: "riseUp 0.8s ease 0.4s both" }}>{subText}</div>}
{userFragment && <div style={{ position: "absolute", bottom: 52, left: 28, right: 28, textAlign: "center", zIndex: 1, animation: "riseUp 0.8s ease 0.6s both" }}>
<div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: FB, letterSpacing: "0.15em", marginBottom: 5, textTransform: "uppercase" }}>you wrote</div>
<div style={{ fontSize: 15, color: "rgba(255,255,255,0.68)", fontFamily: FD, fontStyle: "italic", lineHeight: 1.5 }}>{"\u201C"}{userFragment}{"\u201D"}</div>
</div>}
{whisper && <div style={{ position: "absolute", bottom: 28, fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: FB, letterSpacing: "0.25em" }}>{whisper}</div>}
</div>;
}

function AccuracySlider({ value, onSlide, color = "#D6B26D", leftLabel = "not quite", rightLabel = "exactly this" }) {
var trackRef = React.useRef(null);
var [dragging, setDragging] = React.useState(false);
function posToValue(clientX) {
var r = trackRef.current ? trackRef.current.getBoundingClientRect() : null;
if (!r) return value || 50;
return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100);
}
function onDown(e) {
e.preventDefault(); e.stopPropagation();
setDragging(true);
var cx = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
onSlide(posToValue(cx));
}
React.useEffect(function() {
if (!dragging) return;
function onMove(e) {
var cx = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
onSlide(posToValue(cx));
}
function onUp() { setDragging(false); }
window.addEventListener("pointermove", onMove, { passive: true });
window.addEventListener("pointerup", onUp);
window.addEventListener("touchmove", onMove, { passive: true });
window.addEventListener("touchend", onUp);
return function() {
window.removeEventListener("pointermove", onMove);
window.removeEventListener("pointerup", onUp);
window.removeEventListener("touchmove", onMove);
window.removeEventListener("touchend", onUp);
};
}, [dragging]);
function onUp() { setDragging(false); }
var pct = value;
var alive = pct >= 68;
var away = pct <= 32;

return (
<div onClick={function(e){ e.stopPropagation(); }} style={{ width:"100%", maxWidth:300, marginTop:22, animation:"riseUp 0.6s ease 1.4s both" }}>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
<span style={{ fontSize:11, color: away ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.35)", fontFamily:FB, letterSpacing:"0.05em", transition:"color 0.3s" }}>{leftLabel}</span>
<span style={{ fontSize:11, color: alive ? color : "rgba(255,255,255,0.35)", fontFamily:FB, letterSpacing:"0.05em", transition:"color 0.3s" }}>{rightLabel}</span>
</div>
<div ref={trackRef}
onPointerDown={onDown} onTouchStart={onDown}
style={{ position:"relative", height:6, borderRadius:3, background:"rgba(255,255,255,0.1)", cursor:"pointer", userSelect:"none" }}>
<div style={{ position:"absolute", left:0, top:0, height:"100%", width:pct+"%", borderRadius:3,
background: alive ? "linear-gradient(90deg,"+color+"66,"+color+")" : away ? "rgba(255,255,255,0.2)" : "linear-gradient(90deg,rgba(255,255,255,0.15),rgba(255,255,255,0.4))",
transition:"background 0.3s", boxShadow: alive ? "0 0 10px "+color+"55" : "none" }} />
<div style={{ position:"absolute", top:"50%", left:pct+"%", transform:"translate(-50%,-50%)",
width:18, height:18, borderRadius:"50%", background: alive ? color : "rgba(255,255,255,0.7)",
boxShadow: alive ? "0 0 14px "+color+"88" : "0 1px 4px rgba(0,0,0,0.4)",
transition:"background 0.3s, box-shadow 0.3s", cursor:"grab" }} />
</div>
</div>
);
}

function BookmarkableCard({ text, label, color, children }) {
var holdTimer = React.useRef(null);
var [holding, setHolding] = React.useState(false);
var [saved, setSaved] = React.useState(false);
function start(e) {
if (saved) return;
setHolding(true);
holdTimer.current = setTimeout(function() {
try {
var bm = JSON.parse(localStorage.getItem("saycrd-bookmarks") || "[]");
bm.push({ text, label, date: new Date().toISOString() });
localStorage.setItem("saycrd-bookmarks", JSON.stringify(bm));
} catch(e2) {}
setSaved(true); setHolding(false);
setTimeout(function() { setSaved(false); }, 2500);
}, 1200);
}
function cancel() { clearTimeout(holdTimer.current); setHolding(false); }
return (
<div onMouseDown={start} onMouseUp={cancel} onMouseLeave={cancel}
onTouchStart={start} onTouchEnd={cancel} style={{ position:"absolute", inset:0 }}>
{children}
<div style={{ position:"absolute", bottom:28, right:24, fontSize:10, fontFamily:FB,
letterSpacing:"0.1em", color: saved ? "#6BFFB8" : holding ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.2)",
transition:"color 0.25s", pointerEvents:"none", textTransform:"uppercase" }}>
{saved ? "✓ bookmarked" : holding ? "hold..." : "hold to bookmark"}
</div>
</div>
);
}

function UnderneathItem({ text, index }) {
var holdTimer = React.useRef(null);
var [holding, setHolding] = React.useState(false);
var [saved, setSaved] = React.useState(false);
var [swipeX, setSwipeX] = React.useState(0);
var [swiping, setSwiping] = React.useState(false);
var swipeStart = React.useRef(0);
var [reaction, setReaction] = React.useState(null);
var [noteOpen, setNoteOpen] = React.useState(false);
var [noteDraft, setNoteDraft] = React.useState("");
var [noteSaved, setNoteSaved] = React.useState(false);
var HOLD_MS = 1100; var SWIPE_T = 60;

function startInteract(clientX, e) {
if (reaction) return;
e.stopPropagation();
swipeStart.current = clientX;
setSwiping(true); setSwipeX(0); setHolding(true);
holdTimer.current = setTimeout(function() {
try {
var bm = JSON.parse(localStorage.getItem("saycrd-bookmarks") || "[]");
bm.push({ text: text, label:"Underneath", date:new Date().toISOString() });
localStorage.setItem("saycrd-bookmarks", JSON.stringify(bm));
} catch(e2) {}
setSaved(true); setHolding(false); setSwiping(false);
}, HOLD_MS);
}
function moveInteract(clientX) {
if (!swiping || reaction) return;
var dx = clientX - swipeStart.current;
setSwipeX(dx);
if (Math.abs(dx) > 8) { clearTimeout(holdTimer.current); setHolding(false); }
}
function endInteract() {
clearTimeout(holdTimer.current); setHolding(false);
if (!swiping) return;
setSwiping(false);
var dx = swipeX; setSwipeX(0);
if (dx < -SWIPE_T) { setReaction("landed"); }
else if (dx > SWIPE_T) { setReaction("pushed"); setNoteOpen(true); }
}

var dir = swipeX < -8 ? "land" : swipeX > 8 ? "push" : null;
var bg = saved ? "rgba(107,255,184,0.1)"
: reaction === "landed" ? "rgba(107,255,184,0.07)"
: reaction === "pushed" ? "rgba(255,96,144,0.07)"
: holding ? "rgba(184,107,255,0.18)"
: "rgba(184,107,255,0.07)";
var bord = saved ? "1px solid rgba(107,255,184,0.3)"
: reaction === "landed" ? "1px solid rgba(107,255,184,0.2)"
: reaction === "pushed" ? "1px solid rgba(255,96,144,0.2)"
: holding ? "1px solid rgba(184,107,255,0.45)"
: "1px solid rgba(184,107,255,0.14)";

return (
<div style={{ animation:"riseUp 0.5s ease "+(index*0.15)+"s both" }}>
<div
onMouseDown={function(e){ startInteract(e.clientX,e); }}
onMouseMove={function(e){ moveInteract(e.clientX); }}
onMouseUp={endInteract} onMouseLeave={endInteract}
onTouchStart={function(e){ startInteract(e.touches[0].clientX,e); }}
onTouchMove={function(e){ moveInteract(e.touches[0].clientX); }}
onTouchEnd={endInteract}
onClick={function(e){ e.stopPropagation(); }}
style={{ padding:"14px 18px", borderRadius:14, background:bg, border:bord,
cursor:reaction?"default":"grab", transition:"background 0.2s, border 0.2s",
transform:swiping?"translateX("+(swipeX*0.35)+"px)":"none",
userSelect:"none", WebkitUserSelect:"none" }}>
<p style={{ fontSize:17, fontFamily:FD, lineHeight:1.6, margin:"0 0 6px",
color: reaction==="landed" ? "#6BFFB8"
: reaction==="pushed" ? "rgba(255,255,255,0.3)"
: "rgba(255,255,255,0.88)" }}>{text}</p>
<div style={{ fontSize:10, fontFamily:FB, letterSpacing:"0.08em",
color: saved ? "rgba(107,255,184,0.7)"
: holding ? "rgba(184,107,255,0.7)"
: reaction==="landed" ? "rgba(107,255,184,0.5)"
: reaction==="pushed" ? "rgba(255,96,144,0.5)"
: dir==="land" ? "rgba(107,255,184,0.4)"
: dir==="push" ? "rgba(255,96,144,0.4)"
: "rgba(255,255,255,0.18)" }}>
{saved?"✓ bookmarked":holding?"hold...":reaction==="landed"?"resonates ←":reaction==="pushed"?"pushed back →":dir==="land"?"← resonates":dir==="push"?"push back →":"hold to save · swipe to react"}
</div>
</div>
{noteOpen && !noteSaved && (
<div onClick={function(e){e.stopPropagation();}}
style={{ marginTop:8, padding:"12px 14px", borderRadius:12,
background:"rgba(255,96,144,0.05)", border:"1px solid rgba(255,96,144,0.2)",
animation:"riseUp 0.3s ease both" }}>
<div style={{ fontSize:11, color:"rgba(255,96,144,0.65)", fontFamily:FB,
letterSpacing:"0.1em", marginBottom:8 }}>what doesn't fit?</div>
<textarea value={noteDraft} onChange={function(e){setNoteDraft(e.target.value);}}
onKeyDown={function(e){
if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();setNoteSaved(true);setNoteOpen(false);}
if(e.key==="Escape"){setNoteOpen(false);setReaction(null);}
}}
placeholder="type anything — used as signal, not shown back"
autoFocus
style={{ width:"100%", minHeight:52, background:"rgba(255,255,255,0.03)",
border:"1px solid rgba(255,96,144,0.2)", borderRadius:8,
color:"rgba(255,255,255,0.85)", fontFamily:FD, fontSize:14,
padding:"8px 12px", resize:"none", outline:"none",
lineHeight:1.55, boxSizing:"border-box" }} />
<div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
<button onClick={function(){setNoteOpen(false);setReaction(null);setNoteDraft("");}}
style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:FB,
background:"transparent", border:"none", cursor:"pointer" }}>cancel</button>
<button onClick={function(){setNoteSaved(true);setNoteOpen(false);}}
style={{ fontSize:12, fontFamily:FB, background:"transparent",
border:"1px solid rgba(255,96,144,0.25)", borderRadius:12,
padding:"4px 16px", cursor:"pointer",
color:noteDraft.trim()?"rgba(255,96,144,0.8)":"rgba(255,96,144,0.3)"
}}>signal sent</button>
</div>
</div>
)}
{noteSaved && (
<div style={{ marginTop:4, fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:FB,
paddingLeft:4 }}>incorporated</div>
)}
</div>
);
}

function ArchGlyph({ name, color, size }) {
var s = size || 160;
var cx = s / 2, cy = s / 2;
var nm = (name || "").toLowerCase();
var c = color || "#E84393";
var dim = c + "44";
var mid = c + "88";

var family =
/complet|whole|finish|all|full|close|round/.test(nm) ? "completion" :
/build|make|found|forge|craft|creat|construct/.test(nm) ? "builder" :
/hold|anchor|ground|root|carry|bear|sustain/.test(nm) ? "anchor" :
/witness|watch|see|observe|aware|notice/.test(nm) ? "witness" :
/bridge|connect|link|weave|thread|join|between/.test(nm) ? "bridge" :
/threshold|door|gate|cross|edge|passage|guardian/.test(nm) ? "threshold" :
/break|shatter|crack|rupture|burn|fire|collapse/.test(nm) ? "rupture" :
/bloom|grow|rise|emerge|unfold|open|blossom/.test(nm) ? "bloom" :
/move|flow|river|change|shift|fluid/.test(nm) ? "flow" :
/still|quiet|pause|rest|wait|hold/.test(nm) ? "still" :
"default";

var r = s * 0.36;

if (family === "completion") {
var gap = 22 * Math.PI / 180;
var startAngle = -Math.PI / 2 + gap / 2;
var endAngle = 3 * Math.PI / 2 - gap / 2;
var x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
var x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
var ir = r * 0.52;
var ix1 = cx + ir * Math.cos(startAngle), iy1 = cy + ir * Math.sin(startAngle);
var ix2 = cx + ir * Math.cos(endAngle), iy2 = cy + ir * Math.sin(endAngle);
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s} style={{ overflow:"visible" }}>
<circle cx={cx} cy={cy} r={r * 1.18} fill="none" stroke={dim} strokeWidth="1"/>
<path d={"M "+x1+" "+y1+" A "+r+" "+r+" 0 1 1 "+x2+" "+y2} fill="none" stroke={mid} strokeWidth="2.5" strokeLinecap="round"/>
<path d={"M "+ix1+" "+iy1+" A "+ir+" "+ir+" 0 1 1 "+ix2+" "+iy2} fill="none" stroke={dim} strokeWidth="1.5" strokeLinecap="round"/>
<circle cx={x1} cy={y1} r="4" fill={c} opacity="0.7"/>
<circle cx={x2} cy={y2} r="4" fill={c} opacity="0.7"/>
<line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.9">
<animate attributeName="opacity" values="0.4;1;0.4" dur="3s" repeatCount="indefinite"/>
</line>
<circle cx={cx} cy={cy} r="5" fill={c} opacity="0.6"/>
</svg>
);
}

if (family === "builder") {
var pts = [cx, cy-r, cx-r*0.8, cy+r*0.55, cx+r*0.8, cy+r*0.55];
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<polygon points={pts.join(",")} fill="none" stroke={mid} strokeWidth="2.5" strokeLinejoin="round"/>
<polygon points={[cx, cy-r*0.42, cx-r*0.36, cy+r*0.22, cx+r*0.36, cy+r*0.22].join(",")} fill={dim} stroke={c} strokeWidth="1.5" strokeLinejoin="round"/>
<line x1={cx-r*0.8} y1={cy+r*0.55} x2={cx+r*0.8} y2={cy+r*0.55} stroke={c} strokeWidth="2.5" strokeLinecap="round" opacity="0.8"/>
<circle cx={cx} cy={cy-r} r="4" fill={c} opacity="0.9"/>
</svg>
);
}

if (family === "witness") {
var spokes = 12;
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
{Array.from({length: spokes}).map(function(_,k) {
var a = (k / spokes) * Math.PI * 2;
var r1 = r * (k % 2 === 0 ? 0.35 : 0.2);
var r2 = r * (k % 2 === 0 ? 0.82 : 0.68);
return <line key={k} x1={cx+r1*Math.cos(a)} y1={cy+r1*Math.sin(a)} x2={cx+r2*Math.cos(a)} y2={cy+r2*Math.sin(a)} stroke={k % 2 === 0 ? mid : dim} strokeWidth={k % 2 === 0 ? 1.5 : 1} strokeLinecap="round"/>;
})}
<circle cx={cx} cy={cy} r={r*0.16} fill={c} opacity="0.9"/>
<circle cx={cx} cy={cy} r={r*0.08} fill="white" opacity="0.6"/>
</svg>
);
}

if (family === "threshold") {
var pw = r * 0.18, ph = r * 1.1, py = cy - r * 0.55;
var archR = r * 0.72;
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<rect x={cx-archR-pw} y={py} width={pw} height={ph} fill={dim} stroke={mid} strokeWidth="1.5" rx="2"/>
<rect x={cx+archR} y={py} width={pw} height={ph} fill={dim} stroke={mid} strokeWidth="1.5" rx="2"/>
<path d={"M "+(cx-archR)+" "+py+" A "+archR+" "+archR+" 0 0 1 "+(cx+archR)+" "+py} fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"/>
<line x1={cx-archR*1.3} y1={cy+r*0.55} x2={cx+archR*1.3} y2={cy+r*0.55} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<circle cx={cx} cy={cy+r*0.1} r="4" fill={c} opacity="0.7"/>
</svg>
);
}

if (family === "bridge") {
var bx1 = cx - r * 0.9, bx2 = cx + r * 0.9, by = cy + r * 0.4;
var bcy = cy - r * 0.5;
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<path d={"M "+bx1+" "+by+" Q "+cx+" "+bcy+" "+bx2+" "+by} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round"/>
{[0.2,0.4,0.5,0.6,0.8].map(function(t,k) {
var bx = bx1 + (bx2-bx1)*t;
var bt = 1 - Math.abs(t-0.5)*2;
var topY = bcy + (by-bcy)*bt*bt;
return <line key={k} x1={bx} y1={topY} x2={bx} y2={by} stroke={mid} strokeWidth="1.5" strokeLinecap="round"/>;
})}
<line x1={bx1-10} y1={by} x2={bx2+10} y2={by} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<circle cx={bx1} cy={by} r="5" fill={c} opacity="0.8"/>
<circle cx={bx2} cy={by} r="5" fill={c} opacity="0.8"/>
</svg>
);
}

if (family === "anchor") {
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<circle cx={cx} cy={cy-r*0.6} r={r*0.18} fill="none" stroke={c} strokeWidth="2.5"/>
<line x1={cx} y1={cy-r*0.42} x2={cx} y2={cy+r*0.7} stroke={mid} strokeWidth="2.5" strokeLinecap="round"/>
<line x1={cx-r*0.55} y1={cy-r*0.05} x2={cx+r*0.55} y2={cy-r*0.05} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<path d={"M "+(cx-r*0.5)+" "+(cy+r*0.7)+" A "+(r*0.5)+" "+(r*0.5)+" 0 0 0 "+(cx+r*0.5)+" "+(cy+r*0.7)} fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"/>
<circle cx={cx-r*0.5} cy={cy+r*0.7} r="4" fill={c} opacity="0.8"/>
<circle cx={cx+r*0.5} cy={cy+r*0.7} r="4" fill={c} opacity="0.8"/>
</svg>
);
}

if (family === "rupture") {
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<polyline points={[cx-r*0.7,cy-r*0.5, cx-r*0.1,cy-r*0.1, cx-r*0.4,cy+r*0.1, cx,cy, cx+r*0.2,cy-r*0.2, cx+r*0.5,cy+r*0.6].join(" ")} fill="none" stroke={c} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
{[[cx-r*0.7,cy-r*0.5],[cx-r*0.4,cy+r*0.1],[cx+r*0.5,cy+r*0.6]].map(function(p,k) {
return <circle key={k} cx={p[0]} cy={p[1]} r="3.5" fill={c} opacity={0.5+k*0.2}/>;
})}
</svg>
);
}

if (family === "bloom") {
var petals = 6;
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
{Array.from({length: petals}).map(function(_,k) {
var a = (k/petals)*Math.PI*2 - Math.PI/2;
var pr = r * 0.48;
var px = cx + pr * Math.cos(a), py = cy + pr * Math.sin(a);
return <circle key={k} cx={px} cy={py} r={r*0.34} fill="none" stroke={k===0?c:mid} strokeWidth={k===0?"2":"1.5"} opacity={0.4+k*0.1}/>;
})}
<circle cx={cx} cy={cy} r={r*0.18} fill={c} opacity="0.8"/>
</svg>
);
}

if (family === "still") {
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<circle cx={cx} cy={cy} r={r*0.8} fill="none" stroke={dim} strokeWidth="1"/>
<circle cx={cx} cy={cy} r={r*0.45} fill="none" stroke={mid} strokeWidth="1.5"/>
<circle cx={cx} cy={cy} r={r*0.12} fill={c} opacity="0.9"/>
<line x1={cx} y1={cy-r*1.1} x2={cx} y2={cy-r*0.85} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<line x1={cx} y1={cy+r*0.85} x2={cx} y2={cy+r*1.1} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<line x1={cx-r*1.1} y1={cy} x2={cx-r*0.85} y2={cy} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
<line x1={cx+r*0.85} y1={cy} x2={cx+r*1.1} y2={cy} stroke={mid} strokeWidth="2" strokeLinecap="round"/>
</svg>
);
}

if (family === "flow") {
var pts2 = [];
for (var t2=0; t2<=1; t2+=0.04) {
var wx = cx + r * 1.1 * (t2*2-1);
var wy = cy + r * 0.5 * Math.sin(t2 * Math.PI * 2.5);
pts2.push(wx+","+wy);
}
return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<polyline points={pts2.join(" ")} fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
<polyline points={pts2.map(function(p){var parts=p.split(",");return parts[0]+","+(parseFloat(parts[1])+r*0.28);}).join(" ")} fill="none" stroke={dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
<circle cx={cx} cy={cy} r="4.5" fill={c} opacity="0.9"/>
</svg>
);
}

return (
<svg viewBox={"0 0 "+s+" "+s} width={s} height={s}>
<circle cx={cx} cy={cy} r={r*1.2} fill="none" stroke={dim} strokeWidth="1"/>
<circle cx={cx} cy={cy} r={r} fill="none" stroke={mid} strokeWidth="2"/>
<polygon points={[
cx+","+(cy-r*0.72),
cx+r*0.62+","+(cy+r*0.36),
cx-r*0.62+","+(cy+r*0.36)
].join(" ")} fill="none" stroke={mid} strokeWidth="2" strokeLinejoin="round"/>
<polygon points={[
cx+","+(cy+r*0.72),
cx+r*0.62+","+(cy-r*0.36),
cx-r*0.62+","+(cy-r*0.36)
].join(" ")} fill="none" stroke={dim} strokeWidth="1.5" strokeLinejoin="round"/>
<circle cx={cx} cy={cy} r="5" fill={c} opacity="0.9"/>
</svg>
);
}

function hexDarken(hex, opacity) {
try {
var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
var dr = Math.round(r * opacity), dg = Math.round(g * opacity), db = Math.round(b * opacity);
return "rgb("+dr+","+dg+","+db+")";
} catch(e) { return "#1A0A2E"; }
}

function FieldConditionCard({ themes, sd, primaryArch, sessionCount, portrait, portraitReady, goNext }) {
themes = themes || []; sd = sd || {};


var [_fcPhrase, _fcSetPhrase] = useState(null);
var [_fcLoading, _fcSetLoading] = useState(true);
var _fcColors = themes.slice(0,6).map(function(t){return t.color;});
var _fcBg1 = _fcColors[0] || "#E84393";
var _fcBg2 = _fcColors[1] || "#6BB8FF";
var _fcBg3 = _fcColors[2] || "#6BFFB8";

useEffect(function() {
if (portrait && portrait.fieldCondition) {
_fcSetPhrase({ condition: portrait.fieldCondition, undercurrent: portrait.undercurrent || "" });
_fcSetLoading(false);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var themeList = themes.map(function(t){return t.label+"("+t.weight+")";}).join(", ");
var p = "Field quality in 2-4 words (not generic). Themes: "+themeList+". JSON: {\"phrase\":\"words\",\"undercurrent\":\"sentence 10-14 words\"}";
var rr = await callClaudeClient(p, "fc", 80);
if (!cancelled) { var dd = parseJSON(rr); if (dd) { if (dd.phrase && !dd.condition) dd.condition = dd.phrase; _fcSetPhrase(dd); } }
} catch(e) {} finally { if (!cancelled) _fcSetLoading(false); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

var _condWords = (_fcPhrase && _fcPhrase.condition) ? _fcPhrase.condition.split(" ") : [];
var _condSizes = [72, 56, 48, 40]; 
var _numThemes = themes.length;
var _numConns = (sd && sd.connections || []).length;

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden", background:"#030308" }}>
{_fcColors.map(function(col, ci) {
var angles = [15, 75, 135, 200, 270, 330];
var radii = [55, 45, 60, 50, 55, 45];
var angle = (angles[ci] || ci*60) * Math.PI / 180;
var r = radii[ci] || 50;
var bx = 50 + Math.cos(angle) * r;
var by = 42 + Math.sin(angle) * r;
return <div key={ci} style={{
position:"absolute",
left: bx+"%", top: by+"%",
transform:"translate(-50%,-50%)",
width: 280 + ci*30, height: 280 + ci*30,
borderRadius:"50%",
background:"radial-gradient(circle, "+col+"28 0%, "+col+"08 50%, transparent 72%)",
filter:"blur(55px)",
pointerEvents:"none",
animation:"breathe "+(3+ci*0.7)+"s ease-in-out infinite alternate"
}}/>;
})}

<svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:0.25, pointerEvents:"none" }}>
{themes.map(function(t, ti) {
var angle = (ti / themes.length) * 2 * Math.PI - Math.PI/2;
var rx = 32, ry = 28;
var cx2 = 50 + Math.cos(angle)*rx;
var cy2 = 42 + Math.sin(angle)*ry;
return <g key={ti}>
<circle cx={cx2+"%"} cy={cy2+"%"} r="2.5" fill={t.color} opacity="0.7"/>
{themes.slice(ti+1, ti+3).map(function(t2, li){
var angle2 = ((ti+li+1) / themes.length) * 2 * Math.PI - Math.PI/2;
var cx3 = 50 + Math.cos(angle2)*rx;
var cy3 = 42 + Math.sin(angle2)*ry;
return <line key={li} x1={cx2+"%"} y1={cy2+"%"} x2={cx3+"%"} y2={cy3+"%"}
stroke={t.color} strokeWidth="0.5" opacity="0.3"/>;
})}
</g>;
})}
</svg>

<div style={{ position:"absolute", top:46, left:24, fontSize:9, letterSpacing:"0.5em", color:"rgba(255,255,255,0.1)", fontFamily:FB }}>SAYCRD</div>

<div style={{ position:"absolute", top:44, right:24, textAlign:"right" }}>
<div style={{ fontSize:8, letterSpacing:"0.25em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase" }}>
{sessionCount > 1 ? "SESSION "+sessionCount+" OF YOUR JOURNEY" : "FIRST SESSION"}
</div>
{sessionCount === 1 && <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:FD, fontStyle:"italic", marginTop:4 }}>The report will deepen as you continue</div>}
</div>

<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"center", padding:"80px 32px 160px", overflow:"hidden", boxSizing:"border-box" }}>
{_fcLoading ? (
<div style={{ display:"flex", flexDirection:"column", gap:16 }}>
{[90,64,48].map(function(sz,i){
return <div key={i} style={{ height:sz*0.85, width:[220,160,120][i], borderRadius:8,
background:"rgba(255,255,255,0.04)", animation:"breathe 1.5s ease-in-out "+(i*0.2)+"s infinite alternate" }}/>;
})}
</div>
) : (
<>
<div style={{ fontSize:10, letterSpacing:"0.45em", color:_fcBg2, fontFamily:FB, textTransform:"uppercase", marginBottom:20, animation:"riseUp 0.6s ease both",
textShadow:"0 0 20px "+_fcBg2+"66" }}>
THE FIELD CONDITION
</div>
<div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:32, width:"100%", maxWidth:"100%", paddingRight:36, paddingLeft:4, boxSizing:"border-box" }}>
{_condWords.map(function(word, wi) {
var sz = wi===0 ? 72 : wi===1 ? 58 : wi===2 ? 46 : 38;
var col = _fcColors[wi] || "rgba(255,255,255,0.9)";
var l = (word||"").length;
var fitSz = l > 0 ? 220 / (l * 0.6) : sz;
var finalSz = Math.max(18, Math.min(sz, fitSz));
return (
<div key={wi} style={{
fontSize: finalSz,
fontWeight: 700,
color: "white",
fontFamily: FB,
letterSpacing: "-0.02em",
lineHeight: 0.92,
textShadow: "0 0 80px "+col+"66, 0 0 30px "+col+"33",
animation: "riseUp 0.7s ease "+(0.1+wi*0.12)+"s both",
whiteSpace: "nowrap"
}}>
{word}
</div>
);
})}
</div>
{_fcPhrase && _fcPhrase.undercurrent && (
<div style={{
fontSize: 15,
color: "rgba(255,255,255,0.55)",
fontFamily: FD,
fontStyle: "italic",
lineHeight: 1.65,
maxWidth: 290,
animation: "riseUp 0.8s ease 0.55s both"
}}>
{_fcPhrase.undercurrent}
</div>
)}
</>
)}
</div>

<div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"20px 24px 32px",
background:"linear-gradient(0deg, rgba(3,3,8,0.95) 0%, transparent 100%)", cursor:"pointer" }} onClick={function(e){ e.stopPropagation(); if(goNext) goNext(); }}>
<div style={{ display:"flex", gap:2, marginBottom:14, height:3, borderRadius:2, overflow:"hidden" }}>
{themes.map(function(t,ti){
return <div key={ti} style={{ flex: t.weight||1, background:t.color, opacity:0.85 }}/>;
})}
</div>
<div style={{ display:"flex", gap:20, alignItems:"center" }}>
<div style={{ textAlign:"center" }}>
<div style={{ fontSize:28, fontWeight:700, color:"white", fontFamily:FB, lineHeight:1 }}>{_numThemes}</div>
<div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:FB, letterSpacing:"0.15em", textTransform:"uppercase", marginTop:4 }}>themes</div>
</div>
<div style={{ width:1, height:36, background:"rgba(255,255,255,0.12)" }}/>
<div style={{ textAlign:"center" }}>
<div style={{ fontSize:28, fontWeight:700, color:"white", fontFamily:FB, lineHeight:1 }}>{_numConns}</div>
<div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:FB, letterSpacing:"0.15em", textTransform:"uppercase", marginTop:4 }}>connections</div>
</div>
{primaryArch && <>
<div style={{ width:1, height:36, background:"rgba(255,255,255,0.12)" }}/>
<div onClick={function(e){ e.stopPropagation(); if(goNext) goNext(); }} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
<ArchGlyph name={primaryArch.name||""} color={_fcBg1} size={30}/>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.75)", fontFamily:FB, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600 }}>{primaryArch.name}</div>
</div>
</>}
<div style={{ marginLeft:"auto" }}>
<div style={{ display:"flex", gap:5 }}>
{_fcColors.slice(0,5).map(function(col,ci){
return <div key={ci} style={{ width:7, height:7, borderRadius:"50%", background:col, opacity:0.7 }}/>;
})}
</div>
</div>
</div>
</div>


{goNext && (
<div style={{ position:"absolute", bottom:0, left:0, right:0, height:80,
display:"flex", alignItems:"flex-end", justifyContent:"center",
paddingBottom:20, opacity:0, transition:"opacity 0.2s" }}
onMouseEnter={function(e){ e.currentTarget.style.opacity="1"; }}
onMouseLeave={function(e){ e.currentTarget.style.opacity="0"; }}
onClick={function(e){ e.stopPropagation(); goNext(); }}>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", fontFamily:FB,
letterSpacing:"0.25em", cursor:"pointer" }}>NEXT →</div>
</div>
)}
</div>
);
}

function ArchBillboardCard({ themes, sd, primaryArch, archColor, sessionCount, prevArch, allSessions, portrait, portraitReady, goNext }) {
archColor = archColor || (themes && themes[0] && themes[0].color) || "#E84393";

var _ab = primaryArch || (sd && sd.archetypes && sd.archetypes[0]) || null;
var _abName = _ab ? (_ab.name || "") : "THE UNKNOWN";
var _abColor = _ab ? (_ab.color || archColor) : archColor;
var _abWords = _abName.split(" ");

var _abBg = "linear-gradient(145deg, "+hexDarken(_abColor, 0.18)+" 0%, "+hexDarken(_abColor, 0.28)+" 40%, #050208 100%)";

var [_abLine, _abSetLine] = useState(null);
var [_abLoaded, _abSetLoaded] = useState(false);

useEffect(function() {
if (portrait && portrait.archetypeRecognition) {
_abSetLine({
recognition: portrait.archetypeRecognition,
shift: portrait.archetypeShift || null,
shifted: !!(prevArch && prevArch.name !== _abName)
});
_abSetLoaded(true);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var themeCtx = themes.slice(0,4).map(function(t){return t.label;}).join(", ");
var _prevArchName2 = prevArch ? prevArch.name : "";
var _shifted2 = _prevArchName2 && _prevArchName2 !== _abName;
var p = "Archetype: "+_abName+". Prev: "+(_prevArchName2||"none")+". Themes: "+themeCtx+". Write a recognition sentence (10-16 words, bold, use 'You') and a shift phrase (3-5 words). JSON: {\"recognition\":\"...\",\"shift\":\"...\",\"shifted\":"+(_shifted2?"true":"false")+"}";
var rr = await callClaudeClient(p, "arch", 120);
if (!cancelled) {
var dd = parseJSON(rr);
_abSetLine(dd&&dd.recognition ? dd : null);
}
} catch(e) {} finally { if (!cancelled) _abSetLoaded(true); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden", background:_abBg }}>
<div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
opacity:0.06, pointerEvents:"none" }}>
<ArchGlyph name={_abName} color={_abColor} size={400}/>
</div>

<div style={{ position:"absolute", top:0, left:0, right:0, height:"55%",
background:"linear-gradient(180deg, "+_abColor+"18 0%, transparent 100%)",
pointerEvents:"none" }}/>

<div style={{ position:"absolute", top:100, left:24, right:24, height:1,
background:"linear-gradient(90deg, "+_abColor+"88, "+_abColor+"22, transparent)",
animation:"riseUp 0.6s ease 0.2s both" }}/>

<div style={{ position:"absolute", top:46, left:24, fontSize:9, letterSpacing:"0.5em",
color:_abColor+"44", fontFamily:FB }}>SAYCRD</div>

<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
justifyContent:"center", padding:"100px 32px 120px", boxSizing:"border-box" }}>

<div style={{ fontSize:9, letterSpacing:"0.5em", color:_abColor+"BB",
fontFamily:FB, textTransform:"uppercase", marginBottom:18,
animation:"riseUp 0.6s ease both" }}>
YOUR ARCHETYPE
</div>

<div style={{ marginBottom:36, width:"100%", paddingRight:24, boxSizing:"border-box" }}>
{_abWords.map(function(word, wi) {
var isLast = wi === _abWords.length - 1;
var _baseSz = _abWords.length === 1 ? 72 : _abWords.length === 2 ? (wi===0?52:72) : (wi===0?44:wi===1?66:52);
var _wordLen = word.length;
var _scale = _wordLen <= 6 ? 1 : _wordLen <= 9 ? 0.78 : _wordLen <= 12 ? 0.62 : _wordLen <= 16 ? 0.5 : 0.42;
var sz = Math.round(_baseSz * _scale);
return (
<div key={wi} style={{
fontSize: sz,
fontWeight: isLast ? 700 : 300,
width:"100%", whiteSpace: "nowrap", minWidth: 0,
color: isLast ? "white" : _abColor+"CC",
fontFamily: FB,
letterSpacing: isLast ? "-0.02em" : "0.1em",
lineHeight: 0.95,
textTransform: "uppercase",
textShadow: isLast ? "0 0 100px "+_abColor+"44" : "none",
animation: "riseUp 0.8s ease "+(0.05+wi*0.1)+"s both"
}}>
{word}
</div>
);
})}
</div>

<div style={{ width:48, height:2, background:_abColor, marginBottom:24,
animation:"riseUp 0.5s ease 0.4s both", borderRadius:1 }}/>

<div style={{ minHeight:80, animation:"riseUp 0.8s ease 0.5s both" }}>
{!_abLoaded ? (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
<div style={{ width:140, height:10, borderRadius:3,
background:"rgba(255,255,255,0.08)", animation:"breathe 1.5s ease-in-out infinite alternate" }}/>
<div style={{ width:280, height:22, borderRadius:3,
background:"rgba(255,255,255,0.05)", animation:"breathe 1.5s ease-in-out 0.2s infinite alternate" }}/>
<div style={{ width:220, height:22, borderRadius:3,
background:"rgba(255,255,255,0.04)", animation:"breathe 1.5s ease-in-out 0.4s infinite alternate" }}/>
</div>
) : _abLine ? (
<div>
{_abLine.shift && (
<div style={{
display:"inline-flex", alignItems:"center", gap:8,
marginBottom:12,
padding:"4px 12px 4px 0"
}}>
{_abLine.shifted && (
<div style={{ width:6, height:6, borderRadius:"50%",
background:_abColor, boxShadow:"0 0 8px "+_abColor }}/>
)}
<div style={{
fontSize:10, letterSpacing:"0.4em",
color:_abColor,
fontFamily:FB, textTransform:"uppercase",
fontWeight:600
}}>
{_abLine.shift}
</div>
</div>
)}
<div style={{
fontSize: _abLine.recognition && _abLine.recognition.length > 65 ? 18 : _abLine.recognition && _abLine.recognition.length > 45 ? 21 : 24,
fontWeight:800,
color:"rgba(255,255,255,0.97)",
fontFamily:FB,
lineHeight:1.3,
letterSpacing:"-0.015em",
textShadow:"0 2px 40px rgba(0,0,0,0.6), 0 0 60px "+_abColor+"22"
}}>
{_abLine.recognition}
</div>
</div>
) : (
<div style={{ fontSize:20, fontWeight:700, color:"rgba(255,255,255,0.9)",
fontFamily:FB, lineHeight:1.3 }}>
You hold what others cannot yet name.
</div>
)}
</div>
</div>

<div style={{ position:"absolute", bottom:0, left:0, right:0,
padding:"16px 24px 30px",
background:"linear-gradient(0deg, rgba(3,2,8,0.9) 0%, transparent 100%)" }}>
<div style={{ display:"flex", gap:6, marginBottom:12, height:2, borderRadius:1, overflow:"hidden" }}>
{themes.map(function(t,ti){
return <div key={ti} style={{ flex:t.weight||1, background:t.color, opacity:0.7 }}/>;
})}
</div>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
<div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:FB,
letterSpacing:"0.15em", textTransform:"uppercase" }}>
{sessionCount > 1 ? "SESSION "+sessionCount : "FIRST SESSION"}
</div>
<div style={{ display:"flex", alignItems:"center", gap:12 }}>
<div style={{ display:"flex", gap:5 }}>
{themes.slice(0,5).map(function(t,ti){
return <div key={ti} style={{ width:6, height:6, borderRadius:"50%", background:t.color, opacity:0.65 }}/>;
})}
</div>
</div>
</div>
</div>
</div>
);
}

function DepthsFieldCard({ themes, sd, tension, sessionCount, portrait, portraitReady, goNext }) {
themes = themes || []; sd = sd || {};

var _dUnder = typeof (sd && sd.underneath) === "string" ? sd.underneath : "";
var _dBlind = typeof (sd && sd.blind_spot) === "string" ? sd.blind_spot : "";
var _dTension = tension && tension.a && tension.b ? String(tension.a) + " and " + String(tension.b) : "";

var [_dLine, _dSetLine] = useState(null);
var [_dReady, _dSetReady] = useState(false);

useEffect(function() {
if (portrait && portrait.depths) {
_dSetLine(portrait.depths);
_dSetReady(true);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var under = typeof (sd&&sd.underneath)==="string" ? sd.underneath : "";
var blind = typeof (sd&&sd.blind_spot)==="string" ? sd.blind_spot : "";
var p = "One sentence (10-14 words): what is just out of sight in this person's field? Pattern intelligence — repetition, structure, blind spots they may not see. From: underneath="+under+" blind_spot="+blind+". JSON: {\"revelation\":\"sentence\"}";
var rr = await callClaudeClient(p, "df", 80);
if (!cancelled) { var dd = parseJSON(rr); if (dd&&dd.revelation) _dSetLine(dd.revelation); }
} catch(e) {} finally { if (!cancelled) _dSetReady(true); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

var _dParticles = useMemo(function() {
var pts = [];
for (var pi = 0; pi < 38; pi++) {
var seed = pi * 137.508;
pts.push({
x: ((seed * 7.3) % 100),
y: ((seed * 3.1) % 100),
size: 1 + (pi % 3) * 0.8,
dur: 6 + (pi % 5) * 2.4,
delay: -(pi % 7) * 1.3,
opacity: 0.15 + (pi % 4) * 0.12,
color: ["#4EC9B8","#6BB8FF","#A78BFA","#7FFFD4","#38BDF8"][pi % 5]
});
}
return pts;
}, []);

var _dShafts = useMemo(function() {
return [
{ x: 18, w: 6, dur: 8, delay: 0, opacity: 0.04 },
{ x: 42, w: 10, dur: 11, delay: -3, opacity: 0.06 },
{ x: 67, w: 7, dur: 9, delay: -5.5, opacity: 0.05 },
{ x: 82, w: 5, dur: 13, delay: -1.5, opacity: 0.03 },
];
}, []);

var _depthText = _dLine || (_dUnder && typeof _dUnder === "string" && _dUnder.length > 0 ? _dUnder.split(".")[0] + "." : "Something waits beneath the words you chose.");

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden",
background:"linear-gradient(180deg, #021018 0%, #010C1A 20%, #040A22 45%, #05072A 68%, #03041A 85%, #010208 100%)" }}>

<div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
<div style={{ position:"absolute", top:0, left:0, right:0, height:"22%",
background:"linear-gradient(180deg, #0A3A4A44 0%, transparent 100%)" }}/>
<div style={{ position:"absolute", top:"25%", left:0, right:0, height:"35%",
background:"linear-gradient(180deg, transparent, #050A3022 50%, transparent)" }}/>
<div style={{ position:"absolute", bottom:0, left:0, right:0, height:"38%",
background:"linear-gradient(0deg, #03010F 0%, #06041A44 60%, transparent 100%)" }}/>
</div>

{_dShafts.map(function(sh, si) {
return (
<div key={si} style={{
position:"absolute",
top:0,
left: sh.x + "%",
width: sh.w + "%",
height:"60%",
background:"linear-gradient(180deg, rgba(107,200,255,"+sh.opacity+") 0%, rgba(78,160,200,"+Math.round(sh.opacity*0.4*100)/100+") 40%, transparent 100%)",
transform:"skewX(-8deg)",
transformOrigin:"top center",
animation:"shaftPulse "+sh.dur+"s ease-in-out "+sh.delay+"s infinite",
pointerEvents:"none"
}}/>
);
})}

<svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible", pointerEvents:"none" }}>
{_dParticles.map(function(p, pi) {
return (
<circle key={pi}
cx={p.x+"%"} cy={p.y+"%"}
r={p.size}
fill={p.color}
opacity={p.opacity}>
<animate attributeName="cy"
values={p.y+"%;"+(p.y-28)+"%;"+(p.y-56)+"%"}
dur={p.dur+"s"}
begin={p.delay+"s"}
repeatCount="indefinite"
calcMode="linear"/>
<animate attributeName="opacity"
values={p.opacity+";"+Math.min(p.opacity*2.5,0.7)+";0"}
dur={p.dur+"s"}
begin={p.delay+"s"}
repeatCount="indefinite"/>
<animate attributeName="r"
values={p.size+";"+(p.size*1.6)+";0"}
dur={p.dur+"s"}
begin={p.delay+"s"}
repeatCount="indefinite"/>
</circle>
);
})}
</svg>

{[22, 45, 68].map(function(pct, li) {
return (
<div key={li} style={{
position:"absolute",
top: pct+"%",
left:0, right:0,
height:1,
background:"linear-gradient(90deg, transparent, rgba(107,184,255,"+(0.04+li*0.02)+") 30%, rgba(107,184,255,"+(0.06+li*0.02)+") 60%, transparent)",
pointerEvents:"none"
}}/>
);
})}

<div style={{ position:"absolute", top:46, left:0, right:0, textAlign:"center" }}>
<div style={{ fontSize:8, letterSpacing:"0.5em", color:"rgba(107,200,255,0.3)",
fontFamily:FB, textTransform:"uppercase" }}>SAYCRD</div>
</div>

<div style={{ position:"absolute", top:"28%", left:0, right:0, textAlign:"center",
animation:"riseUp 0.8s ease 0.1s both" }}>
<div style={{ fontSize:9, letterSpacing:"0.55em", color:"rgba(107,200,255,0.22)",
fontFamily:FB, textTransform:"uppercase", marginBottom:12 }}>DESCENDING INTO</div>
<div style={{ fontSize:38, fontWeight:700, color:"rgba(200,235,255,0.88)", fontFamily:FB,
letterSpacing:"0.04em", textTransform:"uppercase", lineHeight:1.1,
textShadow:"0 0 60px rgba(107,184,255,0.25)" }}>
DEPTHS
</div>
<div style={{ fontSize:38, fontWeight:300, color:"rgba(150,200,255,0.5)", fontFamily:FB,
letterSpacing:"0.18em", textTransform:"uppercase", lineHeight:1.1 }}>
OF THE FIELD
</div>
</div>

<div style={{ position:"absolute", bottom:0, left:0, right:0,
padding:"0 28px 44px",
background:"linear-gradient(0deg, #010208 0%, #02030F88 50%, transparent 100%)" }}>

<div style={{ width:"100%", height:1, marginBottom:22,
background:"linear-gradient(90deg, transparent, rgba(107,184,255,0.3) 30%, rgba(164,220,255,0.5) 60%, rgba(107,184,255,0.2) 80%, transparent)",
animation:"riseUp 0.6s ease 0.3s both" }}/>

<div style={{ fontSize:8, letterSpacing:"0.4em", color:"rgba(107,200,255,0.35)",
fontFamily:FB, textTransform:"uppercase", marginBottom:12,
animation:"riseUp 0.7s ease 0.4s both" }}>
JUST OUT OF SIGHT
</div>

<div style={{ fontSize:16, color:"rgba(200,230,255,0.72)", fontFamily:FD,
fontStyle:"italic", lineHeight:1.7, maxWidth:310,
minHeight:52,
animation:"riseUp 0.9s ease 0.5s both" }}>
{!_dReady ? (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
<div style={{ width:"88%", height:14, borderRadius:3,
background:"rgba(107,184,255,0.07)", animation:"breathe 1.8s ease-in-out infinite alternate" }}/>
<div style={{ width:"65%", height:14, borderRadius:3,
background:"rgba(107,184,255,0.05)", animation:"breathe 1.8s ease-in-out 0.3s infinite alternate" }}/>
</div>
) : _depthText}
</div>

<div style={{ display:"flex", gap:5, marginTop:18 }}>
{themes.map(function(t,ti){
return <div key={ti} style={{ width:5, height:5, borderRadius:"50%",
background:t.color, opacity:0.25 }}/>;
})}
</div>
</div>
</div>
);
}

function WhatsGrowingCard({ themes, sessionCount, goNext }) {
themes = themes || [];

var _allSessions = (function() {
try { return loadSessions(); } catch(e) { return []; }
})();
var _recent = _allSessions.slice(-5);

var _wgFreq = {};
var _allColors = {};
_recent.forEach(function(s, si) {
var w = si + 1;
(s.themes || []).forEach(function(t) {
if (!t.label) return;
_wgFreq[t.label] = (_wgFreq[t.label] || 0) + w;
if (t.color) _allColors[t.label] = t.color;
});
});
themes.forEach(function(t) {
if (!t.label) return;
_wgFreq[t.label] = (_wgFreq[t.label] || 0) + 6;
if (t.color) _allColors[t.label] = t.color;
});

var NC2 = ["#C4956A","#7BAE8A","#8B9EC4","#C48B7A","#9E8BC4","#C4B97A"];
var _branches = Object.keys(_wgFreq)
.map(function(label, idx) {
return { label: label, score: _wgFreq[label], color: _allColors[label] || NC2[idx % NC2.length] };
})
.sort(function(a,b) { return b.score - a.score; })
.slice(0, 5);

var _maxScore = _branches.length > 0 ? _branches[0].score : 1;

var [_wgLine, _wgSetLine] = useState(null);
var [_wgReady, _wgSetReady] = useState(false);

useEffect(function() {
var cancelled = false;
(async function() {
try {
if (_branches.length === 0) { _wgSetReady(true); return; }
var top3 = _branches.slice(0,3).map(function(b){return b.label;}).join(", ");
var p = "Someone's inner life. The themes growing most in recent sessions: " + top3 + ".\n"
+ "Write ONE sentence (8-12 words). Not advice. Not analysis.\n"
+ "What is this person's life reaching toward? Poetic, warm, surprising. No clichés.\n"
+ 'JSON only: {"line":"sentence here"}';
var rr = await callClaudeClient(p, "whats growing", 80);
if (cancelled) return;
var dd = parseJSON(rr);
_wgSetLine(dd && dd.line ? dd.line : null);
} catch(e) {}
finally { if (!cancelled) _wgSetReady(true); }
})();
return function(){ cancelled = true; };
}, []);

var _sizes = [68, 48, 34, 24, 16];
var _weights = [700, 600, 400, 300, 300];
var _tracking = ["-0.03em", "-0.02em", "0em", "0.02em", "0.04em"];

return (
<div style={{
position:"absolute", inset:0, overflow:"hidden",
background:"#F7F4EF",
display:"flex", flexDirection:"column"
}}>
<div style={{ padding:"52px 28px 0 24px" }}>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
marginBottom:12 }}>
<div style={{ fontSize:7.5, letterSpacing:"0.45em", color:"#999", fontFamily:FB,
textTransform:"uppercase" }}>
SAYCRD
</div>
<div style={{ fontSize:7.5, letterSpacing:"0.3em", color:"#bbb", fontFamily:FB,
textTransform:"uppercase" }}>
{sessionCount > 1 ? "SESSION "+sessionCount : "FIRST SESSION"}
</div>
</div>
<div style={{ height:0.75, background:"#D0C8BC", marginBottom:10 }}/>
<div style={{ fontSize:8, letterSpacing:"0.55em", color:"#888", fontFamily:FB,
textTransform:"uppercase", marginBottom:10 }}>
WHAT'S GROWING
</div>
<div style={{ height:0.5, background:"#E0D8D0" }}/>
</div>

<div style={{ flex:1, display:"flex", flexDirection:"column",
justifyContent:"center", padding:"0 48px 0 24px", boxSizing:"border-box", minWidth:0 }}>
{_branches.map(function(b, bi) {
var isFirst = bi === 0;
var sz = _sizes[bi] || 13;
var wt = _weights[bi] || 300;
var tr = _tracking[bi] || "0.04em";
var ratio = b.score / _maxScore;
var labelText = (b && b.label) ? String(b.label) : "";
if (isFirst) {
var l = labelText.trim().length;
var scale = l <= 10 ? 1 : l <= 14 ? 0.86 : l <= 18 ? 0.74 : l <= 22 ? 0.64 : 0.56;
sz = Math.max(34, Math.round(sz * scale));
}

return (
<div key={bi} style={{ marginBottom: isFirst ? 6 : bi===1 ? 8 : 10,
animation:"riseUp 0.6s ease "+(bi*0.12)+"s both" }}>
{isFirst && (
<div style={{ width: Math.round(ratio * 140) + 32, height:2,
background: b.color, borderRadius:1, marginBottom:8,
opacity:0.85 }}/>
)}
<div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
{!isFirst && (
<div style={{ width:4, height:4, borderRadius:"50%",
background:b.color, flexShrink:0,
marginBottom: sz * 0.15,
opacity:0.7 }}/>
)}
<div style={{
fontSize: (function(){ var l=(labelText||"").length; return l<=10?sz:l<=14?Math.max(24,sz-6):Math.max(18,sz-12); })(),
fontWeight: wt,
fontFamily: bi <= 1 ? FB : FD,
fontStyle: bi >= 3 ? "italic" : "normal",
letterSpacing: tr,
color: isFirst ? "#1A1A1A" : bi===1 ? "#2A2A2A" : bi===2 ? "#555" : "#888",
lineHeight: 1.05,
textTransform: bi <= 1 ? "uppercase" : "none",
flex: "1 1 auto",
minWidth: 0,
maxWidth: "100%",
wordBreak: "break-word",
overflowWrap: "break-word"
}}>
{labelText}
</div>
{bi <= 1 && (
<div style={{ marginLeft:"auto", display:"flex", gap:3, alignItems:"center" }}>
{[0,1,2].map(function(di) {
return <div key={di} style={{
width:5, height:5, borderRadius:"50%",
background: di < Math.ceil(ratio*3) ? b.color : "#E0D8D0"
}}/>;
})}
</div>
)}
</div>
{bi < _branches.length-1 && (
<div style={{ height:0.5, background:"#E8E2D8", marginTop: isFirst ? 10 : bi===1?10:8 }}/>
)}
</div>
);
})}
</div>

<div style={{ padding:"0 48px 40px 24px" }}>
<div style={{ height:0.75, background:"#D0C8BC", marginBottom:18 }}/>
<div style={{ minHeight:52 }}>
{!_wgReady ? (
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
<div style={{ width:"80%", height:14, borderRadius:3, background:"#E8E2D8",
animation:"breathe 1.8s ease-in-out infinite alternate" }}/>
<div style={{ width:"55%", height:14, borderRadius:3, background:"#EEE9E2",
animation:"breathe 1.8s ease-in-out 0.3s infinite alternate" }}/>
</div>
) : (
<div style={{ fontSize:17, color:"#4A4038", fontFamily:FD,
fontStyle:"italic", lineHeight:1.75, wordBreak:"break-word", overflowWrap:"break-word", maxWidth:"100%" }}>
{_wgLine || (_branches[0] ? "\u201c"+_branches[0].label+" keeps returning \u2014 it wants something.\u201d" : "The field is learning what it loves.")}
</div>
)}
</div>
</div>
</div>
);
}

function MirrorCard({ themes, sd, sessionCount, rawText, portrait, portraitReady, goNext }) {
themes = themes || [];

var _allSessions = (function() {
try { return loadSessions(); } catch(e) { return []; }
})();
var _prev = _allSessions.length > 0 ? _allSessions[_allSessions.length - 1] : null;

var _prevArch = (_prev && _prev.archetypes && _prev.archetypes[0] && _prev.archetypes[0].name) || "";
var _prevDate = _prev && _prev.date
? new Date(_prev.date).toLocaleDateString("en-US",{month:"long",day:"numeric"})
: "";
var _currArch = (sd && sd.archetypes && sd.archetypes[0] && sd.archetypes[0].name) || "";
var _archShifted = _prevArch && _currArch && _prevArch !== _currArch;
var _isFirst = !_prev;

var _prevThemes = _prev ? (_prev.themes||[]).slice(0,3).map(function(t){ return t.label||""; }).filter(Boolean) : [];
var _currThemes = themes.slice(0,3).map(function(t){ return t.label||""; }).filter(Boolean);
var _newThemes = _currThemes.filter(function(t){ return _prevThemes.indexOf(t) < 0; });
var _goneThemes = _prevThemes.filter(function(t){ return _currThemes.indexOf(t) < 0; });
var _stayed = _currThemes.filter(function(t){ return _prevThemes.indexOf(t) >= 0; });


var _sameContent = !_isFirst && _newThemes.length === 0 && _goneThemes.length === 0;
var _openingFull = (sd && typeof sd.opening === "string" && sd.opening.trim()) ? sd.opening.trim() : "";
var _blindFull = (sd && typeof sd.blind_spot === "string" && sd.blind_spot.trim()) ? sd.blind_spot.trim() : "";
var _thenLabel = _sameContent ? "BROUGHT IN" : ("THEN" + (_prevDate ? " · "+_prevDate : ""));
var _nowLabel = _sameContent ? "SURFACED" : "NOW";
var _thenWords = _sameContent ? _prevThemes : (_prevThemes.length ? _prevThemes : (_openingFull ? [_openingFull.slice(0,80)] : []));
var _nowWords = _currThemes;
var _prevTension = (_prev && _prev.tension && _prev.tension.a) ? _prev.tension.a+" vs "+_prev.tension.b : "";
var _currTension = (sd && sd.tension && sd.tension.a) ? sd.tension.a+" vs "+sd.tension.b : "";

var _currColor = themes[0] ? themes[0].color : "#E8B87C";

var [_shift, _setShift] = useState(null);
var [_ready, _setReady] = useState(false);

useEffect(function() {
if (portrait && portrait.mirrorShift) {
_setShift(portrait.mirrorShift);
_setReady(true);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var prevThemes = _prev ? (_prev.themes||[]).slice(0,3).map(function(t){return t.label;}).join(",") : "";
var currThemes = themes.slice(0,3).map(function(t){return t.label;}).join(",");
var ctx = "Previous session: arch="+_prevArch+" themes="+prevThemes;
ctx += " | This session: arch="+_currArch+" themes="+currThemes;
if (sd.blind_spot) ctx += " blind_spot="+String(sd.blind_spot).slice(0,60);
var p = "One sentence (10-15 words): what specifically shifted internally between these two sessions? Plain, direct, third person.\n"+ctx+"\nJSON: {\"shift\":\"...\"}";
var rr = await callClaudeClient(p, "mirror", 80);
if (!cancelled) {
var dd = parseJSON(rr);
if (dd && dd.shift) _setShift(dd.shift);
}
} catch(e) {} finally { if (!cancelled) _setReady(true); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden",
background:"linear-gradient(160deg, #06080F 0%, #080610 60%, #08060C 100%)",
display:"flex", flexDirection:"column" }}>

<div style={{ position:"absolute", inset:0, opacity:0.025, pointerEvents:"none",
backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\")",
backgroundSize:"200px 200px" }}/>

<div style={{ padding:"52px 28px 0", flexShrink:0 }}>
<div style={{ fontSize:8, letterSpacing:"0.55em",
color:"rgba(200,210,240,0.2)", fontFamily:FB, marginBottom:6 }}>
SAYCRD
</div>
<div style={{ fontSize:10, letterSpacing:"0.4em",
color:"rgba(200,210,240,0.35)", fontFamily:FB }}>
THE MIRROR
</div>
</div>

<div style={{ flex:1, minHeight:0, display:"flex", flexDirection:"column",
justifyContent:"flex-start", padding:"24px 28px 36px",
overflowY:"auto", WebkitOverflowScrolling:"touch" }}>

{_isFirst ? (
<div style={{ animation:"riseUp 0.8s ease 0.2s both" }}>
<div style={{ fontSize:22, fontWeight:700, color:"rgba(255,255,255,0.75)",
fontFamily:FB, lineHeight:1.3, marginBottom:14,
wordBreak:"break-word" }}>
This is your first session.
</div>
<div style={{ fontSize:15, color:"rgba(200,210,240,0.4)",
fontFamily:FD, lineHeight:1.7 }}>
The mirror needs two sessions to show you what moved. Come back.
</div>
</div>
) : (
<div>

<div style={{ marginBottom:44, animation:"riseUp 0.7s ease 0.1s both" }}>
<div style={{ fontSize:9, letterSpacing:"0.45em",
color:"rgba(200,210,240,0.25)", fontFamily:FB, marginBottom:20 }}>
WHAT MOVED
</div>

{_ready && _shift ? (
<div style={{ fontSize:22, fontWeight:600,
color:"rgba(255,255,255,0.88)", fontFamily:FD,
lineHeight:1.55, wordBreak:"break-word",
overflowWrap:"break-word" }}>
{_shift}
</div>
) : (
<div>
<div style={{ width:"90%", height:22, borderRadius:3,
background:"rgba(255,255,255,0.06)",
animation:"breathe 1.5s ease-in-out infinite alternate",
marginBottom:10 }}/>
<div style={{ width:"65%", height:22, borderRadius:3,
background:"rgba(255,255,255,0.04)",
animation:"breathe 1.5s ease-in-out 0.3s infinite alternate" }}/>
</div>
)}
</div>

<div style={{ animation:"riseUp 0.6s ease 0.4s both" }}>
{(() => {
var _tTxt = (_thenWords || []).join(" ");
var _nTxt = (_nowWords || []).join(" ");
var stackCols = (_tTxt.length > 22 || _nTxt.length > 22);
return (
<div style={{ display:"flex", flexDirection: stackCols ? "column" : "row", alignItems:"stretch", gap:16 }}>

<div style={{ flex:1, minWidth:0 }}>
<div style={{ fontSize:8, letterSpacing:"0.4em",
color:"rgba(120,150,200,0.4)", fontFamily:FB, marginBottom:10 }}>
{_thenLabel}
</div>
<div style={{
padding:"14px 14px",
borderRadius:16,
background:"linear-gradient(180deg, rgba(120,150,200,0.10), rgba(120,150,200,0.04))",
border:"1px solid rgba(120,150,200,0.18)"
}}>
<div style={{ fontSize:16, fontWeight:800,
color: _archShifted ? "rgba(120,150,200,0.45)" : "rgba(120,150,200,0.8)",
fontFamily:FB, lineHeight:1.25,
textDecoration: _archShifted ? "line-through" : "none",
textDecorationColor:"rgba(120,150,200,0.25)",
wordBreak:"break-word", overflowWrap:"anywhere" }}>
{_sameContent ? (_openingFull || _prevArch || "—") : (_prevArch || "—")}
</div>
{_thenWords && _thenWords.length > 0 && (
<div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:8 }}>
{_thenWords.slice(0,4).map(function(w, wi) {
return <div key={wi} style={{
fontSize:10, fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase",
padding:"5px 10px", borderRadius:999,
border:"1px solid rgba(120,150,200,0.18)",
background:"rgba(0,0,0,0.10)",
color:"rgba(200,210,240,0.55)",
maxWidth:"100%",
whiteSpace:"normal",
wordBreak:"break-word",
overflowWrap:"anywhere",
lineHeight:1.25
}}>{w}</div>;
})}
</div>
)}
</div>
</div>

<div style={{
paddingTop: stackCols ? 2 : 22,
textAlign:"center",
color:"rgba(200,210,240,0.15)",
fontSize:18,
flexShrink:0
}}>
{stackCols ? "↓" : "→"}
</div>

<div style={{ flex:1, minWidth:0 }}>
<div style={{ fontSize:8, letterSpacing:"0.4em",
color:_currColor+"88", fontFamily:FB, marginBottom:10 }}>
{_nowLabel}
</div>
<div style={{
padding:"14px 14px",
borderRadius:16,
background:"linear-gradient(180deg, "+_currColor+"14, "+_currColor+"06)",
border:"1px solid "+_currColor+"22"
}}>
<div style={{ fontSize:16, fontWeight:900,
color:_currColor, fontFamily:FB, lineHeight:1.25,
textShadow:"0 0 20px "+_currColor+"33",
wordBreak:"break-word", overflowWrap:"anywhere" }}>
{_sameContent ? (_blindFull || _currArch || "—") : (_currArch || "—")}
</div>
{_nowWords && _nowWords.length > 0 && (
<div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:8 }}>
{_nowWords.slice(0,4).map(function(w, wi) {
return <div key={wi} style={{
fontSize:10, fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase",
padding:"5px 10px", borderRadius:999,
border:"1px solid "+_currColor+"22",
background:"rgba(0,0,0,0.10)",
color:_currColor+"bb",
maxWidth:"100%",
whiteSpace:"normal",
wordBreak:"break-word",
overflowWrap:"anywhere",
lineHeight:1.25
}}>{w}</div>;
})}
</div>
)}
</div>
</div>

</div>
);
})()}

{!_archShifted && _prevArch && (
<div style={{ marginTop:12, fontSize:11,
color:"rgba(200,210,240,0.22)", fontFamily:FB, letterSpacing:"0.1em" }}>
SAME GROUND · DEEPER WORK
</div>
)}
</div>

</div>
)}
</div>

<div style={{ padding:"0 28px 36px", flexShrink:0,
display:"flex", justifyContent:"space-between", alignItems:"center" }}>
<div style={{ fontSize:8, letterSpacing:"0.35em",
color:"rgba(200,210,240,0.12)", fontFamily:FB }}>
SESSION {sessionCount}
</div>
</div>

</div>
);
}

function RealmCard({ themes, sd, sessionCount, portrait, portraitReady, goNext }) {
themes = themes || [];

var [_rData, _setRData] = useState(null);
var [_rReady, _setRReady] = useState(false);

useEffect(function() {
if (portrait && portrait.realmWitness) {
_setRData({
realmName: portrait.realmName || "THE THRESHOLD",
realmPosition: portrait.realmPosition || 0.5,
witness: portrait.realmWitness,
declaration: portrait.realmDeclaration || ""
});
_setRReady(true);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var themeStr = themes.slice(0,4).map(function(t){return t.label;}).join(", ");
var p = "Place this person's soul in the vertical landscape of consciousness. Themes: "+themeStr+". Realms: THE FORGE(0.1), THE STORM(0.3), THE THRESHOLD(0.5), THE CHRYSALIS(0.7), THE DAWN(0.9). JSON: {\"realmName\":\"THE X\",\"realmPosition\":0.5,\"witness\":\"10-14 words\",\"declaration\":\"3-6 words\"}";
var rr = await callClaudeClient(p, "realm", 120);
if (!cancelled) {
var dd = parseJSON(rr);
if (dd&&dd.realmName) { dd.realmPosition=Math.max(0.05,Math.min(0.95,parseFloat(dd.realmPosition)||0.5)); _setRData(dd); }
}
} catch(e) {} finally { if (!cancelled) _setRReady(true); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

var _pos = _rData ? _rData.realmPosition : 0.5;
var _sparkTop = (1 - _pos) * 72 + 8; 

var _sparkColor = _pos < 0.2 ? "#FF4422"
: _pos < 0.4 ? "#FF8844"
: _pos < 0.6 ? "#A88CDF"
: _pos < 0.8 ? "#F0C060"
: "#FFF8E0";

var _sparkGlow = _pos < 0.2 ? "rgba(255,60,20,0.6)"
: _pos < 0.4 ? "rgba(255,120,40,0.5)"
: _pos < 0.6 ? "rgba(160,130,220,0.5)"
: _pos < 0.8 ? "rgba(240,190,80,0.5)"
: "rgba(255,248,220,0.6)";

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden" }}>

<div style={{ position:"absolute", bottom:0, left:0, right:0, height:"22%",
background:"linear-gradient(0deg, #1A0500 0%, #2D0A02 40%, #180804 70%, transparent 100%)" }}/>
<div style={{ position:"absolute", bottom:0, left:0, right:0, height:"14%",
background:"linear-gradient(0deg, #3D0A00 0%, #220600 60%, transparent 100%)",
opacity:0.8 }}/>
<div style={{ position:"absolute", bottom:"2%", left:"15%", width:"18%", height:"10%",
background:"radial-gradient(ellipse, rgba(255,60,10,0.25) 0%, transparent 70%)",
filter:"blur(6px)" }}/>
<div style={{ position:"absolute", bottom:"3%", right:"20%", width:"22%", height:"8%",
background:"radial-gradient(ellipse, rgba(255,80,10,0.2) 0%, transparent 70%)",
filter:"blur(8px)" }}/>

<div style={{ position:"absolute", bottom:"18%", left:0, right:0, height:"22%",
background:"linear-gradient(0deg, transparent, rgba(60,55,80,0.5) 30%, rgba(70,65,90,0.4) 60%, transparent 100%)" }}/>
{[15,30,50,68,82].map(function(x,i){
return <div key={i} style={{ position:"absolute",
bottom:(18+i*1.5)+"%", left:x+"%", width:"1px", height:"12%",
background:"linear-gradient(0deg, transparent, rgba(180,170,210,0.07), transparent)",
transform:"skewX(-25deg)", pointerEvents:"none" }}/>;
})}

<div style={{ position:"absolute", bottom:"36%", left:0, right:0, height:"20%",
background:"linear-gradient(0deg, transparent, rgba(80,100,90,0.3) 40%, rgba(90,110,100,0.25) 70%, transparent 100%)" }}/>
<div style={{ position:"absolute", bottom:"38%", left:0, right:0, height:"8%",
background:"linear-gradient(0deg, transparent, rgba(140,160,150,0.12) 50%, transparent 100%)",
filter:"blur(3px)" }}/>

<div style={{ position:"absolute", bottom:"52%", left:0, right:0, height:"22%",
background:"linear-gradient(0deg, transparent, rgba(160,110,40,0.18) 40%, rgba(180,130,50,0.15) 70%, transparent 100%)" }}/>
<div style={{ position:"absolute", bottom:"58%", left:"25%", right:"25%", height:"12%",
background:"radial-gradient(ellipse, rgba(220,160,60,0.1) 0%, transparent 70%)",
filter:"blur(10px)" }}/>

<div style={{ position:"absolute", top:0, left:0, right:0, height:"30%",
background:"linear-gradient(180deg, rgba(255,245,200,0.12) 0%, rgba(240,210,120,0.07) 40%, transparent 100%)" }}/>
<div style={{ position:"absolute", top:0, left:"20%", right:"20%", height:"20%",
background:"radial-gradient(ellipse, rgba(255,248,220,0.15) 0%, transparent 70%)",
filter:"blur(12px)" }}/>

{[20, 38, 55, 72].map(function(pct, li) {
return <div key={li} style={{
position:"absolute", bottom:pct+"%", left:0, right:0, height:1,
background:"linear-gradient(90deg, transparent, rgba(200,190,220,0.06) 30%, rgba(200,190,220,0.1) 60%, transparent)",
pointerEvents:"none"
}}/>;
})}


<div style={{
position:"absolute", left:"50%", top:_sparkTop+"%",
transform:"translate(-50%,-50%)",
width:80, height:80,
background:"radial-gradient(circle, "+_sparkGlow+" 0%, transparent 70%)",
filter:"blur(8px)",
animation:"breathe 2.5s ease-in-out infinite",
pointerEvents:"none"
}}/>
<div style={{
position:"absolute", left:"50%", top:_sparkTop+"%",
transform:"translate(-50%,-50%)",
width:32, height:32,
background:"radial-gradient(circle, "+_sparkColor+"88 0%, transparent 70%)",
filter:"blur(3px)",
animation:"breathe 2.5s ease-in-out infinite",
pointerEvents:"none"
}}/>
<div style={{
position:"absolute", left:"50%", top:_sparkTop+"%",
transform:"translate(-50%,-50%)",
width:7, height:7,
borderRadius:"50%",
background:_sparkColor,
boxShadow:"0 0 12px "+_sparkGlow+", 0 0 4px "+_sparkColor,
animation:"breathe 2s ease-in-out infinite",
pointerEvents:"none"
}}/>
<div style={{
position:"absolute", left:"50%", top:(_sparkTop-8)+"%",
transform:"translateX(-50%)",
width:1, height:"8%",
background:"linear-gradient(0deg, "+_sparkColor+"66, transparent)",
pointerEvents:"none"
}}/>

<div style={{
position:"absolute", left:0, right:0,
top: Math.max(6, _sparkTop - 22)+"%",
textAlign:"center",
animation:"riseUp 0.8s ease 0.6s both",
pointerEvents:"none"
}}>
{_rReady && _rData ? (
<div style={{ fontSize:11, letterSpacing:"0.55em", color:_sparkColor,
fontFamily:FB, textTransform:"uppercase",
textShadow:"0 0 30px "+_sparkGlow,
opacity:0.9 }}>
{_rData.realmName}
</div>
) : (
<div style={{ width:120, height:10, borderRadius:3, margin:"0 auto",
background:"rgba(200,180,255,0.06)",
animation:"breathe 1.5s ease-in-out infinite alternate" }}/>
)}
</div>

<div style={{ position:"absolute", top:46, left:24, fontSize:9,
letterSpacing:"0.5em", color:"rgba(200,180,255,0.18)", fontFamily:FB }}>SAYCRD</div>
<div style={{ position:"absolute", top:46, right:24, fontSize:8,
letterSpacing:"0.2em", color:"rgba(255,255,255,0.12)", fontFamily:FB }}>
{sessionCount > 1 ? "SESSION "+sessionCount : "FIRST SESSION"}
</div>

<div style={{ position:"absolute", bottom:0, left:0, right:0,
padding:"0 28px 36px",
background:"linear-gradient(0deg, rgba(2,1,6,0.98) 0%, rgba(4,2,10,0.85) 50%, transparent 100%)" }}>

<div style={{ width:"100%", height:0.75, marginBottom:18,
background:"linear-gradient(90deg, transparent, rgba(200,180,255,0.2) 40%, rgba(200,180,255,0.3) 60%, transparent)" }}/>

{_rReady && _rData && _rData.declaration && (
<div style={{ fontSize:24, fontWeight:700, color:"rgba(255,255,255,0.92)",
fontFamily:FB, letterSpacing:"0.02em",
lineHeight:1.1, marginBottom:12,
animation:"riseUp 0.7s ease 0.9s both" }}>
{_rData.declaration}
</div>
)}

<div style={{ minHeight:44 }}>
{!_rReady ? (
<div style={{ display:"flex", flexDirection:"column", gap:7 }}>
<div style={{ width:"85%", height:14, borderRadius:3,
background:"rgba(200,180,255,0.06)", animation:"breathe 1.8s ease-in-out infinite alternate" }}/>
<div style={{ width:"60%", height:14, borderRadius:3,
background:"rgba(200,180,255,0.04)", animation:"breathe 1.8s ease-in-out 0.3s infinite alternate" }}/>
</div>
) : (
<div style={{ fontSize:16, color:"rgba(220,210,240,0.72)",
fontFamily:FD, fontStyle:"italic",
lineHeight:1.7,
animation:"riseUp 0.8s ease 1.1s both" }}>
{_rData && _rData.witness
? _rData.witness
: "Every realm on the journey is the journey."}
</div>
)}
</div>
</div>

</div>
);
}

function ConstellationMap({ thList, connList, dark, showInsight }) {
var n = (thList || []).length;
var [hoverNode, setHoverNode] = useState(null);
if (n === 0) return <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic" }}>No themes yet</div>;
var cx = 50, cy = 48, r = 34;
var pts = (thList || []).map(function(t, i) {
var ang = (i / n) * 2 * Math.PI - Math.PI / 2;
return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.88, label: t.label || t.name, color: getThemeColor(t, i), i: i };
});
var isDark = dark !== false;
var textFill = isDark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.75)";
var lineBase = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
var lineActive = isDark ? "rgba(107,184,255,0.6)" : "rgba(107,184,255,0.7)";
function arcPath(ax, ay, bx, by) {
var mx = (ax + bx) / 2, my = (ay + by) / 2;
var dx = bx - ax, dy = by - ay;
var perp = Math.sqrt(dx*dx + dy*dy) * 0.35;
var cpx = mx - dy * 0.15 + (cx - mx) * 0.3;
var cpy = my + dx * 0.15 + (cy - my) * 0.3;
return "M " + ax + " " + ay + " Q " + cpx + " " + cpy + " " + bx + " " + by;
}
return (
<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", maxWidth: 320, height: 280 }}
onMouseLeave={function(){ setHoverNode(null); }}>
<defs>
<filter id="cm_glow" x="-80%" y="-80%" width="260%" height="260%">
<feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur"/>
<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="cm_soft" x="-100%" y="-100%" width="300%" height="300%">
<feGaussianBlur stdDeviation="2"/>
</filter>
{pts.map(function(p, i) {
return <radialGradient key={"g"+i} id={"cm_grad_"+i} cx="30%" cy="30%" r="70%">
<stop offset="0%" stopColor={p.color} stopOpacity="1"/>
<stop offset="60%" stopColor={p.color} stopOpacity="0.85"/>
<stop offset="100%" stopColor={p.color} stopOpacity="0.4"/>
</radialGradient>;
})}
</defs>
{/* subtle depth layer */}
<circle cx={cx} cy={cy} r={r+8} fill="none" stroke={isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.03)"} strokeWidth="0.5"/>
{(connList || []).map(function(c, ci) {
var a = pts.find(function(p){ return (p.label||"").toLowerCase() === (c.from||"").toLowerCase(); });
var b = pts.find(function(p){ return (p.label||"").toLowerCase() === (c.to||"").toLowerCase(); });
if (!a || !b) return null;
var ahov = hoverNode === a.i || hoverNode === b.i;
var strokeCol = ahov ? lineActive : lineBase;
var strokeW = ahov ? 0.7 : 0.5;
var dashArray = ahov ? "4 3" : "2 4";
return (
<g key={ci}>
<path d={arcPath(a.x, a.y, b.x, b.y)} fill="none" stroke={strokeCol} strokeWidth={strokeW} strokeLinecap="round" strokeDasharray={dashArray} opacity={ahov ? 1 : 0.85}
style={{ transition: "stroke 0.3s, opacity 0.3s" }}/>
{ahov && (
<path d={arcPath(a.x, a.y, b.x, b.y)} fill="none" stroke={a.color} strokeWidth="0.25" strokeLinecap="round" strokeDasharray="2 2" opacity="0.5">
<animate attributeName="stroke-dashoffset" from="0" to="4" dur="1.2s" repeatCount="indefinite"/>
</path>
)}
</g>
);
})}
{pts.map(function(p, i) {
var isHov = hoverNode === i;
return (
<g key={i} onMouseEnter={function(){ setHoverNode(i); }} onMouseLeave={function(){ setHoverNode(null); }}
style={{ cursor: "pointer" }}>
<circle cx={p.x} cy={p.y} r={isHov ? 5.5 : 4} fill={"url(#cm_grad_"+i+")"} filter="url(#cm_glow)" opacity={isHov ? 1 : 0.92}>
{!isHov && <animate attributeName="r" values="3.5;4.5;3.5" dur="2.5s" repeatCount="indefinite" begin={i*0.2+"s"}/>}
</circle>
<circle cx={p.x} cy={p.y} r={isHov ? 10 : 7} fill="none" stroke={p.color} strokeWidth="0.4" opacity={isHov ? 0.5 : 0.22}>
{!isHov && <animate attributeName="r" values="6;9;6" dur="3.2s" repeatCount="indefinite" begin={i*0.15+"s"}/>}
</circle>
<text x={p.x} y={p.y + 7} textAnchor="middle" fontSize="3.4" fill={textFill} fontFamily={FB} fontWeight={isHov ? 700 : 600}
style={{ textShadow: isDark ? "0 0 12px "+p.color+"66" : "none", transition: "font-weight 0.2s" }}>
{(p.label||"").toUpperCase().slice(0, 12)}
</text>
{showInsight !== false && isHov && (function(){
var connsFrom = (connList||[]).filter(function(c){ return (c.from||"").toLowerCase() === (p.label||"").toLowerCase() || (c.to||"").toLowerCase() === (p.label||"").toLowerCase(); });
var insight = connsFrom.map(function(c){ return c.insight || c.label || ""; }).filter(Boolean)[0];
if (!insight) return null;
return (
<foreignObject x={Math.max(2, Math.min(p.x-14, 72))} y={Math.max(2, p.y-16)} width={28} height={14} style={{ overflow: "visible" }}>
<div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 8, fontFamily: FD, fontStyle: "italic", color: isDark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.85)", lineHeight: 1.25, padding: "3px 6px", background: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)", borderRadius: 4, border: "1px solid "+(p.color+"66"), boxShadow: "0 2px 8px rgba(0,0,0,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
{insight.slice(0, 42)}{insight.length > 42 ? "…" : ""}
</div>
</foreignObject>
);
})()}
</g>
);
})}
</svg>
);
}

function InnerWrappedCard({ themes, sd, sessionCount, goNext }) {
themes = themes || []; sd = sd || {};
var _all = (function(){ try { return loadSessions(); } catch(e){ return []; } })();
var _lastIdx = Math.max(0, _all.length - 1);
var [slide, setSlide] = useState(0);
var currentThemes = themes.length > 0 ? themes : (_all[_lastIdx] && _all[_lastIdx].themes) || [];
var currentConns = (sd && sd.connections) || (_all[_lastIdx] && _all[_lastIdx].connections) || [];
var maxSlides = 2;

var advanceSlide = function() {
if (slide + 1 >= maxSlides) { goNext && goNext(); return; }
setSlide(slide + 1);
};
useEffect(function() {
var h = function(e) {
if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); e.stopPropagation(); advanceSlide(); }
if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); if (slide > 0) setSlide(slide - 1); }
};
window.addEventListener("keydown", h, true);
return function() { window.removeEventListener("keydown", h, true); };
}, [slide]);
return (
<div data-noadvance="true" onClick={function(e){ e.stopPropagation(); if (!e.target.closest("button") && !e.target.closest("[data-nolink]")) advanceSlide(); }}
style={{ position:"absolute", inset:0, overflow:"hidden", cursor:"pointer",
background:"linear-gradient(180deg, #0A0618 0%, #0D0818 30%, #080510 70%, #050308 100%)",
display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
<div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 80% 60% at 50% 20%, rgba(120,80,180,0.08) 0%, transparent 60%)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 60% 50% at 80% 80%, rgba(180,100,255,0.05) 0%, transparent 70%)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px 60px" }}>

{slide === 0 && (
<div style={{ textAlign:"center", animation:"riseUp 0.8s ease both" }}>
<div style={{ fontSize:9, letterSpacing:"0.5em", color:"rgba(255,255,255,0.25)", fontFamily:FB, marginBottom:32, textTransform:"uppercase" }}>YOUR</div>
<div style={{ fontSize:42, fontWeight:800, color:"white", fontFamily:FB, letterSpacing:"-0.02em", lineHeight:1, marginBottom:8 }}>
INNER
</div>
<div style={{ fontSize:42, fontWeight:200, color:"rgba(255,255,255,0.5)", fontFamily:FB, letterSpacing:"0.12em", lineHeight:1 }}>
WEATHER
</div>
<div style={{ fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic", marginTop:28 }}>what's showing up</div>
<div style={{ fontSize:10, letterSpacing:"0.25em", color:"rgba(255,255,255,0.15)", fontFamily:FB, marginTop:40 }}>TAP TO CONTINUE</div>
</div>
)}

{slide === 1 && (
<div style={{ position:"relative", width:"100%", display:"flex", flexDirection:"column", alignItems:"center", animation:"riseUp 0.7s ease both", perspective:"1000px" }}>
<div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 100% 80% at 50% 50%, rgba(107,184,255,0.12) 0%, transparent 60%)", pointerEvents:"none", animation:"pulse 4s ease-in-out infinite" }}/>
<div style={{ width:"100%", display:"flex", justifyContent:"center", transform:"rotateX(8deg)", transformStyle:"preserve-3d", transition:"transform 0.6s ease" }}>
<div style={{ position:"relative", filter:"drop-shadow(0 0 40px rgba(107,184,255,0.25)) drop-shadow(0 0 80px rgba(180,100,255,0.05))" }}>
<ConstellationMap thList={currentThemes.map(function(t,i){ return Object.assign({}, t, { color: getThemeColor(t, i) }); })} connList={currentConns}/>
</div>
</div>
<div style={{ marginTop:20, fontSize:11, letterSpacing:"0.35em", color:"rgba(255,255,255,0.5)", fontFamily:FB, textTransform:"uppercase" }}>themes as constellations</div>
<div style={{ marginTop:8, fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic" }}>tap to explore</div>
</div>
)}

<div style={{ position:"absolute", bottom:28, left:0, right:0, display:"flex", justifyContent:"center", gap:6 }}>
{Array.from({length: maxSlides}).map(function(_, i) {
return <div key={i} style={{ width:6, height:6, borderRadius:"50%", background: slide === i ? "rgba(214,178,109,0.8)" : "rgba(255,255,255,0.15)", transition:"all 0.3s ease" }}/>;
})}
</div>
</div>
</div>
);
}

function MilestoneCard({ sessionCount, milestone, goNext }) {
var msgs = {
3: { title: "PATTERNS EMERGING", sub: "Your third session. The record is beginning to show what keeps returning.", color: "#6BB8FF" },
10: { title: "YOUR NARRATIVE ARC", sub: "Ten sessions. The arc is taking shape — chapters, turning points, recurring storylines.", color: "#B86BFF" },
20: { title: "THE META-PATTERN", sub: "Twenty sessions. What only becomes visible over time is now in view.", color: "#D6B26D" },
50: { title: "YOUR RECORD", sub: "Fifty sessions. A sustained inner biography. The record speaks.", color: "#6BFFB8" }
};
var m = msgs[milestone || sessionCount] || msgs[3];
return (
<div onClick={function(e){ if (!e.target.closest("button")) goNext && goNext(); }} style={{ position:"absolute", inset:0, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"linear-gradient(180deg, #0A0618 0%, #080614 50%, #040208 100%)", padding:"40px 28px" }}>
<div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 80% 60% at 50% 40%, "+(m.color||"#6BB8FF")+"18 0%, transparent 60%)", pointerEvents:"none" }}/>
<div style={{ fontSize:9, letterSpacing:"0.5em", color:"rgba(255,255,255,0.25)", fontFamily:FB, marginBottom:24, textTransform:"uppercase" }}>SESSION {milestone || sessionCount}</div>
<div style={{ fontSize:32, fontWeight:800, color:"white", fontFamily:FB, letterSpacing:"-0.02em", textAlign:"center", lineHeight:1.2, marginBottom:16 }}>{m.title}</div>
<div style={{ fontSize:15, color:"rgba(255,255,255,0.55)", fontFamily:FD, fontStyle:"italic", textAlign:"center", lineHeight:1.65, maxWidth:300 }}>{m.sub}</div>
<div style={{ marginTop:36, fontSize:10, letterSpacing:"0.25em", color:"rgba(255,255,255,0.2)", fontFamily:FB }}>TAP TO CONTINUE</div>
</div>
);
}

function ArcRevealCard({ themes, sd, sessionCount, allSessions, goNext }) {
var nar = null; try { nar = loadNarrativeArc(); } catch(e) {}
if (!nar) try { nar = computeNarrativeArc(); } catch(e) {}
var chapters = (nar && nar.chapters) || [];
var turningPoints = (nar && nar.turning_points) || [];
var storylines = (nar && nar.recurring_storylines) || [];
return (
<div data-noadvance="true" onClick={function(e){ if (!e.target.closest("button")) goNext && goNext(); }} style={{ position:"absolute", inset:0, cursor:"pointer", overflowY:"auto", WebkitOverflowScrolling:"touch", background:"linear-gradient(180deg, #040810 0%, #080614 100%)", padding:"48px 24px 60px" }}>
<div style={{ position:"absolute", top:0, left:0, right:0, height:120, background:"linear-gradient(180deg, #040810 0%, transparent 100%)", pointerEvents:"none" }}/>
<div style={{ fontSize:9, letterSpacing:"0.5em", color:"rgba(255,255,255,0.25)", fontFamily:FB, marginBottom:8, textTransform:"uppercase" }}>YOUR ARC</div>
<div style={{ fontSize:28, fontWeight:800, color:"white", fontFamily:FB, letterSpacing:"-0.02em", marginBottom:8 }}>WHAT THE RECORD SHOWS</div>
<div style={{ fontSize:13, color:"rgba(255,255,255,0.45)", fontFamily:FD, fontStyle:"italic", marginBottom:32 }}>Chapters, turning points, recurring storylines — your narrative over {sessionCount} sessions</div>
{chapters.length > 0 && (
<div style={{ marginBottom:28 }}>
<div style={{ fontSize:10, letterSpacing:"0.2em", color:"#6BB8FF", fontFamily:FB, marginBottom:12, textTransform:"uppercase" }}>Chapters</div>
<div style={{ display:"flex", flexDirection:"column", gap:10 }}>
{chapters.slice(0, 5).map(function(ch, i) {
var range = "S" + (ch.sessionRange[0] + 1) + "–S" + (ch.sessionRange[1] + 1);
return (
<div key={i} style={{ padding:"12px 16px", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)" }}>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontFamily:FB, marginBottom:4 }}>{range}</div>
<div style={{ fontSize:14, color:"white", fontFamily:FB, fontWeight:600 }}>{(ch.dominantThemes || []).join(", ") || "—"}</div>
{(ch.archetype || ch.tension) && <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontFamily:FD, marginTop:4 }}>{[ch.archetype, ch.tension].filter(Boolean).join(" · ")}</div>}
</div>
); })}
</div>
</div>
)}
{turningPoints.length > 0 && (
<div style={{ marginBottom:28 }}>
<div style={{ fontSize:10, letterSpacing:"0.2em", color:"#B86BFF", fontFamily:FB, marginBottom:12, textTransform:"uppercase" }}>Turning points</div>
<div style={{ display:"flex", flexDirection:"column", gap:8 }}>
{turningPoints.slice(0, 5).map(function(tp, i) {
return (
<div key={i} style={{ fontSize:13, color:"rgba(255,255,255,0.85)", fontFamily:FD }}>Session {tp.sessionIndex + 1}: {tp.description || tp.type}</div>
); })}
</div>
</div>
)}
{storylines.length > 0 && (
<div style={{ marginBottom:28 }}>
<div style={{ fontSize:10, letterSpacing:"0.2em", color:"#6BFFB8", fontFamily:FB, marginBottom:12, textTransform:"uppercase" }}>Recurring storylines</div>
<div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
{storylines.slice(0, 6).map(function(s, i) {
return (
<div key={i} style={{ padding:"8px 14px", borderRadius:10, background:"rgba(107,255,184,0.08)", border:"1px solid rgba(107,255,184,0.2)", fontSize:12, color:"#6BFFB8", fontFamily:FB }}>{s.label} ({s.count}x)</div>
); })}
</div>
</div>
)}
<div style={{ fontSize:10, letterSpacing:"0.2em", color:"rgba(255,255,255,0.2)", fontFamily:FB }}>TAP TO CONTINUE</div>
</div>
);
}

function MapEvolutionCard({ themes, sd, sessionCount, allSessions, currentSessionData, goNext }) {
themes = themes || []; sd = sd || {}; allSessions = allSessions || []; currentSessionData = currentSessionData || {};
var currThemes = (currentSessionData.themes || sd.themes || themes || []).map(function(t){ var o = typeof t === "object" ? t : { label: t }; return { label: o.label || o, weight: o.weight || 1 }; });
var currentEntry = Object.assign({}, currentSessionData, { themes: currThemes, date: currentSessionData.date || new Date().toISOString(), isCurrent: true });
var evoSessions = allSessions.concat([currentEntry]);
var [idx, setIdx] = useState(evoSessions.length - 1);
var sel = evoSessions[Math.min(idx, evoSessions.length - 1)] || {};
var selThemes = (sel.themes || []).map(function(t,i){ var o = typeof t === "object" ? t : { label: t }; return Object.assign({}, o, { color: getThemeColor(o, i) }); });
var selConns = sel.connections || [];
var selArch = (sel.archetypes && sel.archetypes[0]) ? sel.archetypes[0] : null;
var prevArch = idx > 0 ? (evoSessions[idx - 1].archetypes && evoSessions[idx - 1].archetypes[0]) : null;
return (
<div data-noadvance="true" onClick={function(e){ if (!e.target.closest("button") && !e.target.closest("input")) goNext && goNext(); }}
style={{ position:"absolute", inset:0, overflow:"hidden", cursor:"pointer",
background:"linear-gradient(180deg, #040810 0%, #080614 50%, #040208 100%)",
display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
<div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 70% 50% at 50% 30%, rgba(100,180,255,0.06) 0%, transparent 60%)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", top:48, left:28, fontSize:9, letterSpacing:"0.5em", color:"rgba(255,255,255,0.25)", fontFamily:FB, textTransform:"uppercase" }}>LIVING MAP</div>
<div style={{ position:"absolute", top:48, right:28, fontSize:9, letterSpacing:"0.2em", color:"rgba(255,255,255,0.2)", fontFamily:FB }}>SESSION {idx + 1} of {evoSessions.length}</div>
<div style={{ textAlign:"center", marginBottom:16, animation:"riseUp 0.6s ease both" }}>
<div style={{ fontSize:28, fontWeight:800, color:"white", fontFamily:FB, letterSpacing:"-0.02em", lineHeight:1.1 }}>MAP EVOLUTION</div>
<div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:FD, fontStyle:"italic", marginTop:8 }}>how your inner sky has shifted</div>
</div>
<div style={{ width:"min(320px, 90%)", marginBottom:16 }}>
<input type="range" min={0} max={Math.max(0, evoSessions.length - 1)} value={idx} step={1}
onChange={function(e){ setIdx(parseInt(e.target.value, 10)); }}
onClick={function(e){ e.stopPropagation(); }}
style={{ width:"100%", accentColor:"#6BB8FF", cursor:"pointer" }}/>
<div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9, letterSpacing:"0.15em", color:"rgba(255,255,255,0.3)", fontFamily:FB }}>
<span>Session 1</span>
<span>Session {evoSessions.length}</span>
</div>
</div>
<div style={{ display:"flex", alignItems:"center", gap:20, marginBottom:12, minHeight:140 }}>
{(prevArch && selArch && prevArch.name !== selArch.name) ? (
<>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", animation:"riseUp 0.5s ease both" }}>
<ArchGlyph name={prevArch.name||""} color={prevArch.color||getThemeColor(prevArch,0)} size={44}/>
<div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:FB, letterSpacing:"0.15em", marginTop:6 }}>was</div>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.6)", fontFamily:FB, fontWeight:600 }}>{prevArch.name}</div>
</div>
<div style={{ fontSize:18, color:"rgba(107,184,255,0.5)", animation:"pulse 1.5s ease infinite" }}>→</div>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", animation:"riseUp 0.5s ease 0.1s both" }}>
<ArchGlyph name={selArch.name||""} color={selArch.color||getThemeColor(selArch,1)} size={52}/>
<div style={{ fontSize:9, color:"rgba(107,184,255,0.7)", fontFamily:FB, letterSpacing:"0.15em", marginTop:6 }}>now</div>
<div style={{ fontSize:12, color:"rgba(255,255,255,0.9)", fontFamily:FB, fontWeight:600 }}>{selArch.name}</div>
</div>
</>
) : selArch ? (
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", animation:"riseUp 0.5s ease both" }}>
<ArchGlyph name={selArch.name||""} color={selArch.color||getThemeColor(selArch,0)} size={70}/>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.6)", fontFamily:FB, fontWeight:600, marginTop:8 }}>{selArch.name}</div>
</div>
) : null}
</div>
<div style={{ width:"100%", display:"flex", justifyContent:"center", animation:"riseUp 0.6s ease 0.15s both" }}>
<ConstellationMap thList={selThemes} connList={selConns}/>
</div>
{sel.date && <div style={{ marginTop:12, fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.12em" }}>{new Date(sel.date).toLocaleDateString("en-US", { month:"short", day:"numeric", year: sel.isCurrent ? "numeric" : undefined })}</div>}
<div style={{ position:"absolute", bottom:28, fontSize:9, letterSpacing:"0.3em", color:"rgba(255,255,255,0.18)", fontFamily:FB }}>TAP TO CONTINUE</div>
</div>
);
}

function YearReviewCard({ themes, sessionCount, goNext }) {
themes = themes || [];
var _all = (function(){ try { return loadSessions(); } catch(e){ return []; } })();

var _rows = _all.map(function(s, si) {
var archName = (s.archetypes&&s.archetypes[0]&&s.archetypes[0].name)||"";
var archLine = (s.archetypes&&s.archetypes[0]&&s.archetypes[0].line)||"";
var alchemyStage = (s.alchemy&&s.alchemy.stage)||"";
var mapTitle = s.mapTitle||"";
var color = THEME_COLORS[si % THEME_COLORS.length];
var dateStr="", timeStr="";
if (s.date) {
var d = new Date(s.date);
if (!isNaN(d)) {
dateStr = (d.getMonth()+1)+"/"+(d.getDate());
var hr=d.getHours(), mn=d.getMinutes(), ampm=hr>=12?"pm":"am";
hr=hr%12||12;
timeStr = hr+":"+(mn<10?"0"+mn:mn)+ampm;
}
}
return { si, archName, archLine, alchemyStage, mapTitle, color, dateStr, timeStr, isCurrent: si === _all.length - 1 };
});

var _archFreq={};
_all.forEach(function(s){
var a=s.archetypes&&s.archetypes[0]&&s.archetypes[0].name;
if(a) _archFreq[a]=(_archFreq[a]||0)+1;
});
var _topArch=Object.keys(_archFreq).sort(function(a,b){return _archFreq[b]-_archFreq[a];})[0]||"";
var _topArchCount=_topArch?_archFreq[_topArch]:0;

var [_expanded, _setExpanded] = useState(null);

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden",
background:"linear-gradient(160deg, #0A0614 0%, #120820 40%, #0E0A1E 100%)",
display:"flex", flexDirection:"column" }}>

<div style={{ position:"absolute", top:"-10%", left:"-10%", width:"60%", height:"50%",
background:"radial-gradient(ellipse, rgba(180,100,255,0.07) 0%, transparent 70%)",
pointerEvents:"none" }}/>
<div style={{ position:"absolute", bottom:"20%", right:"-10%", width:"50%", height:"40%",
background:"radial-gradient(ellipse, rgba(100,180,255,0.06) 0%, transparent 70%)",
pointerEvents:"none" }}/>

<div style={{ padding:"52px 28px 0", flexShrink:0 }}>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:14 }}>
<div style={{ fontSize:9, letterSpacing:"0.55em", color:"rgba(255,255,255,0.2)", fontFamily:FB }}>SAYCRD</div>
<div style={{ fontSize:9, letterSpacing:"0.25em", color:"rgba(255,255,255,0.18)", fontFamily:FB }}>
{sessionCount} {"SESSION"+(sessionCount===1?"":"S")}
</div>
</div>
<div style={{ marginBottom:4 }}>
<span style={{ fontSize:32, fontWeight:800, color:"rgba(255,255,255,0.95)",
fontFamily:FB, letterSpacing:"-0.02em", lineHeight:1 }}>WHAT'S COME</span>
</div>
<div style={{ fontSize:32, fontWeight:200, color:"rgba(255,255,255,0.35)",
fontFamily:FB, letterSpacing:"0.08em", lineHeight:1, marginBottom:18 }}>THROUGH THE FIELD</div>

<div style={{ display:"flex", alignItems:"center",
paddingBottom:10, borderBottom:"0.75px solid rgba(255,255,255,0.1)" }}>
<div style={{ width:12, flexShrink:0 }}/>
<div style={{ width:60, flexShrink:0, fontSize:7.5, letterSpacing:"0.35em",
color:"rgba(255,255,255,0.25)", fontFamily:FB }}>DATE</div>
<div style={{ flex:1, fontSize:7.5, letterSpacing:"0.35em",
color:"rgba(255,255,255,0.25)", fontFamily:FB }}>ARCHETYPE</div>
<div style={{ width:24, flexShrink:0 }}/>
</div>
</div>

<div style={{ flex:1, overflowY:"auto", padding:"0 28px",
WebkitOverflowScrolling:"touch" }}>

{_rows.map(function(row, ri) {
var isExp = _expanded === ri;
var isCurr = row.isCurrent;
var hasDetail = !!(row.archLine || row.alchemyStage || row.mapTitle);

return (
<div key={ri} style={{ borderBottom:"0.5px solid rgba(255,255,255,"+(isCurr?"0.12":"0.05")+")" }}>

<div
onClick={function(){ if(hasDetail||isCurr) _setExpanded(isExp?null:ri); }}
style={{ display:"flex", alignItems:"center",
padding:"13px 0",
cursor: hasDetail?"pointer":"default",
animation:"riseUp 0.5s ease "+(ri*0.035)+"s both" }}>

<div style={{ width:12, flexShrink:0 }}>
<div style={{
width: isCurr?10:6, height: isCurr?10:6,
borderRadius:"50%",
background: isCurr?"white":row.color,
boxShadow: isCurr
? "0 0 0 3px rgba(255,255,255,0.1), 0 0 16px rgba(255,255,255,0.4)"
: "0 0 8px "+row.color+"66"
}}/>
</div>

<div style={{ width:60, flexShrink:0 }}>
<div style={{ fontSize: isCurr?13:11,
fontWeight: isCurr?700:400,
color: isCurr?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.4)",
fontFamily:FB, lineHeight:1.1 }}>{row.dateStr}</div>
{row.timeStr&&<div style={{ fontSize:9, color:"rgba(255,255,255,0.2)",
fontFamily:FB, marginTop:1 }}>{row.timeStr}</div>}
</div>

<div style={{ flex:1, minWidth:0 }}>
{row.archName ? (
<div style={{
fontSize: isCurr?22:16,
fontWeight: isCurr?800:500,
color: isCurr?"white":row.color,
fontFamily:FB,
letterSpacing: isCurr?"-0.02em":"-0.01em",
lineHeight:1.05,
textShadow: isCurr
? "0 0 30px "+row.color+"88"
: "0 0 12px "+row.color+"44",
whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"
}}>
{row.archName}
</div>
) : isCurr ? (
<div style={{ fontSize:15, fontWeight:500,
color:"rgba(255,255,255,0.35)", fontFamily:FB,
fontStyle:"italic" }}>this session</div>
) : (
<div style={{ fontSize:11, color:"rgba(255,255,255,0.15)",
fontFamily:FB }}>—</div>
)}
</div>

{hasDetail && (
<div style={{ width:24, flexShrink:0, textAlign:"right" }}>
<div style={{ fontSize:12, color:isExp?row.color:"rgba(255,255,255,0.2)",
transition:"transform 0.35s ease, color 0.2s ease",
transform:isExp?"rotate(180deg)":"rotate(0deg)",
display:"inline-block" }}>▾</div>
</div>
)}
</div>

<div style={{
maxHeight: isExp ? "300px" : "0px",
overflow:"hidden",
transition:"max-height 0.45s cubic-bezier(0.32,0.72,0,1)"
}}>
<div style={{ padding:"4px 0 20px 12px",
borderLeft:"2px solid "+row.color+"44",
marginLeft:5, marginBottom:4 }}>

{row.mapTitle && (
<div style={{ fontSize:11, letterSpacing:"0.1em",
color:"rgba(255,255,255,0.35)", fontFamily:FB,
marginBottom:10, lineHeight:1.5 }}>
{row.mapTitle}
</div>
)}

{row.archLine && (
<div style={{ fontSize:17, color:row.color,
fontFamily:FD, fontStyle:"italic",
lineHeight:1.7, marginBottom:12,
textShadow:"0 0 20px "+row.color+"33" }}>
"{row.archLine}"
</div>
)}

{row.alchemyStage && (
<div style={{ display:"inline-flex", alignItems:"center",
gap:6, padding:"4px 12px", borderRadius:20,
border:"0.75px solid "+row.color+"44",
background:row.color+"11" }}>
<div style={{ width:5, height:5, borderRadius:"50%",
background:row.color, opacity:0.8 }}/>
<div style={{ fontSize:9, letterSpacing:"0.3em",
color:row.color+"CC", fontFamily:FB,
textTransform:"uppercase" }}>{row.alchemyStage}</div>
</div>
)}
</div>
</div>

</div>
);
})}

{_topArch && _topArchCount >= 2 && (
<div style={{ margin:"22px 0 8px", padding:"18px 18px",
borderRadius:10,
background:"linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
border:"0.75px solid rgba(255,255,255,0.1)",
animation:"riseUp 0.5s ease 0.6s both" }}>
<div style={{ fontSize:8, letterSpacing:"0.5em",
color:"rgba(255,255,255,0.25)", fontFamily:FB,
textTransform:"uppercase", marginBottom:8 }}>THE RETURNING ONE</div>
<div style={{ fontSize:24, fontWeight:800, color:"rgba(255,255,255,0.88)",
fontFamily:FB, letterSpacing:"-0.02em", marginBottom:4,
textShadow:"0 0 30px rgba(255,255,255,0.1)" }}>
{_topArch}
</div>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:FB }}>
found you across {_topArchCount} sessions
</div>
</div>
)}

<div style={{ height:24 }}/>
</div>

<div style={{ height:40, flexShrink:0,
background:"linear-gradient(0deg, #0A0614 0%, transparent 100%)",
pointerEvents:"none" }}/>

</div>
);
}

function LandscapeCard({ themes, sessionCount, primaryArch, archReg, portrait, portraitReady, goNext }) {
themes = themes || [];

var [_scene, _setScene] = useState(null);
var [_word, _setWord] = useState(null);
var [_ready, _setReady] = useState(false);
var [_panelOpen, _setPanelOpen] = useState(false);

var _all = (function(){ try { return loadSessions(); } catch(e){ return []; } })();

var _archName = (archReg && archReg.name) || (primaryArch && primaryArch.name) || "";
var _archIcon = (archReg && archReg.icon) || (primaryArch && primaryArch.icon) || "◆";
var _archColor = (archReg && archReg.color) || (primaryArch && primaryArch.color) || "#E84393";
var _archLine = (primaryArch && primaryArch.line) || "";
var _archPhases = archReg && archReg.phases ? archReg.phases : null;
var _archDesc = _archPhases
? Object.values(_archPhases).slice(0,2).join(" ")
: (_archLine || "");

useEffect(function() {
var cancelled = false;
(async function() {
try {
var totalSessions = _all.length + 1;
var _freq = {};
_all.forEach(function(s, si) {
var w = si + 1;
(s.themes||[]).forEach(function(t){
if (t.label) _freq[t.label] = (_freq[t.label]||0) + w;
});
});
themes.forEach(function(t){ if(t.label) _freq[t.label] = (_freq[t.label]||0)+6; });
var topThemes = Object.keys(_freq).sort(function(a,b){return _freq[b]-_freq[a];}).slice(0,6);
var firstWord = _all.length > 0 ? ((_all[0].themes||[])[0]||{}).label||"" : (themes[0]||{}).label||"";
var lastWord = (themes[0]||{}).label||"";

var p = "You are the cinematographer for someone's inner journey across "+totalSessions+" sessions.\n"
+ "Their recurring themes: " + topThemes.join(", ") + "\n"
+ "Where they began: " + firstWord + "\n"
+ "Where they are now: " + lastWord + "\n\n"
+ "Choose ONE landscape scene that is the visual metaphor of their entire journey:\n"
+ "STORMY_COAST — dark ocean, lighthouse, dramatic clouds, violent beauty, struggle and searching\n"
+ "DAWN_MOUNTAINS — misty peaks, rose-gold sky, valley still in shadow, light just arriving, emerging\n"
+ "DEEP_FOREST — cathedral trees, moon through canopy, searching in sacred darkness, depth\n"
+ "OPEN_PLAIN — infinite amber horizon, single tree, the held breath, steady and vast\n"
+ "CANYON_SUNRISE — red walls, gold light pouring in from above, the forge made beautiful, breakthrough\n"
+ "WINTER_CLEARING — snow, stars, bare trees, cold clarity, everything stripped to essential truth\n\n"
+ 'JSON only: {"scene":"SCENE_NAME"}';

var rr = await callClaudeClient(p, "landscape closing", 80);
if (cancelled) return;
var dd = parseJSON(rr);
_setScene(dd && dd.scene ? dd.scene : "DAWN_MOUNTAINS");
} catch(e) {
_setScene("DAWN_MOUNTAINS");
} finally {
if (!cancelled) _setReady(true);
}
})();
return function(){ cancelled = true; };
}, []);

var scene = _scene || "DAWN_MOUNTAINS";

function renderStormy() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#040308 0%,#0A0618 25%,#12082A 50%,#0E0C1E 70%,#060410 100%)"}}/>
<div style={{position:"absolute",top:"8%",left:"-10%",right:"-10%",height:"35%",
background:"radial-gradient(ellipse 80% 60% at 40% 50%, rgba(40,30,60,0.9) 0%, rgba(20,15,35,0.7) 50%, transparent 100%)",
animation:"breathe 8s ease-in-out infinite"}}/>
<div style={{position:"absolute",top:"15%",left:"20%",right:"-20%",height:"25%",
background:"radial-gradient(ellipse 70% 50% at 60% 40%, rgba(60,45,80,0.7) 0%, transparent 70%)",
animation:"breathe 6s ease-in-out 2s infinite"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"42%",
background:"linear-gradient(0deg,#020408 0%,#040A14 40%,#060D1A 70%,transparent 100%)"}}/>
<div style={{position:"absolute",bottom:"28%",left:0,right:0,height:"3%",
background:"linear-gradient(90deg,transparent,rgba(80,110,160,0.12) 30%,rgba(100,140,200,0.18) 60%,transparent)",
animation:"breathe 4s ease-in-out infinite"}}/>
<div style={{position:"absolute",bottom:"22%",left:"10%",right:"10%",height:"2%",
background:"linear-gradient(90deg,transparent,rgba(80,110,160,0.08) 50%,transparent)",
animation:"breathe 5s ease-in-out 1s infinite"}}/>
<div style={{position:"absolute",bottom:"38%",left:0,right:0,height:1,
background:"linear-gradient(90deg,transparent,rgba(100,120,180,0.15) 30%,rgba(120,140,200,0.25) 60%,transparent)"}}/>
<div style={{position:"absolute",bottom:"38%",right:"22%",width:3,height:"22%",
background:"linear-gradient(0deg,#2A2030,#3A2A45)",borderRadius:"2px 2px 0 0"}}/>
<div style={{position:"absolute",bottom:"59%",right:"21.4%",width:5,height:"4%",
background:"#3D2A50",borderRadius:"3px 3px 0 0"}}/>
<div style={{position:"absolute",bottom:"61%",right:"22%",
width:"45%",height:"2px",transformOrigin:"right center",
background:"linear-gradient(270deg,rgba(255,240,180,0.35),transparent)",
transform:"rotate(-8deg)",
animation:"shaftPulse 3s ease-in-out infinite"}}/>
<div style={{position:"absolute",bottom:"60%",right:"20.5%",width:14,height:14,
borderRadius:"50%",
background:"radial-gradient(circle,rgba(255,240,160,0.95) 0%,rgba(255,220,100,0.4) 40%,transparent 70%)",
animation:"breathe 1.5s ease-in-out infinite"}}/>
</>;
}

function renderDawnMountains() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#06040E 0%,#120820 20%,#2A1025 40%,#3D1A1A 55%,#4A2010 68%,#3A2010 80%,#1A100A 100%)"}}/>
<div style={{position:"absolute",top:"42%",left:"30%",right:"30%",height:"30%",
background:"radial-gradient(ellipse,rgba(200,80,20,0.25) 0%,rgba(160,60,15,0.1) 40%,transparent 70%)",
filter:"blur(15px)",animation:"breathe 5s ease-in-out infinite"}}/>
<div style={{position:"absolute",top:"48%",left:"35%",right:"35%",height:"20%",
background:"radial-gradient(ellipse,rgba(240,140,40,0.2) 0%,transparent 60%)",
filter:"blur(8px)"}}/>
<svg style={{position:"absolute",bottom:"30%",left:0,width:"100%",height:"28%"}} viewBox="0 0 100 30" preserveAspectRatio="none">
<path d="M0 30 L0 18 L8 10 L16 20 L24 8 L32 16 L40 4 L48 14 L56 6 L64 15 L72 5 L80 16 L88 9 L96 18 L100 14 L100 30 Z"
fill="rgba(25,12,18,0.95)"/>
</svg>
<svg style={{position:"absolute",bottom:"25%",left:0,width:"100%",height:"22%"}} viewBox="0 0 100 22" preserveAspectRatio="none">
<path d="M0 22 L0 16 L12 6 L22 14 L34 2 L44 12 L58 0 L68 10 L80 4 L90 13 L100 8 L100 22 Z"
fill="rgba(10,6,12,0.98)"/>
</svg>
<div style={{position:"absolute",bottom:"25%",left:0,right:0,height:"6%",
background:"linear-gradient(0deg,transparent,rgba(180,160,200,0.06) 50%,transparent)",
filter:"blur(4px)",animation:"breathe 7s ease-in-out infinite"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"26%",
background:"linear-gradient(0deg,#040206 0%,#080410 60%,transparent 100%)"}}/>
<div style={{position:"absolute",top:"18%",left:"62%",width:3,height:3,borderRadius:"50%",
background:"rgba(255,240,200,0.9)",
boxShadow:"0 0 8px rgba(255,240,180,0.6)",
animation:"breathe 3s ease-in-out infinite"}}/>
</>;
}

function renderDeepForest() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#020308 0%,#040510 30%,#060810 60%,#040608 100%)"}}/>
{[[15,12],[28,8],[42,15],[58,6],[72,11],[85,9],[35,20],[65,18]].map(function(p,i){
return <div key={i} style={{position:"absolute",left:p[0]+"%",top:p[1]+"%",
width:i%3===0?2:1,height:i%3===0?2:1,borderRadius:"50%",
background:"rgba(220,230,255,"+(0.4+i%4*0.1)+")",
animation:"breathe "+(2+i%3)+"s ease-in-out "+(i*0.5)+"s infinite"}}/>;
})}
<div style={{position:"absolute",top:"12%",left:"55%",width:22,height:22,borderRadius:"50%",
background:"radial-gradient(circle,rgba(240,235,220,0.9) 0%,rgba(220,215,200,0.7) 50%,transparent 70%)",
boxShadow:"0 0 30px rgba(220,215,190,0.15)",
animation:"breathe 8s ease-in-out infinite"}}/>
<div style={{position:"absolute",top:"8%",left:"48%",width:80,height:80,borderRadius:"50%",
background:"radial-gradient(circle,rgba(200,200,180,0.06) 0%,transparent 70%)",
filter:"blur(10px)"}}/>
<svg style={{position:"absolute",bottom:0,left:0,width:"100%",height:"75%"}} viewBox="0 0 100 75" preserveAspectRatio="none">
<rect x="5" y="35" width="2.5" height="40" fill="rgba(4,6,10,0.8)"/>
<path d="M5 35 L6.25 15 L7.5 35 Z" fill="rgba(4,6,10,0.8)"/>
<rect x="18" y="28" width="3" height="47" fill="rgba(5,7,11,0.85)"/>
<path d="M18 28 L19.5 5 L21 28 Z" fill="rgba(5,7,11,0.85)"/>
<rect x="72" y="30" width="3" height="45" fill="rgba(4,6,10,0.82)"/>
<path d="M72 30 L73.5 8 L75 30 Z" fill="rgba(4,6,10,0.82)"/>
<rect x="85" y="33" width="2.5" height="42" fill="rgba(4,5,9,0.8)"/>
<path d="M85 33 L86.25 12 L87.5 33 Z" fill="rgba(4,5,9,0.8)"/>
<rect x="-2" y="20" width="5" height="55" fill="#020305"/>
<path d="M-2 20 L0.5 -2 L3 20 Z" fill="#020305"/>
<rect x="30" y="15" width="5.5" height="60" fill="#020305"/>
<path d="M30 15 L32.75 -5 L35.5 15 Z" fill="#020305"/>
<rect x="58" y="18" width="5" height="57" fill="#020305"/>
<path d="M58 18 L60.5 -3 L63 18 Z" fill="#020305"/>
<rect x="90" y="22" width="5" height="53" fill="#020305"/>
<path d="M90 22 L92.5 0 L95 22 Z" fill="#020305"/>
</svg>
<div style={{position:"absolute",top:"20%",left:"52%",width:"6%",height:"45%",
background:"linear-gradient(180deg,rgba(200,200,180,0.06) 0%,rgba(180,180,160,0.03) 60%,transparent 100%)",
transform:"skewX(3deg)",filter:"blur(4px)"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"15%",
background:"linear-gradient(0deg,#010203 0%,#020306 60%,transparent 100%)"}}/>
</>;
}

function renderOpenPlain() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#08060E 0%,#150C10 20%,#2A1008 40%,#3D1A06 55%,#4A2408 65%,#3A2010 75%,#180E08 100%)"}}/>
<div style={{position:"absolute",top:"52%",left:"10%",right:"10%",height:"20%",
background:"radial-gradient(ellipse,rgba(180,80,10,0.3) 0%,rgba(140,60,8,0.15) 50%,transparent 75%)",
filter:"blur(12px)"}}/>
{[[10,38,60],[25,32,40],[55,35,50],[70,30,35]].map(function(c,i){
return <div key={i} style={{position:"absolute",top:c[0]+"%",left:c[1]+"%",
width:c[2]+"%",height:"1.5%",
background:"linear-gradient(90deg,transparent,rgba(160,80,20,0.12),transparent)",
filter:"blur(2px)"}}/>;
})}
<div style={{position:"absolute",bottom:"32%",left:0,right:0,height:1,
background:"linear-gradient(90deg,transparent,rgba(160,100,30,0.3) 20%,rgba(180,110,30,0.4) 60%,transparent)"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"33%",
background:"linear-gradient(0deg,#080402 0%,#0E0804 50%,#120A06 80%,transparent 100%)"}}/>
<svg style={{position:"absolute",bottom:"31%",left:"28%",width:"18%",height:"28%"}} viewBox="0 0 40 60" preserveAspectRatio="none">
<rect x="18" y="35" width="4" height="25" fill="#0A0604"/>
<line x1="20" y1="42" x2="8" y2="28" stroke="#0A0604" strokeWidth="1.5"/>
<line x1="20" y1="38" x2="32" y2="22" stroke="#0A0604" strokeWidth="1.5"/>
<line x1="20" y1="35" x2="12" y2="18" stroke="#0A0604" strokeWidth="1.2"/>
<line x1="20" y1="32" x2="28" y2="14" stroke="#0A0604" strokeWidth="1"/>
<line x1="20" y1="30" x2="20" y2="12" stroke="#0A0604" strokeWidth="1.2"/>
<line x1="8" y1="28" x2="4" y2="20" stroke="#0A0604" strokeWidth="0.8"/>
<line x1="32" y1="22" x2="36" y2="14" stroke="#0A0604" strokeWidth="0.8"/>
</svg>
<div style={{position:"absolute",bottom:"31.5%",left:0,right:0,height:"1.5%",
background:"linear-gradient(0deg,transparent,rgba(20,12,4,0.4),transparent)"}}/>
</>;
}

function renderCanyonSunrise() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#0C0804 0%,#1A0C06 15%,#2D1208 30%,#3D1A0A 45%,#1A0C06 65%,#0A0604 100%)"}}/>
<div style={{position:"absolute",top:0,left:"25%",right:"25%",height:"45%",
background:"radial-gradient(ellipse at 50% 0%, rgba(240,140,20,0.35) 0%,rgba(200,100,10,0.15) 40%,transparent 70%)",
filter:"blur(8px)",animation:"breathe 4s ease-in-out infinite"}}/>
<div style={{position:"absolute",top:0,left:"35%",right:"35%",height:"30%",
background:"radial-gradient(ellipse at 50% 0%, rgba(255,180,40,0.25) 0%,transparent 60%)",
filter:"blur(4px)"}}/>
<svg style={{position:"absolute",top:0,left:0,width:"32%",height:"100%"}} viewBox="0 0 32 100" preserveAspectRatio="none">
<path d="M0 0 L0 100 L32 100 L32 60 L28 45 L32 30 L26 15 L32 0 Z" fill="#1A0A04"/>
<path d="M0 0 L0 100 L20 100 L18 60 L22 45 L18 25 L24 10 L20 0 Z" fill="#0E0602"/>
<line x1="25" y1="0" x2="22" y2="100" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5"/>
<line x1="18" y1="0" x2="16" y2="100" stroke="rgba(0,0,0,0.3)" strokeWidth="0.3"/>
</svg>
<svg style={{position:"absolute",top:0,right:0,width:"32%",height:"100%"}} viewBox="0 0 32 100" preserveAspectRatio="none">
<path d="M32 0 L32 100 L0 100 L0 60 L4 45 L0 30 L6 15 L0 0 Z" fill="#1A0A04"/>
<path d="M32 0 L32 100 L12 100 L14 60 L10 45 L14 25 L8 10 L12 0 Z" fill="#0E0602"/>
<line x1="7" y1="0" x2="10" y2="100" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5"/>
<line x1="14" y1="0" x2="16" y2="100" stroke="rgba(0,0,0,0.3)" strokeWidth="0.3"/>
</svg>
<div style={{position:"absolute",bottom:0,left:"15%",right:"15%",height:"20%",
background:"linear-gradient(0deg,#0A0604 0%,#140C06 60%,transparent 100%)"}}/>
<div style={{position:"absolute",top:0,left:"40%",right:"40%",height:"70%",
background:"linear-gradient(180deg,rgba(220,140,20,0.12) 0%,rgba(200,120,10,0.05) 60%,transparent 100%)",
filter:"blur(6px)"}}/>
<div style={{position:"absolute",top:"10%",left:"30%",width:"8%",height:"60%",
background:"linear-gradient(90deg,transparent,rgba(200,100,15,0.08),transparent)",
filter:"blur(4px)"}}/>
</>;
}

function renderWinterClearing() {
return <>
<div style={{position:"absolute",inset:0,background:"linear-gradient(180deg,#010208 0%,#020310 25%,#030412 50%,#020308 75%,#010204 100%)"}}/>
{[[8,8],[15,5],[22,12],[32,4],[40,9],[48,3],[55,7],[62,11],[70,5],[78,8],[85,4],[92,10],
[12,18],[28,15],[45,19],[60,16],[75,13],[88,17],[20,25],[50,22],[80,20]].map(function(p,i){
return <div key={i} style={{position:"absolute",left:p[0]+"%",top:p[1]+"%",
width:i%5===0?2:1,height:i%5===0?2:1,borderRadius:"50%",
background:"rgba(210,220,255,"+(0.5+i%3*0.15)+")",
animation:"breathe "+(2+i%4)+"s ease-in-out "+(i*0.3)+"s infinite"}}/>;
})}
<div style={{position:"absolute",top:"5%",left:"-20%",right:"-20%",height:"40%",
background:"linear-gradient(100deg,transparent 20%,rgba(160,170,220,0.03) 40%,rgba(180,190,240,0.05) 60%,transparent 80%)",
transform:"rotate(-15deg)",filter:"blur(8px)"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"28%",
background:"linear-gradient(0deg,rgba(180,185,200,0.12) 0%,rgba(160,165,185,0.06) 50%,transparent 100%)"}}/>
<div style={{position:"absolute",bottom:"28%",left:0,right:0,height:1,
background:"linear-gradient(90deg,transparent,rgba(190,195,215,0.2) 20%,rgba(200,205,225,0.3) 60%,transparent)"}}/>
<svg style={{position:"absolute",bottom:"27%",left:0,width:"100%",height:"35%"}} viewBox="0 0 100 35" preserveAspectRatio="none">
<rect x="12" y="15" width="1.5" height="20" fill="rgba(30,35,50,0.9)"/>
<line x1="12.75" y1="20" x2="6" y2="12" stroke="rgba(30,35,50,0.8)" strokeWidth="0.8"/>
<line x1="12.75" y1="18" x2="20" y2="10" stroke="rgba(30,35,50,0.8)" strokeWidth="0.7"/>
<line x1="12.75" y1="15" x2="8" y2="6" stroke="rgba(30,35,50,0.7)" strokeWidth="0.6"/>
<line x1="12.75" y1="15" x2="18" y2="5" stroke="rgba(30,35,50,0.7)" strokeWidth="0.6"/>
<rect x="55" y="10" width="1.8" height="25" fill="rgba(25,30,45,0.9)"/>
<line x1="55.9" y1="16" x2="46" y2="6" stroke="rgba(25,30,45,0.8)" strokeWidth="0.9"/>
<line x1="55.9" y1="14" x2="66" y2="4" stroke="rgba(25,30,45,0.8)" strokeWidth="0.8"/>
<line x1="55.9" y1="10" x2="50" y2="0" stroke="rgba(25,30,45,0.7)" strokeWidth="0.6"/>
<line x1="55.9" y1="10" x2="62" y2="1" stroke="rgba(25,30,45,0.7)" strokeWidth="0.6"/>
<rect x="82" y="18" width="1.2" height="17" fill="rgba(20,25,40,0.7)"/>
<line x1="82.6" y1="22" x2="77" y2="14" stroke="rgba(20,25,40,0.6)" strokeWidth="0.6"/>
<line x1="82.6" y1="20" x2="88" y2="12" stroke="rgba(20,25,40,0.6)" strokeWidth="0.6"/>
</svg>
<div style={{position:"absolute",top:"15%",left:"-5%",width:"40%",height:"40%",
background:"radial-gradient(ellipse,rgba(160,170,220,0.06) 0%,transparent 60%)",
filter:"blur(15px)"}}/>
<div style={{position:"absolute",bottom:"12%",left:"20%",right:"20%",height:"2%",
background:"linear-gradient(90deg,transparent,rgba(190,200,230,0.06),transparent)",
animation:"breathe 5s ease-in-out infinite"}}/>
</>;
}

var sceneMap = {
STORMY_COAST: renderStormy,
DAWN_MOUNTAINS: renderDawnMountains,
DEEP_FOREST: renderDeepForest,
OPEN_PLAIN: renderOpenPlain,
CANYON_SUNRISE: renderCanyonSunrise,
WINTER_CLEARING: renderWinterClearing
};

var renderScene = sceneMap[scene] || renderDawnMountains;

return (
<div style={{position:"absolute",inset:0,overflow:"hidden",background:"#020208"}}>

{renderScene()}

<div style={{position:"absolute",top:0,left:0,right:0,height:"10%",
background:"linear-gradient(180deg,rgba(0,0,0,0.85) 0%,transparent 100%)",pointerEvents:"none"}}/>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:"32%",
background:"linear-gradient(0deg,rgba(0,0,0,0.97) 0%,rgba(0,0,0,0.75) 45%,transparent 100%)",pointerEvents:"none"}}/>

<div style={{position:"absolute",top:44,left:28,fontSize:8,letterSpacing:"0.5em",
color:"rgba(255,255,255,0.18)",fontFamily:FB}}>SAYCRD</div>
<div style={{position:"absolute",top:44,right:28,fontSize:8,letterSpacing:"0.2em",
color:"rgba(255,255,255,0.12)",fontFamily:FB,textAlign:"right"}}>
{sessionCount} {"SESSION"+(sessionCount===1?"":"S")}
</div>

<div
onClick={function(){ _setPanelOpen(function(o){return !o;}); }}
style={{
position:"absolute", bottom:0, left:0, right:0,
padding:"0 28px 28px",
cursor:"pointer",
zIndex:10
}}>

<div style={{height:0.75, marginBottom:16,
background:"linear-gradient(90deg,transparent,"+_archColor+"55 30%,"+_archColor+"88 60%,transparent)"}}/>

<div style={{fontSize:8, letterSpacing:"0.5em", color:_archColor+"88",
fontFamily:FB, textTransform:"uppercase", marginBottom:8,
animation:"riseUp 0.6s ease 0.4s both"}}>
YOUR ARCHETYPE
</div>

<div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
<div style={{
fontSize: _archName.length > 16 ? 22 : _archName.length > 10 ? 28 : 34,
fontWeight:700,
color:"rgba(255,255,255,0.94)",
fontFamily:FB,
letterSpacing:"-0.01em",
lineHeight:1,
textShadow:"0 0 40px "+_archColor+"44",
animation:"riseUp 0.8s ease 0.5s both"
}}>
{_archName || "—"}
</div>
<div style={{display:"flex",alignItems:"center",gap:8}}>
<div style={{fontSize:22, lineHeight:1}}>{_archIcon}</div>
<div style={{
fontSize:10, color:"rgba(255,255,255,0.3)",
transform:_panelOpen?"rotate(180deg)":"rotate(0deg)",
transition:"transform 0.4s ease"
}}>▲</div>
</div>
</div>

<div style={{marginTop:12, fontSize:7,letterSpacing:"0.3em",color:"rgba(255,255,255,0.15)",
fontFamily:FB,textTransform:"uppercase"}}>
{themes.slice(0,4).map(function(t){return t.label||"";}).filter(Boolean).join(" · ")}
{" · SESSION "+sessionCount}
</div>
</div>

<div style={{
position:"absolute", bottom:0, left:0, right:0,
height:"78%",
background:"rgba(6,4,14,0.97)",
borderTop:"0.75px solid "+_archColor+"44",
borderRadius:"12px 12px 0 0",
transform:_panelOpen ? "translateY(0)" : "translateY(100%)",
transition:"transform 0.5s cubic-bezier(0.32,0.72,0,1)",
padding:"28px 28px 40px",
display:"flex",
flexDirection:"column",
zIndex:20,
boxShadow:"0 -20px 60px rgba(0,0,0,0.8)"
}}>

<div style={{width:40,height:4,borderRadius:2,
background:"rgba(255,255,255,0.12)",
margin:"0 auto 24px",flexShrink:0}}/>

<div style={{textAlign:"center",marginBottom:16,flexShrink:0}}>
<div style={{fontSize:72, lineHeight:1,
filter:"drop-shadow(0 0 24px "+_archColor+"66)",
animation:_panelOpen?"riseUp 0.5s ease 0.1s both":"none"}}>
{_archIcon}
</div>
</div>

<div style={{textAlign:"center",marginBottom:10,flexShrink:0}}>
<div style={{
fontSize: _archName.length > 16 ? 22 : _archName.length > 10 ? 26 : 30,
fontWeight:700,
color:"rgba(255,255,255,0.95)",
fontFamily:FB,
letterSpacing:"-0.01em",
lineHeight:1.1,
animation:_panelOpen?"riseUp 0.5s ease 0.15s both":"none"
}}>
{_archName}
</div>
</div>

<div style={{width:"40%",height:0.75,margin:"0 auto 16px",
background:"linear-gradient(90deg,transparent,"+_archColor+"88,transparent)",
flexShrink:0}}/>

{_archLine && (
<div style={{textAlign:"center",marginBottom:20,flexShrink:0,
animation:_panelOpen?"riseUp 0.5s ease 0.2s both":"none"}}>
<div style={{fontSize:16,color:_archColor,fontFamily:FD,
fontStyle:"italic",lineHeight:1.6,maxWidth:300,margin:"0 auto"}}>
"{_archLine}"
</div>
</div>
)}

{_archPhases && (
<div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
{Object.entries(_archPhases).map(function(entry, pi) {
var phaseName = entry[0];
var phaseText = entry[1];
return (
<div key={pi} style={{marginBottom:16,
animation:_panelOpen?"riseUp 0.5s ease "+(0.25+pi*0.07)+"s both":"none"}}>
<div style={{fontSize:8,letterSpacing:"0.4em",
color:_archColor+"66",fontFamily:FB,
textTransform:"uppercase",marginBottom:5}}>
{phaseName}
</div>
<div style={{fontSize:14,color:"rgba(220,215,240,0.65)",
fontFamily:FD,fontStyle:"italic",lineHeight:1.65}}>
{phaseText}
</div>
</div>
);
})}
</div>
)}

{!_archPhases && _archDesc && (
<div style={{flex:1,animation:_panelOpen?"riseUp 0.5s ease 0.25s both":"none"}}>
<div style={{fontSize:14,color:"rgba(220,215,240,0.65)",
fontFamily:FD,fontStyle:"italic",lineHeight:1.75}}>
{_archDesc}
</div>
</div>
)}

<div style={{textAlign:"center",marginTop:16,flexShrink:0}}>
<div style={{fontSize:9,letterSpacing:"0.3em",color:"rgba(255,255,255,0.18)",
fontFamily:FB,textTransform:"uppercase"}}
onClick={function(e){e.stopPropagation();_setPanelOpen(false);}}>
TAP TO CLOSE
</div>
</div>
</div>

</div>
);
}

function UnderdrawingCard({ themes, sessionCount, portrait, portraitReady, goNext }) {
themes = themes || [];
var _all = (function(){ try { return loadSessions(); } catch(e){ return []; } })();

var [_question, _setQuestion] = useState(null);
var [_subtitle, _setSubtitle] = useState(null);
var [_ready, _setReady] = useState(false);

useEffect(function() {
if (portrait && portrait.question) {
_setQuestion(portrait.question);
_setSubtitle(portrait.toward || null);
_setReady(true);
return;
}
if (portraitReady && !portrait) {
var cancelled = false;
(async function() {
try {
var bio = _all.slice(-4).map(function(s,si){
var a=(s.archetypes&&s.archetypes[0]&&s.archetypes[0].name)||"";
var bl=typeof s.blind_spot==="string"?s.blind_spot:"";
var op=typeof s.opening==="string"?s.opening:"";
return "S"+(si+1)+": arch="+a+" blind="+bl.slice(0,60)+" opening="+op.slice(0,60);
}).join("\n");
var p = "What is the ONE question this person has been living inside? 8-14 words. Make them catch their breath.\n"+bio+"\nJSON: {\"question\":\"...\",\"toward\":\"4-7 words\"}";
var rr = await callClaudeClient(p, "underdrawing", 150);
if (!cancelled) {
var dd = parseJSON(rr);
if (dd&&dd.question) { _setQuestion(dd.question); _setSubtitle(dd.toward||null); }
}
} catch(e) {} finally { if (!cancelled) _setReady(true); }
})();
return function(){ cancelled = true; };
}
}, [portrait, portraitReady]);

return (
<div onClick={function(e){e.stopPropagation();}}
style={{ position:"absolute", inset:0, overflow:"hidden",
background:"linear-gradient(160deg, #F5EFE0 0%, #EDE5CC 45%, #F0E8D5 100%)",
display:"flex", flexDirection:"column", justifyContent:"space-between" }}>

<div style={{ position:"absolute", inset:0, opacity:0.04, pointerEvents:"none",
backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\")",
backgroundSize:"300px 300px" }}/>

<div style={{ position:"absolute", top:"25%", left:"10%", right:"10%", height:"55%",
background:"radial-gradient(ellipse, rgba(200,140,40,0.14) 0%, rgba(180,120,20,0.06) 45%, transparent 72%)",
pointerEvents:"none" }}/>
<div style={{ position:"absolute", top:"10%", right:"0%", width:"45%", height:"40%",
background:"radial-gradient(ellipse, rgba(210,160,60,0.09) 0%, transparent 65%)",
pointerEvents:"none" }}/>
<div style={{ position:"absolute", inset:0,
background:"radial-gradient(ellipse 90% 90% at 50% 50%, transparent 55%, rgba(100,70,20,0.12) 100%)",
pointerEvents:"none" }}/>

<div style={{ padding:"52px 32px 0", flexShrink:0 }}>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:20 }}>
<div style={{ fontSize:8, letterSpacing:"0.55em",
color:"rgba(80,55,20,0.35)", fontFamily:FB }}>SAYCRD</div>
<div style={{ fontSize:8, letterSpacing:"0.2em",
color:"rgba(80,55,20,0.28)", fontFamily:FB }}>{sessionCount} SESSIONS</div>
</div>
<div style={{ height:0.75, marginBottom:18,
background:"linear-gradient(90deg, transparent, rgba(120,80,20,0.25) 30%, rgba(140,90,20,0.35) 70%, transparent)" }}/>
<div style={{ fontSize:8.5, letterSpacing:"0.55em",
color:"rgba(100,65,20,0.4)", fontFamily:FB,
textTransform:"uppercase", marginBottom:0 }}>
HELD TO THE LIGHT
</div>
</div>

<div style={{ flex:1, display:"flex", flexDirection:"column",
justifyContent:"center", padding:"0 32px" }}>

{!_ready ? (
<div style={{ display:"flex", flexDirection:"column", gap:12, alignItems:"center" }}>
<div style={{ width:"80%", height:28, borderRadius:4,
background:"rgba(120,80,20,0.07)",
animation:"breathe 2s ease-in-out infinite alternate" }}/>
<div style={{ width:"65%", height:28, borderRadius:4,
background:"rgba(120,80,20,0.05)",
animation:"breathe 2s ease-in-out 0.3s infinite alternate" }}/>
<div style={{ width:"50%", height:20, borderRadius:4, marginTop:8,
background:"rgba(120,80,20,0.04)",
animation:"breathe 2s ease-in-out 0.5s infinite alternate" }}/>
</div>
) : (
<div style={{ animation:"riseUp 1s ease 0.2s both" }}>
<div style={{
fontSize:28,
fontWeight:400,
fontFamily:FD,
fontStyle:"italic",
color:"rgba(35,20,5,0.88)",
lineHeight:1.55,
letterSpacing:"0.01em",
marginBottom:28,
textAlign:"left"
}}>
{_question || "what would it mean to finally stop carrying this?"}
</div>

<div style={{ width:48, height:1.5, marginBottom:18,
background:"linear-gradient(90deg, rgba(160,100,20,0.6), rgba(180,120,20,0.3))",
borderRadius:1 }}/>

{_subtitle && (
<div style={{
fontSize:13,
fontFamily:FB,
fontWeight:400,
letterSpacing:"0.18em",
textTransform:"uppercase",
color:"rgba(120,75,20,0.5)"
}}>
{_subtitle}
</div>
)}
</div>
)}
</div>

<div style={{ padding:"0 32px 40px", flexShrink:0 }}>
<div style={{ height:0.75, marginBottom:16,
background:"linear-gradient(90deg, transparent, rgba(120,80,20,0.25) 30%, rgba(140,90,20,0.35) 70%, transparent)" }}/>
<div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
<div style={{ fontSize:11, color:"rgba(100,65,15,0.4)",
fontFamily:FD, fontStyle:"italic", lineHeight:1.6 }}>
The question was always yours.
</div>
<div style={{ display:"flex", gap:3, alignItems:"center" }}>
{Array.from({length:Math.min(sessionCount,20)}).map(function(_,di){
return <div key={di} style={{
width:4, height:4, borderRadius:"50%",
background: di===Math.min(sessionCount,20)-1
? "rgba(160,100,20,0.8)"
: "rgba(140,90,20,"+(0.15+di*0.02)+")"
}}/>;
})}
</div>
</div>
</div>

</div>
);
}

function FieldReportCard({ themes, sd, sessionCount, allSessions, currentSessionData, portrait, portraitReady, goNext }) {
themes = themes || [];
allSessions = allSessions || [];
currentSessionData = currentSessionData || null;

var [_report, _setReport] = useState(null);
var [_ready, _setReady] = useState(false);
var _notesKey = "saycrd-report-notes-" + sessionCount;
var [_reportNotes, _setReportNotes] = useState("");
var [_notesSummary, _setNotesSummary] = useState("");
var [_notesSummarizing, _setNotesSummarizing] = useState(false);
var [_shareableLoading, _setShareableLoading] = useState(false);
useEffect(function() {
try {
var n = localStorage.getItem(_notesKey) || "";
var s = localStorage.getItem(_notesKey+"-summary") || "";
if (n) _setReportNotes(n);
if (s) _setNotesSummary(s);
} catch(e) {}
}, [_notesKey]);

useEffect(function() {
var cancelled = false;
(async function() {
try {
var total = allSessions.length; 

var slimBio = allSessions.map(function(s, si) {
if (s.sessionSummary && String(s.sessionSummary).trim()) return "S"+(si+1)+": "+String(s.sessionSummary).trim().slice(0, 180);
var a = (s.archetypes && s.archetypes[0] && s.archetypes[0].name) || "";
var th = (s.themes || []).slice(0,2).map(function(t){ return t.label; }).join(",");
var bl = typeof s.blind_spot === "string" ? s.blind_spot.slice(0,60) : "";
var op = typeof s.opening === "string" ? s.opening.slice(0,50) : "";
var al = (s.alchemy && s.alchemy.stage) || "";
var ow = s.corrections
? Object.values(s.corrections).filter(function(c){ return typeof c==="string" && c.length>4; }).slice(0,1).map(function(c){ return c.slice(0,60); }).join("")
: "";
var res = s.reactions
? Object.keys(s.reactions).filter(function(rk){ return s.reactions[rk]==="resisted"; }).slice(0,1).join("")
: "";
return "S"+(si+1)+":"+(a?a+"|":"")+th+(bl?"|blind:"+bl:"")+(op?"|open:"+op:"")+(ow?"|said:"+ow:"")+(res?"|resisted:"+res:"")+ (s.clarity?"|clarity:"+String(s.clarity).slice(0,100):"")+ (s.descent?"|descent:"+(typeof s.descent==="object"&&s.descent.cards?s.descent.cards.map(function(c){return c.label||c.name||"";}).join(","):String(s.descent).slice(0,100)):"");
}).join("\n");

var lastSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;
var currSession = currentSessionData || lastSession || sd;
var currSummary = [
themes.slice(0,3).map(function(t){ return t.label; }).join(", "),
(sd.tension && sd.tension.a ? sd.tension.a+" vs "+sd.tension.b : (currSession.tension && currSession.tension.a ? currSession.tension.a+" vs "+currSession.tension.b : "")),
sd.blind_spot ? String(sd.blind_spot).slice(0,80) : (currSession.blind_spot ? String(currSession.blind_spot).slice(0,80) : ""),
sd.opening ? String(sd.opening).slice(0,80) : (currSession.opening ? String(currSession.opening).slice(0,80) : ""),
sd.clarity ? String(sd.clarity).slice(0,80) : (currSession.clarity ? String(currSession.clarity).slice(0,80) : ""),
(sd.descent || currSession.descent) ? (function(d){ return typeof d==="object"&&d.cards ? d.cards.map(function(c){return c.label||c.name||c.phrase||c.prompt||"";}).join(", ") : String(d).slice(0,80); })(sd.descent || currSession.descent) : ""
].filter(Boolean).join(" | ");

var whatsNewBlurb = "";
if (total >= 2 && lastSession) {
var lastThemeList = (lastSession.themes || []).map(function(t){ return (t.label||"").trim(); }).filter(Boolean);
var currThemeList = themes.slice(0,4).map(function(t){ return (t.label||"").trim(); }).filter(Boolean);
var lastThemes = lastThemeList.join(", ");
var currThemes = currThemeList.join(", ");
var lastTens = lastSession.tension && lastSession.tension.a ? lastSession.tension.a + " vs " + lastSession.tension.b : "";
var currTens = sd.tension && sd.tension.a ? sd.tension.a + " vs " + sd.tension.b : "";
var newThemes = currThemeList.filter(function(t){ return t && lastThemeList.indexOf(t) < 0; });
var returningThemes = currThemeList.filter(function(t){ return t && lastThemeList.indexOf(t) >= 0; });
whatsNewBlurb = "WHAT'S NEW THIS TIME (compare to last session): Last session themes: " + (lastThemes || "—") + ". Last tension: " + (lastTens || "—") + ". This session themes: " + (currThemes || "—") + ". This tension: " + (currTens || "—") + ". New this time: " + (newThemes.length ? newThemes.join(", ") : "none") + ". Returning: " + (returningThemes.length ? returningThemes.join(", ") : "none") + ". Lead with what's different about THIS moment — why now? What shifted?\n\n";
}

var allCorrections = [];
allSessions.forEach(function(s) {
if (s.corrections) {
Object.values(s.corrections).forEach(function(c) {
if (typeof c === "string" && c.length > 6) allCorrections.push(c.slice(0,80));
});
}
});

var resistFreq = {};
allSessions.forEach(function(s) {
if (s.reactions) {
Object.keys(s.reactions).forEach(function(rk) {
if (s.reactions[rk] === "resisted") resistFreq[rk] = (resistFreq[rk]||0)+1;
});
}
});
var topResist = Object.keys(resistFreq).sort(function(a,b){ return resistFreq[b]-resistFreq[a]; }).slice(0,3);

var intensities = allSessions.map(function(s,si){ return { si:si+1, v:s.intensity||0 }; });
var maxIntense = intensities.reduce(function(m,x){ return x.v>m.v?x:m; }, {si:0,v:0});
var recentAvg = intensities.slice(-3).reduce(function(s,x){ return s+x.v; },0) / Math.max(intensities.slice(-3).length,1);
var earlyAvg = intensities.slice(0,3).reduce(function(s,x){ return s+x.v; },0) / Math.max(Math.min(3,intensities.length),1);
var intensityDir = recentAvg > earlyAvg+0.5 ? "deepening" : recentAvg < earlyAvg-0.5 ? "settling" : "steady";

var archJourney = allSessions.map(function(s){ return (s.archetypes&&s.archetypes[0]&&s.archetypes[0].name)||""; }).filter(Boolean);
var uniqueArchs = archJourney.filter(function(a,i){ return i===0||archJourney[i-1]!==a; });

var themeRecurrence = {};
allSessions.forEach(function(s) {
(s.themes||[]).forEach(function(t) {
if (t && t.label) themeRecurrence[t.label] = (themeRecurrence[t.label]||0) + 1;
});
});
var persistentThemes = Object.keys(themeRecurrence).filter(function(l){ return themeRecurrence[l] >= 3; }).sort(function(a,b){ return themeRecurrence[b]-themeRecurrence[a]; });
var returningThemes = Object.keys(themeRecurrence).filter(function(l){ return themeRecurrence[l] === 2; });
var arcPatternBlurb = "";
if (total >= 5) {
var parts = [];
if (persistentThemes.length) parts.push("Persistent themes (3+ sessions): "+persistentThemes.slice(0,6).join(", ")+(persistentThemes.length>6?"…":""));
if (returningThemes.length) parts.push("Returning (2 sessions): "+returningThemes.slice(0,4).join(", ")+(returningThemes.length>4?"…":""));
arcPatternBlurb = "CROSS-SESSION ARC ("+total+" sessions)"+(parts.length?" — "+parts.join(". "):"")+". "+(total>=10?"With this many sessions, a brilliant analyst would see meta-patterns — what the subject keeps circling, what only becomes visible over time, what the arc reveals that no single session shows. Dig into that.":"")+"\n\n";
}

var currThemeLabels = themes.map(function(t){ return (t&&t.label)||""; }).filter(Boolean);
var newTerritoryThemes = currThemeLabels.filter(function(l){ return (themeRecurrence[l]||0) <= 1; });
var shiftBlurb = "";
if (total >= 3 && newTerritoryThemes.length >= 1 && persistentThemes.length >= 1) {
var overlap = newTerritoryThemes.filter(function(t){ return persistentThemes.indexOf(t) >= 0; });
if (overlap.length < newTerritoryThemes.length) {
var trulyNew = newTerritoryThemes.filter(function(t){ return persistentThemes.indexOf(t) < 0; });
shiftBlurb = "SUBJECT SHIFT — CRITICAL: This session introduces NEW TERRITORY. The subject is speaking about ["+trulyNew.slice(0,4).join(", ")+(trulyNew.length>4?"…":"")+"] for the first time (or nearly so). Previous sessions were dominated by ["+persistentThemes.slice(0,4).join(", ")+(persistentThemes.length>4?"…":"")+"]. DO NOT default to summarizing the arc. LEAD WITH THE CURRENT SESSION. Open with the shift: this was the first time the subject spoke about [X]. Surface the questions: why now? what's happening? Weave the past into the current moment — not the other way around. The report must center on what's new. Do not continue the same report cadence and merely mention the new subject.\n\n";
}
}

var prevReportHint = "";
try {
var historyKey = "saycrd-report-history-" + getCurrentUid();
var reportHistory = JSON.parse(localStorage.getItem(historyKey) || "[]");
var recent = reportHistory.slice(-3);
if (recent.length > 0) {
var lines = recent.map(function(r, i) {
return "Report " + (i + 1) + ": verdict \"" + (r.oneLine || "").slice(0, 80) + "\"; opening: \"" + (r.firstOpen || "").slice(0, 60) + "\"";
}).join(". ");
prevReportHint = "AVOID REPETITION: Your last " + recent.length + " report(s): " + lines + ". This report must feel FRESH and DISTINCT. Do NOT repeat that structure, phrasing, or angle. Lead with what's different about THIS moment. Vary the opening — sometimes start with the arc, sometimes with the current tension, sometimes with what the subject said, sometimes with a pattern that spans sessions. Never formulaic.\n\n";
}
} catch(e) {}

var firstDate = allSessions.length>0 && allSessions[0].date
? new Date(allSessions[0].date).toLocaleDateString("en-US",{month:"short",day:"numeric"})
: "";
var lastDate = allSessions.length>0 && allSessions[allSessions.length-1].date
? new Date(allSessions[allSessions.length-1].date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
: "";

var stats = total+" sessions. Intensity trend: "+intensityDir+". Peak: S"+maxIntense.si+".";
if (uniqueArchs.length) stats += " Archetype progression: "+uniqueArchs.join(" > ")+".";
if (allCorrections.length) stats += " Subject said in their own words: "+allCorrections.slice(0,3).map(function(c){return '"'+c+'"';}).join(", ")+".";
if (topResist.length) stats += " Kept pushing back on: "+topResist.join("; ")+".";

var mapNotesLines = [];
allSessions.forEach(function(s) {
if (!s.mapResponses) return;
Object.keys(s.mapResponses).forEach(function(connKey) {
var mr = s.mapResponses[connKey];
if (!mr || !mr.comment || !String(mr.comment).trim()) return;
var parts = connKey.split("::");
var from = (parts[0]||"").trim(), to = (parts[1]||"").trim();
mapNotesLines.push("Between \""+from+"\" and \""+to+"\": \""+String(mr.comment).trim().slice(0,220)+(String(mr.comment).trim().length>220?"…":"")+"\"");
});
});
var mapNotesBlurb = mapNotesLines.length > 0
? "MAP NOTES (subject's words about connections — when using these in the report, QUOTE them in full, e.g. 'The subject said: \"...\"'):\n" + mapNotesLines.slice(0, 20).join("\n") + "\n\n"
: "";

var subjectWordsList = allCorrections.slice(0, 10);
allSessions.forEach(function(s) {
if (!s.mapResponses) return;
Object.keys(s.mapResponses).forEach(function(connKey) {
var mr = s.mapResponses[connKey];
if (!mr || !mr.comment || !String(mr.comment).trim()) return;
var t = String(mr.comment).trim().slice(0, 180);
if (subjectWordsList.indexOf(t) === -1) subjectWordsList.push(t);
});
});
var subjectWordsBlurb = subjectWordsList.length > 0
? "SUBJECT'S OWN WORDS (session corrections and map notes — when citing these, use the exact quote in the report):\n" + subjectWordsList.slice(0, 14).map(function(w){ return "\""+w+"\""; }).join("\n") + "\n\n"
: "";

var underList = [];
allSessions.forEach(function(s) {
var u = s.underneath;
if (Array.isArray(u)) u.forEach(function(x){ if (typeof x==="string"&&x.trim()) underList.push(x.trim()); });
else if (typeof u==="string"&&u.trim()) underList.push(u.trim());
});
if (sd && sd.underneath) {
if (Array.isArray(sd.underneath)) sd.underneath.forEach(function(x){ if (typeof x==="string"&&x.trim()) underList.push(x.trim()); });
else if (typeof sd.underneath==="string"&&sd.underneath.trim()) underList.push(sd.underneath.trim());
}
var underBlurb = underList.length ? "What's underneath (pattern intelligence — patterns hard for the subject to self-see: repetition, structure, blind spots; use these exact ideas in prose, never write labels like underneath_0): " + underList.map(function(u,i){ return "("+(i+1)+") \""+u.slice(0,120)+(u.length>120?"…":"")+"\""; }).join("; ") + ".\n\n" : "";

var descentBlurb = "";
var currDescent = (currentSessionData && currentSessionData.descent) ? currentSessionData.descent : (lastSession && lastSession.descent ? lastSession.descent : (sd.descent || null));
if (currDescent && typeof currDescent==="object" && currDescent.cards && currDescent.answers) {
var lines = [];
currDescent.cards.forEach(function(card, i) {
var ans = currDescent.answers[i];
if (ans === undefined || ans === null) return;
var display = "";
if (card.type === "energy") { var v = typeof ans==="number" ? ans : parseInt(ans,10); display = (v>=0&&v<=5) ? (v+"/5 intensity") : String(ans); }
else if (card.type === "spectrum") { var pct = typeof ans==="number" ? Math.round(ans) : parseInt(ans,10); display = (pct>=0&&pct<=100) ? (pct+"% toward \""+(card.pole_b||"right")+"\"") : String(ans); }
else if (card.type === "binary") { display = ans === "a" || ans === "b" ? "chose \"" + (ans==="a" ? (card.option_a||"a") : (card.option_b||"b")) + "\"" : String(ans); }
else display = String(ans);
var prompt = card.phrase || card.prompt || "";
if (prompt) lines.push("\""+prompt.slice(0,80)+"\" → "+display);
});
if (lines.length) descentBlurb = "DESCENT (subject's direct feedback — how much each landed; this is PRIMARY evidence, use it):\n" + lines.join("\n") + "\n\n";
}

var clarityBlurb = "";
var currClarity = (currentSessionData && currentSessionData.clarity) ? currentSessionData.clarity : (lastSession && lastSession.clarity ? lastSession.clarity : (sd.clarity || sd.sessionClarity || ""));
if (currClarity && String(currClarity).trim()) {
clarityBlurb = "CLARITY (subject's own words — what they're taking with them; quote when relevant): \"" + String(currClarity).trim().slice(0, 200) + (String(currClarity).length > 200 ? "…" : "") + "\"\n\n";
}

var mapValuesBlurb = "";
var currMap = (currentSessionData && currentSessionData.mapResponses) ? currentSessionData.mapResponses : (lastSession && lastSession.mapResponses ? lastSession.mapResponses : {});
if (Object.keys(currMap).length > 0) {
var connLines = [];
Object.keys(currMap).forEach(function(k) {
var mr = currMap[k];
if (!mr) return;
var parts = k.split("::");
var from = (parts[0]||"").trim(), to = (parts[1]||"").trim();
var val = mr.value === "yes" ? "confirmed" : mr.value === "partly" ? "partly" : mr.value === "no" ? "rejected" : mr.value || "";
var cmt = mr.comment && String(mr.comment).trim() ? " — \""+String(mr.comment).trim().slice(0,100)+"\"" : "";
connLines.push(from+" ↔ "+to+": "+val+cmt);
});
if (connLines.length) mapValuesBlurb = "MAP CONNECTION FEEDBACK (what landed for the subject — yes/partly/no; use as evidence):\n" + connLines.slice(0, 15).join("\n") + "\n\n";
}

var patternEngineBlurb = "";
if (total >= 3) {
var pe = loadPatternEngine();
if (!pe && total >= 2) { try { pe = computePatternEngine(); } catch(e) {} }
if (pe) {
var peLines = [];
if (pe.recurring_obstacles && pe.recurring_obstacles.length) peLines.push("Recurring obstacles (pushed back 2+ times): " + pe.recurring_obstacles.map(function(o){ return o.key + " ("+o.count+"x)" + (o.confidence ? " ["+o.confidence+"]" : ""); }).join("; "));
if (pe.identity_shifts && pe.identity_shifts.length) peLines.push("Identity shifts: " + pe.identity_shifts.map(function(s){ return s.from + " → " + s.to; }).join("; "));
if (pe.emerging_strengths && pe.emerging_strengths.length) peLines.push("Emerging strengths (rising themes): " + pe.emerging_strengths.map(function(s){ return s.label + " (+"+s.delta+")" + (s.confidence ? " ["+s.confidence+"]" : ""); }).join(", "));
if (pe.repeating_goals && pe.repeating_goals.length) peLines.push("Repeating in clarity: " + pe.repeating_goals.map(function(g){ return g.word + " ("+g.count+"x)" + (g.confidence ? " ["+g.confidence+"]" : ""); }).join(", "));
if (pe.emotional_cycles && pe.emotional_cycles.recent) peLines.push("Recent energy pattern: " + pe.emotional_cycles.recent + (pe.emotional_cycles.confidence ? " [low confidence — heuristic only]" : ""));
if (pe.connection_arcs && pe.connection_arcs.length) peLines.push("Connection arcs (how map feedback evolved): " + pe.connection_arcs.slice(0, 5).map(function(a){ return a.connectionKey + " " + a.trend + " (" + a.summary.slice(-80) + ")"; }).join("; "));
if (pe.pattern_morphology && pe.pattern_morphology.length) peLines.push("Pattern evolution (subject refined readings over time): " + pe.pattern_morphology.map(function(m){ return m.type === "blind_spot" ? "blind spot: \"" + m.before + "\" → \"" + m.after + "\"" : m.key + " refined " + m.count + "x"; }).join("; "));
if (pe.life_domain_signals && pe.life_domain_signals.length) peLines.push("Life domains (where themes cluster): " + pe.life_domain_signals.map(function(d){ return d.domain + ": " + d.topThemes.join(", "); }).join("; "));
if (pe.regression_context && pe.regression_context.length) peLines.push("Regressions (when themes/map values dropped — prior context): " + pe.regression_context.map(function(r){ return "S" + (r.sessionIndex + 1) + " " + r.type + " " + r.key + (r.priorContext ? " — prior: " + r.priorContext.slice(0, 60) : ""); }).join("; "));
if (peLines.length) patternEngineBlurb = "PATTERN ENGINE (use to deepen — weave into prose, do not list mechanically):\n" + peLines.join("\n") + "\n\nPATTERN CONFIDENCE: [high]=strong evidence, state directly. [medium]=good evidence, use 'the data suggests' or 'the record shows'. [low]=heuristic or sparse, use 'one possible reading' or 'the pattern may suggest' — never state as fact.\n\n";
}
}

var metaPatternBlurb = total >= 10 ? "META-PATTERN (10+ sessions): Name the ONE invariant structure — the theme, blind spot, or storyline that has taken different forms over time. One sentence. Example: 'The subject has been solving the same problem (fear of being seen as weak) with increasingly subtle strategies.' The report's deepest gift is the pattern that no single session could show. Weave it into the report. Do NOT use the formula: summarize arc → current session → blind spot. Vary the opening.\n\n" : "";

var narrativeBlurb = "";
if (total >= 10) {
var nar = loadNarrativeArc();
if (!nar) try { nar = computeNarrativeArc(); } catch(e) {}
if (nar) {
var narLines = [];
if (nar.chapters && nar.chapters.length) narLines.push("Chapters: " + nar.chapters.map(function(c){ return "S"+(c.sessionRange[0]+1)+"-S"+(c.sessionRange[1]+1)+": "+c.dominantThemes.join(", ")+(c.archetype?" | "+c.archetype:"")+(c.tension?" | "+c.tension:""); }).join("; "));
if (nar.turning_points && nar.turning_points.length) narLines.push("Turning points: " + nar.turning_points.map(function(t){ return "S"+(t.sessionIndex+1)+" "+t.type+": "+t.description; }).join("; "));
if (nar.recurring_storylines && nar.recurring_storylines.length) narLines.push("Recurring storylines (3+ sessions): " + nar.recurring_storylines.map(function(s){ return s.label+" ("+s.count+"x)"; }).join(", "));
if (narLines.length) narrativeBlurb = "NARRATIVE ARC (10+ sessions — the record over time; weave into prose):\n" + narLines.join("\n") + "\n\n";
}
}

var emergentSignalsBlurb = "";
if (total >= 5) {
var es = computeEmergentSignals();
if (es) {
var esLines = [];
if (es.opening_question) esLines.push("Opening question: \"" + es.opening_question + "\"");
if (es.rising && es.rising.length) esLines.push("Rising (approaching): " + es.rising.map(function(r){ return r.label+" (+"+r.delta+")"; }).join(", "));
if (es.fading && es.fading.length) esLines.push("Fading (releasing): " + es.fading.map(function(f){ return f.label+" ("+f.delta+")"; }).join(", "));
if (es.blind_spot) esLines.push("Blind spot: " + es.blind_spot);
if (es.chronic && es.chronic.length) esLines.push("Chronic (always present): " + es.chronic.join(", "));
if (es.absent && es.absent.length) esLines.push("Absent (disappeared): " + es.absent.join(", "));
if (esLines.length) emergentSignalsBlurb = "EMERGENT SIGNALS (what wants to happen — rising/approaching, fading/releasing, blind spot, chronic, absent):\n" + esLines.join("\n") + "\n\n";
}
}

var prompt = "You are writing a confidential field report. Third person only. Always call the subject \"the subject\" — never he, she, him, her. Plain declarative past tense. Clinical but human.\n\n"
+ "PRACTITIONER MODE: You are a brilliant practitioner. Draw on pattern recognition, systems thinking, and deep listening — without naming disciplines. Identify what the subject cannot easily see: blind spots, recurring structure, the pattern beneath the pattern. With 20+ sessions, uncover the theme that only becomes visible over time. Write with precision and depth.\n\n"
+ "TRUTH RULE: What the subject says is truth. Descent answers (how much something landed), map notes, corrections, clarity — these are their words. NEVER invent or paraphrase into something they did not say. NEVER claim they said something without a direct quote from the data. If you cannot quote it, do not assert it. The subject will read this.\n\n"
+ "CRITICAL RULES: Only write what the data explicitly states. Do not invent themes, emotions, patterns, or history not present in the data below. If there is only 1 session, say so — do not imply more. If a field is blank, do not fill it in. No poetry. No therapy language. Short paragraphs, 2 sentences each, blank line between them. Descent answers and map feedback are PRIMARY — they show what landed. Use them to ground the report.\n"
+ "CITATION RULE: When you claim the subject said or wrote something, you MUST quote it. Use the exact words from MAP NOTES, SUBJECT'S OWN WORDS, or DESCENT above. Never paraphrase into a claim the subject did not make. If you cannot find a direct quote for something, do not assert they said it. The subject will read this — every claim must be traceable to the source data.\n"
+ "GROUNDING: For each major insight, anchor it in evidence the reader can trace (e.g. \"the map showed control↔trust confirmed in 5 of the last 6 sessions\" or \"the subject corrected the blind spot twice, refining it from X to Y\"). Use careful language: \"the record suggests,\" \"the pattern appears to,\" \"in sessions where X, the subject tended to Y\" — interpretation, not certainty. Where a pattern is not absolute (e.g. regressions amid an overall trend), add light nuance: \"with exceptions at S9 and S16\" or \"though not in every session.\" Keep the tone elegant and the prose flowing; do not add bullet points or evidence blocks. The report should read as a thoughtful evaluation, not a forensic audit.\n"
+ "NEVER use variable names, keys, or placeholders in the report (e.g. underneath_0, underneath_1). Always use the actual underlying theme or a short paraphrase in plain English.\n\n"
+ (prevReportHint ? prevReportHint : "")
+ (shiftBlurb ? shiftBlurb : "")
+ "SUBJECT DATA:\n" + stats + "\n"
+ (arcPatternBlurb ? arcPatternBlurb : "")
+ (whatsNewBlurb ? whatsNewBlurb : "")
+ "SESSION ARC:\n" + slimBio + "\n"
+ "CURRENT SESSION (structure the report around this): " + currSummary + "\n\n"
+ (descentBlurb ? descentBlurb : "")
+ (clarityBlurb ? clarityBlurb : "")
+ (mapValuesBlurb ? mapValuesBlurb : "")
+ (patternEngineBlurb ? patternEngineBlurb : "")
+ (narrativeBlurb ? narrativeBlurb : "")
+ (emergentSignalsBlurb ? emergentSignalsBlurb : "")
+ (metaPatternBlurb ? metaPatternBlurb : "")
+ mapNotesBlurb
+ subjectWordsBlurb
+ underBlurb
+ "STRUCTURE: The current session is the CORE and BACKBONE — anchor the report there. The VALUE is the Y-axis: what has accumulated over time. The report's power is how the longitudinal arc (themes, patterns, blind spots across many sessions) gets BROUGHT UP and surfaced in this session. Use descent answers and map feedback as the backbone of what landed now. Weave the past into the current — the value over time is what this session brings into focus. When 20+ sessions, the meta-pattern that only becomes visible over time is the report's deepest gift. 3 short paragraphs per section.\n\n"
+ "NO DRIFT: The conclusion must tie to the heart of what this report established. Use prior-session material to bring the Y-axis (value over time) into the current moment — not to drift into unrelated history. Stay on topic.\n\n"
+ "Write 3 sections. Each has: ALL-CAPS TITLE (3-5 words), then body in short paragraphs separated by blank lines.\n"
+ "Where relevant, QUOTE the subject's own words (from MAP NOTES and SUBJECT'S OWN WORDS above) — use their exact phrasing in quotes. Do not paraphrase into something they didn't say. In WHAT REMAINS, connect at least one 'what's underneath' idea to something the subject actually said — quote the map note or correction so the reader can trace it.\n\n"
+ "SECTION 1 title like WHAT OCCURRED: What dominated in THIS session. When the subject has shifted to new territory, open with that — first time speaking about X, why now. Name specific themes and archetypes. Do not lead with a summary of past sessions when the current session is the story. 3 short paragraphs.\n"
+ "SECTION 2 title like WHAT MOVED: Concrete change. When there's a subject shift, this section explores the shift — what's happening, why now, how the past connects to this moment. When no shift, what moved between sessions or within the session. 3 short paragraphs.\n"
+ "SECTION 3 title like WHAT REMAINS: Still unresolved. Still returning. No comfort. Refer to the 'what's underneath' phrases above — these are pattern-intelligence observations (repetition, structure, blind spots the subject may not see). Use them in prose. Never use labels like underneath_0. Where possible, tie one to something the subject actually said — QUOTE the map note or correction so the link is traceable. Conclude with what the report has already established — do not drift to past specifics that don't correlate. If a prior-session nugget bolsters the point, use it; otherwise go deeper into the heart of this report. 2 short paragraphs.\n\n"
+ "Also: oneLineVerdict — one plain third-person sentence (12-16 words). The single most honest thing about this subject right now, tied to the heart of this report. Written like a pencil note at the bottom of a file. Make it fresh — not a formula.\n"
+ (total >= 10 ? "whatMightWantToHappen — one sentence. Not advice — an observation about the next edge, based on what remains. What might want to happen? Optional but valuable.\n" : "")
+ (firstDate && lastDate ? "dateRange: "+firstDate+" to "+lastDate+".\n" : "")
+ (total >= 10 ? 'JSON only: {"sections":[{"title":"...","body":"..."},{"title":"...","body":"..."},{"title":"...","body":"..."}],"oneLineVerdict":"...","dateRange":"...","whatMightWantToHappen":"..."}' : 'JSON only: {"sections":[{"title":"...","body":"..."},{"title":"...","body":"..."},{"title":"...","body":"..."}],"oneLineVerdict":"...","dateRange":"..."}');

var rr = await callClaudeClient(prompt, "field_report", 950);
if (cancelled) return;
var dd = parseJSON(rr);
if (dd && dd.sections && dd.sections.length >= 3) {
for (var i = 0; i < dd.sections.length; i++) {
var b = dd.sections[i].body || "";
for (var j = 0; j < underList.length; j++) {
var label = "underneath_" + j;
var repl = underList[j];
b = b.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), repl);
b = b.replace(new RegExp('"underneath_' + j + '"', "gi"), "\"" + repl + "\"");
}
dd.sections[i].body = b;
}
_setReport(dd);
try {
var firstBody = (dd.sections[0] && dd.sections[0].body) || "";
var firstOpen = firstBody.split(/\n\n+/)[0] || firstBody.split("\n")[0] || "";
firstOpen = firstOpen.trim().slice(0, 120);
var historyKey = "saycrd-report-history-" + getCurrentUid();
var reportHistory = JSON.parse(localStorage.getItem(historyKey) || "[]");
reportHistory.push({ sessionIndex: total, oneLine: (dd.oneLineVerdict||"").slice(0, 100), firstOpen: firstOpen, generatedAt: new Date().toISOString() });
reportHistory = reportHistory.slice(-5);
localStorage.setItem(historyKey, JSON.stringify(reportHistory));
} catch(e2) {}
} else {
_setReport({
sections:[
{title:"WHAT OCCURRED", body:"The sessions are on record.\n\nThe patterns are clear."},
{title:"WHAT MOVED", body:"Something shifted between the early and recent sessions.\n\nThe evidence is in the arc."},
{title:"WHAT REMAINS", body:"Some things have not moved.\n\nThey are still present."}
],
dateRange: firstDate && lastDate ? firstDate+" to "+lastDate : "",
oneLineVerdict:"The subject has done sustained inner work that has not yet fully resolved."
});
}
} catch(e) {
_setReport({ sections: [{ title: "Report unavailable", body: ("Error: " + (e && (e.stack || e.message || e) ? String(e.stack || e.message || e) : "Unknown error")).slice(0, 420) }], oneLineVerdict: "", dateRange: "" });
} finally {
if (!cancelled) _setReady(true);
}
})();
return function(){ cancelled = true; };
}, []);

var _accent = (themes[0] && themes[0].color) || "#111";

function renderBody(text) {
if (!text) return null;
var paras = text.split(/\n\n+/);
if (paras.length <= 1) paras = text.split(/\n/);
paras = paras.filter(function(p){ return p.trim(); });
return paras.map(function(para, pi) {
return (
<div key={pi} style={{ marginBottom: pi < paras.length-1 ? 16 : 0 }}>
{para.trim()}
</div>
);
});
}

return (
<div onClick={function(e){e.stopPropagation();}}
style={{ position:"absolute", inset:0, overflow:"hidden",
background:"#F9F9F7", display:"flex", flexDirection:"column",
fontFamily:FB }}>

<div style={{ height:3, flexShrink:0,
background:"linear-gradient(90deg, "+_accent+", "+_accent+"44)" }}/>

<div style={{ padding:"34px 30px 0", flexShrink:0 }}>
<div style={{ display:"flex", justifyContent:"space-between",
alignItems:"flex-start", marginBottom:14 }}>
<div>
<div style={{ fontSize:13, letterSpacing:"0.6em",
color:"rgba(0,0,0,0.28)", marginBottom:6, fontWeight:600 }}>
SAYCRD · FIELD REPORT
</div>
<div style={{ fontSize:34, fontWeight:800, color:"rgba(0,0,0,0.88)",
letterSpacing:"-0.025em", lineHeight:1 }}>
{sessionCount} {sessionCount===1 ? "SESSION" : "SESSIONS"}
</div>
</div>
<div style={{ textAlign:"right" }}>
{_report && _report.dateRange && (
<div style={{ fontSize:13, color:"rgba(0,0,0,0.28)",
letterSpacing:"0.08em", marginBottom:4 }}>
{_report.dateRange}
</div>
)}
<div style={{ fontSize:13, color:"rgba(0,0,0,0.22)",
letterSpacing:"0.2em", fontWeight:600 }}>CONFIDENTIAL</div>
</div>
</div>
<div style={{ height:1, background:"rgba(0,0,0,0.1)" }}/>
</div>

<div style={{ flex:1, overflowY:"auto", padding:"0 30px",
WebkitOverflowScrolling:"touch" }}>

{!_ready ? (
<div style={{ paddingTop:28, display:"flex", flexDirection:"column", gap:28 }}>
{[0,1,2].map(function(i){
return (
<div key={i} style={{ paddingBottom:24,
borderBottom:"1px solid rgba(0,0,0,0.06)" }}>
<div style={{ width:"28%", height:8, background:"rgba(0,0,0,0.08)",
borderRadius:2, marginBottom:18,
animation:"breathe 2s ease-in-out "+(i*0.2)+"s infinite alternate" }}/>
{[0,1,2,3].map(function(j){
return (
<div key={j} style={{ width:(93-j*7)+"%", height:14,
background:"rgba(0,0,0,"+(0.055-j*0.008)+")",
borderRadius:2, marginBottom: j===1 ? 20 : 9,
animation:"breathe 2s ease-in-out "+(i*0.2+j*0.08)+"s infinite alternate" }}/>
);
})}
</div>
);
})}
</div>
) : _report ? (
<div style={{ paddingTop:24 }}>

{_report.oneLineVerdict && (
<div style={{ marginBottom:26, padding:"16px 18px",
borderLeft:"3px solid "+_accent,
background:"rgba(0,0,0,0.03)" }}>
<div style={{ fontSize:17, color:"rgba(0,0,0,0.78)",
fontFamily:FD, lineHeight:1.65, fontWeight:500, fontStyle:"normal" }}>
{_report.oneLineVerdict}
</div>
</div>
)}

{_report.whatMightWantToHappen && (
<div style={{ marginBottom:20, padding:"14px 18px",
borderLeft:"3px solid rgba(0,0,0,0.12)",
background:"rgba(107,184,255,0.06)" }}>
<div style={{ fontSize:11, letterSpacing:"0.12em", color:"rgba(0,0,0,0.45)", fontFamily:FB, textTransform:"uppercase", marginBottom:6 }}>What might want to happen</div>
<div style={{ fontSize:15, color:"rgba(0,0,0,0.7)",
fontFamily:FD, lineHeight:1.6, fontStyle:"italic" }}>
{_report.whatMightWantToHappen}
</div>
</div>
)}

{(() => {
var hasMapOrSessionWords = allSessions.some(function(s){
return (s.mapResponses && Object.keys(s.mapResponses).length > 0) || (s.corrections && Object.keys(s.corrections).length > 0);
});
return hasMapOrSessionWords ? (
<div style={{ marginBottom:20, padding:"10px 14px", background:"rgba(0,0,0,0.02)", borderRadius:6, border:"1px solid rgba(0,0,0,0.06)" }}>
<div style={{ fontSize:11, letterSpacing:"0.12em", color:"rgba(0,0,0,0.4)", fontFamily:FB, textTransform:"uppercase", marginBottom:4 }}>Grounded in your input</div>
<div style={{ fontSize:13, color:"rgba(0,0,0,0.6)", fontFamily:FD, lineHeight:1.5 }}>This report used your words from the map and session — your corrections and notes shape what appears here.</div>
</div>
) : null;
})()}

{(_report.sections||[]).map(function(sec, si) {
return (
<div key={si} style={{ marginBottom:30, paddingBottom:30,
borderBottom: si<2 ? "1px solid rgba(0,0,0,0.09)" : "none",
animation:"riseUp 0.5s ease "+(si*0.12)+"s both" }}>

<div style={{ fontSize:13, letterSpacing:"0.5em",
color:_accent, marginBottom:16, fontWeight:700, opacity:0.75 }}>
{sec.title}
</div>

<div style={{ fontSize:17, color:"rgba(0,0,0,0.76)",
fontFamily:FD, lineHeight:1.9, fontWeight:400, fontStyle:"normal" }}>
{renderBody(sec.body)}
</div>

</div>
);
})}

<div style={{ marginTop:32, marginBottom:24, paddingTop:24, borderTop:"1px solid rgba(0,0,0,0.08)" }}>
<div style={{ fontSize:10, letterSpacing:"0.4em", color:"rgba(0,0,0,0.35)", fontFamily:FB, textTransform:"uppercase", marginBottom:12 }}>Your notes</div>
<div style={{ fontSize:14, color:"rgba(0,0,0,0.45)", fontFamily:FD, fontStyle:"italic", lineHeight:1.6, marginBottom:8 }}>
What stands out? What are you hearing yourself say?
</div>
<textarea
value={_reportNotes}
onChange={function(e){ var v=e.target.value; _setReportNotes(v); try{ localStorage.setItem(_notesKey, v); }catch(x){} }}
placeholder="Type here — your notes stay with this report."
style={{
width:"100%", minHeight:80, padding:"14px 16px",
fontSize:15, fontFamily:FD, fontStyle:"italic", color:"#5C4A3A",
lineHeight:1.7, background:"rgba(0,0,0,0.02)", border:"1px solid rgba(0,0,0,0.08)",
borderRadius:6, resize:"vertical", outline:"none",
boxSizing:"border-box"
}}
/>
{_reportNotes.trim() && (
<>
<div style={{ marginTop:16 }}>
<div style={{ fontSize:12, letterSpacing:"0.35em", color:"rgba(0,0,0,0.4)", fontFamily:FB, marginBottom:8 }}>Your notes</div>
<div style={{ fontSize:15, color:"#5C4A3A", fontFamily:FD, fontStyle:"italic", lineHeight:1.75, padding:"12px 16px", background:"rgba(92,74,58,0.06)", borderLeft:"3px solid rgba(92,74,58,0.35)", borderRadius:4, whiteSpace:"pre-wrap" }}>
{_reportNotes.trim()}
</div>
{!_notesSummary && (
<button
onClick={function(){
if (_notesSummarizing) return;
_setNotesSummarizing(true);
var userWords = [];
allSessions.forEach(function(s) {
if (s.corrections) Object.values(s.corrections).forEach(function(c){ if (typeof c==="string"&&c.trim()) userWords.push("\""+c.trim().slice(0,150)+"\""); });
if (s.mapResponses) Object.keys(s.mapResponses).forEach(function(k){ var mr=s.mapResponses[k]; if (mr&&mr.comment&&String(mr.comment).trim()) userWords.push("\""+String(mr.comment).trim().slice(0,150)+"\""); });
});
var reportExcerpt = "";
if (_report) {
reportExcerpt = "REPORT ONE-LINE: \"" + (_report.oneLineVerdict || "") + "\"\n";
(_report.sections||[]).slice(0,2).forEach(function(sec){ reportExcerpt += "SECTION " + (sec.title||"") + ": " + (sec.body||"").slice(0,200) + "...\n"; });
}
var p = "Someone wrote notes on their field report. Their notes:\n\n\"" + _reportNotes.trim() + "\"\n\n"
+ "EVIDENCE FROM SESSION (what the subject actually said — use ONLY these when grounding):\n" + (userWords.length ? userWords.slice(0,12).join("\n") : "(none recorded)") + "\n\n"
+ "REPORT EXCERPT (what the report said — use to trace claims):\n" + (reportExcerpt || "(none)") + "\n\n"
+ "RULES: 1) GROUND every claim. If you say something came from the session, quote it: 'In the session you said: \"...\"' 2) If their note questions something in the report (e.g. 'I don\'t recall saying that'), either find the quote that supports it in EVIDENCE above, or say 'I don\'t have a direct quote from your session that supports that' — do NOT philosophize about memory or imaginal cells. 3) Never invent. Only use what's in their notes + EVIDENCE + REPORT. 4) If uncertain, say so. 5) Optional: add a brief 'sources' line listing what you drew from (e.g. 'From your note + map comment on X–Y').\n"
+ "JSON: {\"summary\":\"2-4 sentences, grounded\", \"sources\":\"optional one line\"}";
callClaudeClient(p, "notes_summary", 220).then(function(r){
var d = parseJSON(r);
if (d && d.summary) {
var disp = d.summary;
if (d.sources && d.sources.trim()) disp += "\n\n— " + d.sources.trim();
_setNotesSummary(disp);
try{ localStorage.setItem(_notesKey+"-summary", disp); }catch(x){}
}
}).catch(function(){})
.finally(function(){ _setNotesSummarizing(false); });
}}
disabled={_notesSummarizing}
style={{ marginTop:12, padding:"10px 18px", fontSize:11, letterSpacing:"0.2em", fontFamily:FB, background:"rgba(0,0,0,0.06)", border:"1px solid rgba(0,0,0,0.12)", borderRadius:6, color:"rgba(0,0,0,0.6)", cursor:_notesSummarizing?"default":"pointer" }}>
{_notesSummarizing ? "Reflecting…" : "Reflect on my notes"}
</button>
)}
{_notesSummary && (
<div style={{ marginTop:16, padding:"14px 16px", background:"rgba(92,74,58,0.04)", borderLeft:"3px solid "+_accent, borderRadius:4 }}>
<div style={{ fontSize:12, letterSpacing:"0.35em", color:"rgba(0,0,0,0.4)", fontFamily:FB, marginBottom:8 }}>Reflection</div>
<div style={{ fontSize:15, color:"rgba(0,0,0,0.72)", fontFamily:FD, lineHeight:1.7 }}>
{_notesSummary}
</div>
</div>
)}
</div>
</>
)}
{_report && (
<button
disabled={_shareableLoading}
onClick={async function(){
_setShareableLoading(true);
try {
var thList = (themes || []).map(function(t,i){ return { label: (t&&t.label)||String(t), color: getThemeColor(t,i) }; });
var connList = [];
var mr = (currentSessionData && currentSessionData.mapResponses) ? currentSessionData.mapResponses : {};
Object.keys(mr).forEach(function(k){
var r = mr[k];
if (r && (r.value==="yes"||r.value==="partly") && r.from && r.to) connList.push({ from: r.from, to: r.to, insight: r.insight||r.comment||"" });
});
if (connList.length === 0 && sd.connections) connList = sd.connections.map(function(c){ return { from: c.from, to: c.to, insight: c.insight||"" }; });
var mapTitle = sd.map_title || sd.mapTitle || "";
var reportText = (_report.sections||[]).map(function(s){ return (s.title||"")+": "+(s.body||""); }).join("\n\n");
var rev = currentSessionData && currentSessionData.revisedSynthesis;
var synthesis = (rev ? (typeof rev==="string" ? rev : rev.synthesis) : sd.synthesis) || "";
synthesis = synthesis.slice(0,200);
var opening = (typeof sd.opening==="string" ? sd.opening : (sd.opening&&sd.opening.text) ? sd.opening.text : "").slice(0,120);
var clarity = (sd.clarity||(currentSessionData&&currentSessionData.clarity)||"").slice(0,100);
var prompt = "You are a world-leading linguist combined with Peter Thiel and Seth Godin. Write a shareable summary of this reflective session.\n\nVOICE: Precise. Punchy. Every word earns its place. Contrarian where useful. Memorable. Zero filler. Pull the 3-5 most salient points — what actually matters.\n\nINPUT:\n"+reportText+"\n\nSynthesis: "+synthesis+"\nOpening: "+opening+"\nClarity: "+clarity+"\nThemes: "+(thList.map(function(t){return t.label;}).join(", ")||"—")+"\nTension: "+(sd.tension&&sd.tension.a?sd.tension.a+" vs "+sd.tension.b:"—")+"\nMap: "+mapTitle+"\nConnections: "+(connList.map(function(c){return c.from+" ↔ "+c.to+(c.insight?" — "+c.insight.slice(0,60):"");}).join("; ")||"—")+"\n\nReturn JSON only: {\"hook\":\"One sentence that captures the essence. Makes the reader lean in. Not generic.\",\"bullets\":[\"Salient point 1\",\"Salient point 2\",\"Salient point 3\"]}\nMax 4 bullets. Each bullet max 25 words.";
var raw = await callClaudeClient(prompt, "shareable", 400);
var parsed = parseJSON(raw);
var hook = (parsed&&parsed.hook) ? String(parsed.hook).trim() : (_report.oneLineVerdict||"").trim();
var bullets = (parsed&&Array.isArray(parsed.bullets)&&parsed.bullets.length>0) ? parsed.bullets : [];
var n = thList.length;
var cx=50, cy=48, r=32;
var pts = [];
for(var i=0;i<n;i++){ var ang=(i/n)*2*Math.PI-Math.PI/2; pts.push({ x: cx+Math.cos(ang)*r, y: cy+Math.sin(ang)*r*0.85, label: thList[i].label, color: thList[i].color||THEME_COLORS[i%THEME_COLORS.length] }); }
var lineEls = "";
connList.forEach(function(c){
var a=pts.find(function(p){ return (p.label||"").toLowerCase()===(c.from||"").toLowerCase(); });
var b=pts.find(function(p){ return (p.label||"").toLowerCase()===(c.to||"").toLowerCase(); });
if(a&&b) lineEls += '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="rgba(0,0,0,0.2)" stroke-width="0.8"/>';
});
var circleEls = pts.map(function(p){ return '<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="'+p.color+'"/>'; }).join("");
var svg = n>0 ? '<svg viewBox="0 0 100 100" style="width:220px;height:220px;display:block;margin:20px auto"><g>'+lineEls+circleEls+'</g></svg>' : "";
var esc = function(s){ return (s||"").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };
var themeListHtml = thList.length>0 ? '<div style="margin:16px 0;padding:12px 0;border-top:1px solid rgba(0,0,0,0.08)"><div style="font-size:10px;letter-spacing:0.2em;color:#888;margin-bottom:8px">THEMES</div><div style="font-size:13px;line-height:1.6;color:#444">'+thList.map(function(t){return esc(t.label);}).join(" · ")+'</div></div>' : "";
var connListHtml = connList.length>0 ? '<div style="margin:16px 0;padding:12px 0;border-top:1px solid rgba(0,0,0,0.08)"><div style="font-size:10px;letter-spacing:0.2em;color:#888;margin-bottom:8px">CONNECTIONS</div><div style="font-size:12px;line-height:1.8;color:#555">'+connList.map(function(c){var ins = (c.insight||"").trim();return esc(c.from||"")+" ↔ "+esc(c.to||"")+(ins?"<br/><em style=\"font-size:11px;color:#777\">"+esc(ins.length>80?ins.slice(0,80)+"…":ins)+"</em>":"");}).join("<br/>")+'</div></div>' : "";
var bulletsHtml = bullets.length>0 ? '<ul style="margin:20px 0;padding-left:20px;font-size:14px;line-height:1.7;color:#444">'+bullets.map(function(b){return '<li>'+String(b).replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</li>';}).join("")+'</ul>' : "";
var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Summary</title><style>body{font-family:Georgia,serif;max-width:420px;margin:28px auto;padding:24px;color:#222;line-height:1.65;font-size:15px} h1{font-size:20px;margin-bottom:8px;font-weight:600;letter-spacing:-0.02em} .hook{font-size:17px;font-style:italic;color:#444;margin:16px 0;line-height:1.5} .map-label{text-align:center;font-size:11px;color:#999;margin-top:8px} @media print{body{padding:0;max-width:100%}}</style></head><body><h1>Session Summary</h1><p class="hook">'+(hook.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>"))+'</p>'+bulletsHtml+svg+'<div class="map-label">'+(mapTitle?mapTitle+" · ":"")+'SAYCRD · '+sessionCount+' session'+(sessionCount!==1?"s":"")+'</div>'+themeListHtml+connListHtml+'</body></html>';
var w = window.open("","_blank","width=500,height=720");
if(w){ w.document.write(html); w.document.close(); w.focus(); }
} catch(e) { console.warn("[SAYCRD] Shareable summary failed:", e); }
_setShareableLoading(false);
}}
style={{ marginTop:16, padding:"12px 20px", fontSize:12, letterSpacing:"0.2em", fontFamily:FB, background:_shareableLoading?"rgba(0,0,0,0.2)":_accent, color:"white", border:"none", borderRadius:8, cursor:_shareableLoading?"wait":"pointer", fontWeight:600 }}>
{_shareableLoading ? "Generating…" : "Create shareable summary"}
</button>
)}
</div>

<div style={{ marginBottom:20, padding:"14px 16px",
background:"rgba(0,0,0,0.03)", borderRadius:3 }}>
<div style={{ fontSize:12, color:"rgba(0,0,0,0.38)",
fontFamily:FB, lineHeight:1.7 }}>
This report is for personal insight and reflection only. It is not a clinical assessment, medical advice, or psychological diagnosis. Nothing here should be used to make health or treatment decisions. If you are experiencing mental health difficulties, please speak with a qualified professional.
</div>
</div>

<div style={{ paddingBottom:10, display:"flex",
justifyContent:"space-between", alignItems:"center" }}>
<div style={{ fontSize:12, letterSpacing:"0.35em",
color:"rgba(0,0,0,0.18)", fontWeight:600 }}>
END OF REPORT
</div>
<div style={{ display:"flex", gap:3, alignItems:"center" }}>
{Array.from({length:Math.min(sessionCount,24)}).map(function(_,di){
return (
<div key={di} style={{ width:4, height:4, borderRadius:"50%",
background: di===Math.min(sessionCount,24)-1
? _accent
: "rgba(0,0,0,"+(0.07+di*0.004)+")" }}/>
);
})}
</div>
</div>

</div>
) : (
<div style={{ paddingTop:48, textAlign:"center" }}>
<div style={{ fontSize:16, color:"rgba(0,0,0,0.3)", fontFamily:FD }}>
Report unavailable.
</div>
</div>
)}

<div style={{ height:28 }}/>

<div style={{ padding:"0 32px 40px", textAlign:"center" }}>
<div
onClick={function(){
var fade = document.createElement("div");
fade.style.cssText = "position:fixed;inset:0;background:#000;opacity:0;z-index:99999;transition:opacity 1.2s ease;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;";
fade.innerHTML = "<div style=\"font-family:serif;font-size:13px;letter-spacing:0.4em;color:rgba(255,255,255,0.25);opacity:0;transition:opacity 1s ease 0.6s\">SESSION COMPLETE</div>";
document.body.appendChild(fade);
requestAnimationFrame(function(){ fade.style.opacity="1"; fade.querySelector("div").style.opacity="1"; });
setTimeout(function(){ try{ window.close(); } catch(e){} }, 1400);
}}
style={{ display:"inline-block", fontSize:10, letterSpacing:"0.35em",
color:"rgba(0,0,0,0.2)", fontFamily:FB, cursor:"pointer",
padding:"10px 20px", borderTop:"1px solid rgba(0,0,0,0.08)",
transition:"color 0.2s" }}
onMouseEnter={function(e){ e.currentTarget.style.color="rgba(0,0,0,0.45)"; }}
onMouseLeave={function(e){ e.currentTarget.style.color="rgba(0,0,0,0.2)"; }}>
✕ CLOSE SESSION
</div>
</div>
</div>

</div>
);
}

function FieldPhase({ synthesisData, rawText, mapResponses, sessionData }) {
var sd = synthesisData || {};
var mr = mapResponses || {};
var sData = sessionData || {};
if (sData.corrections && Object.keys(sData.corrections).length > 0) {
sd = Object.assign({}, sd, {
corrections: sData.corrections,
revisedSynthesis: sData.revisedSynthesis || sd.synthesis,
sessionClarity: sData.clarity || "",
sessionReactions: sData.reactions || {},
});
}

var confirmedConns = [];
var insightMoments = [];
Object.keys(mr).forEach(function(connKey) {
var r = mr[connKey];
if (!r) return;
if (r.value === "yes" || r.value === "partly") {
var conn = { from: r.from || "", to: r.to || "", insight: r.insight || "", comment: r.comment || "", value: r.value };
confirmedConns.push(conn);
if (r.comment && r.comment.trim().length > 8) insightMoments.push(conn);
}
});
var featuredConn = insightMoments[0] || confirmedConns[0] || ((sd.connections && sd.connections.length > 0) ? sd.connections[0] : null);
var sReactions = sData.reactions || {};
var sCorrections = sData.corrections || {};
var revisedSynthesis = sData.revisedSynthesis || null;
var sSignals = sData.signals || {};

var themes = (sd.themes || []).map(function(t, i) { return { label: t.label, weight: t.weight || 1, color: t.color || NC[i % NC.length] }; });
var conns = sd.connections || [];
var tension = sd.tension || null;
var synthesis = sd.synthesis || "";
var underneath = sd.underneath || [];
var opening = sd.opening || "";
var archetypes = sd.archetypes || [];
var arrival = sd.arrival || null;
var alchemyData = sd.alchemy || null;
var blindSpot = sd.blind_spot || null;
var noticing = sd.noticing || "";

if (archetypes.length === 0 && themes.length > 0) {
var allText = (synthesis + " " + opening + " " + (underneath||[]).join(" ") + " " + (tension ? tension.text : "") + " " + (rawText||"").slice(0,500)).toLowerCase();
var archScores = [
{ key: "chrysalis", words: ["transform","change","becoming","dissolving","letting go","shift","shed","release"], title: "Something is dissolving", line: "What you were is making room for what you're becoming." },
{ key: "sisyphus", words: ["again","loop","repeat","cycle","stuck","same","keep","pattern","tired","push"], title: "The beautiful repetition", line: "What looks like going nowhere might be building the strength you need." },
{ key: "tower", words: ["fall","break","collapse","end","fail","shatter","crumble","lose","wrong"], title: "The necessary collapse", line: "What's falling apart was supposed to fall apart." },
{ key: "phoenix", words: ["fire","burn","rise","rebirth","ash","new","emerge","born","start over"], title: "Rising from the heat", line: "Something had to burn before this could exist." },
{ key: "hermit", words: ["alone","quiet","silence","solitude","withdraw","space","retreat","still"], title: "The lamp in the dark", line: "You stepped away to hear something." },
{ key: "threshold", words: ["door","choice","decide","leave","enter","between","edge","ready","step","next"], title: "Standing at the door", line: "You already know which side you belong on." },
{ key: "weaver", words: ["connect","thread","pattern","link","weave","together","relate","between","across"], title: "The threads are connecting", line: "What seemed separate is revealing itself as one pattern." },
{ key: "star", words: ["hope","light","small","gentle","quiet","tender","soft","okay","fine"], title: "Light after collapse", line: "Something survived that wasn't supposed to." },
];
archScores.forEach(function(arch) {
arch.score = 0;
arch.words.forEach(function(w) { if (allText.indexOf(w) >= 0) arch.score++; });
});
archScores.sort(function(a, b) { return b.score - a.score; });
archetypes = archScores[0].score > 0 ? [archScores[0]] : [{ key: "chrysalis", title: "Something is dissolving", line: "What you were is making room for what you're becoming." }];
}

var savedRef = useRef(false);
useEffect(function() { if (!savedRef.current && sd.themes) { savedRef.current = true; saveSession(Object.assign({}, sd, {
rawText: rawText,
archetypes: archetypes,
mapResponses: mr,
reactions: sReactions,
corrections: sCorrections,
revisedSynthesis: revisedSynthesis || null,
descent: sData.descent,
clarity: (sData.clarity || sd.sessionClarity || ""),
signals: sData.signals || null,
cardFeedback: (function() {
var fb = {};
Object.keys(sliderValues).forEach(function(k) {
fb[k] = Object.assign(fb[k] || {}, { slider: sliderValues[k] });
});
Object.keys(cardComments).forEach(function(k) {
if (cardComments[k] && cardComments[k].trim()) {
fb[k] = Object.assign(fb[k] || {}, { comment: cardComments[k].trim() });
}
});
return fb;
})()
})); } }, []);
var history = useMemo(function() { return getArchetypeHistory(); }, []);
var timeline = useMemo(function() { return getSessionTimeline(); }, []);
var sessionCount = timeline.length + 1;

var allSessions = loadSessions(); 
var currentSessionData = Object.assign({}, sd, {
mapResponses: mr,
descent: sData.descent,
clarity: sData.clarity || sd.sessionClarity || "",
reactions: sReactions,
corrections: sCorrections,
});
var prevSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;
var prevArch = prevSession && prevSession.archetypes && prevSession.archetypes[0]
? prevSession.archetypes[0] : null;

var themeRecurrence = {};
allSessions.forEach(function(s) {
var seen = {};
(s.themes || []).forEach(function(t) {
if (!seen[t.label]) { seen[t.label] = true; themeRecurrence[t.label] = (themeRecurrence[t.label] || 0) + 1; }
});
});
var themesClassified = themes.map(function(t) {
var count = themeRecurrence[t.label] || 0;
return Object.assign({}, t, {
sessions: count,
tier: count >= 3 ? "persistent" : count >= 2 ? "returning" : "new"
});
});
var hasPersistentThemes = themesClassified.some(function(t) { return t.tier === "persistent"; });
var hasReturningThemes = themesClassified.some(function(t) { return t.tier === "returning" || t.tier === "persistent"; });

var alchemyArc = allSessions.map(function(s) {
return { stage: s.alchemy ? s.alchemy.stage : null, date: s.date };
}).filter(function(a) { return a.stage; });

var lastSessionOpening = allSessions.length > 0 ? (allSessions[allSessions.length - 1].opening || "") : "";
var currentOpening = sd.opening || opening || "";

var currentTensionA = tension ? (tension.a || "").toLowerCase().trim() : "";
var currentTensionB = tension ? (tension.b || "").toLowerCase().trim() : "";
var tensionReturnCount = 0;
if (currentTensionA || currentTensionB) {
allSessions.forEach(function(s) {
if (!s.tension) return;
var pa = (s.tension.a || "").toLowerCase().trim();
var pb = (s.tension.b || "").toLowerCase().trim();
if ((pa && (pa === currentTensionA || pa === currentTensionB)) ||
(pb && (pb === currentTensionA || pb === currentTensionB))) {
tensionReturnCount++;
}
});
}

var words = (rawText || "").split(/\s+/).filter(Boolean);
var wordCount = words.length;
var uniqueWords = [...new Set(words.map(function(w) { return w.toLowerCase().replace(/[^a-z]/g, ""); }))].filter(function(w) { return w.length > 0; });
var firstWord = words[0] || "—";
var lastWord = words[words.length - 1] || "—";
var freq = {};
words.forEach(function(w) { var k = w.toLowerCase().replace(/[^a-z]/g, ""); if (k.length >= 4) freq[k] = (freq[k] || 0) + 1; });
var topWord = Object.keys(freq).sort(function(a, b) { return freq[b] - freq[a]; })[0] || "this";
var topWordCount = freq[topWord] || 0;
var strongConn = conns[0] || null;

var primaryArch = archetypes[0] ? Object.assign({ color: (themes[0] && themes[0].color) || "#E84393" }, archetypes[0]) : null;
var _regMatch = primaryArch ? ARCH_REGISTRY[primaryArch.key] : null;
var _archColor = (themes[0] && themes[0].color) || "#E84393";
var archReg = _regMatch || (primaryArch ? {
name: primaryArch.name || primaryArch.key || "Pattern",
icon: "◆",
color: _archColor,
bg: "linear-gradient(160deg, #1A0A2E 0%, #3D1D6B 40%, " + _archColor + " 100%)",
phases: null
} : null);
var alchStage = alchemyData ? (alchemyData.stage || "nigredo") : "nigredo";
var alchInfo = FIELD_ALCHEMY[alchStage] || FIELD_ALCHEMY.nigredo;
var alchColor = alchInfo.color || "#888";

var [archResponse, setArchResponse] = useState(null);
var [current, setCurrent] = useState(0);
var [clicked, setClicked] = useState(false);

var [portrait, setPortrait] = useState(null);
var [portraitReady, setPortraitReady] = useState(false);

useEffect(function() {
var cancelled = false;
(async function() {
try {
var sessCount = allSessions.length + 1;

var currBrief = "";
if (synthesis) currBrief += synthesis.slice(0,150) + "\n";
if (themes.length) currBrief += "themes:" + themes.map(function(t){return t.label;}).join(",") + "\n";
if (tension && tension.a) currBrief += "tension:" + tension.a + "vs" + tension.b + "\n";
if (blindSpot) currBrief += "blind:" + (typeof blindSpot==="string"?blindSpot:blindSpot.observation||"").slice(0,60) + "\n";
if (opening) currBrief += "open:" + (typeof opening==="string"?opening:opening.text||"").slice(0,60) + "\n";
if (archetypes[0]) currBrief += "arch:" + archetypes[0].name + "\n";
var corrections = sData.corrections || {};
var corrVoice = Object.values(corrections).filter(function(c){return typeof c==="string"&&c.length>4;}).slice(0,2);
if (corrVoice.length) currBrief += "said:" + corrVoice.join(";").slice(0,100) + "\n";
var arcBrief = allSessions.slice(-6).map(function(s, si) {
var parts = [];
var a = s.archetypes && s.archetypes[0];
if (a && a.name) parts.push("arch:"+a.name+(a.line?"('"+a.line.slice(0,60)+"')":""));
if (s.themes && s.themes[0]) parts.push("theme:"+s.themes.slice(0,2).map(function(t){return t.label;}).join(","));
if (s.tension && s.tension.a) parts.push("tension:"+s.tension.a+"vs"+s.tension.b);
if (typeof s.blind_spot==="string"&&s.blind_spot) parts.push("blind:"+s.blind_spot.slice(0,80));
if (typeof s.opening==="string"&&s.opening) parts.push("opening:"+s.opening.slice(0,80));
if (s.synthesis) parts.push("reading:"+s.synthesis.slice(0,120));
var sc = s.corrections ? Object.values(s.corrections).filter(function(c){return typeof c==="string"&&c.length>4;}).slice(0,1) : [];
if (sc.length) parts.push("said:"+sc[0].slice(0,80));
return "S"+(allSessions.length-6+si+1)+": "+parts.join(" | ");
}).join("\n");

var prevArchName = prevArch ? prevArch.name : "";

var p = "You are the most perceptive analyst this person has ever encountered.\n"
+ "You have access to their complete inner biography. You are going to generate\n"
+ "a rich portrait that will feed every card in their personal field.\n\n"
+ "TOTAL SESSIONS: " + sessCount + "\n"
+ "PREVIOUS ARCHETYPE: " + (prevArchName||"none") + "\n\n"
+ "=== CURRENT SESSION ===\n" + currBrief + "\n"
+ (arcBrief ? "=== RECENT ARC (last 6 sessions) ===\n" + arcBrief + "\n\n" : "\n")
+ "Generate a portrait with these specific fields. Be SPECIFIC to THIS person.\n"
+ "Nothing generic. If it could apply to anyone, rewrite it.\n"
+ "Use their actual words, their actual tensions, their specific archetype.\n\n"
+ "fieldCondition: 2-4 words — the atmospheric quality of their field RIGHT NOW. Specific. e.g. 'Tender and Searching' not 'Inner Journey'\n"
+ "undercurrent: 1 sentence (10-14 words) — what's running beneath everything this session. From THEIR words.\n"
+ "depths: 1 sentence (10-14 words) — what is JUST out of sight. The thing almost surfacing. From blind_spot + underneath.\n"
+ "growing: 1 sentence (8-12 words) — what life is reaching toward. From opening + arc.\n"
+ "mirrorShift: 1 sentence (10-15 words) — what SPECIFICALLY changed from previous session to this one. Concrete.\n"
+ "realmWitness: 1 sentence (10-14 words) — honoring WHERE they are in the larger journey. Sacred not therapeutic.\n"
+ "realmDeclaration: 3-6 words — the mythic truth of their current realm.\n"
+ "archetypeRecognition: 1 sentence (10-16 words) — what this person did internally that most people never do. Bold. Direct. Use 'You'.\n"
+ "archetypeShift: 3-5 words — what moved (if arch changed) or the power of staying.\n"
+ "question: the ONE question they have been living inside. 8-14 words. Should make them catch their breath.\n"
+ "toward: 4-7 words — what is pulling them forward across the whole arc.\n"
+ "pivotalLine: the single most piercing line from the entire synthesis. Their truth, precisely.\n"
+ 'JSON only — no markdown:\n{"fieldCondition":"...","undercurrent":"...","depths":"...","growing":"...","mirrorShift":"...","realmWitness":"...","realmDeclaration":"...","archetypeRecognition":"...","archetypeShift":"...","question":"...","toward":"...","pivotalLine":"..."}';

var rr = await callClaudeClient(p, "portrait", 600);
if (cancelled) return;
var dd = parseJSON(rr);
if (dd && dd.fieldCondition) {
setPortrait(dd);
}
} catch(e) {
console.warn("[SAYCRD] Portrait generation failed:", e);
} finally {
if (!cancelled) setPortraitReady(true);
}
})();
return function(){ cancelled = true; };
}, []);
var containerRef = useRef(null);
var [sliderValues, setSliderValues] = useState({});
function setSlider(key, v) { setSliderValues(function(prev) { return Object.assign({}, prev, {[key]: v}); }); }
var [cardComments, setCardComments] = useState({});
function setCardComment(key, text) { setCardComments(function(prev) { return Object.assign({}, prev, {[key]: text}); }); }
var [bookmarks, setBookmarks] = useState(function() { try { return JSON.parse(localStorage.getItem("saycrd-bookmarks")||"[]"); } catch(e) { return []; } });

function handleArchResponse(response) {
setArchResponse(response);
setClicked(true);
try {
var sessions = JSON.parse(localStorage.getItem(_sessionKey()) || "[]");
var last = sessions[sessions.length - 1];
if (last && primaryArch) { last.archetypeResponse = { key: primaryArch.key, response: response }; localStorage.setItem(_sessionKey(), JSON.stringify(sessions)); }
} catch(e) {}
}

var archColor = primaryArch ? (primaryArch.color || (themes[0] && themes[0].color) || "#E84393") : (themes[0] && themes[0].color) || "#E84393";
var CARDS = useMemo(function() {
var c = [];

var pastSessions = loadSessions();
var lastArch = null;
if (pastSessions.length > 0) {
var prev = pastSessions[pastSessions.length - 1];
if (prev.archetypes && prev.archetypes.length > 0) {
var pa = prev.archetypes[0];
lastArch = { name: pa.name || pa.key || "", line: pa.line || "" };
}
}
var currentArchName = (primaryArch && primaryArch.name) ? primaryArch.name : "";
var showEvolution = lastArch && lastArch.name && lastArch.name !== currentArchName;

var archColor = primaryArch ? (primaryArch.color || (themes[0] && themes[0].color) || "#E84393") : "#E84393";
var posterBg = "linear-gradient(160deg, #06040E 0%, " + hexDarken(archColor, 0.14) + " 45%, " + hexDarken(archColor, 0.22) + " 100%)";

if ([3, 10, 20, 50].indexOf(sessionCount) >= 0) {
c.push({ type: "milestone", bg: "#0A0618", milestone: sessionCount });
}
c.push({ type: "field_condition", bg: "#030308" });
c.push({ type: "arch_billboard", bg: "#030308" });
c.push({ type: "depths_field", bg: "#010810" });
if (sessionCount >= 2) {
c.push({ type: "whats_growing", bg: "#010A04" });
c.push({ type: "the_mirror", bg: "#08080C" });
c.push({ type: "the_realm", bg: "#04020A" });
c.push({ type: "inner_wrapped", bg: "#0A0618" });
c.push({ type: "map_evolution", bg: "#040810" });
}
c.push({ type: "year_review", bg: "#060606" });
c.push({ type: "field_report", bg: "#FAFAF8" });
return c;
}, [archResponse, tension, underneath.length, primaryArch, blindSpot, strongConn, topWordCount, themes.length, sessionCount]);

var card = CARDS[current];

var advance = function() {
if (card && card.interactive && !clicked) { setClicked(true); return; }
if (current < CARDS.length - 1) { setCurrent(function(c) { return c + 1; }); setClicked(false); }
};
var goBack = function() { if (current > 0) { setCurrent(function(c) { return c - 1; }); setClicked(false); } };
var handleClick = function(e) {
if (e.target.closest && (e.target.closest("button") || e.target.closest("[data-noadvance]") || e.target.tagName === "circle" || e.target.tagName === "svg")) return;
var rect = containerRef.current ? containerRef.current.getBoundingClientRect() : null;
if (!rect) return;
var x = (e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0)) - rect.left;
x < rect.width * 0.25 ? goBack() : advance();
};
useEffect(function() {
var handler = function(e) { if (e.key === "ArrowRight" || e.key === " ") advance(); else if (e.key === "ArrowLeft") goBack(); };
window.addEventListener("keydown", handler);
return function() { window.removeEventListener("keydown", handler); };
}, [current, clicked, CARDS.length]);

var renderCard = function() {
switch (card.type) {

case "milestone": {
return <MilestoneCard sessionCount={sessionCount} milestone={card.milestone} goNext={advance}/>;
}
case "field_condition": {
return <FieldConditionCard themes={themes} sd={sd} primaryArch={primaryArch} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "arch_billboard": {
return <ArchBillboardCard themes={themes} sd={sd} primaryArch={primaryArch} archColor={archColor} sessionCount={sessionCount} prevArch={prevArch} allSessions={allSessions} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "depths_field": {
return <DepthsFieldCard themes={themes} sd={sd} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "whats_growing": {
return <WhatsGrowingCard themes={themes} sd={sd} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}

case "the_mirror": {
return <MirrorCard themes={themes} sd={sd} sessionCount={sessionCount} rawText={rawText} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "the_realm": {
return <RealmCard themes={themes} sd={sd} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "inner_wrapped": {
return <InnerWrappedCard themes={themes} sd={sd} sessionCount={sessionCount} goNext={advance}/>;
}
case "map_evolution": {
return <MapEvolutionCard themes={themes} sd={sd} sessionCount={sessionCount} allSessions={allSessions} currentSessionData={currentSessionData} goNext={advance}/>;
}
case "year_review": {
return <YearReviewCard themes={themes} sd={sd} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "field_report": {
return <FieldReportCard themes={themes} sd={sd} sessionCount={sessionCount} allSessions={allSessions} currentSessionData={currentSessionData} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "the_underdrawing": {
return <UnderdrawingCard themes={themes} sd={sd} sessionCount={sessionCount} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "the_landscape": {
return <LandscapeCard themes={themes} sd={sd} sessionCount={sessionCount} primaryArch={primaryArch} archReg={archReg} portrait={portrait} portraitReady={portraitReady} goNext={advance}/>;
}
case "archetype_poster": {
var ap = primaryArch || {};
var apName = ap.name || ap.title || "Your Pattern";
var apLine = ap.line || "";
var apColor = ap.color || (themes[0] && themes[0].color) || "#E84393";
var apSources = ap.source_nodes || [];
var apLastArch = card.lastArch;
var apShowEvol = card.showEvolution;
var apHero = apName.replace(/^The\s+/i, "").toUpperCase();
var apThe = apName.match(/^The\s+/i) ? "THE" : "";
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 28px 50px", overflow:"hidden" }}>
<FieldParticles color={apColor} count={22}/>
<div style={{ position:"absolute", top:"30%", left:"50%", transform:"translateX(-50%)", width:300, height:300, borderRadius:"50%", background:"radial-gradient(circle, "+apColor+"18, transparent 70%)", filter:"blur(50px)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", top:48, left:28, fontSize:9, letterSpacing:"0.35em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase" }}>
{sessionCount > 1 ? "SESSION "+sessionCount : "FIRST SESSION"}
</div>
{apShowEvol && apLastArch && (
<div style={{ position:"absolute", top:48, right:28, fontSize:9, letterSpacing:"0.12em", color:apColor+"66", fontFamily:FB, textAlign:"right" }}>
evolving from<br/><span style={{ color:apColor+"99" }}>{apLastArch.name}</span>
</div>
)}
<div style={{ animation:"riseUp 0.9s ease both", marginBottom:8 }}>
<ArchGlyph name={apName} color={apColor} size={150}/>
</div>
{apThe && <div style={{ fontSize:11, letterSpacing:"0.55em", color:apColor+"66", fontFamily:FB, marginBottom:4, animation:"riseUp 0.8s ease 0.15s both" }}>{apThe}</div>}
<div style={{ fontSize: apHero.length > 16 ? 26 : apHero.length > 12 ? 34 : apHero.length > 8 ? 40 : 48, fontWeight:700, color:"white", fontFamily:FB, letterSpacing:"0.06em", textAlign:"center", lineHeight:1.1, animation:"riseUp 0.8s ease 0.25s both", textShadow:"0 0 60px "+apColor+"44", maxWidth:"100%", paddingLeft:20, paddingRight:20, boxSizing:"border-box", whiteSpace:"nowrap" }}>
{apHero}
</div>
{apLine && <div style={{ marginTop:14, fontSize:16, color:"rgba(255,255,255,0.5)", fontFamily:FD, fontStyle:"italic", textAlign:"center", maxWidth:290, lineHeight:1.65, animation:"riseUp 0.8s ease 0.4s both" }}>
{apLine}
</div>}
{apSources.length > 0 && (
<div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"center", marginTop:22, animation:"riseUp 0.7s ease 0.6s both" }}>
{apSources.slice(0,3).map(function(src, si) {
return <div key={si} style={{ fontSize:10, color:apColor+"aa", fontFamily:FB, letterSpacing:"0.08em", padding:"4px 10px", borderRadius:12, border:"1px solid "+apColor+"22", background:apColor+"0A" }}>{src}</div>;
})}
</div>
)}
<div style={{ position:"absolute", bottom:32, fontSize:11, color:"rgba(255,255,255,0.12)", fontFamily:FB, letterSpacing:"0.2em" }}>tap to continue →</div>
</div>
);
}

case "arch_evolution": {
var ev = card.lastArch;
var evCur = primaryArch || {};
var evCurName = evCur.name || "Your Pattern";
var evCurColor = evCur.color || (themes[0] && themes[0].color) || "#E84393";
var evPastColor = "#888890";
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 28px", overflow:"hidden" }}>
<FieldParticles color={evCurColor} count={14}/>
<div style={{ fontSize:10, letterSpacing:"0.4em", color:"rgba(255,255,255,0.2)", fontFamily:FB, marginBottom:32, textTransform:"uppercase", animation:"riseUp 0.6s ease both" }}>what shifted</div>
<div style={{ display:"flex", alignItems:"center", gap:24, width:"100%", justifyContent:"center", animation:"riseUp 0.8s ease 0.1s both" }}>
<div style={{ textAlign:"center", flex:1, opacity:0.55 }}>
<ArchGlyph name={ev ? ev.name : ""} color={evPastColor} size={90}/>
<div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.2em", marginTop:10, textTransform:"uppercase" }}>was</div>
<div style={{ fontSize:15, color:"rgba(255,255,255,0.4)", fontFamily:FB, fontWeight:600, marginTop:4 }}>{ev ? ev.name : ""}</div>
{ev && ev.line && <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:FD, fontStyle:"italic", marginTop:5, lineHeight:1.5 }}>{ev.line.slice(0,60)}{ev.line.length>60?"…":""}</div>}
</div>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
<div style={{ width:2, height:40, background:"linear-gradient(180deg, rgba(255,255,255,0.06), "+evCurColor+"55)" }}/>
<div style={{ fontSize:18, color:evCurColor, opacity:0.7 }}>↓</div>
</div>
<div style={{ textAlign:"center", flex:1 }}>
<ArchGlyph name={evCurName} color={evCurColor} size={110}/>
<div style={{ fontSize:10, color:evCurColor+"88", fontFamily:FB, letterSpacing:"0.2em", marginTop:10, textTransform:"uppercase" }}>now</div>
<div style={{ fontSize:(evCurName.length>14?14:evCurName.length>10?15:17), color:"rgba(255,255,255,0.85)", fontFamily:FB, fontWeight:700, marginTop:4, whiteSpace:"nowrap" }}>{evCurName}</div>
{evCur.line && <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontFamily:FD, fontStyle:"italic", marginTop:5, lineHeight:1.5 }}>{evCur.line.slice(0,60)}{evCur.line.length>60?"…":""}</div>}
</div>
</div>
{sd.synthesis && (
<div style={{ marginTop:32, fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:FD, fontStyle:"italic", textAlign:"center", maxWidth:290, lineHeight:1.7, animation:"riseUp 0.8s ease 0.5s both" }}>
{sd.synthesis.slice(0,120)}{sd.synthesis.length>120?"…":""}
</div>
)}
</div>
);
}

case "live_tension": {
var lt = card.conn || {};
var ltA = lt.from || ""; var ltB = lt.to || "";
var ltInsight = lt.comment && lt.comment.trim().length > 8 ? lt.comment.trim() : lt.insight || "";
var ltUser = lt.comment && lt.comment.trim().length > 8; 
var ltColA = card.colA || "#E84393"; var ltColB = card.colB || "#6BB8FF";
var ltArchName = card.archName || ""; var ltArchLine = card.archLine || "";
var ltArchColor = card.archColor || ltColA;
var ltIsInsight = card.isInsight;
var ltSv = sliderValues.live_tension !== undefined ? sliderValues.live_tension : 50;
var ltAlive = ltSv >= 68; var ltAway = ltSv <= 32;


var axisLabel = lt.value === "partly" ? "in tension with" : "connected to";

var surpriseQs = [
"What does " + ltA + " need from " + ltB + " that it hasn't asked for yet?",
"If " + ltA + " and " + ltB + " switched places for a day — what breaks?",
"What would it cost to fully separate " + ltA + " from " + ltB + "?",
"Which one is protecting the other?",
"What do " + ltA + " and " + ltB + " have in common that you haven't named yet?",
];
var surpriseQ = surpriseQs[(ltA.length + ltB.length) % surpriseQs.length];

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden" }}>
<div style={{ position:"absolute", top:"20%", left:"10%", width:260, height:260, borderRadius:"50%", background:"radial-gradient(circle, "+ltColA+"1A, transparent 65%)", filter:"blur(60px)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", bottom:"15%", right:"8%", width:240, height:240, borderRadius:"50%", background:"radial-gradient(circle, "+ltColB+"18, transparent 65%)", filter:"blur(60px)", pointerEvents:"none" }}/>
<FieldParticles color={ltAlive ? ltColA : "rgba(255,255,255,0.3)"} count={ltAlive ? 18 : 10}/>

<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", padding:"52px 26px 24px", overflowY:"auto" }}>

<div style={{ fontSize:9, letterSpacing:"0.45em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:28, animation:"riseUp 0.6s ease both" }}>
{ltUser ? "YOUR INSIGHT" : "THE CONNECTION"}
</div>

<div style={{ display:"flex", alignItems:"center", width:"100%", maxWidth:340, gap:0, animation:"riseUp 0.7s ease 0.1s both" }}>
<div style={{ flex:1, padding:"14px 16px", borderRadius:16, background:ltColA+"18", border:"1.5px solid "+ltColA+"44", textAlign:"center", minWidth:0 }}>
<div style={{ fontSize:(ltA.length>14?12:ltA.length>10?13:15), color:"rgba(255,255,255,0.9)", fontFamily:FB, fontWeight:700, lineHeight:1.3, whiteSpace:"nowrap" }}>{ltA}</div>
</div>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", minWidth:54, gap:4 }}>
<div style={{ width:2, height:20, background:"linear-gradient(180deg,"+ltColA+"66, "+ltColB+"66)" }}/>
<div style={{ fontSize:8, color:"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase", textAlign:"center", lineHeight:1.4 }}>{axisLabel}</div>
<div style={{ width:2, height:20, background:"linear-gradient(180deg,"+ltColA+"66, "+ltColB+"66)" }}/>
</div>
<div style={{ flex:1, padding:"14px 16px", borderRadius:16, background:ltColB+"18", border:"1.5px solid "+ltColB+"44", textAlign:"center", minWidth:0 }}>
<div style={{ fontSize:(ltB.length>14?12:ltB.length>10?13:15), color:"rgba(255,255,255,0.9)", fontFamily:FB, fontWeight:700, lineHeight:1.3, whiteSpace:"nowrap" }}>{ltB}</div>
</div>
</div>

{ltInsight && (
<div style={{ marginTop:22, fontSize:ltInsight.length > 80 ? 17 : 21, color: ltAlive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.72)", fontFamily:FD, fontStyle:"italic", lineHeight:1.7, textAlign:"center", maxWidth:310, animation:"riseUp 0.8s ease 0.25s both", transition:"color 0.4s", textShadow: ltAlive ? "0 0 40px "+ltColA+"33" : "none" }}>
{ltUser && <span style={{ fontSize:10, color:ltColA+"99", fontFamily:FB, letterSpacing:"0.15em", display:"block", marginBottom:8, textTransform:"uppercase", fontStyle:"normal" }}>you said ↓</span>}
"{ltInsight}"
</div>
)}

{!ltAway && (
<div style={{ marginTop:20, padding:"14px 18px", borderRadius:16, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", maxWidth:310, animation:"riseUp 0.8s ease 0.45s both" }}>
<div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.18em", marginBottom:8, textTransform:"uppercase" }}>to sit with</div>
<div style={{ fontSize:15, color: ltAlive ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.5)", fontFamily:FD, lineHeight:1.65, transition:"color 0.4s" }}>
{surpriseQ}
</div>
</div>
)}

{ltArchName && (ltA.length > 0 || ltB.length > 0) && !ltAway && (
<div style={{ marginTop:16, display:"flex", alignItems:"center", gap:10, animation:"riseUp 0.7s ease 0.6s both", opacity:0.7 }}>
<ArchGlyph name={ltArchName} color={ltArchColor} size={36}/>
<div>
<div style={{ fontSize:9, color:ltArchColor+"88", fontFamily:FB, letterSpacing:"0.2em", textTransform:"uppercase" }}>{ltArchName}</div>
{ltArchLine && <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:FD, fontStyle:"italic", marginTop:2, lineHeight:1.5, maxWidth:220 }}>{ltArchLine}</div>}
</div>
</div>
)}

<div style={{ width:"100%", maxWidth:320, marginTop:20, animation:"riseUp 0.7s ease 0.7s both" }} data-noadvance="true">
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
<span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.1em" }}>PUSHING AWAY</span>
<span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.1em" }}>LANDS</span>
</div>
<div style={{ position:"relative", height:6, background:"rgba(255,255,255,0.07)", borderRadius:3, cursor:"pointer" }}
onPointerDown={function(e) {
e.stopPropagation();
var rect = e.currentTarget.getBoundingClientRect();
var pct = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
setSlider("live_tension", pct);
var move = function(ev) {
var p = Math.round(Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100)));
setSlider("live_tension", p);
};
var up = function() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
window.addEventListener("pointermove", move);
window.addEventListener("pointerup", up);
}}>
<div style={{ position:"absolute", left:0, top:0, height:"100%", width:ltSv+"%", background:"linear-gradient(90deg,"+ltColA+"66,"+ltColB+")", borderRadius:3, transition:"width 0.15s", boxShadow: ltAlive ? "0 0 10px "+ltColB+"55" : "none" }}/>
<div style={{ position:"absolute", top:"50%", left:ltSv+"%", transform:"translate(-50%,-50%)", width:16, height:16, borderRadius:"50%", background: ltAlive ? ltColB : "rgba(255,255,255,0.4)", border:"2px solid rgba(255,255,255,0.6)", transition:"left 0.15s, background 0.3s", boxShadow: ltAlive ? "0 0 8px "+ltColB : "none" }}/>
</div>
{ltAway && <div style={{ marginTop:10, fontSize:12, color:"rgba(255,255,255,0.4)", fontFamily:FB, textAlign:"center" }}>tap → to keep moving</div>}
</div>

</div>
</div>
);
}

case "arrival": return (
<FC><FieldParticles color="#E84393" count={28} />
<div style={{ fontSize: 11, letterSpacing: "0.4em", color: "rgba(255,255,255,0.2)", fontFamily: FB, marginBottom: 40, animation: "riseUp 0.8s ease both" }}>
{sessionCount > 1 ? "SESSION " + sessionCount : "THIS SESSION"}
</div>
<FHero size={48} color="white">{arrival ? arrival.line : "Your\nField"}</FHero>
{arrival && arrival.energy && <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 10, animation: "riseUp 1s ease 0.5s both" }}>
<div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E84393", boxShadow: "0 0 14px rgba(232,67,147,0.5)" }} />
<span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", fontFamily: FB, letterSpacing: "0.2em", textTransform: "uppercase" }}>{arrival.energy}</span>
</div>}
{archetypes.length > 0 && archReg && <div style={{ display: "flex", gap: 10, marginTop: 36, flexWrap: "wrap", justifyContent: "center", animation: "riseUp 0.8s ease 0.8s both" }}>
<div style={{ padding: "6px 16px", borderRadius: 20, background: archReg.color + "14", border: "1px solid " + archReg.color + "30", fontSize: 12, color: archReg.color + "cc", fontFamily: FB }}>{archReg.icon} {archReg.name}</div>
</div>}
<div style={{ marginTop: 48, fontSize: 12, color: "rgba(255,255,255,0.15)", fontFamily: FB }}>tap to begin →</div>
</FC>
);

case "words": {
var txt = (rawText || "").toLowerCase();
var tones = [
{ key:"doubt", label:"Doubt", color:"#6BB8FF", words:["maybe","unsure","wonder","question","not sure","unclear","confused","doubt","uncertain","hesit"] },
{ key:"clarity", label:"Clarity", color:"#6BFFB8", words:["clear","understand","realize","see now","know","certain","obvious","makes sense","finally"] },
{ key:"optimism", label:"Optimism", color:"#FFD700", words:["hope","better","possible","excited","looking forward","believe","will","can","going to","good"] },
{ key:"frustration", label:"Frustration", color:"#FF6B9D", words:["frustrated","stuck","again","why","tired","enough","over it","annoyed","keeps","always","never"] },
{ key:"curiosity", label:"Curiosity", color:"#B86BFF", words:["curious","wonder","what if","interesting","explore","discover","notice","find","question","how"] },
{ key:"urgency", label:"Urgency", color:"#FFB86B", words:["need","must","now","urgent","soon","time","quickly","asap","before","deadline","running out"] },
];
var scored = tones.map(function(t) {
var score = 0; t.words.forEach(function(w) { var re = new RegExp(w,"g"); var m = txt.match(re); if(m) score += m.length; }); return Object.assign({},t,{score});
}).filter(function(t) { return t.score > 0; }).sort(function(a,b) { return b.score-a.score; }).slice(0,4);
if (scored.length === 0) {
var energy = (arrival && arrival.energy) || "restless";
var energyMap = { heavy:"frustration", electric:"urgency", shattered:"doubt", still:"clarity", quiet:"clarity", warm:"optimism", grounded:"clarity", restless:"urgency", tender:"curiosity", fierce:"urgency" };
var fallbackKey = energyMap[energy] || "curiosity";
scored = [tones.find(function(t){return t.key===fallbackKey;})||tones[4]];
}
var maxScore = scored[0].score || 1;
return (
<FC><FieldParticles color="#6BFFB8" count={20} />
<FLabel color="#6BFFB8">YOU POURED</FLabel>
<div style={{ fontSize: wordCount > 999 ? 90 : 116, fontWeight: 300, color: "white", lineHeight: 1, fontFamily: FD, letterSpacing: "-0.04em", animation: "riseUp 0.6s ease both" }}>{wordCount.toLocaleString()}</div>
<div style={{ fontSize: 18, color: "rgba(255,255,255,0.6)", fontFamily: FB, marginBottom: 32, animation: "riseUp 0.6s ease 0.2s both" }}>words</div>
<div style={{ width:"100%", maxWidth:290, display:"flex", flexDirection:"column", gap:10, animation:"riseUp 0.7s ease 0.4s both" }}>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:FB, letterSpacing:"0.18em", textTransform:"uppercase", marginBottom:4 }}>What came through</div>
{scored.map(function(t, i) {
var pct = Math.min(100, Math.round((t.score / maxScore) * 100));
return <div key={t.key} style={{ animation:"riseUp 0.5s ease "+(0.45+i*0.12)+"s both" }}>
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
<span style={{ fontSize:16, color:"rgba(255,255,255,0.88)", fontFamily:FB, fontWeight:600 }}>{t.label}</span>
<span style={{ fontSize:13, color:t.color, fontFamily:FB }}>{pct}%</span>
</div>
<div style={{ height:6, background:"rgba(255,255,255,0.07)", borderRadius:3, overflow:"hidden" }}>
<div style={{ width:pct+"%", height:"100%", background:"linear-gradient(90deg,"+t.color+"55,"+t.color+")", borderRadius:3, animation:"growWidth 0.9s ease "+(0.5+i*0.15)+"s both", boxShadow:"0 0 8px "+t.color+"44" }} />
</div>
</div>;
})}
</div>
</FC>
);
}

case "top_themes": return (
<FC><FieldParticles color="#FF6B9D" count={14} />
<FLabel color="#FF6B9D">YOUR FORCES</FLabel>
<div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 310 }}>
{themes.slice(0, 5).map(function(t, i) {
var pct = Math.min(100, Math.round((t.weight / 5) * 100));
return <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, animation: "riseUp 0.5s ease " + (i * 0.12) + "s both" }}>
<span style={{ fontSize: 26, color: t.color, fontFamily: FD, fontWeight: 700, width: 28, textAlign: "right" }}>{i + 1}</span>
<div style={{ flex: 1 }}>
<span style={{ fontSize: 21, color: "white", fontFamily: FB, fontWeight: 600 }}>{t.label}</span>
<div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
<div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg, " + t.color + "55, " + t.color + ")", borderRadius: 3, animation: "growWidth 1s ease " + (i * 0.15) + "s both" }} />
</div>
</div>
</div>;
})}
</div>
</FC>
);

case "synthesis": {
var sv = sliderValues.synthesis !== undefined ? sliderValues.synthesis : 50;
var alive = sv >= 68; var away = sv <= 32;
return (
<BookmarkableCard text={synthesis} label="The Reading" color="#D6B26D">
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
alignItems:"center", justifyContent:"center", padding:"60px 28px 80px",
transition:"opacity 0.5s", opacity: away ? 0.55 : 1 }}>
<FieldParticles color={alive ? "#E8B84E" : "#D6B26D"} count={alive ? 20 : 8} />
<FLabel color="#D6B26D">THE READING</FLabel>
<div style={{ fontSize:22, color: alive ? "white" : "rgba(255,255,255,0.85)",
fontFamily:FD, lineHeight:1.65, textAlign:"center", maxWidth:320,
animation:"riseUp 0.8s ease both",
textShadow: alive ? "0 0 40px rgba(232,184,78,0.25)" : "none",
transition:"text-shadow 0.5s, color 0.3s" }}>
{synthesis || "Something is moving underneath your words."}
</div>
{alive && <div style={{ position:"absolute", inset:20, borderRadius:20,
border:"1px solid rgba(232,184,78,0.18)", pointerEvents:"none",
animation:"riseUp 0.4s ease both" }} />}
{noticing && !away && <div style={{ marginTop:24, padding:"12px 18px", borderRadius:12,
background:"rgba(214,178,109,0.07)", border:"1px solid rgba(214,178,109,0.15)",
maxWidth:290, animation:"riseUp 0.8s ease 0.5s both" }}>
<div style={{ fontSize:14, color:"rgba(255,200,120,0.8)", fontFamily:FB, lineHeight:1.65 }}>✦ {noticing}</div>
</div>}
{away && <div style={{ marginTop:24, fontSize:14, color:"rgba(255,255,255,0.55)", fontFamily:FB, animation:"riseUp 0.5s ease both" }}>didn't land — keep moving</div>}
<AccuracySlider value={sv} onSlide={function(v){setSlider("synthesis",v);}} color="#D6B26D" leftLabel="doesn't fit" rightLabel="exactly this" />
</div>
</BookmarkableCard>
);
}

case "bigword": {
var bwSv = sliderValues.bigword !== undefined ? sliderValues.bigword : 50;
var bwAlive = bwSv >= 68;
var bwQuestions = [
"What does "+topWord+" want from you right now?",
"Every time you wrote "+topWord+", something needed to be named. What is it?",
"You reached for "+topWord+" "+topWordCount+" times. What does it carry?",
"The word "+topWord+" showed up repeatedly. Is it a craving, or a weight?",
];
var bwQ = bwQuestions[topWordCount % bwQuestions.length];
return (
<FC><FieldParticles color={bwAlive ? "#A8E8DA" : "#7ECABA"} count={bwAlive ? 24 : 14} />
<FLabel color="#7ECABA">HIDDEN PATTERN</FLabel>
<div style={{ fontSize:14, color:"rgba(255,255,255,0.65)", fontFamily:FB, marginBottom:8, animation:"riseUp 0.6s ease both" }}>you wrote the word</div>
<div style={{ fontSize:52, color: bwAlive ? "#A8E8DA" : "#7ECABA", fontFamily:FD, animation:"riseUp 0.7s ease 0.2s both", letterSpacing:"-0.01em",
textShadow: bwAlive ? "0 0 50px rgba(126,202,186,0.5)" : "none", transition:"all 0.4s" }}>{topWord}</div>
<div style={{ fontSize:100, fontWeight:300, color:"white", lineHeight:1, fontFamily:FD, animation:"riseUp 0.8s ease 0.3s both" }}>{topWordCount}</div>
<div style={{ fontSize:16, color:"rgba(255,255,255,0.55)", fontFamily:FB, animation:"riseUp 0.6s ease 0.45s both", marginBottom:4 }}>times</div>
<div style={{ marginTop:16, fontSize:15, color:"rgba(126,202,186,0.8)", fontFamily:FD, maxWidth:280, textAlign:"center", lineHeight:1.65, animation:"riseUp 0.8s ease 0.9s both" }}>
{bwQ}
</div>
<AccuracySlider value={bwSv} onSlide={function(v){setSlider("bigword",v);}} color="#7ECABA" leftLabel="coincidence" rightLabel="significant" />
</FC>
);
}

case "connection": {
var cSv = sliderValues.connection !== undefined ? sliderValues.connection : 50;
var cAlive = cSv >= 68; var cAway = cSv <= 32;
var fromColor = (themes.find(function(t){return t.label===strongConn?.from;}))||{color:"#FFB86B"};
var toColor = (themes.find(function(t){return t.label===strongConn?.to;}))||{color:"#6BB8FF"};
return (
<FC><FieldParticles color={cAlive ? "#9DCFFF" : "#6BB8FF"} count={cAlive ? 22 : 12} />
<FLabel color="#6BB8FF">THE LINK</FLabel>
{strongConn && <>
<div style={{ display:"flex", alignItems:"center", gap:14, margin:"16px 0", animation:"riseUp 0.7s ease 0.1s both",
filter: cAway ? "opacity(0.4)" : "none", transition:"filter 0.4s" }}>
<FOrb color={fromColor.color}>{(strongConn.from||"").length>10?strongConn.from.slice(0,9)+"…":strongConn.from}</FOrb>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
<div style={{ width: cAlive ? 64 : 44, height: cAlive ? 3 : 2, background:"linear-gradient(90deg,"+fromColor.color+","+toColor.color+")",
boxShadow: cAlive ? "0 0 12px rgba(107,184,255,0.4)" : "none", transition:"all 0.4s" }} />
<span style={{ fontSize:(strongConn.label.length>12?9:strongConn.label.length>8?10:11), color:"rgba(255,255,255,0.55)", fontFamily:FB, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", whiteSpace:"nowrap" }}>{strongConn.label}</span>
</div>
<FOrb color={toColor.color}>{(strongConn.to||"").length>10?strongConn.to.slice(0,9)+"…":strongConn.to}</FOrb>
</div>
<div style={{ fontSize:19, color: cAlive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.72)", fontFamily:FD, maxWidth:290, lineHeight:1.65, animation:"riseUp 0.8s ease 0.35s both",
textShadow: cAlive ? "0 0 30px rgba(107,184,255,0.3)" : "none", transition:"all 0.4s" }}>{strongConn.insight}</div>
{cAlive && <div style={{ marginTop:12, fontSize:14, color:"rgba(107,184,255,0.7)", fontFamily:FB, animation:"riseUp 0.5s ease both" }}>What does this connection ask of you?</div>}
{cAway && <div style={{ marginTop:12, fontSize:14, color:"rgba(255,255,255,0.5)", fontFamily:FB, animation:"riseUp 0.5s ease both" }}>Not quite — explore the map to find the link that does fit.</div>}
</>}
<AccuracySlider value={cSv} onSlide={function(v){setSlider("connection",v);}} color="#6BB8FF" leftLabel="forced" rightLabel="I see it" />
</FC>
);
}

case "tension": {
var tA = tension ? tension.a : "one force";
var tB = tension ? tension.b : "another";
var tText = tension ? tension.text : "";
var tSv = sliderValues.tension !== undefined ? sliderValues.tension : 50;
var tAlive = tSv >= 68; var tAway = tSv <= 32;
var tQuestions = [
"What would it cost you to stop managing this tension?",
"Which side are you secretly on?",
"What if the tension IS the answer — not a problem to solve?",
"Who taught you these two things couldn't coexist?",
];
var tQ = tQuestions[(tA+tB).length % tQuestions.length];
var tStack = (String(tA).length > 18 || String(tB).length > 18);
return <div style={{ position:"absolute", inset:0, minHeight:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", padding:"52px 28px 28px", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
<FLabel color="#6BB8FF">YOUR TENSION</FLabel>
<div style={{ display:"flex", flexDirection: tStack ? "column" : "row", justifyContent:"space-between", gap:12, width:"100%", maxWidth:340, marginBottom:4, animation:"riseUp 0.6s ease both" }}>
<div style={{ flex:1, textAlign:"center", padding:"14px 12px", borderRadius:14, background:"rgba(255,128,128,0.1)", border:"1px solid rgba(255,128,128,0.2)", fontSize:(String(tA).length>14?16:String(tA).length>10?18:20), color:"#FF8080", fontFamily:FD, fontWeight:600, whiteSpace:"nowrap" }}>{tA}</div>
<div style={{ flex:1, textAlign:"center", padding:"14px 12px", borderRadius:14, background:"rgba(107,197,255,0.1)", border:"1px solid rgba(107,197,255,0.2)", fontSize:(String(tB).length>14?16:String(tB).length>10?18:20), color:"#6BC5FF", fontFamily:FD, fontWeight:600, whiteSpace:"nowrap" }}>{tB}</div>
</div>
<TensionPull clicked={clicked} />
{!clicked
? <div onClick={function(e){e.stopPropagation();setClicked(true);}} style={{ marginTop:8, fontSize:14, color:"rgba(107,184,255,0.8)", fontFamily:FB, letterSpacing:"0.08em", cursor:"pointer", padding:"10px 20px", border:"1px solid rgba(107,184,255,0.2)", borderRadius:20 }}>tap to see what lives here</div>
: <div style={{ animation:"riseUp 0.6s ease", textAlign:"center", width:"100%" }}>
<div style={{ fontSize:19, color: tAlive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.78)", fontFamily:FD, maxWidth:290, lineHeight:1.65,
transition:"color 0.3s", textShadow: tAlive ? "0 0 30px rgba(107,184,255,0.25)" : "none" }}>{tText}</div>
{tAlive && <div style={{ marginTop:18, fontSize:15, color:"rgba(107,197,255,0.75)", fontFamily:FD, maxWidth:280, lineHeight:1.6, animation:"riseUp 0.5s ease both" }}>{tQ}</div>}
{tAway && <div style={{ marginTop:18, fontSize:14, color:"rgba(255,255,255,0.5)", fontFamily:FB, animation:"riseUp 0.5s ease both" }}>This doesn't fit — bring your real tension into the map.</div>}
<AccuracySlider value={tSv} onSlide={function(v){setSlider("tension",v);}} color="#6BB8FF" leftLabel="not quite" rightLabel="that's the one" />
</div>}
</div>;
}

case "underneath": {
var uSv = sliderValues.underneath !== undefined ? sliderValues.underneath : 50;
var uAlive = uSv >= 68;
return (
<FC><FieldParticles color={uAlive ? "#D08BFF" : "#B86BFF"} count={uAlive ? 20 : 10} />
<FLabel color="#B86BFF">WHAT'S UNDERNEATH</FLabel>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontFamily:FB, letterSpacing:"0.06em", marginBottom:8, maxWidth:280 }}>Patterns that are hard to see yourself — repetition, structure, what's in hiding.</div>
<div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:FB, letterSpacing:"0.1em", marginBottom:16 }}>hold to save · swipe to react</div>
<div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:320, width:"100%" }}>
{underneath.slice(0,3).map(function(t, idx) {
var text = typeof t === "string" ? t : t.observation || "";
return <UnderneathItem key={idx} text={text} index={idx} />;
})}
</div>
</FC>
);
}

case "blind_spot": {
var bsSv = sliderValues.blind_spot !== undefined ? sliderValues.blind_spot : 50;
var bsAlive = bsSv >= 68; var bsAway = bsSv <= 32;
var bsWords = (blindSpot||"").split(" ");
return (
<div style={{ position:"absolute", inset:0, overflow:"hidden",
background:"linear-gradient(185deg, #010508 0%, #030C14 40%, #041020 70%, #071828 100%)" }}>
<div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
width:500, height:320,
background:"radial-gradient(ellipse at 50% 100%, rgba(30,80,160,0.18) 0%, rgba(20,50,120,0.08) 45%, transparent 70%)",
pointerEvents:"none" }} />
{bsAlive && [0,1,2].map(function(_,i) {
return <div key={i} style={{ position:"absolute", left: (20+i*30)+"%", top:0, bottom:0, width:1,
background:"linear-gradient(180deg,transparent,rgba(80,140,255,0.06),transparent)",
animation:"sweep "+(4+i*1.5)+"s ease-in-out infinite", animationDelay:i*0.8+"s", pointerEvents:"none" }} />;
})}
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 28px" }}>
<div style={{ fontSize:13, color:"rgba(80,140,255,0.9)", fontFamily:FB, letterSpacing:"0.22em", fontWeight:700, textTransform:"uppercase", marginBottom:28, animation:"riseUp 0.8s ease both" }}>WHAT YOU MIGHT NOT SEE</div>
<div style={{ textAlign:"center", maxWidth:320, marginBottom:16 }}>
{bsWords.map(function(w, i) {
return <span key={i} style={{ fontFamily:FD, fontSize:22, fontWeight:400,
color: bsAlive ? "rgba(180,210,255,0.95)" : bsAway ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.78)",
animation:"fallIn 0.7s ease "+(0.3+i*0.12)+"s both",
display:"inline-block", marginRight:7, marginBottom:4, transition:"color 0.4s",
textShadow: bsAlive ? "0 0 20px rgba(80,140,255,0.4)" : "none" }}>{w}</span>;
})}
</div>
{bsAlive && <div style={{ fontSize:15, color:"rgba(80,160,255,0.75)", fontFamily:FD, maxWidth:280, textAlign:"center", lineHeight:1.65, animation:"riseUp 0.5s ease both", marginBottom:8 }}>
What becomes possible when you can finally see this?
</div>}
{bsAway && <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", fontFamily:FB, animation:"riseUp 0.5s ease both", marginBottom:8 }}>
Not the right angle — keep exploring.
</div>}
<AccuracySlider value={bsSv} onSlide={function(v){setSlider("blind_spot",v);}} color="#5090FF" leftLabel="way off" rightLabel="that's the gap" />
</div>
</div>
);
}

case "archetype": {
if (!primaryArch || !archReg) return null;
var Viz = archReg.Viz;
var c = archReg.color;
var timesAppeared = history[primaryArch.key] || 0;
var vizEl = null;
var archPhase = primaryArch ? primaryArch.phase : null;
try { vizEl = <Viz phase={archPhase} color={c} />; } catch(e) { vizEl = <div style={{fontSize:52}}>{archReg.icon}</div>; }

if (!clicked) return (
<FC><FieldParticles color={c} count={20} />
<FLabel color={c}>{archReg.name.toUpperCase()}</FLabel>
<FHero size={26} color="rgba(255,255,255,0.6)">{primaryArch.title || archReg.name}</FHero>
<div style={{ margin: "16px 0" }}>{vizEl}</div>
<FTap color={c}>tap to see what's emerging →</FTap>
</FC>
);
return (
<FC><FieldParticles color={c} count={28} />
<FLabel color={c}>{archReg.name.toUpperCase()}</FLabel>
{primaryArch.phase && archReg.phases && archReg.phases[primaryArch.phase] && <div style={{ fontSize: 11, color: c, opacity: 0.5, fontFamily: FB, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 14, animation: "riseUp 0.5s ease both" }}>{primaryArch.phase.replace(/_/g," ")}</div>}
<div style={{ margin: "8px 0 14px" }}>{vizEl}</div>
<div style={{ fontSize: 18, color: "rgba(255,255,255,0.7)", fontFamily: FD, fontStyle: "italic", maxWidth: 300, lineHeight: 1.65, animation: "riseUp 0.8s ease 0.3s both" }}>{primaryArch.reading || primaryArch.line || archReg.phases?.dissolving || ""}</div>
{timesAppeared > 1 && <div style={{ marginTop: 16, fontSize: 12, color: c + "77", fontFamily: FB, animation: "riseUp 0.6s ease 0.6s both" }}>This pattern has visited you {timesAppeared} times.</div>}
{alchemyData && alchemyData.stage && <div style={{ marginTop: 22, padding: "10px 18px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", animation: "riseUp 0.7s ease 0.7s both" }}>
<div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: FB, letterSpacing: "0.2em", marginBottom: 5 }}>{(FIELD_ALCHEMY[alchemyData.stage]||{}).label || alchemyData.stage}</div>
{alchemyData.evidence && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.38)", fontFamily: FD, fontStyle: "italic", lineHeight: 1.6 }}>{alchemyData.evidence}</div>}
</div>}
</FC>
);
}

case "portrait": return (
<FC><FieldParticles color="#E84393" count={14} />
<FLabel color="#E84393">SESSION PORTRAIT</FLabel>
<DataPortrait themes={themes} />
</FC>
);

case "opening": return (
<FC><FieldParticles color="#6BFFB8" count={18} />
<FLabel color="#6BFFB8">WHAT'S OPENING</FLabel>
<div style={{ fontSize: 26, color: "#6BFFB8", fontFamily: FD, fontStyle: "italic", lineHeight: 1.5, textAlign: "center", maxWidth: 300, animation: "riseUp 0.8s ease both" }}>
{opening || "Something is trying to emerge."}
</div>
<div style={{ marginTop: 40, textAlign: "center", animation: "riseUp 0.8s ease 0.5s both" }}>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontFamily: FB, marginBottom: 8 }}>Your first word</div>
<div style={{ fontSize: 28, color: "rgba(255,255,255,0.3)", fontFamily: FD, fontStyle: "italic", marginBottom: 24 }}>{firstWord}</div>
<div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontFamily: FB, marginBottom: 8 }}>Your last word</div>
<div style={{ fontSize: 36, color: "#6BFFB8", fontFamily: FD, fontStyle: "italic" }}>{lastWord}</div>
</div>
</FC>
);

case "submersion": {
var subSv = sliderValues.submersion;
var subInteracted = subSv !== undefined;
var subZone = !subInteracted ? null : subSv < 33 ? "away" : subSv < 68 ? "uncertain" : "truth";
var subComment = (cardComments && cardComments.submersion) || "";
var subDeepText = card.deep || "";
var subSecText = card.secondary || "";
var subThemeColor = (themes[0] && themes[0].color) || "#3DA8D4";

var zoneGlow = subZone === "truth" ? "#1AD4C8" : subZone === "uncertain" ? "#C8A84B" : subZone === "away" ? "#4A6FA8" : "rgba(20,60,90,0.0)";
var zoneGlowRGB = subZone === "truth" ? "26,212,200" : subZone === "uncertain" ? "200,168,75" : "80,110,168";

var depthLabel = !subInteracted ? "DEPTH UNKNOWN" : subZone === "truth" ? "SURFACED" : subZone === "uncertain" ? "STIRRING" : "RECEDING";
var depthPct = !subInteracted ? 72 : subZone === "truth" ? 15 : subZone === "uncertain" ? 50 : 85;

var subArchColor = _archColor || subThemeColor;

return (
<div style={{ position:"absolute", inset:0, overflow:"hidden",
background: subInteracted
? (subZone==="truth"
? "linear-gradient(190deg, #010308 0%, #020D1A 30%, #03202E 65%, #041C2A 100%)"
: subZone==="uncertain"
? "linear-gradient(190deg, #010308 0%, #0D0B04 30%, #1A1404 65%, #120F04 100%)"
: "linear-gradient(190deg, #010308 0%, #04080E 30%, #070A10 65%, #060810 100%)")
: "linear-gradient(190deg, #010308 0%, #020810 30%, #030E1C 60%, #040C18 100%)" }}>

{!subInteracted && <>
<div style={{ position:"absolute", top:"8%", left:"20%", width:280, height:180,
background:"radial-gradient(ellipse, rgba(15,80,130,0.06), transparent 70%)",
filter:"blur(40px)", animation:"pulse 4s ease infinite", pointerEvents:"none" }}/>
<div style={{ position:"absolute", top:"30%", left:"50%", width:220, height:150,
background:"radial-gradient(ellipse, rgba(10,60,100,0.05), transparent 70%)",
filter:"blur(50px)", animation:"pulse 6s ease 1s infinite", pointerEvents:"none" }}/>
<div style={{ position:"absolute", top:"55%", left:"30%", width:300, height:200,
background:"radial-gradient(ellipse, rgba(5,40,80,0.08), transparent 70%)",
filter:"blur(60px)", animation:"pulse 5s ease 2s infinite", pointerEvents:"none" }}/>
</>}

{subInteracted && <div style={{ position:"absolute", bottom:-40, left:"50%", transform:"translateX(-50%)",
width:440, height:340,
background:"radial-gradient(ellipse, rgba("+zoneGlowRGB+",0.18), transparent 65%)",
filter:"blur(50px)", transition:"all 1.2s ease", pointerEvents:"none" }}/>}

<svg style={{ position:"absolute", left:14, top:0, height:"100%", width:28, opacity:0.35, pointerEvents:"none" }}>
{[10,20,30,40,50,60,70,80,90].map(function(pct) {
var y = pct/100 * 600;
var isMark = pct % 20 === 0;
return [
<line key={"l"+pct} x1={isMark?6:10} y1={y} x2={20} y2={y} stroke="rgba(100,180,220,0.4)" strokeWidth={isMark?1:0.5}/>,
isMark && <text key={"t"+pct} x={2} y={y+3} fontSize={5} fill="rgba(100,180,220,0.35)" fontFamily="monospace">{pct}m</text>
];
})}
<line x1={20} y1={0} x2={20} y2={600} stroke="rgba(100,180,220,0.2)" strokeWidth={0.8}/>
<circle cx={20} cy={depthPct/100*550 + 30} r={4} fill={subInteracted ? zoneGlow : "rgba(60,140,200,0.5)"}
style={{ transition:"cy 1.4s cubic-bezier(.25,.46,.45,.94)", filter:"url(#blur)" }}/>
<polygon points={"6,"+(depthPct/100*550+26)+" 20,"+(depthPct/100*550+30)+" 6,"+(depthPct/100*550+34)} fill={subInteracted ? zoneGlow : "rgba(60,140,200,0.4)"}
style={{ transition:"all 1.4s cubic-bezier(.25,.46,.45,.94)" }}/>
</svg>

<FieldParticles color={subInteracted ? zoneGlow : "rgba(80,160,220,0.5)"} count={subInteracted && subZone==="truth" ? 22 : 8}/>

<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center",
justifyContent:"flex-start", padding:"50px 32px 22px 46px", overflowY:"auto" }}>

<div style={{ fontSize:8, letterSpacing:"0.5em", color: subInteracted ? zoneGlow+"CC" : "rgba(60,140,200,0.3)",
fontFamily:FB, textTransform:"uppercase", marginBottom:22, transition:"color 0.8s",
animation:"riseUp 0.6s ease both" }}>
{depthLabel}
</div>

{subInteracted && subComment && (
<div style={{ width:"100%", maxWidth:300, marginBottom:18, padding:"12px 16px", borderRadius:14,
background:"rgba("+zoneGlowRGB+",0.1)", border:"1px solid rgba("+zoneGlowRGB+",0.3)",
animation:"riseUp 0.8s ease both" }}>
<div style={{ fontSize:8, color:zoneGlow+"99", fontFamily:FB, letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:7 }}>
{subZone==="away" ? "YOUR READ" : "YOUR WORDS"}
</div>
<div style={{ fontSize:18, color:"rgba(255,255,255,0.88)", fontFamily:FD, fontStyle:"italic", lineHeight:1.7,
textShadow:"0 0 30px rgba("+zoneGlowRGB+",0.25)" }}>
"{subComment}"
</div>
</div>
)}

<div style={{ width:"100%", maxWidth:300, marginBottom: subInteracted ? 14 : 20 }}>
{!subInteracted && (
<div style={{ fontSize:9, letterSpacing:"0.3em", color:"rgba(60,140,200,0.3)", fontFamily:FB,
textTransform:"uppercase", marginBottom:14, animation:"riseUp 0.7s ease 0.1s both" }}>
BELOW THE SURFACE
</div>
)}
{subInteracted && !subComment && (
<div style={{ fontSize:9, letterSpacing:"0.3em", color:zoneGlow+"88", fontFamily:FB,
textTransform:"uppercase", marginBottom:14, transition:"color 0.8s" }}>
{subZone==="truth" ? "SURFACED" : subZone==="uncertain" ? "SOMETHING STIRS" : "RECEDING"}
</div>
)}

<div style={{ fontSize: subInteracted && subZone==="truth" ? 22 : 19,
color: subInteracted
? (subZone==="truth" ? "rgba(255,255,255,0.92)" : subZone==="uncertain" ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.28)")
: "rgba(255,255,255,0.42)",
fontFamily:FD, fontStyle:"italic", lineHeight:1.78, maxWidth:300,
textShadow: subInteracted && subZone==="truth" ? "0 0 40px rgba("+zoneGlowRGB+",0.35)" : "none",
transition:"all 0.9s ease", animation:"riseUp 0.8s ease 0.2s both" }}>
{subDeepText}
</div>
</div>

{subSecText && !subInteracted && (
<div style={{ width:"100%", maxWidth:300, marginBottom:16, opacity:0.35,
animation:"riseUp 0.7s ease 0.4s both" }}>
<div style={{ width:"100%", height:1, background:"linear-gradient(90deg, transparent, rgba(60,140,200,0.15), transparent)", marginBottom:12 }}/>
<div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", fontFamily:FD, fontStyle:"italic", lineHeight:1.65 }}>
{subSecText.slice(0,120)}{subSecText.length>120?"…":""}
</div>
</div>
)}

{subInteracted && subZone==="truth" && primaryArch && (
<div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14,
animation:"riseUp 0.8s ease 0.3s both", opacity:0.75 }}>
<ArchGlyph name={primaryArch.name||""} color={subArchColor} size={32}/>
<div style={{ fontSize:10, color:subArchColor+"99", fontFamily:FB, letterSpacing:"0.15em", textTransform:"uppercase" }}>
{primaryArch.name||""}
</div>
</div>
)}

<div style={{ width:"100%", maxWidth:300, marginTop:8, animation:"riseUp 0.8s ease 0.55s both" }}
data-noadvance="true">
<div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
<span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase" }}>not mine</span>
<span style={{ fontSize:9, color:"rgba(255,255,255,0.12)", fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase" }}>something there</span>
<span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase" }}>deep truth</span>
</div>
<div style={{ position:"relative", height:6, background:"rgba(255,255,255,0.05)", borderRadius:3, cursor:"pointer" }}
onPointerDown={function(e) {
e.stopPropagation();
var rect = e.currentTarget.getBoundingClientRect();
var pct = Math.round(Math.max(0, Math.min(100, ((e.clientX-rect.left)/rect.width)*100)));
setSlider("submersion", pct);
var mv = function(ev) {
var p = Math.round(Math.max(0, Math.min(100, ((ev.clientX-rect.left)/rect.width)*100)));
setSlider("submersion", p);
};
var up = function() { window.removeEventListener("pointermove",mv); window.removeEventListener("pointerup",up); };
window.addEventListener("pointermove", mv);
window.addEventListener("pointerup", up);
}}>
<div style={{ position:"absolute", left:0, top:0, height:"100%", width:(subSv||50)+"%",
background: subInteracted
? "linear-gradient(90deg, rgba(70,100,160,0.5), "+zoneGlow+")"
: "linear-gradient(90deg, rgba(30,80,130,0.3), rgba(60,140,200,0.3))",
borderRadius:3, transition:"width 0.15s, background 0.7s",
boxShadow: subInteracted && subZone==="truth" ? "0 0 10px "+zoneGlow+"55" : "none" }}/>
<div style={{ position:"absolute", top:"50%", left:(subSv!==undefined?subSv:50)+"%",
transform:"translate(-50%,-50%)", width:16, height:16, borderRadius:"50%",
background: subInteracted ? zoneGlow : "rgba(60,140,200,0.5)",
border:"2px solid rgba(255,255,255,0.5)",
transition:"left 0.15s, background 0.7s",
boxShadow: subInteracted && subZone==="truth" ? "0 0 10px "+zoneGlow : "none" }}/>
</div>
</div>

{subInteracted && (
<div style={{ width:"100%", maxWidth:300, marginTop:14, animation:"riseUp 0.6s ease both" }}
data-noadvance="true">
<textarea
value={subComment}
onChange={function(e) { setCardComment("submersion", e.target.value); }}
placeholder={subZone==="away" ? "what's actually there for you..." : "say more, if something surfaces..."}
style={{ width:"100%", minHeight:52,
background: subZone==="away" ? "rgba(20,30,50,0.5)" : "rgba(255,255,255,0.025)",
border:"1px solid rgba("+zoneGlowRGB+",0.18)",
borderRadius:10, color:"rgba(255,255,255,0.82)",
fontFamily:FD, fontSize:14, fontStyle:"italic",
padding:"9px 12px", resize:"none", outline:"none",
lineHeight:1.6, boxSizing:"border-box",
transition:"border-color 0.5s, background 0.5s" }}
onFocus={function(e){e.currentTarget.style.borderColor="rgba("+zoneGlowRGB+",0.45)";}}
onBlur={function(e){e.currentTarget.style.borderColor="rgba("+zoneGlowRGB+",0.18)";}}
onKeyDown={function(e){e.stopPropagation();}}
onClick={function(e){e.stopPropagation();}}
/>
<div style={{ display:"flex", justifyContent:"flex-end", marginTop:6 }}>
<button onClick={function(e){e.stopPropagation(); advance();}}
style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:FB,
background:"transparent", border:"none", cursor:"pointer",
letterSpacing:"0.08em", textTransform:"uppercase" }}>
continue →
</button>
</div>
</div>
)}

</div>
</div>
);
}

case "theme_arc": {
var tierGroups = {
persistent: themesClassified.filter(function(t){return t.tier==="persistent";}),
returning: themesClassified.filter(function(t){return t.tier==="returning";}),
new_t: themesClassified.filter(function(t){return t.tier==="new";})
};
var taMaxSessions = themesClassified.reduce(function(m,t){return Math.max(m,t.sessions||1);},1);
var tierDefs = [
{ key:"persistent", label:"STILL WITH YOU", sub:"recurring", themes: tierGroups.persistent },
{ key:"returning", label:"RETURNING", sub:"came back", themes: tierGroups.returning },
{ key:"new_t", label:"EMERGING NOW", sub:"first time",themes: tierGroups.new_t },
].filter(function(g){return g.themes.length>0;});
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"56px 26px 32px", overflow:"hidden" }}>
<FieldParticles color="#6BB8FF" count={12}/>
<div style={{ position:"absolute", top:"28%", left:"50%", transform:"translateX(-50%)", width:300, height:200, background:"radial-gradient(ellipse, rgba(107,184,255,0.05), transparent 70%)", pointerEvents:"none" }}/>
<div style={{ fontSize:9, letterSpacing:"0.45em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:30, animation:"riseUp 0.6s ease both" }}>YOUR PATTERNS OVER TIME</div>
<div style={{ width:"100%", maxWidth:340, display:"flex", flexDirection:"column", gap:22 }}>
{tierDefs.map(function(tier, ti) {
return (
<div key={tier.key} style={{ animation:"riseUp 0.6s ease "+(0.1+ti*0.15)+"s both" }}>
<div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:9 }}>
<span style={{ fontSize:8, letterSpacing:"0.3em", color:"rgba(255,255,255,0.25)", fontFamily:FB, textTransform:"uppercase" }}>{tier.label}</span>
<span style={{ fontSize:8, color:"rgba(255,255,255,0.12)", fontFamily:FB }}>{tier.sub}</span>
</div>
<div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
{tier.themes.map(function(t, thi) {
var dots = Math.min(t.sessions||1, 8);
return (
<div key={thi} style={{ display:"flex", flexDirection:"column", gap:5, padding:"10px 14px", borderRadius:14,
background:t.color+(tier.key==="persistent"?"18":tier.key==="returning"?"0E":"07"),
border:"1px solid "+t.color+(tier.key==="persistent"?"44":tier.key==="returning"?"28":"14") }}>
<span style={{ fontSize:13, color:"rgba(255,255,255,"+(tier.key==="persistent"?"0.92":tier.key==="returning"?"0.68":"0.45")+")", fontFamily:FB, fontWeight:600 }}>{t.label}</span>
{tier.key!=="new_t" && (
<div style={{ display:"flex", gap:3 }}>
{Array.from({length:dots}).map(function(_,di){
return <div key={di} style={{ width:5,height:5,borderRadius:"50%",background:t.color,opacity:di===dots-1?1:0.3 }}/>;
})}
</div>
)}
</div>
);
})}
</div>
</div>
);
})}
</div>
<div style={{ marginTop:22, fontSize:10, color:"rgba(255,255,255,0.1)", fontFamily:FB, letterSpacing:"0.15em", animation:"riseUp 0.6s ease 0.5s both" }}>session {sessionCount} of your record</div>
</div>
);
}

case "alchemy_journey": {
var ALCH_META = {
nigredo: { label:"Nigredo", sub:"the descent", color:"#6066AA" },
albedo: { label:"Albedo", sub:"the cleansing", color:"#B8C8E8" },
citrinitas: { label:"Citrinitas", sub:"illumination", color:"#D6B26D" },
rubedo: { label:"Rubedo", sub:"integration", color:"#E84393" },
};
var arcArr = card.arc || [];
var curStage = card.current || (alchemyData && alchemyData.stage) || null;
var curMeta = curStage ? (ALCH_META[curStage] || ALCH_META.nigredo) : null;
var stageCounts = {};
arcArr.forEach(function(a){ stageCounts[a.stage]=(stageCounts[a.stage]||0)+1; });
var longestSt = Object.keys(stageCounts).reduce(function(b,k){ return (stageCounts[k]||0)>(stageCounts[b]||0)?k:b; }, Object.keys(stageCounts)[0]||"nigredo");
var dotLine = arcArr.slice(-14);
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"56px 26px 40px", overflow:"hidden" }}>
<FieldParticles color={curMeta?curMeta.color:"#B86BFF"} count={14}/>
<div style={{ fontSize:9, letterSpacing:"0.45em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:24, animation:"riseUp 0.6s ease both" }}>YOUR ALCHEMICAL ARC</div>
<div style={{ display:"flex", gap:18, marginBottom:24, flexWrap:"wrap", justifyContent:"center", animation:"riseUp 0.6s ease 0.1s both" }}>
{["nigredo","albedo","citrinitas","rubedo"].map(function(stKey) {
var m=ALCH_META[stKey]; var isCur=stKey===curStage; var cnt=stageCounts[stKey]||0;
return (
<div key={stKey} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, opacity:cnt>0||isCur?1:0.18 }}>
<div style={{ width:isCur?14:9, height:isCur?14:9, borderRadius:"50%", background:m.color, boxShadow:isCur?"0 0 14px "+m.color+"99":"none", border:isCur?"2px solid rgba(255,255,255,0.6)":"none", transition:"all 0.3s" }}/>
<span style={{ fontSize:8, color:isCur?"rgba(255,255,255,0.75)":"rgba(255,255,255,0.25)", fontFamily:FB, letterSpacing:"0.08em", textTransform:"uppercase" }}>{m.label}</span>
{cnt>0 && <span style={{ fontSize:8, color:"rgba(255,255,255,0.18)", fontFamily:FB }}>×{cnt}</span>}
</div>
);
})}
</div>
<div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap", justifyContent:"center", maxWidth:320, marginBottom:28, animation:"riseUp 0.7s ease 0.2s both" }}>
{dotLine.map(function(a, di) {
var m2=ALCH_META[a.stage]||ALCH_META.nigredo; var isCur=di===dotLine.length-1;
return (
<div key={di} style={{ display:"flex", alignItems:"center", gap:4 }}>
<div style={{ width:isCur?16:9, height:isCur?16:9, borderRadius:"50%", background:m2.color, boxShadow:isCur?"0 0 18px "+m2.color+"aa":"none", border:isCur?"2.5px solid rgba(255,255,255,0.7)":"none", flexShrink:0, animation:isCur?"pulse 2.5s ease infinite":"none" }}/>
{di<dotLine.length-1 && <div style={{ width:12, height:1.5, background:"rgba(255,255,255,0.1)", flexShrink:0 }}/>}
</div>
);
})}
</div>
{curMeta && (
<div style={{ textAlign:"center", animation:"riseUp 0.8s ease 0.35s both" }}>
<div style={{ fontSize:30, color:curMeta.color, fontFamily:FD, fontWeight:700, letterSpacing:"0.04em", textShadow:"0 0 40px "+curMeta.color+"55" }}>{curMeta.label}</div>
<div style={{ fontSize:13, color:"rgba(255,255,255,0.38)", fontFamily:FD, fontStyle:"italic", marginTop:4 }}>{curMeta.sub}</div>
{alchemyData&&alchemyData.evidence && <div style={{ marginTop:14, fontSize:14, color:"rgba(255,255,255,0.5)", fontFamily:FD, fontStyle:"italic", maxWidth:290, lineHeight:1.65 }}>"{alchemyData.evidence}"</div>}
</div>
)}
{longestSt && longestSt!==curStage && <div style={{ marginTop:14, fontSize:10, color:"rgba(255,255,255,0.18)", fontFamily:FB, animation:"riseUp 0.6s ease 0.5s both" }}>you've spent the most time in {(ALCH_META[longestSt]||{label:longestSt}).label}</div>}
</div>
);
}

case "opening_shift": {
var osPast=card.past||""; var osNow=card.now||"";
var osColor=(themes[0]&&themes[0].color)||"#6BFFB8";
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"56px 28px 40px", overflow:"hidden" }}>
<FieldParticles color={osColor} count={12}/>
<div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg,transparent 40%,"+osColor+"07 100%)", pointerEvents:"none" }}/>
<div style={{ fontSize:9, letterSpacing:"0.45em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:32, animation:"riseUp 0.6s ease both" }}>WHAT SHIFTED</div>
<div style={{ width:"100%", maxWidth:320 }}>
<div style={{ padding:"18px 20px 20px", borderRadius:"14px 14px 3px 3px", background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", animation:"riseUp 0.7s ease 0.1s both" }}>
<div style={{ fontSize:8, letterSpacing:"0.3em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:10 }}>LAST SESSION</div>
<div style={{ fontSize:16, color:"rgba(255,255,255,0.36)", fontFamily:FD, fontStyle:"italic", lineHeight:1.7 }}>{osPast.slice(0,160)}{osPast.length>160?"…":""}</div>
</div>
<div style={{ display:"flex", justifyContent:"center", padding:"7px 0", background:"rgba(0,0,0,0.35)" }}>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
<div style={{ width:1, height:10, background:"linear-gradient(180deg,rgba(255,255,255,0.08),"+osColor+"55)" }}/>
<span style={{ fontSize:13, color:osColor+"88" }}>↓</span>
</div>
</div>
<div style={{ padding:"18px 20px 20px", borderRadius:"3px 3px 14px 14px", background:osColor+"0B", border:"1px solid "+osColor+"26", animation:"riseUp 0.7s ease 0.25s both" }}>
<div style={{ fontSize:8, letterSpacing:"0.3em", color:osColor+"88", fontFamily:FB, textTransform:"uppercase", marginBottom:10 }}>NOW</div>
<div style={{ fontSize:20, color:"rgba(255,255,255,0.88)", fontFamily:FD, fontStyle:"italic", lineHeight:1.7, textShadow:"0 0 30px "+osColor+"1A" }}>{osNow.slice(0,160)}{osNow.length>160?"…":""}</div>
</div>
</div>
</div>
);
}

case "tension_return": {
var trCount=card.count||2;
var trA=tension?tension.a:""; var trB=tension?tension.b:""; var trText=tension?tension.text:"";
var trColA=(themes.find(function(t){return t.label===trA;})||themes[0]||{color:"#FF8080"}).color;
var trColB=(themes.find(function(t){return t.label===trB;})||themes[1]||themes[0]||{color:"#6BB8FF"}).color;
var retLabels=["twice now","three times","four times","five times"];
var retLabel=trCount<=5?(retLabels[trCount-2]||"repeatedly"):"repeatedly";
return (
<div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"56px 28px 40px", overflow:"hidden" }}>
<FieldParticles color={trColA} count={10}/>
<div style={{ position:"absolute", top:"18%", left:"5%", width:200, height:200, borderRadius:"50%", background:"radial-gradient(circle,"+trColA+"10,transparent 65%)", filter:"blur(50px)", pointerEvents:"none" }}/>
<div style={{ position:"absolute", bottom:"18%", right:"5%", width:200, height:200, borderRadius:"50%", background:"radial-gradient(circle,"+trColB+"10,transparent 65%)", filter:"blur(50px)", pointerEvents:"none" }}/>
<div style={{ fontSize:9, letterSpacing:"0.45em", color:"rgba(255,255,255,0.18)", fontFamily:FB, textTransform:"uppercase", marginBottom:8, animation:"riseUp 0.6s ease both" }}>THIS TENSION HAS RETURNED</div>
<div style={{ fontSize:50, fontWeight:300, color:"rgba(255,255,255,0.78)", fontFamily:FD, lineHeight:1, letterSpacing:"-0.02em", marginBottom:22, animation:"riseUp 0.7s ease 0.1s both" }}>{retLabel}</div>
<div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18, animation:"riseUp 0.7s ease 0.2s both" }}>
<span style={{ fontSize:22, color:trColA, fontFamily:FD, fontWeight:600 }}>{trA}</span>
<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
<div style={{ width:30, height:1.5, background:"linear-gradient(90deg,"+trColA+","+trColB+")" }}/>
<span style={{ fontSize:7, color:"rgba(255,255,255,0.2)", fontFamily:FB, letterSpacing:"0.12em" }}>VS</span>
<div style={{ width:30, height:1.5, background:"linear-gradient(90deg,"+trColA+","+trColB+")" }}/>
</div>
<span style={{ fontSize:22, color:trColB, fontFamily:FD, fontWeight:600 }}>{trB}</span>
</div>
{trText && <div style={{ fontSize:16, color:"rgba(255,255,255,0.6)", fontFamily:FD, fontStyle:"italic", maxWidth:290, lineHeight:1.7, textAlign:"center", marginBottom:20, animation:"riseUp 0.8s ease 0.3s both" }}>{trText}</div>}
<div style={{ padding:"14px 20px", borderRadius:14, background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)", maxWidth:300, animation:"riseUp 0.7s ease 0.45s both" }}>
<div style={{ fontSize:8, color:"rgba(255,255,255,0.18)", fontFamily:FB, letterSpacing:"0.2em", marginBottom:7, textTransform:"uppercase" }}>worth asking</div>
<div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", fontFamily:FD, lineHeight:1.65 }}>This keeps coming back. Is it something to resolve — or something to live inside?</div>
</div>
</div>
);
}

case "closing": return (
<FC><FieldParticles color="#6BFFB8" count={35} />
<div style={{ marginBottom: 28 }}>
<svg viewBox="0 0 160 160" style={{ width: 110, height: 110 }}>
{[50,40,30,20].map(function(r, i) {
var col = themes[i] ? themes[i].color : "#6BFFB8";
return <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={col} strokeWidth={i===3?2.5:1} opacity={0.12+i*0.1}>
<animate attributeName="r" values={r+";"+(r+7)+";"+r} dur={(3+i*0.6)+"s"} repeatCount="indefinite" />
<animate attributeName="opacity" values={(0.1+i*0.08)+";"+(0.2+i*0.1)+";"+(0.1+i*0.08)} dur={(3+i*0.6)+"s"} repeatCount="indefinite" />
</circle>;
})}
<circle cx="80" cy="80" r="7" fill={themes[0] ? themes[0].color : "#6BFFB8"} opacity="0.9">
<animate attributeName="r" values="7;9;7" dur="2.5s" repeatCount="indefinite" />
</circle>
</svg>
</div>
<div style={{ fontSize: 14, color: "rgba(255,255,255,0.25)", fontFamily: FB, letterSpacing: "0.35em", marginBottom: 28 }}>THE FIELD</div>
<FHero size={38} color="white">You named<br/>what you're<br/>carrying</FHero>
{primaryArch && <div style={{ marginTop: 28, padding: "8px 18px", borderRadius: 20, background: _archColor + "14", border: "1px solid " + _archColor + "28", fontSize: 13, color: _archColor, fontFamily: FB }}>
◆ {primaryArch.name || (archReg && archReg.name) || "Your Pattern"}
</div>}
<div style={{ marginTop: 32, fontSize: 14, color: "rgba(255,255,255,0.2)", fontFamily: FB }}>Next session whenever you're ready.</div>
</FC>
);

case "cross_session_portrait": return (
<CrossSessionCard pastSessions={card.pastSessions || []} currentSd={sd} />
);

default: return null;
}
};

if (!card) {
console.error("[FIELD] card is undefined — CARDS.length:", CARDS.length, "current:", current);
return <div style={{position:"absolute",inset:0,background:"#060910",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.4)",fontSize:13,fontFamily:"sans-serif",flexDirection:"column",gap:12}}>
<div>CARDS: {CARDS.length} | current: {current}</div>
{CARDS.map(function(c,i){return <div key={i} style={{fontSize:10,opacity:0.5}}>{i}: {c.type}</div>;})}
</div>;
}

return (
<div ref={containerRef} onClick={handleClick} style={{ width: "100%", height: "100%", background: card.bg, position: "absolute", inset: 0, cursor: "pointer", userSelect: "none", transition: "background 0.7s ease" }}>
<div style={{ display:"flex", alignItems:"center", gap:8, padding:"14px 16px 0", position:"absolute", top:0, left:0, right:0, zIndex:10 }}>
<div style={{ flex:1, display:"flex", gap:3 }}>
{CARDS.map(function(_, i) {
var visited = i < current;
var isCurrent = i === current;
return <div key={i}
onClick={function(e){ e.stopPropagation(); if (i <= current) { setCurrent(i); setClicked(false); } }}
style={{ flex:1, height: isCurrent ? 3 : 2.5, borderRadius:2,
background: visited ? "rgba(255,255,255,0.6)" : isCurrent ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.12)",
transition:"all 0.3s",
cursor: visited ? "pointer" : "default",
transform: visited ? "scaleY(1)" : "scaleY(1)" }} />;
})}
</div>
{sessionCount >= 85 && (
<span style={{ flexShrink:0, fontSize:8, color:"rgba(214,178,109,0.7)", fontFamily:FB, letterSpacing:"0.08em", maxWidth:90, lineHeight:1.2 }}>Export to backup before archival</span>
)}
<button onClick={function(e){ e.stopPropagation(); exportUserData(); }} style={{ flexShrink:0, padding:"4px 10px", fontSize:9, letterSpacing:"0.12em", color:"rgba(255,255,255,0.25)", fontFamily:FB, background:"transparent", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, cursor:"pointer", textTransform:"uppercase" }}>Export</button>
</div>
{current < CARDS.length - 1 && (
<div style={{ position:"absolute", bottom:"max(16px, env(safe-area-inset-bottom))", left:"50%", transform:"translateX(-50%)", zIndex:8, pointerEvents:"none", display:"flex", alignItems:"center", gap:6 }}>
<span style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontFamily:FB, letterSpacing:"0.2em", textTransform:"uppercase" }}>Tap right →</span>
</div>
)}
<div key={current + "-" + clicked} style={{ width: "100%", height: "100%", animation: clicked ? "morphIn 0.5s ease" : "slideIn 0.35s ease-out", position:"relative" }}>
{(function() { try { return renderCard(); } catch(e) { console.error("[FIELD] renderCard crashed on card", current, "type:", card && card.type, "error:", e.message||e); return <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.5)",fontSize:13,fontFamily:"sans-serif",padding:40,textAlign:"center"}}>card error: {e.message}</div>; } })()}
</div>
</div>
);
}

function LandingPhase({ onStart }) {
var [show, setShow] = useState(false);
var sessions = [];
try { sessions = JSON.parse(localStorage.getItem(_sessionKey()) || "[]"); } catch(e) {}
var returning = sessions.length > 0;
var SG = "Space Grotesk, " + FB;

useEffect(function() { setTimeout(function() { setShow(true); }, 100); }, []);

function guardedStart() {
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

<nav style={{ position:"sticky", top:0, zIndex:20, display:"flex", justifyContent:"space-between",
alignItems:"center", padding:"20px 7vw",
background:"rgba(10,9,20,0.8)", backdropFilter:"blur(20px)",
borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
<div style={{ fontFamily:SG, fontSize:18, fontWeight:700, letterSpacing:"0.3em",
background:"linear-gradient(90deg, #E84393, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent" }}>SAYCRD</div>
<button onClick={guardedStart} style={{ padding:"10px 26px", borderRadius:999,
background:"linear-gradient(135deg, rgba(232,67,147,0.15), rgba(184,107,255,0.15))",
border:"1px solid rgba(232,67,147,0.3)", color:"#E84393",
fontFamily:FB, fontSize:14, fontWeight:600, letterSpacing:"0.06em", cursor:"pointer" }}>
{returning ? "new session" : "begin"}
</button>
</nav>

<div style={{ position:"relative", zIndex:1, maxWidth:660, margin:"0 auto", padding:"0 7vw 80px" }}>

<section style={{ padding:"72px 0 56px" }}>
<div style={{ fontSize:13, letterSpacing:"0.4em", fontFamily:FB, textTransform:"uppercase",
marginBottom:20, fontWeight:600,
background:"linear-gradient(90deg, #E84393, #B86BFF)", WebkitBackgroundClip:"text",
WebkitTextFillColor:"transparent",
opacity:show?1:0, transition:"opacity 0.8s ease" }}>
A place to go in the moment
</div>

<h1 style={{ fontFamily:FD, fontSize:"clamp(42px,6.5vw,68px)", fontWeight:300,
lineHeight:1.1, color:"rgba(255,255,255,0.95)", marginBottom:28, letterSpacing:"-0.01em",
opacity:show?1:0, transform:show?"translateY(0)":"translateY(24px)",
transition:"all 1s cubic-bezier(.25,.46,.45,.94) 0.1s" }}>
The space between your inner world and the next true move.
</h1>

<p style={{ fontFamily:FD, fontSize:21, fontWeight:300, fontStyle:"italic",
color:"rgba(200,185,230,0.7)", lineHeight:1.7, marginBottom:40, maxWidth:540,
opacity:show?1:0, transform:show?"translateY(0)":"translateY(16px)",
transition:"all 1s cubic-bezier(.25,.46,.45,.94) 0.25s" }}>
SAYCRD listens like a human, shapes what you say into a living visual, and remembers your patterns without turning you into a project.
</p>

<div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"center",
opacity:show?1:0, transition:"opacity 1s ease 0.4s", marginBottom:16 }}>
<button onClick={guardedStart} style={{ padding:"16px 36px", borderRadius:999,
background:"linear-gradient(135deg, #E84393, #B86BFF)", border:"none",
color:"#fff", fontFamily:FB, fontSize:16, fontWeight:700,
letterSpacing:"0.05em", cursor:"pointer",
boxShadow:"0 12px 40px rgba(184,107,255,0.3)" }}>
{returning ? "continue your journey" : "start a session"}
</button>
<button onClick={function(){ var el=document.getElementById("saycrd-why");
if(el) el.scrollIntoView({behavior:"smooth"}); }}
style={{ padding:"16px 28px", borderRadius:999, background:"transparent",
border:"1px solid rgba(255,255,255,0.12)", color:"rgba(255,255,255,0.5)",
fontFamily:FB, fontSize:15, cursor:"pointer" }}>
see the concept
</button>
</div>

{returning && (
<div style={{ fontSize:13, color:"rgba(232,67,147,0.5)", fontFamily:FB, letterSpacing:"0.06em" }}>
{sessions.length} session{sessions.length !== 1 ? "s" : ""} in your field
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
There is a moment when you are scattered and nothing feels clear. Journals are blank pages. To-do apps are laughable. Friends are tired. SAYCRD is the place you go in that moment.
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
A breath, a pause, a reflection — only when needed. The experience stays whole.
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
<button onClick={guardedStart} style={{ padding:"18px 48px", borderRadius:999,
background:"linear-gradient(135deg, #E84393, #B86BFF)", border:"none",
color:"#fff", fontFamily:FB, fontSize:17, fontWeight:700,
letterSpacing:"0.05em", cursor:"pointer",
boxShadow:"0 16px 48px rgba(184,107,255,0.25)" }}>
{returning ? "continue your journey" : "start a session"}
</button>
</section>

</div>
</div>
);
}

function CoSynthPhase({ rawText, synthesisData, mapResponses, onSynthesis, onComplete }) {
const [status, setStatus] = useState("reading");
const sd = synthesisData || {};

var MESSAGES = [
"listening\u2026",
"finding the pattern\u2026",
"seeing what's real\u2026",
"building your session\u2026",
"almost there\u2026"
];
var [msgIdx, setMsgIdx] = useState(0);

useEffect(function() {
var interval = setInterval(function() {
setMsgIdx(function(i) { return (i + 1) % MESSAGES.length; });
}, 1800);
return function() { clearInterval(interval); };
}, []);

useEffect(function() {
(async function() {
try {
var mr = mapResponses || {};
var confirmed = [], rejected = [], partial = [], userSaid = [];

Object.keys(mr).forEach(function(key) {
var r = mr[key];
if (!r) return;
var parts = key.split("::");
var from = parts[0] || "", to = parts[1] || "";
var connLabel = from + " \u2194 " + to;

var origConn = (sd.connections || []).find(function(c) { return c.from === from && c.to === to; });
var origInsight = origConn ? origConn.insight : "";

if (r.value === "yes") {
var line = "CONFIRMED: [" + connLabel + "]";
if (origInsight) line += " \u2014 original read: \"" + origInsight + "\"";
if (r.comment && r.comment.trim()) line += " \u2014 user added: \"" + r.comment.trim() + "\"";
confirmed.push(line);
} else if (r.value === "no") {
var line = "REJECTED: [" + connLabel + "]";
if (origInsight) line += " \u2014 AI said: \"" + origInsight + "\" \u2014 this was WRONG";
if (r.comment && r.comment.trim()) line += " \u2014 user correction: \"" + r.comment.trim() + "\"";
rejected.push(line);
} else if (r.value === "partly") {
var line = "PARTIAL: [" + connLabel + "]";
if (origInsight) line += " \u2014 partial truth: \"" + origInsight + "\"";
if (r.comment && r.comment.trim()) line += " \u2014 what IS true: \"" + r.comment.trim() + "\"";
if (r.correction && r.correction.trim() && r.correction !== r.comment) line += " \u2014 correction: \"" + r.correction.trim() + "\"";
partial.push(line);
} else if (r.value === "discovered" || r.userDiscovered) {
var line = "USER-DISCOVERED: [" + connLabel + "] \u2014 the user connected these themselves";
if (r.insight && r.insight !== "\u2026") line += "; AI read: \"" + r.insight + "\"";
if (r.comment && r.comment.trim()) line += "; user said: \"" + r.comment.trim() + "\"";
confirmed.push(line);
}
if (r.comment && r.comment.trim()) userSaid.push(r.comment.trim());
if (r.correction && r.correction.trim()) userSaid.push(r.correction.trim());
});

var mapRecord = "";
if (confirmed.length) mapRecord += "\n\u2550\u2550 CONFIRMED BY USER (this is real, build on it) \u2550\u2550\n" + confirmed.join("\n");
if (partial.length) mapRecord += "\n\n\u2550\u2550 PARTIALLY TRUE (refine these) \u2550\u2550\n" + partial.join("\n");
if (rejected.length) mapRecord += "\n\n\u2550\u2550 REJECTED BY USER (these were projections \u2014 retire them entirely) \u2550\u2550\n" + rejected.join("\n");

var hadNoFeedback = !confirmed.length && !rejected.length && !partial.length;

var pastContext = "";
try {
var sessions = loadSessions();
if (sessions.length > 0) {
var recent = sessions.slice(-3);
var lines = recent.map(function(s, i) {
var line = "Session " + (sessions.length - recent.length + i + 1) + ":";
if (s.synthesis) line += " synthesis=\"" + s.synthesis.slice(0, 100) + "\"";
if (s.mapTitle) line += " title=\"" + s.mapTitle + "\"";
return line;
});
pastContext = "\n\n\u2550\u2550 PAST SESSIONS (for pattern tracking, not repetition) \u2550\u2550\n" + lines.join("\n");
}
} catch(e) {}

var prompt =
"You are the reflective engine behind SAYCRD \u2014 a co-creation tool, not a diagnosis machine.\n"
+ "Your role: WITNESS, not analyst. COMPANION, not judge. MIRROR, not authority.\n\n"

+ "\u2550\u2550 THE MATERIAL YOU ARE WORKING WITH \u2550\u2550\n"
+ "You have three layers of input. Use them in this exact priority order:\n\n"
+ "1. USER'S OWN WORDS (primary) \u2014 What they wrote in their share, and any words they added while reacting to connections. These are the source. Quote them. Build from them. Mirror them back. Do not paraphrase into your own voice.\n"
+ "2. CONFIRMED TERRITORY (foundation) \u2014 Connections marked as true. These are the real structure of what's happening. Write as if you simply know this is true. Don't explain that they were 'confirmed' \u2014 that's process narration. Just use it.\n"
+ "3. YOUR PATTERN INTELLIGENCE (secondary) \u2014 What you see in the confirmed territory that the person may not have named yet. What does the combination point to? What's the thing underneath the things? Offer this as insight, not verdict.\n\n"
+ "Connections NOT marked as true: GONE. Completely. Don't soften them, don't reference them, don't bring them back sideways. They weren't real for this person.\n"
+ "Partial connections: use only the part that was true, in the user's own words if they gave them.\n\n"

+ "\u2550\u2550 HOW TO WRITE \u2550\u2550\n"
+ "Write as if you simply know what is true about this person right now. Not because they told you \u2014 because it's evident in their words.\n"
+ "NEVER write: 'you confirmed', 'you corrected', 'you pushed back', 'you rejected', 'you told me', 'from your map', 'based on your feedback', 'you said', 'you marked'.\n"
+ "These are process words. They pull the person out of the reading and into a conversation about the conversation. Strip them entirely.\n\n"
+ "WRONG: 'You confirmed that showing up despite pain is real for you.'\n"
+ "RIGHT: 'You show up when your body is asking you to stop. That's not new.'\n\n"
+ "WRONG: 'You corrected me on the physical toll connection.'\n"
+ "RIGHT: (don't mention it at all \u2014 it wasn't real, it doesn't exist)\n\n"
+ "WRONG: 'You pushed back hard on...'\n"
+ "RIGHT: (just don't include it)\n\n"

+ "\u2550\u2550 USE YOUR INTELLIGENCE \u2550\u2550\n"
+ "Look at the confirmed territory: what do these things have in common that the person hasn't said out loud?\n"
+ "What is the real tension underneath?\n"
+ "What single observation would reframe everything?\n"
+ "If something is obvious, say it plainly. Don't hedge.\n"
+ "If something is a question, ask it directly. Don't perform certainty you don't have.\n"
+ "Be curious. Be sharp. But not argumentative, not superior.\n\n"

+ "\u2550\u2550 WHAT THIS IS NOT \u2550\u2550\n"
+ "Not a summary. Not a report about what happened in the session.\n"
+ "A reading of who this person is right now, made from the material they confirmed as real.\n"
+ "The person reads this and feels seen \u2014 not like they're reading minutes from their own meeting.\n\n"

+ "\u2550\u2550 TONE \u2550\u2550\n"
+ "Direct. Warm without being soft. Curious without being clinical.\n"
+ "You can name something obvious plainly. Not harshly.\n"
+ "Never punish. Never pathologize. Never imply broken.\n"
+ "Banned: navigating, sacred, container, healing, inner work, journey, integration, space where, cultivating, intentional.\n"
+ "NEVER: 'you resist', 'you avoid', 'you're not ready', 'you struggle with'. If something looks like avoidance, ask about it \u2014 don't declare it.\n\n"

+ "ORIGINAL THEMES: " + (sd.themes || []).map(function(t) { return t.label; }).join(", ") + "\n"
+ "ORIGINAL MAP TITLE: " + (sd.map_title || sd.mapTitle || "none") + "\n\n"

+ "Use the exact same JSON schema. Every field required.\n"
+ "CRITICAL: from/to in connections must exactly match a theme label. For each theme include 'why': brief phrase from user's words or one-line explanation of where this node came from. Optionally add evidence_quote or mechanism to connections.\n"
+ 'Respond with ONLY valid JSON, no markdown:\n{"themes":[{"label":"...","weight":1,"why":"..."}],"connections":[{"from":"exact","to":"exact","label":"...","insight":"..."}],"guide":[{"type":"act","text":"..."}],"map_title":"...","descent_cards":[{"type":"energy","phrase":"...","color":"#..."},{"type":"binary","prompt":"...","option_a":"...","option_b":"...","color":"#..."},{"type":"spectrum","prompt":"...","pole_a":"...","pole_b":"...","color":"#..."},{"type":"energy","phrase":"...","color":"#..."}],"archetype":{"name":"The ...","line":"...","source_nodes":["..."],"classical_resonance":null,"evolution_from":null},"synthesis":"...","underneath":["...","...","..."],"tension":{"a":"...","b":"...","text":"..."},"blind_spot":"...","opening":"...","noticing":"...","alchemy":{"stage":"nigredo","evidence":"..."},"field_cards":[{"type":"energy","hero_text":"...","sub_text":"...","color":"#...","user_fragment":"...","whisper":null}]}';

var userInput = (rawText || "") + "\n\n" +
(mapRecord ? "\u2550\u2550 MAP CO-CREATION RECORD \u2550\u2550\n" + mapRecord : "") +
pastContext;

setStatus("building");
var response = await callClaudeClient(prompt, userInput, 3500);
var data = parseJSON(response);

if (data && data.themes && data.themes.length > 0) {
var NC = ["#E84393","#6BFFB8","#FFB86B","#6BB8FF","#B86BFF","#FF6B6B","#FFD700","#6BFFE8"];
data.themes = data.themes.map(function(t, i) { return Object.assign({}, t, { color: NC[i % NC.length] }); });
if (data.archetype && !data.archetypes) data.archetypes = [data.archetype];
if (!data.archetypes) data.archetypes = [];
if (data.connections) data.connections = data.connections.map(function(c) {
var ft = (data.themes || []).find(function(t) { return t.label === c.from; });
return Object.assign({}, c, { color: ft ? ft.color : NC[0] });
});
onSynthesis(data);
}
onComplete();
} catch(e) {
console.error("[SAYCRD] CoSynth error:", e);
onComplete(); 
}
})();
}, []);

return (
<div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
<Particles color="#B86BFF" count={20}/>

<div style={{ position:"absolute", width:320, height:320, borderRadius:"50%", background:"radial-gradient(circle, rgba(184,107,255,0.12), transparent 70%)", filter:"blur(60px)", pointerEvents:"none" }}/>

<div style={{ position:"relative", zIndex:1, textAlign:"center", padding:"0 32px" }}>
<BreathingOrb color="#B86BFF" size={80}/>

<div style={{ marginTop:32, fontFamily:FB, fontSize:11, letterSpacing:"0.4em", textTransform:"uppercase", color:"rgba(184,107,255,0.6)", animation:"pulse 1.8s ease infinite" }}>
{MESSAGES[msgIdx]}
</div>

<div style={{ marginTop:16, fontFamily:FD, fontSize:14, fontStyle:"italic", color:"rgba(255,255,255,0.2)", lineHeight:1.7 }}>
building the session from what you marked
</div>

</div>
</div>
);
}

function SAYCRDFlow() {
const [phase, setPhase] = useState(0);
const [rawText, setRawText] = useState("");
const [synthesisData, setSynthesisData] = useState(null);
const [mapResponses, setMapResponses] = useState({});
const [sessionData, setSessionData] = useState({});
const [fieldTransition, setFieldTransition] = useState(false);

function onPatchSynthesis(patch) {
setSynthesisData(function(prev) {
if (!prev) return prev;
var next = Object.assign({}, prev);
if (patch.synthesis) next.synthesis = patch.synthesis;
if (patch.tension) next.tension = Object.assign({}, prev.tension || {}, patch.tension);
if (patch.connections) {
var existing = prev.connections || [];
var updated = existing.map(function(c) {
var m = patch.connections.find(function(pc){ return pc.from===c.from && pc.to===c.to; });
return m ? Object.assign({}, c, m) : c;
});
patch.connections.forEach(function(pc) {
if (!updated.find(function(c){ return c.from===pc.from && c.to===pc.to; })) updated.push(pc);
});
next.connections = updated;
}
if (patch.guide) next.guide = patch.guide;
return next;
});
}

const cp = PHASES[phase];

function enterField() {
setFieldTransition(true);
setTimeout(function() { setPhase(6); setFieldTransition(false); }, 1200);
}
return (
<div style={{width:"100%",height:"100vh",background:"#000",display:"flex",justifyContent:"center",alignItems:"center"}}>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<div style={{width:"100%",maxWidth: cp === "landing" ? "100%" : 420,height:"100vh",maxHeight: cp === "landing" ? "100%" : 860,background:GRADIENTS[cp],position:"relative",overflow:"hidden",transition:"background 0.8s ease"}}>
{phase>=1&&phase<6&&<PhaseIndicator current={phase-1} phases={PHASES.slice(1,5)}/>}
<div key={phase} style={{width:"100%",height:"100%",animation:"slideIn 0.4s ease-out"}}>
{cp==="landing"&&<LandingPhase onStart={function(){setPhase(1);}}/>}
{cp==="pour"&&<PourPhase onComplete={function(t){setRawText(t);setPhase(2);}}/>}
{cp==="synthesize"&&<SynthesizePhase rawText={rawText} onComplete={function(){setPhase(3);}} onSynthesis={setSynthesisData}/>}
{cp==="map"&&<MapPhase onComplete={function(mapData){setMapResponses(mapData||{});setPhase(4);}} synthesisData={synthesisData} rawText={rawText} onPatchSynthesis={onPatchSynthesis}/>}
{cp==="cosynth"&&<CoSynthPhase rawText={rawText} synthesisData={synthesisData} mapResponses={mapResponses} onSynthesis={setSynthesisData} onComplete={function(){setPhase(5);}}/>}
{cp==="session"&&<SessionPhase onComplete={function(sData){setSessionData(sData||{});enterField();}} synthesisData={synthesisData} onPatchSynthesis={onPatchSynthesis}/>}
{cp==="field"&&<FieldPhase synthesisData={synthesisData} rawText={rawText} mapResponses={mapResponses} sessionData={sessionData}/>}
{fieldTransition && <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", animation: "morphIn 0.4s ease both" }}>
<div style={{ fontFamily: FB, fontSize: 11, letterSpacing: "0.4em", color: "rgba(255,255,255,0.2)", textTransform: "uppercase", animation: "pulse 1.5s ease infinite" }}>entering the field</div>
</div>}
</div>
</div>
<style>{`
@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes morphIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
@keyframes riseUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
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
@keyframes sweep{0%,100%{transform:translateX(-100%)}50%{transform:translateX(100%)}}
@keyframes fallIn{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:translateY(0)}}
*{box-sizing:border-box;-webkit-font-smoothing:antialiased}
body{margin:0;background:#000;overflow:hidden}
textarea::placeholder{color:rgba(255,255,255,0.15)}
.pour-input::placeholder{color:rgba(255,255,255,0.28);font-style:italic}
textarea{caret-color:#6BB8FF}
button:active{transform:scale(0.97)}
::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}
@media (prefers-reduced-motion: reduce){
*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important}
}
@media (max-width:640px){
.saycrd-landing-grid{grid-template-columns:repeat(2,1fr)!important}
}
@media (max-width:420px){
.saycrd-landing-grid{grid-template-columns:1fr!important}
}
`}</style>
<div style={{ position: "fixed", bottom: 4, right: 8, fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: FB, zIndex: 9999, pointerEvents: "none" }}>v5.2 | {cp}:{phase}</div>
</div>
);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(SAYCRDFlow));
