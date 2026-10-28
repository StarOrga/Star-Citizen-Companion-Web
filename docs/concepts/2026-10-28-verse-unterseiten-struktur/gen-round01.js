// Generates round 01 of the verse-unterseiten concept.
const fs = require('fs');
const out = process.argv[2];

const css = `
<style>
/* ── shared mock vocabulary (prefix mock-) ── */
.mock-app { position: relative; width: 100%; height: 100%; min-height: 620px; overflow: hidden;
  background: radial-gradient(60% 50% at 22% 30%, rgba(40,110,170,.35), transparent 70%),
              radial-gradient(45% 40% at 78% 18%, rgba(110,60,160,.28), transparent 70%),
              radial-gradient(80% 60% at 50% 110%, rgba(30,120,170,.35), transparent 70%), #061420;
  color: #e8ebed; font-family: Inter, "Segoe UI", system-ui, sans-serif; font-size: 14px; }
.mock-stars { position: absolute; inset: 0; pointer-events: none; opacity: .75;
  background-image: radial-gradient(1px 1px at 12% 18%, #fff, transparent), radial-gradient(1px 1px at 33% 72%, #cfe8ff, transparent),
    radial-gradient(1.5px 1.5px at 58% 26%, #fff, transparent), radial-gradient(1px 1px at 81% 64%, #fff, transparent),
    radial-gradient(1px 1px at 91% 12%, #bfe, transparent), radial-gradient(1px 1px at 7% 88%, #fff, transparent),
    radial-gradient(1px 1px at 46% 50%, #dff, transparent), radial-gradient(1.5px 1.5px at 70% 85%, #fff, transparent);
  background-size: 340px 260px; }
.mock-dim { position: absolute; inset: 0; pointer-events: none; background: rgba(4,14,22,.55); }
.mock-disp { font-family: Orbitron, "Segoe UI", sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.mock-top { position: relative; z-index: 5; display: flex; align-items: center; gap: 28px; padding: 18px 40px; }
.mock-logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
.mock-logo i { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #52c1e6; box-shadow: 0 0 12px #52c1e6; }
.mock-logo small { display: block; font-size: 9px; color: #52c1e6; letter-spacing: .3em; }
.mock-nav { display: flex; gap: 34px; margin-left: 40px; font-size: 13px; color: #9fb3c8; }
.mock-nav b { color: #e8ebed; font-weight: 500; border-bottom: 2px solid #52c1e6; padding-bottom: 6px; }
.mock-nav em { color: #ff5722; font-style: normal; }
.mock-capsule { position: relative; z-index: 5; display: flex; align-items: center; gap: 6px; margin: 16px auto 0; width: min(1060px, calc(100% - 80px));
  padding: 6px 8px; border-radius: 14px; border: 1px solid rgba(82,193,230,.25); background: rgba(10,34,50,.72); }
.mock-capsule .mock-cap-area { padding: 7px 14px; border-radius: 10px; background: rgba(82,193,230,.12); color: #e8ebed; font-size: 12px; }
.mock-capsule a { padding: 7px 12px; border-radius: 9px; color: #9fb3c8; font-size: 12.5px; cursor: pointer; text-decoration: none; }
.mock-capsule a:hover { color: #e8ebed; }
.mock-capsule a.mock-on { background: rgba(82,193,230,.18); color: #e8ebed; box-shadow: inset 0 0 0 1px rgba(82,193,230,.4); }
.mock-capsule .mock-search { flex: 1; margin-left: 10px; padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(82,193,230,.2); color: #84a0b6; font-size: 12.5px; }
.mock-pl { position: absolute; border-radius: 50%; }
.mock-pl-news { background: repeating-linear-gradient(165deg, #f0d9cc 0 9%, #b9786a 9% 15%, #f6e4d9 15% 23%, #94574e 23% 27%);
  box-shadow: inset -16px -14px 28px rgba(0,0,0,.55), 0 0 26px rgba(82,193,230,.18); }
.mock-pl-patch { background: repeating-linear-gradient(45deg, rgba(0,0,0,.18) 0 2px, transparent 2px 9px), radial-gradient(circle at 35% 35%, #e0ae70, #8a5a2b 62%, #3b250f);
  box-shadow: inset -14px -12px 24px rgba(0,0,0,.5); }
.mock-pl-gal { background: radial-gradient(circle at 38% 34%, #ffffff, #c9d6e3 42%, #7a8ea3 78%, #3c4d5e); box-shadow: inset -18px -14px 30px rgba(0,0,0,.45), 0 0 30px rgba(200,230,255,.25); }
.mock-pl-map { background: radial-gradient(circle at 40% 40%, #1d4e6e, #0a2233 70%); box-shadow: 0 0 0 1px rgba(82,193,230,.5), 0 0 22px rgba(82,193,230,.3); }
.mock-pl-label { position: absolute; transform: translateX(-50%); font-size: 11px; letter-spacing: .22em; color: #cfe3f1; white-space: nowrap; }
.mock-sun { position: absolute; width: 110px; height: 110px; border-radius: 50%; background: radial-gradient(circle, #fffbe8 0 18%, #ffd27a 30%, rgba(255,180,60,0) 70%); }
.mock-horizon { position: absolute; left: -25%; right: -25%; bottom: -78%; height: 115%; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 0%, #2f86b6 0%, #0f4565 30%, #07202f 62%); box-shadow: 0 -6px 50px rgba(82,193,230,.5); }
.mock-hero { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); text-align: center; z-index: 3; }
.mock-hero .mock-k { font-size: 12px; color: #52c1e6; letter-spacing: .3em; }
.mock-hero .mock-big { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 64px; font-weight: 700; line-height: 1; margin-top: 8px; }
.mock-holo { position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%); width: min(620px, 70%); text-align: center; z-index: 3; }
.mock-holo .mock-k { font-size: 11px; color: #52c1e6; letter-spacing: .3em; }
.mock-holo h3 { margin: 6px 0; font-size: 26px; font-style: italic; font-weight: 600; }
.mock-hub-link { cursor: pointer; }
.mock-hub-link:hover .mock-pl { outline: 2px solid rgba(82,193,230,.7); outline-offset: 6px; }
.mock-const { position: absolute; }
.mock-const line { stroke: #cfe8ff; stroke-width: 1.4; opacity: .85; }
.mock-const circle { fill: #fff; }
.mock-const circle.mock-dark { fill: none; stroke: #9fb3c8; stroke-dasharray: 2 2; }
/* subpage grammar — identical on every subpage */
.mock-frame { position: relative; z-index: 3; width: min(1060px, calc(100% - 80px)); margin: 0 auto; }
.mock-ph { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 30px 0 18px; }
.mock-ph .mock-eye { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #52c1e6; letter-spacing: .26em; }
.mock-ph .mock-eye i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
.mock-ph h1 { margin: 8px 0 4px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 30px; font-weight: 600; letter-spacing: .04em; }
.mock-ph p { margin: 0; color: #9fb3c8; max-width: 60ch; }
.mock-ph-aside { display: flex; gap: 8px; align-items: center; color: #9fb3c8; font-size: 12px; }
.mock-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(82,193,230,.3); background: rgba(10,34,50,.6); color: #cfe3f1; font-size: 12px; }
.mock-sec { margin-top: 22px; }
.mock-sh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(82,193,230,.14); }
.mock-sh h2 { margin: 0; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #52c1e6; font-weight: 600; }
.mock-sh span { color: #84a0b6; font-size: 12px; }
.mock-sh a { margin-left: auto; color: #52c1e6; font-size: 12px; cursor: pointer; }
.mock-glass { border-radius: 14px; border: 1px solid rgba(82,193,230,.2); background: rgba(9,30,45,.68); }
.mock-kpis { display: grid; grid-template-columns: repeat(var(--mock-n, 4), minmax(0, 1fr)); gap: 10px; }
.mock-kpi { padding: 12px 14px; }
.mock-kpi b { display: block; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 20px; color: #52c1e6; }
.mock-kpi span { font-size: 11.5px; color: #9fb3c8; }
.mock-grid { display: grid; grid-template-columns: repeat(var(--mock-c, 4), minmax(0, 1fr)); gap: 12px; }
.mock-tile { overflow: hidden; }
.mock-tile .mock-img { height: 92px; background: linear-gradient(135deg, #24536f, #0b2232 60%, #3c2a4f); position: relative; }
.mock-tile .mock-img.mock-v2 { background: linear-gradient(160deg, #6b4a2e, #1b2a34 60%, #2c5a7a); }
.mock-tile .mock-img.mock-v3 { background: linear-gradient(120deg, #1d6f8f, #0a1f2c 55%, #7a3f2c); }
.mock-tile .mock-img.mock-v4 { background: linear-gradient(150deg, #44345f, #0d2433 60%, #2b6f6a); }
.mock-tile .mock-src { position: absolute; left: 8px; top: 8px; font-size: 9.5px; letter-spacing: .14em; padding: 3px 7px; border-radius: 6px; background: rgba(0,0,0,.55); }
.mock-tile p { margin: 0; padding: 9px 11px 11px; font-size: 12.5px; font-weight: 500; line-height: 1.35; }
.mock-stage { display: grid; grid-template-columns: 1.3fr 1fr; overflow: hidden; min-height: 190px; }
.mock-stage .mock-img { background: linear-gradient(120deg, #123a52, #091b28 50%, #2a4a63); min-height: 190px; }
.mock-stage .mock-body { padding: 20px 22px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
.mock-stage .mock-body small { color: #52c1e6; letter-spacing: .2em; font-size: 10.5px; }
.mock-stage .mock-body strong { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 19px; line-height: 1.2; }
.mock-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9px; background: #52c1e6; color: #04202e; font-weight: 600; font-size: 12px; border: 0; cursor: pointer; width: max-content; }
.mock-btn.mock-ghost { background: transparent; color: #cfe3f1; border: 1px solid rgba(82,193,230,.35); }
.mock-row { display: grid; grid-template-columns: 90px 1fr auto; align-items: center; gap: 14px; padding: 11px 14px; }
.mock-row + .mock-row { margin-top: 8px; }
.mock-row b { font-family: Orbitron, "Segoe UI", sans-serif; }
.mock-tag { font-size: 10px; letter-spacing: .14em; padding: 3px 8px; border-radius: 6px; background: rgba(82,193,230,.16); color: #52c1e6; }
.mock-tag.mock-warn { background: rgba(240,194,123,.15); color: #f0c27b; }
.mock-tag.mock-ok { background: rgba(95,214,152,.15); color: #5fd698; }
.mock-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.mock-panel { padding: 14px 16px; }
.mock-panel h3 { margin: 0 0 10px; font-size: 13.5px; }
.mock-check { display: flex; align-items: center; gap: 8px; padding: 6px 0; color: #cfe3f1; font-size: 12.5px; }
.mock-check i { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(82,193,230,.5); display: inline-block; }
.mock-check i.mock-done { background: #52c1e6; }
.mock-app-card { display: grid; grid-template-columns: 54px 1fr auto; gap: 14px; align-items: center; padding: 14px 16px; }
.mock-app-ico { width: 54px; height: 54px; border-radius: 14px; background: radial-gradient(circle at 35% 30%, #8fe3ff, #1d6f8f 60%, #0a2a3c); box-shadow: 0 0 18px rgba(82,193,230,.35); }
.mock-app-ico.mock-scc { background: radial-gradient(circle at 50% 50%, #0a2a3c 30%, transparent 31%), radial-gradient(circle, #52c1e6 0 46%, #0a2a3c 47%); }
.mock-app-card h3 { margin: 0; font-size: 14.5px; }
.mock-app-card p { margin: 3px 0 0; color: #9fb3c8; font-size: 12px; }
.mock-app-card small { color: #84a0b6; font-size: 11px; }
.mock-map { position: relative; height: 230px; }
.mock-map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.mock-back { display: inline-flex; gap: 6px; align-items: center; color: #9fb3c8; font-size: 12px; cursor: pointer; }

/* ── D1 · Anflug ── */
.d1-emblem { position: absolute; z-index: 1; border-radius: 50%; left: -150px; top: -170px; width: 460px; height: 460px; opacity: .55; filter: saturate(.9); }
.d1-emblem-news { background: repeating-linear-gradient(165deg, #f0d9cc 0 9%, #b9786a 9% 15%, #f6e4d9 15% 23%, #94574e 23% 27%); box-shadow: inset -60px -50px 90px rgba(0,0,0,.7); }
.d1-emblem-patch { background: repeating-linear-gradient(45deg, rgba(0,0,0,.18) 0 3px, transparent 3px 14px), radial-gradient(circle at 35% 35%, #e0ae70, #8a5a2b 62%, #3b250f); box-shadow: inset -60px -50px 90px rgba(0,0,0,.7); }
.d1-emblem-gal { background: radial-gradient(circle at 38% 34%, #ffffff, #c9d6e3 42%, #7a8ea3 78%, #3c4d5e); box-shadow: inset -60px -50px 90px rgba(0,0,0,.65); }
.d1-emblem-map { background: radial-gradient(circle at 40% 40%, #1d4e6e, #0a2233 70%); box-shadow: 0 0 0 2px rgba(82,193,230,.4), inset -60px -50px 90px rgba(0,0,0,.6); }
.d1-zoomstage { position: absolute; inset: 0; }
.d1-fly { position: absolute; border-radius: 50%; animation: d1-fly 2.6s cubic-bezier(.6,0,.2,1) infinite; }
@keyframes d1-fly { 0% { left: 4%; top: 61%; width: 118px; height: 118px; opacity: 1; } 55% { left: -6%; top: -18%; width: 560px; height: 560px; opacity: .8; } 100% { left: -150px; top: -170px; width: 460px; height: 460px; opacity: .55; } }
.d1-hubfade { position: absolute; inset: 0; animation: d1-fade 2.6s ease-in infinite; }
@keyframes d1-fade { 0% { opacity: 1; filter: blur(0); transform: scale(1); } 45% { opacity: 0; filter: blur(6px); transform: scale(1.08); } 100% { opacity: 0; } }
.d1-subin { position: absolute; inset: 0; animation: d1-in 2.6s ease-out infinite; }
@keyframes d1-in { 0%, 50% { opacity: 0; transform: translateY(24px); } 100% { opacity: 1; transform: none; } }
.d1-caption { position: absolute; right: 40px; bottom: 30px; z-index: 6; }

/* ── D2 · Holo-Deck ── */
.d2-hubbg { position: absolute; inset: 0; transform: scale(.94) translateY(-6%); filter: blur(2px) brightness(.55); transform-origin: 50% 0; }
.d2-sheet { position: absolute; z-index: 4; left: 50%; transform: translateX(-50%); bottom: 0; top: 128px; width: min(1120px, calc(100% - 48px));
  border-radius: 22px 22px 0 0; border: 1px solid rgba(82,193,230,.3); border-bottom: 0;
  background: linear-gradient(180deg, rgba(14,44,64,.92), rgba(7,24,36,.96) 40%); box-shadow: 0 -20px 60px rgba(0,0,0,.5), 0 -1px 0 rgba(82,193,230,.4); overflow: hidden; }
.d2-sheet .mock-frame { width: calc(100% - 64px); }
.d2-grip { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); width: 46px; height: 4px; border-radius: 4px; background: rgba(159,179,200,.5); }
.d2-tabs { position: absolute; z-index: 5; left: 50%; transform: translateX(-50%); top: 74px; display: flex; gap: 30px; align-items: flex-end; }
.d2-tab { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 10.5px; letter-spacing: .2em; color: #9fb3c8; cursor: pointer; }
.d2-tab .mock-pl { position: relative; width: 26px; height: 26px; }
.d2-tab.d2-on { color: #e8ebed; }
.d2-tab.d2-on .mock-pl { width: 40px; height: 40px; outline: 2px solid #52c1e6; outline-offset: 4px; }
.d2-close { position: absolute; z-index: 6; right: 46px; top: 140px; }
.d2-anim-sheet { animation: d2-up 2.4s cubic-bezier(.3,.7,.2,1) infinite; }
@keyframes d2-up { 0%, 15% { transform: translate(-50%, 100%); } 75%, 100% { transform: translate(-50%, 0); } }
.d2-anim-hub { animation: d2-back 2.4s ease infinite; }
@keyframes d2-back { 0%, 15% { transform: none; filter: none; } 75%, 100% { transform: scale(.94) translateY(-6%); filter: blur(2px) brightness(.55); } }

/* ── D3 · Kapitel ── */
.d3-rail { position: relative; z-index: 5; width: min(1060px, calc(100% - 80px)); margin: 18px auto 0; height: 64px; }
.d3-rail::before { content: ""; position: absolute; left: 4%; right: 4%; top: 22px; height: 1px; background: linear-gradient(90deg, rgba(82,193,230,.1), rgba(82,193,230,.55), rgba(82,193,230,.1)); }
.d3-stop { position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 10.5px; letter-spacing: .2em; color: #84a0b6; cursor: pointer; }
.d3-stop .mock-pl { position: relative; width: 22px; height: 22px; margin-top: 11px; }
.d3-stop.d3-on { color: #e8ebed; }
.d3-stop.d3-on .mock-pl { width: 44px; height: 44px; margin-top: 0; outline: 2px solid #52c1e6; outline-offset: 4px; }
.d3-hubstop .mock-pl { background: radial-gradient(circle at 50% 0%, #2f86b6, #07202f 70%); }
.d3-pan { position: absolute; inset: 0; }
.d3-out { animation: d3-out 2.4s ease-in-out infinite; }
@keyframes d3-out { 0% { transform: none; opacity: 1; } 60%, 100% { transform: translateX(-42%); opacity: 0; } }
.d3-in { animation: d3-in 2.4s ease-in-out infinite; }
@keyframes d3-in { 0%, 30% { transform: translateX(42%); opacity: 0; } 100% { transform: none; opacity: 1; } }
.d3-bgpan { animation: d3-bg 2.4s ease-in-out infinite; }
@keyframes d3-bg { 0% { background-position: 0 0; } 100% { background-position: -260px 0; } }
.d3-scene-shift { position: absolute; inset: 0; transform: translateX(-12%); }
</style>`;

