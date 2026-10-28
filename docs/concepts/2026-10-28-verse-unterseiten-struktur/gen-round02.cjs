// Generates round 02 of the verse-unterseiten concept (refined d1 "Anflug").
// Usage: node gen-round02.cjs rounds/02.html
// The shared mock vocabulary (.mock-*) is copied verbatim from gen-round01.js so
// this round renders on its own; everything new uses the round-2 prefix mk-
// (never a round-1 class with a different definition, which would restyle the
// frozen round 1).
const fs = require('fs');
const path = require('path');
const out = process.argv[2];

const r1 = fs.readFileSync(path.join(__dirname, 'gen-round01.js'), 'utf8');
const a = r1.indexOf('/* ── shared mock vocabulary');
const b = r1.indexOf('/* ── D1 · Anflug ── */');
if (a < 0 || b < 0) throw new Error('shared vocabulary not found in gen-round01.js');
const shared = r1.slice(a, b).trimEnd();

const css = `
<style>
${shared}

/* ── round 2 · refined Anflug (prefix mk-) ── */
.mock-app.mk-long { height: auto; min-height: 100%; align-self: flex-start; padding-bottom: 56px; }
.mock-app.mk-deep { background: radial-gradient(42% 38% at 88% 12%, var(--mk-tint, rgba(82,193,230,.22)), transparent 70%),
  radial-gradient(50% 40% at 6% 96%, rgba(40,110,170,.16), transparent 70%), #050f19; }
.mk-t-news { --mk-tint: rgba(185,120,106,.30); }
.mk-t-patch { --mk-tint: rgba(224,174,112,.24); }
.mk-t-gal { --mk-tint: rgba(201,214,227,.20); }
.mk-t-map { --mk-tint: rgba(29,78,110,.50); }

/* header bar: apps menu + avatar */
.mk-top-right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.mk-apps-btn { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 999px; border: 1px solid rgba(82,193,230,.35);
  background: rgba(10,34,50,.6); color: #cfe3f1; font-size: 12.5px; cursor: pointer; text-decoration: none; }
.mk-apps-btn:hover { color: #e8ebed; border-color: rgba(82,193,230,.6); }
.mk-apps-btn.mk-on { background: rgba(82,193,230,.18); color: #e8ebed; box-shadow: inset 0 0 0 1px rgba(82,193,230,.5); }
.mk-avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600;
  background: linear-gradient(135deg, #24536f, #0b2232); border: 1px solid rgba(82,193,230,.35); }
.mk-apps-menu { position: absolute; z-index: 8; right: 66px; top: 62px; width: 370px; padding: 8px; border-radius: 16px;
  border: 1px solid rgba(82,193,230,.3); background: rgba(8,26,40,.97); box-shadow: 0 18px 50px rgba(0,0,0,.55); animation: mk-drop .22s ease-out; }
@keyframes mk-drop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.mk-apps-head { padding: 8px 10px 6px; font-size: 10.5px; letter-spacing: .22em; color: #84a0b6; }
.mk-apps-item { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; padding: 10px; border-radius: 12px; }
.mk-apps-item + .mk-apps-item { border-top: 1px solid rgba(82,193,230,.1); }
.mk-apps-item:hover { background: rgba(82,193,230,.07); }
.mk-apps-item b { display: block; font-size: 13.5px; }
.mk-apps-item span { display: block; color: #9fb3c8; font-size: 12px; margin-top: 2px; }
.mk-apps-item small { display: block; color: #84a0b6; font-size: 11px; margin-top: 3px; }

/* app icons (Starscape icon cycles wallpapers) */
.mk-ico { position: relative; flex: none; width: var(--mk-s, 40px); height: var(--mk-s, 40px); border-radius: 30%; overflow: hidden; }
.mk-ico-scc { background: radial-gradient(circle at 50% 50%, #0a2a3c 30%, transparent 31%), radial-gradient(circle, #52c1e6 0 46%, #0a2a3c 47%); box-shadow: 0 0 14px rgba(82,193,230,.35); }
.mk-ico-star, .mk-tc-prev-star { background: linear-gradient(135deg, #24536f, #0b2232 60%, #3c2a4f); }
.mk-ico-star::before, .mk-ico-star::after, .mk-tc-prev-star::before, .mk-tc-prev-star::after { content: ""; position: absolute; inset: 0; opacity: 0; }
.mk-ico-star::before, .mk-tc-prev-star::before { background: linear-gradient(160deg, #6b4a2e, #1b2a34 60%, #2c5a7a); animation: mk-cycle 6s infinite; }
.mk-ico-star::after, .mk-tc-prev-star::after { background: linear-gradient(120deg, #1d6f8f, #0a1f2c 55%, #7a3f2c); animation: mk-cycle 6s 3s infinite; }
@keyframes mk-cycle { 0%, 30% { opacity: 0; } 45%, 80% { opacity: 1; } 95%, 100% { opacity: 0; } }

/* App-Teaser: collapsed pill, unfolds into a card (same anchor, nothing below moves) */
.mk-tz { position: relative; display: inline-block; }
.mk-hub-tz { position: absolute; z-index: 6; left: 40px; top: 82px; }
.mk-teaser { position: relative; display: inline-flex; align-items: center; gap: 10px; padding: 4px 14px 4px 4px; border-radius: 999px;
  border: 1px solid rgba(82,193,230,.35); background: rgba(8,28,42,.84); color: #e8ebed; font-size: 12.5px; cursor: pointer;
  text-decoration: none; overflow: hidden; white-space: nowrap; --mk-s: 30px; }
.mk-teaser:hover { border-color: rgba(82,193,230,.65); }
.mk-teaser .mk-ico, .mk-tc-head .mk-ico { border-radius: 50%; }
.mk-teaser em, .mk-tc-head em { font-style: normal; color: #9fb3c8; }
.mk-chev { color: #52c1e6; font-size: 11px; text-decoration: none; cursor: pointer; }
.mk-teaser::after { content: ""; position: absolute; inset: 0; pointer-events: none; transform: translateX(-100%);
  background: linear-gradient(100deg, transparent 30%, rgba(143,227,255,.2) 50%, transparent 70%); animation: mk-glint 5s ease-in-out 1s infinite; }
@keyframes mk-glint { 0%, 72% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.mk-teaser-card { position: absolute; z-index: 7; left: 0; top: 0; width: 384px; border-radius: 18px; border: 1px solid rgba(82,193,230,.42);
  background: rgba(8,28,42,.97); box-shadow: 0 20px 60px rgba(0,0,0,.55); overflow: hidden; animation: mk-unfold .55s cubic-bezier(.3,.7,.2,1) both; }
.mk-teaser-card.mk-r { left: auto; right: 0; animation-name: mk-unfold-r; }
@keyframes mk-unfold { from { clip-path: inset(0 calc(100% - 290px) calc(100% - 40px) 0 round 20px); } to { clip-path: inset(0 0 0 0 round 18px); } }
@keyframes mk-unfold-r { from { clip-path: inset(0 0 calc(100% - 40px) calc(100% - 290px) round 20px); } to { clip-path: inset(0 0 0 0 round 18px); } }
.mk-tc-head { display: flex; align-items: center; gap: 10px; padding: 4px 14px 4px 4px; font-size: 12.5px; --mk-s: 30px; }
.mk-tc-head .mk-chev { margin-left: auto; padding: 4px 6px; }
.mk-tc-body { padding: 4px 18px 18px; animation: mk-rise .4s ease-out .3s both; }
@keyframes mk-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.mk-tc-prev { position: relative; height: 96px; border-radius: 12px; margin: 8px 0 12px; overflow: hidden; border: 1px solid rgba(82,193,230,.2); }
.mk-tc-prev-scc { background: radial-gradient(60% 80% at 80% 0%, rgba(82,193,230,.25), transparent 70%), #061420; }
.mk-win { position: absolute; inset: 12px 20px; border-radius: 8px; border: 1px solid rgba(82,193,230,.35); background: linear-gradient(#0e3346 0 16px, #071a27 16px); }
.mk-win i { position: absolute; left: 12px; height: 7px; border-radius: 4px; background: rgba(159,179,200,.35); }
.mk-win i:nth-child(1) { top: 26px; width: 55%; background: rgba(82,193,230,.6); }
.mk-win i:nth-child(2) { top: 40px; width: 70%; }
.mk-win i:nth-child(3) { top: 54px; width: 40%; background: rgba(240,194,123,.65); animation: mk-blink 1.6s ease-in-out infinite; }
@keyframes mk-blink { 50% { opacity: .35; } }
.mk-tc-body p { margin: 0 0 8px; color: #cfe3f1; font-size: 12.5px; line-height: 1.5; }
.mk-tc-list { margin: 0 0 10px; padding: 0; list-style: none; font-size: 12px; color: #cfe3f1; }
.mk-tc-list li { padding: 2px 0 2px 18px; position: relative; }
.mk-tc-list li::before { content: "✓"; position: absolute; left: 0; color: #52c1e6; }
.mk-tc-meta { color: #84a0b6; font-size: 11px; margin-bottom: 12px; }
.mk-tc-act { display: flex; gap: 8px; align-items: center; }

/* shared page frame header: crumbs · emblem · eyebrow · h1 · subtitle · aside/actions */
.mk-ph { display: grid; grid-template-columns: 64px 1fr auto; grid-template-areas: "c c c" "e t a"; column-gap: 20px; row-gap: 10px;
  align-items: end; padding: 24px 0 20px; margin-bottom: 28px; border-bottom: 1px solid rgba(82,193,230,.14); }
.mk-crumbs { grid-area: c; display: flex; gap: 8px; font-size: 12px; color: #84a0b6; }
.mk-crumbs a { color: #9fb3c8; text-decoration: none; cursor: pointer; }
.mk-crumbs a:hover { color: #52c1e6; }
.mk-ph .mk-emb { grid-area: e; position: relative; width: 64px; height: 64px; align-self: center; }
.mk-ph-text { grid-area: t; }
.mk-eye { font-size: 11px; color: #52c1e6; letter-spacing: .26em; }
.mk-ph h1 { margin: 6px 0 4px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 30px; font-weight: 600; letter-spacing: .04em; }
.mk-ph p { margin: 0; color: #9fb3c8; max-width: 62ch; }
.mk-aside { grid-area: a; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.mk-aside-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.mk-act { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 9px; border: 1px solid rgba(82,193,230,.3);
  color: #cfe3f1; font-size: 12px; text-decoration: none; cursor: pointer; background: rgba(10,34,50,.45); }
.mk-act.mk-on { background: rgba(82,193,230,.18); border-color: rgba(82,193,230,.55); }
.mk-sh { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(82,193,230,.14); }
.mk-sh h2 { margin: 0; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #52c1e6; font-weight: 600; }
.mk-sh > span { color: #84a0b6; font-size: 12px; }
.mk-sh > .mk-push { margin-left: auto; }

/* Patches A: Lage-Kopf (figures folded in) + two stacked side cards */
.mk-lage { display: grid; grid-template-columns: 1.55fr 1fr; gap: 14px; }
.mk-hero { grid-row: span 2; padding: 22px 24px; border-radius: 18px; border: 1px solid rgba(224,174,112,.24);
  background: linear-gradient(160deg, rgba(224,174,112,.10), rgba(9,30,45,.55) 45%); }
.mk-hero-k { font-size: 10.5px; letter-spacing: .26em; color: #e0ae70; }
.mk-state { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
.mk-state b { display: block; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 28px; letter-spacing: .03em; }
.mk-state span { color: #9fb3c8; font-size: 12.5px; }
.mk-gauge { position: relative; height: 10px; border-radius: 6px; margin: 34px 0 6px;
  background: linear-gradient(90deg, rgba(95,214,152,.4) 0 58%, rgba(82,193,230,.28) 58% 80%, rgba(240,194,123,.45) 80%); }
.mk-gauge i { position: absolute; top: -6px; width: 2px; height: 22px; background: #fff; box-shadow: 0 0 8px #fff; }
.mk-gauge em { position: absolute; top: -24px; transform: translateX(-50%); font-style: normal; font-size: 11px; color: #e8ebed; white-space: nowrap; }
.mk-gauge-l { display: flex; justify-content: space-between; font-size: 10.5px; color: #84a0b6; letter-spacing: .1em; }
.mk-facts { margin: 16px 0 0; color: #cfe3f1; font-size: 13px; line-height: 1.8; }
.mk-facts b { font-family: Orbitron, "Segoe UI", sans-serif; color: #52c1e6; font-weight: 600; font-size: 12.5px; }
.mk-spark { display: flex; align-items: flex-end; gap: 3px; height: 40px; margin-top: 16px; }
.mk-spark i { flex: 1; border-radius: 2px 2px 0 0; background: #5fd698; opacity: .75; }
.mk-spark i.mk-w { background: #f0c27b; }
.mk-spark i.mk-now { opacity: 1; background: repeating-linear-gradient(45deg, #5fd698 0 3px, rgba(95,214,152,.4) 3px 6px); }
.mk-spark-l { display: flex; justify-content: space-between; font-size: 10.5px; color: #84a0b6; margin-top: 4px; }
.mk-side { padding: 16px 18px; border-radius: 16px; border: 1px solid rgba(82,193,230,.18); background: rgba(9,30,45,.5); }
.mk-side h3 { margin: 0 0 2px; font-size: 13.5px; }
.mk-side small { color: #84a0b6; font-size: 11.5px; }
.mk-ready { display: grid; grid-template-columns: 64px 1fr; gap: 16px; align-items: center; margin-top: 10px; }
.mk-ring { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(#52c1e6 0 50%, rgba(82,193,230,.15) 50%); }
.mk-ring span { width: 50px; height: 50px; border-radius: 50%; display: grid; place-items: center; background: #071a27; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 13px; }
.mk-hist { display: flex; align-items: flex-end; gap: 3px; height: 64px; margin: 14px 0 4px; }
.mk-hist i { flex: 1; border-radius: 2px 2px 0 0; background: rgba(82,193,230,.4); }
.mk-hist i.mk-med { background: #52c1e6; box-shadow: 0 0 10px rgba(82,193,230,.6); }
.mk-hist i.mk-you { background: rgba(255,255,255,.85); }
.mk-hist-l { display: flex; justify-content: space-between; font-size: 10.5px; color: #84a0b6; }
.mk-legend { display: flex; gap: 14px; margin-top: 8px; font-size: 11.5px; color: #9fb3c8; }
.mk-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.mk-link2 { display: inline-block; margin-top: 10px; color: #52c1e6; font-size: 12px; text-decoration: none; cursor: pointer; }
.mk-link2:hover { text-decoration: underline; }

/* patch timeline (today's board: search, line cards, entries, older) */
.mk-search { display: flex; align-items: center; gap: 8px; min-width: 320px; padding: 7px 12px; border-radius: 10px;
  border: 1px solid rgba(82,193,230,.25); background: rgba(9,30,45,.55); color: #84a0b6; font-size: 12.5px; }
.mk-line { border-radius: 14px; border: 1px solid rgba(82,193,230,.16); background: rgba(9,30,45,.45); overflow: hidden; }
.mk-line + .mk-line { margin-top: 10px; }
.mk-line-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid rgba(82,193,230,.1); }
.mk-line-head b { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 15px; }
.mk-line-head small { color: #84a0b6; font-size: 12px; }
.mk-line-head .mk-stab { margin-left: auto; }
.mk-entry { display: grid; grid-template-columns: minmax(0, 1fr) 62px 66px 64px 58px 82px 74px 18px; gap: 10px; align-items: center;
  padding: 9px 16px; font-size: 12.5px; cursor: pointer; text-decoration: none; color: inherit; }
.mk-entry + .mk-entry { border-top: 1px solid rgba(82,193,230,.06); }
.mk-entry:hover { background: rgba(82,193,230,.06); }
.mk-dim { color: #84a0b6; font-size: 11.5px; }
.mk-ext { color: #52c1e6; text-decoration: none; }
.mk-ver { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11px; color: #cfe3f1; }
.mk-status { font-size: 10px; letter-spacing: .16em; padding: 4px 9px; border-radius: 999px; border: 1px solid currentColor; }
.mk-s-next { color: #52c1e6; }
.mk-s-ptu { color: #f0c27b; }
.mk-s-live { color: #5fd698; }
.mk-s-old { color: #84a0b6; }
.mk-stab { font-size: 11px; padding: 3px 8px; border-radius: 6px; background: rgba(95,214,152,.14); color: #5fd698; white-space: nowrap; }
.mk-stab.mk-w { background: rgba(240,194,123,.15); color: #f0c27b; }
.mk-stab.mk-n { background: rgba(159,179,200,.12); color: #9fb3c8; }
.mk-older { display: flex; justify-content: center; gap: 8px; padding: 12px; margin-top: 10px; color: #9fb3c8; font-size: 12.5px;
  border: 1px dashed rgba(82,193,230,.22); border-radius: 12px; cursor: pointer; }

/* Patches B: the timeline is the page, figures hang on it */
.mk-spine { position: relative; padding-left: 110px; }
.mk-spine::before { content: ""; position: absolute; left: 86px; top: 10px; bottom: 10px; width: 2px; background: linear-gradient(rgba(82,193,230,.6), rgba(82,193,230,.08)); }
.mk-node { position: relative; }
.mk-node::before { content: ""; position: absolute; left: -31px; top: 15px; width: 14px; height: 14px; border-radius: 50%; background: #071a27; border: 2px solid #52c1e6; z-index: 1; }
.mk-node.mk-n-live::before { border-color: #5fd698; background: #5fd698; }
.mk-node.mk-n-ptu::before { border-color: #f0c27b; }
.mk-node.mk-n-old::before { border-color: #84a0b6; }
.mk-node > .mk-rail { position: absolute; left: -44px; top: 4px; bottom: 4px; width: 4px; border-radius: 3px; background: #5fd698; opacity: .75; }
.mk-node > .mk-rail.mk-w { background: #f0c27b; }
.mk-node > .mk-rail.mk-n { background: repeating-linear-gradient(#9fb3c8 0 4px, transparent 4px 8px); opacity: .5; }
.mk-node > .mk-pct { position: absolute; left: -112px; top: 12px; width: 60px; text-align: right; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 12.5px; }
.mk-node > .mk-pct small { display: block; font-family: Inter, "Segoe UI", sans-serif; font-size: 9.5px; color: #84a0b6; letter-spacing: .08em; margin-top: 2px; }
.mk-gap { padding: 10px 0 10px 2px; color: #9fb3c8; font-size: 12px; }
.mk-gap b { color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 12px; font-weight: 600; }
.mk-gap .mk-tag-ok { color: #5fd698; }
.mk-gap .mk-tag-w { color: #f0c27b; }
.mk-node-card { border-radius: 14px; border: 1px solid rgba(82,193,230,.16); background: rgba(9,30,45,.45); overflow: hidden; }
.mk-node-card.mk-next { border-color: rgba(240,194,123,.35); background: linear-gradient(160deg, rgba(240,194,123,.08), rgba(9,30,45,.5) 50%); }
.mk-monitor { display: flex; gap: 24px; flex-wrap: wrap; padding: 12px 16px 4px; font-size: 12.5px; color: #9fb3c8; }
.mk-monitor b { display: block; color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 17px; font-weight: 600; }
.mk-next-grid { display: grid; grid-template-columns: 1fr 1.25fr; gap: 26px; padding: 10px 16px 16px; }
.mk-next-grid h3 { margin: 0 0 8px; font-size: 12.5px; color: #cfe3f1; font-weight: 600; }
.mk-steps { display: flex; gap: 8px; flex-wrap: wrap; }
.mk-step { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px; border: 1px solid rgba(82,193,230,.3); font-size: 12px; color: #cfe3f1; }
.mk-step::before { content: "○"; color: #84a0b6; }
.mk-step.mk-done { background: rgba(82,193,230,.16); }
.mk-step.mk-done::before { content: "✓"; color: #52c1e6; }

/* Sternkarte: today's order, no opaque box */
.mk-patchbar { display: flex; align-items: center; gap: 8px; margin: -10px 0 4px; }
.mk-patchbar > span { color: #84a0b6; font-size: 12px; margin-right: 4px; }
.mk-pchip { padding: 5px 11px; border-radius: 999px; font-size: 12px; color: #9fb3c8; border: 1px solid rgba(82,193,230,.2); cursor: pointer; text-decoration: none; }
.mk-pchip.mk-on { color: #04202e; background: #52c1e6; border-color: #52c1e6; font-weight: 600; }
.mk-dome { position: relative; height: 330px; margin: 4px 0 18px; }
.mk-dome::before { content: ""; position: absolute; inset: 0 4%; border-radius: 50% 50% 0 0 / 80% 80% 0 0;
  background: radial-gradient(ellipse at 50% 100%, rgba(29,78,110,.42), rgba(5,15,25,.6) 55%, transparent 76%); }
.mk-dome svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.mk-tracks { display: grid; grid-template-columns: 1.15fr 1fr; gap: 34px; }
.mk-track { border-top: 1px solid rgba(82,193,230,.28); padding-top: 12px; }
.mk-track h3 { margin: 0 0 4px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 12.5px; letter-spacing: .18em; text-transform: uppercase; color: #52c1e6; font-weight: 600; }
.mk-track p { margin: 0; color: #9fb3c8; font-size: 12.5px; }
.mk-comet { position: relative; height: 34px; margin: 18px 0 6px; border-bottom: 1px dashed rgba(159,179,200,.35); }
.mk-comet i { position: absolute; left: 61%; bottom: -6px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: -22px 0 16px rgba(143,227,255,.45), 0 0 10px #8fe3ff; }
.mk-comet b { position: absolute; bottom: 10px; transform: translateX(-50%); font-size: 10.5px; color: #84a0b6; font-weight: 400; white-space: nowrap; }
.mk-guess { display: grid; grid-template-columns: 80px 1fr 40px; gap: 10px; align-items: center; font-size: 12px; color: #cfe3f1; margin-top: 8px; }
.mk-guess i { display: block; height: 6px; border-radius: 4px; background: rgba(82,193,230,.55); }
.mk-guess span { color: #84a0b6; text-align: right; }
.mk-series { display: flex; gap: 10px; }
.mk-ser { flex: 1; text-align: center; font-size: 11.5px; color: #9fb3c8; text-decoration: none; cursor: pointer; padding: 6px 4px; border-radius: 10px; }
.mk-ser:hover { background: rgba(82,193,230,.06); }
.mk-ser svg { display: block; width: 100%; height: 50px; }
.mk-ser.mk-on { color: #e8ebed; box-shadow: inset 0 -2px 0 #52c1e6; }

/* Übergang: frame strip + loops (same vertical move as scrolling the hub) */
.mk-trans { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.mk-cap { margin-top: 8px; font-size: 12px; color: #9fb3c8; line-height: 1.45; }
.mk-cap b { color: #e8ebed; }
.mk-film { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.mk-fr { margin: 0; }
.mk-fr figcaption { margin-top: 8px; font-size: 12px; color: #9fb3c8; line-height: 1.4; }
.mk-fr figcaption b { display: block; color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11px; letter-spacing: .12em; margin-bottom: 2px; }
.mk-mini { position: relative; aspect-ratio: 16 / 10; border-radius: 12px; overflow: hidden; border: 1px solid rgba(82,193,230,.25); background: #050f19; font-size: 7px; }
.mk-loop .mk-mini { font-size: 12px; }
.mk-mini-stars { position: absolute; left: 0; right: 0; top: 0; height: 140%; opacity: .7;
  background-image: radial-gradient(1px 1px at 12% 18%, #fff, transparent), radial-gradient(1px 1px at 33% 72%, #cfe8ff, transparent),
    radial-gradient(1.5px 1.5px at 58% 26%, #fff, transparent), radial-gradient(1px 1px at 81% 64%, #fff, transparent),
    radial-gradient(1px 1px at 91% 12%, #bfe, transparent), radial-gradient(1px 1px at 46% 50%, #dff, transparent);
  background-size: 120px 90px; }
.mk-mini-tint { position: absolute; inset: 0; background: radial-gradient(48% 48% at 88% 10%, var(--mk-tint, rgba(185,120,106,.38)), transparent 70%); }
.mk-mini-hub { position: absolute; inset: 0; }
.mk-mini-hor { position: absolute; left: -25%; right: -25%; bottom: -82%; height: 115%; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 0%, #2f86b6 0%, #0f4565 30%, #07202f 62%); box-shadow: 0 -4px 24px rgba(82,193,230,.5); }
.mk-mini-hero { position: absolute; left: 50%; top: 24%; transform: translateX(-50%); font-family: Orbitron, "Segoe UI", sans-serif; font-weight: 700; font-size: 3em; }
.mk-mini-pl { position: absolute; border-radius: 50%; aspect-ratio: 1; }
.mk-mini-page { position: absolute; inset: 0; }
.mk-mini-ph { position: absolute; left: 8%; right: 8%; top: 10%; display: flex; align-items: flex-start; gap: 4%; }
.mk-mini-slot { flex: none; width: 13%; aspect-ratio: 1; border-radius: 50%; border: 1px dashed rgba(82,193,230,.4); }
.mk-mini-lines { flex: 1; }
.mk-mini-lines i { display: block; height: .8em; border-radius: .4em; background: rgba(232,235,237,.8); margin: .5em 0; }
.mk-mini-lines i:nth-child(1) { width: 26%; height: .5em; background: #52c1e6; }
.mk-mini-lines i:nth-child(2) { width: 42%; height: 1.3em; }
.mk-mini-lines i:nth-child(3) { width: 64%; background: rgba(159,179,200,.5); }
.mk-mini-blocks { position: absolute; left: 8%; right: 8%; top: 46%; bottom: -10%; display: grid; grid-template-columns: 1.3fr 1fr; grid-template-rows: 1fr 1fr; gap: .9em; }
.mk-mini-blocks i { border-radius: .7em; background: rgba(82,193,230,.12); border: 1px solid rgba(82,193,230,.22); }
.mk-mini-blocks i:first-child { grid-row: span 2; }
.mk-mini-fly { position: absolute; z-index: 2; border-radius: 50%; aspect-ratio: 1; }
.mk-mini-ring { outline: 2px solid rgba(82,193,230,.8); outline-offset: 3px; }
.mk-loop .mk-mini-stars { animation: mk-l-stars 3.6s cubic-bezier(.65,0,.35,1) infinite; }
.mk-loop .mk-mini-hub, .mk-loop .mk-mini-page.mk-pa { animation: mk-l-out 3.6s cubic-bezier(.65,0,.35,1) infinite; }
.mk-loop .mk-mini-page, .mk-loop .mk-mini-page.mk-pb { animation: mk-l-in 3.6s cubic-bezier(.65,0,.35,1) infinite; }
.mk-loop .mk-mini-tint { animation: mk-l-tint 3.6s ease infinite; }
.mk-loop .mk-tint-b { --mk-tint: rgba(224,174,112,.34); animation: mk-l-tint 3.6s ease infinite; }
.mk-loop .mk-mini-fly { animation: mk-l-fly 3.6s cubic-bezier(.65,0,.35,1) infinite; }
@keyframes mk-l-stars { 0%, 18% { transform: none; } 70%, 100% { transform: translateY(-16%); } }
@keyframes mk-l-out { 0%, 18% { transform: none; } 62%, 100% { transform: translateY(-120%); } }
@keyframes mk-l-in { 0%, 22% { transform: translateY(100%); } 70%, 100% { transform: none; } }
@keyframes mk-l-tint { 0%, 25% { opacity: 0; } 72%, 100% { opacity: 1; } }
@keyframes mk-l-fly { 0%, 18% { left: 6%; top: 58%; width: 13%; } 45% { left: 7%; top: 32%; width: 14%; } 72%, 100% { left: 8%; top: 10%; width: 10.4%; } }
@keyframes mk-l-xout { 0%, 25% { opacity: 1; } 60%, 100% { opacity: 0; } }
@keyframes mk-l-xin { 0%, 35% { opacity: 0; } 70%, 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .mk-loop .mk-mini-stars, .mk-teaser::after, .mk-ico-star::before, .mk-ico-star::after,
  .mk-tc-prev-star::before, .mk-tc-prev-star::after, .mk-win i { animation: none; }
  .mk-loop .mk-mini-hub, .mk-loop .mk-mini-page.mk-pa { animation: mk-l-xout 3.6s ease infinite; }
  .mk-loop .mk-mini-page, .mk-loop .mk-mini-page.mk-pb { transform: none; animation: mk-l-xin 3.6s ease infinite; }
  .mk-loop .mk-mini-fly { display: none; }
  .mk-teaser-card, .mk-tc-body, .mk-apps-menu { animation-duration: .01s; }
}
</style>`;

