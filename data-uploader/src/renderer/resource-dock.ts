/**
 * Performance dock — the always-present panel at the bottom of the window where
 * the operator decides how much of the PC a run may take.
 *
 * Folded it is one strip in one rounded frame: the PERFORMANCE tab (preset
 * name, ▴) and one cell per resource — CPU, RAM, then one per drive the run
 * touches (game drive, work drive, or one cell when both are the same disk).
 * A cell's bar is split: the run solid from 0, other programs hatched up to the
 * whole PC's load, the white tick is the limit.
 *
 * Unfolded, one box grows out of the strip per resource (plus the GPU), the
 * rest of the app dims, and the preset pills sit in the tab. Each dial:
 *
 *   - the needle is the whole PC's load, the number Task Manager shows;
 *   - the solid arc from 0 is the run's share of it, the dashed arc from there
 *     to the needle is other programs;
 *   - the Tempomat (cruise control) is the limit: a tick across the ring with
 *     a round knob outside it — the only part that can be dragged (or focus the
 *     dial and use the arrow keys);
 *   - calm = accent, at its limit = bright glow, held back by a disk budget =
 *     amber glow on the arc, the box and the folded cell, explained in their
 *     tooltip.
 *
 * Drive boxes show active time (Task Manager's "Disk") and response time. The
 * disk limits (read / write / operations) are ONE budget for the run, scaled
 * to the game drive, so their knobs live only in the game drive's box.
 *
 * Every metric has a tooltip with live numbers; Ø / max of the last 60 s live
 * only there (a ring buffer per metric, `lib/dock-metrics.ts`).
 *
 * The tab and every preset pill carry the run's estimated duration ("ca. 25
 * min", `lib/run-estimate.ts`): the running step's measured pace plus the last
 * finished run's steps, rescaled to each preset's worker count. Main feeds it
 * through {@link setRunEstimate}; without an honest figure the spans stay empty.
 *
 * Main owns the limits (`main/resources.ts`); this module only mirrors them and
 * writes through `window.sc.resources`. Every change reaches the running
 * sidecar's governor at once — nothing waits for the next run except the worker
 * count, which is fixed when a stage starts.
 */

import { getLocale, t } from '../lib/i18n.js';
import {
  PRESET_IDS,
  dumpWorkers,
  measuredScaleTop,
  presetLimits,
  ramOthersMb,
  type PresetId,
  type Range,
  type ResourceKey,
  type MachineInfo,
  type ResourceLimits,
  type ResourceSample,
} from '../lib/resource-limits.js';
import { estimateFor, formatApprox, type RunEstimate } from '../lib/run-estimate.js';
import type { DriveLoad, DriveSlot, GpuInfo } from '../lib/drive-load.js';
import {
  History,
  PHASES,
  bindingDiskLimit,
  boostLevels,
  dots,
  driveRunPct,
  padCell,
  splitBar,
  type BoostSubject,
  type DiskLimitKey,
} from '../lib/dock-metrics.js';
import { refreshTooltip } from './tooltip.js';

/** Mirror of `main/resources.ts:ResourceView` (the renderer cannot import main). */
export interface ResourceViewLike {
  machine: { cores: number; totalRamMb: number; disk: { kind: string; readMBs: number; writeMBs: number; iops: number } };
  limits: ResourceLimits;
  ranges: Record<ResourceKey, Range>;
  preset: PresetId | null;
  supported: boolean;
  liveJobs: number;
  sample: ResourceSample | null;
  /** See `lib/drive-load.ts`. */
  drives: DriveSlot[];
  gpu: GpuInfo;
}

const EXPANDED_KEY = 'sc.resourceDock.expanded';
const PEAK_KEY = 'sc.resourceDock.diskPeak';
/** Session flag: the knobs pulse once, on the first unfold of a session. */
const PULSED_KEY = 'sc.resourceDock.pulsed';

const DISK_KEYS: readonly DiskLimitKey[] = ['readMBs', 'writeMBs', 'iops'];

let view: ResourceViewLike | null = null;
let sample: ResourceSample | null = null;
let expanded = false;
/**
 * The Tempomat being dragged, its uncommitted value — samples must not snap it
 * back — and its scale top, frozen for the drag: a measured scale follows the
 * limit, and a scale moving under the pointer would chase the knob away.
 */
let dragging: { key: ResourceKey; value: number; max: number } | null = null;
/** Highest whole-PC disk load seen on this PC — the scale of a drive of unknown type. */
let diskPeak: Record<DiskLimitKey, number> = { readMBs: 0, writeMBs: 0, iops: 0 };
let commitTimer: number | null = null;
let pending: Partial<ResourceLimits> = {};
/** Drive layout the markup was built for — a new layout needs a new render. */
let layoutSig = '';
const history = new History();
/** The run's duration estimate under the limits in force, or null (nothing honest to say). */
let estimate: RunEstimate | null = null;

// Dial geometry (viewBox 0 0 160 100).
const START = -120;
const SWEEP = 240;
const CX = 80;
const CY = 58;
const R = 44;

function dock(): HTMLElement | null {
  return document.getElementById('resource-dock');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ── icons ───────────────────────────────────────────────────────────────────

const ICON = {
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  ram: '<rect x="2.5" y="7" width="19" height="9" rx="1"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 16v3M9 16v3M15 16v3M19 16v3"/>',
  disk: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18"/><circle cx="17" cy="16.5" r="1" fill="currentColor"/><path d="M6 16.5h6"/>',
  gpu: '<rect x="2.5" y="6" width="19" height="11" rx="1.5"/><circle cx="9" cy="11.5" r="3"/><path d="M15 9.5h3M15 13.5h3M5 17v2M19 17v2"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
} as const;

function icon(name: keyof typeof ICON, cls = 'res-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICON[name]}</svg>`;
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Fixed decimals in the UI language ("1,4" in German). */
function dec(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return getLocale() === 'de' ? s.replace('.', ',') : s;
}

function unit(key: ResourceKey): string {
  switch (key) {
    case 'cpuPct':
      return '%';
    case 'ramMb':
      return 'GB';
    case 'readMBs':
    case 'writeMBs':
      return 'MB/s';
    case 'iops':
      // A bare "/s" leaves the reader guessing what is counted.
      return t('res.unitIops');
  }
}

/** The number alone, in the resource's display unit. */
function num(key: ResourceKey, v: number): string {
  switch (key) {
    case 'cpuPct':
      return String(Math.round(v));
    case 'ramMb':
      return dec(v / 1024, v >= 10240 * 10 ? 0 : 1);
    case 'readMBs':
    case 'writeMBs':
      return v >= 100 ? String(Math.round(v)) : dec(v, v >= 10 ? 0 : 1);
    case 'iops':
      // No locale grouping: "3.314" reads as a decimal next to "0,2 MB/s".
      if (v >= 10000) return `${Math.round(v / 1000)}k`;
      return v >= 1000 ? `${dec(v / 1000, 1)}k` : String(Math.round(v));
  }
}

function fmt(key: ResourceKey, v: number): string {
  // A run that holds a few dozen MB is not "0,0 GB".
  if (key === 'ramMb' && v > 0 && v < 1024) return `${Math.round(v)} MB`;
  return `${num(key, v)} ${unit(key)}`;
}

function fmtOr(key: ResourceKey, v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? fmt(key, v) : '—';
}

function pctText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)} %` : '—';
}

function msText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${dec(v, v >= 10 ? 0 : 1)} ms` : '—';
}