const top = () => `
  <div class="mock-top">
    <div class="mock-logo"><i></i><div><span class="mock-disp">Star Citizen Companion</span><small>ALPHA</small></div></div>
    <div class="mock-nav mock-disp"><b>Verse</b><span>Codex</span><span>HQ</span><em>Admin</em></div>
  </div>`;

const capsule = (d, on, tabs = true) => {
  const t = [['News', 3], ['Patches', 4], ['Galerie', 5], ['Sternkarte', 6]];
  return `
  <div class="mock-capsule">
    <a class="mock-cap-area mock-disp" data-screen-link="${d}-s1">◉ Verse</a>
    ${tabs ? t.map(([l, n]) => `<a class="${l === on ? 'mock-on' : ''}" data-screen-link="${d}-s${n}">${l}</a>`).join('') : ''}
    <div class="mock-search">🔍 Suche in Schiffen, Patches, News …</div>
  </div>`;
};

const constellation = (w, h, x, y) => `
  <svg class="mock-const" viewBox="0 0 100 100" style="width:${w}px;height:${h}px;left:${x};top:${y}">
    <line x1="30" y1="8" x2="70" y2="70"/><line x1="70" y1="70" x2="44" y2="88"/>
    <circle cx="30" cy="8" r="3"/><circle cx="70" cy="70" r="3"/><circle cx="44" cy="88" r="2"/>
    <circle class="mock-dark" cx="12" cy="66" r="2.4"/><circle class="mock-dark" cx="24" cy="84" r="2.4"/>
  </svg>`;