// ───────────────────────── helpers ─────────────────────────
const D = 'd1';
const S = { hub: 'd1-s1', hubTz: 'd1-s2', apps: 'd1-s3', trans: 'd1-s4', news: 'd1-s5', patA: 'd1-s6', patB: 'd1-s7', gal: 'd1-s8', galTz: 'd1-s9', map: 'd1-s10' };

const anno = (id, n, side, target, q, improved = '', xy = '50%;--anno-y:30%') => {
  const imp = improved ? `\n        <p class="anno-bubble-improved"><strong>{{design.change_improved}}</strong> ${improved}</p>` : '';
  const summary = q
    ? `<button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}">
          <span class="anno-bubble-question">${q}</span>
        </button>`
    : `<button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{design.change_improved}}: ${improved}"></button>`;
  return `
    <div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${target}" style="--anno-x:${xy}">
      <button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="${q ? 'Frage' : 'Hinweis'} ${n}">${n}</button>
      <div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false">${imp}
        ${summary}
        <div class="anno-bubble-body">
          <textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea>
          <div class="attach-slot" data-attach-slot="anno-${id}"></div>
        </div>
      </div>
    </div>`;
};
const layer = (annos) => (annos.length ? `\n  <div class="anno-layer" data-anno-layer>${annos.join('')}\n  </div>` : '');
const screen = (id, label, inner, annos = [], active = false) => `
 <section id="${id}" data-nav-label="${label}" data-screen${active ? ' data-screen-active="true"' : ' hidden'}>
${inner}${layer(annos)}
 </section>`;