const LIMIT_LABEL: Record<DiskLimitKey, string> = {
  readMBs: 'res.num.read',
  writeMBs: 'res.num.write',
  iops: 'res.num.iops',
};

// ── data access ─────────────────────────────────────────────────────────────

/** A drive of unknown type: its nominal caps are a guess, so its scales are measured. */
function measuredScale(v: ResourceViewLike): boolean {
  return v.machine.disk.kind === 'unknown';
}

function isDiskKey(key: ResourceKey): key is DiskLimitKey {
  return (DISK_KEYS as readonly string[]).includes(key);
}

/** Top of the drawn scale (the limit range may stop short of it). */
function scaleMax(key: ResourceKey, v: ResourceViewLike): number {
  if (dragging?.key === key) return dragging.max;
  if (key === 'cpuPct') return 100;
  if (key === 'ramMb') return v.machine.totalRamMb;
  if (isDiskKey(key) && measuredScale(v)) return measuredScaleTop(diskPeak[key], limitOf(key), v.ranges[key].min);
  return v.ranges[key].max;
}

function loadDiskPeak(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(PEAK_KEY) ?? 'null') as Partial<Record<DiskLimitKey, unknown>> | null;
    for (const key of DISK_KEYS) {
      const n = raw?.[key];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) diskPeak[key] = n;
    }
  } catch {
    /* no history yet — the scale starts from the limit */
  }
}

/** Raise the measured peaks from a sample; persist only when one actually grew. */
function notePeak(s: ResourceSample): void {
  let grew = false;
  for (const key of DISK_KEYS) {
    const v = diskTotal(key, s);
    if (v > diskPeak[key]) {
      diskPeak = { ...diskPeak, [key]: v };
      grew = true;
    }
  }
  if (!grew) return;
  try {
    localStorage.setItem(PEAK_KEY, JSON.stringify(diskPeak));
  } catch {
    /* per-viewer convenience only */
  }
}

/** The run's disk use — one budget across drives. */
function diskRun(key: DiskLimitKey, s: ResourceSample | null): number {
  return s ? s[key] : 0;
}

/** Whole-PC disk load across the run's drives (Task Manager); the run's own until the monitor reports. */
function diskTotal(key: DiskLimitKey, s: ResourceSample | null): number {
  if (!s) return 0;
  const sys = key === 'readMBs' ? s.sysReadMBs : key === 'writeMBs' ? s.sysWriteMBs : s.sysIops;
  return sys ?? s[key];
}

function limitOf(key: ResourceKey): number {
  if (dragging?.key === key) return dragging.value;
  return pending[key] ?? view?.limits[key] ?? 0;
}

/** RAM others hold right now cannot be handed to the run. */
function ramTaken(v: ResourceViewLike, s: ResourceSample | null): number {
  return s ? ramOthersMb(s) + s.ramAppMb : v.machine.totalRamMb - v.ranges.ramMb.max;
}

/** The drive layout; before an install is selected one unnamed drive stands for the run's disk. */
function slots(): DriveSlot[] {
  if (view?.drives.length) return view.drives;
  return [{ letter: '', letters: [], role: 'both', kind: (view?.machine.disk.kind ?? 'unknown') as DriveSlot['kind'] }];
}

function slotId(slot: DriveSlot): string {
  return `drive-${slot.role}-${slot.letter || 'x'}`;
}

/** The drive the disk budget belongs to (and whose box carries its knobs). */
function hasLimits(slot: DriveSlot): boolean {
  return slot.role !== 'work';
}

function loadOf(slot: DriveSlot): DriveLoad | null {
  return sample?.drives.find((d) => d.letter === slot.letter && d.role === slot.role) ?? null;
}

function cellLabel(slot: DriveSlot): string {
  return slot.letter ? t(`res.cell.${slot.role}`, { letter: slot.letter }) : t('res.cell.drive');
}

function driveName(slot: DriveSlot): string {
  return slot.letter ? t(`res.driveName.${slot.role}`, { letter: slot.letter }) : t('res.cell.drive');
}

// ── state (calm / at limit / held back) ─────────────────────────────────────

type State = '' | 'at' | 'held';

function running(): boolean {
  return Boolean(sample?.running);
}

function heldPct(): number {
  return running() && sample ? Math.round(sample.heldBack * 100) : 0;
}

function stateOf(id: string): State {
  if (!running() || !sample || !view) return '';
  if (id === 'cpu') return limitOf('cpuPct') > 0 && sample.cpuRunPct >= limitOf('cpuPct') * 0.92 ? 'at' : '';
  if (id === 'ram') return limitOf('ramMb') > 0 && sample.ramRunMb >= limitOf('ramMb') * 0.92 ? 'at' : '';
  const slot = slots().find((s) => slotId(s) === id);
  if (slot && hasLimits(slot) && sample.heldBack > 0.05) return 'held';
  return '';
}

function rowState(key: DiskLimitKey): State {
  if (!running() || !sample || !view) return '';
  if (sample.heldBack > 0.05 && bindingDiskLimit(sample, view.limits) === key) return 'held';
  return limitOf(key) > 0 && diskRun(key, sample) >= limitOf(key) * 0.92 ? 'at' : '';
}

// ── motion ──────────────────────────────────────────────────────────────────
//
// A sample lands about once a second. Drawn as it arrives, every needle, arc
// and number jumps — the dock ticks like a clock. Instead each part shows a
// value that glides toward the latest one (exponential ease, settles in about
// half a second), so a jump reads as motion. The dragged knob never lags the
// pointer, and reduced motion draws the target straight away.

/** The four moving parts of a gauge. */
interface Shown {
  pc: number;
  use: number;
  max: number;
  limit: number;
}
const SHOWN_FIELDS = ['pc', 'use', 'max', 'limit'] as const;
/** Time constant of the glide, ms. */
const GLIDE_MS = 140;

const shown = new Map<string, Shown>();
let frame: number | null = null;
let lastFrame = 0;

