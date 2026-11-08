// Generates rounds/02.html for the codex-kopf-besitz concept.
const fs = require('fs');
const out = process.argv[2];

const S = ':is([data-design], .design-ov-scale) ';
const css = `
§.vk{position:relative;height:100%;min-height:600px;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse 80% 60% at 50% 0%,#123247 0%,#0a1b28 55%,#06111a 100%);color:#c8e4f1;font:13px/1.4 "Segoe UI",system-ui,sans-serif;--a:#52c1e6;--mut:#7fa3b6;--hl:rgba(82,193,230,.22);--ink:#f2fafe;--dan:#f0646a;--warm:#e6b552}
§.vk :where(button,a){font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-decoration:none;box-shadow:none;min-width:0}
§.vk :where(h1,h3,p,ul,li){margin:0;padding:0;list-style:none}
§.vk svg{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
§.vk-top{display:flex;align-items:center;gap:18px;padding:14px max(24px,calc(50% - 620px)) 0;opacity:.55}
§.vk-brand{display:flex;flex-direction:column;font-size:11px;color:var(--mut);min-width:220px}
§.vk-brand b{color:var(--ink);letter-spacing:.2em;font-size:12px}
§.vk-search{flex:1;height:34px;border:1px solid var(--hl);border-radius:17px;display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;color:var(--mut);max-width:620px}
§.vk-search i{font-style:normal;background:rgba(82,193,230,.25);color:var(--ink);border-radius:12px;padding:2px 10px}
§.vk-page{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:22px max(164px,calc(50% - 620px)) 14px max(24px,calc(50% - 620px))}
§.vk-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
§.vk-tt{display:flex;flex-direction:column;gap:3px;min-width:0}
§.vk-tt small{font-size:12px;color:var(--mut)}
§.vk-tt h1{font-size:30px;line-height:1.1;letter-spacing:.14em;color:var(--ink);font-weight:600;text-transform:uppercase}
§.vk-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
§.vk-grow{flex:1}
§.vk-pill{height:30px;padding:0 13px;border:1px solid rgba(82,193,230,.5)!important;border-radius:15px;display:inline-flex;align-items:center;gap:7px;color:#cfe8f3;white-space:nowrap}
§.vk-pill:hover{border-color:var(--a)!important;color:var(--ink)}
§.vk-pill svg{width:15px;height:15px}
§.vk-step{display:inline-flex;align-items:center;gap:6px}
§.vk-step b{color:var(--ink);min-width:10px;text-align:center;font-size:15px}
§.vk-step span{width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid var(--hl);font-size:12px;line-height:1}
§.vk-ico{width:30px;height:30px;display:inline-grid;place-items:center;border-radius:8px;color:#a9cfe0}
§.vk-ico:hover{background:rgba(82,193,230,.12);color:var(--ink)}
§.vk-ico svg{width:17px;height:17px}
§.vk-ico.dan{color:var(--dan)}
§.vk-ico.on{color:var(--a)}
§.vk-seg{display:inline-flex;border:1px solid var(--hl);border-radius:8px;overflow:hidden}
§.vk-seg button{padding:6px 12px;color:var(--mut);font-size:12px}
§.vk-seg button.on{background:rgba(82,193,230,.22);color:var(--ink)}
§.vk-seg.quiet{opacity:.75}
§.vk-seg.quiet button{padding:3px 9px;font-size:11px}
§.vk-sel{height:30px;padding:0 10px;border:1px solid var(--hl)!important;border-radius:8px;display:inline-flex;align-items:center;gap:8px;font-family:Consolas,ui-monospace,monospace;font-size:12px;color:#cfe8f3;white-space:nowrap}
§.vk-sel svg,§.vk-isel svg,§.vk-sg svg{width:13px;height:13px}
§.vk-sel em,§.vk-sg em{font-style:normal;color:var(--mut);font-family:"Segoe UI",system-ui,sans-serif}
§.vk-link{display:inline-flex;align-items:center;gap:5px;color:var(--a);font-size:12.5px}
§.vk-link svg{width:13px;height:13px}
§.vk-strip{display:inline-flex;align-items:stretch;height:34px;border:1px solid var(--hl);border-radius:10px;background:rgba(10,32,46,.65);overflow:hidden}
§.vk-sg{display:inline-flex;align-items:center;gap:7px;padding:0 12px;border-right:1px solid var(--hl)!important;white-space:nowrap;color:#cfe8f3}
§.vk-sg:last-child{border-right:0!important}
§.vk-sg.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px}
§.vk-sg.own{background:rgba(82,193,230,.12);color:var(--ink)}
§.vk-sg.own > svg{color:var(--a)}
§.vk-sg.quiet{color:var(--mut)}
§.vk-sg.seg{padding:0}
§.vk-sg.seg .vk-seg{border:0;border-radius:0;height:100%}
§.vk-sg.seg .vk-seg button{padding:0 12px}
§.vk-isel{display:inline-flex;align-items:center;gap:5px;padding:1px 7px 1px 8px;border:1px solid rgba(82,193,230,.4)!important;border-radius:6px;color:var(--ink);white-space:nowrap}
§.vk-isel.mono{font-family:Consolas,ui-monospace,monospace;font-size:12px}
§.vk-isel.big{font-size:14px;padding:3px 9px 3px 10px;border-color:rgba(82,193,230,.55)!important}
§.vk-isel em{font-style:normal;color:var(--mut)}
§.vk-sub{display:flex;align-items:center;flex-wrap:wrap;gap:7px;font-size:13px;color:var(--mut);margin-top:3px}
§.vk-sub i{font-style:normal;opacity:.6}
§.vk-sub .vk-has{display:inline-flex;align-items:center;gap:5px;color:var(--ink)}
§.vk-sub .vk-has svg{width:14px;height:14px;color:var(--a)}
§.vk-sub .vk-not{display:inline-flex;align-items:center;gap:5px}
§.vk-sub .vk-not svg{width:13px;height:13px}
§.vk-h1row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
§.vk-badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:12px;font-size:10.5px;letter-spacing:.16em;font-weight:600;white-space:nowrap}
§.vk-badge svg{width:13px;height:13px}
§.vk-badge.fill{background:var(--a);color:#06202c}
§.vk-badge.line{border:1px solid rgba(127,163,182,.55);color:var(--mut)}
§.vk-stage{flex:1;min-height:0;display:grid;grid-template-columns:1fr 300px;gap:14px}
§.vk-holo{position:relative;display:flex;flex-direction:column;min-height:0}
§.vk-tools{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);padding:2px 4px}
§.vk-tools b{color:var(--a);font-weight:600;text-decoration:underline}
§.vk-ship{flex:1;min-height:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 55%,rgba(82,193,230,.13),transparent 62%)}
§.vk-ship svg{width:min(380px,70%);height:auto;stroke-width:1.2;color:#6fd0f0;opacity:.85}
§.vk-panel{border:1px solid var(--hl);border-radius:12px;background:rgba(10,32,46,.75);padding:10px 12px;display:flex;flex-direction:column;gap:9px;min-height:0;overflow:hidden}
§.vk-tabs{display:flex;gap:4px;font-size:11.5px}
§.vk-tabs span{padding:5px 9px;border-radius:14px;color:var(--mut)}
§.vk-tabs span.on{background:rgba(82,193,230,.2);color:var(--ink);border:1px solid var(--a)}
§.vk-rank{font-size:19px;color:var(--ink);font-weight:600}
§.vk-rank small{font-family:Consolas,monospace;font-size:11px;color:var(--mut);margin-left:6px;font-weight:400}
§.vk-radar{flex:1;min-height:60px;display:grid;place-items:center}
§.vk-radar svg{width:110px;height:110px;stroke-width:1;color:var(--a);opacity:.7}
§.vk-kpi{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--hl);border-radius:10px;background:rgba(10,32,46,.8);opacity:.75;margin-right:max(0px,calc(226px - max(164px,50% - 620px)))}
§.vk-kpi div{padding:7px 12px;border-right:1px solid var(--hl);display:flex;flex-direction:column;gap:1px}
§.vk-kpi div:last-child{border-right:0}
§.vk-kpi small{font-size:9.5px;letter-spacing:.14em;color:var(--a);text-transform:uppercase}
§.vk-kpi b{font-family:Consolas,monospace;color:var(--ink);font-size:14px;font-weight:400}
§.vk-dim-stage{opacity:.5}
§.vk-classic{flex:1;min-height:0;display:grid;grid-template-columns:1.25fr 1fr;gap:14px}
§.vk-hero{border:1px solid var(--hl);border-radius:12px;background:linear-gradient(160deg,#10324a,#081824);display:grid;place-items:center;min-height:0}
§.vk-hero svg{width:70%;height:auto;stroke-width:1.2;color:#6fd0f0;opacity:.8}
§.vk-col{display:flex;flex-direction:column;gap:10px;min-height:0}
§.vk-card{border:1px solid var(--hl);border-radius:10px;background:rgba(10,32,46,.7);padding:10px 12px;display:flex;flex-direction:column;gap:7px}
§.vk-card h3,§.vk-own h3{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--a);font-weight:600}
§.vk-lines i{display:block;height:7px;border-radius:4px;background:rgba(200,228,241,.12);margin:5px 0}
§.vk-own{border:1px solid rgba(82,193,230,.4);border-radius:10px;background:rgba(82,193,230,.07);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
§.vk-own.mine{border-left:3px solid var(--a)}
§.vk-own .vk-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
§.vk-own .vk-name{font-size:15px;color:var(--ink);font-weight:600}
§.vk-own .vk-dim{color:var(--mut);font-size:12px}
§.vk-own p{color:var(--mut);font-size:12px}
§.vk-hq{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:12px;border:1px dashed rgba(230,181,82,.55);color:var(--warm);font-size:11.5px;white-space:nowrap}
§.vk-hq svg{width:13px;height:13px}
§.vk-item{flex:1;min-height:0;display:grid;grid-template-columns:1fr 320px;gap:14px}
§.vk-gun{flex:1;min-height:0;display:grid;place-items:center;border:1px solid var(--hl);border-radius:12px;background:radial-gradient(circle at 50% 55%,rgba(82,193,230,.12),transparent 65%)}
§.vk-gun svg{width:min(360px,72%);height:auto;stroke-width:1.3;color:#6fd0f0;opacity:.8}
§.vk-vals{display:grid;grid-template-columns:1fr auto;gap:5px 12px;font-size:12px}
§.vk-vals span{color:var(--mut)}
§.vk-vals b{font-family:Consolas,monospace;color:var(--ink);font-weight:400;text-align:right}
§.vk-fab{position:absolute;z-index:2;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(82,193,230,.5)!important;background:#0c2433!important;color:#cfe8f3;box-shadow:0 6px 18px rgba(0,0,0,.45)}
§.vk-fab svg{width:19px;height:19px}
§.vk-fab.fb{width:56px;height:56px;right:100px;bottom:20px;background:#163e54!important;border-color:var(--a)!important;color:var(--ink)}
§.vk-fab.fb svg{width:23px;height:23px}
§.vk-fab.sh{width:44px;height:44px;right:168px;bottom:26px}
§.vk-fab.be{width:44px;height:44px;right:106px;bottom:88px;font-weight:600;font-size:16px}
`.replace(/§/g, S).trim();