// header bar with the public apps menu (accent, not red) + account avatar
const top = (appsOpen) => `
  <div class="mock-top">
    <div class="mock-logo"><i></i><div><span class="mock-disp">Star Citizen Companion</span><small>ALPHA</small></div></div>
    <div class="mock-nav mock-disp"><b>Verse</b><span>Codex</span><span>HQ</span><em>Admin</em></div>
    <div class="mk-top-right">
      <a class="mk-apps-btn${appsOpen ? ' mk-on' : ''}" data-screen-link="${appsOpen ? S.hub : S.apps}">⬇ Apps ${appsOpen ? '▴' : '▾'}</a>
      <span class="mk-avatar">JT</span>
    </div>
  </div>`;

const appsMenu = () => `
  <div class="mk-apps-menu">
    <div class="mk-apps-head mock-disp">Desktop-Apps</div>
    <div class="mk-apps-item"><span class="mk-ico mk-ico-scc"></span>
      <div><b>SCC App</b><span>SC Companion als eigenes Windows-Fenster</span><small>Windows 10/11 · v0.50 · 92 MB</small></div>
      <button class="mock-btn">⬇ Laden</button></div>
    <div class="mk-apps-item"><span class="mk-ico mk-ico-star"></span>
      <div><b>Starscape</b><span>Galerie-Bilder als wechselndes Wallpaper</span><small>Windows 10/11 · v0.9.4 · 14 MB</small></div>
      <button class="mock-btn">⬇ Laden</button></div>
  </div>`;