/** Every gauge's latest values: 'cpu', 'ram', one per drive slot, one per disk limit row. */
function targets(v: ResourceViewLike): Map<string, Shown> {
  const s = sample;
  const out = new Map<string, Shown>();
  out.set('cpu', { pc: s?.cpuTotalPct ?? 0, use: s?.cpuRunPct ?? 0, max: 100, limit: limitOf('cpuPct') });
  out.set('ram', { pc: s?.ramUsedMb ?? 0, use: s?.ramRunMb ?? 0, max: scaleMax('ramMb', v), limit: limitOf('ramMb') });
  for (const slot of slots()) {
    const d = loadOf(slot);
    const active = d?.activePct ?? 0;
    out.set(slotId(slot), { pc: active, use: driveRunPct(d?.activePct ?? null, d?.runSharePct ?? null), max: 100, limit: 0 });
  }
  const limitSlot = slots().find(hasLimits);
  const ld = limitSlot ? loadOf(limitSlot) : null;
  for (const key of DISK_KEYS) {
    out.set(key, { pc: ld?.[key] ?? diskTotal(key, s), use: diskRun(key, s), max: scaleMax(key, v), limit: limitOf(key) });
  }
  return out;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** What a gauge draws right now — the gliding value, or the target where nothing glides. */
function shownOf(id: string, all: Map<string, Shown>): Shown {
  const target = all.get(id) ?? { pc: 0, use: 0, max: 1, limit: 0 };
  const cur = shown.get(id);
  if (!cur || reducedMotion()) {
    shown.set(id, { ...target });
    return target;
  }
  if (dragging && (id === dragging.key || (id === 'cpu' && dragging.key === 'cpuPct') || (id === 'ram' && dragging.key === 'ramMb'))) {
    cur.limit = target.limit;
    cur.max = target.max;
  }
  return cur;
}

function step(now: number): void {
  frame = null;
  if (!view) return;
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
  lastFrame = now;
  const k = 1 - Math.exp(-dt / GLIDE_MS);
  let moving = false;
  for (const [id, target] of targets(view)) {
    const cur = shown.get(id);
    if (!cur) continue;
    for (const f of SHOWN_FIELDS) {
      const d = target[f] - cur[f];
      if (Math.abs(d) <= Math.max(1e-3, Math.abs(target[f]) * 2e-3)) cur[f] = target[f];
      else {
        cur[f] += d * k;
        moving = true;
      }
    }
  }
  paintFrame();
  if (moving) frame = window.requestAnimationFrame(step);
  else lastFrame = 0;
}

/** Let every gauge glide to its latest values. */
function glide(): void {
  if (reducedMotion() || typeof window.requestAnimationFrame !== 'function') {
    paintFrame();
    return;
  }
  if (frame === null) {
    lastFrame = 0;
    frame = window.requestAnimationFrame(step);
  }
}

// ── geometry ────────────────────────────────────────────────────────────────

function angleFor(value: number, max: number): number {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return START + SWEEP * f;
}

function pt(angle: number, r = R): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function arc(a1: number, a2: number, r = R): string {
  if (a2 - a1 < 0.05) return '';
  const [x1, y1] = pt(a1, r);
  const [x2, y2] = pt(a2, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Pointer → value on a dial, through the SVG's own transform (letterboxing included). */
function dialValueAt(svg: SVGSVGElement, clientX: number, clientY: number, max: number): number {
  const m = svg.getScreenCTM();
  let x: number;
  let y: number;
  if (m) {
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    x = p.x;
    y = p.y;
  } else {
    const box = svg.getBoundingClientRect();
    x = ((clientX - box.left) / box.width) * 160;
    y = ((clientY - box.top) / box.height) * 100;
  }
  let a = (Math.atan2(x - CX, -(y - CY)) * 180) / Math.PI;
  if (a > 120) a = 120;
  if (a < -120) a = -120;
  return ((a - START) / SWEEP) * max;
}

function snapTo(value: number, r: Range, ceiling: number): number {
  const top = Math.max(r.min, Math.min(r.max, ceiling));
  const v = Math.min(top, Math.max(r.min, value));
  return Math.min(top, Math.max(r.min, Math.round(v / r.step) * r.step));
}

// ── markup ──────────────────────────────────────────────────────────────────

function dialMarkup(id: string, key: ResourceKey | null, label: string): string {
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = START + (SWEEP * i) / 10;
    const [x1, y1] = pt(a, R + 6);
    const [x2, y2] = pt(a, R + (i % 5 === 0 ? 10 : 8));
    return `<line class="dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  const parts = `
    <g class="dial-scale">${ticks}</g>
    <path class="dial-track" d="${arc(START, START + SWEEP)}"/>
    <path class="dial-oth" d=""/>
    <path class="dial-run" d=""/>
    <line class="dial-needle" x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY}"/>
    <circle class="dial-hub" cx="${CX}" cy="${CY}" r="3.5"/>
    <text class="dial-value" x="${CX}" y="${CY + 25}" text-anchor="middle"></text>
    <text class="dial-sub" x="${CX}" y="${CY + 37}" text-anchor="middle"></text>`;
  if (!key) {
    return `<svg class="res-dial" id="res-dial-${id}" viewBox="0 0 160 100" role="img" aria-label="${esc(label)}">${parts}</svg>`;
  }
  return `<svg class="res-dial res-dial--tempo" id="res-dial-${id}" viewBox="0 0 160 100" role="slider" tabindex="0" aria-label="${esc(label)}" data-key="${key}">${parts}
    <g class="dial-tempo">
      <circle class="dial-tempo-halo" r="10"/>
      <line class="dial-tempo-tick"/>
      <circle class="dial-tempo-knob" r="5"/>
    </g></svg>`;
}

function boostHtml(subject: BoostSubject): string {
  const lv = boostLevels(subject);
  const items = PHASES.map(
    (p, i) => {
      const n = lv[i] ?? 0;
      // Drawn as shapes, not glyphs: a ● at this size merges into a bar in some fonts.
      const pips = [1, 2, 3].map((k) => `<span class="res-pip${k <= n ? ' on' : ''}"></span>`).join('');
      return `<span class="res-boost-item">${t(`res.phase.${p}`)} <span class="res-pips" role="img" aria-label="${dots(n)}">${pips}</span></span>`;
    },
  ).join('');
  return `<p class="res-boost" tabindex="0" data-tip="${esc(t(`res.boost.${subject}`))}" aria-label="${esc(t('res.boostAria'))}">${icon('bolt', 'res-ico res-ico--bolt')}${items}</p>`;
}

function cellHtml(id: string, ico: keyof typeof ICON, label: string): string {
  return `<div class="res-cell" id="res-cell-${id}" data-res-tip="${id}" tabindex="0" role="meter" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)}">
      ${icon(ico)}
      <span class="res-cell-label">${esc(label)}</span>
      <span class="res-bar" aria-hidden="true"><span class="run"></span><span class="oth"></span><span class="lim"></span></span>
      <span class="res-cell-num">—</span>
    </div>`;
}

function limRowHtml(key: DiskLimitKey, withKnob: boolean): string {
  const label = t(LIMIT_LABEL[key]);
  const track = withKnob
    ? `<span class="res-lim-track" role="slider" tabindex="0" aria-label="${esc(label)}" data-key="${key}"><span class="res-lim-run"></span><span class="res-lim-knob"></span></span>`
    : '';
  return `<div class="res-lim${withKnob ? '' : ' res-lim--plain'}" id="res-lim-${key}${withKnob ? '' : '-plain'}" data-res-tip="lim-${key}${withKnob ? '' : '-plain'}">
      <span class="res-lim-head"><span>${esc(label)}</span><b class="res-lim-val">—</b></span>${track}
    </div>`;
}

function boxHtml(i: number, id: string, ico: keyof typeof ICON, name: string, inner: string, boost: string, extra = ''): string {
  return `<figure class="res-box${extra}" id="res-box-${id}" style="--i:${i}">
      <figcaption data-res-tip="${id}">${icon(ico)}<span class="res-box-name">${esc(name)}</span><span class="res-box-aside" id="res-aside-${id}"></span></figcaption>
      ${inner}
      ${boost}
    </figure>`;
}

function gpuBoxHtml(i: number): string {
  return `<figure class="res-box res-box--gpu" id="res-box-gpu" style="--i:${i}">
      <figcaption>${icon('gpu')}<span class="res-box-name">${t('res.gpu')}</span></figcaption>
      <p class="res-gpu-name" id="res-gpu-name"></p>
      <span class="res-switch-wrap" id="res-gpu-wrap">
        <button type="button" class="res-switch" id="res-gpu-switch" role="switch" aria-checked="false">
          <span class="res-switch-track" aria-hidden="true"></span>
          <span class="res-switch-label">${t('res.gpuSwitch')}</span>
        </button>
      </span>
    </figure>`;
}

function presetsHtml(): string {
  if (!view) return '';
  const pills = PRESET_IDS.map(
    (id) =>
      `<button type="button" class="res-preset ${view?.preset === id ? 'active' : ''}" data-preset="${id}" aria-pressed="${view?.preset === id}" data-tip="${esc(presetTip(id))}">${t(`res.preset.${id}`)}<span class="res-preset-eta" data-eta="${id}">${esc(etaText(id))}</span></button>`,
  ).join('');
  const custom =
    view.preset === null
      ? `<span class="res-preset res-preset--custom active" tabindex="0" data-tip="${esc(presetTip(null))}">${t('res.preset.custom')}<span class="res-preset-eta" data-eta="custom">${esc(etaText(null))}</span></span>`
      : '';
  return `<div class="res-presets" role="group" aria-label="${t('res.presetsAria')}">${pills}${custom}</div>`;
}

// ── duration estimate ───────────────────────────────────────────────────────

function machineOf(v: ResourceViewLike): MachineInfo {
  return { cores: v.machine.cores, totalRamMb: v.machine.totalRamMb, disk: v.machine.disk as MachineInfo['disk'] };
}

function workersOf(limits: ResourceLimits): number {
  return view ? dumpWorkers(limits, view.machine.cores) : 1;
}

/** Workers the record dump gets under the limits in force — the estimate's yardstick. */
export function dockWorkers(): number | null {
  return view ? workersOf(view.limits) : null;
}

/** "ca. 25 min" for a preset (null = the limits in force), or '' without an estimate. */
function etaText(id: PresetId | null): string {
  if (!estimate || !view) return '';
  // The limits in force right now, not the ones the estimate was taken under:
  // a preset click rescales the figure before the next estimate arrives.
  const workers = workersOf(id ? presetLimits(id, machineOf(view)) : view.limits);
  return t('res.eta.approx', { d: formatApprox(estimateFor(estimate, workers)) });
}

/** What the figure rests on — one tooltip paragraph. */
function etaTip(): string {
  if (!estimate) return '';
  const lines = [
    estimate.idle ? t('res.eta.tipIdle') : estimate.basis === 'live' ? t('res.eta.tipLive') : t('res.eta.tipLast'),
  ];
  if (estimate.scope === 'step') lines.push(t('res.eta.tipStep'));
  lines.push(t('res.eta.tipScale'));
  return lines.join(' ');
}

function presetTip(id: PresetId | null): string {
  const desc = id ? t(`res.preset.${id}Desc`) : t('res.preset.customDesc');
  const tip = etaTip();
  return tip ? `${desc}\n\n${tip}` : desc;
}

/** The tab's figure: the active preset's, phrased as time left while a run goes. */
function tabEta(): string {
  if (!estimate || !view) return '';
  const d = formatApprox(estimateFor(estimate, workersOf(view.limits)));
  return estimate.idle ? t('res.eta.approx', { d }) : t('res.eta.left', { d });
}

/** Rewrite the estimate spans and their tooltips in place — no re-render, focus stays. */
function paintEta(): void {
  const root = dock();
  if (!root) return;
  const tab = root.querySelector<HTMLElement>('.res-eta');
  if (tab) tab.textContent = tabEta();
  const toggle = document.getElementById('res-toggle');
  if (toggle) toggle.dataset.tip = toggleTip();
  root.querySelectorAll<HTMLElement>('.res-preset-eta[data-eta]').forEach((el) => {
    const id = el.dataset.eta === 'custom' ? null : (el.dataset.eta as PresetId);
    el.textContent = etaText(id);
    const pill = el.closest<HTMLElement>('.res-preset');
    if (pill) pill.dataset.tip = presetTip(id);
  });
  refreshTooltip();
}

/** Main's latest estimate (null: none). Repaints only the figures. */
export function setRunEstimate(next: RunEstimate | null): void {
  estimate = next;
  paintEta();
}

function presetName(): string {
  return view?.preset ? t(`res.preset.${view.preset}`) : t('res.preset.custom');
}

function toggleTip(): string {
  const desc = view?.preset ? t(`res.preset.${view.preset}Desc`) : t('res.preset.customDesc');
  const base = t('res.toggleTip', { preset: presetName(), desc });
  const eta = etaTip();
  const withEta = eta ? `${base}\n\n${eta}` : base;
  return view && !view.supported ? `${withEta}\n\n${t('res.unsupported')}` : withEta;
}

function render(): void {
  const el = dock();
  if (!el || !view) return;
  el.hidden = false;
  el.setAttribute('aria-label', t('res.title'));
  el.classList.toggle('is-expanded', expanded);
  const drives = slots();
  layoutSig = drives.map(slotId).join('|');
  const cells = [
    cellHtml('cpu', 'cpu', t('res.cell.cpu')),
    cellHtml('ram', 'ram', t('res.cell.ram')),
    ...drives.map((d) => cellHtml(slotId(d), 'disk', cellLabel(d))),
  ].join('');
  const strip = `
    <div class="res-strip">
      <div class="res-tab">
        <button type="button" class="res-toggle" id="res-toggle" aria-expanded="${expanded}" aria-controls="res-body"${expanded ? ` aria-label="${esc(t('res.collapseAria'))}"` : ''} data-tip="${esc(toggleTip())}" data-tip-key="T">
          ${icon('gauge')}
          <span class="res-title">${t('res.title')}</span>
          <span class="res-preset-name">${esc(presetName())}</span>
          <span class="res-eta">${esc(tabEta())}</span>
          <span class="res-caret" aria-hidden="true">${expanded ? '▾' : '▴'}</span>
        </button>
        ${expanded ? presetsHtml() : ''}
      </div>
      <div class="res-cells">${cells}</div>
    </div>`;
  let body = '';
  if (expanded) {
    let i = 0;
    const boxes: string[] = [
      boxHtml(i++, 'cpu', 'cpu', t('res.cell.cpu'), dialMarkup('cpu', 'cpuPct', t('res.cell.cpu')), boostHtml('cpu')),
      boxHtml(i++, 'ram', 'ram', t('res.cell.ram'), dialMarkup('ram', 'ramMb', t('res.cell.ram')), boostHtml('ram')),
    ];
    const cols = ['minmax(0, 1fr)', 'minmax(0, 1fr)'];
    for (const d of drives) {
      const id = slotId(d);
      const knobs = hasLimits(d);
      const inner = `<div class="res-drive-row">${dialMarkup(id, null, driveName(d))}<div class="res-lims">${DISK_KEYS.map((k) => limRowHtml(k, knobs)).join('')}</div></div>`;
      boxes.push(boxHtml(i++, id, 'disk', cellLabel(d), inner, boostHtml(d.role), ' res-box--drive'));
      cols.push(knobs ? 'minmax(0, 1.45fr)' : 'minmax(0, 1.2fr)');
    }
    boxes.push(gpuBoxHtml(i));
    cols.push('minmax(0, 0.95fr)');
    body = `<div class="res-body" id="res-body"><div class="res-boxes" style="grid-template-columns:${cols.join(' ')}">${boxes.join('')}</div></div>`;
  }
  el.innerHTML = strip + body;
  syncDim();
  wire();
  paintLive();
  paintFrame();
}

// ── painting ────────────────────────────────────────────────────────────────

function setArc(svg: Element, cls: string, d: string): void {
  const p = svg.querySelector(`.${cls}`);
  if (p && p.getAttribute('d') !== d) p.setAttribute('d', d);
}

function paintDial(id: string, key: ResourceKey | null, s: Shown, value: string, sub: string): void {
  const svg = document.getElementById(`res-dial-${id}`);
  if (!svg) return;
  const aUse = angleFor(s.use, s.max);
  const aPc = angleFor(Math.max(s.pc, s.use), s.max);
  setArc(svg, 'dial-run', s.use > 0 ? arc(START, aUse) : '');
  setArc(svg, 'dial-oth', aPc > aUse ? arc(aUse, aPc) : '');
  const [nx, ny] = pt(aPc, R - 11);
  const needle = svg.querySelector('.dial-needle');
  needle?.setAttribute('x2', nx.toFixed(2));
  needle?.setAttribute('y2', ny.toFixed(2));
  const v = svg.querySelector('.dial-value');
  if (v && v.textContent !== value) v.textContent = value;
  const st = svg.querySelector('.dial-sub');
  if (st && st.textContent !== sub) st.textContent = sub;
  if (!key || !view) return;
  const aLim = angleFor(s.limit, s.max);
  const [t1x, t1y] = pt(aLim, R - 6);
  const [t2x, t2y] = pt(aLim, R + 6);
  const [kx, ky] = pt(aLim, R + 12);
  const tick = svg.querySelector('.dial-tempo-tick');
  tick?.setAttribute('x1', t1x.toFixed(2));
  tick?.setAttribute('y1', t1y.toFixed(2));
  tick?.setAttribute('x2', t2x.toFixed(2));
  tick?.setAttribute('y2', t2y.toFixed(2));
  for (const c of svg.querySelectorAll('.dial-tempo-knob, .dial-tempo-halo')) {
    c.setAttribute('cx', kx.toFixed(2));
    c.setAttribute('cy', ky.toFixed(2));
  }
  const r = view.ranges[key];
  const lim = limitOf(key);
  svg.setAttribute('aria-valuenow', String(lim));
  svg.setAttribute('aria-valuetext', fmt(key, lim));
  svg.setAttribute('aria-valuemin', String(r.min));
  svg.setAttribute('aria-valuemax', String(r.max));
}

function paintCell(id: string, run: number, others: number, limitPct: number | null, value: string, meter: number): void {
  const el = document.getElementById(`res-cell-${id}`);
  if (!el) return;
  const bar = splitBar(run + others, run);
  const r = el.querySelector<HTMLElement>('.res-bar .run');
  const o = el.querySelector<HTMLElement>('.res-bar .oth');
  const l = el.querySelector<HTMLElement>('.res-bar .lim');
  if (r) r.style.width = `${bar.run.toFixed(1)}%`;
  if (o) {
    o.style.left = `${bar.run.toFixed(1)}%`;
    o.style.width = `${bar.others.toFixed(1)}%`;
  }
  if (l) {
    l.hidden = limitPct === null;
    if (limitPct !== null) l.style.left = `calc(${Math.min(100, limitPct).toFixed(1)}% - 1px)`;
  }
  const n = el.querySelector('.res-cell-num');
  if (n && n.textContent !== value) n.textContent = value;
  el.setAttribute('aria-valuenow', String(Math.round(meter)));
  el.setAttribute('aria-valuetext', value);
}

/** A limit row's value: the label already names what is counted, so operations read "640/s". */
function rowValue(key: DiskLimitKey, v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return key === 'iops' ? `${num('iops', v)}/s` : fmt(key, v);
}

/** The work drive's rows: its own numbers, no Tempomat (the budget lives on the game drive). */
function paintPlainRows(): void {
  const work = slots().find((s) => !hasLimits(s));
  const d = work ? loadOf(work) : null;
  for (const key of DISK_KEYS) {
    const val = document.querySelector(`#res-lim-${key}-plain .res-lim-val`);
    const text = rowValue(key, d?.[key]);
    if (val && val.textContent !== text) val.textContent = text;
  }
}

