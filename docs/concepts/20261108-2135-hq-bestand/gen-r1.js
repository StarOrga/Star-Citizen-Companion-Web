// Generates rounds/01.html of the HQ Bestand concept. Run: node gen-r1.js <out>
const fs = require('fs');
const out = process.argv[2];

const I = {
  crate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/></svg>',
  ship: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l3 7.5 6.5 3.5-6.5 1.5L12 21.5 9 15l-6.5-1.5L9 10z"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M12 7.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1L12 14.6l-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6.5 8 6.5v9H4z"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
  hull: '<svg viewBox="0 0 120 40" aria-hidden="true"><path d="M4 22 L30 16 L56 6 L78 8 L96 15 L116 20 L96 25 L78 32 L56 34 L30 24 Z"/><path d="M56 6 L60 20 L56 34 M30 16 L34 20 L30 24"/></svg>',
};

/* ------------------------------------------------------------------ data */
const ITEMS = [
  ['P4-AR Sturmgewehr', '×2', 'Area18 · Lager', 'w', 'Auf der Wunschliste 1'],
  ['Arclight-Laserpistole', '×1', 'Area18 · Lager', 'w', ''],
  ['Lumin-Lasermagazin', '×4', 'Lorville · Lager', 'w', 'Im Nachschub „Gladius aufrüsten“'],
  ['Pembroke-Helm', '×1', 'Lorville · Lager', 'a', ''],
  ['ORC-mkX Rüstung (Arctic)', '×1', 'Gladius „Rotfuchs“', 'a', ''],
  ['Quantanium', '0,4 SCU', 'Gladius „Rotfuchs“', 'm', ''],
  ['Hadanit', '12', 'Lorville · Lager', 'm', ''],
  ['Medpen (Hemozal)', '×12', 'Port Tressler', 'o', 'Kürzlich 4 aufgebraucht'],
  ['Multitool mit Traktorstrahl', '×1', 'Area18 · Lager', 'o', ''],
];
const SAMMLUNG = [
  ['Arclight-Laserpistole', 'Blaupause', 'bp'],
  ['P4-AR Sturmgewehr', 'Blaupause', 'bp'],
  ['Alpha 4.4: Patch-Notes', 'News · gemerkt', 'news'],
  ['Pyro, Sonnenaufgang über Ruin', 'Galerie · hochgewählt', 'gal'],
];

/* ------------------------------------------------------------------ chrome */
const PAGES = [['Start', 's5'], ['Bestand', 's1'], ['Jetzt', null], ['Planen', 's6'], ['Statistik', null]];
function header() {
  return `<header class="d0-mh"><span class="d0-brand"><i class="d0-logo"></i>VERSE COMPANION</span><nav class="d0-nav"><span>Verse</span><span>Codex</span><span class="on">HQ</span><span>Starscape</span></nav><span class="d0-right"><span class="d0-ico">${I.cart}</span><span class="d0-av">JT</span></span></header>`;
}
function sub(p, page, scope, opts = {}) {
  const pages = opts.noPages ? '<span class="d0-sub-note">HQ</span>' : `<nav class="d0-pages">${PAGES.map(([n, s]) => {
    const on = n === page ? ' on' : '';
    return s ? `<a class="d0-pg${on}" href="#" data-screen-link="${p}-${s}">${n}</a>` : `<span class="d0-pg${on}">${n}</span>`;
  }).join('')}</nav>`;
  const typed = opts.typed;
  const chip = scope ? `<span class="d0-scope">${scope}<i>${I.x}</i></span>` : '';
  const ph = scope ? `Im ${scope} suchen …` : 'HQ durchsuchen …';
  const field = typed ? `<span class="d0-typed">${typed}<i class="d0-caret"></i></span>` : `<span class="d0-ph">${scope === 'Bestand' ? 'Im ganzen Bestand suchen …' : ph}</span>`;
  return `<div class="d0-sub">${pages}<a class="d0-search${typed ? ' open' : ''}" href="#" data-screen-link="${p}-s2">${I.search}${chip}${field}</a></div>`;
}
function thinRail(p, active) {
  const r = [['Start', I.home, 's5'], ['Bestand', I.crate, 's1'], ['Jetzt', I.pulse, null], ['Planen', I.plan, 's6'], ['Statistik', I.chart, null]];
  return `<aside class="d0-rail">${r.map(([n, ic, s]) => s ? `<a class="${n === active ? 'on' : ''}" href="#" data-screen-link="${p}-${s}" aria-label="${n}">${ic}</a>` : `<span aria-label="${n}">${ic}</span>`).join('')}</aside>`;
}
const fab = `<span class="d0-fab" aria-label="Feedback">${I.chat}</span>`;

/* ------------------------------------------------------------------ status texts */
const ST = {
  track: { cls: 'track', lbl: 'Tracking', det: 'Stanton › Area18 · Inventar vor 2 Min. gelesen' },
  trackPlan: { cls: 'track', lbl: 'Tracking', det: 'Medpen ×4 angekommen · „Gladius aufrüsten“ 5 von 6' },
  ready: { cls: 'ready', lbl: 'App bereit', det: 'wartet auf Star Citizen' },
  off: { cls: 'off', lbl: 'App aus', det: 'zuletzt vor 3 Tagen', act: 'App starten' },
  miss: { cls: 'miss', lbl: 'App fehlt', det: 'liest Inventar und Schiffe aus dem Spiel', act: 'App downloaden' },
};
const PITCH = {
  hangar: 'Die App liest deine Schiffe und dein Inventar aus dem Spiel. Du tippst nichts ab.',
  start: 'Mit der App siehst du hier live, wo du bist, was du fliegst und was als Nächstes kommt.',
};
const dot = (cls) => `<i class="d0-dot ${cls}"></i>`;

/* ------------------------------------------------------------------ tiles */
function itemTiles(style) {
  return ITEMS.map(([n, q, w, , h]) => `<div class="d0-tile${style ? ' ' + style : ''}"><b class="nm">${n}</b><span class="qty">${q}</span><small class="where">${w}</small><span class="hint"><span>${h}</span><i class="d0-cart">${I.cart}</i></span></div>`).join('');
}
function addTile(label, style) {
  return `<div class="d0-tile add${style ? ' ' + style : ''}"><span class="plus">${I.plus}</span><span class="add-t">${label}</span></div>`;
}
function samTiles(style) {
  return SAMMLUNG.map(([n, k, t]) => `<div class="d0-tile sam ${t}${style ? ' ' + style : ''}"><b class="nm">${n}</b>${style === 'vit' ? '<span class="got">✓</span>' : ''}<small class="where">${k}</small><span class="hint"><span></span><i class="d0-cart">${I.cart}</i></span></div>`).join('');
}
const chipsInv = `<div class="d0-chips"><span class="d0-chip">Waffen<b>3</b></span><span class="d0-chip">Rüstung<b>2</b></span><span class="d0-chip">Material<b>2</b></span><span class="d0-chip">Sonstiges<b>2</b></span></div>`;
const chipsSam = `<div class="d0-chips"><span class="d0-chip">Blaupausen<b>2</b></span><span class="d0-chip">News<b>1</b></span><span class="d0-chip">Galerie<b>1</b></span><span class="d0-chip">Ruf</span></div>`;
const usedPill = `<span class="d0-used">${I.clock}<span>Kürzlich aufgebraucht</span><b>4 Medpen</b><small>48 Std.</small></span>`;
const ruf = `<div class="d0-ruf"><span class="ring"></span><span><b>Ruf · noch keine Datenquelle</b><small>Die App kann deinen Ruf später mitlesen. Bis dahin trägst du ihn von Hand ein.</small></span></div>`;
const pager = (txt) => `<span class="d0-pager"><span>${txt}</span><i>‹</i><i>›</i></span>`;

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
const layer = (a) => (a.length ? `<div class="anno-layer" data-anno-layer>\n${a.join('\n')}\n</div>` : '');

function screen(id, label, active, body, annos) {
  return `<section id="${id}" data-nav-label="${label}" data-screen${active ? ' data-screen-active="true"' : ' hidden'} data-screen-fit="full">
${body}
${layer(annos)}
</section>`;
}

/* ------------------------------------------------------------------ search dropdown (identical in all designs) */
function drop(p) {
  return `<div class="d0-drop">
  <p class="g">Im Inventar <b>2</b></p>
  <a class="r" href="#" data-screen-link="${p}-s1"><b>Arc<mark>light</mark>-<mark>Laser</mark>pistole</b><span>×1 · Area18 · Lager</span></a>
  <a class="r" href="#" data-screen-link="${p}-s1"><b>Lumin-<mark>Laser</mark>magazin</b><span>×4 · Lorville · Lager</span></a>
  <p class="g">Auch in deinem Bestand</p>
  <a class="r alt" href="#" data-screen-link="${p}-s4"><b>Arclight-<mark>Laser</mark>pistole</b><span>Sammlung · Blaupause</span></a>
  <p class="r none">Hangar · keine Treffer</p>
  <p class="g">Im Codex · nicht in deinem Bestand</p>
  <span class="r codex"><b><mark>Laser</mark>-Repeater M3A</b><span>Schiffswaffe · S3</span><em>${I.cart} Auf die Wunschliste</em></span>
  <span class="r codex"><b><mark>Laser</mark>-Repeater M4A</b><span>Schiffswaffe · S4</span><em>${I.cart} Auf die Wunschliste</em></span>
  <p class="foot">Enter öffnet den ersten Treffer · × am Chip sucht im ganzen Bestand</p>
</div>`;
}