// The hub (same in every design: the user's screenshot of /verse)
const hub = (d, hint) => `
  <div class="mock-app">
    <div class="mock-stars"></div>
    ${top()}
    <div class="mock-sun" style="right:9%;top:22%"></div>
    ${constellation(80, 100, '80%', '40%')}
    <a class="mock-hub-link" data-screen-link="${d}-s2"><div class="mock-pl mock-pl-news" style="left:4%;top:61%;width:118px;height:118px"></div><span class="mock-pl-label mock-disp" style="left:calc(4% + 59px);top:calc(61% + 128px)">News</span></a>
    <a class="mock-hub-link" data-screen-link="${d}-s4"><div class="mock-pl mock-pl-patch" style="left:15%;top:55%;width:86px;height:86px"></div><span class="mock-pl-label mock-disp" style="left:calc(15% + 43px);top:calc(55% + 96px)">Patches</span></a>
    <a class="mock-hub-link" data-screen-link="${d}-s5"><div class="mock-pl mock-pl-gal" style="left:81%;top:52%;width:116px;height:116px"></div><span class="mock-pl-label mock-disp" style="left:calc(81% + 58px);top:calc(52% + 126px)">Galerie</span></a>
    <a class="mock-hub-link" data-screen-link="${d}-s6"><span class="mock-pl-label mock-disp" style="left:84%;top:calc(40% + 108px)">Sternkarte</span></a>
    <div class="mock-hero"><div class="mock-k mock-disp">Patches</div><div class="mock-big">4.10</div></div>
    <div class="mock-horizon"></div>
    <div class="mock-holo"><div class="mock-k mock-disp">News</div><h3>First Time Running Storm Breaker</h3></div>
    ${hint}
  </div>`;