function paintLimRow(key: DiskLimitKey, s: Shown): void {
  const row = document.getElementById(`res-lim-${key}`);
  if (!row || !view) return;
  const val = row.querySelector('.res-lim-val');
  const text = rowValue(key, s.pc);
  if (val && val.textContent !== text) val.textContent = text;
  const run = row.querySelector<HTMLElement>('.res-lim-run');
  const knob = row.querySelector<HTMLElement>('.res-lim-knob');
  const f = (x: number): string => `${(s.max > 0 ? Math.max(0, Math.min(1, x / s.max)) * 100 : 0).toFixed(1)}%`;
  if (run) run.style.width = f(s.use);
  if (knob) knob.style.left = f(s.limit);
  const track = row.querySelector('.res-lim-track');
  if (track) {
    const r = view.ranges[key];
    const lim = limitOf(key);
    track.setAttribute('aria-valuenow', String(lim));
    track.setAttribute('aria-valuetext', fmt(key, lim));
    track.setAttribute('aria-valuemin', String(r.min));
    track.setAttribute('aria-valuemax', String(r.max));
  }
}

/** One glide frame: every needle, arc, bar and number. */
function paintFrame(): void {
  if (!view) return;
  const all = targets(view);
  const cpu = shownOf('cpu', all);
  paintCell('cpu', cpu.use, cpu.pc - cpu.use, cpu.limit, `${Math.round(cpu.pc)} %`, cpu.pc);
  const ram = shownOf('ram', all);
  const total = view.machine.totalRamMb || 1;
  const ramPct = (ram.pc / total) * 100;
  paintCell('ram', (ram.use / total) * 100, ((ram.pc - ram.use) / total) * 100, (ram.limit / total) * 100, `${Math.round(ramPct)} %`, ramPct);
  for (const slot of slots()) {
    const id = slotId(slot);
    const d = shownOf(id, all);
    const measured = loadOf(slot)?.activePct;
    const text = typeof measured === 'number' ? `${Math.round(d.pc)} %` : '—';
    paintCell(id, d.use, d.pc - d.use, null, text, d.pc);
    if (expanded) paintDial(id, null, d, text, '');
  }
  const disk = new Map(DISK_KEYS.map((k) => [k, shownOf(k, all)] as const));
  if (!expanded) return;
  paintDial('cpu', 'cpuPct', cpu, `${Math.round(cpu.pc)} %`, `≤ ${fmt('cpuPct', cpu.limit)}`);
  paintDial('ram', 'ramMb', ram, `${Math.round(ramPct)} %`, `≤ ${fmt('ramMb', ram.limit)}`);
  for (const key of DISK_KEYS) paintLimRow(key, disk.get(key) as Shown);
  paintPlainRows();
}

