// Generates round 03 of the verse-unterseiten concept (d1 "Anflug", close to the real app).
// Usage: node gen-round03.cjs rounds/03.html
// The round-2 stylesheet (round-1 vocabulary .mock-* + round-2 .mk-*) is copied
// verbatim from rounds/02.html, so this round renders on its own without
// restyling a frozen round. Everything new is written with the placeholder
// prefix "mk3-" and emitted as "mk-r3-" (the gate's mock prefixes are
// d<n>- / s<n>- / mock- / mk-).
const fs = require('fs');
const path = require('path');
const out = process.argv[2];

const r2 = fs.readFileSync(path.join(__dirname, 'rounds', '02.html'), 'utf8');
const sa = r2.indexOf('<style>');
const sb = r2.indexOf('</style>');
if (sa < 0 || sb < 0) throw new Error('round-2 stylesheet not found');
const r2css = r2.slice(sa + '<style>'.length, sb).trim();

const css3 = `
/* ── round 3 · close to the app (prefix mk-r3-) ── */
/* cinematic main header (#841): brand · fixed 112 px nav slots · account, straight on the scene */
.mk3-mh { position: relative; z-index: 6; padding-top: 16px; }
.mk3-mh::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 150px; z-index: -1; pointer-events: none;
  background: linear-gradient(180deg, rgba(6,20,32,.55), transparent); }
.mk3-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: min(1060px, calc(100% - 80px)); min-height: 56px; margin: 0 auto; }
.mk3-brand { justify-self: start; display: flex; align-items: center; gap: 12px; color: #e8ebed; text-decoration: none; cursor: pointer; text-shadow: 0 2px 14px rgba(0,0,0,.85); }
.mk3-mark { position: relative; flex: none; display: inline-block; width: 34px; height: 34px; border-radius: 50%; box-sizing: border-box;
  border: 2px solid #52c1e6; box-shadow: 0 0 10px rgba(82,193,230,.55), inset 0 0 8px rgba(82,193,230,.35); }
.mk3-mark::after { content: ""; position: absolute; left: 50%; top: 50%; width: 32%; height: 32%; border-radius: 50%; transform: translate(-50%, -50%); background: #8fe3ff; box-shadow: 0 0 6px #8fe3ff; }
.mk3-word { display: grid; }
.mk3-word b { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 15px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
.mk3-word small { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 9px; letter-spacing: .42em; text-transform: uppercase; color: #52c1e6; }
.mk3-nav { position: relative; justify-self: center; display: flex; }
.mk3-slot { display: block; width: 112px; padding: 12px 0; text-align: center; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 13px;
  letter-spacing: .22em; text-transform: uppercase; text-decoration: none; cursor: pointer; color: rgba(232,235,237,.72); text-shadow: 0 1px 14px rgba(0,0,0,.9); }
.mk3-slot:hover { color: #e8ebed; }
.mk3-slot.mk3-on { color: #e8ebed; text-shadow: 0 0 18px rgba(82,193,230,.55), 0 1px 14px rgba(0,0,0,.9); }
.mk3-slot.mk3-hot { color: #ff5722; }
.mk3-ind { position: absolute; bottom: 2px; left: 36px; width: 40px; height: 2px; border-radius: 2px; background: #52c1e6; box-shadow: 0 0 12px #52c1e6; }
.mk3-acc { justify-self: end; display: flex; align-items: center; gap: 12px; }
.mk3-apps-pos { position: absolute; z-index: 8; top: 74px; right: max(40px, calc((100% - 1060px) / 2)); }
.mk3-apps-pos .mk-apps-menu { position: relative; right: auto; top: auto; }

/* the search field (fusion search): rim from app tokens, glyph, context chip, Strg K */
.mk3-field { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; height: 44px; padding: 0 12px; box-sizing: border-box;
  border: 1px solid transparent; border-radius: 16px; color: #84a0b6; font-size: 13px; cursor: text;
  background: linear-gradient(rgba(6,20,32,.88), rgba(6,20,32,.88)) padding-box,
    linear-gradient(90deg, rgba(82,193,230,.7), rgba(52,100,128,.6), rgba(82,193,230,.7)) border-box; }
.mk3-glyph { flex: none; width: 17px; height: 17px; fill: none; stroke: #52c1e6; stroke-width: 1.8; stroke-linecap: round; }
.mk3-phd { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk3-kbd { flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 6px; border: 1px solid rgba(159,179,200,.3);
  border-bottom-width: 2px; background: #0e2433; color: #cfe3f1; font: 10.5px Consolas, monospace; white-space: nowrap; }
.mk3-ctx { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px 0 11px; border-radius: 999px;
  background: rgba(82,193,230,.16); box-shadow: inset 0 0 0 1px rgba(82,193,230,.4); color: #e8ebed; font-size: 11.5px; white-space: nowrap; }
.mk3-ctx i { font-style: normal; color: #84a0b6; padding-left: 4px; }
.mk3-stage { position: absolute; z-index: 5; left: 50%; top: 92px; width: min(560px, 60%); transform: translateX(-50%); }
.mk3-stage::before { content: ""; position: absolute; left: 10%; right: 10%; top: -40%; bottom: -40%; z-index: -1; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(110,210,255,.22), transparent); }
.mk3-stage .mk3-field { height: 48px; }

/* the docked subheader "Satinkante" (#841): logo slot · plate · divider · search · account */
.mk3-sub { position: relative; z-index: 6; display: flex; align-items: center; width: min(1060px, calc(100% - 80px)); height: 60px; margin: 4px auto 0;
  padding: 0 16px; box-sizing: border-box; border: 1px solid transparent; border-radius: 5px;
  background: linear-gradient(180deg, #0a1d2b, #061724) padding-box,
    linear-gradient(160deg, rgba(200,236,250,.7) 0%, rgba(80,125,148,.45) 30%, rgba(30,58,74,.5) 60%, rgba(140,200,225,.55) 100%) border-box;
  box-shadow: 0 0 14px rgba(82,193,230,.08), 0 14px 34px rgba(0,0,0,.45); }
.mk3-sub::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(180deg, rgba(210,242,255,.07), transparent 55%); }
.mk3-blogo { flex: none; display: flex; align-items: center; width: 44px; height: 40px; cursor: pointer; text-decoration: none; }
.mk3-blogo .mk3-mark { width: 28px; height: 28px; }
.mk3-plate { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; max-width: 220px; padding-right: 8px; }
.mk3-cat { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11.5px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #e8ebed; }
.mk3-back { display: inline-flex; align-items: baseline; gap: 6px; color: #84a0b6; font-size: 12.5px; text-decoration: none; cursor: pointer; }
.mk3-back i { font-style: normal; color: #52c1e6; font-size: .8em; }
.mk3-back:hover { color: #e8ebed; }
.mk3-path { position: absolute; top: calc(100% + 12px); left: -8px; z-index: 9; display: none; gap: 8px; padding: 8px 12px; white-space: nowrap; font-size: 12.5px; color: #cfe3f1;
  border: 1px solid transparent; border-radius: 5px; box-shadow: 0 14px 34px rgba(0,0,0,.45);
  background: linear-gradient(180deg, #0a1d2b, #061724) padding-box, linear-gradient(160deg, rgba(200,236,250,.7), rgba(30,58,74,.5) 60%, rgba(140,200,225,.55)) border-box; }
.mk3-plate:hover .mk3-path { display: flex; }
.mk3-path a { color: #cfe3f1; text-decoration: none; cursor: pointer; }
.mk3-path a:hover { color: #52c1e6; }
.mk3-path span { color: #84a0b6; }
.mk3-path b { color: #e8ebed; font-weight: 600; }
.mk3-div { flex: none; width: 1px; height: 34px; margin: 0 16px 0 8px; background: linear-gradient(180deg, transparent, rgba(160,230,255,.8), transparent); }
.mk3-sub .mk3-field { flex: 1; }
.mk3-sub .mk3-acc { margin-left: 16px; }

/* the frame head without a title block: emblem · one slim line (small h1 + subtitle) · aside */
.mk3-fh { display: flex; align-items: center; gap: 16px; min-height: 44px; padding: 24px 0 16px; margin-bottom: 28px; border-bottom: 1px solid rgba(130,220,255,.14); }
.mk3-fh .mk3-emb { position: relative; flex: none; width: 44px; height: 44px; }
.mk3-fh-t { flex: 1; display: flex; align-items: baseline; gap: 14px; min-width: 0; }
.mk3-fh h1 { margin: 0; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 15px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: #e8ebed; white-space: nowrap; }
.mk3-fh p { margin: 0; min-width: 0; color: #9fb3c8; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk3-aside { flex: none; display: flex; align-items: center; }
.mk3-aside > * + * { border-left: 1px solid rgba(130,220,255,.16); }
.mk3-ai { display: inline-flex; align-items: center; gap: 7px; padding: 3px 14px; font-size: 12.5px; color: #cfe3f1; text-decoration: none; cursor: pointer; white-space: nowrap; }
.mk3-ai:last-child { padding-right: 0; }
.mk3-ai:hover { color: #52c1e6; }
.mk3-ai.mk3-st { color: #84a0b6; cursor: default; }
.mk3-ai.mk3-st:hover { color: #84a0b6; }
.mk3-dot { width: 6px; height: 6px; border-radius: 50%; background: #52c1e6; box-shadow: 0 0 6px #52c1e6; }
.mk3-ai.mk3-q span { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(82,193,230,.45); font-size: 11px; }
.mk3-ai.mk3-sf { gap: 8px; color: #84a0b6; }
.mk3-ai.mk3-sf .mk3-field { width: 250px; height: 34px; border-radius: 10px; font-size: 12px; }

/* app-styled select (sc-select look) for the patch */
.mk3-sel { position: relative; }
.mk3-sel summary { list-style: none; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px 0 12px; border-radius: 8px;
  border: 1px solid rgba(82,193,230,.35); background: rgba(6,20,32,.6); color: #e8ebed; font-size: 12.5px; cursor: pointer; }
.mk3-sel summary::-webkit-details-marker { display: none; }
.mk3-sel summary em { font-style: normal; color: #84a0b6; font-size: 11.5px; }
.mk3-sel summary i { font-style: normal; color: #52c1e6; font-size: 10px; }
.mk3-sel[open] summary { border-color: #52c1e6; box-shadow: 0 0 0 3px rgba(82,193,230,.18); }
.mk3-sel ul { position: absolute; left: 0; top: calc(100% + 6px); z-index: 9; min-width: 240px; margin: 0; padding: 6px; list-style: none; border-radius: 10px;
  border: 1px solid rgba(82,193,230,.35); background: rgba(8,26,40,.97); box-shadow: 0 18px 50px rgba(0,0,0,.55); }
.mk3-sel li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 7px; font-size: 12.5px; color: #cfe3f1; cursor: pointer; }
.mk3-sel li:hover { background: rgba(82,193,230,.08); }
.mk3-sel li.mk3-on { background: rgba(82,193,230,.14); color: #e8ebed; }
.mk3-sel li small { margin-left: auto; color: #84a0b6; font-size: 11.5px; }
.mk3-sel li b { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 12px; font-weight: 600; min-width: 34px; }

/* stage tags (filled = stage) and the stability meter (bars = how it runs) */
.mk3-tag { display: inline-block; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 3px 7px; border-radius: 5px; text-align: center; }
.mk3-tag-live { background: #5fd698; color: #061420; font-weight: 600; }
.mk3-tag-ptu { color: #52c1e6; box-shadow: inset 0 0 0 1px #52c1e6; }
.mk3-tag-evo { color: #cfe3f1; box-shadow: inset 0 0 0 1px rgba(207,227,241,.5); }
.mk3-tag-hf { color: #cfe3f1; background: rgba(159,179,200,.14); }
.mk3-meter { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; vertical-align: -2px; }
.mk3-meter i { width: 4px; border-radius: 1px; background: rgba(191,230,255,.16); }
.mk3-meter i:nth-child(1) { height: 30%; }
.mk3-meter i:nth-child(2) { height: 47%; }
.mk3-meter i:nth-child(3) { height: 64%; }
.mk3-meter i:nth-child(4) { height: 82%; }
.mk3-meter i:nth-child(5) { height: 100%; }
.mk3-meter i.mk3-f { background: #bfe6ff; box-shadow: 0 0 5px rgba(191,230,255,.45); }
.mk3-meter.mk3-w i.mk3-f { background: #f0c27b; box-shadow: none; }

/* Patches: B's spine, today's patch cards, nested sub-versions */
.mk3-tl-h { display: flex; gap: 38px; margin: 0 0 8px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: #84a0b6; }
.mk3-tl-h span:first-child { width: 66px; text-align: right; }
.mk3-tl { position: relative; padding-left: 104px; }
.mk3-tl::before { content: ""; position: absolute; left: 84px; top: 14px; bottom: 14px; width: 2px;
  background: linear-gradient(180deg, rgba(82,193,230,.55), rgba(95,214,152,.55) 45%, rgba(159,179,200,.2)); }
.mk3-nd { position: relative; }
.mk3-nd::before { content: ""; position: absolute; left: -25px; top: 28px; width: 10px; height: 10px; border-radius: 50%; background: #9fb3c8; border: 2px solid #061420; z-index: 1; }
.mk3-nd.mk3-n-live::before { left: -27px; width: 14px; height: 14px; background: #5fd698; box-shadow: 0 0 12px rgba(95,214,152,.6); }
.mk3-nd.mk3-n-next::before { background: #52c1e6; }
.mk3-stb { position: absolute; left: -104px; top: 18px; width: 66px; text-align: right; }
.mk3-stb b { display: block; margin-top: 4px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 13px; font-weight: 600; color: #e8ebed; }
.mk3-stb.mk3-w b { color: #f0c27b; }
.mk3-stb small { display: block; margin-top: 2px; font-size: 10px; color: #84a0b6; line-height: 1.3; }
.mk3-card { position: relative; border-radius: 10px; border: 1px solid rgba(82,193,230,.18); background: rgba(9,30,45,.42); overflow: hidden; }
.mk3-card.mk3-live { border-color: rgba(95,214,152,.5); background: linear-gradient(135deg, rgba(95,214,152,.09), rgba(9,30,45,.42) 60%); }
.mk3-card.mk3-next { border-color: rgba(82,193,230,.45); background: linear-gradient(135deg, rgba(82,193,230,.09), rgba(9,30,45,.42) 60%); }
.mk3-card.mk3-old { opacity: .82; }
.mk3-ch { display: grid; grid-template-columns: 116px 150px minmax(0, 1fr); align-items: center; gap: 10px 18px; padding: 14px 16px; }
.mk3-sw { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
  font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; text-align: center; }
.mk3-sw small { font-family: Inter, "Segoe UI", sans-serif; font-weight: 400; font-size: 10.5px; letter-spacing: 0; text-transform: none; opacity: .85; white-space: nowrap; }
.mk3-sw-live { color: #061420; background: #5fd698; box-shadow: 0 0 18px rgba(95,214,152,.35); }
.mk3-sw-next { color: #52c1e6; border: 1.5px solid #52c1e6; box-shadow: 0 0 14px rgba(82,193,230,.25); }
.mk3-sw-old { color: #84a0b6; border: 1.5px solid rgba(132,160,182,.4); }
.mk3-v { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 18px; font-weight: 600; letter-spacing: .02em; }
.mk3-card.mk3-live .mk3-v { font-size: 30px; }
.mk3-card.mk3-next .mk3-v { font-size: 24px; }
.mk3-v small { display: block; margin-top: 3px; font-family: Inter, "Segoe UI", sans-serif; font-size: 11.5px; font-weight: 400; letter-spacing: .02em; color: #84a0b6; }
.mk3-sent { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: 12px; color: #9fb3c8; }
.mk3-sent b { color: #e8ebed; font-weight: 500; font-size: 13px; }
.mk3-tz { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.mk3-th { position: relative; width: 96px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(82,193,230,.2); cursor: pointer; text-decoration: none;
  background: linear-gradient(135deg, #24536f, #0b2232 60%, #3c2a4f); }
.mk3-th.mk3-t1 { background: linear-gradient(160deg, #6b4a2e, #1b2a34 60%, #2c5a7a); }
.mk3-th.mk3-t2 { background: linear-gradient(120deg, #1d6f8f, #0a1f2c 55%, #7a3f2c); }
.mk3-th.mk3-t3 { background: linear-gradient(150deg, #44345f, #0d2433 60%, #2b6f6a); }
.mk3-th:hover { border-color: #52c1e6; }
.mk3-th span { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px; font-size: 9.5px; color: #e8ebed; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: linear-gradient(transparent, rgba(0,0,0,.72)); }
.mk3-th.mk3-rest { width: 40px; display: grid; place-items: center; color: #52c1e6; background: rgba(82,193,230,.08); }
.mk3-mon { padding: 0 16px 14px 150px; }
.mk3-mon p { margin: 0; color: #cfe3f1; font-size: 13px; line-height: 1.75; }
.mk3-mon p b { font-family: Orbitron, "Segoe UI", sans-serif; color: #52c1e6; font-weight: 600; font-size: 12.5px; }
.mk3-takt { position: relative; height: 6px; border-radius: 4px; margin: 26px 0 5px;
  background: linear-gradient(90deg, rgba(82,193,230,.4) 0 58%, rgba(159,179,200,.25) 58% 80%, rgba(240,194,123,.45) 80%); }
.mk3-takt i { position: absolute; top: -5px; width: 2px; height: 16px; background: #fff; box-shadow: 0 0 8px #fff; }
.mk3-takt em { position: absolute; top: -22px; transform: translateX(-50%); font-style: normal; font-size: 11px; color: #e8ebed; white-space: nowrap; }
.mk3-takt-l { display: flex; justify-content: space-between; font-size: 10px; color: #84a0b6; letter-spacing: .1em; }
.mk3-ng { display: grid; grid-template-columns: 1fr 1.25fr; gap: 30px; padding: 14px 16px 16px 150px; border-top: 1px solid rgba(82,193,230,.1); }
.mk3-ngh { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.mk3-ngh h3 { margin: 0; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11.5px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: #52c1e6; white-space: nowrap; }
.mk3-ngh span { color: #84a0b6; font-size: 12px; }
.mk3-ngh .mk3-tip { margin-left: auto; color: #52c1e6; font-size: 12.5px; font-weight: 600; text-decoration: none; cursor: pointer; white-space: nowrap; }
.mk3-ngh .mk3-tip:hover { text-decoration: underline; }
.mk3-ngh .mk3-mine { color: #e8ebed; }
.mk3-hw { position: relative; }
.mk3-you { position: absolute; top: -4px; transform: translateX(-50%); font-size: 10.5px; color: #e8ebed; white-space: nowrap; }
.mk3-subs { position: relative; margin: 0 16px 14px 150px; padding-left: 16px; }
.mk3-subs::before { content: ""; position: absolute; left: 0; top: -6px; bottom: 16px; width: 2px; border-radius: 2px; background: rgba(82,193,230,.35); }
.mk3-subs-h { position: relative; margin: 0 0 4px; padding-left: 10px; font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: #84a0b6; }
.mk3-sv { position: relative; display: grid; grid-template-columns: 58px minmax(0, 1fr) 58px 60px 82px 74px 14px; gap: 10px; align-items: center;
  padding: 7px 10px; border-radius: 7px; font-size: 12.5px; color: #cfe3f1; text-decoration: none; cursor: pointer; }
.mk3-sv::before { content: ""; position: absolute; left: -16px; top: 50%; width: 14px; height: 2px; background: rgba(82,193,230,.35); }
.mk3-sv:hover { background: rgba(82,193,230,.06); }
.mk3-sl { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11.5px; color: #e8ebed; }
.mk3-svt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk3-svs { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #cfe3f1; white-space: nowrap; }
.mk3-svs.mk3-w { color: #f0c27b; }
.mk3-svs em { font-style: normal; color: #84a0b6; }
.mk3-more { display: inline-block; margin: 4px 0 0 10px; color: #84a0b6; font-size: 12px; cursor: pointer; text-decoration: none; }
.mk3-more:hover { color: #52c1e6; }
.mk3-gap { padding: 10px 0 10px 2px; color: #9fb3c8; font-size: 12px; }
.mk3-gap b { color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 12px; font-weight: 600; }
.mk3-gap .mk3-ok { color: #52c1e6; }
.mk3-gap .mk3-warn { color: #f0c27b; }

/* News: the hero card first, filters right above the feed */
.mk3-hero { display: grid; grid-template-columns: 1.55fr 1fr; min-height: 250px; border-radius: 16px; overflow: hidden; border: 1px solid rgba(82,193,230,.22); background: rgba(9,30,45,.5); }
.mk3-hero-img { position: relative; display: block; background: linear-gradient(120deg, #123a52, #091b28 50%, #2a4a63); cursor: pointer; }
.mk3-play { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; border-radius: 50%; transform: translate(-50%, -50%);
  background: rgba(6,20,32,.6); box-shadow: inset 0 0 0 1px rgba(232,235,237,.5); }
.mk3-play::after { content: ""; position: absolute; left: 23px; top: 18px; border-style: solid; border-width: 11px 0 11px 17px; border-color: transparent transparent transparent #e8ebed; }
.mk3-hero-b { display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 24px 26px; }
.mk3-hero-b small { color: #52c1e6; letter-spacing: .2em; font-size: 10.5px; }
.mk3-hero-b strong { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 22px; line-height: 1.22; }
.mk3-hero-b > span { color: #9fb3c8; font-size: 13px; line-height: 1.5; }
.mk3-acts { display: flex; gap: 8px; margin-top: 4px; }
.mk3-filt { display: flex; align-items: center; gap: 8px; margin: 24px 0 12px; }
.mk3-chip { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(82,193,230,.25); background: rgba(6,20,32,.35);
  color: #9fb3c8; font-size: 12.5px; text-decoration: none; cursor: pointer; white-space: nowrap; }
.mk3-chip:hover { color: #e8ebed; border-color: rgba(82,193,230,.55); }
.mk3-chip.mk3-on { color: #04202e; background: #52c1e6; border-color: #52c1e6; font-weight: 600; }
.mk3-chip i { width: 7px; height: 7px; border-radius: 50%; }
.mk3-push { margin-left: auto; }
.mk3-cnt { color: #84a0b6; font-size: 12px; padding-left: 6px; }

/* Galerie: the app teaser as a toast bottom-right, same look as the star toast, above the launcher lane */
.mk3-lane { position: absolute; z-index: 7; right: 24px; bottom: 24px; width: 52px; height: 52px; border-radius: 50%; box-sizing: border-box;
  border: 1px dashed rgba(159,179,200,.5); display: grid; place-items: center; color: #84a0b6; font-size: 10px; letter-spacing: .08em; }
.mk3-toast { position: absolute; z-index: 8; right: 24px; bottom: 92px; width: 372px; box-sizing: border-box; display: grid; grid-template-columns: auto 1fr auto;
  gap: 12px; align-items: start; padding: 14px 14px 16px; border-radius: 14px; overflow: hidden;
  background: rgba(8,26,40,.94); border: 1px solid rgba(82,193,230,.45); box-shadow: 0 18px 44px rgba(0,0,0,.55), 0 0 30px rgba(82,193,230,.14);
  animation: mk3-toast-in .5s cubic-bezier(.2,.8,.2,1) both; --mk-s: 40px; }
@keyframes mk3-toast-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
.mk3-tb { display: grid; gap: 3px; min-width: 0; color: inherit; text-decoration: none; cursor: pointer; }
.mk3-tb small { font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: #52c1e6; }
.mk3-tb b { font-size: 14px; font-weight: 600; }
.mk3-tb span { font-size: 12px; color: #9fb3c8; }
.mk3-tb:hover b { text-decoration: underline; }
.mk3-tx { display: flex; gap: 6px; }
.mk3-x { width: 28px; height: 28px; border-radius: 50%; box-sizing: border-box; border: 1px solid rgba(159,179,200,.3); display: grid; place-items: center;
  color: #9fb3c8; font-size: 12px; text-decoration: none; cursor: pointer; }
.mk3-x:hover { color: #e8ebed; border-color: #52c1e6; }
.mk3-drain { position: absolute; inset: auto 0 0 0; height: 2px; background: #52c1e6; transform-origin: left center; animation: mk3-drain 8s linear both; }
@keyframes mk3-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.mk3-toast.mk3-open { display: block; width: 384px; padding: 0; animation: mk3-unfold .6s cubic-bezier(.3,.7,.2,1) both; }
@keyframes mk3-unfold { from { clip-path: inset(calc(100% - 82px) 0 0 0 round 14px); } to { clip-path: inset(0 0 0 0 round 14px); } }
.mk3-open .mk-tc-body { padding-top: 16px; }
.mk3-open .mk3-tline { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: start; padding: 14px; border-top: 1px solid rgba(82,193,230,.18); }

/* Sternkarte: map without a box, large map stars, caption in the corner, today's tracks, crest ladder */
.mk3-map { position: relative; height: 340px; margin: 0 0 18px; }
.mk3-map::before { content: ""; position: absolute; left: -4%; right: -4%; top: 0; height: 560px; border-radius: 50%; pointer-events: none;
  border-top: 1px solid rgba(82,193,230,.18); background: radial-gradient(ellipse 46% 26% at 50% 18%, rgba(82,193,230,.12), transparent 70%);
  box-shadow: inset 0 40px 70px -40px rgba(82,193,230,.16); }
.mk3-map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.mk3-pulse { transform-box: fill-box; transform-origin: center; animation: mk3-pulse 2.2s ease-out infinite; }
@keyframes mk3-pulse { from { transform: scale(.7); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
.mk3-sun { position: absolute; right: 2%; top: 2%; width: 54px; height: 54px; border-radius: 50%; opacity: .4;
  background: radial-gradient(circle, #fff3dc 0 20%, #f0c27b 42%, rgba(240,194,123,0) 70%); }
.mk3-cap { position: absolute; left: 0; bottom: 8px; display: grid; gap: 4px; font-size: 12.5px; color: #9fb3c8; }
.mk3-cap .mk3-k { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 10px; letter-spacing: .24em; text-transform: uppercase; color: #52c1e6; }
.mk3-cap > b { color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 16px; font-weight: 600; letter-spacing: .06em; }
.mk3-cap .mk3-n { color: #e8ebed; font-family: Orbitron, "Segoe UI", sans-serif; font-weight: 600; }
.mk3-capr { display: inline-flex; align-items: center; gap: 7px; color: #cfe3f1; text-decoration: none; cursor: pointer; }
.mk3-capr:hover { color: #52c1e6; }
.mk3-tracks { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
.mk3-trk-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.mk3-trk-h b { font-size: 13px; font-weight: 600; color: #e8ebed; }
.mk3-kind { display: inline-flex; align-items: center; gap: 6px; font-family: Orbitron, "Segoe UI", sans-serif; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #84a0b6; white-space: nowrap; }
.mk3-info { width: 22px; height: 22px; border-radius: 50%; box-sizing: border-box; border: 1px solid rgba(82,193,230,.45); display: inline-grid; place-items: center;
  font: italic 600 11px Georgia, serif; color: #cfe3f1; cursor: help; }
.mk3-state { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #cfe3f1; white-space: nowrap; }
.mk3-ring { width: 13px; height: 13px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px #a9e2f5; }
.mk3-rail { position: relative; display: flex; gap: 6px; align-items: flex-start; }
.mk3-tok { position: relative; z-index: 1; flex: 1 1 0; min-width: 0; height: 44px; box-sizing: border-box; display: grid; align-content: center; justify-items: center; gap: 2px;
  border-radius: 8px; border: 1px solid rgba(82,193,230,.22); background: rgba(9,30,45,.35); color: #cfe3f1; font-size: 13px; font-variant-numeric: tabular-nums;
  cursor: pointer; transform: translateY(calc(var(--i) * var(--i) * var(--k))); }
.mk3-tok small { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #84a0b6; }
.mk3-tok:hover { border-color: #52c1e6; background: rgba(82,193,230,.12); color: #e8ebed; }
.mk3-tok.mk3-nav { flex: 0 0 26px; font-size: 15px; }
.mk3-tok.mk3-ship { height: 56px; border: 0; border-radius: 6px 6px 2px 2px; color: #9fdcf0;
  background: linear-gradient(0deg, rgba(82,193,230,.13), transparent 72%), repeating-linear-gradient(0deg, rgba(82,193,230,.06) 0 1px, transparent 1px 3px);
  box-shadow: inset 0 -1px 0 rgba(82,193,230,.45); }
.mk3-tok.mk3-ship svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linejoin: round; }
.mk3-tok.mk3-ship small { text-transform: none; letter-spacing: 0; font-size: 10.5px; color: #cfe3f1; }
.mk3-curve { position: absolute; left: 0; top: 0; width: 100%; overflow: visible; pointer-events: none; }
.mk3-curve path { fill: none; stroke: rgba(82,193,230,.4); stroke-width: 1; }
.mk3-trk-f { margin-top: 2px; font-size: 12px; color: #9fb3c8; }
.mk3-comet { position: relative; display: inline-block; width: 30px; height: 10px; transform: rotate(20deg); opacity: .4; }
.mk3-comet::before { content: ""; position: absolute; left: 0; right: 4px; top: 3px; height: 4px; clip-path: polygon(0 50%, 100% 0, 100% 100%);
  background: linear-gradient(90deg, transparent, rgba(82,193,230,.4) 45%, #eaf9ff); }
.mk3-comet::after { content: ""; position: absolute; right: 0; top: 1px; width: 8px; height: 8px; border-radius: 50%;
  background: radial-gradient(circle, #fff 0 25%, #a9e2f5 40%, transparent 72%); box-shadow: 0 0 8px #a9e2f5; }
.mk3-scope { width: 20px; height: 20px; fill: none; stroke: #52c1e6; stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.mk3-karto { display: flex; align-items: center; gap: 26px; margin-top: 30px; padding: 16px 0 6px; border-top: 1px solid rgba(82,193,230,.14); }
.mk3-karto-l { flex: none; display: grid; gap: 3px; width: 190px; }
.mk3-karto-l b { font-family: Orbitron, "Segoe UI", sans-serif; font-size: 18px; font-weight: 600; letter-spacing: .04em; }
.mk3-karto-l small { color: #9fb3c8; font-size: 12px; line-height: 1.4; }
.mk3-ladder { position: relative; flex: 1; display: flex; align-items: flex-start; justify-content: space-between; margin: 0; padding: 0; list-style: none; }
.mk3-ladder::before { content: ""; position: absolute; left: 6%; right: 6%; top: 30px; height: 2px;
  background: linear-gradient(90deg, #52c1e6 0 50%, rgba(82,193,230,.16) 50%); }
.mk3-rk { position: relative; z-index: 1; width: 13%; display: grid; justify-items: center; gap: 4px; text-align: center; font-size: 11.5px; color: #9fb3c8; }
.mk3-rk em { font-style: normal; }
.mk3-rk small { font-size: 10.5px; color: #84a0b6; }
.mk3-rk a { display: grid; justify-items: center; gap: 4px; color: inherit; text-decoration: none; cursor: pointer; }
.mk3-rk.mk3-cur { color: #e8ebed; }
.mk3-rk.mk3-cur small { color: #52c1e6; }
.mk3-rk.mk3-cur a:hover em { text-decoration: underline; }
.mk3-crest { display: block; color: #52c1e6; }
.mk3-crest .mk3-cs { fill: #071a27; stroke: currentColor; stroke-width: 1.4; }
.mk3-crest .mk3-mo { fill: currentColor; }
.mk3-crest .mk3-ln { fill: none; stroke: currentColor; stroke-width: 1; }
.mk3-rk.mk3-past .mk3-crest { margin-top: 8px; opacity: .85; }
.mk3-rk.mk3-cur .mk3-crest { color: #dff6ff; filter: drop-shadow(0 0 10px rgba(82,193,230,.65)); }
.mk3-rk.mk3-cur .mk3-crest .mk3-cs { fill: #0b2a3d; stroke: #8fe3ff; stroke-width: 1.8; }
.mk3-rk.mk3-lock { color: #84a0b6; }
.mk3-rk.mk3-lock .mk3-crest { margin-top: 8px; color: #5d7286; opacity: .55; }
.mk3-rk.mk3-lock .mk3-crest .mk3-cs { stroke-dasharray: 3 2; }

/* Übergang: same vertical move, the bar docks on the way; reverse back to the hub */
.mk3-trans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.mk3-mini .mk-mini-ph { top: 20%; align-items: center; gap: 2.5%; }
.mk3-mini .mk-mini-slot { width: 6.5%; }
.mk3-mini .mk-mini-lines { display: flex; align-items: center; gap: .8em; }
.mk3-mini .mk-mini-lines i { margin: 0; }
.mk3-mini .mk-mini-lines i:nth-child(1) { width: 12%; height: .7em; background: rgba(232,235,237,.85); }
.mk3-mini .mk-mini-lines i:nth-child(2) { width: 34%; height: .5em; background: rgba(159,179,200,.5); }
.mk3-mini .mk-mini-lines i:nth-child(3) { width: 14%; height: .5em; margin-left: auto; background: rgba(82,193,230,.5); }
.mk3-mini .mk-mini-blocks { top: 34%; }
.mk3-mini-bar { position: absolute; z-index: 3; left: 8%; right: 8%; top: 4%; height: 9%; border-radius: .35em; box-sizing: border-box;
  border: 1px solid rgba(160,220,245,.55); background: linear-gradient(#0a1d2b, #061724); }
.mk3-mini-bar::before { content: ""; position: absolute; left: 1.6%; top: 50%; width: .9em; height: .9em; transform: translateY(-50%); border-radius: 50%; border: 1.5px solid #52c1e6; }
.mk3-mini-bar::after { content: ""; position: absolute; left: 22%; right: 12%; top: 26%; bottom: 26%; border-radius: .5em; border: 1px solid rgba(82,193,230,.45); }
.mk3-mini-mh { position: absolute; left: 8%; right: 8%; top: 4%; height: 6%; display: flex; align-items: center; gap: 4%; }
.mk3-mini-mh i { flex: none; width: .9em; height: .9em; border-radius: 50%; border: 1.5px solid #52c1e6; }
.mk3-mini-mh b { width: 6%; height: .35em; border-radius: .2em; background: rgba(232,235,237,.6); }
.mk3-mini-mh b:first-of-type { margin-left: 28%; }
.mk3-mini-st { position: absolute; left: 30%; right: 30%; top: 15%; height: 7%; border-radius: .6em; border: 1px solid rgba(82,193,230,.6); background: rgba(6,20,32,.7); }
.mk-loop .mk3-mini .mk-mini-fly { animation-name: mk3-l-fly; }
.mk-loop .mk3-mini-bar { animation: mk3-l-bar 3.6s cubic-bezier(.65,0,.35,1) infinite; }
.mk-loop .mk3-mini-bar.mk3-keep { animation: none; }
@keyframes mk3-l-fly { 0%, 18% { left: 6%; top: 58%; width: 13%; } 45% { left: 7%; top: 36%; width: 11%; } 72%, 100% { left: 8%; top: 20%; width: 6.5%; } }
@keyframes mk3-l-bar { 0%, 30% { opacity: 0; transform: translateY(70%) scaleX(.55); } 58%, 100% { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .mk-loop .mk3-mini-bar { animation: mk-l-xin 3.6s ease infinite; }
  .mk-loop .mk3-mini-bar.mk3-keep { animation: none; }
  .mk3-pulse, .mk3-drain { animation: none; }
  .mk3-toast, .mk3-toast.mk3-open { animation: mk-l-xin .2s linear both; }
}
.mk3-rev .mk3-mini > * { animation-direction: reverse; }
`;

