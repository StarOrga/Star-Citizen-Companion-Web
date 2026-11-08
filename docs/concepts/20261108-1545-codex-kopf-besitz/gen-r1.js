// Generates rounds/01.html for the codex-kopf-besitz concept.
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
§.vk-page{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:22px max(24px,calc(50% - 620px)) 14px}
§.vk-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
§.vk-tt{display:flex;flex-direction:column;gap:2px;min-width:0}
§.vk-tt small{font-size:12px;color:var(--mut)}
§.vk-tt h1{font-size:30px;line-height:1.1;letter-spacing:.14em;color:var(--ink);font-weight:600;text-transform:uppercase}
§.vk-meta{font-family:Consolas,ui-monospace,monospace;font-size:11px;color:var(--mut);letter-spacing:.02em}
§.vk-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
§.vk-bar{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
§.vk-sep{width:1px;height:20px;background:var(--hl);margin:0 4px}
§.vk-grow{flex:1}
§.vk-pill{height:30px;padding:0 13px;border:1px solid rgba(82,193,230,.5)!important;border-radius:15px;display:inline-flex;align-items:center;gap:7px;color:#cfe8f3;white-space:nowrap}
§.vk-pill:hover{border-color:var(--a)!important;color:var(--ink)}
§.vk-pill.on{background:rgba(82,193,230,.18);border-color:var(--a)!important;color:var(--ink)}
§.vk-pill.quiet{border-color:rgba(82,193,230,.25)!important;color:var(--mut)}
§.vk-pill svg{width:15px;height:15px}
§.vk-pill .vk-ok{color:var(--a)}
§.vk-step{display:inline-flex;align-items:center;gap:6px;margin-left:4px;padding-left:8px;border-left:1px solid var(--hl)}
§.vk-step b{color:var(--ink);min-width:10px;text-align:center}
§.vk-step span{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid var(--hl);font-size:12px;line-height:1}
§.vk-ico{width:30px;height:30px;display:inline-grid;place-items:center;border-radius:8px;color:#a9cfe0}
§.vk-ico:hover{background:rgba(82,193,230,.12);color:var(--ink)}
§.vk-ico svg{width:17px;height:17px}
§.vk-ico.dan{color:var(--dan)}
§.vk-ico.on{color:var(--a)}
§.vk-seg{display:inline-flex;border:1px solid var(--hl);border-radius:8px;overflow:hidden}
§.vk-seg button{padding:6px 12px;color:var(--mut);font-size:12px}
§.vk-seg button.on{background:rgba(82,193,230,.22);color:var(--ink)}
§.vk-sel{height:30px;padding:0 10px;border:1px solid var(--hl)!important;border-radius:8px;display:inline-flex;align-items:center;gap:8px;font-family:Consolas,ui-monospace,monospace;font-size:12px;color:#cfe8f3}
§.vk-sel svg{width:13px;height:13px}
§.vk-sel.var{font-family:inherit;font-size:12.5px}
§.vk-sel.var em{font-style:normal;color:var(--mut)}
§.vk-link{display:inline-flex;align-items:center;gap:5px;color:var(--a);font-size:12.5px}
§.vk-link svg{width:13px;height:13px}
§.vk-anchor{position:relative;display:inline-flex}
§.vk-dots svg{stroke-width:3.2}
§.vk-menu{position:absolute;top:36px;left:0;min-width:230px;border:1px solid var(--hl);border-radius:10px;background:#0c2433;padding:6px;box-shadow:0 12px 30px rgba(0,0,0,.5);z-index:3;display:flex;flex-direction:column}
§.vk-menu span{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;color:#cfe8f3}
§.vk-menu span:hover{background:rgba(82,193,230,.12)}
§.vk-menu span svg{width:16px;height:16px;color:var(--mut)}
§.vk-menu span.dan{color:var(--dan)}
§.vk-menu span.dan svg{color:var(--dan)}
§.vk-menu hr{border:0;border-top:1px solid var(--hl);margin:4px 2px}
§.vk-band{display:flex;align-items:center;gap:12px;padding:8px 10px 8px 14px;border:1px solid var(--hl);border-radius:10px;background:rgba(10,32,46,.6);min-height:46px}
§.vk-band.wish{border-color:rgba(82,193,230,.4);background:rgba(82,193,230,.06)}
§.vk-band.own{border-left:3px solid var(--a);background:rgba(82,193,230,.09)}
§.vk-say{flex:1;display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
§.vk-say > svg{width:18px;height:18px;color:var(--a)}
§.vk-say b{color:var(--ink);font-weight:600}
§.vk-say .vk-dim{color:var(--mut)}
§.vk-stage{flex:1;min-height:0;display:grid;grid-template-columns:1fr 290px;gap:14px}
§.vk-holo{position:relative;display:flex;flex-direction:column;min-height:0}
§.vk-tools{display:flex;justify-content:space-between;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);padding:2px 4px}
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
§.vk-radar svg{width:120px;height:120px;stroke-width:1;color:var(--a);opacity:.7}
§.vk-kpi{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--hl);border-radius:10px;background:rgba(10,32,46,.8);opacity:.75}
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
§.vk-own p{color:var(--mut);font-size:12px}
§.vk-hq{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:12px;border:1px dashed rgba(230,181,82,.55);color:var(--warm);font-size:11.5px;white-space:nowrap}
§.vk-hq svg{width:13px;height:13px}
[data-view] .vk-dias{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:10px 0 18px}
[data-view] .vk-dia{border:1px solid var(--border-color);border-radius:10px;padding:10px;background:var(--panel-bg)}
[data-view] .vk-dia b{display:block;font-size:13px;margin-bottom:6px}
[data-view] .vk-dia svg{width:100%;height:auto;display:block}
[data-view] .vk-now{border-left:3px solid var(--warning-color);padding:6px 12px;margin:8px 0 14px;color:var(--text-secondary)}
`.replace(/§/g, S).trim();

// ── icons ──
const P = {
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  hangar: 'M3 11l9-6 9 6v9H3zM8 20v-6h8v6',
  crate: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  pencil: 'M4 20h4l10-10-4-4L4 16v4zM14 6l4 4',
  note: 'M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4',
  pin: 'M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12l4 4 10-10',
  chev: 'M6 9l6 6 6-6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  diamond: 'M12 3l8 9-8 9-8-9z',
};
const ic = (n, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true"${fill ? ' style="fill:currentColor"' : ''}><path d="${P[n]}"/></svg>`;
const shipSvg = `<svg viewBox="0 0 240 130" aria-hidden="true"><path d="M20 70l40-30h70l40-20h40l10 14-30 16 30 16-10 14h-40l-40-20H60L20 70z"/><path d="M60 40l20 30-20 30M130 40v60M170 20l-10 50 10 50M90 55h30M90 85h30"/><circle cx="100" cy="70" r="6"/><circle cx="150" cy="55" r="4"/><circle cx="150" cy="85" r="4"/></svg>`;
const radar = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8l40 29-15 47H25L10 37z"/><path d="M50 26l23 17-9 27H36l-9-27z" opacity=".6"/><path d="M50 18l32 22-18 34-26 6-20-40z" style="fill:rgba(82,193,230,.18)"/></svg>`;

const top = `<div class="vk-top"><div class="vk-brand"><b>VERSE COMPANION</b><span>HQ › Hangar › Aegis Avenger Stalker</span></div><div class="vk-search">${'<i>Hangar</i>'}<span>Hangar, Sets, Schiffe …</span></div></div>`;
const title = (extraMeta = true) => `<div class="vk-tt"><small>Aegis Dynamics · Abfangjäger</small><h1>Avenger Stalker</h1>${extraMeta ? '<span class="vk-meta">Daten 4.10.2-LIVE.12913470 · Schema 6</span>' : ''}</div>`;
const seg = (holo, d, link) => `<div class="vk-seg" data-m="${d}-seg"><button type="button" class="${holo ? '' : 'on'}"${link && holo ? ` data-screen-link="${link}"` : ''}>Klassisch</button><button type="button" class="${holo ? 'on' : ''}"${link && !holo ? ` data-screen-link="${link}"` : ''}>Holotisch</button></div>`;
const ver = (d) => `<button type="button" class="vk-sel" data-m="${d}-ver">4.10.2-LIVE ${ic('chev')}</button>`;

const holoStage = (panelTop = '', d = '') => `<div class="vk-stage vk-dim-stage-wrap"><div class="vk-holo vk-dim-stage"><div class="vk-tools"><span>Ziehen zum Drehen</span><span><b>3D</b> · Schema</span></div><div class="vk-ship">${shipSvg}</div></div><div class="vk-panel"${d ? ` data-m="${d}-panel"` : ''}>${panelTop}<div class="vk-tabs vk-dim-stage"><span class="on">Einordnung</span><span>Bauteile</span><span>Änderungen</span></div><div class="vk-rank vk-dim-stage">Im Mittelfeld<small>53,3 %</small></div><div class="vk-radar vk-dim-stage">${radar}</div></div></div>${kpi}`;
const kpi = `<div class="vk-kpi"><div><small>Einsatz</small><b>Kampfschiff</b></div><div><small>Offensive</small><b>2.359/s</b></div><div><small>Verteidigung</small><b>4.488</b></div><div><small>Bewegung</small><b>1.425 m/s</b></div><div><small>Signatur</small><b>5,3 km</b></div></div>`;
const classicStage = (colTop = '', d = '') => `<div class="vk-classic"><div class="vk-hero vk-dim-stage">${shipSvg}</div><div class="vk-col"${d ? ` data-m="${d}-col"` : ''}>${colTop}<div class="vk-card vk-dim-stage"><div class="vk-tabs"><span class="on">Übersicht</span><span>Bewaffnung</span><span>Komponenten</span></div><div class="vk-lines"><i style="width:90%"></i><i style="width:70%"></i><i style="width:82%"></i></div></div><div class="vk-card vk-dim-stage"><h3>Wo zu kaufen</h3><div class="vk-lines"><i style="width:60%"></i><i style="width:75%"></i></div></div></div></div>${kpi}`;

// ── annotation helper ──
let annoN = {};
function anno(scr, side, target, x, y, q) {
  annoN[scr] = (annoN[scr] || 0) + 1;
  const n = annoN[scr];
  const id = `r1-${scr}-a${n}`;
  const t = target.replace(/"/g, '&quot;');
  return `<div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${t}" style="--anno-x:${x}%;--anno-y:${y}%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${q}</span></button><div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}
const layer = (items) => items.length ? `<div class="anno-layer" data-anno-layer>${items.join('')}</div>` : '';
const screen = (id, label, active, body, annos = []) =>
  `  <section id="${id}" data-nav-label="${label}" data-screen${active ? ' data-screen-active="true"' : ' hidden'}><div class="vk">${top}<div class="vk-page">${body}</div></div>${layer(annos)}</section>\n`;
const icon = (svg) => svg.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const design = (id, label, active, motto, traits, iconSvg, screens) =>
  `<section data-design="${id}" data-nav-label="${label}"${active ? ' data-design-active="true"' : ' hidden'} data-screen-fit="full" data-design-motto="${motto}" data-design-traits="${traits.join('|')}" data-design-icon="${icon(iconSvg)}">\n${screens}</section>\n`;

// ── D1: Kopfzeile ──
const d1Bar = (state, menu = true) => {
  const wish = state === 'wish'
    ? `<a class="vk-pill on" data-m="d1-wish">${ic('heart', true)} Auf der Wunschliste<span class="vk-step"><span>−</span><b>1</b><span>+</span></span></a>`
    : `<button type="button" class="vk-pill${state === 'own' ? ' quiet' : ''}" data-m="d1-wish"${state === 'none' ? ' data-screen-link="d1-s2"' : ''}>${ic('heart')} ${state === 'own' ? 'Noch eins wünschen' : 'Auf die Wunschliste'}</button>`;
  const hang = state === 'own'
    ? `<a class="vk-pill on" data-m="d1-hangar">${ic('hangar')} Im Hangar <span class="vk-ok">${ic('check')}</span></a>`
    : `<button type="button" class="vk-pill" data-m="d1-hangar"${state === 'wish' ? ' data-screen-link="d1-s3"' : ''}>${ic('hangar')} In den Hangar</button>`;
  const own = state === 'own'
    ? `<span class="vk-sep"></span><button type="button" class="vk-sel var" data-m="d1-var"><em>Variante</em> a ${ic('chev')}</button><span class="vk-anchor"><button type="button" class="vk-ico vk-dots" data-m="d1-more" aria-label="Mehr zu deinem Schiff">${ic('dots')}</button>${menu ? `<div class="vk-menu"><span>${ic('pencil')} Umbenennen</span><span>${ic('note')} Notiz</span><span>${ic('pin')} Im HQ anheften</span><span>${ic('ext')} Im HQ-Hangar zeigen</span><hr><span class="dan">${ic('trash')} Aus dem Hangar entfernen</span></div>` : ''}</span>`
    : '';
  return `<div class="vk-bar" data-m="d1-bar">${wish}${hang}${own}<span class="vk-grow"></span>${ver('d1')}</div>`;
};
const d1Head = (holo, link) => `<div class="vk-head">${title()}<div class="vk-right">${seg(holo, 'd1', link)}</div></div>`;
const d1 = design('d1', 'Kopfzeile', true, 'Alles in einer Kopfzeile',
  ['Status als zwei kleine Chips', 'Eigene Aktionen hinter ⋯', 'Ansicht rechts neben dem Titel'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 9h6M13 9h7M4 13h16v7H4z"/></svg>',
  screen('d1-s1', 'Nicht im Besitz', true, d1Head(true) + d1Bar('none') + holoStage(), [
    anno('d1-s1', 'bottom', '[data-m="d1-bar"]', 30, 30, 'Zwei kleine Chips statt der großen Wunschliste-→-Hangar-Kästen. Reicht dir das, oder fehlt dir die sichtbare Linie „erst wünschen, dann besitzen“?'),
    anno('d1-s1', 'left', '[data-m="d1-seg"]', 85, 20, 'Klassisch | Holotisch steht rechts auf Höhe des Titels, in beiden Ansichten an derselben Stelle. Richtig so?'),
    anno('d1-s1', 'left', '[data-m="d1-ver"]', 85, 30, 'Patch-Wahl rechts in der Statuszeile, der Datenstand als leise Zeile unter dem Titel. Passt diese Trennung?'),
  ]) +
  screen('d1-s2', 'Auf der Wunschliste', false, d1Head(true) + d1Bar('wish') + holoStage(), [
    anno('d1-s2', 'bottom', '[data-m="d1-wish"]', 20, 30, 'Gewünscht: der Chip füllt sich und zeigt die Menge direkt mit − / +. Klick auf den Chip öffnet die Wunschliste. Reicht das als Rückmeldung?'),
  ]) +
  screen('d1-s3', 'Im Hangar', false, d1Head(true, 'd1-s4') + d1Bar('own') + holoStage(), [
    anno('d1-s3', 'right', '[data-m="d1-more"]', 40, 30, 'Umbenennen, Notiz, Anheften und Entfernen wandern hinter ⋯ (Entfernen rot, mit Rückfrage). Oder soll Anheften sichtbar bleiben?'),
    anno('d1-s3', 'bottom', '[data-m="d1-var"]', 35, 30, 'Variante-Wahl nur, wenn das Schiff dir gehört, als normale Auswahl statt als großer blauer Knopf. Einverstanden?'),
    anno('d1-s3', 'bottom', '[data-m="d1-hangar"]', 25, 30, 'Den „Nachschub 0“-Knopf oben rechts gibt es hier nicht mehr. Steckt das Schiff in einem Nachschub, erscheint stattdessen ein Chip „Im Nachschub ‚Name‘“ in dieser Zeile. Fehlt dir der Knopf?'),
  ]) +
  screen('d1-s4', 'Klassisch, im Hangar', false, d1Head(false, 'd1-s3') + d1Bar('own', false) + classicStage(), [
    anno('d1-s4', 'bottom', '[data-m="d1-bar"]', 30, 30, 'Klassisch zeigt exakt dieselbe Kopf- und Statuszeile wie der Holotisch, nur die Bühne darunter wechselt. So gewollt?'),
  ]));

// ── D2: Besitz-Band ──
const d2Head = (holo, link) => `<div class="vk-head">${title()}<div class="vk-right">${seg(holo, 'd2', link)}${ver('d2')}</div></div>`;
const d2Band = (state) => {
  if (state === 'none') return `<div class="vk-band" data-m="d2-band"><div class="vk-say">${ic('diamond')}<span class="vk-dim">Nicht in deinem Hangar, nicht auf der Wunschliste.</span></div><button type="button" class="vk-pill" data-m="d2-wish" data-screen-link="d2-s2">${ic('heart')} Auf die Wunschliste</button><button type="button" class="vk-pill">${ic('hangar')} In den Hangar</button></div>`;
  if (state === 'wish') return `<div class="vk-band wish" data-m="d2-band"><div class="vk-say">${ic('heart', true)}<b>Auf deiner Wunschliste</b><span class="vk-step" data-m="d2-step"><span>−</span><b>1</b><span>+</span></span><a class="vk-link">Wunschliste öffnen ${ic('ext')}</a></div><button type="button" class="vk-pill" data-m="d2-buy" data-screen-link="d2-s3">${ic('hangar')} Gekauft: in den Hangar</button></div>`;
  return `<div class="vk-band own" data-m="d2-band"><div class="vk-say">${ic('hangar')}<b>In deinem Hangar</b><span class="vk-dim">als</span><b>„Schatten“</b><button type="button" class="vk-sel var" data-m="d2-var"><em>Variante</em> a ${ic('chev')}</button><span class="vk-hq" data-m="d2-hq">${ic('crate')} Im Nachschub „Kampfflotte“</span></div><span data-m="d2-acts"><button type="button" class="vk-ico" aria-label="Umbenennen">${ic('pencil')}</button><button type="button" class="vk-ico" aria-label="Notiz">${ic('note')}</button><button type="button" class="vk-ico on" aria-label="Angeheftet">${ic('pin', true)}</button><button type="button" class="vk-ico dan" aria-label="Aus dem Hangar entfernen">${ic('trash')}</button></span><span class="vk-sep"></span><a class="vk-link">Im HQ zeigen ${ic('ext')}</a></div>`;
};
const d2 = design('d2', 'Besitz-Band', false, 'Ein Band sagt, was dir gehört',
  ['Ein ganzer Satz statt Kästen', 'Band färbt sich bei Besitz', 'Eigene Aktionen offen im Band'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h10M4 10h16v5H4zM4 19h16"/></svg>',
  screen('d2-s1', 'Nicht im Besitz', true, d2Head(true) + d2Band('none') + holoStage(), [
    anno('d2-s1', 'bottom', '[data-m="d2-band"] .vk-say', 25, 30, 'Statt zweier Kästen ein Satz: „Nicht in deinem Hangar, nicht auf der Wunschliste.“ Liest sich das schneller als Symbole?'),
    anno('d2-s1', 'left', '[data-m="d2-wish"]', 70, 30, 'Beide Wege sind gleichrangige Pillen, keiner ist der große Hauptknopf der Seite. Einverstanden, oder soll „Auf die Wunschliste“ hervorstechen?'),
  ]) +
  screen('d2-s2', 'Auf der Wunschliste', false, d2Head(true) + d2Band('wish') + holoStage(), [
    anno('d2-s2', 'left', '[data-m="d2-buy"]', 75, 30, 'Gewünscht: der nächste Schritt heißt „Gekauft: in den Hangar“ und erfüllt den Wunsch (mit Rückgängig). Ist das Wort richtig?'),
  ]) +
  screen('d2-s3', 'Im Hangar', false, d2Head(true, 'd2-s4') + d2Band('own') + holoStage(), [
    anno('d2-s3', 'bottom', '[data-m="d2-acts"]', 70, 30, 'Umbenennen, Notiz, Anheften, Entfernen stehen offen als Symbole im Band, nicht hinter einem Menü. Zu viel, oder genau richtig?'),
    anno('d2-s3', 'bottom', '[data-m="d2-hq"]', 45, 30, 'Der Nachschub steht als Hinweis im Band (nur wenn das Schiff in einem steckt), der „Nachschub 0“-Knopf oben rechts entfällt. Passt das?'),
  ]) +
  screen('d2-s4', 'Klassisch, im Hangar', false, d2Head(false, 'd2-s3') + d2Band('own') + classicStage(), [
    anno('d2-s4', 'bottom', '[data-m="d2-band"]', 30, 30, 'Dasselbe Band in Klassisch, an derselben Stelle. Fehlt in Klassisch etwas, das nur hier gebraucht wird?'),
  ]));

// ── D3: Panel-Karte ──
const d3Head = (holo, link) => `<div class="vk-head" data-m="d3-head">${title()}<div class="vk-right">${seg(holo, 'd3', link)}${ver('d3')}</div></div>`;
const d3Card = (state) => {
  if (state === 'none') return `<div class="vk-own" data-m="d3-own"><h3>Haben?</h3><p>Nicht in deinem Hangar, nicht auf der Wunschliste.</p><div class="vk-row"><button type="button" class="vk-pill" data-screen-link="d3-s2">${ic('heart')} Wunschliste</button><button type="button" class="vk-pill">${ic('hangar')} Hangar</button></div></div>`;
  if (state === 'wish') return `<div class="vk-own" data-m="d3-own"><h3>Auf deiner Wunschliste</h3><div class="vk-row"><a class="vk-pill on">${ic('heart', true)} Gewünscht<span class="vk-step"><span>−</span><b>1</b><span>+</span></span></a></div><div class="vk-row"><button type="button" class="vk-pill" data-screen-link="d3-s3">${ic('hangar')} Gekauft: in den Hangar</button></div><a class="vk-link">Wunschliste öffnen ${ic('ext')}</a></div>`;
  return `<div class="vk-own mine" data-m="d3-own"><h3>Dein Exemplar</h3><div class="vk-row"><span class="vk-name">„Schatten“</span><span class="vk-grow"></span><button type="button" class="vk-ico" aria-label="Umbenennen">${ic('pencil')}</button><button type="button" class="vk-ico" aria-label="Notiz">${ic('note')}</button><button type="button" class="vk-ico on" aria-label="Angeheftet">${ic('pin', true)}</button><button type="button" class="vk-ico dan" aria-label="Aus dem Hangar entfernen">${ic('trash')}</button></div><div class="vk-row"><button type="button" class="vk-sel var"><em>Variante</em> a ${ic('chev')}</button><span class="vk-hq">${ic('crate')} Im Nachschub „Kampfflotte“</span></div><div class="vk-row"><a class="vk-link">Im HQ zeigen ${ic('ext')}</a><span class="vk-grow"></span><a class="vk-link" style="color:var(--mut)">${ic('heart')} Noch eins wünschen</a></div></div>`;
};
const d3 = design('d3', 'Panel-Karte', false, 'Kopf nur Titel, Besitz im Panel',
  ['Kopf bleibt ganz ruhig', 'Besitz als Karte über den Tabs', 'In Klassisch oben in der Spalte'],
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 9h10v11H4zM16 9h4v4h-4zM16 15h4v5h-4z"/></svg>',
  screen('d3-s1', 'Nicht im Besitz', true, d3Head(true) + holoStage(d3Card('none'), 'd3'), [
    anno('d3-s1', 'bottom', '[data-m="d3-head"]', 30, 20, 'Der Kopf trägt nur noch Titel, Ansicht und Patch, nichts zum Besitz. Zu leer, oder genau die Ruhe, die fehlt?'),
    anno('d3-s1', 'left', '[data-m="d3-own"]', 80, 35, 'Wunschliste und Hangar stehen als Karte oben im Panel, über Einordnung / Bauteile / Änderungen. Findest du sie dort, ohne zu suchen?'),
  ]) +
  screen('d3-s2', 'Auf der Wunschliste', false, d3Head(true) + holoStage(d3Card('wish'), 'd3'), [
    anno('d3-s2', 'left', '[data-m="d3-own"]', 80, 35, 'Gewünscht wird die Karte höher, das Panel darunter rückt nach unten. Stört dich, dass der Vergleich dann weiter unten beginnt?'),
  ]) +
  screen('d3-s3', 'Im Hangar', false, d3Head(true, 'd3-s4') + holoStage(d3Card('own'), 'd3'), [
    anno('d3-s3', 'left', '[data-m="d3-own"]', 80, 35, '„Dein Exemplar“ mit Name, Variante, Nachschub-Hinweis und den vier Aktionen. Gehört die Variante-Wahl hierher oder doch in den Kopf, weil sie die ganze Seite umschaltet?'),
  ]) +
  screen('d3-s4', 'Klassisch, im Hangar', false, d3Head(false, 'd3-s3') + classicStage(d3Card('own'), 'd3'), [
    anno('d3-s4', 'left', '[data-m="d3-col"]', 75, 30, 'In Klassisch sitzt dieselbe Karte oben in der rechten Spalte. Gleiche Karte, anderer Ort: stört dich der Sprung beim Umschalten?'),
  ]));

// ── View: Teilen-Knopf ──
const dia = (label, body) => `<div class="vk-dia"><b>${label}</b><svg viewBox="0 0 200 120" aria-hidden="true">
<rect x="1" y="1" width="198" height="118" rx="8" fill="none" stroke="currentColor" stroke-opacity=".25"/>
<rect x="10" y="84" width="140" height="22" rx="5" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".25"/>
<text x="16" y="99" font-size="9" fill="currentColor" fill-opacity=".6">Holotisch-Leiste unten</text>${body}</svg></div>`;
const c = (x, y, t, hi) => `<circle cx="${x}" cy="${y}" r="9" fill="${hi ? 'var(--accent-color)' : 'none'}" fill-opacity="${hi ? '.25' : '0'}" stroke="${hi ? 'var(--accent-color)' : 'currentColor'}" stroke-opacity="${hi ? '1' : '.6'}"/><text x="${x}" y="${y + 3}" font-size="8" text-anchor="middle" fill="currentColor">${t}</text>`;
const dec = (id, label, h, body, checked) => `
    <div class="variant-evaluation" data-decision="${id}" data-label="${label}">
      <h3>${h}</h3>
      ${body}
      <div class="eval-group">
        <label class="eval-option"><input type="radio" name="eval-${id}" value="discard"${checked ? '' : ' checked'}><span class="eval-label">Verwerfen</span></label>
        <label class="eval-option"><input type="radio" name="eval-${id}" value="include"${checked ? ' checked' : ''}><span class="eval-label">Miteinbeziehen</span></label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="${id}-note">{{decision.comment_label}}</label>
        <textarea id="${id}-note" data-comment="${id}-note" data-attachable placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>`;
const view = `<section data-view="r1-v-teilen" data-view-kind="decision" data-nav-label="Teilen-Knopf: wohin?" hidden>
  <div class="view-frame">
    <h2>Wo sitzt der Teilen-Knopf?</h2>
    <p class="vk-now"><b>Heute:</b> Teilen sitzt links neben β und dem Feedback-Knopf. Auf dem Holotisch hebt die untere Leiste nur den Teilen-Knopf an (<code>--sc-share-lift</code>), β und Feedback bleiben unten. Ergebnis: Teilen schwebt allein, ein halbes Raster höher als β und nicht in derselben Spalte. Dazu gibt es auf dem Holotisch ein zweites „Teilen“ in der Bühnenleiste (3D · Schema · Teilen).</p>
    <div class="vk-dias">
      ${dia('A · Eckstapel', c(184, 26, '↗', true) + c(184, 48, 'β') + c(184, 70, '💬'))}
      ${dia('B · Reihe mit dem Launcher', c(162, 70, '↗', true) + c(184, 48, 'β') + c(184, 70, '💬'))}
      ${dia('C · Im Seitenkopf', '<rect x="120" y="12" width="70" height="16" rx="4" fill="none" stroke="var(--accent-color)"/><text x="126" y="23" font-size="8" fill="currentColor">Patch ▾  ↗ Teilen</text>' + c(184, 70, '💬') + c(184, 48, 'β'))}
    </div>
    ${dec('share-stack', 'Eckstapel', 'A · Teilen in den Eckstapel (Empfehlung)', '<p>Teilen sitzt in derselben senkrechten Spalte wie β und der Feedback-Knopf, gleiche Größe, gleicher Abstand: Feedback unten, darüber β, darüber Teilen. Hat eine Seite unten eine eigene Leiste (Holotisch), hebt sich der <b>ganze Stapel</b> darüber, nie ein Knopf allein. Eine Regel für jede Seite, auch Handy.</p>', true)}
    ${dec('share-row', 'Reihe mit dem Launcher', 'B · Teilen in einer Reihe links neben dem Launcher', '<p>So wie ursprünglich gedacht: Teilen auf der Mittellinie des Feedback-Knopfs, links daneben; β bleibt darüber. Auf dem Holotisch hebt sich die ganze Reihe. Braucht unten mehr Breite und kann breite Leisten am rechten Rand berühren.</p>', false)}
    ${dec('share-head', 'Im Seitenkopf', 'C · Teilen in den Seitenkopf', '<p>Auf Codex- und Hangar-Seiten wird Teilen ein Symbol-Knopf im Kopf neben der Patch-Wahl, der schwebende Knopf entfällt dort (auf langen Textseiten wie News bleibt er). Unten rechts bleiben nur β und Feedback.</p>', false)}
    ${dec('share-merge', 'Ein Teilen pro Seite', 'Dazu: nur ein Teilen pro Seite', '<p>Das „Teilen“ in der Bühnenleiste des Holotischs kopiert den Holotisch-Zustand (Ansicht, ungespeicherte Hardpoint-Änderungen), der schwebende Knopf nur Adresse und Abschnitt. Vorschlag: die Bühnenleiste verliert ihr „Teilen“, der eine Teilen-Knopf teilt auf der Schiffsseite den vollen Holotisch-Zustand.</p>', true)}
  </div>
</section>`;

const html = `<section data-iteration="1" data-iteration-template="design" data-tab-label="Runde 1" data-design-set="alternatives">
<style>
${css}
</style>
<header class="iteration-intro">
  <h2>Runde 1 · Der Kopf einer Schiffsseite</h2>
  <p>Heute stapeln sich unter dem Titel vier lose Zeilen: „Nachschub 0“ oben rechts, Variante + Datenstand + Patch + vier Symbole, ein großer Kasten Wunschliste → Hangar mit dem einzigen Hauptknopf der Seite, und Klassisch | Holotisch allein am Rand. Drei Entwürfe ordnen das neu, jeweils in vier klickbaren Zuständen (nicht im Besitz → gewünscht → im Hangar → dasselbe in Klassisch). Klick auf „Auf die Wunschliste“, „In den Hangar“ und Klassisch | Holotisch im Mock. Die Frage zum Teilen-Knopf steht oben im Umschalter unter „?“.</p>
</header>
${d1}${d2}${d3}${view}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('wrote', out, html.length);