// ── page grammar blocks ──
const ph = (eyeCls, eye, title, sub, aside) => `
    <header class="mock-ph">
      <div>
        <div class="mock-eye mock-disp"><i class="mock-pl ${eyeCls}" style="position:relative"></i>Verse · ${eye}</div>
        <h1>${title}</h1>
        <p>${sub}</p>
      </div>
      <div class="mock-ph-aside">${aside}</div>
    </header>`;

const sh = (title, meta, link) => `<div class="mock-sh"><h2>${title}</h2>${meta ? `<span>${meta}</span>` : ''}${link ? `<a>${link}</a>` : ''}</div>`;

const newsBody = () => `
    ${ph('mock-pl-news', 'News', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.', '<span class="mock-chip">● aktualisiert gerade eben</span>')}
    <section class="mock-sec">
      ${sh('Auf der Bühne', 'vor 2 Tagen · YouTube')}
      <div class="mock-glass mock-stage">
        <div class="mock-img"></div>
        <div class="mock-body"><small class="mock-disp">YouTube</small><strong>First Time Running Storm Breaker</strong>
          <span style="color:#9fb3c8;font-size:12.5px">Raise your hand if you've ever felt personally victimized by the valakkar.</span>
          <span style="display:flex;gap:8px"><button class="mock-btn">Ansehen →</button><button class="mock-btn mock-ghost">☆ Merken</button></span></div>
      </div>
    </section>
    <section class="mock-sec">
      ${sh('Feed', '48 Beiträge', 'Gemerkt (0)')}
      <div class="mock-grid">
        <div class="mock-glass mock-tile"><div class="mock-img"><span class="mock-src">SPECTRUM</span></div><p>Updates to Pledge Gifting – FAQ</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v2"><span class="mock-src">YOUTUBE</span></div><p>Your Favourite Spot in the ’Verse</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v3"><span class="mock-src">YOUTUBE</span></div><p>Jump Points in Star Citizen</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v4"><span class="mock-src">COMM-LINK</span></div><p>10 From the Community</p></div>
      </div>
    </section>`;

const patchBody = () => `
    ${ph('mock-pl-patch', 'Patches', 'Patches', 'Was live ist, was kommt – und ob du bereit bist.', '<span class="mock-chip">LIVE 4.10 · Stabilität 72 %</span>')}
    <div class="mock-kpis" style="--mock-n:5">
      <div class="mock-glass mock-kpi"><b>4.10</b><span>LIVE seit 11 Tagen</span></div>
      <div class="mock-glass mock-kpi"><b>72 %</b><span>Stabilität</span></div>
      <div class="mock-glass mock-kpi"><b>~9 Tg.</b><span>bis 4.11 (Schätzung)</span></div>
      <div class="mock-glass mock-kpi"><b>3</b><span>Hotfixes in 4.10</span></div>
      <div class="mock-glass mock-kpi"><b>2 / 4</b><span>Vorbereitung</span></div>
    </div>
    <section class="mock-sec">
      ${sh('Bereit für 4.11', 'Checkliste & Tipp')}
      <div class="mock-two">
        <div class="mock-glass mock-panel"><h3>Vorbereitung</h3>
          <div class="mock-check"><i class="mock-done"></i>Patch Notes gelesen</div><div class="mock-check"><i class="mock-done"></i>Keybinds geprüft</div>
          <div class="mock-check"><i></i>Loadout gesichert</div><div class="mock-check"><i></i>Shader-Cache geleert</div></div>
        <div class="mock-glass mock-panel"><h3>Kometen-Tipp: Wann kommt 4.11?</h3>
          <p style="color:#9fb3c8;margin:0 0 10px;font-size:12.5px">Median der Community: 6. November · 214 Tipps</p>
          <button class="mock-btn">Datum tippen</button></div>
      </div>
    </section>
    <section class="mock-sec">
      ${sh('Zeitleiste', 'alle Linien', 'Archiv')}
      <div class="mock-glass mock-row"><b>4.11</b><span>PTU Wave 2 · 18 Builds</span><span class="mock-tag mock-warn">PTU</span></div>
      <div class="mock-glass mock-row"><b>4.10.1</b><span>Hotfix · Inventar &amp; Elevator</span><span class="mock-tag">HOTFIX</span></div>
      <div class="mock-glass mock-row"><b>4.10</b><span>LIVE · Storm Breaker, Valakkar</span><span class="mock-tag mock-ok">LIVE</span></div>
    </section>`;

const appCard = (cls, name, val, meta) => `
        <div class="mock-glass mock-app-card"><div class="mock-app-ico ${cls}"></div>
          <div><h3>${name}</h3><p>${val}</p><small>${meta}</small></div>
          <button class="mock-btn">⬇ Download</button></div>`;

const galBody = () => `
    ${ph('mock-pl-gal', 'Galerie', 'Galerie', 'Wallpaper aus dem Verse – und deine vollendeten Sternbilder.', '<span class="mock-chip">128 Bilder</span>')}
    <section class="mock-sec">
      ${sh('App', 'Starscape', 'Alle Apps')}
      ${appCard('', 'Starscape', 'Wechselt dein Windows-Wallpaper automatisch durch diese Galerie.', 'Windows · v0.9.4 · 14 MB')}
    </section>
    <section class="mock-sec">
      ${sh('Wallpaper', 'neueste zuerst', 'Meine Sternbilder')}
      <div class="mock-grid" style="--mock-c:5">
        ${['', 'mock-v2', 'mock-v3', 'mock-v4', '', 'mock-v3', 'mock-v4', 'mock-v2', '', 'mock-v3'].map((v) => `<div class="mock-glass mock-tile"><div class="mock-img ${v}" style="height:78px"></div></div>`).join('')}
      </div>
    </section>`;