const css = `
<style>
${r2css}
${css3}
</style>`;

// ───────────────────────── helpers ─────────────────────────
const S = { hub: 'd1-s1', apps: 'd1-s2', trans: 'd1-s3', news: 'd1-s4', pat: 'd1-s5', patT: 'd1-s6', gal: 'd1-s7', galT: 'd1-s8', map: 'd1-s9' };

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

const glyph = '<svg class="mk3-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
const keys = '<span class="mk3-kbd">Strg K</span><span class="mk3-kbd">/</span>';

// the cinematic main header of the hub (#841)
const mainHeader = (appsOpen) => `
  <header class="mk3-mh">
    <div class="mk3-row">
      <a class="mk3-brand" data-screen-link="${S.hub}"><span class="mk3-mark"></span><span class="mk3-word"><b>Star Citizen Companion</b><small>Alpha</small></span></a>
      <nav class="mk3-nav"><a class="mk3-slot mk3-on">Verse</a><a class="mk3-slot">Codex</a><a class="mk3-slot">HQ</a><a class="mk3-slot mk3-hot">Admin</a><span class="mk3-ind"></span></nav>
      <div class="mk3-acc"><a class="mk-apps-btn${appsOpen ? ' mk-on' : ''}" data-screen-link="${appsOpen ? S.hub : S.apps}">⬇ Apps ${appsOpen ? '▴' : '▾'}</a><span class="mk-avatar">JT</span></div>
    </div>
  </header>`;