// App-Teaser — one pattern, two apps
const APPS = {
  scc: { ico: 'mk-ico-scc', name: 'SCC App', line: 'Companion für den Desktop',
    prev: '<div class="mk-tc-prev mk-tc-prev-scc"><div class="mk-win"><i></i><i></i><i></i></div></div>',
    text: 'SC Companion als eigene Windows-App: eigenes Fenster neben dem Spiel, Hinweis, sobald ein neuer Patch live geht.',
    list: ['Patch-Hinweis auf dem Desktop', 'Bereit-Checkliste ohne Browser', 'Gleiches Konto wie im Web'],
    meta: 'Windows 10/11 · v0.50 · 92 MB' },
  star: { ico: 'mk-ico-star', name: 'Starscape', line: 'Galerie als Wallpaper',
    prev: '<div class="mk-tc-prev mk-tc-prev-star"></div>',
    text: 'Wechselt dein Windows-Wallpaper automatisch durch diese Galerie – auch deine vollendeten Sternkarten.',
    list: ['Neue Bilder kommen von selbst', 'Wechsel-Takt frei wählbar', 'Läuft leise im Hintergrund'],
    meta: 'Windows 10/11 · v0.9.4 · 14 MB' },
};
const teaserPill = (k, link, hidden = false) => {
  const t = APPS[k];
  return `<a class="mk-teaser" data-screen-link="${link}"${hidden ? ' style="visibility:hidden"' : ''}><span class="mk-ico ${t.ico}"></span><b>${t.name}</b><em>· ${t.line}</em><span class="mk-chev">▸</span></a>`;
};
const teaserCard = (k, closeLink, right = false) => {
  const t = APPS[k];
  return `<div class="mk-teaser-card${right ? ' mk-r' : ''}">
        <div class="mk-tc-head"><span class="mk-ico ${t.ico}"></span><b>${t.name}</b><em>· ${t.line}</em><a class="mk-chev" data-screen-link="${closeLink}">▴</a></div>
        <div class="mk-tc-body">
          ${t.prev}
          <p>${t.text}</p>
          <ul class="mk-tc-list">${t.list.map((l) => `<li>${l}</li>`).join('')}</ul>
          <div class="mk-tc-meta">${t.meta}</div>
          <div class="mk-tc-act"><button class="mock-btn">⬇ Download</button><a class="mk-link2" style="margin:0">Versionshinweise</a></div>
        </div>
      </div>`;
};

const constellation = (w, h, x, y) => `
  <svg class="mock-const" viewBox="0 0 100 100" style="width:${w}px;height:${h}px;left:${x};top:${y}">
    <line x1="30" y1="8" x2="70" y2="70"/><line x1="70" y1="70" x2="44" y2="88"/>
    <circle cx="30" cy="8" r="3"/><circle cx="70" cy="70" r="3"/><circle cx="44" cy="88" r="2"/>
    <circle class="mock-dark" cx="12" cy="66" r="2.4"/><circle class="mock-dark" cx="24" cy="84" r="2.4"/>
  </svg>`;

// Hub: round-1 scene + apps menu + SCC teaser
const hub = ({ appsOpen = false, tzOpen = false } = {}) => `
  <div class="mock-app">
    <div class="mock-stars"></div>
    ${top(appsOpen)}
    <div class="mock-sun" style="right:9%;top:22%"></div>
    ${constellation(80, 100, '80%', '40%')}
    <a class="mock-hub-link" data-screen-link="${S.trans}"><div class="mock-pl mock-pl-news" style="left:4%;top:61%;width:118px;height:118px"></div><span class="mock-pl-label mock-disp" style="left:calc(4% + 59px);top:calc(61% + 128px)">News</span></a>
    <a class="mock-hub-link" data-screen-link="${S.patA}"><div class="mock-pl mock-pl-patch" style="left:15%;top:55%;width:86px;height:86px"></div><span class="mock-pl-label mock-disp" style="left:calc(15% + 43px);top:calc(55% + 96px)">Patches</span></a>
    <a class="mock-hub-link" data-screen-link="${S.gal}"><div class="mock-pl mock-pl-gal" style="left:81%;top:52%;width:116px;height:116px"></div><span class="mock-pl-label mock-disp" style="left:calc(81% + 58px);top:calc(52% + 126px)">Galerie</span></a>
    <a class="mock-hub-link" data-screen-link="${S.map}"><span class="mock-pl-label mock-disp" style="left:84%;top:calc(40% + 108px)">Sternkarte</span></a>
    <div class="mock-hero"><div class="mock-k mock-disp">Patches</div><div class="mock-big">4.10</div></div>
    <div class="mock-horizon"></div>
    <div class="mock-holo"><div class="mock-k mock-disp">News</div><h3>First Time Running Storm Breaker</h3></div>
    <div class="mk-hub-tz">${teaserPill('scc', S.hubTz, tzOpen)}${tzOpen ? teaserCard('scc', S.hub) : ''}</div>
    ${appsOpen ? appsMenu() : ''}
  </div>`;

const capsule = (on) => {
  const t = [['News', S.news], ['Patches', S.patA], ['Galerie', S.gal], ['Sternkarte', S.map]];
  return `
  <div class="mock-capsule">
    <a class="mock-cap-area mock-disp" data-screen-link="${S.hub}">◉ Verse</a>
    ${t.map(([l, id]) => `<a class="${l === on ? 'mock-on' : ''}" data-screen-link="${id}">${l}</a>`).join('')}
    <div class="mock-search">🔍 Suche in Schiffen, Patches, News …</div>
  </div>`;
};

// shared page header = the frame (everything up to and including the title)
const ph = (pl, name, title, sub, aside = '') => `
    <header class="mk-ph">
      <nav class="mk-crumbs"><a data-screen-link="${S.hub}">Verse</a><span>›</span><span>${name}</span></nav>
      <span class="mk-emb mock-pl ${pl}"></span>
      <div class="mk-ph-text"><div class="mk-eye mock-disp">Verse · ${name}</div><h1>${title}</h1><p>${sub}</p></div>
      <div class="mk-aside">${aside}</div>
    </header>`;