/* ================================================================== DESIGN 1: Register */
function d1Chip(st, open, pitch) {
  if (open) {
    return `<div class="d1-pitch"><div class="t">${dot(st.cls)}<b>${st.lbl}</b><i class="cl">${I.x}</i></div><p>${pitch}</p><span class="d0-btn sec">${I.dl}${st.act}</span></div>`;
  }
  return `<span class="d1-chip ${st.cls}">${dot(st.cls)}<b>${st.lbl}</b><span class="det">${st.det}</span>${st.act ? `<em>${st.act}</em>` : ''}</span>`;
}
function d1Head(p, tab, counts) {
  const tabs = [['Inventar', I.crate, 's1', counts[0]], ['Hangar', I.ship, 's3', counts[1]], ['Sammlung', I.star, 's4', counts[2]]];
  const icon = tab === 'Inventar' ? I.crate : tab === 'Hangar' ? I.ship : I.star;
  return `<header class="d1-head"><div class="d1-title"><span class="d1-eyebrow">Bestand › ${tab}</span><h2><span class="d1-ti">${icon}</span>${tab}</h2></div>
<nav class="d1-tabs">${tabs.map(([n, ic, s, c]) => `<a class="d1-tab${n === tab ? ' on' : ''}" href="#" data-screen-link="${p}-${s}">${ic}${n}${c ? `<small>${c}</small>` : ''}</a>`).join('')}</nav>
<span class="d1-headr">${tab === 'Inventar' ? usedPill : ''}<span class="d0-ico">${I.dots}</span></span></header>`;
}
function d1App(p, page, scope, inner, status, opts = {}) {
  return `<div class="d0-app d1-app">${header()}${sub(p, page, scope, opts)}<div class="d0-body">${thinRail(p, page)}<main class="d0-page">${inner}</main></div>${fab}${status}${opts.typed ? drop(p) : ''}</div>`;
}
const C = ['9', '', '4'];
function d1() {
  const p = 'r';
  const inv = `${d1Head(p, 'Inventar', C)}<div class="d0-tools">${chipsInv}</div><div class="d0-grid">${addTile('Eintrag von Hand anlegen')}${itemTiles('')}</div><footer class="d0-foot">${pager('1–9 von 9')}</footer>`;
  const s1 = screen('r-s1', 'Inventar · Tracking', true, d1App(p, 'Bestand', 'Inventar', inv, d1Chip(ST.track)), [
    anno('r-a1', 1, 'bottom', '.d1-tabs', 46, 16, 'Jeder Bereich hat sein Symbol: Kiste, Schiff, Vitrine. Der Titel wechselt mit („Inventar“ statt immer „Bestand“), darüber steht klein „Bestand › Inventar“. Eine Zahl steht nur dort, wo etwas liegt. Reicht dir das, um zu wissen, wo du bist?'),
    anno('r-a2', 2, 'bottom', '.d0-chips', 22, 25, 'Kein „Alle“-Chip mehr: ohne Auswahl siehst du alles, ein gewählter Chip trägt ein × zum Zurücksetzen. Die Suche im Kopf der Seite entfällt, gesucht wird nur noch oben im Subheader. Fehlt dir ein Knopf für „alles zeigen“?'),
    anno('r-a3', 3, 'top', '.d1-chip', 22, 88, 'Der App-Status sitzt rechts neben dem Feedback-Knopf, nie darunter. Vier Zustände in vier Formen: voller Punkt = Tracking, Ring = App bereit, grauer Ring = App aus, gestrichelter Ring = App fehlt. Daneben steht, was die App zuletzt für diese Seite getan hat. Ist das klar genug?'),
  ]);
  const s2 = screen('r-s2', 'Suche im Subheader · App aus', false, d1App(p, 'Bestand', 'Inventar', inv, d1Chip(ST.off), { typed: 'laser' }), [
    anno('r-a4', 4, 'left', '.d0-drop', 70, 30, 'Die Subheader-Suche sucht zuerst im gewählten Bereich, dann im übrigen Bestand, zuletzt im Codex (was du nicht hast, mit „Auf die Wunschliste“). Das × am Chip weitet auf den ganzen Bestand. Diese Reihenfolge gilt in allen drei Richtungen gleich, die Regel selbst steht im Befund zur Wahl.'),
  ]);
  const hangarEmpty = `${d1Head(p, 'Hangar', C)}<div class="d1-empty"><span class="d1-eico">${I.ship}</span><b>Noch kein Schiff im Hangar.</b><span class="row"><span class="d0-btn">${I.plus}Schiff anlegen</span><span class="d0-btn sec">RSI-Hangar holen</span></span><small>Ingame-Schiffe trägt die App von selbst ein.</small></div>`;
  const s3 = screen('r-s3', 'Hangar leer · App fehlt', false, d1App(p, 'Bestand', 'Hangar', hangarEmpty, d1Chip(ST.miss, true, PITCH.hangar)), [
    anno('r-a5', 5, 'right', '.d1-empty', 50, 44, 'Leer heißt: ein Satz, ein Hauptknopf, ein zweiter Weg daneben, keine „0“, kein Pager, kein Raster mit einer einsamen Plus-Kachel. Passt das, oder soll die Plus-Kachel als gewohnter Einstieg bleiben?'),
    anno('r-a6', 6, 'top', '.d1-pitch', 18, 74, 'Ist die App noch nie verbunden, klappt der Status auf jeder HQ-Seite einmal zu dieser Karte auf, mit einem Satz, was die App genau hier bringt. Nach × bleibt nur der Chip „App fehlt“. Ist der Text richtig, und ist einmal pro Seite das richtige Maß?'),
  ]);
  const sam = `${d1Head(p, 'Sammlung', C)}<div class="d0-tools">${chipsSam}</div><div class="d0-grid short">${addTile('Blaupause anlegen')}${samTiles('')}</div>${ruf}<footer class="d0-foot">${pager('1–4 von 4')}</footer>`;
  const s4 = screen('r-s4', 'Sammlung · App bereit', false, d1App(p, 'Bestand', 'Sammlung', sam, d1Chip(ST.ready)), []);
  const start = d1Start(p, '');
  const s5 = screen('r-s5', 'HQ Start · App fehlt', false, d1App(p, 'Start', null, start, d1Chip(ST.miss)), [
    anno('r-a7', 7, 'top', '.d1-chip', 22, 88, 'Auf Start steht der Chip jetzt auch, aber zugeklappt: die Jetzt-Kachel trägt dieselbe Aussage mit denselben Wörtern („App fehlt“, „App downloaden“). Oder soll der Chip auf Start ganz fehlen, wie heute?'),
  ]);
  const s6 = screen('r-s6', 'Planen · Tracking', false, d1App(p, 'Planen', null, planen(), d1Chip(ST.trackPlan)), []);
  return [s1, s2, s3, s4, s5, s6].join('\n');
}
function d1Start(p, chip) {
  return `<div class="d0-hero"><small>HQ · ALPHA 4.4</small><h1>Willkommen zurück, Kommandant</h1></div>
<div class="d0-tiles"><a class="d0-st" href="#" data-screen-link="${p}-s1"><span class="k">${I.crate}BESTAND</span><b>Inventar 9 · Sammlung 4</b><small>Hangar noch leer</small></a>
<div class="d0-st mid"><span class="k">${I.pulse}JETZT</span><b>Kein Spiel erkannt</b><small>Die App fehlt. Mit ihr siehst du hier live, wo du bist und was als Nächstes kommt.</small><span class="d0-btn">${I.dl}App downloaden</span></div>
<a class="d0-st right" href="#" data-screen-link="${p}-s6"><span class="k">${I.plan}PLANEN</span><b>2 Nachschübe aktiv</b><small>„Gladius aufrüsten“ · 5 von 6</small></a></div>${chip}`;
}
function planen() {
  return `<header class="d1-head"><div class="d1-title"><span class="d1-eyebrow">HQ › Planen</span><h2><span class="d1-ti">${I.plan}</span>Planen</h2></div></header>
<div class="d0-slots"><div class="sl on"><b>Gladius aufrüsten</b><small>5 von 6 · 2 Einsätze</small></div><div class="sl"><b>Bergungs-Set</b><small>1 von 5 · 3 Einsätze</small></div><div class="sl free">+</div></div>
<div class="d0-plan"><h3>Gladius aufrüsten</h3><p><span class="ok">✓</span> Medpen ×4 · Port Tressler</p><p><span class="ok">✓</span> Lumin-Lasermagazin ×4</p><p>○ Laser-Repeater S3 ×2 · Area18, Centermass</p></div>`;
}