const appsMenu = () => `
  <div class="mk3-apps-pos">
    <div class="mk-apps-menu">
      <div class="mk-apps-head mock-disp">Desktop-Apps</div>
      <div class="mk-apps-item"><span class="mk-ico mk-ico-scc"></span>
        <div><b>SCC App</b><span>SC Companion als eigenes Windows-Fenster</span><small>Windows 10/11 · v0.50 · 92 MB</small></div>
        <button class="mock-btn">⬇ Laden</button></div>
      <div class="mk-apps-item"><span class="mk-ico mk-ico-star"></span>
        <div><b>Starscape</b><span>Galerie-Bilder als wechselndes Wallpaper</span><small>Windows 10/11 · v0.9.4 · 14 MB</small></div>
        <button class="mock-btn">⬇ Laden</button></div>
    </div>
  </div>`;

// the docked subheader of every subpage: logo · plate (VERSE · ◂ Verse, path on hover) · search · apps · account
const CTX = {
  verse: { chip: 'Verse', ph: 'Suche in Schiffen, Patches, News …' },
  gallery: { chip: 'Galerie', ph: 'Galerie oder Codex durchsuchen …' },
};
const subBar = (here, ctx = 'verse') => `
  <div class="mk3-sub">
    <a class="mk3-blogo" data-screen-link="${S.hub}" aria-label="Zum Verse"><span class="mk3-mark"></span></a>
    <div class="mk3-plate"><span class="mk3-cat">Verse</span><a class="mk3-back" data-screen-link="${S.hub}"><i>◂</i>Verse</a>
      <div class="mk3-path"><a data-screen-link="${S.hub}">Verse</a><span>›</span><b>${here}</b></div></div>
    <span class="mk3-div"></span>
    <div class="mk3-field">${glyph}<span class="mk3-ctx">${CTX[ctx].chip}<i>×</i></span><span class="mk3-phd">${CTX[ctx].ph}</span>${keys}</div>
    <div class="mk3-acc"><a class="mk-apps-btn">⬇ Apps ▾</a><span class="mk-avatar">JT</span></div>
  </div>`;