const page = (tint, tab, body) => `
  <div class="mock-app mk-deep mk-long ${tint}">
    <div class="mock-stars"></div>
    ${capsule(tab)}
    <div class="mock-frame">${body}</div>
  </div>`;

// ───────────────────────── page bodies ─────────────────────────
const newsBody = () => `
    ${ph('mock-pl-news', 'News', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.', '<div class="mk-aside-row"><span class="mock-chip">● aktualisiert gerade eben</span></div>')}
    <section>
      <div class="mk-sh"><h2>Auf der Bühne</h2><span>vor 2 Tagen · YouTube</span></div>
      <div class="mock-glass mock-stage">
        <div class="mock-img"></div>
        <div class="mock-body"><small class="mock-disp">YouTube</small><strong>First Time Running Storm Breaker</strong>
          <span style="color:#9fb3c8;font-size:12.5px">Raise your hand if you've ever felt personally victimized by the valakkar.</span>
          <span style="display:flex;gap:8px"><button class="mock-btn">Ansehen →</button><button class="mock-btn mock-ghost">☆ Merken</button></span></div>
      </div>
    </section>
    <section class="mock-sec">
      <div class="mk-sh"><h2>Feed</h2><span>48 Beiträge</span><a class="mk-link2 mk-push" style="margin:0">Gemerkt (0)</a></div>
      <div class="mock-grid">
        <div class="mock-glass mock-tile"><div class="mock-img"><span class="mock-src">SPECTRUM</span></div><p>Updates to Pledge Gifting – FAQ</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v2"><span class="mock-src">YOUTUBE</span></div><p>Your Favourite Spot in the ’Verse</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v3"><span class="mock-src">YOUTUBE</span></div><p>Jump Points in Star Citizen</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v4"><span class="mock-src">COMM-LINK</span></div><p>10 From the Community</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v3"><span class="mock-src">COMM-LINK</span></div><p>This Week in Star Citizen</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img"><span class="mock-src">SPECTRUM</span></div><p>Alpha 4.11 PTU – Known Issues</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v4"><span class="mock-src">YOUTUBE</span></div><p>Inside Star Citizen: Valakkar</p></div>
        <div class="mock-glass mock-tile"><div class="mock-img mock-v2"><span class="mock-src">COMM-LINK</span></div><p>Monthly Report: Oktober</p></div>
      </div>
    </section>`;

// one patch entry row: title · version · stage · hotfix · stability · time · points · RSI ↗
const entry = (title, ver, stage, hotfix, stab, time, pts) => {
  const st = { Live: 'mock-ok', PTU: 'mock-warn', Evocati: '' }[stage];
  const sb = stab ? `<span class="mk-stab${parseInt(stab, 10) < 70 ? ' mk-w' : ''}">${stab}</span>` : '<span class="mk-stab mk-n">früh</span>';
  return `
        <a class="mk-entry"><span>${title}</span><span class="mk-ver">${ver}</span><span class="mock-tag ${st}">${stage.toUpperCase()}</span>${hotfix ? '<span class="mock-tag">HOTFIX</span>' : '<span></span>'}${sb}<span class="mk-dim">${time}</span><span class="mk-dim">${pts} Punkte</span><span class="mk-ext">↗</span></a>`;
};
const line411 = () => `
      <div class="mk-line">
        <div class="mk-line-head"><span class="mk-status mk-s-ptu">PTU</span><b>4.11</b><small>Alpha 4.11 · nächste Version</small><span class="mk-stab mk-n">noch nicht live</span></div>
        ${entry('Alpha 4.11 PTU Patch Notes (Wave 2)', '4.11.0', 'PTU', false, '', 'vor 2 Std.', 42)}
        ${entry('Alpha 4.11 Evocati Patch Notes', '4.11.0', 'Evocati', false, '', 'vor 9 Tagen', 61)}
      </div>`;
const line410 = () => `
      <div class="mk-line">
        <div class="mk-line-head"><span class="mk-status mk-s-live">LIVE</span><b>4.10</b><small>Alpha 4.10 · Storm Breaker</small><span class="mk-stab">72 % · Leichte Turbulenzen</span></div>
        ${entry('Alpha 4.10.1 Hotfix – Inventar &amp; Aufzüge', '4.10.1', 'Live', true, '81 %', 'vor 3 Tagen', 18)}
        ${entry('Alpha 4.10 Live Patch Notes', '4.10.0', 'Live', false, '72 %', 'vor 11 Tagen', 96)}
        ${entry('Alpha 4.10 PTU Patch Notes (Wave 3)', '4.10.0', 'PTU', false, '64 %', 'vor 21 Tagen', 37)}
      </div>`;
const line49 = () => `
      <div class="mk-line">
        <div class="mk-line-head"><span class="mk-status mk-s-old">ABGELÖST</span><b>4.9</b><small>Alpha 4.9 · 7 Einträge</small><span class="mk-stab">78 %</span></div>
      </div>`;
const sparkBars = [62, 70, 55, 74, 80, 66, 58, 77, 72, 69, 81, 76, 64, 79, 72];
const spark = () => `<div class="mk-spark">${sparkBars.map((v, i) => `<i class="${i === sparkBars.length - 1 ? 'mk-now' : v < 70 ? 'mk-w' : ''}" style="height:${v}%"></i>`).join('')}</div>`;
const histBars = [8, 14, 22, 35, 52, 70, 88, 64, 47, 30, 22, 12, 7, 4];
const hist = () => `<div class="mk-hist">${histBars.map((v, i) => `<i class="${i === 6 ? 'mk-med' : i === 8 ? 'mk-you' : ''}" style="height:${v}%"></i>`).join('')}</div>
          <div class="mk-hist-l"><span>31. Okt</span><span>6. Nov</span><span>13. Nov</span></div>
          <div class="mk-legend"><span><i style="background:#52c1e6"></i>Median 6. Nov</span><span><i style="background:rgba(255,255,255,.85)"></i>dein Tipp 8. Nov</span><span>214 Tipps</span></div>`;
const searchBar = () => `<div class="mk-search mk-push">🔍 z. B. Orison, Hotfix, Quantum Drive</div>`;

const patchHead = (aside) => ph('mock-pl-patch', 'Patches', 'Patches', 'Was live ist, was kommt – und ob du bereit bist.', aside);

const patchA = () => `
    ${patchHead('<div class="mk-aside-row"><span class="mock-chip">Datenstand vor 12 Min.</span></div>')}
    <div class="mk-lage">
      <div class="mk-hero">
        <div class="mk-hero-k mock-disp">Patch-Monitor</div>
        <div class="mk-state">
          <div><b>LIVE 4.10.1</b><span>live seit 11 Tagen · Stabilität 72 %</span></div>
          <div><b>4.11 · PTU</b><span>im Test seit 9 Tagen · Wave 2</span></div>
        </div>
        <div class="mk-gauge"><i style="left:39%"></i><em style="left:39%">Tag 9 · im Takt</em></div>
        <div class="mk-gauge-l mock-disp"><span>im Takt</span><span>üblich</span><span>überfällig</span></div>
        <p class="mk-facts">4.11 kommt voraussichtlich um den <b>6. Nov</b> (in ~9 Tagen). Hauptpatches liegen im Median <b>97 Tage</b> auseinander, Hotfixes <b>9 Tage</b>. Die letzte Testphase dauerte <b>23 Tage</b>; zuletzt stabil gelandet ist <b>4.10</b>. Im Archiv: <b>38 Patch-Linien</b>.</p>
        ${spark()}
        <div class="mk-spark-l"><span>Stabilität je Patch · 3.23</span><span>4.10 (früh)</span></div>
      </div>
      <div class="mk-side">
        <h3>Bereit für 4.11</h3><small>2 von 4 erledigt</small>
        <div class="mk-ready"><div class="mk-ring"><span>2/4</span></div>
          <div><div class="mock-check"><i class="mock-done"></i>Patch Notes gelesen</div><div class="mock-check"><i class="mock-done"></i>Keybinds geprüft</div>
          <div class="mock-check"><i></i>Loadout gesichert</div><div class="mock-check"><i></i>Shader-Cache geleert</div></div>
        </div>
      </div>
      <div class="mk-side">
        <h3>Kometen-Tipp: Wann geht 4.11 live?</h3><small>So tippt die Community</small>
        ${hist()}
        <a class="mk-link2" data-screen-link="${S.map}">Selbst tippen auf der Sternkarte →</a>
      </div>
    </div>
    <section class="mock-sec" style="margin-top:30px">
      <div class="mk-sh"><h2>Zeitleiste</h2><span>38 Linien · 412 Einträge</span>${searchBar()}</div>
      ${line411()}
      ${line410()}
      ${line49()}
      <div class="mk-older">Ältere (35) ▾</div>
    </section>`;

