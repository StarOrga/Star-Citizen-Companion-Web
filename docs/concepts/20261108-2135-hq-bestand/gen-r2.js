// Generates rounds/02.html of the HQ Bestand concept. Run: node gen-r2.js <out>
const fs = require('fs');
const out = process.argv[2];

const P = (ds) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ds.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
// The app's own icons (src/app/shared/item-path/path-icons.ts, shell/fusion-bar/search-icons.ts)
const I = {
  inv: P(['M4 8l8-4 8 4v9l-8 4-8-4z', 'M4 8l8 4 8-4M12 12v9']),
  hangar: P(['M3 20V10l9-6 9 6v10', 'M7 20v-7h10v7', 'M7 16h10']),
  sam: P(['M12 3.5l9 4.5-9 4.5L3 8z', 'M3 12.5l9 4.5 9-4.5', 'M3 17l9 4.5 9-4.5']),
  wish: P(['M7 4h10v16l-5-4-5 4z']),
  nach: P(['M12 3v8', 'M8.5 7.5L12 11l3.5-3.5', 'M4 13h5l1.5 2.5h3L15 13h5v7H4z']),
  weapon: P(['M3 14h12l3-3h3v3l-3 2H3z', 'M7 14v3']),
  item: P(['M4 8h14v4h-8l-2 6H5l1-6H4z']),
  bp: P(['M4 4h16v16H4z', 'M4 9h16M9 4v16', 'M12 13h5M12 16h3']),
  gallery: P(['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6']),
  set: P(['M6 3h12v18H6z', 'M12 3v18', 'M10 11v2M14 11v2']),
  search: P(['M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z', 'M20 20l-4.2-4.2']),
  home: P(['M4 11l8-6.5 8 6.5v9H4z']),
  pulse: P(['M3 12h4l2.5-6 5 12 2.5-6h4']),
  plan: P(['M5 4h14v16H5z', 'M8.5 9h7M8.5 13h7M8.5 17h4']),
  chart: P(['M4 20V10M10 20V4M16 20v-7M21 20H3']),
  chat: P(['M4 5h16v11H9l-5 4z']),
  x: P(['M7 7l10 10M17 7L7 17']),
  trash: P(['M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13']),
  gear: P(['M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z', 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1']),
  lock: P(['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3']),
  coin: P(['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5M12 6.5v1.5M12 16v1.5']),
  route: P(['M6 19a2 2 0 1 0 0-.01', 'M18 7a2 2 0 1 0 0-.01', 'M6 17V10a3 3 0 0 1 3-3h7']),
  user: P(['M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M4.5 20a7.5 7.5 0 0 1 15 0']),
  plus: P(['M12 5v14M5 12h14']),
  dots: P(['M12 5h.01M12 12h.01M12 19h.01']),
  table: P(['M3 5h18v14H3z', 'M3 10h18M3 15h18M9 5v14']),
  grid: P(['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z']),
  hull: '<svg viewBox="0 0 120 40" aria-hidden="true"><path d="M4 22 L30 16 L56 6 L78 8 L96 15 L116 20 L96 25 L78 32 L56 34 L30 24 Z"/><path d="M56 6 L60 20 L56 34 M30 16 L34 20 L30 24"/></svg>',
};

/* ------------------------------------------------------------------ shared data */
const PLACES = [
  ['Area18', 'ArcCorp', 46, 14], ['Lorville', 'Hurston', 32, 9], ['Port Tressler', 'microTech', 12, 6],
  ['Cutlass „Rotfuchs“', 'Frachtraum', 10, 3], ['Seraphim Station', 'Crusader', 8, 3], ['Ruin Station', 'Pyro', 6, 1], ['Everus Harbor', 'Hurston', 4, 2],
];
const RES = [ // name, total SCU, stacks [place, q, scu]
  ['Eisen', 24, [['Area18', 940, 4], ['Area18', 810, 5], ['Area18', 620, 6], ['Lorville', 410, 9]]],
  ['Agricium', 10, [['Area18', 880, 4], ['Lorville', 700, 3], ['Port Tressler', 560, 3]]],
  ['Quantanium', 6, [['Cutlass „Rotfuchs“', 760, 6]]],
  ['Hadanit', 4, [['Lorville', 990, 4]]],
];
const ITEMS = [ // name, qty, place, kind, scrap
  ['P4-AR Sturmgewehr', '×2', 'Area18', 'Waffe', 'ja'], ['Arclight-Laserpistole', '×1', 'Area18', 'Waffe', 'ja'],
  ['Lumin-Lasermagazin', '×4', 'Lorville', 'Waffe', 'nein'], ['ORC-mkX „Arctic“', '×1', 'Cutlass „Rotfuchs“', 'Rüstung', 'nein'],
  ['Pembroke-Helm', '×1', 'Lorville', 'Rüstung', 'ja'], ['Medpen (Hemozal)', '×12', 'Port Tressler', 'Sonstiges', 'nein'],
  ['Multitool', '×1', 'Area18', 'Sonstiges', 'ja'],
];
const SHIPS = [['Cutlass Black', '„Rotfuchs“', 'Pledge', 'Area18'], ['Gladius', '', 'Ingame', 'Lorville'], ['Prospector', '', 'Ingame', 'Lorville'], ['Arrow', '', 'Leihschiff', 'Port Tressler']];
const BPS = [['P4-AR Sturmgewehr', 'Blaupause'], ['Arclight-Laserpistole', 'Blaupause'], ['Pembroke-Helm', 'Blaupause'], ['Alpha 4.10: Patch-Notes', 'News'], ['Pyro, Sonnenaufgang', 'Galerie']];
const qcol = (q) => (q >= 900 ? '#8ff0ff' : q >= 700 ? '#52c1e6' : q >= 500 ? '#4d8bb0' : '#5c6f80');

/* ------------------------------------------------------------------ chrome */
const PAGES = [['Start', null], ['Bestand', 's1'], ['Jetzt', null], ['Planen', null], ['Statistik', null]];
function chrome(p, inner, opts = {}) {
  const pages = PAGES.map(([n, s]) => (s ? `<a class="d10-pg${n === 'Bestand' ? ' on' : ''}" href="#" data-screen-link="${p}-${s}">${n}</a>` : `<span class="d10-pg">${n}</span>`)).join('');
  const scope = opts.scope === undefined ? 'Inventar' : opts.scope;
  const field = opts.typed ? `<span class="d10-typed">${opts.typed}<i class="d10-caret"></i></span>` : `<span class="d10-ph">${scope ? `Im ${scope} suchen …` : 'Im ganzen Bestand suchen …'}</span>`;
  const chip = scope ? `<span class="d10-scope">${scope}<i>${I.x}</i></span>` : '';
  const rail = [['Start', I.home], ['Bestand', I.inv], ['Jetzt', I.pulse], ['Planen', I.plan], ['Statistik', I.chart]].map(([n, ic]) => `<span class="${n === 'Bestand' ? 'on' : ''}" aria-label="${n}">${ic}</span>`).join('');
  return `<div class="d10-app ${opts.cls || ''}">
<header class="d10-mh"><span class="d10-brand"><i class="d10-logo"></i>VERSE COMPANION</span><nav class="d10-nav"><span>Verse</span><span>Codex</span><span class="on">HQ</span><span>Starscape</span></nav><span class="d10-right"><span class="d10-av">JT</span></span></header>
<div class="d10-sub"><nav class="d10-pages">${pages}</nav><a class="d10-search${opts.typed ? ' open' : ''}" href="#" data-screen-link="${p}-s5">${I.search}${chip}${field}</a></div>
<div class="d10-body"><aside class="d10-rail">${rail}</aside><main class="d10-frame">${inner}</main></div>
<span class="d10-fab" aria-label="Feedback">${I.chat}</span><span class="d10-status"><i class="d10-dot"></i><b>Tracking</b><span>Stanton › Area18 · Inventar vor 2 Min. gelesen</span></span>
${opts.overlay || ''}</div>`;
}
function head(p, d, area, mode) {
  const icon = area === 'Inventar' ? I.inv : area === 'Hangar' ? I.hangar : I.sam;
  const tabs = [['Inventar', I.inv, 's1', '24 SCU · 7'], ['Hangar', I.hangar, 's7', '4'], ['Sammlung', I.sam, 's8', '5']];
  const modes = area === 'Inventar' ? `<span class="d10-mode"><a class="${mode === 'over' ? 'on' : ''}" href="#" data-screen-link="${p}-s1">${I.grid}Übersicht</a><a class="${mode === 'table' ? 'on' : ''}" href="#" data-screen-link="${p}-s4">${I.table}Tabelle</a></span>` : '';
  return `<header class="d10-head ${d}-head"><span class="d10-ti">${icon}</span><div><small>Bestand</small><h2>${area}</h2></div>
<nav class="d10-tabs">${tabs.map(([n, ic, s, c]) => `<a class="${n === area ? 'on' : ''}" href="#" data-screen-link="${p}-${s}">${ic}${n}<small>${c}</small></a>`).join('')}</nav>${modes}<span class="d10-menu">${I.dots}</span></header>`;
}
function filters(area, sel = {}) {
  const chip = (n, c, on) => `<span class="d10-chip${on ? ' on' : ''}${c === '0' ? ' zero' : ''}">${n}${c !== null ? `<b>${c}</b>` : ''}${on && n !== 'Alle' ? `<i>${I.x}</i>` : ''}</span>`;
  if (area === 'Inventar') {
    return `<div class="d10-filters">${chip('Alle', null, !sel.cat)}${chip('Waffen', '3', sel.cat === 'Waffen')}${chip('Rüstung', '2', false)}${chip('Rohstoffe', '4', sel.cat === 'Rohstoffe')}${chip('Sonstiges', '2', false)}${chip('Sets', '0', false)}
<span class="d10-sel">${sel.place || 'Alle Orte'}<i>▾</i></span><span class="d10-tog${sel.res ? ' on' : ''}">${I.lock}Reserviert</span><span class="d10-tog${sel.scrap ? ' on' : ''}">${I.gear}Zerlegbar</span></div>`;
  }
  if (area === 'Hangar') {
    return `<div class="d10-filters">${chip('Alle', null, true)}${chip('Pledge', '1')}${chip('Ingame', '2')}${chip('Leihschiff', '1')}<span class="d10-sep"></span>${chip('Kampf', '2')}${chip('Fracht', '1')}${chip('Bergbau', '1')}${chip('Bergung', '0')}${chip('Erkundung', '0')}<span class="d10-sel">Alle Orte<i>▾</i></span></div>`;
  }
  return `<div class="d10-filters">${chip('Alle', null, true)}${chip('Blaupausen', '3')}${chip('Ruf', '0')}${chip('News', '1')}${chip('Galerie', '1')}</div>`;
}
const btn = (t, cls = '', ic = '') => `<span class="d10-btn ${cls}">${ic}${t}</span>`;

/* ------------------------------------------------------------------ annotations */
function anno(id, n, side, target, x, y, q) {
  return `<div class="anno" data-anno="${id}" data-anno-side="${side}" data-anno-target="${target}" style="--anno-x:${x}%;--anno-y:${y}%">
  <button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button>
  <div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false">
    <button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${q}</span></button>
    <div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div>
  </div>
</div>`;
}
const LABELS = ['Übersicht', 'Ort: Area18', 'Eisen nach Qualität', 'Tabelle', 'Suche ohne Treffer', 'Aus dem Bestand planen', 'Hangar', 'Sammlung'];
function screens(p, bodies, annos) {
  return bodies.map((b, i) => {
    const id = `${p}-s${i + 1}`;
    const a = annos[id] || [];
    return `<section id="${id}" data-nav-label="${LABELS[i]}" data-screen${i === 0 ? ' data-screen-active="true"' : ' hidden'} data-screen-fit="full">
${b}
${a.length ? `<div class="anno-layer" data-anno-layer>\n${a.join('\n')}\n</div>` : ''}
</section>`;
  }).join('\n');
}

/* ------------------------------------------------------------------ shared pieces */
function table(p, cls, opts = {}) {
  const rows = [];
  const grp = {};
  RES.forEach(([n, , st]) => st.forEach(([pl, q, s]) => (grp[pl] = grp[pl] || []).push({ n, q, s: `${s} SCU`, kind: 'Rohstoff', scrap: '–', res: n === 'Eisen' && q === 620 ? '10 · Kaelis' : '' })));
  ITEMS.forEach(([n, qty, pl, kind, scrap]) => (grp[pl] = grp[pl] || []).push({ n, q: null, s: qty, kind, scrap }));
  let i = 0;
  for (const [pl, , scu, cnt] of PLACES) {
    if (!grp[pl]) continue;
    rows.push(`<tr class="g"><td colspan="9">${pl}<small>${scu} SCU · ${cnt} Positionen</small></td></tr>`);
    for (const r of grp[pl]) {
      const sel = opts.sel && (r.n === 'Agricium' || r.n === 'Medpen (Hemozal)');
      rows.push(`<tr class="${sel ? 'sel' : ''}"><td><i class="d10-cb${sel ? ' on' : ''}"></i></td><td>${r.n}</td><td>${r.kind}</td><td>${r.q ? `<span class="q" style="--qc:${qcol(r.q)}">${r.q}</span>` : '–'}</td><td class="num">${r.s}</td><td>${r.res ? `<span class="res">${I.lock}${r.res}</span>` : ''}</td><td>${r.scrap === 'ja' ? `<span class="scr">${I.gear}ja</span>` : r.scrap === 'nein' ? '<span class="noscr">nein</span>' : '–'}</td><td>${pl === 'Cutlass „Rotfuchs“' || i % 3 === 0 ? 'App' : 'Hand'}</td><td class="act">${I.wish}${I.trash}</td></tr>`);
      i++;
    }
  }
  return `<div class="d10-tbl ${cls}"><table><thead><tr><th></th><th>Gegenstand</th><th>Art</th><th>Qualität</th><th class="num">Menge</th><th>Reserviert</th><th>Zerlegbar</th><th>Quelle</th><th></th></tr><tr class="flt"><th></th><th><i>Filter …</i></th><th><i>alle</i></th><th><i>≥ 0</i></th><th></th><th><i>alle</i></th><th><i>alle</i></th><th><i>alle</i></th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
${opts.sel ? `<div class="d10-bar"><b>2 gewählt</b><span>Agricium 4 SCU · Medpen ×12</span>${btn('Auf die Wunschliste', 'sec', I.wish)}${btn('Verkaufen', 'sec', I.coin)}${btn('Reservieren', 'sec', I.lock)}${btn('Löschen', 'sec warn', I.trash)}<a href="#" data-screen-link="${p}-s6">${btn('Abholen planen', '', I.route)}</a></div>` : ''}`;
}
function planDialog(p, cls, extra = '') {
  return `<div class="d10-scrim"></div><div class="d10-dlg ${cls}" role="dialog"><header><h3>Aus dem Bestand planen</h3><i>${I.x}</i></header>
<nav class="d10-seg"><span class="on">${I.route}Abholen</span><span>${I.coin}Verkaufen</span><span>${I.lock}Reservieren</span></nav>
<p class="lead"><b>Agricium</b> · 10 SCU aus 3 Orten · Route nach Menge</p>
${extra}
<ol class="d10-stops"><li><i class="d10-cb on"></i><b>Area18</b><span>4 SCU · Q 880</span><em>Start</em></li><li><i class="d10-cb on"></i><b>Lorville</b><span>3 SCU · Q 700</span><em>+ 1 Sprung</em></li><li><i class="d10-cb on"></i><b>Port Tressler</b><span>3 SCU · Q 560</span><em>+ 1 Sprung</em></li></ol>
<div class="d10-fields"><label>Nachschub<span>Agricium abholen</span></label><label>Ziel<span>Cutlass „Rotfuchs“ · 10 von 46 SCU frei</span></label><label>Slot<span>3 (frei)</span></label></div>
<footer>${btn('Abbrechen', 'sec')}${btn('Nachschub anlegen', '', I.nach)}</footer></div>`;
}

/* ================================================================== A: Frachtdeck */
function bayStrip(p, active) {
  return `<div class="d11-bays">${PLACES.map(([n, sys, scu, cnt]) => `<a class="d11-bay${n === active ? ' on' : ''}" href="#" data-screen-link="${p}-s2" style="flex:${Math.max(scu, 6)}"><b>${n}</b><small>${sys}</small><span>${scu} SCU · ${cnt}</span><i style="--f:${Math.round((scu / 46) * 100)}%"></i></a>`).join('')}</div>`;
}
function crate(name, scu, q, opts = {}) {
  const size = scu >= 16 ? 'xl' : scu >= 8 ? 'l' : scu >= 4 ? 'm' : 's';
  return `<${opts.link ? `a href="#" data-screen-link="${opts.link}"` : 'div'} class="d11-crate ${size}${opts.res ? ' res' : ''}"><i class="qs" style="--qc:${qcol(q)}"></i><b>${name}</b><span>${scu} SCU · Q ${q}</span>${opts.res ? `<em style="--rf:${opts.res}%">${I.lock}${opts.resTxt}</em>` : ''}${opts.place ? `<small>${opts.place}</small>` : ''}</${opts.link ? 'a' : 'div'}>`;
}
function box(name, qty, place, scrap) {
  return `<div class="d11-box"><b>${name}</b><span>${qty}</span><small>${place}</small>${scrap === 'ja' ? `<i class="scr" aria-label="zerlegbar">${I.gear}</i>` : ''}</div>`;
}
function protocol(inner) { return `<aside class="d11-log"><h4>Ladeprotokoll</h4>${inner}</aside>`; }
function d11() {
  const p = 'a';
  const lanesAll = `<div class="d11-deck">
<div class="d11-lane"><span class="lbl">${I.inv}Rohstoffe</span><div class="row">${crate('Eisen', 15, 940, { link: `${p}-s3`, res: 66, resTxt: '10 Kaelis', place: 'Area18' })}${crate('Eisen', 9, 410, { link: `${p}-s3`, place: 'Lorville' })}${crate('Agricium', 4, 880, { place: 'Area18' })}${crate('Agricium', 3, 700, { place: 'Lorville' })}${crate('Agricium', 3, 560, { place: 'Port Tressler' })}${crate('Quantanium', 6, 760, { place: 'Rotfuchs' })}${crate('Hadanit', 4, 990, { place: 'Lorville' })}</div></div>
<div class="d11-lane"><span class="lbl">${I.weapon}Waffen</span><div class="row">${ITEMS.filter((x) => x[3] === 'Waffe').map((x) => box(x[0], x[1], x[2], x[4])).join('')}</div></div>
<div class="d11-lane"><span class="lbl">${I.item}Rüstung · Sonstiges</span><div class="row">${ITEMS.filter((x) => x[3] !== 'Waffe').map((x) => box(x[0], x[1], x[2], x[4])).join('')}</div></div>
</div>`;
  const used = `<div class="d11-used"><small>Kürzlich aufgebraucht · 7 Tage</small><p>4 Medpen · 2 Lumin-Magazine · 1 Pembroke-Helm</p>${btn('Nachbestellen …', 'sec sm', I.wish)}</div>`;
  const s1 = chrome(p, `${head(p, 'd11', 'Inventar', 'over')}${filters('Inventar')}${bayStrip(p, null)}<div class="d11-split">${lanesAll}${protocol(`<p class="mut">Wähle Container oder Kisten. Dann kannst du sie abholen, verkaufen, reservieren oder auf die Wunschliste legen.</p><dl><dt>Gesamt</dt><dd>124 SCU · 38 Positionen</dd><dt>Reserviert</dt><dd>10 SCU Eisen · Kaelis</dd><dt>Zerlegbar</dt><dd>4 Gegenstände</dd></dl>${used}`)}</div>`, { cls: 'd11-app' });
  const area18 = `<div class="d11-deck one"><div class="d11-lane"><span class="lbl">${I.inv}Rohstoffe</span><div class="row">${crate('Eisen', 15, 940, { link: `${p}-s3`, res: 66, resTxt: '10 Kaelis' })}${crate('Agricium', 4, 880)}</div></div>
<div class="d11-lane"><span class="lbl">${I.weapon}Waffen</span><div class="row">${box('P4-AR Sturmgewehr', '×2', 'Regal 2', 'ja')}${box('Arclight-Laserpistole', '×1', 'Regal 2', 'ja')}</div></div>
<div class="d11-lane"><span class="lbl">${I.item}Sonstiges</span><div class="row">${box('Multitool', '×1', 'Regal 1', 'ja')}</div></div></div>`;
  const s2 = chrome(p, `${head(p, 'd11', 'Inventar', 'over')}${filters('Inventar', { place: 'Area18' })}${bayStrip(p, 'Area18')}<div class="d11-split">${area18}${protocol(`<h5>Area18 · ArcCorp</h5><dl><dt>Belegt</dt><dd>46 SCU · 14 Positionen</dd><dt>Zuletzt gelesen</dt><dd>vor 2 Std. von der App</dd><dt>Frei verfügbar</dt><dd>36 SCU</dd></dl><p class="mut">Sortiert nach Menge. Größere Container stehen vorne.</p>${btn('Alles hier abholen …', 'sec sm', I.route)}`)}</div>`, { cls: 'd11-app' });
  const bands = [[400, 9, 0], [600, 6, 0], [800, 5, 0], [900, 4, 0]];
  const spec = `<div class="d11-spec"><div class="ax"><span>0</span><span>250</span><span>500</span><span>750</span><span>1000</span></div><div class="plot"><i class="thr" style="--x:70%"><b>Crafting-Schwelle 700</b></i>
<span class="bar" style="--x:41%;--h:90%;--c:#5c6f80" title=""><b>9</b><small>Lorville</small></span>
<span class="bar res" style="--x:62%;--h:60%;--c:#4d8bb0"><b>6</b><small>Area18</small><em>10 reserviert</em></span>
<span class="bar" style="--x:81%;--h:50%;--c:#52c1e6"><b>5</b><small>Area18</small></span>
<span class="bar" style="--x:94%;--h:40%;--c:#8ff0ff"><b>4</b><small>Area18</small></span></div></div>`;
  void bands;
  const s3 = chrome(p, `${head(p, 'd11', 'Inventar', 'over')}${filters('Inventar', { cat: 'Rohstoffe' })}<div class="d11-split"><div class="d11-res"><header><span class="d10-ti sm">${I.inv}</span><div><h3>Eisen</h3><small>24 SCU an 2 Orten · 4 Qualitäten</small></div>${btn('Auf die Wunschliste', 'sec sm', I.wish)}</header>${spec}
<div class="d11-stacks"><div><b>Q 940</b><span>4 SCU · Area18</span></div><div><b>Q 810</b><span>5 SCU · Area18</span></div><div class="res"><b>Q 620</b><span>6 SCU · Area18</span><em>${I.lock}4 von 6 für Kaelis</em></div><div><b>Q 410</b><span>9 SCU · Lorville</span><em class="w">unter 500: schwächer als Ladenware</em></div></div></div>
${protocol(`<h5>Reservierung</h5><div class="d11-resv"><span class="d10-av sm">K</span><div><b>Kaelis</b><small>Freund · 10 SCU Eisen · Area18</small></div></div><p class="mut">Aus Q 620 (6) und Q 810 (4). Kaelis sieht die Reservierung bei sich.</p>${btn('Menge ändern', 'sec sm')}${btn('Übergeben', 'sec sm')}${btn('Freigeben', 'sec sm')}`)}</div>`, { cls: 'd11-app' });
  const s4 = chrome(p, `${head(p, 'd11', 'Inventar', 'table')}${filters('Inventar')}<h3 class="d11-bol">Frachtbrief · alle Orte</h3>${table(p, 'd11-t', { sel: true })}`, { cls: 'd11-app' });
  const s5 = chrome(p, `${head(p, 'd11', 'Inventar', 'over')}${filters('Inventar', { place: 'Lorville', cat: 'Rohstoffe' })}${bayStrip(p, 'Lorville')}<div class="d11-split"><div class="d11-ghost"><div class="gc">${I.inv}<b>Kein Eisen ab Q 700 in Lorville</b></div>
<a class="alt" href="#" data-screen-link="${p}-s3">${I.inv}<span><b>In Area18 liegen 9 SCU ab Q 810</b><small>5 frei, 4 für Kaelis reserviert</small></span>${btn('Abholen planen', 'sec sm', I.route)}</a>
<div class="alt">${I.wish}<span><b>Eisen Q ≥ 700 auf die Wunschliste</b><small>und gleich in Nachschub „Gladius aufrüsten“ (Slot 1)</small></span>${btn('Wünschen und einplanen', 'sec sm', I.nach)}</div>
<div class="alt">${I.bp}<span><b>Selbst herstellen?</b><small>Eisen kommt aus Bergbau. Hadanit Q 990 in Lorville passt für dieselbe Blaupause.</small></span></div></div>
${protocol('<p class="mut">Gefiltert: Lorville, Rohstoffe, Suche „eisen q&gt;700“.</p>')}</div>`, { cls: 'd11-app', typed: 'eisen q&gt;700', scope: 'Inventar' });
  const s6 = chrome(p, `${head(p, 'd11', 'Inventar', 'table')}${filters('Inventar')}<h3 class="d11-bol">Frachtbrief · alle Orte</h3>${table(p, 'd11-t', { sel: true })}`, { cls: 'd11-app', overlay: planDialog(p, 'd11-dlg') });
  const pads = SHIPS.map(([n, nick, o, pl]) => `<div class="d11-pad"><span class="ring"></span><span class="hull">${I.hull}</span><b>${n}${nick ? ` ${nick}` : ''}</b><small>${pl}</small><em class="o ${o === 'Pledge' ? 'pl' : o === 'Leihschiff' ? 'ln' : ''}">${o}</em></div>`).join('') + `<div class="d11-pad add"><span class="ring"></span>${I.plus}<b>Schiff anlegen</b></div>`;
  const s7 = chrome(p, `${head(p, 'd11', 'Hangar')}${filters('Hangar')}<div class="d11-pads">${pads}</div>`, { cls: 'd11-app', scope: 'Hangar' });
  const lockers = BPS.map(([n, k]) => `<div class="d11-locker"><i class="hd"></i><b>${n}</b><small>${k}</small><span>${k === 'Blaupause' ? I.bp : k === 'News' ? I.sam : I.gallery}</span></div>`).join('') + `<div class="d11-locker add"><i class="hd"></i>${I.plus}<b>Blaupause anlegen</b></div>`;
  const s8 = chrome(p, `${head(p, 'd11', 'Sammlung')}${filters('Sammlung')}<div class="d11-lockers">${lockers}</div><div class="d10-ruf"><span class="ring"></span><span><b>Ruf · noch keine Datenquelle</b><small>Die App kann deinen Ruf später mitlesen.</small></span></div>`, { cls: 'd11-app', scope: 'Sammlung' });
  return screens(p, [s1, s2, s3, s4, s5, s6, s7, s8], {
    'a-s1': [
      anno('a-1', 1, 'bottom', '.d11-bays', 40, 27, 'Jeder Ort ist eine Ladebucht. Die Breite folgt der gelagerten Menge, sortiert von groß nach klein. Ein Klick filtert das Deck auf diesen Ort. Beantwortet das „Was habe ich in Area18?“ schnell genug?'),
      anno('a-2', 2, 'right', '.d11-lane', 30, 48, 'Rohstoffe sind Container in echter SCU-Größe (1 bis 32), mit einem Streifen in der Farbe ihrer Qualität. Waffen und Kleinteile sind Kisten. Ist die Containergröße als Mengenmaß verständlich?'),
      anno('a-3', 3, 'left', '.d11-log', 88, 40, 'Rechts steht das Ladeprotokoll: Summen, Reservierungen, Zerlegbares und „Kürzlich aufgebraucht“ (7 statt 48 Stunden) mit „Nachbestellen …“ für alles, nicht nur das letzte. Gehört das hierhin oder in eine eigene Ansicht?'),
      anno('a-4', 4, 'bottom', '.d10-filters', 30, 20, 'Filter sind immer vollständig: „Alle“ ohne Zahl, leere Arten gedimmt mit 0, alle Orte im Auswahlfeld, dazu die Schalter Reserviert und Zerlegbar. So deterministisch, wie du es wolltest?'),
    ],
    'a-s3': [
      anno('a-5', 5, 'bottom', '.d11-spec', 36, 46, 'Eisen als Spektrum: Qualität von 0 bis 1000 nach rechts, Menge nach oben, Farbe nach Qualität, eine Linie bei 700 als Crafting-Schwelle. Die reservierte Menge ist schraffiert. Liest sich das?'),
    ],
    'a-s4': [
      anno('a-6', 6, 'top', '.d10-bar', 50, 86, 'Die Tabelle ist der Frachtbrief: gruppiert nach Ort, mit Qualität, Reserviert, Zerlegbar, Quelle (App oder Hand) und Löschen pro Zeile. Mehrfachauswahl öffnet unten die Aktionsleiste. Fehlt dir eine Spalte?'),
    ],
    'a-s6': [
      anno('a-7', 7, 'right', '.d10-dlg', 36, 40, 'Aus der Auswahl wird ein Nachschub: Abholen sammelt Agricium aus drei Orten in eine Route, sortiert nach Menge, mit Ziel und freiem Slot. Verkaufen und Reservieren sind die beiden anderen Reiter desselben Dialogs. Passt der eine Dialog für alle drei?'),
    ],
  });
}

/* ================================================================== B: Sternkarte */
const NODES = { // x%, y%, size by SCU, planet
  'Area18': [64, 34, 46, 'ArcCorp'], 'Lorville': [28, 58, 32, 'Hurston'], 'Everus Harbor': [33, 52, 4, 'Hurston'], 'Port Tressler': [77, 72, 12, 'microTech'],
  'Seraphim Station': [46, 22, 8, 'Crusader'], 'Cutlass „Rotfuchs“': [55, 62, 10, 'unterwegs'],
};
function map(p, opts = {}) {
  const nodes = Object.entries(NODES).map(([n, [x, y, s, pl]]) => {
    const sz = 18 + s * 0.9;
    const glow = opts.glow && opts.glow.includes(n) ? ' glow' : '';
    const on = opts.on === n ? ' on' : '';
    const dim = (opts.glow && !opts.glow.includes(n)) || (opts.zoom && opts.on !== n) ? ' dim' : '';
    const label = opts.labels && opts.labels[n] ? `<em>${opts.labels[n]}</em>` : '';
    return `<a class="d12-node${glow}${on}${dim}" href="#" data-screen-link="${p}-s2" style="--x:${x}%;--y:${y}%;--s:${sz}px"><i></i><b>${n}</b><small>${pl} · ${s} SCU</small>${label}</a>`;
  }).join('');
  const route = opts.route ? `<svg class="d12-route" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M64 34 L28 58 L77 72"/></svg><span class="d12-step" style="--x:64%;--y:34%">1</span><span class="d12-step" style="--x:28%;--y:58%">2</span><span class="d12-step" style="--x:77%;--y:72%">3</span>` : '';
  const ships = opts.ships ? SHIPS.map(([n, , , pl], i) => { const [x, y] = NODES[pl] || [50, 50]; return `<span class="d12-ship" style="--x:${x + 4 + i}%;--y:${y - 6 + i * 2}%">${I.hangar}<b>${n}</b></span>`; }).join('') : '';
  return `<div class="d12-map${opts.zoom ? ' zoom' : ''}"><div class="sys"><span class="sun"></span><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span><span class="orb o4"></span>

${route}${nodes}${ships}</div><nav class="d12-sw"><span class="on">Stanton</span><span>Pyro</span><span>Nyx</span></nav><span class="d12-legend"><i class="c1"></i>Rohstoffe<i class="c2"></i>Waffen<i class="c3"></i>Rüstung<i class="c4"></i>Sonstiges</span></div>`;
}
function rank(p, focus) {
  return `<aside class="d12-rank"><label class="d12-find">${I.search}<span>Ort suchen …</span></label><ol>${PLACES.map(([n, sys, scu, cnt]) => `<li class="${n === focus ? 'on' : ''}"><a href="#" data-screen-link="${p}-s2"><b>${n}</b><small>${sys} · ${cnt} Positionen</small><span class="mb"><i style="width:${Math.round((scu / 46) * 100)}%"></i></span><em>${scu} SCU</em></a></li>`).join('')}</ol></aside>`;
}
function d12() {
  const p = 'b';
  const s1 = chrome(p, `${head(p, 'd12', 'Inventar', 'over')}${filters('Inventar')}<div class="d12-split">${map(p)}${rank(p)}</div>`, { cls: 'd12-app' });
  const content = `<aside class="d12-rank"><header class="d12-ph"><b>Area18</b><small>ArcCorp · 46 SCU · 14 Positionen · vor 2 Std. gelesen</small></header><ul class="d12-list">
<li><a href="#" data-screen-link="${p}-s3"><i class="q" style="--qc:#8ff0ff"></i><b>Eisen</b><span>15 SCU · Q 620–940</span><em>${I.lock}10</em></a></li><li><i class="q" style="--qc:#52c1e6"></i><b>Agricium</b><span>4 SCU · Q 880</span></li>
<li>${I.weapon}<b>P4-AR Sturmgewehr</b><span>×2</span><em class="scr">${I.gear}</em></li><li>${I.weapon}<b>Arclight-Laserpistole</b><span>×1</span><em class="scr">${I.gear}</em></li><li>${I.item}<b>Multitool</b><span>×1</span><em class="scr">${I.gear}</em></li></ul>${btn('Alles hier abholen …', 'sec sm', I.route)}</aside>`;
  const s2 = chrome(p, `${head(p, 'd12', 'Inventar', 'over')}${filters('Inventar', { place: 'Area18' })}<div class="d12-split">${map(p, { on: 'Area18', zoom: true })}${content}</div>`, { cls: 'd12-app' });
  const radial = `<aside class="d12-rank"><header class="d12-ph"><b>Eisen</b><small>24 SCU an 2 Orten</small></header><div class="d12-ring"><span style="--a:0deg;--b:60deg;--c:#8ff0ff"></span><span style="--a:60deg;--b:135deg;--c:#52c1e6"></span><span style="--a:135deg;--b:225deg;--c:#4d8bb0"></span><span style="--a:225deg;--b:360deg;--c:#5c6f80"></span><b>24<small>SCU</small></b></div>
<ul class="d12-qlist"><li><i style="--qc:#8ff0ff"></i>Q 940<span>4 · Area18</span></li><li><i style="--qc:#52c1e6"></i>Q 810<span>5 · Area18</span></li><li class="res"><i style="--qc:#4d8bb0"></i>Q 620<span>6 · Area18 · ${I.lock} 10 für Kaelis (mit Q 810)</span></li><li><i style="--qc:#5c6f80"></i>Q 410<span>9 · Lorville · unter 500</span></li></ul>${btn('Reservierung bearbeiten', 'sec sm', I.lock)}</aside>`;
  const s3 = chrome(p, `${head(p, 'd12', 'Inventar', 'over')}${filters('Inventar', { cat: 'Rohstoffe' })}<div class="d12-split">${map(p, { glow: ['Area18', 'Lorville'], labels: { Area18: 'Eisen 15', Lorville: 'Eisen 9' } })}${radial}</div>`, { cls: 'd12-app' });
  const s4 = chrome(p, `${head(p, 'd12', 'Inventar', 'table')}${filters('Inventar')}<div class="d12-band">${PLACES.map(([n, , scu]) => `<span style="flex:${Math.max(scu, 5)}"><b>${n}</b>${scu}</span>`).join('')}</div>${table(p, 'd12-t', { sel: true })}`, { cls: 'd12-app' });
  const s5 = chrome(p, `${head(p, 'd12', 'Inventar', 'over')}${filters('Inventar', { place: 'Lorville', cat: 'Rohstoffe' })}<div class="d12-split">${map(p, { glow: ['Area18'], on: 'Lorville', labels: { Area18: '9 SCU Eisen ab Q 810', Lorville: 'kein Eisen ab Q 700' } })}<aside class="d12-rank"><header class="d12-ph"><b>Kein Treffer in Lorville</b><small>Die Karte zeigt, wo es stattdessen liegt.</small></header>
<div class="d12-alt">${I.inv}<span><b>Area18 · 9 SCU ab Q 810</b><small>5 frei · 1 Sprung</small></span></div><div class="d12-alt">${I.wish}<span><b>Auf die Wunschliste</b><small>und in „Gladius aufrüsten“ einplanen</small></span></div><div class="d12-alt">${I.bp}<span><b>Hadanit Q 990 passt auch</b><small>für dieselbe Blaupause</small></span></div></aside></div>`, { cls: 'd12-app', typed: 'eisen q&gt;700' });
  const s6 = chrome(p, `${head(p, 'd12', 'Inventar', 'over')}${filters('Inventar', { cat: 'Rohstoffe' })}<div class="d12-split">${map(p, { route: true, glow: ['Area18', 'Lorville', 'Port Tressler'], labels: { Area18: 'Agricium 4', Lorville: 'Agricium 3', 'Port Tressler': 'Agricium 3' } })}<aside class="d12-rank"><header class="d12-ph"><b>Abholroute</b><small>Agricium · 10 SCU aus 3 Orten</small></header><ol class="d10-stops"><li><b>Area18</b><span>4 SCU · Q 880</span></li><li><b>Lorville</b><span>3 SCU · Q 700</span></li><li><b>Port Tressler</b><span>3 SCU · Q 560</span></li></ol><div class="d10-fields"><label>Nachschub<span>Agricium abholen</span></label><label>Slot<span>3 (frei)</span></label></div><nav class="d10-seg sm"><span class="on">Abholen</span><span>Verkaufen</span><span>Reservieren</span></nav>${btn('Nachschub anlegen', '', I.nach)}</aside></div>`, { cls: 'd12-app' });
  const s7 = chrome(p, `${head(p, 'd12', 'Hangar')}${filters('Hangar')}<div class="d12-split">${map(p, { ships: true })}<aside class="d12-rank"><ul class="d12-list">${SHIPS.map(([n, nick, o, pl]) => `<li>${I.hangar}<b>${n} ${nick}</b><span>${pl}</span><em>${o}</em></li>`).join('')}</ul></aside></div>`, { cls: 'd12-app', scope: 'Hangar' });
  const s8 = chrome(p, `${head(p, 'd12', 'Sammlung')}${filters('Sammlung')}<div class="d12-shelf">${BPS.map(([n, k]) => `<div class="d12-book"><span>${k === 'Blaupause' ? I.bp : k === 'News' ? I.sam : I.gallery}</span><b>${n}</b><small>${k}</small></div>`).join('')}</div><div class="d10-ruf"><span class="ring"></span><span><b>Ruf · noch keine Datenquelle</b><small>Die App kann deinen Ruf später mitlesen.</small></span></div>`, { cls: 'd12-app', scope: 'Sammlung' });
  return screens(p, [s1, s2, s3, s4, s5, s6, s7, s8], {
    'b-s1': [
      anno('b-1', 1, 'right', '.d12-map', 40, 50, 'Dein Lager als Holo-Karte des Systems: jeder Ort ein Knoten auf seinem Planeten, die Größe nach Menge, der Ring zeigt den Anteil Rohstoffe, Waffen, Rüstung, Sonstiges. Stanton, Pyro und Nyx umschaltbar. Zu viel Bühne für 5 bis 15 Orte?'),
      anno('b-2', 2, 'left', '.d12-rank', 88, 40, 'Neben der Karte die Rangliste aller Orte nach Menge, mit Ortssuche. Ein Klick zoomt die Karte auf den Ort. Reicht die Liste als schneller Weg, oder soll sie die Hauptansicht sein?'),
    ],
    'b-s3': [
      anno('b-3', 3, 'left', '.d12-ring', 86, 32, 'Qualität als Ring statt Balken: jedes Segment eine Qualitätsstufe, die Mitte zeigt die Summe. Auf der Karte leuchten die Orte mit Eisen. Ring oder lieber Balken?'),
    ],
    'b-s6': [
      anno('b-4', 4, 'right', '.d12-route', 46, 50, 'Abholen zeichnet die Route über die Karte, Stationen nummeriert in der Reihenfolge nach Menge. Das ist die Stärke dieser Richtung. Soll die Route auch nach Entfernung sortieren können?'),
    ],
    'b-s8': [
      anno('b-5', 5, 'bottom', '.d12-shelf', 40, 40, 'Die Sammlung hat keinen Ort und bricht deshalb die Karte: sie wird ein Regal. Stört dich der Bruch?'),
    ],
  });
}

/* ================================================================== C: Scanner */
function specRow(name, total, stacks, opts = {}) {
  const bins = new Array(20).fill(0);
  stacks.forEach(([, q, s]) => { bins[Math.min(19, Math.floor(q / 50))] += s; });
  const max = 9;
  return `<a class="d13-row${opts.on ? ' on' : ''}" href="#" data-screen-link="${opts.link || ''}"><span class="nm"><b>${name}</b><small>${total} SCU</small></span><span class="sp">${bins.map((v, i) => `<i style="--h:${Math.round((v / max) * 100)}%;--qc:${qcol(i * 50 + 25)}"></i>`).join('')}<u style="--x:70%"></u>${opts.res ? `<em class="br" style="--a:60%;--b:85%">10 → Kaelis</em>` : ''}</span><span class="pl">${[...new Set(stacks.map((s) => s[0]))].join(' · ')}</span></a>`;
}
function receipts() {
  return `<div class="d13-recs">${ITEMS.map(([n, q, pl, k, s]) => `<div class="d13-rec"><small>${k.toUpperCase()}</small><b>${n}</b><span>${q} · ${pl}</span><em class="${s === 'ja' ? 'ok' : 'no'}">${s === 'ja' ? 'ZERLEGBAR' : 'NICHT ZERLEGBAR'}</em></div>`).join('')}</div>`;
}
function term(lines) { return `<aside class="d13-term"><h4>Terminal</h4>${lines.map((l) => `<p>${l}</p>`).join('')}</aside>`; }
function scanBar(tokens, cmd = '') {
  return `<div class="d13-scan">${I.search}${tokens.map((t) => `<span class="tok">${t}<i>${I.x}</i></span>`).join('')}<span class="cmd">${cmd}<i class="d10-caret"></i></span><small>ort: · qual&gt; · art: · reserviert · zerlegbar</small></div>`;
}
const LOG = ['<b>21:14</b> Inventar Area18 gelesen · 14 Positionen', '<b>20:52</b> 4 Medpen aufgebraucht', '<b>gestern</b> 10 SCU Eisen für Kaelis reserviert', '<b>gestern</b> Nachschub „Gladius aufrüsten“ 5 von 6'];
function d13() {
  const p = 'c';
  const board = (opts = {}) => `<div class="d13-board"><div class="d13-axis"><span></span><span class="sc"><i style="--x:0%">0</i><i style="--x:50%">500</i><i style="--x:70%">700</i><i style="--x:100%">1000</i></span><span></span></div>${RES.filter((r) => !opts.only || opts.only.includes(r[0])).map(([n, t, st]) => specRow(n, opts.place ? st.filter((s) => s[0] === opts.place).reduce((a, s) => a + s[2], 0) : t, opts.place ? st.filter((s) => s[0] === opts.place) : st, { link: `${p}-s3`, res: n === 'Eisen' && opts.res })).join('')}</div>`;
  const s1 = chrome(p, `${head(p, 'd13', 'Inventar', 'over')}${scanBar([])}<div class="d13-split"><div>${board({ res: true })}${receipts()}</div>${term(LOG)}</div>`, { cls: 'd13-app' });
  const s2 = chrome(p, `${head(p, 'd13', 'Inventar', 'over')}${scanBar(['ort:area18'])}<div class="d13-facets">${PLACES.map(([n, , scu]) => `<span class="${n === 'Area18' ? 'on' : ''}">${n}<b>${scu}</b></span>`).join('')}</div><div class="d13-split"><div>${board({ place: 'Area18', only: ['Eisen', 'Agricium'], res: true })}<div class="d13-recs">${ITEMS.filter((x) => x[2] === 'Area18').map(([n, q, pl, k, s]) => `<div class="d13-rec"><small>${k.toUpperCase()}</small><b>${n}</b><span>${q} · ${pl}</span><em class="${s === 'ja' ? 'ok' : 'no'}">${s === 'ja' ? 'ZERLEGBAR' : 'NICHT ZERLEGBAR'}</em></div>`).join('')}</div></div>${term(['&gt; ort:area18', '46 SCU · 14 Positionen · vor 2 Std. gelesen', 'Meiste Menge: Eisen 15 SCU'])}</div>`, { cls: 'd13-app' });
  const big = `<div class="d13-big"><header><b>Eisen</b><small>24 SCU · 4 Qualitäten · 2 Orte</small>${btn('Auf die Wunschliste', 'sec sm', I.wish)}</header><div class="sp">${[[410, 9, 'Lorville'], [620, 6, 'Area18'], [810, 5, 'Area18'], [940, 4, 'Area18']].map(([q, s, pl]) => `<span style="--x:${q / 10}%;--h:${s * 10}%;--qc:${qcol(q)}"><b>${s}</b><small>Q ${q}<br>${pl}</small></span>`).join('')}<u style="--x:70%"><b>700</b></u><em class="br" style="--a:58%;--b:85%">${I.lock} 10 SCU → Kaelis</em></div></div>`;
  const s3 = chrome(p, `${head(p, 'd13', 'Inventar', 'over')}${scanBar(['art:rohstoff'], 'eisen')}<div class="d13-split">${big}${term(['&gt; eisen', '4 Stapel · Q 410 bis 940', 'Reserviert: 10 SCU für Kaelis (Q 620, Q 810)', '&gt; reserviere 10 eisen kaelis <i>bearbeiten</i>'])}</div>`, { cls: 'd13-app' });
  const s4 = chrome(p, `${head(p, 'd13', 'Inventar', 'table')}${scanBar([])}${table(p, 'd13-t', { sel: true })}`, { cls: 'd13-app' });
  const s5 = chrome(p, `${head(p, 'd13', 'Inventar', 'over')}${scanBar(['ort:lorville', 'qual&gt;700'], 'eisen')}<div class="d13-split"><div class="d13-none"><p class="t">&gt; eisen ort:lorville qual&gt;700 → <b>0 Treffer</b></p>
<a class="d13-alt" href="#" data-screen-link="${p}-s3"><b>1</b><span>ohne <code>ort:lorville</code>: 9 SCU in Area18 (Q 810, Q 940), 5 frei</span></a><div class="d13-alt"><b>2</b><span><code>wünsche eisen q≥700 → Gladius aufrüsten</code></span></div><div class="d13-alt"><b>3</b><span>gleiche Blaupause: Hadanit Q 990, 4 SCU in Lorville</span></div><small>Taste 1 bis 3 wählt</small></div>${term(LOG.slice(0, 2))}</div>`, { cls: 'd13-app', typed: 'eisen' });
  const s6 = chrome(p, `${head(p, 'd13', 'Inventar', 'over')}${scanBar([], 'abholen agricium 10')}<div class="d13-split"><div class="d13-plan"><p class="t">&gt; abholen agricium 10 → Plan</p><ol class="d10-stops"><li><b>Area18</b><span>4 SCU · Q 880</span><em>Start</em></li><li><b>Lorville</b><span>3 SCU · Q 700</span><em>+ 1 Sprung</em></li><li><b>Port Tressler</b><span>3 SCU · Q 560</span><em>+ 1 Sprung</em></li></ol><div class="d10-fields"><label>Nachschub<span>Agricium abholen</span></label><label>Slot<span>3 (frei)</span></label></div><p class="hint">auch: <code>verkaufe medpen 12</code> · <code>reserviere 10 eisen kaelis</code></p>${btn('Nachschub anlegen', '', I.nach)}</div>${term(LOG)}</div>`, { cls: 'd13-app' });
  const s7 = chrome(p, `${head(p, 'd13', 'Hangar')}${filters('Hangar')}<div class="d13-recs ships">${SHIPS.map(([n, nick, o, pl]) => `<div class="d13-rec"><small>${o.toUpperCase()}</small><span class="h">${I.hull}</span><b>${n} ${nick}</b><span>${pl}</span></div>`).join('')}</div>`, { cls: 'd13-app', scope: 'Hangar' });
  const s8 = chrome(p, `${head(p, 'd13', 'Sammlung')}${filters('Sammlung')}<div class="d13-archive">${BPS.map(([n, k], i) => `<p><b>${['08.11.', '05.11.', '02.11.', '28.10.', '21.10.'][i]}</b><span>${k.toUpperCase()}</span>${n}</p>`).join('')}</div><div class="d10-ruf"><span class="ring"></span><span><b>Ruf · noch keine Datenquelle</b><small>Die App kann deinen Ruf später mitlesen.</small></span></div>`, { cls: 'd13-app', scope: 'Sammlung' });
  return screens(p, [s1, s2, s3, s4, s5, s6, s7, s8], {
    'c-s1': [
      anno('c-1', 1, 'bottom', '.d13-scan', 30, 25, 'Statt Chips eine Scan-Zeile mit Kürzeln: ort:, qual&gt;, art:, reserviert, zerlegbar. Gesetzte Kürzel stehen als entfernbare Marken davor. Schnell für dich, oder zu technisch für andere Spieler?'),
      anno('c-2', 2, 'right', '.d13-board', 30, 42, 'Jeder Rohstoff ist eine Zeile mit seinem Spektrum über die Qualität 0 bis 1000, die Linie bei 700 ist die Crafting-Schwelle. Gegenstände stehen darunter als Ausgabe-Belege mit Stempel „ZERLEGBAR“. Liest du die Spektren auf einen Blick?'),
      anno('c-3', 3, 'left', '.d13-term', 88, 40, 'Rechts läuft das Terminal-Log: was die App gelesen hat, was aufgebraucht wurde, was reserviert ist. Nützlich, oder Platz für etwas anderes?'),
    ],
    'c-s5': [
      anno('c-4', 4, 'right', '.d13-none', 36, 40, 'Kein Treffer antwortet das Terminal mit nummerierten Auswegen: Filter lockern, wünschen und einplanen, Ersatz aus derselben Blaupause. Tasten 1 bis 3 wählen. Gefällt dir die Antwort als Text?'),
    ],
    'c-s6': [
      anno('c-5', 5, 'right', '.d13-plan', 36, 40, 'Planen geht per Befehl: „abholen agricium 10“ baut die Route, „verkaufe medpen 12“ einen Verkaufs-Nachschub, „reserviere 10 eisen kaelis“ eine Reservierung. Jede Aktion gibt es auch als Knopf in der Tabelle.'),
    ],
  });
}

/* ------------------------------------------------------------------ CSS */
const css = `<style>
.d10-app { --a:#52c1e6; --fg:#e8ebed; --fg2:#9fb3c8; --fg3:#6f8aa0; --line:rgba(159,179,200,.22); --ok:#5fd698; --warn:#f0c27b; --card:rgba(10,24,36,.85); --bg1:#0b1a26;
  position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:760px; box-sizing:border-box; overflow:hidden; color:var(--fg);
  font:13px/1.4 Inter, system-ui, "Segoe UI", sans-serif; text-align:left; background:radial-gradient(ellipse 130% 95% at 58% 0%, #0d1d2a 0%, #07121b 42%, #03080e 100%); }
.d10-app *, .d10-app *::before, .d10-app *::after { box-sizing:border-box; }
.d10-app svg { width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.d10-app a { color:inherit; text-decoration:none; }
.d10-mh { display:flex; align-items:center; gap:28px; flex:none; height:48px; padding:0 100px 0 20px; border-bottom:1px solid var(--line); }
.d10-brand { display:flex; align-items:center; gap:8px; font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.1em; white-space:nowrap; }
.d10-logo { width:14px; height:14px; border:1.6px solid var(--a); transform:rotate(45deg); border-radius:3px; }
.d10-nav { display:flex; gap:22px; font:12px/1 Orbitron, system-ui, sans-serif; letter-spacing:.18em; color:var(--fg2); }
.d10-nav .on { color:var(--fg); border-bottom:2px solid var(--a); padding-bottom:6px; }
.d10-right { margin-left:auto; }
.d10-av { display:inline-grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#16324a; color:var(--fg); font-size:11px; }
.d10-av.sm { width:30px; height:30px; flex:none; background:#2a3f6a; }
.d10-sub { display:flex; align-items:center; gap:18px; flex:none; height:44px; padding:0 100px 0 20px; border-bottom:1px solid var(--line); }
.d10-pages { display:flex; gap:4px; }
.d10-pg { padding:6px 12px; border-radius:999px; color:var(--fg3); font-size:12px; }
.d10-pg.on { color:var(--fg); background:rgba(82,193,230,.12); }
.d10-search { display:flex; align-items:center; gap:8px; margin-left:auto; width:420px; height:32px; padding:0 12px; border:1px solid var(--line); border-radius:999px; background:rgba(3,10,16,.7); color:var(--fg3); }
.d10-search.open { border-color:var(--a); box-shadow:0 0 0 1px var(--a); color:var(--fg); }
.d10-scope { display:inline-flex; align-items:center; gap:4px; padding:2px 6px 2px 9px; border-radius:999px; background:rgba(82,193,230,.16); color:var(--fg); font-size:11px; }
.d10-scope svg { width:11px; height:11px; }
.d10-typed { color:var(--fg); } .d10-caret { display:inline-block; width:1px; height:14px; margin-left:2px; background:var(--a); vertical-align:middle; }
.d10-body { position:relative; display:flex; flex:1; min-height:0; }
.d10-rail { position:absolute; left:0; top:0; bottom:0; display:flex; flex-direction:column; align-items:center; gap:6px; width:44px; padding:18px 0; border-right:1px solid var(--line); color:var(--fg3); }
.d10-rail > * { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; }
.d10-rail .on { color:var(--a); background:rgba(82,193,230,.12); }
.d10-frame { position:relative; display:flex; flex-direction:column; gap:12px; width:100%; max-width:1280px; min-height:0; margin:0 auto; padding:18px 28px 64px; }
.d10-head { display:flex; align-items:center; gap:14px; flex:none; }
.d10-ti { display:grid; place-items:center; width:38px; height:38px; flex:none; border-radius:11px; background:rgba(82,193,230,.12); color:var(--a); }
.d10-ti svg { width:22px; height:22px; } .d10-ti.sm { width:32px; height:32px; }
.d10-head small { color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; }
.d10-head h2 { margin:3px 0 0; font:600 22px/1.1 Orbitron, system-ui, sans-serif; letter-spacing:.03em; }
.d10-tabs { display:inline-flex; margin-left:14px; padding:3px; border:1px solid var(--line); border-radius:999px; background:rgba(3,10,16,.6); }
.d10-tabs a { display:inline-flex; align-items:center; gap:7px; height:32px; padding:0 14px; border-radius:999px; color:var(--fg2); }
.d10-tabs small { color:var(--fg3); font-size:11px; }
.d10-tabs a.on { color:var(--fg); background:rgba(82,193,230,.2); box-shadow:0 0 0 1px var(--a); } .d10-tabs a.on svg { color:var(--a); }
.d10-mode { display:inline-flex; margin-left:auto; padding:3px; border:1px solid var(--line); border-radius:10px; }
.d10-mode a { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px; border-radius:7px; color:var(--fg3); font-size:12px; }
.d10-mode a.on { color:var(--fg); background:rgba(82,193,230,.16); }
.d10-menu { display:grid; place-items:center; width:30px; height:30px; color:var(--fg3); }
.d10-head .d10-menu:only-of-type { margin-left:auto; }
.d10-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; flex:none; }
.d10-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 12px; border:1px solid var(--line); border-radius:999px; color:var(--fg2); font-size:12px; }
.d10-chip b { color:var(--fg3); font-weight:500; } .d10-chip.zero { opacity:.45; }
.d10-chip.on { color:var(--fg); border-color:var(--a); background:rgba(82,193,230,.14); } .d10-chip svg { width:11px; height:11px; }
.d10-sep { width:1px; height:20px; background:var(--line); }
.d10-sel { display:inline-flex; align-items:center; gap:18px; height:30px; padding:0 12px; border:1px solid var(--line); border-radius:8px; color:var(--fg); font-size:12px; margin-left:6px; } .d10-sel i { color:var(--fg3); font-style:normal; }
.d10-tog { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:8px; color:var(--fg3); font-size:12px; } .d10-tog svg { width:14px; height:14px; } .d10-tog.on { color:var(--a); }
.d10-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:999px; background:var(--a); color:#04121b; font-weight:600; font-size:12px; white-space:nowrap; }
.d10-btn.sec { background:transparent; color:var(--fg); border:1px solid var(--line); font-weight:500; } .d10-btn.sm { padding:5px 10px; font-size:11.5px; } .d10-btn.warn { color:var(--warn); }
.d10-fab { position:absolute; left:16px; bottom:14px; z-index:3; display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#132a3b; border:1px solid var(--line); color:var(--fg2); }
.d10-status { position:absolute; left:72px; bottom:20px; z-index:3; display:inline-flex; align-items:center; gap:8px; height:32px; padding:0 12px; border:1px solid rgba(95,214,152,.5); border-radius:999px; background:rgba(6,16,24,.92); font-size:12px; white-space:nowrap; }
.d10-status span { color:var(--fg3); }
.d10-dot { width:10px; height:10px; border-radius:50%; background:var(--ok); box-shadow:0 0 8px var(--ok); }
.d10-ruf { display:flex; align-items:center; gap:12px; flex:none; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d10-ruf .ring { width:26px; height:26px; border-radius:50%; border:2px dashed rgba(82,193,230,.5); flex:none; } .d10-ruf b { display:block; } .d10-ruf small { color:var(--fg3); }
.d10-cb { display:inline-block; width:14px; height:14px; border:1.5px solid var(--fg3); border-radius:4px; vertical-align:middle; } .d10-cb.on { background:var(--a); border-color:var(--a); box-shadow:inset 0 0 0 2px #04121b; }
/* table (detail mode) */
.d10-tbl { flex:1; min-height:0; overflow:hidden; border:1px solid var(--line); border-radius:12px; background:rgba(3,10,16,.55); }
.d10-tbl table { width:100%; border-collapse:collapse; font-size:12px; }
.d10-tbl th { position:sticky; top:0; padding:8px 10px; background:#0a1824; color:var(--fg3); font-weight:600; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }
.d10-tbl tr.flt th { top:32px; padding:4px 10px 6px; font-weight:400; } .d10-tbl tr.flt i { display:block; padding:2px 6px; border:1px solid var(--line); border-radius:5px; font-style:normal; color:var(--fg3); font-size:11px; }
.d10-tbl td { padding:6px 10px; border-bottom:1px solid rgba(159,179,200,.08); white-space:nowrap; }
.d10-tbl .num { text-align:right; font-variant-numeric:tabular-nums; }
.d10-tbl tr.g td { padding-top:10px; color:var(--a); font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.12em; } .d10-tbl tr.g small { margin-left:10px; color:var(--fg3); font:12px Inter, system-ui, sans-serif; letter-spacing:0; }
.d10-tbl tr.sel td { background:rgba(82,193,230,.1); }
.d10-tbl .q { display:inline-flex; align-items:center; gap:6px; font-variant-numeric:tabular-nums; } .d10-tbl .q::before { content:""; width:8px; height:8px; border-radius:2px; background:var(--qc); }
.d10-tbl .res { display:inline-flex; align-items:center; gap:4px; color:var(--a); } .d10-tbl .res svg, .d10-tbl .scr svg { width:13px; height:13px; }
.d10-tbl .scr { display:inline-flex; align-items:center; gap:4px; color:var(--ok); } .d10-tbl .noscr { color:var(--fg3); }
.d10-tbl .act { color:var(--fg3); } .d10-tbl .act svg { width:14px; height:14px; margin-left:6px; }
.d10-bar { position:absolute; left:50%; bottom:18px; z-index:4; transform:translateX(-50%); display:flex; align-items:center; gap:8px; padding:8px 10px 8px 16px; border:1px solid var(--a); border-radius:999px; background:#0b1a26; box-shadow:0 14px 34px rgba(0,0,0,.6); white-space:nowrap; }
.d10-bar > span { color:var(--fg3); margin-right:6px; }
/* plan dialog */
.d10-scrim { position:absolute; inset:0; z-index:7; background:rgba(2,6,10,.6); }
.d10-dlg { position:absolute; z-index:8; top:50%; left:50%; transform:translate(-50%,-50%); width:520px; padding:16px 18px; border:1px solid var(--line); border-radius:16px; background:#0b1a26; box-shadow:0 24px 60px rgba(0,0,0,.7); }
.d10-dlg header { display:flex; align-items:center; } .d10-dlg h3 { margin:0; font:600 15px/1.2 Orbitron, system-ui, sans-serif; } .d10-dlg header i { margin-left:auto; color:var(--fg3); }
.d10-dlg .lead { margin:10px 0; color:var(--fg2); } .d10-dlg footer { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
.d10-seg { display:flex; gap:4px; margin-top:12px; padding:3px; border:1px solid var(--line); border-radius:10px; }
.d10-seg span { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; height:30px; border-radius:7px; color:var(--fg3); font-size:12px; }
.d10-seg span.on { color:var(--fg); background:rgba(82,193,230,.16); } .d10-seg.sm { margin:10px 0; }
.d10-stops { margin:6px 0; padding:0; list-style:none; counter-reset:st; }
.d10-stops li { display:flex; align-items:center; gap:10px; padding:7px 4px; border-bottom:1px dashed var(--line); counter-increment:st; }
.d10-stops li::before { content:counter(st); display:grid; place-items:center; width:20px; height:20px; border-radius:50%; background:rgba(82,193,230,.18); color:var(--a); font-size:11px; font-weight:700; }
.d10-stops span { color:var(--fg3); } .d10-stops em { margin-left:auto; color:var(--fg3); font-style:normal; font-size:11px; }
.d10-fields { display:grid; gap:6px; margin-top:10px; } .d10-fields label { display:flex; justify-content:space-between; padding:7px 10px; border:1px solid var(--line); border-radius:8px; color:var(--fg3); font-size:12px; } .d10-fields span { color:var(--fg); }
/* ---------- A Frachtdeck */
.d11-bays { display:flex; gap:6px; flex:none; height:66px; }
.d11-bay { position:relative; display:flex; flex-direction:column; justify-content:center; min-width:0; padding:6px 10px; border:1px solid var(--line); border-radius:6px; background:repeating-linear-gradient(90deg, rgba(82,193,230,.04) 0 10px, transparent 10px 20px), rgba(6,16,24,.8); overflow:hidden; }
.d11-bay b { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .d11-bay small { color:var(--fg3); font-size:10.5px; } .d11-bay span { color:var(--fg2); font-size:11px; white-space:nowrap; }
.d11-bay i { position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg, var(--a) var(--f), transparent var(--f)); }
.d11-bay.on { border-color:var(--a); box-shadow:inset 0 0 0 1px var(--a); background:rgba(82,193,230,.12); }
.d11-split { display:grid; grid-template-columns:1fr 280px; gap:14px; flex:1; min-height:0; }
.d11-deck { display:flex; flex-direction:column; gap:10px; min-height:0; }
.d11-lane { display:flex; gap:10px; padding:10px; border:1px solid var(--line); border-radius:10px; background:linear-gradient(180deg, rgba(3,10,16,.4), rgba(3,10,16,.8)); }
.d11-lane .lbl { flex:none; width:96px; display:flex; flex-direction:column; gap:6px; color:var(--fg3); font:600 10px/1.2 Orbitron, system-ui, sans-serif; letter-spacing:.12em; text-transform:uppercase; }
.d11-lane .lbl svg { width:20px; height:20px; color:var(--a); }
.d11-lane .row { display:flex; flex-wrap:wrap; align-items:flex-end; gap:8px; }
.d11-crate { position:relative; display:flex; flex-direction:column; justify-content:flex-end; padding:16px 8px 6px; border:1px solid rgba(82,193,230,.4); border-radius:4px; background:linear-gradient(180deg, rgba(82,193,230,.14), rgba(8,20,30,.95)), repeating-linear-gradient(90deg, transparent 0 7px, rgba(159,179,200,.08) 7px 8px); box-shadow:inset 0 -3px 0 rgba(0,0,0,.4); }
.d11-crate.s { width:112px; height:78px; } .d11-crate.m { width:130px; height:88px; } .d11-crate.l { width:150px; height:98px; } .d11-crate.xl { width:184px; height:108px; }
.d11-crate .qs { position:absolute; left:0; right:0; top:0; height:5px; background:var(--qc); border-radius:3px 3px 0 0; }
.d11-crate b { font-size:12px; } .d11-crate span { color:var(--fg2); font-size:10.5px; } .d11-crate small { color:var(--fg3); font-size:10px; }
.d11-crate.res::after { content:""; position:absolute; left:0; top:5px; bottom:0; width:var(--rf, 60%); background:repeating-linear-gradient(135deg, rgba(240,194,123,.0) 0 6px, rgba(82,193,230,.22) 6px 9px); pointer-events:none; }
.d11-crate em { position:absolute; right:6px; top:9px; display:inline-flex; align-items:center; gap:3px; color:var(--a); font-style:normal; font-size:10px; } .d11-crate em svg { width:11px; height:11px; }
.d11-box { position:relative; width:150px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); }
.d11-box b { display:block; font-size:12px; padding-right:18px; } .d11-box span { color:var(--a); font-weight:700; font-size:12px; } .d11-box small { display:block; color:var(--fg3); font-size:10.5px; }
.d11-box .scr { position:absolute; right:8px; top:8px; color:var(--ok); } .d11-box .scr svg { width:14px; height:14px; }
.d11-log { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d11-log h4 { margin:0; color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; } .d11-log h5 { margin:0; font-size:14px; }
.d11-log dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:0; font-size:12px; } .d11-log dt { color:var(--fg3); } .d11-log dd { margin:0; text-align:right; }
.d11-log .mut, .d11-ghost .mut { margin:0; color:var(--fg3); font-size:12px; }
.d11-used { margin-top:auto; padding-top:10px; border-top:1px dashed var(--line); } .d11-used small { color:var(--warn); } .d11-used p { margin:4px 0 8px; color:var(--fg2); font-size:12px; }
.d11-res { display:flex; flex-direction:column; gap:12px; padding:14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d11-res header { display:flex; align-items:center; gap:10px; } .d11-res h3 { margin:0; font:600 18px/1.1 Orbitron, system-ui, sans-serif; } .d11-res header small { color:var(--fg3); } .d11-res header .d10-btn { margin-left:auto; }
.d11-spec { position:relative; height:230px; } .d11-spec .plot { position:absolute; inset:0 0 22px; border-left:1px solid var(--line); border-bottom:1px solid var(--line); background:repeating-linear-gradient(0deg, transparent 0 45px, rgba(159,179,200,.07) 45px 46px); }
.d11-spec .ax { position:absolute; left:0; right:0; bottom:0; display:flex; justify-content:space-between; color:var(--fg3); font-size:10.5px; }
.d11-spec .bar { position:absolute; bottom:0; left:var(--x); width:44px; height:var(--h); transform:translateX(-50%); border-radius:4px 4px 0 0; background:var(--c); }
.d11-spec .bar b { position:absolute; top:-18px; left:0; right:0; text-align:center; font-size:12px; } .d11-spec .bar small { position:absolute; bottom:4px; left:0; right:0; text-align:center; color:#04121b; font-size:9.5px; font-weight:600; }
.d11-spec .bar.res { background:repeating-linear-gradient(135deg, var(--c) 0 6px, rgba(82,193,230,.55) 6px 10px); } .d11-spec .bar em { position:absolute; top:-34px; left:50%; transform:translateX(-50%); white-space:nowrap; color:var(--a); font-style:normal; font-size:10.5px; }
.d11-spec .thr { position:absolute; top:0; bottom:0; left:var(--x); border-left:1.5px dashed var(--warn); } .d11-spec .thr b { position:absolute; top:4px; left:6px; white-space:nowrap; color:var(--warn); font-size:10.5px; font-weight:500; }
.d11-stacks { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; } .d11-stacks div { padding:8px 10px; border:1px solid var(--line); border-radius:8px; } .d11-stacks b { display:block; } .d11-stacks span { color:var(--fg3); font-size:11.5px; }
.d11-stacks em { display:flex; align-items:center; gap:4px; margin-top:4px; color:var(--a); font-style:normal; font-size:11px; } .d11-stacks em.w { color:var(--warn); } .d11-stacks em svg { width:12px; height:12px; } .d11-stacks .res { border-color:rgba(82,193,230,.5); }
.d11-resv { display:flex; align-items:center; gap:10px; } .d11-resv small { display:block; color:var(--fg3); }
.d11-bol { margin:0; color:var(--fg3); font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; }
.d11-ghost { display:flex; flex-direction:column; gap:10px; }
.d11-ghost .gc { display:flex; align-items:center; gap:12px; height:84px; padding:0 18px; border:1.5px dashed rgba(82,193,230,.4); border-radius:6px; color:var(--fg2); } .d11-ghost .gc svg { width:26px; height:26px; color:var(--fg3); }
.d11-ghost .alt { display:flex; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:var(--card); } .d11-ghost .alt > svg { width:20px; height:20px; color:var(--a); }
.d11-ghost .alt span { flex:1; } .d11-ghost .alt small { display:block; color:var(--fg3); }
.d11-pads { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; }
.d11-pad { position:relative; display:flex; flex-direction:column; align-items:center; gap:4px; height:200px; padding:18px 10px 12px; border:1px solid var(--line); border-radius:8px; background:repeating-linear-gradient(45deg, rgba(240,194,123,.05) 0 8px, transparent 8px 16px), rgba(6,16,24,.85); }
.d11-pad .ring { position:absolute; left:14%; right:14%; top:40px; height:70px; border:1.5px solid rgba(82,193,230,.3); border-radius:50%; }
.d11-pad .hull { position:relative; display:grid; place-items:center; height:86px; } .d11-pad .hull svg { width:130px; height:44px; color:#8ab4cc; stroke-width:1.2; }
.d11-pad b { margin-top:auto; font-size:12.5px; text-align:center; } .d11-pad small { color:var(--fg3); }
.d11-pad .o { position:absolute; top:8px; right:8px; padding:2px 8px; border-radius:4px; border:1px solid var(--line); color:var(--fg2); font-style:normal; font-size:10.5px; } .d11-pad .o.pl { color:var(--a); border-color:rgba(82,193,230,.5); }
.d11-pad.add { justify-content:center; color:var(--fg3); border-style:dashed; } .d11-pad.add svg { width:24px; height:24px; color:var(--a); }
.d11-lockers { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; }
.d11-locker { position:relative; display:flex; flex-direction:column; gap:4px; height:170px; padding:28px 12px 12px; border:1px solid var(--line); border-radius:6px; background:linear-gradient(90deg, rgba(159,179,200,.06) 1px, transparent 1px) 0 0/12px 100%, rgba(6,16,24,.85); }
.d11-locker .hd { position:absolute; left:10px; right:10px; top:10px; height:6px; border-radius:3px; background:repeating-linear-gradient(90deg, rgba(159,179,200,.35) 0 3px, transparent 3px 6px); }
.d11-locker b { font-size:12.5px; } .d11-locker small { color:var(--fg3); } .d11-locker span { margin-top:auto; color:var(--a); } .d11-locker span svg { width:22px; height:22px; }
.d11-locker.add { align-items:center; justify-content:center; border-style:dashed; color:var(--fg3); } .d11-locker.add svg { width:22px; height:22px; color:var(--a); }
.d11-dlg { width:540px; }
/* ---------- B Sternkarte */
.d12-split { display:grid; grid-template-columns:1fr 320px; gap:14px; flex:1; min-height:0; }
.d12-map { position:relative; min-height:440px; border:1px solid var(--line); border-radius:16px; background:radial-gradient(circle at 50% 50%, rgba(82,193,230,.08), transparent 60%), #040b12; overflow:hidden; }
.d12-map .sys { position:absolute; inset:0; }
.d12-map.zoom .d12-node.on i { width:calc(var(--s) * 1.6); height:calc(var(--s) * 1.6); }
.d12-map .sun { position:absolute; left:50%; top:47%; width:18px; height:18px; transform:translate(-50%,-50%); border-radius:50%; background:#ffd58a; box-shadow:0 0 30px 8px rgba(255,200,120,.35); }
.d12-map .orb { position:absolute; left:50%; top:47%; transform:translate(-50%,-50%); border:1px solid rgba(82,193,230,.15); border-radius:50%; }
.d12-map .o1 { width:30%; height:38%; } .d12-map .o2 { width:48%; height:60%; } .d12-map .o3 { width:66%; height:80%; } .d12-map .o4 { width:86%; height:104%; }
.d12-map .pl { position:absolute; left:var(--x); top:var(--y); transform:translate(-50%, 26px); color:var(--fg3); font:600 9.5px/1 Orbitron, system-ui, sans-serif; letter-spacing:.14em; text-transform:uppercase; }
.d12-node { position:absolute; left:var(--x); top:var(--y); transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:2px; }
.d12-node i { width:var(--s); height:var(--s); border-radius:50%; background:radial-gradient(circle, #04121b 52%, transparent 53%), conic-gradient(#52c1e6 0 55%, #8aa8ff 55% 75%, #c9a6ff 75% 88%, #6f8aa0 88% 100%); box-shadow:0 0 14px rgba(82,193,230,.35); }
.d12-node b { font-size:11px; white-space:nowrap; } .d12-node small { color:var(--fg3); font-size:10px; }
.d12-node em { position:absolute; top:-22px; padding:2px 8px; border-radius:999px; background:rgba(82,193,230,.18); color:var(--fg); font-style:normal; font-size:10.5px; white-space:nowrap; }
.d12-node.on i { box-shadow:0 0 0 3px var(--a), 0 0 24px rgba(82,193,230,.7); } .d12-node.glow i { box-shadow:0 0 0 2px #8ff0ff, 0 0 26px rgba(143,240,255,.8); } .d12-node.dim { opacity:.35; }
.d12-route { position:absolute; inset:0; width:100%; height:100%; } .d12-route path { fill:none; stroke:var(--a); stroke-width:.5; stroke-dasharray:1.5 1.2; vector-effect:non-scaling-stroke; stroke-width:2; }
.d12-step { position:absolute; left:var(--x); top:var(--y); transform:translate(14px,-28px); display:grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--a); color:#04121b; font-size:11px; font-weight:700; }
.d12-ship { position:absolute; left:var(--x); top:var(--y); display:inline-flex; align-items:center; gap:4px; padding:2px 8px 2px 4px; border-radius:999px; background:rgba(138,168,255,.18); font-size:10.5px; } .d12-ship svg { width:13px; height:13px; }
.d12-sw { position:absolute; left:14px; top:14px; display:flex; gap:4px; padding:3px; border:1px solid var(--line); border-radius:999px; background:rgba(3,10,16,.8); } .d12-sw span { padding:4px 12px; border-radius:999px; color:var(--fg3); font-size:11.5px; } .d12-sw .on { color:var(--fg); background:rgba(82,193,230,.18); }
.d12-legend { position:absolute; left:14px; bottom:12px; display:flex; align-items:center; gap:6px; color:var(--fg3); font-size:10.5px; } .d12-legend i { width:9px; height:9px; border-radius:2px; margin-left:8px; } .d12-legend .c1 { background:#52c1e6; } .d12-legend .c2 { background:#8aa8ff; } .d12-legend .c3 { background:#c9a6ff; } .d12-legend .c4 { background:#6f8aa0; }
.d12-rank { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--line); border-radius:14px; background:var(--card); min-height:0; }
.d12-find { display:flex; align-items:center; gap:8px; height:30px; padding:0 10px; border:1px solid var(--line); border-radius:8px; color:var(--fg3); font-size:12px; }
.d12-rank ol, .d12-list { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; }
.d12-rank ol a { display:grid; grid-template-columns:1fr auto; gap:2px 10px; padding:6px 8px; border-radius:8px; } .d12-rank li.on a { background:rgba(82,193,230,.14); }
.d12-rank ol small { color:var(--fg3); font-size:10.5px; grid-column:1; } .d12-rank ol em { grid-row:1; grid-column:2; color:var(--fg2); font-style:normal; font-size:11.5px; }
.d12-rank .mb { grid-column:1 / -1; height:4px; border-radius:2px; background:rgba(159,179,200,.12); } .d12-rank .mb i { display:block; height:100%; border-radius:2px; background:var(--a); }
.d12-ph b { display:block; font:600 16px/1.2 Orbitron, system-ui, sans-serif; } .d12-ph small { color:var(--fg3); }
.d12-list li, .d12-list li > a { display:flex; align-items:center; gap:8px; padding:6px 4px; border-bottom:1px solid rgba(159,179,200,.08); font-size:12px; } .d12-list li > a { flex:1; padding:0; border:0; }
.d12-list span { color:var(--fg3); margin-left:auto; } .d12-list em { display:inline-flex; align-items:center; gap:3px; color:var(--a); font-style:normal; } .d12-list em svg { width:12px; height:12px; } .d12-list .scr { color:var(--ok); }
.d12-list .q { width:10px; height:10px; border-radius:2px; background:var(--qc); }
.d12-ring { position:relative; width:170px; height:170px; margin:4px auto; border-radius:50%; background:conic-gradient(#8ff0ff 0 60deg, #52c1e6 60deg 135deg, #4d8bb0 135deg 225deg, #5c6f80 225deg 360deg); }
.d12-ring span { display:none; } .d12-ring::after { content:""; position:absolute; inset:26px; border-radius:50%; background:#0b1a26; }
.d12-ring b { position:absolute; inset:0; z-index:1; display:grid; place-content:center; text-align:center; font:600 26px/1 Orbitron, system-ui, sans-serif; } .d12-ring b small { display:block; color:var(--fg3); font:11px Inter, system-ui, sans-serif; }
.d12-qlist { margin:0; padding:0; list-style:none; display:grid; gap:4px; font-size:12px; } .d12-qlist li { display:flex; align-items:center; gap:8px; } .d12-qlist i { width:10px; height:10px; border-radius:2px; background:var(--qc); } .d12-qlist span { color:var(--fg3); } .d12-qlist .res span { color:var(--a); } .d12-qlist svg { width:11px; height:11px; vertical-align:-1px; }
.d12-band { display:flex; gap:4px; flex:none; } .d12-band span { padding:6px 8px; border-radius:6px; background:rgba(82,193,230,.1); color:var(--fg2); font-size:11px; white-space:nowrap; overflow:hidden; } .d12-band b { display:block; color:var(--fg); }
.d12-alt { display:flex; align-items:center; gap:10px; padding:10px; border:1px solid var(--line); border-radius:10px; } .d12-alt svg { color:var(--a); width:18px; height:18px; } .d12-alt small { display:block; color:var(--fg3); }
.d12-shelf { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; padding:16px; border-bottom:6px solid rgba(159,179,200,.25); border-radius:8px; background:linear-gradient(180deg, transparent 70%, rgba(82,193,230,.06)); }
.d12-book { display:flex; flex-direction:column; gap:6px; height:180px; padding:14px; border:1px solid rgba(138,168,255,.35); border-radius:6px 6px 2px 2px; background:linear-gradient(160deg, rgba(138,168,255,.14), rgba(8,20,30,.95)); }
.d12-book span { color:#8aa8ff; } .d12-book span svg { width:24px; height:24px; } .d12-book b { margin-top:auto; } .d12-book small { color:var(--fg3); }
/* ---------- C Scanner */
.d13-scan { display:flex; align-items:center; gap:8px; flex:none; height:40px; padding:0 14px; border:1px solid rgba(82,193,230,.4); border-radius:8px; background:rgba(2,8,12,.9); font-family:ui-monospace, Consolas, monospace; font-size:12.5px; color:var(--fg3); }
.d13-scan .tok { display:inline-flex; align-items:center; gap:4px; padding:2px 6px 2px 8px; border-radius:4px; background:rgba(82,193,230,.18); color:var(--fg); } .d13-scan .tok svg { width:10px; height:10px; }
.d13-scan .cmd { color:var(--fg); } .d13-scan small { margin-left:auto; color:var(--fg3); font-size:11px; }
.d13-facets { display:flex; flex-wrap:wrap; gap:6px; } .d13-facets span { padding:4px 10px; border:1px solid var(--line); border-radius:4px; color:var(--fg2); font-size:11.5px; font-family:ui-monospace, Consolas, monospace; } .d13-facets b { margin-left:6px; color:var(--fg3); font-weight:400; } .d13-facets .on { border-color:var(--a); color:var(--fg); background:rgba(82,193,230,.12); }
.d13-split { display:grid; grid-template-columns:1fr 280px; gap:14px; flex:1; min-height:0; } .d13-split > div { display:flex; flex-direction:column; gap:12px; min-width:0; }
.d13-board { display:flex; flex-direction:column; gap:2px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:rgba(2,8,12,.75); }
.d13-axis { display:grid; grid-template-columns:150px 1fr 170px; gap:10px; height:16px; color:var(--fg3); font-size:10px; font-family:ui-monospace, Consolas, monospace; } .d13-axis .sc { position:relative; } .d13-axis i { position:absolute; left:var(--x); transform:translateX(-50%); font-style:normal; }
.d13-row { display:grid; grid-template-columns:150px 1fr 170px; align-items:center; gap:10px; height:72px; border-top:1px solid rgba(159,179,200,.08); }
.d13-row .nm b { display:block; } .d13-row .nm small { color:var(--fg3); font-family:ui-monospace, Consolas, monospace; } .d13-row .pl { color:var(--fg3); font-size:11px; }
.d13-row .sp { position:relative; display:flex; align-items:flex-end; gap:2px; height:56px; border-bottom:1px solid var(--line); }
.d13-row .sp i { flex:1; height:var(--h); min-height:1px; background:var(--qc); box-shadow:0 0 6px var(--qc); opacity:.9; }
.d13-row .sp u, .d13-big .sp u { position:absolute; top:-4px; bottom:0; left:var(--x); border-left:1.5px dashed var(--warn); text-decoration:none; }
.d13-row .sp .br, .d13-big .sp .br { position:absolute; left:var(--a); right:calc(100% - var(--b)); top:-6px; height:8px; border:1.5px solid var(--a); border-bottom:0; color:var(--a); font-style:normal; font-size:10px; text-align:center; line-height:0; padding-top:0; }
.d13-row .sp .br { top:-8px; } .d13-row .sp .br { font-size:0; }
.d13-recs { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:8px; }
.d13-rec { position:relative; display:flex; flex-direction:column; gap:2px; padding:10px 12px 12px; border:1px solid var(--line); border-radius:2px; background:linear-gradient(180deg, #0e1f2c, #0a1722); font-size:12px; clip-path:polygon(0 0, 100% 0, 100% calc(100% - 6px), 94% 100%, 88% calc(100% - 6px), 82% 100%, 76% calc(100% - 6px), 70% 100%, 64% calc(100% - 6px), 58% 100%, 52% calc(100% - 6px), 46% 100%, 40% calc(100% - 6px), 34% 100%, 28% calc(100% - 6px), 22% 100%, 16% calc(100% - 6px), 10% 100%, 4% calc(100% - 6px), 0 100%); }
.d13-rec small { color:var(--fg3); font-family:ui-monospace, Consolas, monospace; font-size:10px; letter-spacing:.1em; } .d13-rec span { color:var(--fg2); font-size:11px; }
.d13-rec em { align-self:flex-start; margin-top:4px; padding:1px 6px; border:1.5px solid; border-radius:3px; font:700 9.5px/1.4 ui-monospace, Consolas, monospace; font-style:normal; transform:rotate(-3deg); } .d13-rec em.ok { color:var(--ok); } .d13-rec em.no { color:var(--fg3); }
.d13-recs.ships .d13-rec { min-height:130px; } .d13-rec .h svg { width:120px; height:40px; color:#8ab4cc; stroke-width:1.2; }
.d13-term { display:flex; flex-direction:column; gap:6px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; background:#02070b; font:12px/1.5 ui-monospace, Consolas, monospace; color:var(--fg2); }
.d13-term h4 { margin:0 0 4px; color:var(--ok); font-size:11px; letter-spacing:.2em; } .d13-term p { margin:0; } .d13-term b { color:var(--fg3); font-weight:400; margin-right:6px; } .d13-term i { color:var(--a); font-style:normal; }
.d13-big { padding:14px; border:1px solid var(--line); border-radius:10px; background:rgba(2,8,12,.8); }
.d13-big header { display:flex; align-items:center; gap:12px; margin-bottom:40px; } .d13-big header b { font:600 18px/1 Orbitron, system-ui, sans-serif; } .d13-big header small { color:var(--fg3); } .d13-big header .d10-btn { margin-left:auto; }
.d13-big .sp { position:relative; height:230px; border-bottom:1px solid var(--line); background:repeating-linear-gradient(90deg, transparent 0 calc(5% - 1px), rgba(159,179,200,.07) calc(5% - 1px) 5%); }
.d13-big .sp span { position:absolute; bottom:0; left:var(--x); width:22px; height:var(--h); transform:translateX(-50%); background:var(--qc); box-shadow:0 0 14px var(--qc); }
.d13-big .sp span b { position:absolute; top:-18px; left:50%; transform:translateX(-50%); } .d13-big .sp span small { position:absolute; top:calc(100% + 4px); left:50%; transform:translateX(-50%); color:var(--fg3); font-size:10px; text-align:center; white-space:nowrap; }
.d13-big .sp u b { position:absolute; top:-16px; left:4px; color:var(--warn); font-size:10px; } .d13-big .sp .br { top:-30px; height:12px; font-size:10.5px; line-height:1; padding-top:0; display:flex; justify-content:center; gap:4px; transform:translateY(-6px); } .d13-big .sp .br svg { width:11px; height:11px; }
.d13-none, .d13-plan { display:flex; flex-direction:column; gap:10px; padding:16px; border:1px solid var(--line); border-radius:10px; background:#02070b; font:13px/1.5 ui-monospace, Consolas, monospace; }
.d13-none .t, .d13-plan .t { margin:0; color:var(--fg2); } .d13-none .t b { color:var(--warn); }
.d13-alt { display:flex; align-items:center; gap:12px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; } .d13-alt > b { display:grid; place-items:center; width:22px; height:22px; border-radius:4px; background:rgba(82,193,230,.2); color:var(--a); }
.d13-none code, .d13-plan code { color:var(--a); } .d13-none small, .d13-plan .hint { color:var(--fg3); font-size:11.5px; margin:0; }
.d13-plan .d10-btn { align-self:flex-start; font-family:Inter, system-ui, sans-serif; }
.d13-archive { display:flex; flex-direction:column; padding:6px 14px; border:1px solid var(--line); border-radius:10px; background:#02070b; font:12.5px/1.6 ui-monospace, Consolas, monospace; }
.d13-archive p { display:grid; grid-template-columns:70px 110px 1fr; margin:0; padding:6px 0; border-bottom:1px dashed rgba(159,179,200,.12); } .d13-archive b { color:var(--fg3); font-weight:400; } .d13-archive span { color:var(--a); }
</style>`;

/* ------------------------------------------------------------------ analysis view */
function opt(name, id, label, cons, rec, type) {
  const nm = type === 'checkbox' ? `dm-${name}.${id}` : `dm-${name}`;
  return `<label data-opt="${id}"${rec ? ' data-recommended' : ''}><input type="${type}" name="${nm}" value="${id}"${rec ? ' checked' : ''}><span data-opt-label>${label}</span><span data-opt-consequence>${cons}</span></label>`;
}
function dec(o) {
  const t = o.mode === 'multi' ? 'checkbox' : 'radio';
  const opts = o.opts.map((x) => opt(o.id, x[0], x[1], x[2], x[3], t)).join('\n        ');
  return `    <section id="${o.id}" data-nav-label="${o.nav}" data-decision="${o.id}" data-decision-mode="${o.mode}" data-label="${o.label}" data-rec="${o.rec}" data-rec-why="${o.why}" data-applies-to="${o.applies}" data-finding="f-${o.id}">
      <p data-applies>Gilt für: ${o.applies}</p>
      <p data-situation>${o.sit}</p>
      <h3 data-question>${o.q}</h3>
      <p data-stakes>${o.stakes}</p>
      <div data-options>
        ${opts}
      </div>
      <textarea data-comment="${o.id}-note" placeholder="Notiz (optional)"></textarea>
      <div data-alevel="3" data-title="${o.nav}">
        <div data-slot="short"><div data-viz="text" data-viz-spec='${JSON.stringify({ text: o.short })}'></div></div>
        <div data-slot="long">${o.long}</div>
      </div>
    </section>`;
}
const tbl = (columns, rows) => `<div data-viz="table" data-viz-spec='${JSON.stringify({ columns, rows }).replace(/'/g, '&#39;')}'></div>`;
const D = [
  { id: 'q-quality', nav: 'Qualität im Bestand', mode: 'single', label: 'Qualität je Stapel', rec: 'app',
    why: 'Ohne Qualität kein Spektrum und keine Crafting-Schwelle. Die App kann sie aus dem Spiel lesen, ein Handeintrag soll aber nicht an einer Pflichtangabe scheitern.',
    applies: 'Rohstoffe im Inventar, das Qualitäts-Diagramm, die Reservierung',
    sit: 'Seit 4.7 trägt jeder Rohstoff eine Qualität von 1 bis 1000 (seit 4.8 acht feste Stufen je Erz), Stapel verschiedener Qualität bleiben getrennt. Heute speichert der Bestand keine Qualität (`hq_inventory_items` hat keine Spalte), nur Blaupausen kennen `minQuality`.',
    q: 'Woher kommt die Qualität eines Stapels?', stakes: 'Ob das Qualitäts-Diagramm gefüllt ist und ob Stapel getrennt bleiben.',
    opts: [['app', 'App liest sie, von Hand optional', 'Neue Spalte, ein Stapel je Ort und Qualität. Ohne Angabe zählt er als „Qualität unbekannt“.', true],
      ['apponly', 'Nur aus der App', 'Handeinträge haben nie eine Qualität und fehlen im Diagramm.'],
      ['band', 'Als Stufe (F bis S) statt als Zahl', 'Gröber, aber leichter von Hand einzutragen.']],
    short: 'Empfehlung: App liest Qualität, Hand optional.', long: '<p>Braucht eine Migration und eine Erweiterung des App-Vertrags (<code>docs/contracts/hq-live.md</code>). Faustregel der Community: unter 500 wird ein Gegenstand schwächer als Ladenware, ab 700 lohnt Crafting.</p>' },
  { id: 'q-scrap', nav: 'Woher „zerlegbar“ kommt', mode: 'single', label: 'Zerlege-Daten', rec: 'extract',
    why: 'Nur die Spieldaten sagen verlässlich, was zerlegbar ist und was herauskommt. Eine Faustregel wäre bei Varianten oft falsch.',
    applies: 'die Zerlegbar-Anzeige im Bestand und das Loot-Overlay (#1033)',
    sit: 'Laut Wiki lässt sich die meiste FPS-Ausrüstung im Fabrikator zerlegen. Laden- und Loot-Ware gibt Material der Qualität 500 zurück, Selbstgebautes seine eigene Qualität in kleinerer Menge, Varianten angeblich nicht. Der Codex hat `dismantle_time_seconds` und `dismantle_efficiency`, aber keine Ausbeute.',
    q: 'Woher weiß der Bestand, was zerlegbar ist und was es bringt?', stakes: 'Ob „zerlegbar“ stimmt und eine Ausbeute nennen kann.',
    opts: [['extract', 'Aus den Spieldaten über den Extractor, Unbekanntes bleibt grau', 'Neue Codex-Felder für Ausbeute. Bis dahin zeigt der Bestand „unbekannt“, nie ein geratenes „ja“.', true],
      ['rule', 'Faustregel: Grundmodell ja, Variante nein, Ausbeute geschätzt', 'Sofort sichtbar, aber bei Ausnahmen falsch.'],
      ['later', 'Zerlegbar erst später', 'Spalte und Filter kommen erst, wenn die Daten da sind.']],
    short: 'Empfehlung: Spieldaten, sonst grau.', long: '<p>Dieselben Daten braucht das Loot-Overlay der App (Issue #1033). Einmal extrahiert, nutzen beide sie.</p>' },
  { id: 'q-places', nav: 'Alle Orte im Filter', mode: 'single', label: 'Orts-Filter', rec: 'grouped',
    why: 'Deterministisch, wie du wolltest, ohne dass die Leiste bei vielen Orten bricht.',
    applies: 'den Orts-Filter im Inventar und Hangar',
    sit: 'Fest steht (deine Vorgabe): Filter zeigen immer alle Optionen, nicht nur belegte. Bei Arten passt das in die Chips. Orte gibt es im Verse aber weit über hundert.',
    q: 'Wie zeigt der Orts-Filter alle Orte, ohne die Leiste zu sprengen?', stakes: 'Ob du jeden Ort findest, auch einen leeren.',
    opts: [['grouped', 'Auswahlfeld mit allen Orten, nach System und Planet gruppiert, leere gedimmt', 'Mit Suchfeld oben, belegte Orte zeigen ihre Menge.', true],
      ['chips', 'Belegte Orte als Chips, alle übrigen im Auswahlfeld', 'Die häufigen sind einen Klick entfernt, die Liste bleibt vollständig.'],
      ['used', 'Nur Orte, an denen du je etwas hattest', 'Kurz, aber nicht mehr ganz deterministisch.']],
    short: 'Empfehlung: ein gruppiertes Auswahlfeld.', long: '<p>Gilt für alle drei Richtungen. Das Frachtdeck zeigt die belegten Orte zusätzlich als Ladebuchten, die Sternkarte als Knoten, der Scanner als Facetten.</p>' },
  { id: 'q-pickup', nav: 'Abholen aus mehreren Orten', mode: 'single', label: 'Abhol-Nachschub', rec: 'gather',
    why: 'So wird „10 Agricium aus drei Orten“ ein einziger Schritt, und die Reihenfolge ergibt sich aus dem Bestand statt aus Handarbeit.',
    applies: 'Nachschub, Planen und Jetzt',
    sit: 'Heute hat eine Nachschub-Zeile keinen Ort. Ein Abholen geht nur als Einsatz-Schritt „pickup“ mit einem Ort, also ein Einsatz je Ort. Der Bestand kennt aber schon alle Orte eines Gegenstands, nach Menge sortiert.',
    q: 'Wie wird „10 Agricium aus mehreren Orten abholen“ zu einem Nachschub?', stakes: 'Wie viele Schritte das Einsammeln kostet.',
    opts: [['gather', 'Eine Sammel-Zeile, die ihre Orte selbst als Route anlegt', 'Route nach Menge, umsortierbar. Jetzt hakt jeden Halt ab, die App bestätigt über den Bestand.', true],
      ['each', 'Je Ort ein Einsatz, wie heute', 'Kein Umbau, aber drei Einsätze für ein Agricium.'],
      ['near', 'Sammel-Zeile, Route nach Entfernung statt Menge', 'Braucht Entfernungen zwischen Orten, die es noch nicht gibt.']],
    short: 'Empfehlung: eine Sammel-Zeile mit Route.', long: '<p>Betroffen: <code>hq_supplies</code> (Ort oder Bezug auf Bestandsstapel), <code>nachschub.model.ts</code> (Zeilenstatus), <code>hq_einsatz_steps</code>.</p>' },
  { id: 'q-sell', nav: 'Verkaufs-Nachschub', mode: 'single', label: 'Geld verdienen', rec: 'type',
    why: 'Ein Verkauf zählt keine Gegenstände hoch, sondern aUEC. Als eigene Art bleibt die heutige Logik der übrigen Nachschübe unberührt.',
    applies: 'Planen („neuer Nachschub“) und den Bestand als Quelle',
    sit: 'Deine Idee: ein Nachschub, der Geld bringt, ausgewählt aus dem Bestand statt aus der Wunschliste. Heute gibt es die Arten normal, event und sightseeing. `hq_stats` summiert aUEC aus den App-Ereignissen schon.',
    q: 'Wie kommt „Geld verdienen“ in den Nachschub?', stakes: 'Ob ein Verkauf denselben Platz in den sieben Slots bekommt wie ein Einkauf.',
    opts: [['type', 'Neue Nachschub-Art „Verkauf“ mit Ziel in aUEC', 'Im „neuer Nachschub“-Popup als Wahl „Geld verdienen“. Posten kommen aus dem Bestand, der Fortschritt aus den Verkäufen, die die App meldet.', true],
      ['step', 'Verkauf als Schritt in einem normalen Nachschub', 'Kein neuer Typ, aber das Ziel ist dann nicht das Geld.'],
      ['later', 'Später', 'Verkaufen bleibt eine Notiz an der Reservierung.']],
    short: 'Empfehlung: eigene Art „Verkauf“.', long: '<p>Rohes Erz verkauft sich an der Raffinerie zum halben Preis, Edelsteine im Admin-Büro, Raffiniertes an Handelsterminals. Bergungsgut erst nach dem Raffinieren. Ein Preishinweis pro Posten käme aus UEX-Daten.</p>' },
  { id: 'q-reserve', nav: 'Reservieren für Freunde', mode: 'multi', label: 'Reservierung', rec: 'friend text',
    why: 'Die Reservierung gibt es schon als Freitext. Ein Freund aus deiner Liste macht sie filterbar, ohne Freitext zu verbieten.',
    applies: 'Reservierungen an Bestandsstapeln',
    sit: 'Heute: `reservations` an jeder Bestandszeile mit Menge, Notiz und Zeit, bis 50 je Zeile. Freunde gibt es (`FriendsService`), aber Freunde sehen deinen Bestand nicht.',
    q: 'Was gehört zur Reservierung „10 von 15 SCU Eisen für Kaelis“?', stakes: 'Ob Reservierungen filterbar sind und der Freund davon erfährt.',
    opts: [['friend', 'Freund aus der Freundesliste wählen', 'Die Reservierung trägt seine ID, der Filter „Reserviert“ kann nach Freund gruppieren.', true],
      ['text', 'Freitext bleibt möglich', 'Für Orgs, Mitspieler ohne Konto oder eigene Zwecke („für Verkauf“).', true],
      ['notify', 'Der Freund sieht sie bei sich', 'Braucht einen neuen Freigabeweg, der Bestand ist heute nur für dich lesbar.'],
      ['expire', 'Reservierung läuft nach einer Frist ab', 'Gibt die Menge von selbst wieder frei.']],
    short: 'Empfehlung: Freund wählen, Freitext bleibt.', long: '<p>Betroffen: die Form-Prüfung <code>hq_inv_item_reservations_shape</code> und <code>hq-inventory.service.ts</code> (reserve, endReservation).</p>' },
  { id: 'q-alt', nav: 'Auswege bei leerem Treffer', mode: 'multi', label: 'Alternativen', rec: 'elsewhere wish swap',
    why: 'Ein leerer Treffer ist meist ein Bedarf. Die drei Auswege führen direkt von der Suche zum nächsten Schritt.',
    applies: 'Suche und Filter im Bestand',
    sit: 'Heute zeigt ein leerer Filter nur ein leeres Raster. Es gibt keine allgemeine Alternativ-Logik; „Passt dazu“ (`recommend.ts`) und die Tauschtabelle im Codex (`swap-table.ts`) gibt es schon.',
    q: 'Was bietet der Bestand an, wenn Suche oder Filter nichts finden?', stakes: 'Ob ein leerer Treffer eine Sackgasse ist.',
    opts: [['elsewhere', '„Liegt woanders“: derselbe Gegenstand außerhalb des Filters', 'Mit Ort, Menge und freier Menge, ein Klick plant das Abholen.', true],
      ['wish', 'Wünschen und gleich in einen Nachschub einplanen', 'Mit dem gesuchten Mindestwert, z. B. Eisen Q ≥ 700.', true],
      ['swap', 'Ersatz aus derselben Blaupause oder Tauschtabelle', 'Zum Beispiel ein anderes Material, das dieselbe Blaupause akzeptiert.', true],
      ['craft', 'Selbst herstellen, wenn eine Blaupause da ist', 'Zeigt, welche Blaupause in deiner Sammlung es baut.']],
    short: 'Empfehlung: woanders, wünschen, Ersatz.', long: '<p>Die Reihenfolge: zuerst was du schon hast, dann was du wünschen kannst, dann Ersatz.</p>' },
  { id: 'q-reorder', nav: 'Nachbestellen', mode: 'single', label: 'Nachbestellen', rec: 'week',
    why: 'Wer zwei Tage nicht spielt, verliert heute die Liste. Sieben Tage plus freie Auswahl in der Tabelle decken „mehr als nur das letzte“ ab.',
    applies: '„Kürzlich aufgebraucht“ und die Mehrfachauswahl',
    sit: 'Heute: „Kürzlich aufgebraucht“ zeigt 48 Stunden, aus dem App-Ereignis „inventory.snapshot“. Ein Handabgang zählt nicht. „Nachholen“ legt einzeln auf die Wunschliste.',
    q: 'Wie weit reicht „Kürzlich aufgebraucht“, und was lässt sich nachbestellen?', stakes: 'Ob du Verbrauchtes vollständig wieder auf die Wunschliste bekommst.',
    opts: [['week', '7 Tage, dazu jede Auswahl aus der Tabelle', 'Mehrfachauswahl → „Auf die Wunschliste“ mit Mengen. Auch Handabgänge zählen.', true],
      ['48', '48 Stunden wie heute, plus Auswahl aus der Tabelle', 'Kurz und frisch, älteres nur über die Tabelle.'],
      ['all', 'Ganze Verbrauchs-Historie mit Zeitraum-Wahl', 'Am vollständigsten, braucht eine eigene Ansicht.']],
    short: 'Empfehlung: 7 Tage plus Tabelle.', long: '<p>Ein Handabgang (<code>takeOut</code>) schreibt heute kein Ereignis. Dafür käme eins dazu.</p>' },
];
const view = `  <section data-view="d10-regeln" data-view-kind="analysis" data-analysis="full" data-nav-label="Daten und Aktionen" hidden>
    <section id="d10-brief" data-analysis-briefing data-nav-label="Briefing">
      <p data-briefing-what>Bestand wird vom Kachel-Raster zur Lagerverwaltung: Orte, Qualitäten, Reservierungen, Zerlegen, Abholen und Verkaufen. Das braucht neue Daten und neue Nachschub-Arten.</p>
      <p data-briefing-why>Drei Agents haben deine neuen Anwendungsfälle geprüft: Spielmechanik im Netz, das Datenmodell im Code und kreative Richtungen. Vieles gibt es schon (Orte je Zeile, Löschen, Reservierung als Freitext, Freunde, Einsatz-Schritt „pickup“). Es fehlen Qualität, Zerlege-Daten, ein Verkaufs-Nachschub und eine Abhol-Zeile über mehrere Orte.</p>
      <div data-briefing-potential data-viz="kpi" data-viz-spec='{"value":"4","unit":"Datenlücken","label":"Qualität, Zerlege-Ausbeute, Verkaufs-Nachschub, Abholen über mehrere Orte"}'>4</div>
      <a data-briefing-topic="d10-t1" data-share="40">Daten: Qualität, Zerlegen, Orte</a>
      <a data-briefing-topic="d10-t2" data-share="60">Aktionen: Abholen, Verkaufen, Reservieren</a>
      <p data-briefing-duration>≈ 7 min</p>
      <div data-alevel="1" data-title="Briefing">
        <div data-slot="short"><div data-viz="kpi" data-viz-spec='{"value":"11","unit":"Anwendungsfälle"}'></div></div>
        <div data-slot="long">${tbl(['Anwendungsfall', 'Heute', 'Fehlt'], [
          ['Was liegt in Area18?', 'eine Zeile je Gegenstand und Ort', 'Ansicht nach Ort, nach Menge sortiert'],
          ['Qualität je Rohstoff als Diagramm', 'nur Blaupausen kennen minQuality', 'Qualität je Stapel, App-Vertrag'],
          ['10 Agricium aus mehreren Orten holen', 'Einsatz-Schritt „pickup“ mit einem Ort', 'Sammel-Zeile über Orte'],
          ['Nachbestellen, mehr als das letzte', '48 h, einzeln', '7 Tage, Mehrfachauswahl'],
          ['Falsches löschen', 'deleteRow, setAmount vorhanden', 'nur sichtbar machen'],
          ['Zerlegbar im Fabrikator', 'Zerlegedauer im Codex', 'Ausbeute aus den Spieldaten'],
          ['Auswege bei leerem Treffer', 'leeres Raster', 'woanders, wünschen, Ersatz'],
          ['Reservieren für Freunde', 'Freitext-Reservierung', 'Freund-ID, Filter'],
          ['Verkaufs-Nachschub', 'Arten normal, event, sightseeing', 'neue Art mit aUEC-Ziel'],
          ['Handeintrag am letzten Ort', 'Ort im Formular wählbar', 'Default aus App-Ort oder zuletzt benutzt'],
          ['Filter immer vollständig', 'Chips nur bei Bestand', 'alle Optionen, leere gedimmt']])}<p>Fest steht aus Runde 1 und deinen Notizen: „Alle“ ohne Zahl; Filter für Herkunft, Rolle, Art und Ort; Symbole wie in der Suche; die originale Seitenbreite; ein Handeintrag startet am letzten bekannten Ort; der App-Status unten links läuft in einer eigenen Session.</p></div>
      </div>
    </section>
    <section id="d10-t1" data-topic data-nav-label="Daten: Qualität, Zerlegen, Orte">
      <div data-alevel="2" data-title="Daten: Qualität, Zerlegen, Orte">
        <div data-slot="short"><div data-viz="text" data-viz-spec='{"text":"Drei Fragen dazu, woher neue Angaben kommen."}'></div></div>
        <div data-slot="long"><div data-viz="text" data-viz-spec='{"text":"Gilt für jede der drei Richtungen gleich."}'></div></div>
      </div>
${D.slice(0, 3).map(dec).join('\n')}
    </section>
    <section id="d10-t2" data-topic data-nav-label="Aktionen: Abholen, Verkaufen, Reservieren">
      <div data-alevel="2" data-title="Aktionen: Abholen, Verkaufen, Reservieren">
        <div data-slot="short"><div data-viz="text" data-viz-spec='{"text":"Fünf Fragen dazu, was du mit deinem Bestand tun kannst."}'></div></div>
        <div data-slot="long"><div data-viz="text" data-viz-spec='{"text":"Wie die Aktion aussieht (Dialog, Karte, Befehl), zeigen die Richtungen. Hier geht es um das, was sie tut."}'></div></div>
      </div>
${D.slice(3).map(dec).join('\n')}
    </section>
  </section>`;

const ico = (svg) => svg.replace(' aria-hidden="true"', '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = `<section data-iteration="2" data-iteration-template="design" data-viewports="desktop" data-tab-label="Runde 2" data-design-set="alternatives">
${css}
<header class="iteration-intro">
<h2>Runde 2 · Bestand als Lager</h2>
<p>Drei neue, thematische Richtungen statt drei Varianten des Rasters: Frachtdeck, Lager-Sternkarte und Quartiermeister-Scanner. Jede zeigt dieselben acht Seiten, mit Übersicht und Tabelle, Orten, Qualität, Reservierung, Zerlegen, Auswegen bei leerem Treffer und Abholen aus mehreren Orten. Übernommen aus Runde 1: Filter immer vollständig mit „Alle“ ohne Zahl, die Symbole der Suche, die originale Seitenbreite. Der App-Status unten links steht hier schon so, wie ihn die eigene Session baut.</p>
</header>
<section data-design="frachtdeck" data-nav-label="Frachtdeck" data-design-active="true"
  data-design-motto="Alles in SCU"
  data-design-traits="Orte als Ladebuchten, Breite nach Menge|Rohstoffe als SCU-Container in echter Größe|Rechts ein Ladeprotokoll für Auswahl und Aktionen"
  data-design-icon="${ico(I.inv)}">
${d11()}
</section>
<section data-design="sternkarte" data-nav-label="Lager-Sternkarte"
  data-design-motto="Dein Verse, kartiert"
  data-design-traits="Holo-Karte des Systems mit Orten als Knoten|Qualität als Ring, Abholen als Route auf der Karte|Rangliste der Orte neben der Karte"
  data-design-icon="map" data-design-color="#8aa8ff">
${d12()}
</section>
<section data-design="scanner" data-nav-label="Quartiermeister-Scanner"
  data-design-motto="Scannen, sortieren, ausgeben"
  data-design-traits="Scan-Zeile mit Kürzeln statt Chips|Rohstoffe als Qualitäts-Spektren, Gegenstände als Belege|Terminal-Log und Befehle für Abholen und Verkaufen"
  data-design-icon="gauge" data-design-color="#5fd698">
${d13()}
</section>
${view}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('wrote', out, html.length);