// the shared frame head: emblem · slim line (the page's one h1, small) · aside without boxes
const frameHead = (pl, h1, sub, aside) => `
    <header class="mk3-fh">
      <span class="mk3-emb mock-pl ${pl}"></span>
      <div class="mk3-fh-t"><h1>${h1}</h1><p>${sub}</p></div>
      <div class="mk3-aside">${aside}</div>
    </header>`;

const page = (tint, here, body, { ctx = 'verse', extra = '' } = {}) => `
  <div class="mock-app mk-deep mk-long ${tint}">
    <div class="mock-stars"></div>
    ${subBar(here, ctx)}
    <div class="mock-frame">${body}</div>${extra}
  </div>`;

const constellation = (w, h, x, y) => `
  <svg class="mock-const" viewBox="0 0 100 100" style="width:${w}px;height:${h}px;left:${x};top:${y}">
    <line x1="30" y1="8" x2="70" y2="70"/><line x1="70" y1="70" x2="44" y2="88"/>
    <circle cx="30" cy="8" r="3"/><circle cx="70" cy="70" r="3"/><circle cx="44" cy="88" r="2"/>
    <circle class="mock-dark" cx="12" cy="66" r="2.4"/><circle class="mock-dark" cx="24" cy="84" r="2.4"/>
  </svg>`;

// ───────────────────────── Hub ─────────────────────────
const hub = ({ appsOpen = false } = {}) => `
  <div class="mock-app">
    <div class="mock-stars"></div>
    ${mainHeader(appsOpen)}
    <div class="mk3-stage"><div class="mk3-field">${glyph}<span class="mk3-phd">Suche in Schiffen, Patches, News …</span>${keys}</div></div>
    <div class="mock-sun" style="right:9%;top:24%"></div>
    ${constellation(80, 100, '80%', '42%')}
    <a class="mock-hub-link" data-screen-link="${S.trans}"><div class="mock-pl mock-pl-news" style="left:4%;top:61%;width:118px;height:118px"></div><span class="mock-pl-label mock-disp" style="left:calc(4% + 59px);top:calc(61% + 128px)">News</span></a>
    <a class="mock-hub-link" data-screen-link="${S.pat}"><div class="mock-pl mock-pl-patch" style="left:15%;top:55%;width:86px;height:86px"></div><span class="mock-pl-label mock-disp" style="left:calc(15% + 43px);top:calc(55% + 96px)">Patches</span></a>
    <a class="mock-hub-link" data-screen-link="${S.gal}"><div class="mock-pl mock-pl-gal" style="left:81%;top:52%;width:116px;height:116px"></div><span class="mock-pl-label mock-disp" style="left:calc(81% + 58px);top:calc(52% + 126px)">Galerie</span></a>
    <a class="mock-hub-link" data-screen-link="${S.map}"><span class="mock-pl-label mock-disp" style="left:84%;top:calc(42% + 108px)">Sternkarte</span></a>
    <div class="mock-hero"><div class="mock-k mock-disp">Patches</div><div class="mock-big">4.10</div></div>
    <div class="mock-horizon"></div>
    <div class="mock-holo"><div class="mock-k mock-disp">News</div><h3>First Time Running Storm Breaker</h3></div>
    ${appsOpen ? appsMenu() : ''}
  </div>`;