const mapSvg = () => `
        <svg viewBox="0 0 600 230" preserveAspectRatio="xMidYMid meet">
          <g stroke="#cfe8ff" stroke-width="1.3" opacity=".9"><line x1="180" y1="60" x2="260" y2="40"/><line x1="260" y1="40" x2="330" y2="90"/><line x1="330" y1="90" x2="420" y2="70"/><line x1="330" y1="90" x2="300" y2="170"/><line x1="300" y1="170" x2="390" y2="190"/></g>
          <g fill="#fff"><circle cx="180" cy="60" r="4"/><circle cx="260" cy="40" r="5"/><circle cx="330" cy="90" r="5"/><circle cx="420" cy="70" r="4"/><circle cx="300" cy="170" r="4"/></g>
          <g fill="none" stroke="#9fb3c8" stroke-dasharray="3 3"><circle cx="390" cy="190" r="4"/><circle cx="470" cy="130" r="4"/><circle cx="130" cy="140" r="4"/></g>
        </svg>`;

const mapBody = () => `
    ${ph('mock-pl-map', 'Sternkarte', 'Sternkarte', 'Jede Patch-Aufgabe entzündet einen Stern – vollende das Sternbild.', '<span class="mock-chip">✦ Kartograph-Abzeichen · Rang 3</span>')}
    <div class="mock-kpis" style="--mock-n:4">
      <div class="mock-glass mock-kpi"><b>7 / 12</b><span>Sterne in 4.10</span></div>
      <div class="mock-glass mock-kpi"><b>4</b><span>Sternbilder vollendet</span></div>
      <div class="mock-glass mock-kpi"><b>Rang 3</b><span>Kartograph-Abzeichen</span></div>
      <div class="mock-glass mock-kpi"><b>1 Tipp</b><span>Welches Schiff ist es?</span></div>
    </div>
    <section class="mock-sec">
      ${sh('Sternbild von Patch 4.10', '7 von 12 Sternen', 'Wallpaper exportieren')}
      <div class="mock-map">${mapSvg()}</div>
    </section>
    <section class="mock-sec">
      ${sh('Meine Sternbilder', '4 vollendet', 'In der Galerie')}
      <div class="mock-grid" style="--mock-c:6">
        ${['4.9', '4.8', '4.7', '4.6'].map((p) => `<div class="mock-glass mock-tile"><div class="mock-img mock-v4" style="height:54px"></div><p>Patch ${p}</p></div>`).join('')}
      </div>
    </section>`;

const bodies = { 3: ['News', 'mock-pl-news', newsBody], 4: ['Patches', 'mock-pl-patch', patchBody], 5: ['Galerie', 'mock-pl-gal', galBody], 6: ['Sternkarte', 'mock-pl-map', mapBody] };
const emblem = { 3: 'd1-emblem-news', 4: 'd1-emblem-patch', 5: 'd1-emblem-gal', 6: 'd1-emblem-map' };

const anno = (id, n, side, target, q, xy = '50%;--anno-y:30%') => `
    <div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${target}" style="--anno-x:${xy}">
      <button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="Frage ${n}">${n}</button>
      <div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false">
        <button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}">
          <span class="anno-bubble-question">${q}</span>
        </button>
        <div class="anno-bubble-body">
          <textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea>
          <div class="attach-slot" data-attach-slot="anno-${id}"></div>
        </div>
      </div>
    </div>`;
const layer = (annos) => (annos.length ? `\n  <div class="anno-layer" data-anno-layer>${annos.join('')}\n  </div>` : '');

const screen = (id, label, inner, annos = [], active = false) => `
 <section id="${id}" data-nav-label="${label}" data-screen${active ? ' data-screen-active="true"' : ' hidden'}>
${inner}${layer(annos)}
 </section>`;

// ── D1 ──
function d1() {
  const d = 'd1';
  const sub = (n) => {
    const [name, , body] = bodies[n];
    return `
  <div class="mock-app">
    <div class="mock-stars"></div>
    <div class="mock-horizon" style="bottom:-96%;opacity:.5"></div>
    <div class="d1-emblem ${emblem[n]}"></div>
    <div class="mock-dim" style="background:rgba(4,14,22,.4)"></div>
    ${capsule(d, name)}
    <div class="mock-frame">${body()}</div>
  </div>`;
  };
  const trans = `
  <div class="mock-app">
    <div class="mock-stars"></div>
    <div class="d1-hubfade">${top()}<div class="mock-sun" style="right:9%;top:22%"></div><div class="mock-hero"><div class="mock-k mock-disp">Patches</div><div class="mock-big">4.10</div></div><div class="mock-horizon"></div></div>
    <div class="d1-fly mock-pl-news"></div>
    <div class="d1-subin">${capsule(d, 'News')}<div class="mock-frame">${ph('mock-pl-news', 'News', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.', '')}</div></div>
    <a class="mock-btn d1-caption" data-screen-link="${d}-s3">Weiter zur Seite →</a>
  </div>`;
  return `
<section data-design="d1" data-nav-label="Anflug" data-design-active="true" data-screen-fit="full"
  data-design-motto="Die Kamera fliegt hin."
  data-design-traits="Kamera zoomt auf den angeklickten Planeten|Planet bleibt als Wappen oben links stehen|Hub verschwindet ganz, Szene gedimmt dahinter"
  data-design-icon="rocket" data-design-color="#c9845f" data-design-overlay="br">
${screen('d1-s1', 'Hub', hub(d, ''), [
    anno('d1-s1-a1', 1, 'right', '.mock-hub-link', 'Ein Klick auf einen Planeten löst den Anflug aus. Soll auch die Kopfnavigation (Capsule-Tabs) denselben Flug zeigen, oder dort nur ein kurzer Schnitt?'),
  ], true)}
${screen('d1-s2', 'Übergang', trans, [
    anno('d1-s2-a1', 1, 'right', '.d1-fly', 'Anflug-Dauer: ~0,9 s (Kamera-Dolly + Ausblenden), unter „reduzierte Bewegung“ nur Crossfade. Zu lang, zu kurz?', '20%;--anno-y:40%'),
    anno('d1-s2-a2', 2, 'left', '.d1-caption', 'Zurück zum Hub: Der Planet schrumpft wieder auf seine Bahn. Auch beim Browser-Zurück, oder nur über „◉ Verse“?', '80%;--anno-y:85%'),
  ])}
${screen('d1-s3', 'News', sub(3), [
    anno('d1-s3-a1', 1, 'right', '.d1-emblem', 'Der angeflogene Planet bleibt angeschnitten oben links als Wappen der Seite. Passt das, oder soll er nach dem Flug ganz verschwinden?', '12%;--anno-y:16%'),
    anno('d1-s3-a2', 2, 'bottom', '.mock-stage', 'Die Bühne liegt jetzt IM Seitenrahmen (gleiche Breite wie der Feed) statt randlos. So gewollt?'),
  ])}
${screen('d1-s4', 'Patches', sub(4), [
    anno('d1-s4-a1', 1, 'bottom', '.mock-kpis', 'Kennzahlen-Leiste direkt unter dem Kopf, auf jeder Unterseite an derselben Stelle (News hat keine). Reicht die Reihenfolge Kopf → Kennzahlen → Abschnitte?'),
  ])}
${screen('d1-s5', 'Galerie', sub(5))}
${screen('d1-s6', 'Sternkarte', sub(6), [
    anno('d1-s6-a1', 1, 'top', '.mock-map', 'Das Sternbild steht direkt auf der Szene – keine große Box mehr um den Inhalt. Braucht die Karte trotzdem eine dezente Fläche für Lesbarkeit?'),
  ])}
</section>`;
}

