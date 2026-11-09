// Assembles rounds/01.html from the three designer parts (parts/d1..d3.html).
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const LABELS = ['Start', 'Seite lädt', 'Lädt zu lange', 'Nicht gefunden'];
const NAMES = { d1: 'Holo-Scan', d2: 'Quantum-Sprung', d3: 'Ruhiges MFD' };
const COLORS = { d1: '#8fe3ff', d2: '#b48cff', d3: '#e6b552' };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const must = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };

function anno(id, n, a) {
  return `<div class="anno" data-anno="${id}" data-anno-side="${a.side}" data-anno-target="${esc(a.target)}" style="--anno-x:${a.x}%;--anno-y:${a.y}%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${a.q}</span></button><div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}

let styles = '';
let designs = '';
for (const d of ['d1', 'd2', 'd3']) {
  const src = fs.readFileSync(path.join(dir, 'parts', d + '.html'), 'utf8').replace(/\r\n/g, '\n');
  const meta = JSON.parse(src.match(/<!--\s*meta\s*([\s\S]*?)-->/)[1]);
  const annos = JSON.parse(src.match(/<!--\s*annos\s*([\s\S]*?)-->/)[1]);
  const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
  must(!/<style/i.test(css), d + ' nested style');
  styles += `/* ── ${d} ${NAMES[d]} ── */\n${css.trim()}\n`;
  must(meta.traits.length === 3, d + ' traits');
  let screens = '';
  for (let k = 1; k <= 4; k++) {
    const m = src.match(new RegExp(`<template data-screen="${k}">([\\s\\S]*?)</template>`));
    must(m, `${d} screen ${k}`);
    const body = m[1].trim();
    must(!/<(script|style|canvas|iframe)\b/i.test(body), `${d}-s${k} forbidden tag`);
    must(!/\sid="/i.test(body), `${d}-s${k} id attribute`);
    const mine = annos.filter((a) => a.screen === k);
    const layer = mine.length ? `<div class="anno-layer" data-anno-layer>${mine.map((a, i) => anno(`r1-${d}-s${k}-a${i + 1}`, i + 1, a)).join('')}</div>` : '';
    screens += `  <section id="${d}-s${k}" data-nav-label="${LABELS[k - 1]}" data-screen${k === 1 ? ' data-screen-active="true"' : ' hidden'}>${body}${layer}</section>\n`;
  }
  const active = d === 'd1';
  designs += `<section data-design="${d}" data-nav-label="${NAMES[d]}"${active ? ' data-design-active="true"' : ' hidden'} data-screen-fit="full" data-design-motto="${esc(meta.motto)}" data-design-traits="${esc(meta.traits.join('|'))}" data-design-icon="${esc(meta.icon)}" data-design-color="${COLORS[d]}">\n${screens}</section>\n`;
}

const html = `<section data-iteration="1" data-iteration-template="design" data-tab-label="Runde 1" data-design-set="alternatives" data-viewports="desktop phone">
<style>
${styles}</style>
<header class="iteration-intro">
  <h2>Runde 1 · Ladeschirm &amp; Nicht gefunden</h2>
  <p>Heute: ein schlichter Boot-Splash (Ring, Schriftzug, Balken) und gar keine 404-Seite — eine unbekannte Adresse landet still auf /verse. Drei Richtungen im Beta-Look, jede in denselben vier Zuständen: Start, Seite lädt, Lädt zu lange, Nicht gefunden. Klick im Mock weiter, ☆ markiert deinen Favoriten.</p>
</header>
${designs}</section>
`;
fs.mkdirSync(path.join(dir, 'rounds'), { recursive: true });
fs.writeFileSync(path.join(dir, 'rounds', '01.html'), html);
console.log('wrote rounds/01.html', html.length);