// ───────────────────────── News ─────────────────────────
const newsBody = () => `
    ${frameHead('mock-pl-news', 'News', 'Comm-Links, Videos und Spectrum – das Neueste aus dem Verse.',
      '<span class="mk3-ai mk3-st"><i class="mk3-dot"></i>aktualisiert gerade eben</span><a class="mk3-ai">↻ Neu laden</a>')}
    <article class="mk3-hero">
      <a class="mk3-hero-img"><span class="mk3-play"></span></a>
      <div class="mk3-hero-b"><small class="mock-disp">YouTube · vor 2 Tagen</small><strong>First Time Running Storm Breaker</strong>
        <span>Raise your hand if you've ever felt personally victimized by the valakkar.</span>
        <span class="mk3-acts"><button class="mock-btn">Ansehen →</button><button class="mock-btn mock-ghost">☆ Merken</button></span></div>
    </article>
    <div class="mk3-filt">
      <a class="mk3-chip mk3-on">Alle</a>
      <a class="mk3-chip"><i style="background:#52c1e6"></i>Comm-Link</a>
      <a class="mk3-chip"><i style="background:#cfe3f1"></i>YouTube</a>
      <a class="mk3-chip"><i style="background:#9fb3c8"></i>Spectrum</a>
      <a class="mk3-chip"><i style="background:#e0ae70"></i>Patch-Notes</a>
      <span class="mk3-push"></span>
      <a class="mk3-chip">☆ Gemerkt (0)</a><span class="mk3-cnt">48 Beiträge</span>
    </div>
    <div class="mock-grid">
      <div class="mock-glass mock-tile"><div class="mock-img"><span class="mock-src">SPECTRUM</span></div><p>Updates to Pledge Gifting – FAQ</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v2"><span class="mock-src">YOUTUBE</span></div><p>Your Favourite Spot in the ’Verse</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v3"><span class="mock-src">YOUTUBE</span></div><p>Jump Points in Star Citizen</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v4"><span class="mock-src">COMM-LINK</span></div><p>10 From the Community</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v3"><span class="mock-src">COMM-LINK</span></div><p>This Week in Star Citizen</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img"><span class="mock-src">PATCH-NOTES</span></div><p>Alpha 4.11 PTU Patch Notes (Wave 2)</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v4"><span class="mock-src">YOUTUBE</span></div><p>Inside Star Citizen: Valakkar</p></div>
      <div class="mock-glass mock-tile"><div class="mock-img mock-v2"><span class="mock-src">COMM-LINK</span></div><p>Monthly Report: Oktober</p></div>
    </div>`;

