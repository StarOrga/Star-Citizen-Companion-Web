// Assembles rounds/02.html from parts/d2-r2.html (single design, five screens).
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const LABELS = ['Start', 'Seite lädt', 'Inhalt kommt', 'Lädt zu lange', 'Nicht gefunden'];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const must = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };

function anno(id, n, a) {
  const imp = a.improved ? `<p class="anno-bubble-improved">${a.improved}</p>` : '';
  return `<div class="anno" data-anno="${id}" data-anno-side="${a.side}" data-anno-target="${esc(a.target)}" style="--anno-x:${a.x}%;--anno-y:${a.y}%"><button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}" aria-label="{{anno.pin_label}}">${n}</button><div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}"><span class="anno-bubble-question">${a.q}</span></button><div class="anno-bubble-body">${imp}<textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}" data-attachable placeholder="{{anno.answer_placeholder}}"></textarea><div class="attach-slot" data-attach-slot="anno-${id}"></div></div></div></div>`;
}

// Round 1 still carries .d2 rules on the page, so round 2 gets its own prefix q2.
const ren = (x) => x.replace(/\bd2-/g, 'q2-').replace(/\.d2\b/g, '.q2').replace(/(class="[^"]*)\bd2\b/g, '$1q2');
const src = ren(fs.readFileSync(path.join(dir, 'parts', 'd2-r2.html'), 'utf8').replace(/\r\n/g, '\n'));
const meta = JSON.parse(src.match(/<!--\s*meta\s*([\s\S]*?)-->/)[1]);
const annos = JSON.parse(src.match(/<!--\s*annos\s*([\s\S]*?)-->/)[1]);
const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
must(!/<style/i.test(css), 'nested style');
let screens = '';
for (let k = 1; k <= 5; k++) {
  const m = src.match(new RegExp(`<template data-screen="${k}">([\\s\\S]*?)</template>`));
  must(m, `screen ${k}`);
  const body = m[1].trim();
  must(!/<(script|style|canvas|iframe)\b/i.test(body), `s${k} forbidden tag`);
  must(!/\sid="/i.test(body), `s${k} id attribute`);
  const mine = annos.filter((a) => a.screen === k);
  must(mine.length <= 3, `s${k} more than 3 annos`);
  const layer = mine.length ? `<div class="anno-layer" data-anno-layer>${mine.map((a, i) => anno(`r2-q2-s${k}-a${i + 1}`, i + 1, a)).join('')}</div>` : '';
  screens += `  <section id="q2-s${k}" data-nav-label="${LABELS[k - 1]}" data-screen${k === 1 ? ' data-screen-active="true"' : ' hidden'}>${body.replace(/data-screen-link="d2-s(\d)"/g, 'data-screen-link="q2-s$1"')}${layer}</section>\n`;
}

const html = `<section data-iteration="2" data-iteration-template="design" data-tab-label="Runde 2" data-viewports="desktop phone">
<style>
${css.trim()}
</style>
<header class="iteration-intro">
  <h2>Runde 2 · Quantum-Sprung, geschärft</h2>
  <p>Dein Favorit, umgebaut nach deinem Feedback: das animierte App-Logo im Zentrum (ohne Bogen und Maßring), der Tunnel für das Laden der ganzen Seite, eine zum Inhalt passende Ankunft, ein knapper Hinweis und eine neue 404-Seite mit großer 404.</p>
</header>
<section data-design="q2" data-nav-label="Quantum-Sprung" data-design-active="true" data-screen-fit="full" data-design-motto="${esc(meta.motto)}" data-design-traits="${esc(meta.traits.join('|'))}" data-design-icon="${esc(meta.icon)}" data-design-color="#b48cff">
${screens}</section>
</section>
`;
fs.writeFileSync(path.join(dir, 'rounds', '02.html'), html);
console.log('wrote rounds/02.html', html.length);