/* ================================================================== DESIGN 2: Räume */
const ROOMS = {
  Inventar: { cls: 'inv', icon: I.crate, sum: '9 Gegenstände an 4 Orten', s: 's1' },
  Hangar: { cls: 'han', icon: I.ship, sum: 'noch leer', s: 's3' },
  Sammlung: { cls: 'sam', icon: I.star, sum: '2 Blaupausen · 1 News · 1 Bild', s: 's4' },
};
function d2Src(st, inline) {
  return `<span class="d2-src ${st.cls}${inline ? ' inl' : ''}">${dot(st.cls)}<b>${st.lbl}</b><span>${st.det}</span>${st.act ? `<em>${st.act}</em>` : ''}</span>`;
}
function d2Rooms(p, room, st) {
  const r = ROOMS[room];
  return `<nav class="d2-rooms">${Object.entries(ROOMS).map(([n, o]) => `<a class="d2-room ${o.cls}${n === room ? ' on' : ''}" href="#" data-screen-link="${p}-${o.s}">${o.icon}<span><b>${n}</b><small>${o.sum}</small></span></a>`).join('')}<span class="d2-menu d0-ico">${I.dots}</span></nav>
<div class="d2-band ${r.cls}"><span class="d2-motif"></span><span class="d2-bt">${r.icon}<span><small>BESTAND</small><b>${room}</b></span></span>${d2Src(st)}</div>`;
}
function d2App(p, page, scope, inner, opts = {}) {
  return `<div class="d0-app d2-app">${header()}${sub(p, page, scope, opts)}<div class="d0-body">${thinRail(p, page)}<main class="d0-page">${inner}</main></div>${fab}${opts.typed ? drop(p) : ''}</div>`;
}
function d2() {
  const p = 'm';
  const inv = (st) => `${d2Rooms(p, 'Inventar', st)}<div class="d0-tools">${chipsInv}${usedPill}</div><div class="d0-grid">${addTile('Eintrag von Hand anlegen', 'shelf')}${itemTiles('shelf')}</div><footer class="d0-foot">${pager('1–9 von 9')}</footer>`;
  const s1 = screen('m-s1', 'Inventar · Tracking', true, d2App(p, 'Bestand', 'Inventar', inv(ST.track)), [
    anno('m-a1', 1, 'bottom', '.d2-rooms', 30, 17, 'Die drei Bereiche sind große Raum-Reiter mit Symbol und einer Zeile Inhalt („9 Gegenstände an 4 Orten“, „noch leer“), statt kleiner Pillen mit Zahl. Der aktive Raum geht nahtlos in sein Band über. Lieber so groß, oder kostet das zu viel Höhe für die Kacheln?'),
    anno('m-a2', 2, 'bottom', '.d2-band', 18, 30, 'Jeder Raum hat ein Motiv im Band: Lagerregal (Inventar), Landefeld (Hangar), Vitrine (Sammlung), dazu einen eigenen Farbton nur im Band und an den Kachelkanten. Rot bleibt für Admin. Farbton oder nur Motiv?'),
    anno('m-a3', 3, 'left', '.d2-src', 78, 30, 'Der App-Status wandert aus der Ecke in den Kopf der Seite, als Datenquelle des Raums: „Tracking · Inventar vor 2 Min. gelesen“ oder „App fehlt · liest Inventar und Schiffe …“. Unten links bleibt nur der Feedback-Knopf. Gefällt dir der Status als Teil der Seite?'),
  ]);
  const s2 = screen('m-s2', 'Suche im Subheader · App aus', false, d2App(p, 'Bestand', 'Inventar', inv(ST.off), { typed: 'laser' }), []);
  const empty = `${d2Rooms(p, 'Hangar', ST.miss)}<div class="d2-empty"><span class="d2-pad"><i></i><i></i><i></i>${I.ship}</span><b>Der Hangar ist leer.</b><small>${PITCH.hangar}</small><span class="row"><span class="d0-btn">${I.plus}Schiff anlegen</span><span class="d0-btn sec">RSI-Hangar holen</span></span></div>`;
  const s3 = screen('m-s3', 'Hangar leer · App fehlt', false, d2App(p, 'Bestand', 'Hangar', empty), [
    anno('m-a4', 4, 'right', '.d2-pad', 46, 48, 'Leer zeigt der Raum sein Motiv groß: ein leeres Landefeld, ein Satz, warum die App hier hilft, ein Hauptknopf. Der App-Hinweis steckt im Leerzustand selbst, nicht in einer eigenen Karte. Ist das zu verspielt?'),
  ]);
  const sam = `${d2Rooms(p, 'Sammlung', ST.ready)}<div class="d0-tools">${chipsSam}</div><div class="d0-grid short">${addTile('Blaupause anlegen', 'vit')}${samTiles('vit')}</div>${ruf}<footer class="d0-foot">${pager('1–4 von 4')}</footer>`;
  const s4 = screen('m-s4', 'Sammlung · App bereit', false, d2App(p, 'Bestand', 'Sammlung', sam), [
    anno('m-a5', 5, 'bottom', '.d0-grid', 40, 46, 'Sammlungs-Kacheln haben keine Menge, sondern ein Häkchen „freigeschaltet“, denn eine Blaupause hast du oder nicht. Ruf steht direkt unter dem Raster statt 230 px tiefer. Stimmt das Bild einer Vitrine für dich?'),
  ]);
  const start = `<div class="d0-hero"><small>HQ · ALPHA 4.4</small><h1>Willkommen zurück, Kommandant</h1>${d2Src(ST.miss, true)}</div>
<div class="d0-tiles"><a class="d0-st" href="#" data-screen-link="${p}-s1"><span class="k">${I.crate}BESTAND</span><b>Inventar 9 · Sammlung 4</b><small>Hangar noch leer</small></a>
<div class="d0-st mid"><span class="k">${I.pulse}JETZT</span><b>Kein Spiel erkannt</b><small>Mit der App siehst du hier live, wo du bist und was als Nächstes kommt.</small><span class="d0-btn">${I.dl}App downloaden</span></div>
<a class="d0-st right" href="#" data-screen-link="${p}-s6"><span class="k">${I.plan}PLANEN</span><b>2 Nachschübe aktiv</b><small>„Gladius aufrüsten“ · 5 von 6</small></a></div>`;
  const s5 = screen('m-s5', 'HQ Start · App fehlt', false, d2App(p, 'Start', null, start), [
    anno('m-a6', 6, 'bottom', '.d2-src.inl', 50, 26, 'Auf Start steht die Datenquelle als eine Zeile unter dem Gruß, auf jeder anderen HQ-Seite rechts im Seitenkopf. So sagt jede Seite an derselben Stelle, woher ihre Daten kommen. Oder auf Start lieber nur die Jetzt-Kachel?'),
  ]);
  const plan = planen().replace('</div></header>', `</div>${d2Src(ST.trackPlan)}</header>`);
  const s6 = screen('m-s6', 'Planen · Tracking', false, d2App(p, 'Planen', null, plan), []);
  return [s1, s2, s3, s4, s5, s6].join('\n');
}