// ───────────────────────── Patches ─────────────────────────
const meter = (pct) => {
  const f = pct == null ? 0 : Math.round(pct / 20);
  return `<span class="mk3-meter${pct != null && pct < 70 ? ' mk3-w' : ''}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= f ? 'mk3-f' : ''}"></i>`).join('')}</span>`;
};
const stb = (pct, word) => `<div class="mk3-stb${pct != null && pct < 70 ? ' mk3-w' : ''}">${meter(pct)}<b>${pct == null ? '—' : `${pct} %`}</b><small>${word}</small></div>`;
const TAG = { live: ['mk3-tag-live', 'Live'], ptu: ['mk3-tag-ptu', 'PTU'], evo: ['mk3-tag-evo', 'Evocati'] };
const sv = (label, title, stage, hf, pct, time) => `
          <a class="mk3-sv"><span class="mk3-sl">${label}</span><span class="mk3-svt">${title}</span><span class="mk3-tag ${TAG[stage][0]}">${TAG[stage][1]}</span>${hf ? '<span class="mk3-tag mk3-tag-hf">Hotfix</span>' : '<span></span>'}<span class="mk3-svs${pct != null && pct < 70 ? ' mk3-w' : ''}">${pct == null ? '<em>noch früh</em>' : `${meter(pct)}${pct} %`}</span><span class="mk-dim">${time}</span><span class="mk-ext">↗</span></a>`;
const thumbs = (names, rest) => `<span class="mk3-tz">${names.map((n, i) => `<a class="mk3-th mk3-t${i % 4}"><span>${n}</span></a>`).join('')}${rest ? '<a class="mk3-th mk3-rest">…</a>' : ''}</span>`;
const histBars = [8, 14, 22, 35, 52, 70, 88, 64, 47, 30, 22, 12, 7, 4];
const hist = (tipped) => `<div class="mk3-hw">${tipped ? `<span class="mk3-you" style="left:${((8.5 / 14) * 100).toFixed(1)}%">dein Tipp</span>` : ''}<div class="mk-hist">${histBars.map((v, i) => `<i class="${i === 6 ? 'mk-med' : tipped && i === 8 ? 'mk-you' : ''}" style="height:${v}%"></i>`).join('')}</div></div>
              <div class="mk-hist-l"><span>31. Okt</span><span>6. Nov</span><span>13. Nov</span></div>
              <div class="mk-legend"><span><i style="background:#52c1e6"></i>Median 6. Nov</span>${tipped ? '<span><i style="background:rgba(255,255,255,.85)"></i>dein Tipp 8. Nov</span>' : ''}<span>214 Tipps</span></div>`;

const patchBody = (tipped) => `
    ${frameHead('mock-pl-patch', 'Patches', 'Was live ist, was kommt – und ob du bereit bist.',
      `<span class="mk3-ai mk3-st"><i class="mk3-dot"></i>Datenstand vor 12 Min.</span><span class="mk3-ai mk3-sf"><span class="mk3-field">${glyph}<span class="mk3-phd">z. B. Orison, Hotfix, Quantum Drive</span></span></span>`)}
    <div class="mk3-tl-h"><span>Stabilität</span><span>Patches · neueste zuerst</span></div>
    <div class="mk3-tl">
      <div class="mk3-nd mk3-n-next">
        ${stb(null, 'noch nicht live')}
        <div class="mk3-card mk3-next">
          <div class="mk3-ch">
            <span class="mk3-sw mk3-sw-next">Nächster<small>PTU · Welle 2</small></span>
            <span class="mk3-v">Alpha 4.11<small>2 Wellen seit Evocati</small></span>
            <span class="mk3-sent"><b>Im PTU seit 9 Tagen – live voraussichtlich um den 6. Nov.</b>${thumbs(['Pyro-Stationen', 'Hull C', 'Frachtdeck', 'Ruf-System'], true)}</span>
          </div>
          <div class="mk3-mon">
            <p>4.11 ist seit <b>9 Tagen</b> im Test, üblich sind <b>23</b>. Hauptpatches liegen im Median <b>97 Tage</b> auseinander, Hotfixes <b>9 Tage</b>; zuletzt stabil gelandet ist <b>4.10</b>.</p>
            <div class="mk3-takt"><i style="left:39%"></i><em style="left:39%">Tag 9 · im Takt</em></div>
            <div class="mk3-takt-l mock-disp"><span>im Takt</span><span>üblich</span><span>überfällig</span></div>
          </div>
          <div class="mk3-ng">
            <div><div class="mk3-ngh"><h3>Bereit für 4.11</h3><span>2 von 4</span></div>
              <div class="mk-steps"><span class="mk-step mk-done">Patch Notes gelesen</span><span class="mk-step mk-done">Keybinds geprüft</span><span class="mk-step">Loadout gesichert</span><span class="mk-step">Shader-Cache geleert</span></div></div>
            <div><div class="mk3-ngh"><h3>Kometen-Tipp</h3>${tipped
              ? '<span class="mk3-mine">dein Tipp: 8. Nov</span><span>· 214 Tipps</span>'
              : `<span>So tippt die Community</span><a class="mk3-tip" data-screen-link="${S.map}">Tipp abgeben →</a>`}</div>
              ${hist(tipped)}</div>
          </div>
          <div class="mk3-subs"><div class="mk3-subs-h">Versionen von 4.11</div>
            ${sv('4.11.0', 'PTU Patch Notes · Welle 2', 'ptu', false, null, 'vor 2 Std.')}
            ${sv('4.11.0', 'Evocati Patch Notes', 'evo', false, null, 'vor 9 Tagen')}
          </div>
        </div>
      </div>
      <div class="mk3-gap">Testphase von 4.10 dauerte <b>23 Tage</b> · <span class="mk3-ok">im Takt</span></div>
      <div class="mk3-nd mk3-n-live">
        ${stb(72, 'Leichte Turbulenzen')}
        <div class="mk3-card mk3-live">
          <div class="mk3-ch">
            <span class="mk3-sw mk3-sw-live">Live<small>seit 11 Tagen</small></span>
            <span class="mk3-v">Alpha 4.10<small>Storm Breaker</small></span>
            <span class="mk3-sent"><b>Seit 17. Okt live · 1 Hotfix am 25. Okt</b><span>Das kam mit 4.10:</span>${thumbs(['Storm Breaker', 'Valakkar', 'Inventar 2.0', 'Aufzüge'], true)}</span>
          </div>
          <div class="mk3-subs"><div class="mk3-subs-h">Versionen von 4.10</div>
            ${sv('4.10.1', 'Hotfix – Inventar &amp; Aufzüge', 'live', true, 81, 'vor 3 Tagen')}
            ${sv('4.10.0', 'Live Patch Notes', 'live', false, 72, 'vor 11 Tagen')}
            ${sv('4.10.0', 'PTU Patch Notes · Welle 3', 'ptu', false, 64, 'vor 21 Tagen')}
            <a class="mk3-more">+ Welle 1–2 und Evocati ▾</a>
          </div>
        </div>
      </div>
      <div class="mk3-gap"><b>97 Tage</b> zwischen 4.9 und 4.10 · Median <b>97 Tage</b></div>
      <div class="mk3-nd">
        ${stb(78, 'Endstand')}
        <div class="mk3-card mk3-old">
          <div class="mk3-ch">
            <span class="mk3-sw mk3-sw-old">Abgelöst<small>am 17. Okt</small></span>
            <span class="mk3-v">Alpha 4.9<small>zuletzt stabil gelandet</small></span>
            <span class="mk3-sent"><b>Live 12. Jul – 17. Okt · 2 Hotfixes</b><a class="mk3-more" style="margin-left:0">4 Versionen ▸</a></span>
          </div>
        </div>
      </div>
      <div class="mk3-gap"><b>104 Tage</b> zwischen 4.8 und 4.9 · <span class="mk3-warn">länger als üblich</span></div>
      <div class="mk3-nd">
        ${stb(61, 'Endstand')}
        <div class="mk3-card mk3-old">
          <div class="mk3-ch">
            <span class="mk3-sw mk3-sw-old">Abgelöst<small>am 12. Jul</small></span>
            <span class="mk3-v">Alpha 4.8</span>
            <span class="mk3-sent"><b>Live 31. Mär – 12. Jul · 3 Hotfixes</b><a class="mk3-more" style="margin-left:0">5 Versionen ▸</a></span>
          </div>
        </div>
      </div>
      <div class="mk-older" style="margin-top:14px">Ältere Patches · 4.7 bis 3.0 (34) ▾</div>
    </div>`;

// ───────────────────────── Galerie ─────────────────────────
const STAR = {
  text: 'Wechselt dein Windows-Wallpaper automatisch durch diese Galerie – auch deine vollendeten Sternkarten.',
  list: ['Neue Bilder kommen von selbst', 'Wechsel-Takt frei wählbar', 'Läuft leise im Hintergrund'],
  meta: 'Windows 10/11 · v0.9.4 · 14 MB',
};
const toastLine = (open) => `<span class="mk-ico mk-ico-star"></span>
      <a class="mk3-tb" data-screen-link="${open ? S.gal : S.galT}"><small>Starscape · Desktop-App</small><b>Diese Galerie als Wallpaper</b><span>Für Windows, kostenlos</span></a>
      <span class="mk3-tx"><a class="mk3-x" data-screen-link="${open ? S.gal : S.galT}" aria-label="${open ? 'Zuklappen' : 'Aufklappen'}">${open ? '▾' : '▴'}</a><a class="mk3-x" aria-label="Schließen">×</a></span>`;
const toast = (open) => open
  ? `
    <div class="mk3-toast mk3-open" role="status">
      <div class="mk-tc-body">
        <div class="mk-tc-prev mk-tc-prev-star"></div>
        <p>${STAR.text}</p>
        <ul class="mk-tc-list">${STAR.list.map((l) => `<li>${l}</li>`).join('')}</ul>
        <div class="mk-tc-meta">${STAR.meta}</div>
        <div class="mk-tc-act"><button class="mock-btn">⬇ Download</button><a class="mk-link2" style="margin:0">Versionshinweise</a></div>
      </div>
      <div class="mk3-tline">${toastLine(true)}</div>
    </div>
    <span class="mk3-lane" aria-hidden="true">Feedback</span>`
  : `
    <div class="mk3-toast" role="status">
      ${toastLine(false)}
      <i class="mk3-drain"></i>
    </div>
    <span class="mk3-lane" aria-hidden="true">Feedback</span>`;

const galBody = () => `
    ${frameHead('mock-pl-gal', 'Galerie', 'Wallpaper aus dem Verse – und deine vollendeten Sternkarten.',
      `<span class="mk3-ai mk3-st">128 Bilder</span><a class="mk3-ai" data-screen-link="${S.map}">✦ Meine Sternkarten</a>`)}
    <section>
      <div class="mk-sh"><h2>Wallpaper</h2><span>neueste zuerst</span></div>
      <div class="mock-grid" style="--mock-c:5">
        ${['', 'mock-v2', 'mock-v3', 'mock-v4', '', 'mock-v3', 'mock-v4', 'mock-v2', '', 'mock-v3', 'mock-v2', '', 'mock-v4', 'mock-v3', ''].map((v) => `<div class="mock-glass mock-tile"><div class="mock-img ${v}" style="height:96px"></div></div>`).join('')}
      </div>
    </section>`;

// ───────────────────────── Sternkarte ─────────────────────────
const spark = (x, y, r) => `<path class="mk3-mo" d="M${x} ${y - r} L${(x + r * 0.22).toFixed(2)} ${(y - r * 0.22).toFixed(2)} L${x + r} ${y} L${(x + r * 0.22).toFixed(2)} ${(y + r * 0.22).toFixed(2)} L${x} ${y + r} L${(x - r * 0.22).toFixed(2)} ${(y + r * 0.22).toFixed(2)} L${x - r} ${y} L${(x - r * 0.22).toFixed(2)} ${(y - r * 0.22).toFixed(2)}Z"/>`;
const MOTIF = {
  1: spark(20, 22, 8),
  2: spark(14, 19, 5.5) + spark(26, 27, 5.5),
  3: '<path class="mk3-ln" d="M12 29 L20 14 L28 29"/>' + spark(12, 29, 3.6) + spark(20, 14, 4.2) + spark(28, 29, 3.6),
  4: '<circle class="mk3-ln" cx="20" cy="22" r="9.5"/>' + spark(20, 22, 11),
  5: '<path class="mk3-mo" d="M22 12.5 a9.5 9.5 0 1 0 0 19 a7.2 7.2 0 1 1 0 -19Z"/>' + spark(28, 16, 3.4),
  6: '<circle class="mk3-mo" cx="20" cy="22" r="6"/><ellipse class="mk3-ln" cx="20" cy="22" rx="13" ry="3.8" transform="rotate(-16 20 22)"/>',
  7: spark(10, 25, 3) + spark(15, 18, 3.2) + spark(20, 13, 4) + spark(25, 18, 3.2) + spark(30, 25, 3) + '<path class="mk3-ln" d="M10 31 H30"/>',
};
const crest = (n, w = 40) => `<svg class="mk3-crest" viewBox="0 0 40 46" width="${w}" height="${Math.round(w * 1.15)}" aria-hidden="true"><path class="mk3-cs" d="M20 2 L37 8 V22 C37 33 29 41 20 44 C11 41 3 33 3 22 V8 Z"/>${MOTIF[n]}</svg>`;

const litStar = (x, y) => `<g transform="translate(${x} ${y})"><circle r="19" fill="rgba(143,227,255,.09)"/><circle r="10" fill="rgba(143,227,255,.22)"/><path d="M0 -14 L2.6 -2.6 L14 0 L2.6 2.6 L0 14 L-2.6 2.6 L-14 0 L-2.6 -2.6Z" fill="#fff"/><circle r="3.2" fill="#fff"/></g>`;
const darkStar = (x, y, next = false) => `<g transform="translate(${x} ${y})">${next ? '<circle class="mk3-pulse" r="15" fill="none" stroke="#52c1e6" stroke-width="1.5"/>' : ''}<circle r="9" fill="rgba(6,20,32,.6)" stroke="${next ? '#52c1e6' : '#9fb3c8'}" stroke-width="1.4" stroke-dasharray="3 3"/><circle r="2" fill="${next ? '#52c1e6' : '#9fb3c8'}"/></g>`;
const mapSvg = () => {
  const lit = [[300, 110], [390, 70], [470, 130], [580, 100], [440, 230], [640, 170], [540, 262]];
  const lines = [[0, 1], [1, 2], [2, 3], [2, 4], [4, 6], [3, 5]];
  const dark = [[700, 228], [240, 190], [350, 280], [520, 40]];
  return `
        <svg viewBox="0 0 900 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g stroke="#cfe8ff" stroke-width="1.6" opacity=".85">${lines.map(([a, b]) => `<line x1="${lit[a][0]}" y1="${lit[a][1]}" x2="${lit[b][0]}" y2="${lit[b][1]}"/>`).join('')}</g>
          ${lit.map(([x, y]) => litStar(x, y)).join('')}
          ${darkStar(630, 290, true)}
          ${dark.map(([x, y]) => darkStar(x, y)).join('')}
        </svg>`;
};

const curve = (n, k, h, rev) => {
  const pts = [];
  for (let j = 0; j < n; j++) {
    const i = rev ? n - 1 - j : j;
    pts.push(`${(((j + 0.5) / n) * 100).toFixed(2)} ${(i * i * k + h + 8).toFixed(1)}`);
  }
  const H = Math.ceil((n - 1) * (n - 1) * k + h + 12);
  return { d: `M${pts.join(' L')}`, H };
};
const DAYS = [['Do', 29], ['Fr', 30], ['Sa', 31], ['So', 1], ['Mo', 2], ['Di', 3], ['Mi', 4], ['Do', 5], ['Fr', 6], ['Sa', 7], ['So', 8], ['Mo', 9]];
const cometTrack = () => {
  const k = 0.32;
  const c = curve(14, k, 44, false);
  return `
      <div class="mk3-trk">
        <div class="mk3-trk-h"><span class="mk3-kind"><span class="mk3-comet"></span>Komet</span><b>Tipps für 4.11 offen</b><span class="mk3-info">i</span><span class="mk3-state"><i class="mk3-ring"></i>offen</span></div>
        <div class="mk3-rail" style="--k:${k}px;padding-bottom:${c.H - 40}px">
          <a class="mk3-tok mk3-nav" style="--i:0">‹</a>
          ${DAYS.map(([wd, d], i) => `<a class="mk3-tok" style="--i:${i + 1}"${d === 8 ? ` data-screen-link="${S.patT}"` : ""}><small>${wd}</small>${d}</a>`).join('')}
          <a class="mk3-tok mk3-nav" style="--i:13">›</a>
          <svg class="mk3-curve" viewBox="0 0 100 ${c.H}" preserveAspectRatio="none" style="height:${c.H}px" aria-hidden="true"><path d="${c.d}" vector-effect="non-scaling-stroke"/></svg>
        </div>
      </div>`;
};
const SHIPS = ['Polaris', 'Idris-P', 'Carrack', 'Zeus Mk II', 'Perseus', 'Hermes', 'Starlancer'];
const shipSvg = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3L18.5 12L28 20L28 23L19 21L18 27L14 27L13 21L4 23L4 20L13.5 12Z"/></svg>';
const guessTrack = () => {
  const k = 1.05;
  const c = curve(7, k, 56, true);
  return `
      <div class="mk3-trk">
        <div class="mk3-trk-h"><span class="mk3-kind"><svg class="mk3-scope" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 13.6L16.4 7.4l1.7 3.5L4.9 17.1z"/><path d="M16.4 7.4l3-1.4 1.7 3.5-3 1.4"/><path d="M11.5 14.1L8 21.5M11.5 14.1L15 21.5M11.5 14.1v7.4"/></svg>Erkennen</span><b>Tippe auf das Schiff, das du in der Sternkarte erkennst</b><span class="mk3-info">i</span><span class="mk3-state"><i class="mk3-ring"></i>offen</span></div>
        <div class="mk3-rail" style="--k:${k}px;padding-bottom:${c.H - 48}px">
          ${SHIPS.map((s, i) => `<a class="mk3-tok mk3-ship" style="--i:${SHIPS.length - 1 - i}">${shipSvg}<small>${s}</small></a>`).join('')}
          <svg class="mk3-curve" viewBox="0 0 100 ${c.H}" preserveAspectRatio="none" style="height:${c.H}px" aria-hidden="true"><path d="${c.d}" vector-effect="non-scaling-stroke"/></svg>
        </div>
        <div class="mk3-trk-f">Richtig erkannt, erscheint der Name in der Sternkarte und der Kreis bekommt ein Häkchen.</div>
      </div>`;
};

const ladder = () => {
  const cur = 4;
  const items = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    if (n < cur) return `<li class="mk3-rk mk3-past">${crest(n, 34)}<em>Rang ${n}</em></li>`;
    if (n === cur) return `<li class="mk3-rk mk3-cur"><a>${crest(n, 52)}<em>Rang ${n}</em><small>Abzeichen ansehen →</small></a></li>`;
    return `<li class="mk3-rk mk3-lock">${crest(n, 34)}<em>Rang ${n}</em><small>gesperrt</small></li>`;
  });
  return `
    <div class="mk3-karto">
      <div class="mk3-karto-l"><span class="mk3-kind">Kartograph</span><b>Rang 4</b><small>Noch 2 vollendete Sternkarten bis Rang 5.</small></div>
      <ol class="mk3-ladder">${items.join('')}</ol>
    </div>`;
};

const miniMap = (lit) => `<svg viewBox="0 0 100 50"><g stroke="#cfe8ff" stroke-width="1" opacity="${lit ? '.9' : '.35'}"><line x1="20" y1="18" x2="40" y2="10"/><line x1="40" y1="10" x2="55" y2="26"/><line x1="55" y1="26" x2="78" y2="20"/><line x1="55" y1="26" x2="48" y2="42"/></g><g fill="${lit ? '#fff' : '#5d7286'}"><circle cx="20" cy="18" r="2"/><circle cx="40" cy="10" r="2.4"/><circle cx="55" cy="26" r="2.4"/><circle cx="78" cy="20" r="2"/><circle cx="48" cy="42" r="2"/></g></svg>`;

const patchSelect = () => `
        <details class="mk3-sel">
          <summary><em>Patch</em><span class="mk3-tag mk3-tag-live">Live</span>4.10<i>▾</i></summary>
          <ul>
            <li><b>4.11</b><span class="mk3-tag mk3-tag-ptu">PTU</span><small>noch dunkel</small></li>
            <li class="mk3-on"><b>4.10</b><span class="mk3-tag mk3-tag-live">Live</span><small>7 / 12 Sterne</small></li>
            <li><b>4.9</b><small>vollendet</small></li>
            <li><b>4.8</b><small>vollendet</small></li>
            <li><b>4.7</b><small>vollendet</small></li>
          </ul>
        </details>`;

const mapBody = () => `
    ${frameHead('mock-pl-map', 'Sternkarte 4.10', 'Jede Patch-Aufgabe entzündet einen Stern – vollende die Sternkarte.',
      `${patchSelect()}<a class="mk3-ai">⬇ Wallpaper exportieren</a><a class="mk3-ai">Meine Sternkarten</a><a class="mk3-ai">Logbuch</a><a class="mk3-ai mk3-q" aria-label="Tour"><span>?</span></a>`)}
    <div class="mk3-map">
      <span class="mk3-sun"></span>
      ${mapSvg()}
      <div class="mk3-cap">
        <span class="mk3-k">Form</span><b>Speerspitze</b>
        <span><span class="mk3-n">7</span> / 12 Sterne</span>
        <a class="mk3-capr">${crest(4, 16)}Kartograph · Rang 4</a>
      </div>
    </div>
    <div class="mk3-tracks">${cometTrack()}${guessTrack()}</div>
    ${ladder()}
    <section class="mock-sec" style="margin-top:22px">
      <div class="mk-sh"><h2>Serie</h2><span>5 Sternkarten in Folge entzündet</span></div>
      <div class="mk-series">${['4.5', '4.6', '4.7', '4.8', '4.9'].map((p) => `<a class="mk-ser">${miniMap(true)}${p} · vollendet</a>`).join('')}<a class="mk-ser mk-on">${miniMap(false)}4.10 · 7 / 12</a></div>
    </section>`;

// ───────────────────────── Übergang ─────────────────────────
const miniHub = (style = '') => `<div class="mk-mini-hub"${style ? ` style="${style}"` : ''}>
          <div class="mk3-mini-mh"><i></i><b></b><b></b><b></b></div>
          <div class="mk3-mini-st"></div>
          <div class="mk-mini-hero">4.10</div>
          <div class="mk-mini-pl mock-pl-patch" style="left:20%;top:54%;width:9%"></div>
          <div class="mk-mini-pl mock-pl-gal" style="left:80%;top:50%;width:12%"></div>
          <div class="mk-mini-hor"></div></div>`;
const miniPage = (style = '', cls = 'mk-mini-page', slot = '') => `<div class="${cls}"${style ? ` style="${style}"` : ''}>
          <div class="mk-mini-ph"><span class="mk-mini-slot ${slot}"></span><span class="mk-mini-lines"><i></i><i></i><i></i></span></div>
          <div class="mk-mini-blocks"><i></i><i></i><i></i></div></div>`;
const frame = (n, title, cap, f) => `
        <figure class="mk-fr">
          <div class="mk-mini mk3-mini mk-t-news">
            <div class="mk-mini-stars" style="transform:translateY(${f.stars}%)"></div>
            <div class="mk-mini-tint" style="opacity:${f.tint}"></div>
            ${miniHub(`transform:translateY(${f.hub}%)`)}
            ${miniPage(`transform:translateY(${f.page}%)`)}
            <div class="mk3-mini-bar" style="opacity:${f.bar};transform:translateY(${f.barY}%) scaleX(${f.barS})"></div>
            <div class="mk-mini-fly mock-pl-news${n === 1 ? ' mk-mini-ring' : ''}" style="left:${f.x}%;top:${f.y}%;width:${f.w}%"></div>
          </div>
          <figcaption><b>${title}</b>${cap}</figcaption>
        </figure>`;
const hubToNews = () => `
          <div class="mk-mini mk3-mini mk-t-news">
            <div class="mk-mini-stars"></div>
            <div class="mk-mini-tint"></div>
            ${miniHub()}
            ${miniPage()}
            <div class="mk3-mini-bar"></div>
            <div class="mk-mini-fly mock-pl-news"></div>
          </div>`;

const transBody = () => `
    <section style="padding-top:26px">
      <div class="mk3-trans">
        <div class="mk-loop">
          <div class="mk-sh"><h2>Hub → News</h2><span>Klick auf den Planeten</span></div>
          ${hubToNews()}
          <div class="mk-cap">Der Hub rollt <b>nach oben weg wie beim Scrollen</b>, die Kopfzeile schrumpft in den Subheader, der Planet landet als Wappen in der Kopfzeile.</div>
        </div>
        <div class="mk-loop">
          <div class="mk-sh"><h2>Patches → Sternkarte</h2><span>„Tipp abgeben →“</span></div>
          <div class="mk-mini mk3-mini mk-t-patch">
            <div class="mk-mini-stars"></div>
            <div class="mk-mini-tint" style="animation:none"></div>
            ${miniPage('', 'mk-mini-page mk-pa', 'mock-pl-patch')}
            <div class="mk-mini-tint mk-tint-b" style="--mk-tint:rgba(29,78,110,.6)"></div>
            ${miniPage('', 'mk-mini-page mk-pb', 'mock-pl-map')}
            <div class="mk3-mini-bar mk3-keep"></div>
          </div>
          <div class="mk-cap">Ein Link im Inhalt nimmt dieselbe Bewegung; der Subheader bleibt stehen, nur sein Pfad wechselt zu „Verse › Sternkarte“.</div>
        </div>
        <div class="mk-loop mk3-rev">
          <div class="mk-sh"><h2>Zurück zum Hub</h2><span>Logo oder „◂ Verse“</span></div>
          ${hubToNews()}
          <div class="mk-cap">Logo oder <b>◂ Verse</b> im Subheader spielen den Flug rückwärts: Seite sinkt, das Wappen kehrt in seine Bahn zurück. Browser-Zurück ebenso. Unter „reduzierte Bewegung“ nur Überblenden.</div>
        </div>
      </div>
      <a class="mock-btn" style="margin-top:14px" data-screen-link="${S.news}">Weiter zur Seite →</a>
    </section>
    <section class="mock-sec" style="margin-top:30px">
      <div class="mk-sh"><h2>Einzelbilder</h2><span>Hub → News, ~0,8 s</span></div>
      <div class="mk-film">
        ${frame(1, '0 ms', 'Klick auf News, der Planet leuchtet auf.', { stars: 0, tint: 0, hub: 0, page: 100, bar: 0, barY: 70, barS: 0.55, x: 6, y: 58, w: 13 })}
        ${frame(2, '≈ 250 ms', 'Hub rollt nach oben, die Kopfzeile mit ihm.', { stars: -5, tint: 0.2, hub: -38, page: 62, bar: 0.15, barY: 55, barS: 0.65, x: 7, y: 38, w: 11.5 })}
        ${frame(3, '≈ 550 ms', 'Die Suche dockt als Subheader an, die Seite steigt auf.', { stars: -11, tint: 0.65, hub: -88, page: 20, bar: 0.85, barY: 12, barS: 0.92, x: 7.5, y: 26, w: 8.5 })}
        ${frame(4, '≈ 800 ms', 'Seite steht, Wappen sitzt in der Kopfzeile.', { stars: -16, tint: 1, hub: -120, page: 0, bar: 1, barY: 0, barS: 1, x: 8, y: 20, w: 6.5 })}
      </div>
    </section>`;

const transScreen = () => `
  <div class="mock-app mk-deep mk-long mk-t-news">
    <div class="mock-stars"></div>
    <div class="mock-frame">${transBody()}</div>
  </div>`;

// ───────────────────────── design ─────────────────────────
const p = (n) => `r3-${n}`;
function d1() {
  return `