const patchB = () => `
    ${patchHead(`<div class="mk-aside-row"><span class="mock-chip">38 Linien im Archiv</span></div><div class="mk-aside-row">${searchBar().replace(' mk-push', '')}</div>`)}
    <div class="mk-spine">
      <div class="mk-node mk-n-ptu">
        <span class="mk-rail mk-n"></span><span class="mk-pct">—<small>noch offen</small></span>
        <div class="mk-node-card mk-next">
          <div class="mk-line-head"><span class="mk-status mk-s-ptu">PTU</span><b>4.11</b><small>nächste Version · Wave 2</small><span class="mk-stab">im Takt</span></div>
          <div class="mk-monitor">
            <div><b>9 Tage</b>im Test (üblich: 23)</div>
            <div><b>~6. Nov</b>voraussichtlich live</div>
            <div><b>Wave 2</b>2 Notes seit Evocati</div>
          </div>
          <div class="mk-next-grid">
            <div><h3>Bereit für 4.11 · 2 von 4</h3>
              <div class="mk-steps"><span class="mk-step mk-done">Patch Notes gelesen</span><span class="mk-step mk-done">Keybinds geprüft</span><span class="mk-step">Loadout gesichert</span><span class="mk-step">Shader-Cache geleert</span></div></div>
            <div><h3>Kometen-Tipp: So tippt die Community</h3>${hist()}
              <a class="mk-link2" data-screen-link="${S.map}">Selbst tippen auf der Sternkarte →</a></div>
          </div>
          ${entry('Alpha 4.11 PTU Patch Notes (Wave 2)', '4.11.0', 'PTU', false, '', 'vor 2 Std.', 42)}
          ${entry('Alpha 4.11 Evocati Patch Notes', '4.11.0', 'Evocati', false, '', 'vor 9 Tagen', 61)}
        </div>
      </div>
      <div class="mk-gap">Testphase 4.10 dauerte <b>23 Tage</b> · <span class="mk-tag-ok">im Takt</span></div>
      <div class="mk-node mk-n-live">
        <span class="mk-rail"></span><span class="mk-pct">72 %<small>früh</small></span>
        <div class="mk-node-card">
          <div class="mk-line-head"><span class="mk-status mk-s-live">LIVE</span><b>4.10</b><small>Storm Breaker · live seit 11 Tagen</small><span class="mk-stab">72 % · Leichte Turbulenzen</span></div>
          ${entry('Alpha 4.10.1 Hotfix – Inventar &amp; Aufzüge', '4.10.1', 'Live', true, '81 %', 'vor 3 Tagen', 18)}
          ${entry('Alpha 4.10 Live Patch Notes', '4.10.0', 'Live', false, '72 %', 'vor 11 Tagen', 96)}
          ${entry('Alpha 4.10 PTU Patch Notes (Wave 3)', '4.10.0', 'PTU', false, '64 %', 'vor 21 Tagen', 37)}
        </div>
      </div>
      <div class="mk-gap"><b>97 Tage</b> zwischen 4.9 und 4.10 · Median <b>97 Tage</b> · Hotfixes im Median alle <b>9 Tage</b></div>
      <div class="mk-node mk-n-old">
        <span class="mk-rail"></span><span class="mk-pct">78 %<small>Endstand</small></span>
        <div class="mk-node-card"><div class="mk-line-head"><span class="mk-status mk-s-old">ABGELÖST</span><b>4.9</b><small>7 Einträge · zuletzt stabil gelandet</small><span class="mk-stab">78 %</span></div></div>
      </div>
      <div class="mk-gap"><b>104 Tage</b> zwischen 4.8 und 4.9 · <span class="mk-tag-w">länger als üblich</span></div>
      <div class="mk-node mk-n-old">
        <span class="mk-rail mk-w"></span><span class="mk-pct">61 %<small>Endstand</small></span>
        <div class="mk-node-card"><div class="mk-line-head"><span class="mk-status mk-s-old">ABGELÖST</span><b>4.8</b><small>9 Einträge</small><span class="mk-stab mk-w">61 %</span></div></div>
      </div>
      <div class="mk-older">Ältere (34) ▾</div>
    </div>`;

const galBody = (open) => `
    ${ph('mock-pl-gal', 'Galerie', 'Galerie', 'Wallpaper aus dem Verse – und deine vollendeten Sternkarten.', `<div class="mk-aside-row"><span class="mock-chip">128 Bilder</span><a class="mk-act" data-screen-link="${S.map}">✦ Meine Sternkarten</a></div>`)}
    <section>
      <div class="mk-sh"><h2>Wallpaper</h2><span>neueste zuerst</span>
        <div class="mk-tz mk-push">${teaserPill('star', S.galTz, open)}${open ? teaserCard('star', S.gal, true) : ''}</div></div>
      <div class="mock-grid" style="--mock-c:5">
        ${['', 'mock-v2', 'mock-v3', 'mock-v4', '', 'mock-v3', 'mock-v4', 'mock-v2', '', 'mock-v3', 'mock-v2', '', 'mock-v4', 'mock-v3', ''].map((v) => `<div class="mock-glass mock-tile"><div class="mock-img ${v}" style="height:96px"></div></div>`).join('')}
      </div>
    </section>`;

const domeSvg = () => `
        <svg viewBox="0 0 900 330" preserveAspectRatio="xMidYMid meet">
          <g stroke="#cfe8ff" stroke-width="1.4" opacity=".9"><line x1="300" y1="110" x2="390" y2="70"/><line x1="390" y1="70" x2="470" y2="130"/><line x1="470" y1="130" x2="580" y2="100"/><line x1="470" y1="130" x2="440" y2="230"/><line x1="440" y1="230" x2="540" y2="262"/><line x1="580" y1="100" x2="640" y2="170"/></g>
          <g fill="#fff"><circle cx="300" cy="110" r="5"/><circle cx="390" cy="70" r="6"/><circle cx="470" cy="130" r="6"/><circle cx="580" cy="100" r="5"/><circle cx="440" cy="230" r="5"/><circle cx="640" cy="170" r="5"/><circle cx="540" cy="262" r="4"/></g>
          <g fill="none" stroke="#9fb3c8" stroke-dasharray="3 3"><circle cx="620" cy="260" r="5"/><circle cx="700" cy="215" r="5"/><circle cx="240" cy="190" r="5"/><circle cx="350" cy="280" r="5"/><circle cx="520" cy="40" r="5"/></g>
        </svg>`;
const miniMap = (lit) => `<svg viewBox="0 0 100 50"><g stroke="#cfe8ff" stroke-width="1" opacity="${lit ? '.9' : '.35'}"><line x1="20" y1="18" x2="40" y2="10"/><line x1="40" y1="10" x2="55" y2="26"/><line x1="55" y1="26" x2="78" y2="20"/><line x1="55" y1="26" x2="48" y2="42"/></g><g fill="${lit ? '#fff' : '#5d7286'}"><circle cx="20" cy="18" r="2"/><circle cx="40" cy="10" r="2.4"/><circle cx="55" cy="26" r="2.4"/><circle cx="78" cy="20" r="2"/><circle cx="48" cy="42" r="2"/></g></svg>`;

const mapBody = () => `
    ${ph('mock-pl-map', 'Sternkarte', 'Sternkarte 4.10', 'Jede Patch-Aufgabe entzündet einen Stern – vollende die Sternkarte.',
      `<div class="mk-aside-row"><span class="mock-chip">Form: Speerspitze</span><span class="mock-chip">7 / 12 Sterne</span><span class="mock-chip">✦ Kartograph · Rang 3</span></div>
       <div class="mk-aside-row"><a class="mk-act">⬇ Wallpaper exportieren</a><a class="mk-act">Meine Sternkarten</a><a class="mk-act" data-screen-link="${S.gal}">Galerie →</a><a class="mk-act">? Tour</a><a class="mk-act">⋯ mehr</a></div>`)}
    <div class="mk-patchbar"><span>Patch</span>${['4.6', '4.7', '4.8', '4.9'].map((p) => `<a class="mk-pchip">${p}</a>`).join('')}<a class="mk-pchip mk-on">4.10</a></div>
    <div class="mk-dome">${domeSvg()}</div>
    <div class="mk-tracks">
      <div class="mk-track"><h3>Kometen-Spur</h3><p>Wann geht 4.11 live? Dein Tipp und der Median der Community.</p>
        <div class="mk-comet"><b style="left:42%">Median 6. Nov</b><b style="left:61%;bottom:-24px">dein Tipp 8. Nov</b><i></i></div>
        <a class="mk-link2" style="margin-top:20px">Datum tippen →</a></div>
      <div class="mk-track"><h3>Tipp-Spur</h3><p>Welches Schiff zeigt die fertige Sternkarte?</p>
        <div class="mk-guess"><b>Polaris</b><i style="width:68%"></i><span>34 %</span></div>
        <div class="mk-guess"><b>Idris</b><i style="width:42%"></i><span>21 %</span></div>
        <div class="mk-guess"><b>Carrack</b><i style="width:24%"></i><span>12 %</span></div></div>
    </div>
    <section class="mock-sec" style="margin-top:30px">
      <div class="mk-sh"><h2>Serie</h2><span>alle Patches</span></div>
      <div class="mk-series">${['4.5', '4.6', '4.7', '4.8', '4.9'].map((p) => `<a class="mk-ser">${miniMap(true)}${p} · vollendet</a>`).join('')}<a class="mk-ser mk-on">${miniMap(false)}4.10 · 7 / 12</a></div>
    </section>`;

// ───────────────────────── Übergang ─────────────────────────
const miniHub = (style = '') => `<div class="mk-mini-hub"${style ? ` style="${style}"` : ''}>
          <div class="mk-mini-hero">4.10</div>
          <div class="mk-mini-pl mock-pl-patch" style="left:20%;top:54%;width:9%"></div>
          <div class="mk-mini-pl mock-pl-gal" style="left:80%;top:50%;width:12%"></div>
          <div class="mk-mini-hor"></div></div>`;