// ── tooltips ────────────────────────────────────────────────────────────────

const W = 10;

/** Rows for a tooltip's number grid: head, then label · now · Ø · max (padded). */
function numsGrid(rows: Array<[string, string, string?, string?]>, withStats = true): string {
  const head = withStats
    ? ['', padCell(t('res.col.now'), W), padCell(t('res.col.avg'), W), padCell(t('res.col.max'), W)]
    : ['', padCell(t('res.col.now'), W)];
  const body = rows.map(([label, now, avg, max]) =>
    (withStats ? [label, padCell(now, W), padCell(avg ?? '', W), padCell(max ?? '', W)] : [label, padCell(now, W)]).join('\t'),
  );
  return [head.join('\t'), ...body].join('\n');
}

function stat(id: string, f: (v: number) => string): [string, string] {
  const a = history.avg(id);
  const m = history.max(id);
  return [a === null ? '—' : f(a), m === null ? '—' : f(m)];
}

interface Tip {
  text: string;
  title?: string;
  nums?: string;
}

function cpuTip(): Tip {
  const s = sample;
  const p = (v: number): string => `${Math.round(v)} %`;
  const state = stateOf('cpu');
  const text = [
    state === 'at' ? t('res.tip.atLimitText') : '',
    t('res.tip.cpu', { threads: view?.machine.cores ?? 0 }),
    s?.running && !s.hardCap ? t('res.tip.cpuNoHardCap') : '',
  ].filter(Boolean);
  return {
    title: state === 'at' ? t('res.tip.atLimit') : undefined,
    text: text.join('\n\n'),
    nums: numsGrid([
      [t('res.num.pc'), s ? p(s.cpuTotalPct) : '—', ...stat('cpu.pc', p)],
      [t('res.num.run'), s ? p(s.cpuRunPct) : '—', ...stat('cpu.run', p)],
      [t('res.num.limit'), p(limitOf('cpuPct'))],
    ]),
  };
}