<section data-design="d1" data-nav-label="Anflug" data-design-active="true" data-screen-fit="full"
  data-design-motto="Kamera zoomt auf den Planeten, Unterseite ersetzt den Hub."
  data-design-traits="Kopfzeile und Subheader genau wie in der App (#841)|Wappen und eine schmale Zeile statt Titelblock|Heutige Bausteine, nur ohne Kästen auf der Szene"
  data-design-icon="rocket" data-design-color="#c9845f" data-design-overlay="br"
  data-design-improved="Echter Subheader, heutige Bausteine">
${screen(S.hub, 'Hub', hub(), [
    anno(p('d1-s1-a1'), 1, 'left', '.mk3-mh .mk3-acc', '', 'Kein Teaser mehr, nur Apps oben rechts'),
  ], true)}
${screen(S.apps, 'Hub · Apps-Menü', hub({ appsOpen: true }))}
${screen(S.trans, 'Übergang', transScreen(), [
    anno(p('d1-s3-a1'), 1, 'bottom', '.mk3-rev .mk-mini', '', 'Zurück nur über Logo oder ◂ Verse'),
  ])}
${screen(S.news, 'News', page('mk-t-news', 'News', newsBody()), [
    anno(p('d1-s4-a1'), 1, 'left', '.mk3-hero', '', 'Bühne als erste Karte, ohne Abschnitt'),
    anno(p('d1-s4-a2'), 2, 'left', '.mk3-filt .mk3-push', 'Die Filter wirken nur auf den Feed; die Bühne zeigt immer die neueste Meldung. Oder soll die Bühne mitfiltern (bei „YouTube“ das neueste Video)?'),
  ])}