/* ================================================================== DESIGN 3: Konsole */
function d3Rail(p, at, st, pitch) {
  const tree = (n, ic, s, c, kids, open) => `<a class="k${at === n ? ' on' : ''}" href="#" data-screen-link="${p}-${s}">${ic}<span>${n}</span>${c ? `<small>${c}</small>` : ''}</a>${open ? `<div class="kids">${kids.map(([kn, kc]) => `<span class="kid${kc ? '' : ' dim'}">${kn}${kc ? `<small>${kc}</small>` : ''}</span>`).join('')}</div>` : ''}`;
  const inBestand = ['Inventar', 'Hangar', 'Sammlung'].includes(at);
  return `<aside class="d3-rail">
<a class="top${at === 'Start' ? ' on' : ''}" href="#" data-screen-link="${p}-s5">${I.home}<span>Start</span></a>
<span class="top grp${inBestand ? ' on' : ''}">${I.crate}<span>Bestand</span></span>
<div class="tree${inBestand ? '' : ' shut'}">
${tree('Inventar', I.crate, 's1', '9', [['Waffen', '3'], ['Rüstung', '2'], ['Material', '2'], ['Sonstiges', '2']], at === 'Inventar')}
${tree('Hangar', I.ship, 's3', '', [['Pledge', ''], ['Ingame', ''], ['Leihschiff', '']], at === 'Hangar')}
${tree('Sammlung', I.star, 's4', '4', [['Blaupausen', '2'], ['Ruf', ''], ['News', '1'], ['Galerie', '1']], at === 'Sammlung')}
</div>
<span class="top">${I.pulse}<span>Jetzt</span></span>
<a class="top${at === 'Planen' ? ' on' : ''}" href="#" data-screen-link="${p}-s6">${I.plan}<span>Planen</span></a>
<span class="top">${I.chart}<span>Statistik</span></span>
<div class="d3-appp ${st.cls}"><span class="t">${dot(st.cls)}<b>${st.lbl}</b></span><small>${pitch || st.det}</small>${st.act ? `<span class="d0-btn sec sm">${st.act === 'App downloaden' ? I.dl : ''}${st.act}</span>` : ''}</div>
</aside>`;
}
function d3App(p, at, scope, inner, st, opts = {}) {
  return `<div class="d0-app d3-app">${header()}${sub(p, at, scope, { ...opts, noPages: true })}<div class="d0-body">${d3Rail(p, at, st, opts.pitch)}<main class="d0-page">${inner}</main></div>${fab}${opts.typed ? drop(p) : ''}</div>`;
}
function d3Head(icon, crumb, title, right = '') {
  return `<header class="d3-head"><span class="d3-ic">${icon}</span><div><small>${crumb}</small><h2>${title}</h2></div><span class="d1-headr">${right}<span class="d0-ico">${I.dots}</span></span></header>`;
}
function d3() {
  const p = 'k';
  const inv = `${d3Head(I.crate, 'Bestand', 'Inventar', usedPill)}<div class="d0-grid">${addTile('Eintrag von Hand anlegen')}${itemTiles('')}</div><footer class="d0-foot">${pager('1–9 von 9')}</footer>`;
  const s1 = screen('k-s1', 'Inventar · Tracking', true, d3App(p, 'Inventar', 'Inventar', inv, ST.track), [
    anno('k-a1', 1, 'right', '.d3-rail .tree', 12, 40, 'Bereiche und Filter sind ein Baum in der HQ-Leiste: Inventar klappt Waffen, Rüstung, Material, Sonstiges auf, Hangar Pledge, Ingame, Leihschiff, Sammlung Blaupausen bis Galerie. Ein Klick auf „Inventar“ zeigt alles, ein Klick auf „Waffen“ filtert. Reitern und Chips entfallen. Liest sich das schneller?'),
    anno('k-a2', 2, 'bottom', '.d0-sub', 36, 9, 'Weil die Leiste die HQ-Seiten mit Namen zeigt, trägt der Subheader nur noch die Suche. Die Leiste ist dafür 190 px breit statt 36 px und liegt nie über einer Kachel. Darf die Leiste so viel Platz nehmen?'),
    anno('k-a3', 3, 'right', '.d3-appp', 12, 84, 'Die App hat ein festes Feld am Fuß der Leiste, auf jeder HQ-Seite an derselben Stelle, Start eingeschlossen. Es zeigt Zustand, letzte Meldung und den einen Knopf, den der Zustand braucht. Nichts schwebt mehr. Passt das?'),
  ]);
  const s2 = screen('k-s2', 'Suche im Subheader · App aus', false, d3App(p, 'Inventar', 'Inventar', inv, ST.off, { typed: 'laser' }), []);
  const empty = `${d3Head(I.ship, 'Bestand', 'Hangar')}<div class="d1-empty"><span class="d1-eico">${I.ship}</span><b>Noch kein Schiff im Hangar.</b><span class="row"><span class="d0-btn">${I.plus}Schiff anlegen</span><span class="d0-btn sec">RSI-Hangar holen</span></span></div>`;
  const s3 = screen('k-s3', 'Hangar leer · App fehlt', false, d3App(p, 'Hangar', 'Hangar', empty, ST.miss, { pitch: PITCH.hangar }), [
    anno('k-a4', 4, 'right', '.d3-appp', 12, 80, 'Fehlt die App, sagt ihr Feld auf jeder Seite, was sie genau hier bringt (im Hangar: Schiffe aus dem Spiel lesen). Der Leerzustand selbst bleibt ruhig und erwähnt die App nicht noch einmal. Reicht das Feld, oder gehört der Satz in den Leerzustand?'),
  ]);
  const sam = `${d3Head(I.star, 'Bestand', 'Sammlung')}<div class="d0-grid short">${addTile('Blaupause anlegen')}${samTiles('')}</div>${ruf}<footer class="d0-foot">${pager('1–4 von 4')}</footer>`;
  const s4 = screen('k-s4', 'Sammlung · App bereit', false, d3App(p, 'Sammlung', 'Sammlung', sam, ST.ready), [
    anno('k-a5', 5, 'right', '.d3-rail .kid.dim', 10, 52, 'Zahlen stehen nur, wo etwas liegt; ein leerer Zweig („Ruf“, „Pledge“) bleibt grau, aber klickbar, und führt zu seinem Leerzustand. Oder leere Zweige ganz ausblenden?'),
  ]);
  const start = d1Start(p, '');
  const s5 = screen('k-s5', 'HQ Start · App fehlt', false, d3App(p, 'Start', null, start, ST.miss, { pitch: PITCH.start }), []);
  const s6 = screen('k-s6', 'Planen · Tracking', false, d3App(p, 'Planen', null, planen(), ST.trackPlan), []);
  return [s1, s2, s3, s4, s5, s6].join('\n');
}

