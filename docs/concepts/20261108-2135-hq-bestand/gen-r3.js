// Round 3: Frachtdeck refined. Reuses the helpers of gen-r2.js. Run: node gen-r3.js <out>
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const out = process.argv[2];
let base = fs.readFileSync(path.join(__dirname, 'gen-r2.js'), 'utf8');
base = base.replace("const fs = require('fs');", '').replace('const out = process.argv[2];', '');
base = base.slice(0, base.indexOf('const ico = (svg)'));
vm.runInThisContext(base);

const R3 = vm.runInThisContext(`(() => {
const p = 'a3';
const AGG = [ // name, place, scu, avg, range, reserved
  ['Eisen', 'Area18', 15, 780, '620–940', 10], ['Eisen', 'Lorville', 9, 410, '410', 0],
  ['Agricium', 'Area18', 4, 880, '880', 0], ['Agricium', 'Lorville', 3, 700, '700', 0], ['Agricium', 'Port Tressler', 3, 560, '560', 0],
  ['Quantanium', 'Cutlass „Rotfuchs“', 6, 760, '760', 0], ['Hadanit', 'Lorville', 4, 990, '990', 0],
];
const SUB = { Waffen: [['Pistole', 1], ['Gewehr', 1], ['Schrotflinte', 0], ['Scharfschütze', 0], ['Schwer', 0], ['Magazin', 1], ['Nahkampf', 0]],
  Rüstung: [['Helm', 1], ['Torso', 1], ['Arme', 0], ['Beine', 0], ['Unterkleidung', 0], ['Rucksack', 0]],
  Rohstoffe: [['Erz', 3], ['Raffiniert', 1], ['Edelstein', 0], ['Bergungsgut', 0]],
  Sonstiges: [['Medizin', 1], ['Werkzeug', 1], ['Nahrung', 0], ['Gadget', 0]] };

function head3(area, mode) {
  const icon = area === 'Alles' ? I.grid : area === 'Inventar' ? I.inv : area === 'Hangar' ? I.hangar : I.sam;
  const tabs = [['Alles', I.grid, 's1'], ['Inventar', I.inv, 's2'], ['Hangar', I.hangar, 's9'], ['Sammlung', I.sam, 's10']];
  const modes = (area === 'Inventar' || area === 'Alles') ? '<span class="d10-mode"><a class="' + (mode === 'over' ? 'on' : '') + '" href="#" data-screen-link="' + p + '-s' + (area === 'Alles' ? 1 : 2) + '">' + I.grid + 'Übersicht</a><a class="' + (mode === 'table' ? 'on' : '') + '" href="#" data-screen-link="' + p + '-s6">' + I.table + 'Tabelle</a></span>' : '';
  return '<header class="d10-head"><span class="d10-ti">' + icon + '</span><div><small>Bestand</small><h2>' + (area === 'Alles' ? 'Bestand' : area) + '</h2></div>'
    + '<nav class="d10-tabs">' + tabs.map(([n, ic, s]) => '<a class="' + (n === area ? 'on' : '') + '" href="#" data-screen-link="' + p + '-' + s + '">' + ic + n + '</a>').join('') + '</nav>' + modes + '<span class="d10-menu">' + I.dots + '</span></header>';
}
const chip = (n, c, on, link) => (link ? '<a href="#" data-screen-link="' + link + '" ' : '<span ') + 'class="d10-chip' + (on ? ' on' : '') + (c === 0 ? ' zero' : '') + '">' + n + (c !== null && c !== undefined ? '<b>' + c + '</b>' : '') + (on && n !== 'Alle' ? '<i>' + I.x + '</i>' : '') + (link ? '</a>' : '</span>');
function filters3(area, sel = {}) {
  const tail = '<span class="d10-sel">' + (sel.place || 'Alle Orte') + '<i>▾</i></span><span class="d10-tog' + (sel.res ? ' on' : '') + '">' + I.lock + 'Reserviert</span><span class="d10-tog">' + I.gear + 'Zerlegbar</span>';
  let row;
  if (area === 'Alles') row = chip('Alle', null, true) + chip('Rohstoffe', 4) + chip('Waffen', 3) + chip('Rüstung', 2, false, p + '-s4') + chip('Sonstiges', 2) + chip('Sets', 0) + '<span class="d10-sep"></span>' + chip('Schiffe', 4) + '<span class="d10-sep"></span>' + chip('Blaupausen', 3) + chip('News', 1) + chip('Galerie', 1) + chip('Ruf', 0);
  else if (area === 'Inventar') row = chip('Alle', null, !sel.cat) + chip('Rohstoffe', 4, sel.cat === 'Rohstoffe') + chip('Waffen', 3, sel.cat === 'Waffen') + chip('Rüstung', 2, sel.cat === 'Rüstung', p + '-s4') + chip('Sonstiges', 2) + chip('Sets', 0);
  else if (area === 'Hangar') row = chip('Alle', null, true) + chip('Pledge', 1) + chip('Ingame', 2) + chip('Leihschiff', 1) + '<span class="d10-sep"></span>' + chip('Kampf', 2) + chip('Fracht', 1) + chip('Bergbau', 1) + chip('Bergung', 0) + chip('Erkundung', 0);
  else row = chip('Alle', null, true) + chip('Blaupausen', 3) + chip('Ruf', 0) + chip('News', 1) + chip('Galerie', 1);
  const subRow = sel.cat && SUB[sel.cat] ? '<div class="d14-sub"><span class="lbl">' + sel.cat + ' ›</span>' + chip('Alle ' + sel.cat, null, !sel.sub) + SUB[sel.cat].map(([n, c]) => chip(n, c, sel.sub === n)).join('') + '</div>' : '';
  return '<div class="d10-filters">' + row + (area === 'Sammlung' ? '' : tail) + '</div>' + subRow;
}
function bays3(active, weights) {
  const list = PLACES.map(([n, sys, scu]) => [n, sys, weights ? (weights[n] || 0) : scu]).filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2]);
  return '<div class="d14-bays">' + list.map(([n, sys, w]) => '<a class="d14-bay' + (n === active ? ' on' : '') + '" href="#" data-screen-link="' + p + '-s3" style="flex:' + Math.max(w, 6) + '"><b>' + n + '</b><small>' + sys + '</small></a>').join('') + '</div>';
}
function crate3(a, opts = {}) {
  const [name, place, scu, avg, range, res] = a;
  const size = scu >= 12 ? 'xl' : scu >= 8 ? 'l' : scu >= 4 ? 'm' : 's';
  const rf = res ? Math.round((res / scu) * 100) : 0;
  const tag = opts.link ? 'a href="#" data-screen-link="' + opts.link + '"' : 'div';
  return '<' + tag + ' class="d14-crate ' + (opts.size || size) + '"><i class="qs" style="--qc:' + qcol(avg) + '"></i><span class="q" style="--qc:' + qcol(avg) + '">' + (opts.exact ? 'Q ' : 'Ø Q ') + avg + '</span><b>' + name + '</b><span class="s">' + scu + ' SCU' + (range.includes('–') && !opts.exact ? ' · ' + range : '') + '</span>' + (opts.noPlace ? '' : '<small>' + place + '</small>') + (res ? '<i class="rh" style="--rf:' + rf + '%"></i><em>' + I.lock + res + ' ' + (opts.who || 'Kaelis') + '</em>' : '') + '</' + (opts.link ? 'a' : 'div') + '>';
}
function box3(n, qty, place, scrap, sub) {
  return '<div class="d14-box"><span class="k">' + sub + '</span><b>' + n + '</b><span class="n">' + qty + '</span><small>' + place + '</small>' + (scrap === 'ja' ? '<i class="scr">' + I.gear + '</i>' : '') + '</div>';
}
const SUBOF = { 'P4-AR Sturmgewehr': 'Gewehr', 'Arclight-Laserpistole': 'Pistole', 'Lumin-Lasermagazin': 'Magazin', 'ORC-mkX „Arctic“': 'Torso', 'Pembroke-Helm': 'Helm', 'Medpen (Hemozal)': 'Medizin', Multitool: 'Werkzeug' };
function lane(label, icon, inner) { return '<div class="d14-lane"><span class="lbl">' + icon + label + '</span><div class="row">' + inner + '</div></div>'; }
const CHANGES = ['<b>vor 2 Std.</b> Area18 gelesen: +4 SCU Eisen, −1 Medpen', '<b>gestern</b> 10 SCU Eisen für Kaelis reserviert', '<b>gestern</b> Pembroke-Helm von Hand eingetragen (Lorville)'];
function protocol3(head, inner, opts = {}) {
  return '<aside class="d14-log"><h4>Ladeprotokoll</h4>' + (opts.filter ? '<p class="flt">' + I.search + opts.filter + '</p>' : '') + head + inner
    + '<div class="d14-changes"><small>Letzte Änderungen</small>' + CHANGES.map((c) => '<p>' + c + '</p>').join('') + '<span class="more">Alle Änderungen ▾</span></div>'
    + '<div class="d14-used"><small>Zuletzt aufgebraucht · letzte Spielsitzung (gestern, 2 Std.)</small><p>4 Medpen · 2 Lumin-Magazine</p><span class="d10-btn sec sm">' + I.wish + 'Nachbestellen …</span></div></aside>';
}
const sumAll = '<dl><dt>Gesamt</dt><dd>124 SCU · 38 Positionen</dd><dt>Reserviert</dt><dd>10 SCU Eisen · Kaelis</dd><dt>Zerlegbar</dt><dd>4 Gegenstände</dd></dl>';
const resLane = (filter) => lane('Rohstoffe', I.inv, AGG.filter(filter || (() => true)).map((a) => crate3(a, { link: a[0] === 'Eisen' ? p + '-s5' : null })).join(''));
const itemLane = (label, icon, kinds, filter) => lane(label, icon, ITEMS.filter((x) => kinds.includes(x[3]) && (!filter || filter(x))).map((x) => box3(x[0], x[1], x[2], x[4], SUBOF[x[0]])).join(''));
const main = (left, right) => '<div class="d14-main"><div class="d14-left">' + left + '</div>' + right + '</div>';

// s1 Alles
const shipsMini = SHIPS.map(([n, nick, o, pl]) => '<div class="d14-mpad"><span class="hull">' + I.hull + '</span><b>' + n + (nick ? ' ' + nick : '') + '</b><small>' + pl + ' · ' + o + '</small></div>').join('');
const samMini = BPS.map(([n, k]) => '<div class="d14-mlock"><span>' + (k === 'Blaupause' ? I.bp : k === 'News' ? I.sam : I.gallery) + '</span><b>' + n + '</b><small>' + k + '</small></div>').join('');
const allDeck = '<div class="d14-deck">' + resLane() + itemLane('Waffen', I.weapon, ['Waffe']) + itemLane('Rüstung · Sonstiges', I.item, ['Rüstung', 'Sonstiges'])
  + lane('Schiffe', I.hangar, shipsMini) + lane('Sammlung', I.sam, samMini) + '</div>';
const s1 = chrome(p, head3('Alles', 'over') + filters3('Alles') + main(bays3(null) + allDeck, protocol3('<p class="mut">Alles, was du hast: Inventar, Hangar und Sammlung auf einem Deck.</p>', sumAll)), { cls: 'd14-app', scope: null });
// s2 Inventar
const invDeck = '<div class="d14-deck">' + resLane() + itemLane('Waffen', I.weapon, ['Waffe']) + itemLane('Rüstung · Sonstiges', I.item, ['Rüstung', 'Sonstiges']) + '</div>';
const s2 = chrome(p, head3('Inventar', 'over') + filters3('Inventar') + main(bays3(null) + invDeck, protocol3('<p class="mut">Wähle Container oder Kisten, um sie abzuholen, zu verkaufen, zu reservieren oder auf die Wunschliste zu legen.</p>', sumAll)), { cls: 'd14-app' });
// s3 Area18
const a18 = '<div class="d14-deck">' + resLane((a) => a[1] === 'Area18') + itemLane('Waffen', I.weapon, ['Waffe'], (x) => x[2] === 'Area18') + itemLane('Sonstiges', I.item, ['Sonstiges'], (x) => x[2] === 'Area18') + '</div>';
const s3 = chrome(p, head3('Inventar', 'over') + filters3('Inventar', { place: 'Area18' }) + main(bays3('Area18') + a18, protocol3('<h5>Area18 · ArcCorp</h5>', '<dl><dt>Belegt</dt><dd>46 SCU · 14 Positionen</dd><dt>Davon reserviert</dt><dd>10 SCU</dd><dt>Zuletzt gelesen</dt><dd>vor 2 Std. von der App</dd></dl><span class="d10-btn sec sm">' + I.route + 'Alles hier abholen …</span>', { filter: 'Ort: Area18' })), { cls: 'd14-app' });
// s4 Rüstung > Helm
const helmW = { Lorville: 1 };
const s4 = chrome(p, head3('Inventar', 'over') + filters3('Inventar', { cat: 'Rüstung', sub: 'Helm' }) + main(bays3(null, helmW) + '<div class="d14-deck">' + itemLane('Helm', I.item, ['Rüstung'], (x) => SUBOF[x[0]] === 'Helm') + '</div>', protocol3('<h5>Rüstung › Helm</h5>', '<dl><dt>Treffer</dt><dd>1 Helm an 1 Ort</dd><dt>Zerlegbar</dt><dd>1</dd></dl>', { filter: 'Rüstung › Helm' })), { cls: 'd14-app' });
// s5 Eisen nach Qualität
const bars = [[410, 9, 0, 'Lorville'], [620, 6, 4, 'Area18'], [810, 5, 4, 'Area18'], [940, 4, 2, 'Area18']];
const spec = '<div class="d14-spec"><div class="plot"><i class="thr" style="--x:70%"><b>Crafting-Schwelle 700</b></i>' + bars.map(([q, s, r, pl]) => '<span class="bar" style="--x:' + (q / 10) + '%;--h:' + s * 10 + '%;--c:' + qcol(q) + ';--r:' + Math.round((r / s) * 100) + '%"><b>' + s + '</b>' + (r ? '<i class="rh"></i><em>' + r + ' reserviert</em>' : '') + '<small>Q ' + q + '</small></span>').join('') + '</div><div class="ax"><span>0</span><span>250</span><span>500</span><span>750</span><span>1000</span></div></div>';
const stacks = '<div class="d14-stacks">' + bars.slice().reverse().map(([q, s, r, pl]) => crate3(['Eisen', pl, s, q, String(q), r], { exact: true, size: 'm' })).join('') + '</div>';
const s5 = chrome(p, head3('Inventar', 'over') + filters3('Inventar', { cat: 'Rohstoffe', sub: 'Erz' }) + main('<div class="d14-res"><header><span class="d10-ti sm">' + I.inv + '</span><div><h3>Eisen</h3><small>24 SCU an 2 Orten · Ø Q 650</small></div><span class="d10-btn sec sm">' + I.wish + 'Auf die Wunschliste</span></header>' + spec + stacks + '</div>',
  protocol3('<h5>Reservierung</h5>', '<div class="d14-resv"><span class="d10-av sm">K</span><div><b>Kaelis</b><small>Freund · 10 SCU Eisen · Area18 · läuft in 6 Tagen ab</small></div></div><p class="mut">Aus Q 620 (4), Q 810 (4) und Q 940 (2). Kaelis sieht die Reservierung bei sich.</p><span class="d10-btn sec sm">Menge ändern</span> <span class="d10-btn sec sm">Übergeben</span> <span class="d10-btn sec sm">Freigeben</span>', { filter: 'Rohstoffe › Erz › Eisen' })), { cls: 'd14-app', typed: 'eisen' });
// s6 Tabelle
const s6 = chrome(p, head3('Inventar', 'table') + filters3('Inventar') + '<h3 class="d11-bol">Frachtbrief · alle Orte</h3>' + table(p, 'd14-t', { sel: true }).replace(/data-screen-link="a3-s6"/g, 'data-screen-link="a3-s8"'), { cls: 'd14-app' });
// s7 Suche ohne Treffer
const ghost = '<div class="d11-ghost"><div class="gc">' + I.inv + '<b>Kein Eisen ab Q 700 in Lorville</b></div>'
  + '<a class="alt" href="#" data-screen-link="' + p + '-s5">' + I.inv + '<span><b>Liegt woanders: 9 SCU in Area18 ab Q 810</b><small>5 frei, 4 für Kaelis reserviert</small></span><span class="d10-btn sec sm">' + I.route + 'Abholen planen</span></a>'
  + '<div class="alt">' + I.wish + '<span><b>Eisen Q ≥ 700 wünschen und einplanen</b><small>direkt in „Gladius aufrüsten“ (Slot 1)</small></span><span class="d10-btn sec sm">' + I.nach + 'Wünschen und einplanen</span></div>'
  + '<div class="alt">' + I.bp + '<span><b>Ersatz: Hadanit Q 990, 4 SCU in Lorville</b><small>passt für dieselbe Blaupause</small></span></div>'
  + '<div class="alt">' + I.bp + '<span><b>Selbst herstellen</b><small>Eisen kommt aus Bergbau; deine Blaupause „P4-AR“ braucht 0,08 SCU</small></span></div></div>';
const s7 = chrome(p, head3('Inventar', 'over') + filters3('Inventar', { place: 'Lorville', cat: 'Rohstoffe' }) + main(bays3('Lorville', { Lorville: 9, Area18: 15 }) + ghost, protocol3('<h5>Kein Treffer</h5>', '<p class="mut">Vier Auswege, zuerst was du schon hast.</p>', { filter: 'Lorville · Rohstoffe · „eisen q&gt;700“' })), { cls: 'd14-app', typed: 'eisen q&gt;700' });
// s8 planen (dialog)
const mix = '<div class="d14-mix"><small>Route</small><nav class="d10-seg sm"><span>Neue Route</span><span class="on">An „Gladius aufrüsten“ anhängen</span></nav><p>Halte am selben Ort werden zusammengelegt: <b>Area18</b> holt Agricium und kauft Laser-Repeater, <b>Lorville</b> holt Agricium.</p></div>';
const s8 = chrome(p, head3('Inventar', 'table') + filters3('Inventar') + '<h3 class="d11-bol">Frachtbrief · alle Orte</h3>' + table(p, 'd14-t', { sel: true }), { cls: 'd14-app', overlay: planDialog(p, 'd11-dlg d14-dlg', mix) });
// s9 Hangar, s10 Sammlung
const pads = SHIPS.map(([n, nick, o, pl]) => '<div class="d11-pad"><span class="ring"></span><span class="hull">' + I.hull + '</span><b>' + n + (nick ? ' ' + nick : '') + '</b><small>' + pl + '</small><em class="o ' + (o === 'Pledge' ? 'pl' : '') + '">' + o + '</em></div>').join('') + '<div class="d11-pad add"><span class="ring"></span>' + I.plus + '<b>Schiff anlegen</b></div>';
const s9 = chrome(p, head3('Hangar') + filters3('Hangar') + '<div class="d11-pads">' + pads + '</div>', { cls: 'd14-app', scope: 'Hangar' });
const lockers = BPS.map(([n, k]) => '<div class="d11-locker"><i class="hd"></i><b>' + n + '</b><small>' + k + '</small><span>' + (k === 'Blaupause' ? I.bp : k === 'News' ? I.sam : I.gallery) + '</span></div>').join('') + '<div class="d11-locker add"><i class="hd"></i>' + I.plus + '<b>Blaupause anlegen</b></div>';
const s10 = chrome(p, head3('Sammlung') + filters3('Sammlung') + '<div class="d11-lockers">' + lockers + '</div><div class="d10-ruf"><span class="ring"></span><span><b>Ruf · noch keine Datenquelle</b><small>Die App kann deinen Ruf später mitlesen.</small></span></div>', { cls: 'd14-app', scope: 'Sammlung' });

const LBL = ['Alles', 'Inventar', 'Ort: Area18', 'Rüstung › Helm', 'Eisen nach Qualität', 'Tabelle', 'Suche ohne Treffer', 'Aus dem Bestand planen', 'Hangar', 'Sammlung'];
const AN = {
  'a3-s1': [anno('a3-1', 1, 'bottom', '.d10-tabs', 34, 13, 'Neu ist der Reiter „Alles“: ein Deck mit allen Bahnen, also Rohstoffe, Waffen, Rüstung, Sonstiges, Schiffe und Sammlung. Die Reiter tragen keine SCU und keine Zahlen mehr. Ist das das „Alles“, das du meintest?')],
  'a3-s2': [anno('a3-2', 2, 'bottom', '.d14-bays', 30, 24, 'Die Ladebuchten zeigen nur noch Ort und System. Ihre Breite folgt dem, was der Filter gerade zeigt, nicht mehr fest den SCU.'),
    anno('a3-3', 3, 'right', '.d14-crate', 26, 40, 'Ein Container je Rohstoff und Ort, mit der durchschnittlichen Qualität als Marke („Ø Q 780“) und der Spanne daneben. Schraffiert ist nur der reservierte Teil. Reicht der Durchschnitt, oder soll die Marke die beste Qualität zeigen?'),
    anno('a3-4', 4, 'left', '.d14-log', 88, 30, 'Das Ladeprotokoll beginnt jetzt oben neben den Buchten und folgt jedem Filter. Darin stehen die letzten drei Änderungen, aufklappbar, und „Zuletzt aufgebraucht“ aus der letzten Spielsitzung.')],
  'a3-s4': [anno('a3-5', 5, 'bottom', '.d14-sub', 40, 28, 'Unterfilter erscheinen als zweite Reihe, sobald eine Art gewählt ist: Rüstung › Helm, Torso, Arme, Beine, Unterkleidung, Rucksack. Leere Unterarten sind gedimmt mit 0. Fehlt eine Unterart?')],
  'a3-s5': [anno('a3-6', 6, 'bottom', '.d14-spec', 40, 34, 'In jedem Balken ist nur der reservierte Teil schraffiert. Darunter liegen die Stapel als dieselben Container wie in der Übersicht, mit hervorgehobener Qualität und ihrer Reservierung.')],
  'a3-s8': [anno('a3-7', 7, 'right', '.d14-mix', 40, 52, 'Abholen kann eine neue Route sein oder an einen laufenden Nachschub angehängt werden. Halte am selben Ort werden dann zusammengelegt. Das Wort „Nachschub“ klärt ein eigenes Concept (#1037).')],
};
const bodies = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10];
return bodies.map((b, i) => {
  const id = p + '-s' + (i + 1); const a = AN[id] || [];
  return '<section id="' + id + '" data-nav-label="' + LBL[i] + '" data-screen' + (i === 0 ? ' data-screen-active="true"' : ' hidden') + ' data-screen-fit="full">\\n' + b + '\\n' + (a.length ? '<div class="anno-layer" data-anno-layer>\\n' + a.join('\\n') + '\\n</div>' : '') + '\\n</section>';
}).join('\\n');
})()`);