// ── D2 ──
function d2() {
  const d = 'd2';
  const tabs = (on) => `
    <div class="d2-tabs">
      ${[['News', 'mock-pl-news', 3], ['Patches', 'mock-pl-patch', 4], ['Galerie', 'mock-pl-gal', 5], ['Sternkarte', 'mock-pl-map', 6]]
        .map(([l, c, n]) => `<a class="d2-tab mock-disp${l === on ? ' d2-on' : ''}" data-screen-link="${d}-s${n}"><span class="mock-pl ${c}"></span>${l}</a>`).join('')}
    </div>`;
  const sub = (n) => {
    const [name, , body] = bodies[n];
    return `
  <div class="mock-app">
    <div class="d2-hubbg">${hub(d, '')}</div>
    ${tabs(name)}
    <a class="mock-chip d2-close" data-screen-link="${d}-s1">✕ zum Hub</a>
    <div class="d2-sheet"><span class="d2-grip"></span><div class="mock-frame">${body()}</div></div>
  </div>`;
  };
  const trans = `
  <div class="mock-app">
    <div class="d2-hubbg d2-anim-hub" style="transform:none;filter:none">${hub(d, '')}</div>
    <div class="d2-sheet d2-anim-sheet"><span class="d2-grip"></span><div class="mock-frame">${ph('mock-pl-news', 'News', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.', '')}</div></div>
    <a class="mock-btn d1-caption" data-screen-link="${d}-s3">Weiter zur Seite →</a>
  </div>`;
  return `
<section data-design="d2" data-nav-label="Holo-Deck" hidden data-screen-fit="full"
  data-design-motto="Der Hub bleibt im Raum."
  data-design-traits="Unterseite fährt als Holo-Blatt vom Horizont hoch|Hub bleibt gedimmt dahinter sichtbar|Planeten werden zu Tabs am Blattrand"
  data-design-icon="layers" data-design-color="#6c8fb3" data-design-overlay="bl">
${screen('d2-s1', 'Hub', hub(d, ''), [], true)}
${screen('d2-s2', 'Übergang', trans, [
    anno('d2-s2-a1', 1, 'top', '.d2-sheet', 'Das Blatt fährt vom Planetenhorizont hoch, der Hub kippt leicht nach hinten und dimmt ab. Soll die Kamera dabei mitkippen (Blick auf die Oberfläche)?', '50%;--anno-y:60%'),
  ])}
${screen('d2-s3', 'News', sub(3), [
    anno('d2-s3-a1', 1, 'bottom', '.d2-tabs', 'Die Planeten sind die Tabs über dem Blatt. Wechsel News → Patches: Blatt schiebt seitlich, der neue Planet springt in die Mitte. Ersetzt das die Capsule-Tabs komplett?'),
    anno('d2-s3-a2', 2, 'left', '.d2-close', '„✕ zum Hub“ senkt das Blatt wieder ab. Zusätzlich Wischen/Ziehen am Griff nach unten?'),
  ])}
${screen('d2-s4', 'Patches', sub(4), [
    anno('d2-s4-a1', 1, 'top', '.d2-grip', 'Wie hoch soll das Blatt stehen? Jetzt bleiben oben ~130 px Hub sichtbar. Mehr Hub (Atmosphäre) oder mehr Inhalt?'),
  ])}
${screen('d2-s5', 'Galerie', sub(5))}
${screen('d2-s6', 'Sternkarte', sub(6), [
    anno('d2-s6-a1', 1, 'top', '.mock-map', 'Auf dem Holo-Blatt steht die Sternkarte auf dunklem Blatt-Grund statt auf der Szene. Stört das den „Himmel“-Charakter?'),
  ])}
</section>`;
}

// ── D3 ──
function d3() {
  const d = 'd3';
  const pos = { Hub: 6, News: 27, Patches: 50, Galerie: 73, Sternkarte: 94 };
  const rail = (on) => `
    <div class="d3-rail">
      ${[['Hub', 'd3-hubstop', '', 1], ['News', '', 'mock-pl-news', 3], ['Patches', '', 'mock-pl-patch', 4], ['Galerie', '', 'mock-pl-gal', 5], ['Sternkarte', '', 'mock-pl-map', 6]]
        .map(([l, extra, c, n]) => `<a class="d3-stop mock-disp ${extra}${l === on ? ' d3-on' : ''}" style="left:${pos[l]}%" data-screen-link="${d}-s${n}"><span class="mock-pl ${c}"></span>${l}</a>`).join('')}
    </div>`;
  const sub = (n) => {
    const [name, , body] = bodies[n];
    return `
  <div class="mock-app">
    <div class="mock-stars" style="background-position:${-(n - 2) * 90}px 0"></div>
    <div class="mock-horizon" style="bottom:-100%;left:${-25 - (n - 2) * 12}%;right:${-25 + (n - 2) * 12}%;opacity:.45"></div>
    ${capsule(d, name, false)}
    ${rail(name)}
    <div class="mock-frame">${body()}</div>
  </div>`;
  };
  const trans = `
  <div class="mock-app">
    <div class="mock-stars d3-bgpan"></div>
    ${capsule(d, 'News', false)}
    ${rail('News')}
    <div class="d3-pan d3-out"><div class="mock-hero"><div class="mock-k mock-disp">Patches</div><div class="mock-big">4.10</div></div><div class="mock-horizon"></div></div>
    <div class="d3-pan d3-in" style="top:150px"><div class="mock-frame">${ph('mock-pl-news', 'News', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.', '')}</div></div>
    <a class="mock-btn d1-caption" data-screen-link="${d}-s3">Weiter zur Seite →</a>
  </div>`;
  return `
<section data-design="d3" data-nav-label="Kapitel" hidden data-screen-fit="full"
  data-design-motto="Eine Reise, fünf Stationen."
  data-design-traits="Kamera schwenkt seitlich entlang einer Umlaufbahn|Feste Reihenfolge Hub → News → Patches → Galerie → Sternkarte|Stationsleiste zeigt immer, wo du bist"
  data-design-icon="compass" data-design-color="#5f9e86" data-design-overlay="tr">
${screen('d3-s1', 'Hub', hub(d, ''), [], true)}
${screen('d3-s2', 'Übergang', trans, [
    anno('d3-s2-a1', 1, 'bottom', '.d3-rail', 'Die Kamera schwenkt in Leserichtung: weiter rechts = weiter in der Reise. Von Galerie zurück zu News schwenkt sie nach links. Ist die feste Reihenfolge richtig?'),
  ])}
${screen('d3-s3', 'News', sub(3), [
    anno('d3-s3-a1', 1, 'bottom', '.d3-rail', 'Die Stationsleiste ersetzt die Capsule-Tabs. Soll sie beim Scrollen oben kleben bleiben (schmal) oder mitscrollen?'),
    anno('d3-s3-a2', 2, 'top', '.mock-horizon', 'Der große Planet bleibt als Horizont sichtbar und wandert je Station ein Stück mit. Genug Wiedererkennung zum Hub, oder zu wenig?', '50%;--anno-y:90%'),
  ])}
${screen('d3-s4', 'Patches', sub(4))}
${screen('d3-s5', 'Galerie', sub(5), [
    anno('d3-s5-a1', 1, 'top', '.mock-app-card', 'Die App-Karte steht als eigener Abschnitt „App“ – gleicher Abschnittskopf wie alles andere, kein Sonder-Hero mehr. Passt der Platz direkt unter dem Kopf?'),
  ])}
${screen('d3-s6', 'Sternkarte', sub(6))}
</section>`;
}