/* ------------------------------------------------------------------ CSS */
const css = `<style>
.d0-app { --a:#52c1e6; --fg:#e8ebed; --fg2:#9fb3c8; --fg3:#6f8aa0; --line:rgba(159,179,200,.22); --ok:#5fd698; --warn:#f0c27b; --card:rgba(10,24,36,.85); --bg1:#0b1a26;
  position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:660px; box-sizing:border-box; overflow:hidden; color:var(--fg);
  font:13px/1.4 Inter, system-ui, "Segoe UI", sans-serif; text-align:left; background:radial-gradient(ellipse 130% 95% at 58% 0%, #0d1d2a 0%, #07121b 42%, #03080e 100%); }
.d0-app *, .d0-app *::before, .d0-app *::after { box-sizing:border-box; }
.d0-app svg { width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.d0-app a { color:inherit; text-decoration:none; }
.d0-mh { display:flex; align-items:center; gap:28px; flex:none; height:48px; padding:0 20px; border-bottom:1px solid var(--line); }
.d0-brand { display:flex; align-items:center; gap:8px; font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.1em; white-space:nowrap; }
.d0-logo { width:16px; height:16px; border:1.6px solid var(--a); transform:rotate(45deg); border-radius:3px; }
.d0-nav { display:flex; gap:22px; font:12px/1 Orbitron, system-ui, sans-serif; letter-spacing:.18em; color:var(--fg2); }
.d0-nav .on { color:var(--fg); border-bottom:2px solid var(--a); padding-bottom:6px; }
.d0-right { margin-left:auto; display:flex; align-items:center; gap:12px; color:var(--fg2); }
.d0-av { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#16324a; color:var(--fg); font-size:11px; }
.d0-ico { display:inline-grid; place-items:center; width:30px; height:30px; border-radius:50%; color:var(--fg2); }
.d0-sub { position:relative; display:flex; align-items:center; gap:18px; flex:none; height:44px; padding:0 20px; border-bottom:1px solid var(--line); }
.d0-pages { display:flex; gap:4px; }
.d0-pg { padding:6px 12px; border-radius:999px; color:var(--fg3); font-size:12px; }
.d0-pg.on { color:var(--fg); background:rgba(82,193,230,.12); }
.d0-sub-note { color:var(--fg3); font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; }
.d0-search { display:flex; align-items:center; gap:8px; margin-left:auto; width:430px; height:32px; padding:0 12px; border:1px solid var(--line); border-radius:999px; background:rgba(3,10,16,.7); color:var(--fg3); cursor:pointer; }
.d0-search.open { border-color:var(--a); box-shadow:0 0 0 1px var(--a); color:var(--fg); }
.d0-scope { display:inline-flex; align-items:center; gap:4px; padding:2px 6px 2px 9px; border-radius:999px; background:rgba(82,193,230,.16); color:var(--fg); font-size:11px; white-space:nowrap; }
.d0-scope i svg { width:11px; height:11px; }
.d0-ph { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.d0-typed { display:inline-flex; align-items:center; color:var(--fg); }
.d0-caret { width:1px; height:14px; margin-left:1px; background:var(--a); }
.d0-body { position:relative; display:flex; flex:1; min-height:0; }
.d0-rail { flex:none; display:flex; flex-direction:column; align-items:center; gap:6px; width:44px; padding:18px 0; border-right:1px solid var(--line); color:var(--fg3); }
.d0-rail > * { display:grid; place-items:center; width:32px; height:32px; border-radius:8px; }
.d0-rail .on { color:var(--a); background:rgba(82,193,230,.12); }
.d0-page { position:relative; display:flex; flex-direction:column; gap:12px; flex:1; min-width:0; min-height:0; padding:18px 28px 64px; }
.d0-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:999px; background:var(--a); color:#04121b; font-weight:600; font-size:12.5px; white-space:nowrap; }
.d0-btn.sec { background:transparent; color:var(--fg); border:1px solid var(--line); font-weight:500; }
.d0-btn.sm { padding:5px 10px; font-size:11.5px; }
.d0-tools { display:flex; align-items:center; gap:12px; flex:none; }
.d0-chips { display:flex; gap:8px; }
.d0-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 12px; border:1px solid var(--line); border-radius:999px; color:var(--fg2); font-size:12px; }
.d0-chip b { color:var(--fg3); font-weight:500; }
.d0-used { display:inline-flex; align-items:center; gap:8px; height:30px; margin-left:auto; padding:0 12px; border:1px solid rgba(240,194,123,.4); border-radius:999px; background:rgba(240,194,123,.06); color:var(--fg2); font-size:12px; white-space:nowrap; }
.d0-used svg { stroke:var(--warn); }
.d0-used b { color:var(--fg); font-weight:500; }
.d0-used small { color:var(--fg3); }
.d0-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(168px,1fr)); grid-auto-rows:100px; gap:10px; align-content:start; flex:none; }
.d0-tile { position:relative; display:flex; flex-direction:column; justify-content:space-between; min-width:0; padding:9px 12px; border:1px solid var(--line); border-radius:12px; background:linear-gradient(180deg, rgba(82,193,230,.05), var(--bg1)); }
.d0-tile .nm { font-size:12.5px; line-height:1.25; padding-right:4ch; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.d0-tile .qty { position:absolute; top:8px; right:11px; font:700 13px/1 Orbitron, system-ui, sans-serif; color:var(--a); }
.d0-tile .where { color:var(--fg3); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.d0-tile .hint { display:flex; align-items:center; justify-content:space-between; gap:4px; min-height:20px; color:var(--fg3); font-size:10.5px; }
.d0-cart svg { width:14px; height:14px; color:var(--fg3); }
.d0-tile.add { align-items:center; justify-content:center; gap:6px; border-style:dashed; border-color:rgba(82,193,230,.45); background:transparent; }
.d0-tile .plus { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; border:1.5px dashed rgba(82,193,230,.6); color:var(--a); }
.d0-tile .add-t { font-size:11.5px; color:var(--fg2); }
.d0-foot { position:absolute; left:28px; right:28px; bottom:14px; display:flex; justify-content:flex-end; }
.d0-pager { display:inline-flex; align-items:center; gap:10px; color:var(--fg3); font-size:12px; }
.d0-pager i { display:grid; place-items:center; width:26px; height:26px; border-radius:50%; border:1px solid var(--line); font-style:normal; }
.d0-ruf { display:flex; align-items:center; gap:12px; flex:none; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d0-ruf .ring { width:26px; height:26px; flex:none; border-radius:50%; border:2px dashed rgba(82,193,230,.5); }
.d0-ruf b { display:block; font-size:12.5px; } .d0-ruf small { color:var(--fg3); }
.d0-fab { position:absolute; left:16px; bottom:14px; z-index:3; display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#132a3b; border:1px solid var(--line); color:var(--fg2); }
.d0-dot { position:relative; display:inline-block; width:10px; height:10px; flex:none; border-radius:50%; }
.d0-dot.track { background:var(--ok); box-shadow:0 0 8px var(--ok); }
.d0-dot.ready { border:2px solid var(--ok); }
.d0-dot.off { border:2px solid var(--fg3); }
.d0-dot.miss { border:2px dashed var(--a); }
/* search dropdown */
.d0-drop { position:absolute; z-index:6; top:88px; right:20px; width:430px; padding:8px; border:1px solid var(--line); border-radius:14px; background:#0b1924; box-shadow:0 18px 40px rgba(0,0,0,.6); }
.d0-drop .g { margin:8px 8px 4px; color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.16em; text-transform:uppercase; }
.d0-drop .g b { color:var(--a); }
.d0-drop .r { display:flex; align-items:center; gap:10px; margin:0; padding:7px 8px; border-radius:8px; font-size:12.5px; }
.d0-drop a.r:first-of-type { background:rgba(82,193,230,.12); }
.d0-drop .r span { color:var(--fg3); font-size:11.5px; }
.d0-drop .r em { margin-left:auto; display:inline-flex; align-items:center; gap:4px; color:var(--a); font-style:normal; font-size:11.5px; }
.d0-drop .r em svg { width:13px; height:13px; }
.d0-drop .r.none { color:var(--fg3); font-size:11.5px; }
.d0-drop .r.codex b { color:var(--fg2); font-weight:500; }
.d0-drop mark { background:none; color:var(--a); }
.d0-drop .foot { margin:8px 8px 2px; color:var(--fg3); font-size:11px; }
/* start + planen */
.d0-hero { flex:none; padding:22px 0 6px; text-align:center; }
.d0-hero small { color:var(--fg3); font:11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; }
.d0-hero h1 { margin:8px 0 0; font:600 28px/1.2 Orbitron, system-ui, sans-serif; letter-spacing:.04em; }
.d0-tiles { display:grid; grid-template-columns:1fr 1.25fr 1fr; gap:26px; padding-top:18px; }
.d0-st { display:flex; flex-direction:column; gap:6px; padding:16px 10px 0; border-top:2px solid rgba(82,193,230,.4); }
.d0-st.mid { align-items:center; text-align:center; border-top-color:var(--fg3); }
.d0-st .k { display:flex; align-items:center; gap:8px; font:600 11px/1 Orbitron, system-ui, sans-serif; letter-spacing:.18em; color:var(--fg2); }
.d0-st b { font-size:19px; font-weight:600; } .d0-st small { color:var(--fg2); max-width:34ch; }
.d0-slots { display:flex; gap:10px; }
.d0-slots .sl { flex:0 0 190px; height:80px; padding:10px; border:1px solid var(--line); border-radius:10px; background:linear-gradient(160deg, rgba(82,193,230,.12), rgba(8,20,30,.9)); }
.d0-slots .sl.on { border-color:var(--a); box-shadow:0 0 0 1px var(--a); }
.d0-slots .sl b { display:block; font-size:12px; } .d0-slots .sl small { color:var(--fg2); font-size:11px; }
.d0-slots .sl.free { display:grid; place-items:center; border-style:dashed; background:transparent; color:var(--fg3); font-size:22px; }
.d0-plan { padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d0-plan h3 { margin:0 0 8px; font-size:13px; } .d0-plan p { margin:4px 0; color:var(--fg2); } .d0-plan .ok { color:var(--ok); }
/* ---------- D1 Register */
.d1-head { display:flex; align-items:flex-end; gap:22px; flex:none; }
.d1-title { display:flex; flex-direction:column; gap:4px; }
.d1-eyebrow { color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; }
.d1-head h2 { display:flex; align-items:center; gap:10px; margin:0; font:600 22px/1.15 Orbitron, system-ui, sans-serif; letter-spacing:.03em; }
.d1-ti { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; background:rgba(82,193,230,.12); color:var(--a); }
.d1-ti svg { width:20px; height:20px; }
.d1-tabs { display:inline-flex; padding:3px; border:1px solid var(--line); border-radius:999px; background:rgba(3,10,16,.6); }
.d1-tab { display:inline-flex; align-items:center; gap:7px; height:32px; padding:0 14px; border-radius:999px; color:var(--fg2); }
.d1-tab small { color:var(--fg3); font-size:11px; }
.d1-tab.on { color:var(--fg); background:rgba(82,193,230,.2); box-shadow:0 0 0 1px var(--a); }
.d1-tab.on svg { color:var(--a); }
.d1-headr { margin-left:auto; display:flex; align-items:center; gap:10px; }
.d1-empty { display:flex; flex-direction:column; align-items:center; gap:10px; margin:40px auto 0; text-align:center; }
.d1-eico { display:grid; place-items:center; width:64px; height:64px; border-radius:50%; border:1.5px dashed rgba(82,193,230,.5); color:var(--a); }
.d1-eico svg { width:30px; height:30px; }
.d1-empty b { font-size:16px; } .d1-empty small { color:var(--fg3); } .d1-empty .row { display:flex; gap:10px; }
.d1-chip { position:absolute; left:72px; bottom:20px; z-index:3; display:inline-flex; align-items:center; gap:8px; max-width:520px; height:32px; padding:0 12px; border:1px solid var(--line); border-radius:999px; background:rgba(6,16,24,.92); font-size:12px; white-space:nowrap; }
.d1-chip.track { border-color:rgba(95,214,152,.5); }
.d1-chip .det { color:var(--fg3); overflow:hidden; text-overflow:ellipsis; }
.d1-chip em { margin-left:4px; color:var(--a); font-style:normal; }
.d1-pitch { position:absolute; left:72px; bottom:20px; z-index:3; width:330px; padding:12px 14px; border:1px solid rgba(82,193,230,.45); border-radius:14px; background:rgba(6,16,24,.96); box-shadow:0 14px 34px rgba(0,0,0,.55); }
.d1-pitch .t { display:flex; align-items:center; gap:8px; } .d1-pitch .cl { margin-left:auto; color:var(--fg3); }
.d1-pitch p { margin:8px 0 10px; color:var(--fg2); }
/* ---------- D2 Räume */
.d2-app .d0-page { gap:0; }
.d2-rooms { display:flex; align-items:flex-end; gap:8px; flex:none; }
.d2-room { display:flex; align-items:center; gap:10px; width:230px; padding:10px 14px; border:1px solid var(--line); border-bottom:0; border-radius:12px 12px 0 0; color:var(--fg2); background:rgba(3,10,16,.5); }
.d2-room svg { width:22px; height:22px; }
.d2-room b { display:block; color:var(--fg); font-size:13px; } .d2-room small { color:var(--fg3); font-size:11px; }
.d2-room.on { --t:var(--a); padding-bottom:14px; color:var(--t); background:var(--bandbg); border-color:var(--t); }
.d2-room.inv { --t:#52c1e6; --bandbg:linear-gradient(180deg, rgba(82,193,230,.16), rgba(82,193,230,.08)); }
.d2-room.han { --t:#8aa8ff; --bandbg:linear-gradient(180deg, rgba(138,168,255,.16), rgba(138,168,255,.08)); }
.d2-room.sam { --t:#d9b866; --bandbg:linear-gradient(180deg, rgba(217,184,102,.16), rgba(217,184,102,.08)); }
.d2-menu { margin-left:auto; align-self:center; }
.d2-band { position:relative; display:flex; align-items:center; gap:16px; flex:none; height:64px; margin-bottom:12px; padding:0 18px; border:1px solid var(--t); border-radius:0 12px 12px 12px; overflow:hidden; }
.d2-band.inv { --t:#52c1e6; background:rgba(82,193,230,.08); } .d2-band.han { --t:#8aa8ff; background:rgba(138,168,255,.08); } .d2-band.sam { --t:#d9b866; background:rgba(217,184,102,.08); }
.d2-motif { position:absolute; inset:0; opacity:.35; pointer-events:none; }
.d2-band.inv .d2-motif { background:repeating-linear-gradient(90deg, transparent 0 46px, rgba(82,193,230,.35) 46px 47px), repeating-linear-gradient(0deg, transparent 0 20px, rgba(82,193,230,.25) 20px 21px); }
.d2-band.han .d2-motif { background:repeating-linear-gradient(135deg, transparent 0 18px, rgba(138,168,255,.3) 18px 26px); -webkit-mask:linear-gradient(90deg, transparent 40%, #000); mask:linear-gradient(90deg, transparent 40%, #000); }
.d2-band.sam .d2-motif { background:radial-gradient(circle at 80% 50%, rgba(217,184,102,.45), transparent 55%), repeating-linear-gradient(90deg, transparent 0 80px, rgba(217,184,102,.3) 80px 81px); }
.d2-bt { position:relative; display:flex; align-items:center; gap:10px; color:var(--t); }
.d2-bt svg { width:26px; height:26px; }
.d2-bt small { display:block; color:var(--fg3); font:600 9.5px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; }
.d2-bt b { display:block; color:var(--fg); font:600 20px/1.2 Orbitron, system-ui, sans-serif; letter-spacing:.03em; }
.d2-src { position:relative; margin-left:auto; display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; background:rgba(3,10,16,.75); border:1px solid var(--line); font-size:12px; white-space:nowrap; }
.d2-src span { color:var(--fg3); } .d2-src em { color:var(--a); font-style:normal; }
.d2-src.inl { margin:12px auto 0; }
.d2-app .d1-head .d2-src { align-self:center; }
.d0-tile.shelf { border-bottom:3px solid rgba(82,193,230,.35); }
.d0-tile.vit { border-color:rgba(217,184,102,.35); background:linear-gradient(180deg, rgba(217,184,102,.07), var(--bg1)); }
.d0-tile.vit .plus { border-color:rgba(217,184,102,.6); color:#d9b866; }
.d0-tile .got { position:absolute; top:7px; right:10px; color:#d9b866; font-weight:700; }
.d2-empty { display:flex; flex-direction:column; align-items:center; gap:10px; margin-top:24px; text-align:center; }
.d2-empty b { font-size:16px; } .d2-empty small { max-width:46ch; color:var(--fg2); } .d2-empty .row { display:flex; gap:10px; }
.d2-pad { position:relative; display:grid; place-items:center; width:170px; height:110px; color:#8aa8ff; }
.d2-pad i { position:absolute; border:1.5px solid rgba(138,168,255,.4); border-radius:50%; transform:scaleY(.42); }
.d2-pad i:nth-child(1) { inset:0; } .d2-pad i:nth-child(2) { inset:18px 30px; border-style:dashed; } .d2-pad i:nth-child(3) { inset:36px 60px; }
.d2-pad svg { position:relative; width:34px; height:34px; opacity:.55; }
/* ---------- D3 Konsole */
.d3-rail { flex:none; position:relative; display:flex; flex-direction:column; gap:2px; width:190px; padding:14px 10px; border-right:1px solid var(--line); background:rgba(3,10,16,.45); color:var(--fg2); }
.d3-rail .top, .d3-rail .k { display:flex; align-items:center; gap:9px; height:30px; padding:0 8px; border-radius:8px; font-size:12.5px; }
.d3-rail .top.on:not(.grp) { color:var(--fg); background:rgba(82,193,230,.14); }
.d3-rail .top.grp.on { color:var(--fg); }
.d3-rail .tree { margin:0 0 4px 14px; padding-left:8px; border-left:1px solid var(--line); }
.d3-rail .tree.shut { display:none; }
.d3-rail .k small, .d3-rail .kid small { margin-left:auto; color:var(--fg3); font-size:11px; }
.d3-rail .k.on { color:var(--fg); background:rgba(82,193,230,.18); box-shadow:inset 2px 0 0 var(--a); }
.d3-rail .k.on svg { color:var(--a); }
.d3-rail .kids { display:flex; flex-direction:column; margin:2px 0 4px 24px; }
.d3-rail .kid { display:flex; align-items:center; height:24px; padding:0 8px; border-radius:6px; color:var(--fg2); font-size:12px; }
.d3-rail .kid.dim { color:var(--fg3); opacity:.7; }
.d3-appp { margin-top:auto; display:flex; flex-direction:column; gap:6px; padding:10px; border:1px solid var(--line); border-radius:12px; background:rgba(6,16,24,.9); }
.d3-appp.track { border-color:rgba(95,214,152,.45); } .d3-appp.miss { border-color:rgba(82,193,230,.45); }
.d3-appp .t { display:flex; align-items:center; gap:8px; font-size:12.5px; }
.d3-appp small { color:var(--fg3); font-size:11px; line-height:1.35; }
.d3-rail { padding-bottom:70px; }
.d3-head { display:flex; align-items:center; gap:12px; flex:none; }
.d3-ic { display:grid; place-items:center; width:40px; height:40px; border-radius:12px; background:rgba(82,193,230,.12); color:var(--a); }
.d3-ic svg { width:22px; height:22px; }
.d3-head small { color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; }
.d3-head h2 { margin:3px 0 0; font:600 22px/1.15 Orbitron, system-ui, sans-serif; }
.d3-app .d0-foot { left:28px; }
</style>`;