// CSS: the round-2 shared block (d10) + Frachtdeck block re-prefixed + round-3 additions
const cssR2 = vm.runInThisContext('css');
const shared = cssR2.slice(cssR2.indexOf('.d10-app {'), cssR2.indexOf('/* ---------- A Frachtdeck */'));
const deck = cssR2.slice(cssR2.indexOf('/* ---------- A Frachtdeck */'), cssR2.indexOf('/* ---------- B Sternkarte */'));
const extra = `
.d14-app .d10-tabs small { display:none; }
.d14-main { display:grid; grid-template-columns:1fr 290px; gap:14px; flex:1; min-height:0; }
.d14-left { display:flex; flex-direction:column; gap:10px; min-width:0; min-height:0; }
.d14-bays { display:flex; gap:6px; flex:none; height:48px; }
.d14-bay { position:relative; display:flex; flex-direction:column; justify-content:center; min-width:0; padding:4px 10px; border:1px solid var(--line); border-radius:6px; background:repeating-linear-gradient(90deg, rgba(82,193,230,.04) 0 10px, transparent 10px 20px), rgba(6,16,24,.8); overflow:hidden; }
.d14-bay b { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .d14-bay small { color:var(--fg3); font-size:10.5px; white-space:nowrap; }
.d14-bay.on { border-color:var(--a); box-shadow:inset 0 0 0 1px var(--a); background:rgba(82,193,230,.12); }
.d14-sub { display:flex; flex-wrap:wrap; align-items:center; gap:6px; flex:none; margin-top:-4px; padding-left:12px; border-left:2px solid rgba(82,193,230,.35); }
.d14-sub .lbl { color:var(--fg3); font-size:12px; margin-right:4px; } .d14-sub .d10-chip { height:26px; font-size:11.5px; }
.d14-deck { display:flex; flex-direction:column; gap:8px; min-height:0; }
.d14-lane { display:flex; gap:10px; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:linear-gradient(180deg, rgba(3,10,16,.4), rgba(3,10,16,.8)); }
.d14-lane .lbl { flex:none; width:90px; display:flex; flex-direction:column; gap:6px; color:var(--fg3); font:600 10px/1.2 Orbitron, system-ui, sans-serif; letter-spacing:.12em; text-transform:uppercase; } .d14-lane .lbl svg { width:18px; height:18px; color:var(--a); }
.d14-lane .row { display:flex; flex-wrap:wrap; align-items:flex-end; gap:8px; }
.d14-crate { position:relative; display:flex; flex-direction:column; justify-content:flex-end; gap:1px; padding:24px 9px 7px; border:1px solid rgba(82,193,230,.4); border-radius:4px; background:linear-gradient(180deg, rgba(82,193,230,.14), rgba(8,20,30,.95)), repeating-linear-gradient(90deg, transparent 0 7px, rgba(159,179,200,.08) 7px 8px); overflow:hidden; }
.d14-crate.s { width:120px; height:90px; } .d14-crate.m { width:136px; height:96px; } .d14-crate.l { width:156px; height:104px; } .d14-crate.xl { width:190px; height:112px; }
.d14-crate .qs { position:absolute; left:0; right:0; top:0; height:4px; background:var(--qc); }
.d14-crate .q { position:absolute; left:8px; top:8px; padding:1px 7px; border-radius:4px; background:var(--qc); color:#04121b; font:700 11px/1.4 Orbitron, system-ui, sans-serif; }
.d14-crate b { font-size:12.5px; } .d14-crate .s { color:var(--fg2); font-size:11px; } .d14-crate small { color:var(--fg3); font-size:10.5px; }
.d14-crate .rh { position:absolute; left:0; bottom:0; top:4px; width:var(--rf); background:repeating-linear-gradient(135deg, transparent 0 6px, rgba(82,193,230,.22) 6px 9px); border-right:1px dashed rgba(82,193,230,.6); pointer-events:none; }
.d14-crate em { position:absolute; right:7px; top:9px; display:inline-flex; align-items:center; gap:3px; color:var(--a); font-style:normal; font-size:10.5px; } .d14-crate em svg { width:11px; height:11px; }
.d14-box { position:relative; width:150px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); }
.d14-box .k { color:var(--fg3); font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; } .d14-box b { display:block; font-size:12px; padding-right:18px; } .d14-box .n { color:var(--a); font-weight:700; font-size:12px; } .d14-box small { display:block; color:var(--fg3); font-size:10.5px; }
.d14-box .scr { position:absolute; right:8px; top:8px; color:var(--ok); } .d14-box .scr svg { width:14px; height:14px; }
.d14-mpad { display:flex; flex-direction:column; align-items:center; width:150px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:repeating-linear-gradient(45deg, rgba(240,194,123,.05) 0 8px, transparent 8px 16px), rgba(6,16,24,.85); }
.d14-mpad .hull svg { width:96px; height:32px; color:#8ab4cc; stroke-width:1.2; } .d14-mpad b { font-size:11.5px; } .d14-mpad small { color:var(--fg3); font-size:10.5px; }
.d14-mlock { display:flex; flex-direction:column; gap:2px; width:130px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:rgba(6,16,24,.85); } .d14-mlock span { color:var(--a); } .d14-mlock b { font-size:11.5px; } .d14-mlock small { color:var(--fg3); font-size:10.5px; }
.d14-log { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--card); min-height:0; overflow:hidden; }
.d14-log h4 { margin:0; color:var(--fg3); font:600 10px/1 Orbitron, system-ui, sans-serif; letter-spacing:.2em; text-transform:uppercase; } .d14-log h5 { margin:0; font-size:14px; }
.d14-log .flt { display:flex; align-items:center; gap:6px; margin:0; padding:5px 8px; border-radius:6px; background:rgba(82,193,230,.1); color:var(--fg); font-size:11.5px; } .d14-log .flt svg { width:13px; height:13px; color:var(--a); }
.d14-log dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:0; font-size:12px; } .d14-log dt { color:var(--fg3); } .d14-log dd { margin:0; text-align:right; }
.d14-log .mut { margin:0; color:var(--fg3); font-size:12px; }
.d14-changes { padding-top:8px; border-top:1px dashed var(--line); } .d14-changes small { color:var(--fg3); } .d14-changes p { margin:4px 0; font-size:11.5px; color:var(--fg2); } .d14-changes p b { color:var(--fg3); font-weight:400; margin-right:4px; } .d14-changes .more { color:var(--a); font-size:11.5px; }
.d14-used { margin-top:auto; padding-top:8px; border-top:1px dashed var(--line); } .d14-used small { color:var(--warn); } .d14-used p { margin:4px 0 8px; color:var(--fg2); font-size:12px; }
.d14-res { display:flex; flex-direction:column; gap:12px; padding:14px; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.d14-res header { display:flex; align-items:center; gap:10px; } .d14-res h3 { margin:0; font:600 18px/1.1 Orbitron, system-ui, sans-serif; } .d14-res header small { color:var(--fg3); } .d14-res header .d10-btn { margin-left:auto; }
.d14-spec { position:relative; height:220px; } .d14-spec .plot { position:absolute; inset:18px 0 20px; border-left:1px solid var(--line); border-bottom:1px solid var(--line); background:repeating-linear-gradient(0deg, transparent 0 45px, rgba(159,179,200,.07) 45px 46px); }
.d14-spec .ax { position:absolute; left:0; right:0; bottom:0; display:flex; justify-content:space-between; color:var(--fg3); font-size:10.5px; }
.d14-spec .bar { position:absolute; bottom:0; left:var(--x); width:46px; height:var(--h); transform:translateX(-50%); border-radius:4px 4px 0 0; background:var(--c); }
.d14-spec .bar > b { position:absolute; top:-18px; left:0; right:0; text-align:center; font-size:12px; } .d14-spec .bar small { position:absolute; bottom:4px; left:0; right:0; text-align:center; color:#04121b; font-size:9.5px; font-weight:700; }
.d14-spec .bar .rh { position:absolute; left:0; right:0; bottom:0; height:var(--r); background:repeating-linear-gradient(135deg, rgba(4,18,27,.0) 0 5px, rgba(4,18,27,.55) 5px 8px); border-top:1.5px dashed #04121b; }
.d14-spec .bar em { position:absolute; left:calc(100% + 6px); bottom:calc(var(--r) - 8px); white-space:nowrap; color:var(--a); font-style:normal; font-size:10.5px; }
.d14-spec .thr { position:absolute; top:-14px; bottom:0; left:var(--x); border-left:1.5px dashed var(--warn); } .d14-spec .thr b { position:absolute; top:0; left:6px; white-space:nowrap; color:var(--warn); font-size:10.5px; font-weight:500; }
.d14-stacks { display:flex; flex-wrap:wrap; gap:8px; }
.d14-resv { display:flex; align-items:center; gap:10px; } .d14-resv small { display:block; color:var(--fg3); }
.d14-mix { margin-top:10px; padding:10px; border:1px dashed var(--line); border-radius:10px; } .d14-mix small { color:var(--fg3); } .d14-mix p { margin:6px 0 0; color:var(--fg2); font-size:12px; }
.d14-dlg { top:46%; }
`;

const html = `<section data-iteration="3" data-iteration-template="design" data-viewports="desktop" data-tab-label="Runde 3">
<style>
${extra}</style>
<header class="iteration-intro">
<h2>Runde 3 · Frachtdeck geschärft</h2>
<p>Dein Favorit Frachtdeck, mit allen Notizen aus Runde 2. Neu: der Reiter „Alles“, Reiter ohne Zahlen, Buchten nur mit Namen, ein Container je Rohstoff und Ort mit Durchschnittsqualität, Unterfilter, ein Ladeprotokoll mit den letzten Änderungen ab Buchtenhöhe, Schraffur nur für den reservierten Teil und Abholen, das sich an einen laufenden Nachschub anhängen kann. Das Wort „Nachschub“ klärt Issue #1037.</p>
</header>
<section data-design="frachtdeck3" data-nav-label="Frachtdeck" data-design-active="true">
${R3}
</section>
${fs.readFileSync(path.join(__dirname, 'view-r3.html'), 'utf8')}
</section>
`;
fs.writeFileSync(out, html.replace(/\r\n/g, '\n'));
console.log('wrote', out, html.length);