// ── views ──
const evalBlock = (id, label, h, p, include) => `
    <div class="variant-evaluation" data-decision="${id}" data-label="${label}">
      <h3>${h}</h3>
      ${p}
      <div class="eval-group">
        <label class="eval-option"><input type="radio" name="eval-${id}" value="discard"${include ? '' : ' checked'}><span class="eval-label">Verwerfen</span></label>
        <label class="eval-option"><input type="radio" name="eval-${id}" value="include"${include ? ' checked' : ''}><span class="eval-label">Miteinbeziehen</span></label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="${id}-note">{{decision.comment_label}}</label>
        <textarea id="${id}-note" data-comment="${id}-note" data-attachable placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>`;

const views = `
<section data-view="v1-raster" data-view-kind="decision" data-nav-label="Seitenraster" hidden>
  <div class="view-frame">
    <h2>Welches Grundgerüst bekommen alle vier Unterseiten?</h2>
    <p><strong>Befund (aus dem Code):</strong> Mit dem Shell-β sind alle vier Unterseiten <code>layout: cinematic</code> und füllen die volle Spur – ohne Seitenrand, deshalb läuft alles bis an den Rand. Die Köpfe sind dreimal verschieden: News hat nur eine Eyebrow und die Bühnen-Schlagzeile als &lt;h1&gt;, Patches und Galerie Titel + Untertitel, die Sternkarte gar keinen Seitenkopf, dafür eine eigene undurchsichtige Box (Radius 14, fast schwarz), die die gemeinsame Szene verdeckt. Abstände schwanken zwischen 10, 12, 14, 16 und 18 px.</p>
    <p>Die drei Designs zeigen alle dasselbe Raster (Kopf mit Eyebrow · H1 · Untertitel · Aside → optionale Kennzahlen-Leiste → Abschnitte mit gleichem Abschnittskopf, alles im Seitenrahmen 1280–1600 px). Hier geht es darum, ob dieses Raster gilt – unabhängig davon, welcher Übergang gewinnt.</p>
${evalBlock('v1-all', 'Ein Raster für alle vier', 'Ein Raster für alle vier, Sternkarte eingeschlossen', '<p>Kopf, Kennzahlen, Abschnitte – auf News, Patches, Galerie und Sternkarte gleich. Die Sternkarte verliert ihre Box und steht als Abschnitt „Sternbild von Patch X“ auf der Szene. Inhalt bleibt im Seitenrahmen, nichts mehr randlos. <em>Empfehlung:</em> Nur so wird die Sternkarte „vom groben Aufbau wiedererkennbar“, wie gewünscht.</p>', true)}
${evalBlock('v1-stage', 'Sternkarte bleibt Bühne', 'Raster für drei, Sternkarte bleibt Vollbild-Bühne', '<p>News, Patches, Galerie bekommen das Raster; die Sternkarte behält ihre Vollbild-Kuppel, aber ohne Box und mit demselben Kopf darüber. Mehr Platz für die Karte, schwächere Wiedererkennung.</p>', false)}
${evalBlock('v1-bleed', 'Randlos lassen', 'Randlos lassen, nur Köpfe angleichen', '<p>Inhalte bleiben in voller Breite, nur die Köpfe werden gleich. Kleinste Änderung, löst aber das „alles bis zum Rand“ nicht.</p>', false)}
  </div>
</section>

<section data-view="v2-technik" data-view-kind="decision" data-nav-label="Übergangs-Technik" hidden>
  <div class="view-frame">
    <h2>Womit bauen wir die Kamera-Übergänge?</h2>
    <p><strong>Befund:</strong> Die Szene (<code>sc-shell-scene</code>) liegt schon einmal im Shell und ist für alle <code>/verse/*</code>-Pfade dieselbe Pose. Die Regel <code>sceneStep</code> bewegt die Kamera nur zwischen Hauptseiten; Hub → Unterseite ist heute ein Schnitt („still“), Unterseite ↔ Unterseite gar nichts. Der Inhalt blendet nur per <code>routeReveal</code> ein. View Transitions nutzt bisher nur das Codex-Arsenal.</p>
${evalBlock('v2-vt', 'View Transitions + Szenen-Posen', 'View Transitions + Kamera-Posen pro Unterseite', '<p>Jede Unterseite bekommt eine eigene Kamera-Pose in der gemeinsamen Szene (Position/Zoom als CSS-Variablen, Übergang per Transition). Inhalt wechselt per <code>document.startViewTransition</code> mit benannten Elementen (z. B. der Planet als <code>view-transition-name</code> fliegt vom Hub ins Wappen). Funktioniert in Chromium und Safari, Firefox fällt auf Crossfade zurück. <em>Empfehlung:</em> nutzt, was da ist (eine Szene, Codex hat das Muster schon).</p>', true)}
${evalBlock('v2-anim', 'Angular Route-Animationen', 'Angular-Route-Animationen erweitern', '<p><code>routeReveal</code> um Kamera-Schritte ergänzen. Ohne View Transitions lässt sich kein Element (Planet) zwischen Seiten „mitnehmen“, und <code>@angular/animations</code> ist in Angular 20+ auf dem Abstellgleis.</p>', false)}
${evalBlock('v2-webgl', '3D-Szene (WebGL)', 'Echte 3D-Szene mit WebGL', '<p>Planeten als 3D-Objekte, Kamera echt im Raum. Größter Effekt, aber neues Paket (three.js, ~150 KB), Mobile-Akku und eigener Render-Loop.</p>', false)}
${evalBlock('v2-fade', 'Nur Überblenden', 'Kein Kamera-Flug, nur weiches Überblenden', '<p>Hub blendet aus, Unterseite ein, Szene bleibt stehen. Billig und robust – aber genau das „Kamera bewegt sich“ fehlt dann.</p>', false)}
  </div>
</section>

<section data-view="v3-apps" data-view-kind="decision" data-nav-label="App-Downloads" hidden>
  <div class="view-frame">
    <h2>Wie zeigen wir die Desktop-Apps (SCC App, Starscape)?</h2>
    <p><strong>Befund:</strong> Download-Flächen gibt es heute an sieben Stellen in vier Stilen: Starscape-Hero bzw. Pille + Menü in der Galerie, zusätzlich eine <code>.app-cta</code> im Starscape-Kopf (die Galerie zeigt dadurch <em>zwei</em> Download-Menüs), das Download-Menü auf der Codex-Startseite und den Status-Chip mit der SCC App im Shell. Es gibt keine Stelle, an der man „alle Apps“ sieht.</p>
    <p>In allen drei Designs ist eine einheitliche <strong>App-Karte</strong> eingezeichnet (Icon · Name · ein Satz Nutzen · Plattform/Version · Download). Die Frage ist, wo diese Karten leben.</p>
${evalBlock('v3-context', 'App-Karte im Kontext + Apps-Seite', 'App-Karte dort, wo die App hilft – plus eine Seite „Apps“', '<p>Starscape als Karte in der Galerie, SCC App als Karte bei Patches (Patch-Bereitschaft) und im Codex. Jede Karte hat „Alle Apps →“ zu einer schlichten Seite <code>/apps</code> mit allen Karten (auch Browser-Erweiterung). Ein Bauteil, überall gleich. <em>Empfehlung:</em> Die App wird da entdeckt, wo sie Sinn ergibt, und hat trotzdem ein Zuhause.</p>', true)}
${evalBlock('v3-only-context', 'Nur im Kontext', 'Nur im Kontext, keine Sammelseite', '<p>Wie oben, aber ohne <code>/apps</code>. Weniger Pflege; wer die SCC App sucht, muss wissen, wo sie liegt.</p>', false)}
${evalBlock('v3-station', 'Eigener Planet „Hangar“', 'Eigener Ort im Hub: Station „Apps“', '<p>Ein weiteres Objekt im Hub (z. B. eine Raumstation neben den Planeten) führt zur Apps-Seite. Sehr sichtbar, aber es nimmt den Verse-Inhalten Bühne und Apps sind kein Verse-Thema.</p>', false)}
${evalBlock('v3-menu', 'Menü in der Kopfleiste', 'Globales „Apps“-Menü in der Kopfleiste', '<p>Ein Eintrag/Icon oben rechts mit einem Dropdown aller Downloads. Immer erreichbar, aber ohne Kontext („warum brauche ich das?“).</p>', false)}
${evalBlock('v3-profile', 'Im Profilmenü', 'Downloads im Profilmenü / in den Einstellungen', '<p>Unauffällig und aufgeräumt, aber für Neue praktisch unsichtbar.</p>', false)}
  </div>
</section>

<section data-view="v4-begriffe" data-view-kind="decision" data-nav-label="Begriffe & Profilmenü" hidden>
  <div class="view-frame">
    <h2>Welche Begriffe gelten, und bleibt das Abzeichen im Profilmenü?</h2>
    <p><strong>Befund (de.json):</strong> „Sternkarte“ (Seite, Glyph, Zurück-Link) und „Sternenkarte“ (<code>fusionBar…starmap</code>) existieren beide. Daneben „Sternbild“, „Meine Sternbilder“, „Kartograph“, „Kartograph-Abzeichen“ (<code>nav.badge</code> im Profilmenü → <code>/badge/kartograph</code>) und „Explorer“ (Community-Zähler). Für dieselbe Sache stehen also bis zu drei Wörter.</p>
${evalBlock('v4-w1', 'Sternkarte · Sternbild · Kartograph-Abzeichen', 'Sternkarte · Sternbild · Kartograph-Abzeichen', '<p>Die Seite heißt überall <strong>Sternkarte</strong>, ein vollendetes Muster ist ein <strong>Sternbild</strong>, die Auszeichnung das <strong>Kartograph-Abzeichen</strong> (Rang N), Leute heißen <strong>Kartographen</strong> statt „Explorer“. „Sternenkarte“ fällt weg. <em>Empfehlung:</em> Das ist schon die Mehrheit der Texte; nur 2–3 Schlüssel ändern sich.</p>', true)}
${evalBlock('v4-w2', 'Sternenkarte · Sternbild · Kartograph', 'Sternenkarte · Sternbild · Kartograph-Rang', '<p>„Sternenkarte“ überall, Auszeichnung als „Kartograph-Rang“. Klingt weicher, ändert aber ~20 Schlüssel und alle Screenshots/Hilfetexte.</p>', false)}
${evalBlock('v4-menu', 'Abzeichen raus aus dem Profilmenü', 'Kartograph-Abzeichen aus dem Profilmenü entfernen', '<p>Der Eintrag „Kartograph-Abzeichen“ im Profilmenü fällt weg. Das Abzeichen steht als Chip im Kopf der Sternkarte (siehe Designs) und bleibt über die Suche erreichbar; die teilbare Seite <code>/badge/kartograph</code> bleibt bestehen. <em>Empfehlung:</em> wie von dir gewünscht – das Menü bleibt für Konto-Dinge.</p>', true)}
  </div>
</section>`;

const html = `<section data-iteration="1" data-iteration-template="design" data-design-set="alternatives">
${css}
  <header class="iteration-intro">
    <h2>{{iteration.tab}} 1 · Hub &amp; Unterseiten</h2>
    <p>Drei Ideen, wie der Weg vom Verse-Hub in News, Patches, Galerie und Sternkarte aussieht, und ein gemeinsames Seitenraster für alle vier. Klick im Hub auf den News-Planeten, dann siehst du den Übergang; über die Tabs kommst du zu den anderen Unterseiten.</p>
  </header>
${d1()}
${d2()}
${d3()}
${views}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('written', html.length);