function ramTip(): Tip {
  const s = sample;
  const g = (v: number): string => fmt('ramMb', v);
  const total = view?.machine.totalRamMb ?? 0;
  const state = stateOf('ram');
  return {
    title: state === 'at' ? t('res.tip.atLimit') : undefined,
    text: [state === 'at' ? t('res.tip.atLimitText') : '', t('res.tip.ram')].filter(Boolean).join('\n\n'),
    nums: numsGrid([
      [t('res.num.used'), s ? `${g(s.ramUsedMb)} · ${Math.round((s.ramUsedMb / (total || 1)) * 100)} %` : '—', ...stat('ram.used', g)],
      [t('res.num.run'), s ? g(s.ramRunMb) : '—', ...stat('ram.run', g)],
      [t('res.num.app'), s ? g(s.ramAppMb) : '—'],
      [t('res.num.limit'), g(limitOf('ramMb'))],
    ]),
  };
}

function driveNums(slot: DriveSlot, d: DriveLoad | null): string {
  const L = slot.letter || 'x';
  return numsGrid([
    [t('res.num.active'), pctText(d?.activePct), ...stat(`${L}.active`, (v) => `${Math.round(v)} %`)],
    [t('res.num.response'), msText(d?.responseMs), ...stat(`${L}.resp`, (v) => msText(v))],
    [t('res.num.read'), fmtOr('readMBs', d?.readMBs), ...stat(`${L}.read`, (v) => fmt('readMBs', v))],
    [t('res.num.write'), fmtOr('writeMBs', d?.writeMBs), ...stat(`${L}.write`, (v) => fmt('writeMBs', v))],
    [t('res.num.iops'), rowValue('iops', d?.iops), ...stat(`${L}.iops`, (v) => rowValue('iops', v))],
    [t('res.num.share'), pctText(d?.runSharePct)],
  ]);
}

function driveTip(slot: DriveSlot): Tip {
  const d = loadOf(slot);
  const nums = driveNums(slot, d);
  if (stateOf(slotId(slot)) === 'held' && view && sample) {
    const which = bindingDiskLimit(sample, view.limits);
    return {
      title: t('res.tip.heldTitle', { drive: driveName(slot) }),
      text: t('res.tip.held', { pct: heldPct(), which: t(`res.limitName.${which}`), limit: fmt(which, limitOf(which)) }),
      nums,
    };
  }
  const role = slot.role === 'game' ? 'res.tip.driveGame' : slot.role === 'work' ? 'res.tip.driveWork' : 'res.tip.driveBoth';
  const parts = [t(role), t('res.tip.drive'), t('res.tip.shareNow')];
  if (d?.runAttribution === 'assumed') parts.push(t('res.tip.driveAssumed'));
  parts.push(t('res.tip.taskMgrZero'));
  return { text: parts.join('\n\n'), nums };
}

function limTip(key: DiskLimitKey, plain: boolean, slot: DriveSlot | undefined): Tip {
  const d = slot ? loadOf(slot) : null;
  const L = slot?.letter || 'x';
  const f = (v: number): string => rowValue(key, v);
  const histKey = key === 'readMBs' ? 'read' : key === 'writeMBs' ? 'write' : 'iops';
  const rows: Array<[string, string, string?, string?]> = [
    [t('res.num.pc'), rowValue(key, d?.[key]), ...stat(`${L}.${histKey}`, f)],
  ];
  if (!plain) {
    rows.push([t('res.num.run'), sample ? f(diskRun(key, sample)) : '—', ...stat(`run.${histKey}`, f)]);
    rows.push([t('res.num.limit'), f(limitOf(key))]);
  } else if (d) {
    rows.push([t('res.num.run'), f(d.run[key])]);
  }
  if (key === 'iops' && d && d.iops && d.readMBs !== null && d.writeMBs !== null) {
    rows.push([t('res.num.perOp'), `${Math.round(((d.readMBs + d.writeMBs) * 1024) / d.iops)} KB`]);
  }
  const text = [t(`res.tip.${histKey}`)];
  if (plain) text.push(t('res.tip.driveWork'));
  else if (rowState(key) === 'held' && sample) {
    return {
      title: t('res.tip.heldTitle', { drive: slot ? driveName(slot) : t('res.cell.drive') }),
      text: t('res.tip.held', { pct: heldPct(), which: t(`res.limitName.${key}`), limit: f(limitOf(key)) }),
      nums: numsGrid(rows),
    };
  }
  return { text: text.join('\n\n'), nums: numsGrid(rows) };
}