/* ------------------------------------------------------------------ analysis view */
function opt(name, id, label, cons, rec, type = 'radio') {
  const nm = type === 'checkbox' ? `dm-${name}.${id}` : `dm-${name}`;
  return `<label data-opt="${id}"${rec ? ' data-recommended' : ''}><input type="${type}" name="${nm}" value="${id}"${rec ? ' checked' : ''}><span data-opt-label>${label}</span><span data-opt-consequence>${cons}</span></label>`;
}
function dec(o) {
  const t = o.mode === 'multi' ? 'checkbox' : 'radio';
  const opts = o.opts.map((x) => opt(o.id, x[0], x[1], x[2], x[3], t)).join('\n        ');
  const alt = o.mode === 'yesnoalt' ? `\n        <label data-opt="alt"><input type="radio" name="dm-${o.id}" value="alt"><span data-opt-label>Anders …</span><input type="text" name="dm-${o.id}-alt" placeholder="Was stattdessen?" value=""></label>` : '';
  return `    <section id="${o.id}" data-nav-label="${o.nav}" data-decision="${o.id}" data-decision-mode="${o.mode}" data-label="${o.label}" data-rec="${o.rec}" data-rec-why="${o.why}" data-applies-to="${o.applies}" data-finding="f-${o.id}">
      <p data-applies>Gilt für: ${o.applies}</p>
      <p data-situation>${o.sit}</p>
      <h3 data-question>${o.q}</h3>
      <p data-stakes>${o.stakes}</p>
      <div data-options>
        ${opts}${alt}
      </div>
      <textarea data-comment="${o.id}-note" placeholder="Notiz (optional)"></textarea>
      <div data-alevel="3" data-title="${o.nav}">
        <div data-slot="short"><div data-viz="text" data-viz-spec='${JSON.stringify({ text: o.short })}'></div></div>
        <div data-slot="long">${o.long}</div>
      </div>
    </section>`;
}
const tbl = (columns, rows) => `<div data-viz="table" data-viz-spec='${JSON.stringify({ columns, rows }).replace(/'/g, '&#39;')}'></div>`;