const miniPage = (style = '', cls = 'mk-mini-page', slot = '') => `<div class="${cls}"${style ? ` style="${style}"` : ''}>
          <div class="mk-mini-ph"><span class="mk-mini-slot ${slot}"></span><span class="mk-mini-lines"><i></i><i></i><i></i></span></div>
          <div class="mk-mini-blocks"><i></i><i></i><i></i></div></div>`;
const frame = (n, title, cap, f) => `
        <figure class="mk-fr">
          <div class="mk-mini mk-t-news">
            <div class="mk-mini-stars" style="transform:translateY(${f.stars}%)"></div>
            <div class="mk-mini-tint" style="opacity:${f.tint}"></div>
            ${miniHub(`transform:translateY(${f.hub}%)`)}
            ${miniPage(`transform:translateY(${f.page}%)`)}
            <div class="mk-mini-fly mock-pl-news${n === 1 ? ' mk-mini-ring' : ''}" style="left:${f.x}%;top:${f.y}%;width:${f.w}%"></div>
          </div>
          <figcaption><b>${title}</b>${cap}</figcaption>
        </figure>`;

const transBody = () => `
    <section style="padding-top:26px">
      <div class="mk-trans">
        <div class="mk-loop">
          <div class="mk-sh"><h2>Hub → News</h2><span>Klick auf den News-Planeten</span></div>
          <div class="mk-mini mk-t-news">
            <div class="mk-mini-stars"></div>
            <div class="mk-mini-tint"></div>
            ${miniHub()}
            ${miniPage()}
            <div class="mk-mini-fly mock-pl-news"></div>
          </div>
          <div class="mk-cap">Der Hub rollt <b>nach oben weg, wie beim Herunterscrollen</b>; die Sterne ziehen langsamer mit. Der Planet löst sich aus seiner Bahn und landet als Wappen neben dem Titel. Zurück zum Hub läuft dieselbe Bewegung rückwärts.</div>
        </div>
        <div class="mk-loop">
          <div class="mk-sh"><h2>Tab: News → Patches</h2><span>Capsule-Tabs, gleiche Bewegung</span></div>
          <div class="mk-mini mk-t-news">
            <div class="mk-mini-stars"></div>
            <div class="mk-mini-tint" style="animation:none"></div>
            ${miniPage('', 'mk-mini-page mk-pa', 'mock-pl-news')}
            <div class="mk-mini-tint mk-tint-b"></div>
            ${miniPage('', 'mk-mini-page mk-pb', 'mock-pl-patch')}
          </div>
          <div class="mk-cap">Die News-Seite rollt samt Wappen nach oben, Patches kommt von unten, der Farbschleier wechselt zum Patches-Planeten. Unter „reduzierte Bewegung“ blenden beide Übergänge nur über.</div>
        </div>
      </div>
      <a class="mock-btn" style="margin-top:14px" data-screen-link="${S.news}">Weiter zur Seite →</a>
    </section>
    <section class="mock-sec" style="margin-top:30px">
      <div class="mk-sh"><h2>Einzelbilder</h2><span>Hub → News, ~0,8 s</span></div>
      <div class="mk-film">
        ${frame(1, '0 ms', 'Klick auf News, der Planet leuchtet auf.', { stars: 0, tint: 0, hub: 0, page: 100, x: 6, y: 58, w: 13 })}
        ${frame(2, '≈ 250 ms', 'Hub rollt nach oben weg, der Planet hebt ab.', { stars: -5, tint: .2, hub: -38, page: 62, x: 7, y: 34, w: 14 })}
        ${frame(3, '≈ 550 ms', 'Horizont ist weg, die Seite steigt auf.', { stars: -11, tint: .65, hub: -88, page: 20, x: 7.5, y: 18, w: 12 })}
        ${frame(4, '≈ 800 ms', 'Seite steht, Wappen sitzt neben dem Titel.', { stars: -16, tint: 1, hub: -120, page: 0, x: 8, y: 10, w: 10.4 })}
      </div>
    </section>`;

const transScreen = () => `
  <div class="mock-app mk-deep mk-long mk-t-news">
    <div class="mock-stars"></div>
    <div class="mock-frame">${transBody()}</div>
  </div>`;

// ───────────────────────── design ─────────────────────────
const p = (n) => `r2-${n}`;
function d1() {
  return `
<section data-design="d1" data-nav-label="Anflug" data-design-active="true" data-screen-fit="full"
  data-design-motto="Kamera zoomt auf den Planeten, Unterseite ersetzt den Hub."
  data-design-traits="Klick auf einen Planeten: Hub rollt nach oben weg wie beim Scrollen|Planet landet als 64-px-Wappen links neben dem Seitentitel|Hinter jeder Unterseite nur Weltraum um ihren Planeten, kein Horizont"
  data-design-icon="rocket" data-design-color="#c9845f" data-design-overlay="br"
  data-design-improved="Wappen neben dem Titel, App-Teaser">
${screen(S.hub, 'Hub', hub(), [
    anno(p('d1-s1-a1'), 1, 'right', '.mk-hub-tz .mk-teaser', 'Der SCC-App-Teaser sitzt zugeklappt oben links unter der Kopfleiste. Richtiger Ort auf dem Hub, oder lieber unten über dem Horizont, nah an „Patches“?'),
    anno(p('d1-s1-a2'), 2, 'left', '.mk-apps-btn', '„⬇ Apps“ als beschrifteter Knopf in der Kopfleiste. Bleibt die Beschriftung, oder reicht ein Symbol wie beim Profil?', 'Apps-Menü in der Kopfleiste'),
  ], true)}
${screen(S.hubTz, 'Hub · Teaser offen', hub({ tzOpen: true }), [
    anno(p('d1-s2-a1'), 1, 'right', '.mk-teaser-card', 'Aufgeklappt wächst die Pille zur Karte: Vorschau, ein Satz, drei Punkte, Plattform/Version/Größe, Download. Fehlt etwas, oder ist es schon zu viel für den Hub?', 'Ein Teaser-Muster für alle Apps'),
  ])}
${screen(S.apps, 'Apps-Menü', hub({ appsOpen: true }), [
    anno(p('d1-s3-a1'), 1, 'left', '.mk-apps-menu', 'Das Menü zeigt nur die öffentlichen Apps. Soll der Data Uploader für Mitwirkende hier als roter Eintrag unten dazukommen, oder bleibt er nur auf der Codex-Startseite?'),
  ])}
${screen(S.trans, 'Übergang', transScreen(), [
    anno(p('d1-s4-a1'), 1, 'bottom', '.mk-loop .mk-mini', 'Gleiche Bewegung wie beim Herunterscrollen im Hub, ~0,8 s. Passt das Tempo, oder soll der Planet langsamer fliegen als die Seite rollt?', 'Bewegung wie beim Scrollen im Hub'),
    anno(p('d1-s4-a2'), 2, 'top', '.mk-film', 'Zurück zum Hub (über „◉ Verse“ oder Browser-Zurück) spielt den Flug rückwärts: Seite rollt nach unten, Planet kehrt in seine Bahn. Auch beim Browser-Zurück?'),
  ])}
${screen(S.news, 'News', page('mk-t-news', 'News', newsBody()), [
    anno(p('d1-s5-a1'), 1, 'right', '.mk-ph .mk-emb', 'Das Wappen ist 64 px groß und hat eine eigene Spalte links neben dem Titel. Passt die Größe, oder kleiner als Symbol in der Eyebrow-Zeile?', 'Planet neben dem Titel, keine Überlappung'),
    anno(p('d1-s5-a2'), 2, 'left', '.mock-stars', '', 'Kein Horizont mehr: Weltraum um News', '90%;--anno-y:12%'),
  ])}
${screen(S.patA, 'Patches · A', page('mk-t-patch', 'Patches', patchA()), [
    anno(p('d1-s6-a1'), 1, 'right', '.mk-facts', 'Variante A: keine Kennzahlen-Kacheln mehr, die Zahlen stehen als Sätze im Patch-Monitor (Takt-Leiste, ETA, Mediane). Liest sich das besser als B (Zahlen an der Zeitleiste)?', 'Kennzahlen im Patch-Monitor'),
    anno(p('d1-s6-a2'), 2, 'left', '.mk-hist', '„Selbst tippen“ führt zur Sternkarte, hier nur die Verteilung. Sobald das Datum feststeht, ersetzt das Datum die Verteilung. Soll man hier trotzdem schnell tippen können?', 'Community-Tipps sichtbar'),
    anno(p('d1-s6-a3'), 3, 'top', '.mk-entry', 'Die Zeitleiste wie heute: Stufe, Hotfix, Stabilität, Zeit, Punkte, RSI-Link; Klick öffnet das Dossier. Fehlt eine Angabe, oder ist eine zu viel?', 'Heutige Zeitleiste übernommen'),
  ])}
${screen(S.patB, 'Patches · B', page('mk-t-patch', 'Patches', patchB()), [
    anno(p('d1-s7-a1'), 1, 'right', '.mk-gap', 'Variante B: die Zahlen hängen als Abstände an der Zeitleiste (97 Tage zwischen 4.9 und 4.10, Testphase 23 Tage). Klarer als A?', 'Kennzahlen an der Zeitleiste'),
    anno(p('d1-s7-a2'), 2, 'right', '.mk-next-grid', 'Bereit-Checkliste und Kometen-Tipp sitzen im kommenden Patch (4.11) selbst statt in eigenen Kästen. Gehören sie dorthin?'),
    anno(p('d1-s7-a3'), 3, 'right', '.mk-node .mk-pct', 'Die Stabilität je Patch läuft als Farbleiste mit Prozentwert links an der Zeitleiste mit, statt als eigenes Diagramm. Reicht das?'),
  ])}
${screen(S.gal, 'Galerie', page('mk-t-gal', 'Galerie', galBody(false)), [
    anno(p('d1-s8-a1'), 1, 'left', '.mk-tz .mk-teaser', 'Starscape als kleiner Teaser rechts im Abschnittskopf, statt Karte oder Hero. Das Symbol wechselt leise die Wallpaper. Genug Aufmerksamkeit?', 'App klein und zugeklappt'),
  ])}
${screen(S.galTz, 'Galerie · Teaser offen', page('mk-t-gal', 'Galerie', galBody(true)))}
${screen(S.map, 'Sternkarte', page('mk-t-map', 'Sternkarte', mapBody()), [
    anno(p('d1-s10-a1'), 1, 'top', '.mk-dome', 'Die Kuppel hat keine Box mehr, nur einen weichen Lichthof. Szenensterne und Kartensterne können sich verwechseln: Szene hinter der Karte abdunkeln (wie hier) oder dort ganz ausblenden?', 'Karte ohne Box auf der Szene'),
    anno(p('d1-s10-a2'), 2, 'left', '.mk-aside .mk-aside-row + .mk-aside-row', 'Alle heutigen Aktionen stehen im Aktions-Slot des gemeinsamen Kopfs. Zu viele für den Kopf? Tour und Export könnten ins „⋯ mehr“.', 'Heutiger Aufbau, neuer Kopf'),
  ])}
</section>`;
}