function tempoTip(key: ResourceKey): string {
  const what = key === 'cpuPct' ? t('res.cell.cpu') : key === 'ramMb' ? t('res.cell.ram') : t(LIMIT_LABEL[key as DiskLimitKey]);
  return t(key === 'ramMb' ? 'res.tip.tempoRam' : 'res.tip.tempo', { what, value: fmt(key, limitOf(key)) });
}

function setTip(el: HTMLElement, tip: Tip): void {
  if (el.dataset.tip !== tip.text) el.dataset.tip = tip.text;
  if (tip.title) el.dataset.tipTitle = tip.title;
  else delete el.dataset.tipTitle;
  if (tip.nums) el.dataset.tipNums = tip.nums;
  else delete el.dataset.tipNums;
}

/** Tooltips, states and captions — once per sample, not per glide frame. */
function paintTips(): void {
  const root = dock();
  if (!root || !view) return;
  const tips = new Map<string, Tip>([
    ['cpu', cpuTip()],
    ['ram', ramTip()],
  ]);
  const drives = slots();
  for (const slot of drives) tips.set(slotId(slot), driveTip(slot));
  const limitSlot = drives.find(hasLimits);
  const workSlot = drives.find((s) => !hasLimits(s));
  for (const key of DISK_KEYS) {
    tips.set(`lim-${key}`, limTip(key, false, limitSlot));
    tips.set(`lim-${key}-plain`, limTip(key, true, workSlot));
  }
  root.querySelectorAll<HTMLElement>('[data-res-tip]').forEach((el) => {
    const tip = tips.get(el.dataset.resTip ?? '');
    if (tip) setTip(el, tip);
  });
  // States: glow on the cell, the box and (for a disk budget) the limit row.
  for (const id of ['cpu', 'ram', ...drives.map(slotId)]) {
    const st = stateOf(id);
    for (const el of [document.getElementById(`res-cell-${id}`), document.getElementById(`res-box-${id}`)]) {
      el?.classList.toggle('is-at', st === 'at');
      el?.classList.toggle('is-held', st === 'held');
    }
  }
  for (const key of DISK_KEYS) {
    const row = document.getElementById(`res-lim-${key}`);
    const st = rowState(key);
    row?.classList.toggle('is-at', st === 'at');
    row?.classList.toggle('is-held', st === 'held');
  }
  // Tempomat tooltips name the current limit.
  root.querySelectorAll<HTMLElement | SVGElement>('[data-key]').forEach((el) => {
    const key = el.dataset.key as ResourceKey;
    const tip = tempoTip(key);
    if (el.dataset.tip !== tip) el.dataset.tip = tip;
  });
  // Captions.
  const aside = (id: string, text: string): void => {
    const el = document.getElementById(`res-aside-${id}`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  aside('cpu', t('res.threads', { n: view.machine.cores }));
  aside('ram', sample ? `${dec(sample.ramUsedMb / 1024, 1)} / ${dec(view.machine.totalRamMb / 1024, 1)} GB` : `${dec(view.machine.totalRamMb / 1024, 1)} GB`);
  for (const slot of drives) {
    const d = loadOf(slot);
    const kind = t(`res.kind.${slot.kind}`);
    aside(slotId(slot), d?.responseMs !== null && d?.responseMs !== undefined ? `${kind} · ${msText(d.responseMs)}` : kind);
  }
  paintGpu();
  refreshTooltip();
}

function paintGpu(): void {
  if (!view) return;
  const name = document.getElementById('res-gpu-name');
  const text = view.gpu.name ?? t('res.gpuNone');
  if (name && name.textContent !== text) name.textContent = text;
  const sw = document.getElementById('res-gpu-switch');
  const wrap = document.getElementById('res-gpu-wrap');
  if (!sw || !wrap) return;
  const on = view.gpu.enabled && view.gpu.available;
  sw.setAttribute('aria-checked', String(on));
  sw.setAttribute('aria-disabled', String(!view.gpu.available));
  wrap.dataset.tip = view.gpu.available ? t('res.gpuTip') : t('res.gpuUnavailable');
  // A disabled control's tip says why — it opens at the label tier.
  if (view.gpu.available) delete wrap.dataset.tipTier;
  else wrap.dataset.tipTier = 'label';
}

function paintLive(): void {
  paintTips();
  glide();
}

// ── dimming the rest of the app ─────────────────────────────────────────────

function scrim(): HTMLElement {
  let el = document.getElementById('res-scrim');
  if (!el) {
    el = document.createElement('div');
    el.id = 'res-scrim';
    el.className = 'res-scrim';
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('click', () => {
      if (expanded) toggleResourceDock();
    });
    el.addEventListener('animationend', () => el?.classList.remove('is-shimmer'));
    document.body.appendChild(el);
  }
  return el;
}

function syncDim(): void {
  document.body.classList.toggle('res-open', expanded);
  scrim().hidden = !expanded;
}

// ── writing ─────────────────────────────────────────────────────────────────

function queue(key: ResourceKey, value: number): void {
  pending = { ...pending, [key]: value };
  if (commitTimer !== null) window.clearTimeout(commitTimer);
  commitTimer = window.setTimeout(() => void commit(), 250);
}

async function commit(): Promise<void> {
  commitTimer = null;
  const partial = pending;
  if (!Object.keys(partial).length) return;
  try {
    adopt(await window.sc.resources.set(partial));
  } finally {
    pending = {};
  }
}

function ceilingFor(key: ResourceKey): number {
  if (!view) return Infinity;
  if (key === 'ramMb') return view.machine.totalRamMb - ramTaken(view, sample);
  return Infinity;
}

function wirePresets(): void {
  dock()
    ?.querySelectorAll<HTMLButtonElement>('button.res-preset')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.preset as PresetId | undefined;
        if (id) void window.sc.resources.preset(id).then(adopt);
      }),
    );
}