const D = {
  alle: { id: 'q-alle', nav: 'Kein „Alle“-Chip', mode: 'single', label: 'Filter ohne Auswahl', rec: 'none',
    why: 'Ein Filter ohne Auswahl zeigt ohnehin alles. Ein eigener „Alle“-Chip doppelt das und zeigt bei leerem Bestand „Alle 0“.',
    applies: 'die Filter in Inventar, Hangar und Sammlung',
    sit: 'Fest steht (deine Vorgabe): kein „Alle 0“. Heute ist „Alle N“ der erste Chip, nur im Inventar, immer mit Zahl (`hq-stock.component.ts:110`). Die übrigen Chips verschwinden bei 0.',
    q: 'Wie zeigt ein Bereich „alles“, wenn kein Filter gewählt ist?', stakes: 'Ob der Filter ein eigenes Bedienelement für „nichts gefiltert“ braucht.',
    opts: [['none', 'Kein „Alle“-Chip, ein gewählter Filter trägt ein ×', 'Ohne Auswahl siehst du alles. Die Zahl je Filter bleibt, nur wo etwas liegt.', true],
      ['nozero', '„Alle“ bleibt, ohne Zahl', 'Ein fester Rücksprung, aber ein Chip mehr, der nichts filtert.'],
      ['hide', '„Alle N“ bleibt, verschwindet bei leerem Bereich', 'Wie heute, nur ohne „Alle 0“. Bei einem Gegenstand steht „Alle 1“ neben „Waffen 1“.']],
    short: 'Empfehlung: kein Alle-Chip, × am aktiven Filter.', long: '<p>Gilt in jeder Richtung gleich: in den Reitern und Chips, im Raum-Band und im Baum der Leiste („Inventar“ anklicken = alles).</p>' },
  filter: { id: 'q-filter', nav: 'Filter in Hangar und Sammlung', mode: 'multi', label: 'Filter je Bereich', rec: 'origin kind',
    why: 'Herkunft ist im Hangar schon gespeichert (`hangar_ships.origin`), die Sammlungsarten auch (Blaupausen, Ruf, News, Galerie). Rollen müssten erst aus dem Codex abgeleitet werden.',
    applies: 'Hangar und Sammlung (Inventar behält Waffen, Rüstung, Material, Sonstiges)',
    sit: 'Heute hat nur das Inventar Filter. Der Hangar mit fünf Schiffen hat weder Filter noch Suche, die Sammlung auch nicht.',
    q: 'Welche Filter bekommen Hangar und Sammlung?', stakes: 'Ob alle drei Bereiche gleich bedient werden.',
    opts: [['origin', 'Hangar: Pledge, Ingame, Leihschiff', 'Aus vorhandenen Daten, sofort baubar.', true],
      ['role', 'Hangar: Rolle (Kampf, Fracht, Bergbau, Bergung …)', 'Braucht eine Rolle pro Schiff aus dem Codex.'],
      ['kind', 'Sammlung: Blaupausen, Ruf, News, Galerie', 'Aus vorhandenen Daten.', true],
      ['place', 'Inventar: zusätzlich nach Ort', 'Area18, Lorville, Schiff … als zweite Chip-Reihe.']],
    short: 'Empfehlung: Herkunft im Hangar, Art in der Sammlung.', long: '<p>Die Filter erscheinen nur, wenn der Bereich mehr als einen Wert hat. Ein einziger Wert („alles Pledge“) braucht keinen Filter.</p>' },
  search: { id: 'q-search', nav: 'Reihenfolge der Subheader-Suche', mode: 'single', label: 'Suche im Bestand', rec: 'tiered',
    why: 'So findest du zuerst, was du gerade ansiehst, verlierst aber nichts aus den anderen Bereichen und kannst Fehlendes direkt wünschen.',
    applies: 'die Suche oben im Subheader auf der Seite Bestand',
    sit: 'Fest steht (deine Vorgabe): gesucht wird im Subheader, die Seitensuche im Inventar-Kopf entfällt. Heute laufen beide Suchen getrennt, ohne Abgleich. Der Chip im Subheader zeigt auf jedem Reiter „Inventar“, auch in der Sammlung.',
    q: 'In welcher Reihenfolge zeigt die Subheader-Suche ihre Treffer?', stakes: 'Was oben steht, wenn du im Bestand tippst.',
    opts: [['tiered', 'Aktiver Bereich, dann übriger Bestand, dann Codex', 'Der Chip folgt dem Reiter (Inventar, Hangar, Sammlung). Das × am Chip sucht im ganzen Bestand. Codex-Treffer stehen zuletzt, mit „Auf die Wunschliste“.', true],
      ['own', 'Nur aktiver Bereich, Rest über das ×', 'Ruhige Liste. Was in einem anderen Bereich liegt, siehst du erst nach dem ×.'],
      ['all', 'Immer ganzer Bestand, nach Bereich gruppiert', 'Der aktive Bereich steht als erste Gruppe, der Chip entfällt.']],
    short: 'Empfehlung: Bereich › Bestand › Codex.', long: '<p>Steht im aktiven Bereich nichts, heißt es nie „Nichts gefunden“, sondern „Nichts im Inventar, 1 in der Sammlung“. Betroffen: `search-context.ts:138` (`hqContext`), die Specs `search-context`, `search-compose`, `search-cta`.</p>' },
  sets: { id: 'q-sets', nav: 'Spind-Sets im Bestand', mode: 'single', label: 'Wo Sets erscheinen', rec: 'inv',
    why: 'Ein Set ist eine Zusammenstellung aus deinem Inventar. Als Filter im Inventar findest du es dort, wo seine Teile liegen, ohne vierten Bereich.',
    applies: 'Spind-Sets (/hq/locker) und die Bestand-Kachel auf Start',
    sit: 'Die Bestand-Kachel auf Start zählt „5 Schiffe, 2 Sets“. Im Bestand selbst tauchen die Sets nirgends auf, sie leben nur unter /hq/locker.',
    q: 'Wo zeigt der Bestand deine Spind-Sets?', stakes: 'Ob die Zahl auf Start zu dem passt, was du im Bestand findest.',
    opts: [['inv', 'Im Inventar als Filter „Sets“', 'Ein Set ist eine Kachel, die zum Set-Editor führt.', true],
      ['sam', 'In der Sammlung', 'Neben Blaupausen, als Wissen „so rüste ich mich aus“.'],
      ['out', 'Gar nicht, Start zählt keine Sets mehr', 'Sets bleiben im Spind, die Start-Kachel nennt nur Inventar, Hangar, Sammlung.']],
    short: 'Empfehlung: Sets als Inventar-Filter.', long: '<p>Gefunden vom Design-Audit auf der Live-Seite. Der Deep-Link-Vertrag `hqStockLink({ tab, cat })` bekäme dafür die Kategorie `sets`.</p>' },
  states: { id: 'q-states', nav: 'App-Zustände', mode: 'single', label: 'Zustände des App-Status', rec: 'four',
    why: '„App läuft, Star Citizen nicht“ ist heute der häufigste Grund für „verbunden, aber es passiert nichts“. Er braucht einen eigenen Namen.',
    applies: 'den App-Status auf allen HQ-Seiten und die Jetzt-Kachel auf Start',
    sit: 'Fest steht (deine Vorgabe): im UI heißt es „App“, nie „Companion“; das betrifft 26 Texte (`hq.ticker.app`, `hq.now.connect.*`, `hq.app.*`). Heute kennt der Ticker nur grün (eingecheckt in 30 Tagen oder Spiel live) und grau.',
    q: 'Welche Zustände zeigt der App-Status?', stakes: 'Ob du siehst, warum gerade nichts ankommt.',
    opts: [['four', 'Vier: App fehlt, App aus, App bereit, Tracking', 'Je Zustand eine Form (gestrichelter Ring, grauer Ring, Ring, voller Punkt), nicht nur eine Farbe.', true],
      ['three', 'Drei: App fehlt, App aus, verbunden', '„Bereit“ und „Tracking“ fallen zusammen, wie heute.'],
      ['five', 'Fünf: zusätzlich „App nicht angemeldet“', 'Für eine App, die läuft, aber zu keinem Konto gehört.']],
    short: 'Empfehlung: vier Zustände, je eine Form.', long: tbl(['Zustand', 'Woran erkannt', 'Knopf'], [['App fehlt', 'nie eingecheckt, kein lokaler Merker', 'App downloaden'], ['App aus', 'eingecheckt, aber kein Lebenszeichen seit 3 Min.', 'App starten'], ['App bereit', 'Lebenszeichen, `presence.gameRunning` falsch', 'keiner'], ['Tracking', 'Lebenszeichen und Spiel läuft', 'keiner, letzte Meldung daneben']]) },
  visible: { id: 'q-visible', nav: 'Status auch ohne App und auf Start', mode: 'yesnoalt', label: 'Sichtbarkeit des App-Status', rec: 'yes',
    why: 'Wer die App nicht hat, sieht heute nichts und erfährt nie, was sie auf dieser Seite bringen würde. Genau das war deine Kritik.',
    applies: 'alle HQ-Seiten inklusive Start',
    sit: 'Die Nachschub-Spec legte fest: Ticker nur auf HQ-Seiten außer Start und erst, wenn die App je verbunden war (`hq-live-ticker.util.ts:37`). Diese Frage würde das ablösen.',
    q: 'Zeigt sich der App-Status auf jeder HQ-Seite, auch auf Start und ohne App?', stakes: 'Ob Neue die App überhaupt kennenlernen.',
    opts: [['yes', 'Ja, überall, auch „App fehlt“', 'Bei „App fehlt“ einmal pro Seite mit einem Satz, was sie hier bringt, danach nur noch klein. Auf Geräten ohne Installationsmöglichkeit (Phone) bleibt er weg.', true],
      ['no', 'Nein, wie bisher erst nach der ersten Verbindung', 'Neue lernen die App nur über die Jetzt-Kachel kennen.']],
    short: 'Empfehlung: überall, auch ohne App.', long: tbl(['Seite', 'Satz bei „App fehlt“'], [['Start', 'Mit der App siehst du hier live, wo du bist und was als Nächstes kommt.'], ['Bestand', 'Die App liest dein Inventar und deine Schiffe aus dem Spiel. Du tippst nichts ab.'], ['Jetzt', 'Die App meldet, wo du gerade bist, und hakt Schritte von selbst ab.'], ['Planen', 'Die App erkennt, wann ein Nachschub-Posten ankommt, und schließt ihn.'], ['Statistik', 'Ohne App keine Spielzeit, keine Sessions, keine Verluste.']]) },
  empty: { id: 'q-empty', nav: 'Leerer Bereich', mode: 'single', label: 'Leerzustand', rec: 'sentence',
    why: 'Eine einsame Plus-Kachel mit „0–0 von 0“ sagt nicht, was zu tun ist. Ein Satz mit einem Knopf schon.',
    applies: 'Inventar, Hangar und Sammlung ohne Inhalt, und die Zahlen an den Reitern',
    sit: 'Heute: leerer Bereich = Plus-Kachel, „Alle 0“, „0–0 von 0“ und inaktive Pager-Pfeile. Kein Satz, kein Hinweis auf die App. Der Ruf-Kasten der Sammlung ist der einzige erklärende Leerzustand.',
    q: 'Was zeigt ein leerer Bereich?', stakes: 'Ob Neue verstehen, wie etwas in den Bestand kommt.',
    opts: [['sentence', 'Ein Satz, ein Hauptknopf, ein zweiter Weg; keine 0, kein Pager', 'Hangar: „Schiff anlegen“, daneben „RSI-Hangar holen“. Reiter ohne Inhalt tragen keine Zahl.', true],
      ['plus', 'Plus-Kachel bleibt, darüber ein Satz', 'Der gewohnte Einstieg bleibt, der Satz erklärt ihn.'],
      ['ghost', 'Geister-Kacheln zeigen, wie es gefüllt aussieht', 'Drei blasse Beispielkacheln hinter dem Satz.']],
    short: 'Empfehlung: ein Satz, ein Knopf, keine Null.', long: '<p>Die Suche ohne Treffer folgt derselben Regel: ein Satz, wo es stattdessen etwas gibt.</p>' },
  frame: { id: 'q-frame', nav: 'Rahmen der Seite', mode: 'single', label: 'Höhe und Freiräume', rec: 'paged',
    why: 'Die Spec will auf dem Desktop nie einen Seiten-Scroll im Bestand. Die Schnitte entstehen nicht durch das Blättern, sondern weil Leiste, β-Knopf und Feedback-Knopf nicht als belegt gelten.',
    applies: 'das Raster, den Fuß mit Pager und den App-Status',
    sit: 'Gemessen: Pager unter dem β-Knopf (1366 und 1024 breit), die Leiste über der Plus-Kachel, der Feedback-Knopf über dem Ticker (bei 768 nur „anion-App“ lesbar), der Ruf-Kasten 230 px unter dem Raster, bei 768 hoch 290 px Leere über „Bestand“.',
    q: 'Wie sichern wir, dass nichts angeschnitten oder verdeckt wird?', stakes: 'Ob Kacheln, Pager und Status auf jeder Breite frei bleiben.',
    opts: [['paged', 'Blättern bleibt, belegte Zonen werden ausgespart', 'Raster misst seine Fläche ohne Leiste, β- und Feedback-Knopf (`--sc-fab-clear-*`). Ruf direkt unter dem Raster, die Seite nur so hoch wie nötig.', true],
      ['scroll', 'Raster scrollt in sich', 'Kein Pager mehr, aber ein zweiter Scrollbereich in der Seite.'],
      ['grow', 'Seite wächst mit dem Inhalt', 'Kein Blättern, Bestand wird so lang wie nötig, das 100-vh-Seitenmuster bricht.']],
    short: 'Empfehlung: Blättern behalten, Zonen aussparen.', long: '<p>Die Kleinigkeiten fixt der Bau ohne Frage: der abgeschnittene Platzhalter „Im Inventar such“ fällt mit der Seitensuche weg, die Wortmarke „VERSE COMPANI…“ bei 1024 und 768 bekommt Platz, auf dem Phone überdeckt der Kopf nicht mehr die Bestand-Zeile.</p>' },
};