// ───────────────────────── views ─────────────────────────
const evalBlock = (id, label, h, body, include) => `
    <div class="variant-evaluation" data-decision="${id}" data-label="${label}">
      <h3>${h}</h3>
      ${body}
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
<section data-view="r2-v1-rahmen" data-view-kind="decision" data-nav-label="Rahmen-Grenze" hidden>
  <div class="view-frame">
    <h2>Was gehört noch zum gemeinsamen Seitenkopf?</h2>
    <p><strong>Steht fest (Runde 1):</strong> Alle vier Unterseiten teilen Seitenrahmen (Breite 1280 / 1600 px, Abstände) und den Kopf bis einschließlich Titel: Brotkrumen, Eyebrow, H1, Untertitel. Darunter baut jede Seite ihren Inhalt eigen und darf eigen aussehen (Patches mit Zeitleiste, Sternkarte mit Kuppel).</p>
    <p>Offen sind drei Teile am Rand dieser Grenze. Jeder ist eine eigene Frage.</p>
${evalBlock('r2-v1-emblem', 'Planet-Wappen gehört zum Rahmen', 'Planet-Wappen gehört zum Rahmen', '<p>Jede Unterseite hat links neben dem Titel ihr Wappen in derselben Größe und Spalte (64 px). Der Flug vom Hub landet immer an derselben Stelle. Ohne: jede Seite entscheidet selbst, ob und wo der Planet steht.</p>', true)}
${evalBlock('r2-v1-aside', 'Aside-/Aktions-Slot gehört zum Rahmen', 'Aside- und Aktions-Slot rechts im Kopf gehört zum Rahmen', '<p>Rechts im Kopf sitzt immer derselbe Slot: oben Status-Chips (Datenstand, Anzahl, Fortschritt), darunter Aktionen. Die Sternkarte legt dort ihre Aktionen ab, News ihren Aktualisiert-Chip. Ohne: Aktionen wandern in den Seiteninhalt, der Kopf ist bei allen gleich schlank.</p>', true)}
${evalBlock('r2-v1-gap', 'Fester Abstand unter dem Kopf', 'Fester Abstand Kopf → Inhalt und am Seitenende', '<p>Unter dem Kopf immer eine Trennlinie und 28 px Luft, am Seitenende immer 56 px. Das ist der Teil des Rahmens, der die Seiten am deutlichsten gleich wirken lässt, auch wenn der Inhalt verschieden aussieht.</p>', true)}
  </div>
</section>

<section data-view="r2-v2-abzeichen" data-view-kind="decision" data-nav-label="Abzeichen-Ort" hidden>
  <div class="view-frame">
    <h2>Wo lebt das Kartograph-Abzeichen, wenn es aus dem Profilmenü fliegt?</h2>
    <p><strong>Befund:</strong> Heute ist „Kartograph-Abzeichen“ ein Eintrag im Konto-Menü der Kopfleiste (→ <code>/badge/kartograph</code>, gesperrt → Sternkarte) und über die Suche auffindbar. Eine Profilseite gibt es nicht; Konto-Dinge liegen unter <code>/settings</code> („Konto &amp; Identität“). Die teilbare Seite <code>/badge/kartograph</code> bleibt in jedem Fall.</p>
${evalBlock('r2-v2-map', 'Chip im Kopf der Sternkarte', 'Chip im Kopf der Sternkarte', '<p>„✦ Kartograph · Rang 3“ steht als Chip im Aside-Slot der Sternkarte (siehe Design) und führt zur Abzeichen-Seite. Das Abzeichen sitzt dort, wo man es verdient. <em>Empfehlung.</em></p>', true)}
${evalBlock('r2-v2-settings', 'In den Einstellungen', 'Abschnitt „Abzeichen“ in den Einstellungen', '<p>Unter „Konto &amp; Identität“ eine Zeile mit Rang und Link zur Abzeichen-Seite. Ordentlich, aber Einstellungen sind zum Einstellen da, nicht zum Vorzeigen.</p>', false)}
${evalBlock('r2-v2-both', 'Sternkarte und Einstellungen', 'Beides: Chip auf der Sternkarte und Zeile in den Einstellungen', '<p>Sichtbar am Ort und auffindbar beim Konto. Zwei Stellen, die gepflegt werden müssen.</p>', false)}
${evalBlock('r2-v2-search', 'Nur Suche und Abzeichen-Seite', 'Nur über Suche und die teilbare Seite', '<p>Kein fester Platz in der Oberfläche. Am wenigsten Aufwand, aber wer das Abzeichen nicht kennt, findet es nie.</p>', false)}
  </div>
</section>

<section data-view="r2-v3-teaser" data-view-kind="decision" data-nav-label="App-Teaser-Verhalten" hidden>
  <div class="view-frame">
    <h2>Wie verhält sich der App-Teaser?</h2>
    <p>Der Teaser ist ein Muster für alle Apps: zugeklappt Symbol + eine Zeile, aufgeklappt eine Karte an derselben Stelle, darunter verschiebt sich nichts. Probiere ihn im Design auf dem Hub (SCC App) und in der Galerie (Starscape). Die ersten beiden Punkte schließen sich aus, die letzten beiden sind unabhängig.</p>
${evalBlock('r2-v3-click', 'Aufklappen per Klick', 'Aufklappen per Klick', '<p>Klick (oder Enter/Leertaste) klappt auf, Klick auf ▴, Escape oder daneben klappt zu. Verhält sich auf Maus, Touch und Tastatur gleich. <em>Empfehlung.</em></p>', true)}
${evalBlock('r2-v3-hover', 'Aufklappen beim Darüberfahren', 'Aufklappen schon beim Darüberfahren', '<p>Am Desktop klappt die Karte nach kurzer Verzögerung beim Darüberfahren auf, auf Touch per Tippen. Schneller entdeckt, klappt aber auch auf, wenn man nur vorbeifährt.</p>', false)}
${evalBlock('r2-v3-remember', 'Zuklappen merken', 'Einmal zugeklappt bleibt zugeklappt', '<p>Wer die Karte aufgeklappt und wieder geschlossen hat, sieht danach nur noch die Pille, ohne Glanz-Animation (gemerkt pro App auf diesem Gerät).</p>', true)}
${evalBlock('r2-v3-hide', 'Nach Download ausblenden', 'Nach dem Download ausblenden', '<p>Nach Klick auf „Download“ verschwindet der Teaser dieser App auf diesem Gerät; das Apps-Menü in der Kopfleiste bleibt der Weg zu Updates.</p>', true)}
  </div>
</section>`;

const html = `<section data-iteration="2" data-iteration-template="design">
${css}
  <header class="iteration-intro">
    <h2>{{iteration.tab}} 2 · Anflug, verfeinert</h2>
    <p>Weiter mit „Anflug“. Was sich aus deinem Feedback geändert hat:</p>
    <ul>
      <li>Übergang = dieselbe senkrechte Bewegung wie beim Herunterscrollen im Hub, auch für die Capsule-Tabs.</li>
      <li>Planet-Wappen sitzt neben dem Titel statt über dem Kopf; kein Horizont mehr hinter Unterseiten.</li>
      <li>Patches in zwei Aufbauten (A / B) mit neu gedachten Kennzahlen, der heutigen Zeitleiste, Patch-Monitor, Suche und sichtbaren Community-Tipps.</li>
      <li>App-Teaser (klein, klappt animiert auf) auf dem Hub (SCC App) und in der Galerie (Starscape), dazu das Apps-Menü in der Kopfleiste.</li>
      <li>Sternkarte im heutigen Aufbau, aber ohne große Box und mit dem gemeinsamen Kopf. Überall nur noch „Sternkarte“, auch für die Karte je Patch („Sternkarte 4.10“, „Meine Sternkarten“).</li>
      <li>Der gemeinsame Rahmen reicht bis zum Titel; darunter darf jede Seite eigen aussehen.</li>
    </ul>
  </header>
${d1()}
${views}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('written', html.length);