// ── icons ──
const P = {
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  hangar: 'M3 11l9-6 9 6v9H3zM8 20v-6h8v6',
  box: 'M4 7h16v13H4zM4 7l2-3h12l2 3M10 11h4',
  crate: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  pencil: 'M4 20h4l10-10-4-4L4 16v4zM14 6l4 4',
  note: 'M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4',
  pin: 'M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  chev: 'M6 9l6 6 6-6',
  diamond: 'M12 3l8 9-8 9-8-9z',
  share: 'M4 13v7h16v-7M12 3v12M8 7l4-4 4 4',
  chat: 'M4 5h16v11H10l-6 4z',
};
const ic = (n, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true"${fill ? ' style="fill:currentColor"' : ''}><path d="${P[n]}"/></svg>`;
const shipSvg = `<svg viewBox="0 0 240 130" aria-hidden="true"><path d="M20 70l40-30h70l40-20h40l10 14-30 16 30 16-10 14h-40l-40-20H60L20 70z"/><path d="M60 40l20 30-20 30M130 40v60M170 20l-10 50 10 50M90 55h30M90 85h30"/><circle cx="100" cy="70" r="6"/></svg>`;
const gunSvg = `<svg viewBox="0 0 240 90" aria-hidden="true"><path d="M14 38h120l10-10h40v34h-40l-10-10H14z"/><path d="M184 34h42v20h-42M60 52v22h26V52M100 30V18h24v12"/></svg>`;
const radar = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8l40 29-15 47H25L10 37z"/><path d="M50 18l32 22-18 34-26 6-20-40z" style="fill:rgba(82,193,230,.18)"/></svg>`;

const top = (crumb) => `<div class="vk-top"><div class="vk-brand"><b>VERSE COMPANION</b><span>${crumb}</span></div><div class="vk-search"><i>Codex</i><span>Schiffe, Waffen, Komponenten …</span></div></div>`;
const SHIP = { maker: 'Aegis Dynamics · Abfangjäger', name: 'Avenger Stalker', crumbNone: 'Codex › Schiffe › Avenger Stalker', crumbOwn: 'HQ › Hangar › Avenger Stalker' };
const ITEM = { maker: 'Klaus &amp; Werner · Repetierkanone S3', name: 'CF-337 Panther Repeater', crumb: 'Codex › Fahrzeugwaffen › CF-337 Panther Repeater' };

const seg = (holo, d, link) => `<div class="vk-seg" data-m="${d}-seg"><button type="button" class="${holo ? '' : 'on'}"${link && holo ? ` data-screen-link="${link}"` : ''}>Klassisch</button><button type="button" class="${holo ? 'on' : ''}"${link && !holo ? ` data-screen-link="${link}"` : ''}>Holotisch</button></div>`;
const patchSel = (d) => `<button type="button" class="vk-sel" data-m="${d}-ver"><em>Patch</em> 4.10.2-LIVE ${ic('chev')}</button>`;

// ── share corner (decided: Teilen in one row left of the launcher, β above) ──
const corner = `<button type="button" class="vk-fab sh" aria-label="Teilen">${ic('share')}</button><button type="button" class="vk-fab be" aria-label="Beta-Hinweise">β</button><button type="button" class="vk-fab fb" aria-label="Feedback">${ic('chat')}</button>`;

// ── stages ──
const kpi = `<div class="vk-kpi"><div><small>Einsatz</small><b>Kampfschiff</b></div><div><small>Offensive</small><b>2.359/s</b></div><div><small>Verteidigung</small><b>4.488</b></div><div><small>Bewegung</small><b>1.425 m/s</b></div><div><small>Signatur</small><b>5,3 km</b></div></div>`;
const holoStage = (panelTop, d) => `<div class="vk-stage"><div class="vk-holo vk-dim-stage"><div class="vk-tools"><span>Ziehen zum Drehen</span><span><b>3D</b> · Schema</span></div><div class="vk-ship">${shipSvg}</div></div><div class="vk-panel" data-m="${d}-panel">${panelTop}<div class="vk-tabs vk-dim-stage"><span class="on">Einordnung</span><span>Bauteile</span><span>Änderungen</span></div><div class="vk-rank vk-dim-stage">Im Mittelfeld<small>53,3 %</small></div><div class="vk-radar vk-dim-stage">${radar}</div></div></div>${kpi}`;
const classicStage = (colTop, d) => `<div class="vk-classic"><div class="vk-hero vk-dim-stage">${shipSvg}</div><div class="vk-col" data-m="${d}-col">${colTop}<div class="vk-card vk-dim-stage"><div class="vk-tabs"><span class="on">Übersicht</span><span>Bewaffnung</span><span>Komponenten</span></div><div class="vk-lines"><i style="width:90%"></i><i style="width:70%"></i><i style="width:82%"></i></div></div><div class="vk-card vk-dim-stage"><h3>Wo zu kaufen</h3><div class="vk-lines"><i style="width:60%"></i><i style="width:75%"></i></div></div></div></div>${kpi}`;
const itemStage = (cardTop, d) => `<div class="vk-item"><div class="vk-holo"><div class="vk-tools"><span class="vk-dim-stage">Ziehen zum Drehen</span><div class="vk-seg quiet" data-m="${d}-iseg"><button type="button" class="on">Silhouette</button><button type="button">3D-Modell</button></div></div><div class="vk-gun vk-dim-stage">${gunSvg}</div></div><div class="vk-panel" data-m="${d}-panel">${cardTop}<div class="vk-tabs vk-dim-stage"><span class="on">Werte</span><span>Herstellung</span><span>Kaufen &amp; Info</span></div><div class="vk-vals vk-dim-stage"><span>Schaden pro Sekunde</span><b>412</b><span>Feuerrate</span><b>1.100/min</b><span>Reichweite</span><b>1.600 m</b><span>Leistung</span><b>2,1 kW</b><span>Hitze</span><b>mittel</b></div></div></div>`;

// ── ownership card (d3 of round 1, variant select moved to the head) ──
const card = (state, d) => {
  if (state === 'none') return `<div class="vk-own" data-m="${d}-own"><h3>Haben?</h3><p>Nicht in deinem Hangar, nicht auf der Wunschliste.</p><div class="vk-row"><button type="button" class="vk-pill">${ic('heart')} Wunschliste</button><button type="button" class="vk-pill" data-m="${d}-tohangar" data-screen-link="${d}-s2">${ic('hangar')} Hangar</button></div></div>`;
  if (state === 'item') return `<div class="vk-own mine" data-m="${d}-own"><h3>Dein Bestand</h3><div class="vk-row"><span class="vk-step" data-m="${d}-qty"><span>−</span><b>2</b><span>+</span></span><span class="vk-dim">im Inventar</span><span class="vk-grow"></span><button type="button" class="vk-ico" aria-label="Notiz">${ic('note')}</button><button type="button" class="vk-ico" aria-label="Im HQ anheften">${ic('pin')}</button><button type="button" class="vk-ico dan" aria-label="Aus dem Inventar entfernen">${ic('trash')}</button></div><div class="vk-row"><a class="vk-link">Im HQ zeigen ${ic('ext')}</a><span class="vk-grow"></span><a class="vk-link" style="color:var(--mut)">${ic('heart')} Noch eins wünschen</a></div></div>`;
  return `<div class="vk-own mine" data-m="${d}-own"><h3>Dein Exemplar</h3><div class="vk-row"><span class="vk-name">„Schatten“</span><span class="vk-grow"></span><button type="button" class="vk-ico" aria-label="Umbenennen">${ic('pencil')}</button><button type="button" class="vk-ico" aria-label="Notiz">${ic('note')}</button><button type="button" class="vk-ico on" aria-label="Angeheftet">${ic('pin', true)}</button><button type="button" class="vk-ico dan" aria-label="Aus dem Hangar entfernen">${ic('trash')}</button></div><div class="vk-row"><span class="vk-hq">${ic('crate')} Im Nachschub „Kampfflotte“</span></div><div class="vk-row"><a class="vk-link">Im HQ zeigen ${ic('ext')}</a><span class="vk-grow"></span><a class="vk-link" style="color:var(--mut)">${ic('heart')} Noch eins wünschen</a></div></div>`;
};

// ── annotation helper ──
const annoN = {};
function anno(scr, side, target, x, y, q) {
  annoN[scr] = (annoN[scr] || 0) + 1;
  const n = annoN[scr];
  const id = `r2-${scr}-a${n}`;
  const t = target.replace(/"/g, '&quot;');
  return `<div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${t}" style="--anno-x:${x}%;--anno-y:${y}%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${q}</span></button><div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}
const layer = (items) => items.length ? `<div class="anno-layer" data-anno-layer>${items.join('')}</div>` : '';
const screen = (id, label, active, crumb, body, annos = []) =>
  `  <section id="${id}" data-nav-label="${label}" data-screen${active ? ' data-screen-active="true"' : ' hidden'}><div class="vk">${top(crumb)}<div class="vk-page">${body}</div>${corner}</div>${layer(annos)}</section>\n`;
const icon = (svg) => svg.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const design = (id, label, active, motto, traits, iconSvg, screens) =>
  `<section data-design="${id}" data-nav-label="${label}"${active ? ' data-design-active="true"' : ' hidden'} data-screen-fit="full" data-design-motto="${motto}" data-design-traits="${traits.join('|')}" data-design-icon="${icon(iconSvg)}">\n${screens}</section>\n`;

const L = { s1: 'Schiff, nicht im Besitz', s2: 'Schiff im Hangar', s3: 'Klassisch, im Hangar', s4: 'Gegenstand im Inventar' };

// ── D1: Kennleiste ──
const d1Strip = (state, holo, link) => {
  const patch = `<button type="button" class="vk-sg mono" data-m="d1-ver"><em>Patch</em> 4.10.2-LIVE ${ic('chev')}</button>`;
  let own;
  if (state === 'none') own = `<button type="button" class="vk-sg quiet" data-m="d1-own-seg">${ic('diamond')} Nicht im Hangar</button>`;
  else if (state === 'item') own = `<span class="vk-sg own" data-m="d1-own-seg">${ic('box')} Im Inventar · 2×</span>`;
  else own = `<span class="vk-sg own" data-m="d1-own-seg">${ic('hangar')} Im Hangar <button type="button" class="vk-isel" data-m="d1-var"><em>Variante</em> a ${ic('chev')}</button></span>`;
  const view = state === 'item' ? '' : `<span class="vk-sg seg">${seg(holo, 'd1', link)}</span>`;
  return `<div class="vk-strip" data-m="d1-strip">${patch}${own}${view}</div>`;
};
const d1Head = (o, state, holo, link) => `<div class="vk-head"><div class="vk-tt"><small>${o.maker}</small><h1>${o.name}</h1></div><div class="vk-right">${d1Strip(state, holo, link)}</div></div>`;
const d1 = design('d1', 'Kennleiste', true, 'Eine Leiste rechts: Patch, Hangar, Ansicht',
  ['Patch, Hangar mit Variante und Ansicht als ein Bedienstreifen', 'Nicht im Besitz: leises „Nicht im Hangar“, Klick führt zur Karte', 'Titel links bleibt frei'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h8M4 10h6M12 15h9v5h-9zM15 15v5M18 15v5"/></svg>',
  screen('d1-s1', L.s1, true, SHIP.crumbNone, d1Head(SHIP, 'none', true) + holoStage(card('none', 'd1'), 'd1'), [
    anno('d1-s1', 'bottom', '[data-m="d1-own-seg"]', 70, 18, 'Nicht im Besitz sagt das Mittelstück leise „Nicht im Hangar“, ein Klick springt zur Karte „Haben?“ und hebt sie kurz hervor. Braucht der Kopf diesen Zustand, oder reicht die Karte allein?'),
  ]) +
  screen('d1-s2', L.s2, false, SHIP.crumbOwn, d1Head(SHIP, 'own', true, 'd1-s3') + holoStage(card('own', 'd1'), 'd1'), [
    anno('d1-s2', 'bottom', '[data-m="d1-var"]', 72, 18, '„Variante a ▾“ sitzt im selben Stück wie „Im Hangar“. Liest sich das als „schaltet die ganze Seite um“, oder eher als Eigenschaft deines Exemplars?'),
    anno('d1-s2', 'bottom', '[data-m="d1-strip"] .vk-seg', 88, 18, 'Patch, Besitz und Ansicht stecken in einer Leiste. Gehört Klassisch | Holotisch da mit hinein, oder ist es ein anderes Ding als Patch und Besitz?'),
  ]) +
  screen('d1-s3', L.s3, false, SHIP.crumbOwn, d1Head(SHIP, 'own', false, 'd1-s2') + classicStage(card('own', 'd1'), 'd1'), []) +
  screen('d1-s4', L.s4, false, ITEM.crumb, d1Head(ITEM, 'item') + itemStage(card('item', 'd1'), 'd1'), [
    anno('d1-s4', 'bottom', '[data-m="d1-own-seg"]', 80, 18, 'Beim Gegenstand wird das Mittelstück zu „Im Inventar · 2×“, ohne Variante, und die Leiste verliert Klassisch | Holotisch. Passt das Wort „Inventar“?'),
  ]));

// ── D2: Unterzeile ──
const d2Sub = (o, state) => {
  const patch = `<i>·</i>Patch <button type="button" class="vk-isel mono" data-m="d2-ver">4.10.2-LIVE ${ic('chev')}</button>`;
  let own;
  if (state === 'none') own = `<i>·</i><span class="vk-not" data-m="d2-own">${ic('diamond')} Nicht im Hangar</span>`;
  else if (state === 'item') own = `<i>·</i><span class="vk-has" data-m="d2-own">${ic('box')} Im Inventar · 2×</span>`;
  else own = `<i>·</i><span class="vk-has" data-m="d2-own">${ic('hangar')} Im Hangar</span><i>·</i>Variante <button type="button" class="vk-isel" data-m="d2-var">a ${ic('chev')}</button>`;
  return `<div class="vk-sub" data-m="d2-sub"><span>${o.maker}</span>${patch}${own}</div>`;
};
const d2Head = (o, state, holo, link) => `<div class="vk-head"><div class="vk-tt"><h1>${o.name}</h1>${d2Sub(o, state)}</div><div class="vk-right">${state === 'item' ? '' : seg(holo, 'd2', link)}</div></div>`;
const d2 = design('d2', 'Unterzeile', false, 'Eine Zeile unter dem Titel sagt alles',
  ['Hersteller · Klasse · Patch · Besitz als ein Satz', 'Patch und Variante als Auswahl mitten im Satz', 'Rechts vom Titel nur Klassisch / Holotisch'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h12M4 11h4M10 11h3M15 11h5M4 16h16"/></svg>',
  screen('d2-s1', L.s1, true, SHIP.crumbNone, d2Head(SHIP, 'none', true) + holoStage(card('none', 'd2'), 'd2'), [
    anno('d2-s1', 'bottom', '[data-m="d2-sub"]', 25, 22, 'Alles in einem Satz unter dem Namen: Hersteller, Klasse, Patch, Besitz. Liest du das als Satz, oder suchst du darin nach der Patch-Wahl?'),
  ]) +
  screen('d2-s2', L.s2, false, SHIP.crumbOwn, d2Head(SHIP, 'own', true, 'd2-s3') + holoStage(card('own', 'd2'), 'd2'), [
    anno('d2-s2', 'bottom', '[data-m="d2-var"]', 52, 22, 'Die Variante ist eine Auswahl mitten im Satz. Merkt man ihr an, dass sie die ganze Seite auf eine andere Variante umschaltet?'),
  ]) +
  screen('d2-s3', L.s3, false, SHIP.crumbOwn, d2Head(SHIP, 'own', false, 'd2-s2') + classicStage(card('own', 'd2'), 'd2'), [
    anno('d2-s3', 'left', '[data-m="d2-seg"]', 88, 15, 'Rechts vom Namen steht nur noch Klassisch | Holotisch, getrennt vom Patch im Satz darunter. Richtig so getrennt?'),
  ]) +
  screen('d2-s4', L.s4, false, ITEM.crumb, d2Head(ITEM, 'item') + itemStage(card('item', 'd2'), 'd2'), [
    anno('d2-s4', 'bottom', '[data-m="d2-own"]', 50, 22, 'Beim Gegenstand endet der Satz mit „Im Inventar · 2×“. Ist klar, dass 2× dein Bestand ist und nicht etwa 2 Stück pro Schiff?'),
  ]));

// ── D3: Plakette ──
const d3Badge = (state) => {
  if (state === 'none') return `<span class="vk-badge line" data-m="d3-badge">${ic('diamond')} NICHT IM HANGAR</span>`;
  if (state === 'item') return `<span class="vk-badge fill" data-m="d3-badge">${ic('box')} IM INVENTAR · 2×</span>`;
  return `<span class="vk-badge fill" data-m="d3-badge">${ic('hangar')} IM HANGAR</span>`;
};
const d3Head = (o, state, holo, link) => `<div class="vk-head" data-m="d3-head"><div class="vk-tt"><small>${o.maker}</small><div class="vk-h1row"><h1>${o.name}</h1>${d3Badge(state)}</div>${state === 'own' ? `<div><button type="button" class="vk-isel big" data-m="d3-var"><em>Variante</em> a ${ic('chev')}</button></div>` : ''}</div><div class="vk-right" data-m="d3-corner">${patchSel('d3')}${state === 'item' ? '' : seg(holo, 'd3', link)}</div></div>`;
const d3 = design('d3', 'Plakette', false, 'Plakette am Namen zeigt den Besitz',
  ['Badge IM HANGAR direkt hinter dem Namen', 'Variante als Untertitel unter dem Namen', 'Patch und Ansicht oben rechts'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h9M15 5h5v4h-5zM4 12h6M4 17h16"/></svg>',
  screen('d3-s1', L.s1, true, SHIP.crumbNone, d3Head(SHIP, 'none', true) + holoStage(card('none', 'd3'), 'd3'), [
    anno('d3-s1', 'bottom', '[data-m="d3-badge"]', 45, 18, '„NICHT IM HANGAR“ als Umriss-Plakette direkt am Namen. Hilft das, oder ist es doppelt, weil die Karte rechts dasselbe sagt?'),
  ]) +
  screen('d3-s2', L.s2, false, SHIP.crumbOwn, d3Head(SHIP, 'own', true, 'd3-s3') + holoStage(card('own', 'd3'), 'd3'), [
    anno('d3-s2', 'bottom', '[data-m="d3-var"]', 15, 26, 'Die Variante steht wie ein Untertitel direkt unter dem Namen, nur wenn das Schiff dir gehört. Wirkt sie so als Teil des Namens, der die Seite umschaltet?'),
  ]) +
  screen('d3-s3', L.s3, false, SHIP.crumbOwn, d3Head(SHIP, 'own', false, 'd3-s2') + classicStage(card('own', 'd3'), 'd3'), [
    anno('d3-s3', 'left', '[data-m="d3-corner"]', 85, 15, 'Patch und Klassisch | Holotisch teilen sich die Ecke oben rechts, der Besitz klebt am Namen. Passt die Aufteilung?'),
  ]) +
  screen('d3-s4', L.s4, false, ITEM.crumb, d3Head(ITEM, 'item') + itemStage(card('item', 'd3'), 'd3'), [
    anno('d3-s4', 'bottom', '[data-m="d3-badge"]', 50, 18, 'Plakette „IM INVENTAR · 2×“. Gehört die Zahl in die Plakette, oder nur in die Karte „Dein Bestand“?'),
  ]));

const html = `<section data-iteration="2" data-iteration-template="design" data-tab-label="Runde 2" data-design-set="alternatives">
<style>
${css}
</style>
<header class="iteration-intro">
  <h2>Runde 2 · Vier Dinge im Kopf</h2>
  <p>Basis ist dein Favorit Panel-Karte: Wunschliste, Umbenennen, Notiz, Anheften, Entfernen und der Nachschub-Hinweis bleiben in der Karte oben im Panel. Der Kopf trägt jetzt die vier Dinge, die du genannt hast: welches Schiff oder welcher Gegenstand, welcher Patch, im Hangar ja oder nein, und welche Variante im Hangar. Den Datenstand mit Build-Nummer und Schema zeigt der Kopf nicht mehr, der bleibt im Admin-Bereich für Daten-Uploads, hier steht nur der kurze Patch in der Auswahl.</p>
  <p>Drei Entwürfe, wie der Kopf das trägt, jeweils mit Schiff (nicht im Besitz, im Hangar, Klassisch) und einem Gegenstand im Inventar. Unten rechts ist in allen Entwürfen schon das Entschiedene eingezeichnet: Teilen in einer Reihe links neben dem Feedback-Knopf, β darüber. Das „Teilen“ der Bühnenleiste entfällt, der eine Knopf teilt den vollen Holotisch-Zustand. Klick im Mock auf „Hangar“ in der Karte und auf Klassisch | Holotisch.</p>
</header>
${d1}${d2}${d3}</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('wrote', out, html.length);