${screen(S.pat, 'Patches', page('mk-t-patch', 'Patches', patchBody(false)), [
    anno(p('d1-s5-a1'), 1, 'right', '.mk3-n-live .mk3-stb', '„Live“ ist jetzt ein gefülltes grünes Wort, die Stabilität ein eisblauer Balkenmesser (schwach: Bernstein). Liest sich das klar getrennt?', 'Stufe und Stabilität getrennt'),
    anno(p('d1-s5-a2'), 2, 'left', '.mk3-n-live .mk3-subs', 'Unterversionen hängen eingerückt an einer Schiene unter ihrer Hauptversion; ältere PTU-Wellen starten eingeklappt. Sollen auch Hotfixes einklappen, sobald es mehr als zwei sind?', 'Unterversionen sichtbar verschachtelt'),
    anno(p('d1-s5-a3'), 3, 'left', '.mk3-tip', '', 'Tipp abgeben nur ohne eigenen Tipp'),
  ])}
${screen(S.patT, 'Patches · getippt', page('mk-t-patch', 'Patches', patchBody(true)))}
${screen(S.gal, 'Galerie', page('mk-t-gal', 'Galerie', galBody(), { ctx: 'gallery', extra: toast(false) }), [
    anno(p('d1-s7-a1'), 1, 'left', '.mk3-toast', 'Die Meldung kommt einmal pro Gerät beim ersten Galerie-Besuch und klappt nach 8 s zu ihrer Zeile zurück. Nach × nie wieder, oder erneut bei einer neuen Starscape-Version? Dasselbe Muster ginge für die SCC App (z. B. auf Patches).', 'Teaser als Meldung unten rechts'),
  ])}
${screen(S.galT, 'Galerie · Meldung offen', page('mk-t-gal', 'Galerie', galBody(), { ctx: 'gallery', extra: toast(true) }))}
${screen(S.map, 'Sternkarte', page('mk-t-map', 'Sternkarte', mapBody()), [
    anno(p('d1-s9-a1'), 1, 'right', '.mk3-map svg', '', 'Kartensterne groß, mit Strahlen-Glyphe', '62%;--anno-y:30%'),
    anno(p('d1-s9-a2'), 2, 'left', '.mk3-sel summary', '', 'Nur der Live-Patch, Rest im Menü'),
    anno(p('d1-s9-a3'), 3, 'top', '.mk3-ladder .mk3-cur', 'Jeder Rang hat sein Wappen: drei vergangene, dein aktuelles (führt zur Abzeichen-Seite), drei gesperrte. Sollen gesperrte Wappen ihr Motiv schon gedimmt zeigen (wie hier) oder nur einen Umriss mit Schloss?', 'Wappenleiste statt Chip'),
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
<section data-view="r3-v1-seitenname" data-view-kind="decision" data-nav-label="Seitenname" hidden>
  <div class="view-frame">
    <h2>Wo steht der Name der Unterseite, wenn der Titelblock weg ist?</h2>
    <p><strong>Steht fest:</strong> Kein großer Titelblock mehr. Der Rahmen bleibt: Wappen links, Aktions-Slot rechts, fester Abstand zum Inhalt. Jede Seite behält genau ein <code>h1</code> (Screenreader, Suchmaschinen). Heute zeigt die Plakette im Subheader auf jeder Verse-Unterseite „VERSE“ und darunter „◂ Verse“; „Verse › News“ erscheint erst beim Darüberfahren.</p>
    <p>Die beiden Wege schließen sich aus.</p>
${evalBlock('r3-v1-zeile', 'Kleiner Seitenname in der Kopfzeile', 'Kleiner Seitenname in der Kopfzeile (wie im Design)', '<p>Neben dem Wappen steht der Seitenname klein in Versalien, das ist das <code>h1</code>; dahinter der Untertitel. Der Subheader bleibt genau wie in #841. <em>Empfehlung:</em> kein Eingriff in den Subheader, der Name ist trotzdem ohne Darüberfahren zu sehen.</p>', true)}
${evalBlock('r3-v1-plakette', 'Seitenname in der Plakette', 'Seitenname in der Plakette des Subheaders', '<p>Auf Unterseiten zeigt die Plakette den Seitennamen statt des Bereichs: „NEWS“, darunter „◂ Verse“. Die Kopfzeile trägt nur Wappen, Untertitel und Aktionen; das <code>h1</code> steht unsichtbar für Screenreader im Seitenkopf. Braucht eine kleine Änderung an der Plakette (heute immer der Bereich).</p>', false)}
  </div>
</section>

<section data-view="r3-v2-wappen-ort" data-view-kind="decision" data-nav-label="Wappen-Ort" hidden>
  <div class="view-frame">
    <h2>Wo sitzt die Kartograph-Wappenleiste auf der Sternkarte?</h2>
    <p><strong>Steht fest:</strong> Jeder Rang hat ein eigenes Wappen. Man sieht den eigenen Rang, die drei davor und die drei danach (gesperrte gedimmt), das aktuelle Wappen führt zur Abzeichen-Seite <code>/badge/kartograph</code>. Offen ist nur der Ort. Die drei Orte schließen sich aus.</p>
${evalBlock('r3-v2-band', 'Band zwischen Spuren und Serie', 'Eigenes Band zwischen den Spuren und der Serie (wie im Design)', '<p>Die volle Leiste mit Namen und Status steht als eigene Zeile über der Serie, sichtbar ohne Klick. Kostet rund 110 px Höhe unter der Karte. <em>Empfehlung.</em></p>', true)}
${evalBlock('r3-v2-kopf', 'Kompakt im Kopf rechts', 'Kompakt im Aktions-Slot rechts im Kopf', '<p>Im Kopf nur dein aktuelles Wappen, links und rechts je drei kleine Punkte für vergangene und kommende Ränge. Ein Klick klappt die volle Leiste als Menü auf. Spart Höhe, macht den Kopf aber voller (Patch-Auswahl und vier Aktionen stehen schon dort).</p>', false)}
${evalBlock('r3-v2-ecke', 'In der Kartenecke', 'In der Kartenecke bei Form und Sternen', '<p>Die Zeile „Kartograph · Rang 4“ in der Kartenecke klappt per Klick die Leiste über der Karte auf. Rang, Form und Sterne stehen an einem Ort; die Leiste selbst sieht man aber erst nach dem Klick.</p>', false)}
  </div>
</section>`;

const html = `<section data-iteration="3" data-iteration-template="design">
${css}
  <header class="iteration-intro">
    <h2>{{iteration.tab}} 3 · Anflug, nah an der App</h2>
    <p>Weniger erfunden, mehr von heute: die echten Kopfzeilen und Bausteine, nur auf die Szene gestellt. Was sich seit Runde 2 geändert hat:</p>
    <ul>
      <li>Kopfzeile und Subheader genau wie in #841: auf dem Hub die Kino-Kopfzeile mit der Suche auf der Bühne, auf jeder Unterseite die Satinkante (Logo, Plakette „VERSE · ◂ Verse“, Pfad beim Darüberfahren, Suche, Strg K). Zurück zum Hub nur über Logo oder „◂ Verse“, der Flug läuft rückwärts.</li>
      <li>Kein Titelblock mehr: Wappen, eine schmale Zeile mit dem kleinen Seitennamen (das eine <code>h1</code> der Seite) und ein ruhiger Aktions-Slot ohne Kästen, nur Text mit feinen Trennstrichen.</li>
      <li>Hub ohne Teaser, nur „Apps“ oben rechts. Starscape meldet sich in der Galerie unten rechts im Stil der Stern-Meldung, über der Feedback-Spur.</li>
      <li>News: die Bühne ist die erste große Karte (etwa ein Drittel der Höhe), Filter direkt über dem Feed.</li>
      <li>Patches: eine Seite, B als Basis, die Sätze aus A im nächsten Patch; die heutigen Patch-Kacheln mit Inhalts-Vorschau; Unterversionen eingerückt an einer Schiene; Live und Stabilität getrennt; „Tipp abgeben →“ nur ohne eigenen Tipp.</li>
      <li>Sternkarte: heutige Komet- und Erkennen-Spur, große Kartensterne, Patch-Auswahl als Menü, Form, Sterne und Rang in der Kartenecke, dazu die Kartograph-Wappenleiste.</li>
    </ul>
  </header>
${d1()}
${views}
</section>
`;
const final = html.replace(/mk3-/g, 'mk-r3-');
fs.writeFileSync(out, final.replace(/\r\n/g, '\n'));
console.log('written', final.length);