const findings = tbl(['Befund', 'Wo', 'Ursache'], [
  ['Platzhalter „Im Inventar such“ abgeschnitten', 'alle Breiten', 'Seitensuche `width: 14ch`'],
  ['Pager liegt unter dem β-Knopf', '1366 und 1024 breit, 768 hoch', 'Fuß ignoriert den festen Knopf'],
  ['Leiste überdeckt die Plus-Kachel', '1366 und 1024', 'Rail fixed, 36 px, ohne Abstand'],
  ['Feedback-Knopf über dem App-Ticker', '1366, 1024, 768', 'beide fixed unten links'],
  ['„VERSE COMPANI…“ abgeschnitten', '1024 und 768', 'Wortmarke 166 px in 156 px'],
  ['Ruf-Kasten 230 px unter dem Raster', 'Sammlung', 'Raster `flex: 1`'],
  ['„Inventar“ viermal: Leiste, Reiter, Such-Chip, Abschnitt', 'Bestand', 'Seite heißt Bestand, Anker `#inventar`'],
  ['Such-Chip zeigt „Inventar“ auch in der Sammlung', 'Subheader', '`hqContext` kennt nur die Seite, nicht den Reiter'],
  ['Zwei Suchen, nicht abgeglichen', 'Subheader + Inventar-Kopf', 'lokales `q`-Signal'],
  ['App-Status: nur grün/grau, ohne App unsichtbar', 'alle HQ-Seiten außer Start', '`tickerVisible`'],
]);

const view = `  <section data-view="d0-befund" data-view-kind="analysis" data-analysis="full" data-nav-label="Befund und Regeln" hidden>
    <section id="d0-brief" data-analysis-briefing data-nav-label="Briefing">
      <p data-briefing-what>Bestand bekommt eine klare Ordnung: drei Bereiche mit eigenem Gesicht, eine Suche oben, ehrliche Leerzustände und einen App-Status, der überall gleich spricht und erklärt, was die App auf der jeweiligen Seite bringt.</p>
      <p data-briefing-why>Drei Agents haben die Seite geprüft: ein Design-Audit auf der Live-Seite in fünf Breiten, eine Spielersicht und eine Code- und Abhängigkeitskarte. Das Wort „Inventar“ steht viermal mit verschiedener Bedeutung, es gibt zwei Suchen, der App-Status kennt nur zwei Zustände und fehlt, wer die App nicht hat.</p>
      <div data-briefing-potential data-viz="kpi" data-viz-spec='{"value":"2 → 1","unit":"Suchen","label":"Seitensuche fällt weg, der Subheader sucht Bereich, Bestand und Codex"}'>2 → 1</div>
      <a data-briefing-topic="d0-t1" data-share="45">Struktur und Suche</a>
      <a data-briefing-topic="d0-t2" data-share="55">App-Status, Leerzustand, Rahmen</a>
      <p data-briefing-duration>≈ 7 min</p>
      <div data-alevel="1" data-title="Briefing">
        <div data-slot="short"><div data-viz="kpi" data-viz-spec='{"value":"10","unit":"Befunde"}'></div></div>
        <div data-slot="long">${findings}<p>Abhängigkeiten, die der Umbau nicht brechen darf: der Deep-Link <code>hqStockLink({ tab, cat, focus })</code> (genutzt von Codex-Besitzkarte, Pfad-Knoten, Schnellzugriff), der Anker <code>#inventar</code> mit Alias <code>#bestand</code>, die Suchkontexte in <code>search-context.ts</code> samt drei Spec-Dateien, <code>HqPagesComponent</code> als Gastgeber von Bestand und Ticker. Gesetzt aus früheren Concepts und hier nicht neu gefragt: Seitenfolge Start · Bestand · Jetzt · Planen · Statistik, die Wörter Inventar · Hangar · Sammlung, „Kürzlich aufgebraucht“, kein Nachschub-Reiter, Rot nur für Admin.</p></div>
      </div>
    </section>
    <section id="d0-t1" data-topic data-nav-label="Struktur und Suche">
      <div data-alevel="2" data-title="Struktur und Suche">
        <div data-slot="short"><div data-viz="text" data-viz-spec='{"text":"Vier Fragen: Filter, Filter je Bereich, Such-Reihenfolge, Spind-Sets."}'></div></div>
        <div data-slot="long"><div data-viz="text" data-viz-spec='{"text":"Bereich = was, Filter = welche Art, Suche = welcher Name. Jede Richtung setzt das anders ins Bild, die Regeln hier gelten für alle drei."}'></div></div>
      </div>
${dec(D.alle)}
${dec(D.filter)}
${dec(D.search)}
${dec(D.sets)}
    </section>
    <section id="d0-t2" data-topic data-nav-label="App-Status, Leerzustand, Rahmen">
      <div data-alevel="2" data-title="App-Status, Leerzustand, Rahmen">
        <div data-slot="short"><div data-viz="text" data-viz-spec='{"text":"Vier Fragen: App-Zustände, wo der Status erscheint, leere Bereiche, Schutz vor Abschneiden."}'></div></div>
        <div data-slot="long"><div data-viz="text" data-viz-spec='{"text":"Wo der Status im Layout sitzt (Chip, Seitenkopf, Leiste), entscheidest du über die drei Richtungen. Hier geht es um das, was er sagt."}'></div></div>
      </div>
${dec(D.states)}
${dec(D.visible)}
${dec(D.empty)}
${dec(D.frame)}
    </section>
  </section>`;

/* ------------------------------------------------------------------ assemble */
const ico = (svg) => svg.replace(' aria-hidden="true"', '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const html = `<section data-iteration="1" data-iteration-template="design" data-viewports="desktop" data-tab-label="Runde 1" data-design-set="alternatives">
${css}
<header class="iteration-intro">
<h2>Runde 1 · Befund und drei Richtungen</h2>
<p>Drei Richtungen für die Seite Bestand und den App-Status auf allen HQ-Seiten, jede mit denselben sechs Ansichten: Inventar, Suche, leerer Hangar, Sammlung, HQ Start, Planen. Jede Ansicht zeigt einen anderen App-Zustand. Die Regeln, die für alle Richtungen gleich gelten, stehen unter „Befund und Regeln“.</p>
</header>
<section data-design="register" data-nav-label="Klare Reiter" data-design-active="true"
  data-design-motto="Reiter mit Symbol, Status als Chip"
  data-design-traits="Heutiges Layout, Reiter mit Symbol und wechselndem Titel|App-Status als Chip neben dem Feedback-Knopf|Leere Bereiche als Satz mit Knopf, ohne Raster"
  data-design-icon="${ico(I.crate)}">
${d1()}
</section>
<section data-design="raeume" data-nav-label="Drei Räume"
  data-design-motto="Jeder Bereich ein eigener Raum"
  data-design-traits="Große Raum-Reiter mit Inhaltszeile|Band mit Motiv und eigenem Farbton je Raum|App-Status als Datenquelle im Seitenkopf"
  data-design-icon="layers" data-design-color="#d9b866">
${d2()}
</section>
<section data-design="konsole" data-nav-label="HQ-Leiste"
  data-design-motto="Ein Baum in der HQ-Leiste"
  data-design-traits="Bereiche und Filter als ein Baum, keine Reiter|App-Feld fest am Fuß der Leiste|Subheader trägt nur noch die Suche"
  data-design-icon="list" data-design-color="#8aa8ff">
${d3()}
</section>
${view}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('wrote', out, html.length);