/** Arrow keys / PageUp / PageDown / Home / End on a focused Tempomat. */
function onTempoKey(key: ResourceKey, e: KeyboardEvent): void {
  if (!view) return;
  const r = view.ranges[key];
  const cur = limitOf(key);
  let next: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + r.step;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - r.step;
  else if (e.key === 'PageUp') next = cur + r.step * 10;
  else if (e.key === 'PageDown') next = cur - r.step * 10;
  else if (e.key === 'Home') next = r.min;
  else if (e.key === 'End') next = r.max;
  if (next === null) return;
  // The Tempomat owns the arrows while focused — not the step chevrons.
  e.preventDefault();
  e.stopPropagation();
  queue(key, snapTo(next, r, ceilingFor(key)));
  paintTips();
  glide();
}

function wireDrag(el: Element, key: ResourceKey, grab: string, valueAt: (e: PointerEvent, max: number) => number): void {
  const target = el as HTMLElement;
  const move = (e: PointerEvent): void => {
    if (!view) return;
    const max = dragging?.key === key ? dragging.max : scaleMax(key, view);
    dragging = { key, value: snapTo(valueAt(e, max), view.ranges[key], ceilingFor(key)), max };
    paintFrame();
  };
  target.addEventListener('pointerdown', (e) => {
    // The knob is the only thing that drags; the rest of the gauge is a reading.
    if (!(e.target as Element | null)?.closest(grab)) return;
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    target.focus();
    target.classList.add('is-dragging');
    if (!view) return;
    dragging = { key, value: limitOf(key), max: scaleMax(key, view) };
    move(e);
  });
  target.addEventListener('pointermove', (e) => {
    if (dragging?.key === key) move(e);
  });
  const end = (): void => {
    target.classList.remove('is-dragging');
    if (dragging?.key !== key) return;
    const value = dragging.value;
    dragging = null;
    queue(key, value);
    paintTips();
    glide();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('keydown', (e) => onTempoKey(key, e as KeyboardEvent));
}

function wire(): void {
  document.getElementById('res-toggle')?.addEventListener('click', () => toggleResourceDock());
  wirePresets();
  const root = dock();
  root?.querySelectorAll<SVGSVGElement>('svg.res-dial--tempo[data-key]').forEach((svg) => {
    const key = svg.dataset.key as ResourceKey;
    wireDrag(svg, key, '.dial-tempo', (e, max) => dialValueAt(svg, e.clientX, e.clientY, max));
  });
  root?.querySelectorAll<HTMLElement>('.res-lim-track[data-key]').forEach((track) => {
    const key = track.dataset.key as ResourceKey;
    wireDrag(track, key, '.res-lim-knob', (e, max) => {
      const box = track.getBoundingClientRect();
      return box.width > 0 ? ((e.clientX - box.left) / box.width) * max : 0;
    });
  });
  document.getElementById('res-gpu-switch')?.addEventListener('click', () => {
    if (!view?.gpu.available) return;
    void window.sc.resources.setUseGpu(!view.gpu.enabled).then(adopt);
  });
}

// ── state in ────────────────────────────────────────────────────────────────

function noteHistory(s: ResourceSample): void {
  history.push('cpu.pc', s.cpuTotalPct);
  history.push('cpu.run', s.cpuRunPct);
  history.push('ram.used', s.ramUsedMb);
  history.push('ram.run', s.ramRunMb);
  history.push('run.read', s.readMBs);
  history.push('run.write', s.writeMBs);
  history.push('run.iops', s.iops);
  for (const d of s.drives) {
    const L = d.letter || 'x';
    history.push(`${L}.active`, d.activePct);
    history.push(`${L}.resp`, d.responseMs);
    history.push(`${L}.read`, d.readMBs);
    history.push(`${L}.write`, d.writeMBs);
    history.push(`${L}.iops`, d.iops);
  }
}

function adopt(v: ResourceViewLike): void {
  view = v;
  if (v.sample && v.sample !== sample) {
    sample = v.sample;
    notePeak(v.sample);
  }
  // Already on screen with the same drives: repaint in place. A full render
  // would replace the Tempomat that has keyboard focus every time a change is saved.
  if (document.getElementById('res-toggle') && slots().map(slotId).join('|') === layoutSig) refresh();
  else render();
}

/** Repaint values, preset pills and the preset name without rebuilding the dock. */
function refresh(): void {
  if (!view) return;
  const name = dock()?.querySelector('.res-preset-name');
  if (name) name.textContent = presetName();
  const toggle = document.getElementById('res-toggle');
  if (toggle) toggle.dataset.tip = toggleTip();
  const presets = dock()?.querySelector('.res-presets');
  if (presets) {
    const hadFocus = presets.contains(document.activeElement);
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.preset;
    presets.outerHTML = presetsHtml();
    wirePresets();
    if (hadFocus && focusedId) dock()?.querySelector<HTMLElement>(`[data-preset="${focusedId}"]`)?.focus();
  }
  paintEta();
  paintLive();
}

// ── public ──────────────────────────────────────────────────────────────────

/** Mark the first unfold of a session: the knobs pulse once so the reader sees what moves. */
function pulseOnce(el: HTMLElement): void {
  try {
    if (sessionStorage.getItem(PULSED_KEY) === '1') return;
    sessionStorage.setItem(PULSED_KEY, '1');
  } catch {
    /* no session storage — pulse anyway */
  }
  el.classList.add('is-pulse');
  window.setTimeout(() => el.classList.remove('is-pulse'), 2600);
}

export function toggleResourceDock(): void {
  expanded = !expanded;
  try {
    localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
  render();
  const el = dock();
  if (expanded && el) {
    // Boxes grow out of the strip and the rest of the app dims with one sweep.
    el.classList.add('is-morph');
    window.setTimeout(() => el.classList.remove('is-morph'), 900);
    scrim().classList.add('is-shimmer');
    pulseOnce(el);
    document.querySelector<SVGSVGElement>('#resource-dock svg.res-dial--tempo')?.focus();
  }
}

/** Esc handler: folds an open dock back, reports whether it did. */
export function collapseResourceDockIfOpen(): boolean {
  const el = document.activeElement;
  if (!expanded || !el || !dock()?.contains(el)) return false;
  toggleResourceDock();
  document.getElementById('res-toggle')?.focus();
  return true;
}

/**
 * Tell main which drive the selected game install is on (and, when the output
 * lives elsewhere, the work drive) — the disk scales and the drive cells follow.
 */
export function noteInstallPath(path: string | null | undefined, workPath?: string | null): void {
  if (path) void window.sc.resources.detectDisk(path, workPath ?? undefined).then(adopt).catch(() => undefined);
}

export async function initResourceDock(): Promise<void> {
  try {
    expanded = localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    expanded = false;
  }
  window.sc.resources.onChanged((v) => adopt(v));
  loadDiskPeak();
  window.sc.resources.onSample((s) => {
    sample = s;
    notePeak(s);
    noteHistory(s);
    paintLive();
  });
  // Live numbers only while someone can see them — a hidden tray window does
  // no periodic work (README "Idle behaviour").
  const watch = (): void => void window.sc.resources.watch(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', watch);
  watch();
  adopt(await window.sc.resources.get());
  const el = dock();
  if (expanded && el) pulseOnce(el);
}

/** Re-render after a language switch. */
export function repaintResourceDock(): void {
  render();
}
