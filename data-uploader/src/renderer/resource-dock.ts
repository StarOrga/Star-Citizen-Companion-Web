/**
 * Resource dock — the always-present panel at the bottom of the window where
 * the operator decides how much of the PC a run may take.
 *
 * Collapsed it is one quiet row: what the run uses right now against its limit,
 * per resource. Expanded it shows one dial per resource, drawn like a car's
 * speedometer:
 *
 *   - the scale is this machine's (cores → 100 %, total RAM, the drive class;
 *     a drive of unknown type has no class, so its scales end at the highest
 *     load measured so far and grow with it);
 *   - the hatched end of the dial is what the run can never have (the CPU
 *     share always kept for Windows, the RAM the limit range leaves out);
 *   - the bright arc up to the handle is the operator's limit — drag the handle
 *     (or focus the dial and use the arrow keys) to move it;
 *   - the needle is the whole PC's load, the number Task Manager shows;
 *   - the solid inner arc is the run's share of it.
 *
 * Main owns the limits (`main/resources.ts`); this module only mirrors them and
 * writes through `window.sc.resources`. Every change reaches the running
 * sidecar's governor at once — nothing waits for the next run except the worker
 * count, which is fixed when a stage starts (the panel says so).
 */

import { t } from '../lib/i18n.js';
import {
  PRESET_IDS,
  RESOURCE_KEYS,
  measuredScaleTop,
  ramOthersMb,
  type PresetId,
  type Range,
  type ResourceKey,
  type ResourceLimits,
  type ResourceSample,
} from '../lib/resource-limits.js';
import type { DriveSlot, GpuInfo } from '../lib/drive-load.js';

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

type DiskKey = 'readMBs' | 'writeMBs' | 'iops';
const DISK_KEYS: readonly DiskKey[] = ['readMBs', 'writeMBs', 'iops'];

let view: ResourceViewLike | null = null;
let sample: ResourceSample | null = null;
let expanded = false;
/**
 * The dial being dragged, its uncommitted value — samples must not snap it back —
 * and its scale top, frozen for the drag: a measured scale follows the limit,
 * and a scale moving under the pointer would chase the handle away.
 */
let dragging: { key: ResourceKey; value: number; max: number } | null = null;
/** Highest whole-PC disk load seen on this PC — the scale of a drive of unknown type. */
let diskPeak: Record<DiskKey, number> = { readMBs: 0, writeMBs: 0, iops: 0 };
let commitTimer: number | null = null;
let pending: Partial<ResourceLimits> = {};

const START = -120;
const SWEEP = 240;
const CX = 80;
const CY = 78;
const R = 60;

function dock(): HTMLElement | null {
  return document.getElementById('resource-dock');
}

// ── formatting ──────────────────────────────────────────────────────────────

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
      return (v / 1024).toFixed(v >= 10240 ? 0 : 1);
    case 'readMBs':
    case 'writeMBs':
      return v >= 100 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 0 : 1);
    case 'iops':
      // No locale grouping: "3.314" reads as a decimal next to "0.2 MB/s".
      if (v >= 10000) return `${Math.round(v / 1000)}k`;
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  }
}

function fmt(key: ResourceKey, v: number): string {
  // A run that holds a few dozen MB is not "0.0 GB".
  if (key === 'ramMb' && v > 0 && v < 1024) return `${Math.round(v)} MB`;
  return `${num(key, v)} ${unit(key)}`;
}

const LABEL: Record<ResourceKey, string> = {
  cpuPct: 'res.cpu',
  ramMb: 'res.ram',
  readMBs: 'res.read',
  writeMBs: 'res.write',
  iops: 'res.iops',
};

function isDiskKey(key: ResourceKey): key is DiskKey {
  return (DISK_KEYS as readonly string[]).includes(key);
}

/** A drive of unknown type: its nominal caps are a guess, so its scales are measured. */
function measuredScale(v: ResourceViewLike): boolean {
  return v.machine.disk.kind === 'unknown';
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
    const raw = JSON.parse(localStorage.getItem(PEAK_KEY) ?? 'null') as Partial<Record<DiskKey, unknown>> | null;
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
    const v = total(key, s);
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

/** What the run uses right now. */
function current(key: ResourceKey, s: ResourceSample | null): number {
  if (!s) return 0;
  switch (key) {
    case 'cpuPct':
      return s.cpuRunPct;
    case 'ramMb':
      return s.ramRunMb;
    case 'readMBs':
      return s.readMBs;
    case 'writeMBs':
      return s.writeMBs;
    case 'iops':
      return s.iops;
  }
}

/** The whole PC's load — Task Manager's number; the run's own value until the monitor reports. */
function total(key: ResourceKey, s: ResourceSample | null): number {
  if (!s) return 0;
  switch (key) {
    case 'cpuPct':
      return s.cpuTotalPct;
    case 'ramMb':
      return s.ramUsedMb;
    case 'readMBs':
      return s.sysReadMBs ?? s.readMBs;
    case 'writeMBs':
      return s.sysWriteMBs ?? s.writeMBs;
    case 'iops':
      return s.sysIops ?? s.iops;
  }
}

/** The part of the scale the run cannot have right now — caps the RAM handle. */
function taken(key: ResourceKey, v: ResourceViewLike, s: ResourceSample | null): number {
  if (key === 'cpuPct') {
    const others = s ? Math.max(0, s.cpuTotalPct - s.cpuRunPct) : 0;
    return Math.max(100 - v.ranges.cpuPct.max, others);
  }
  if (key === 'ramMb') return s ? ramOthersMb(s) + s.ramAppMb : v.machine.totalRamMb - v.ranges.ramMb.max;
  return 0;
}

function limitOf(key: ResourceKey): number {
  if (dragging?.key === key) return dragging.value;
  return pending[key] ?? view?.limits[key] ?? 0;
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

function valueAt(svg: SVGSVGElement, clientX: number, clientY: number, max: number): number {
  const box = svg.getBoundingClientRect();
  const x = ((clientX - box.left) / box.width) * 160;
  const y = ((clientY - box.top) / box.height) * 120;
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

// ── painting ────────────────────────────────────────────────────────────────

// ── motion ──────────────────────────────────────────────────────────────────
//
// A sample lands about once a second. Drawn as it arrives, every needle, arc
// and number jumps — the dock ticks like a clock. Instead each dial shows a
// value that glides toward the latest one (exponential ease, settles in about
// half a second), so a jump reads as motion. The dragged handle never lags the
// pointer, and reduced motion draws the target straight away.

/** The four moving parts of a dial. */
interface Shown {
  pc: number;
  use: number;
  max: number;
  limit: number;
}
const SHOWN_FIELDS = ['pc', 'use', 'max', 'limit'] as const;
/** Time constant of the glide, ms. */
const GLIDE_MS = 140;

const shown = new Map<ResourceKey, Shown>();
let frame: number | null = null;
let lastFrame = 0;

function targetOf(key: ResourceKey, v: ResourceViewLike): Shown {
  return { pc: total(key, sample), use: current(key, sample), max: scaleMax(key, v), limit: limitOf(key) };
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** What a dial draws right now — the gliding value, or the target where nothing glides. */
function shownOf(key: ResourceKey, v: ResourceViewLike): Shown {
  const target = targetOf(key, v);
  const cur = shown.get(key);
  if (!cur || reducedMotion()) {
    shown.set(key, target);
    return target;
  }
  if (dragging?.key === key) {
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
  for (const key of RESOURCE_KEYS) {
    const cur = shown.get(key);
    if (!cur) continue;
    const target = targetOf(key, view);
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

/** Let every dial glide to its latest values. */
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

function dialSvg(key: ResourceKey, v: ResourceViewLike, s: ResourceSample | null): string {
  const { max, limit, use, pc } = shownOf(key, v);
  // What no limit can reach — measured against the drawn (gliding) scale.
  const reserve = Math.max(0, max - v.ranges[key].max);
  const aLimit = angleFor(limit, max);
  const aUse = angleFor(use, max);
  const aPc = angleFor(pc, max);
  const aReserve = angleFor(max - reserve, max);
  const over = (s?.running && use > limit * 1.05) || limit > max - taken(key, v, s);
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const a = START + (SWEEP * i) / 8;
    const [x1, y1] = pt(a, R + 7);
    const [x2, y2] = pt(a, R + (i % 2 === 0 ? 12 : 10));
    return `<line class="dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  const [hx, hy] = pt(aLimit);
  const [nx, ny] = pt(aPc, R - 12);
  return `
    <path class="dial-track" d="${arc(START, START + SWEEP)}"/>
    ${reserve > 0 ? `<path class="dial-taken" d="${arc(aReserve, START + SWEEP)}"/>` : ''}
    <path class="dial-limit ${over ? 'is-over' : ''}" d="${arc(START, aLimit)}"/>
    ${use > 0 ? `<path class="dial-run" d="${arc(START, aUse, R - 9)}"/>` : ''}
    ${ticks}
    <line class="dial-needle" x1="${CX}" y1="${CY}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}"/>
    <circle class="dial-hub" cx="${CX}" cy="${CY}" r="4"/>
    <circle class="dial-handle ${over ? 'is-over' : ''}" cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="7"/>
    <text class="dial-value" x="${CX}" y="${CY + 26}" text-anchor="middle">${fmt(key, pc)}</text>
    <text class="dial-limit-text" x="${CX}" y="${CY + 40}" text-anchor="middle">${s?.running ? t('res.runOf', { run: num(key, use), limit: fmt(key, limit) }) : t('res.of', { limit: fmt(key, limit) })}</text>`;
}

function dialNote(key: ResourceKey, v: ResourceViewLike, s: ResourceSample | null): string {
  if (key === 'cpuPct') {
    const others = s ? Math.max(0, s.cpuTotalPct - s.cpuRunPct) : 0;
    return t('res.note.cpu', { cores: v.machine.cores, others: Math.round(others) });
  }
  if (key === 'ramMb') {
    const others = s ? ramOthersMb(s) : 0;
    return t('res.note.ram', {
      total: fmt('ramMb', v.machine.totalRamMb),
      others: fmt('ramMb', others),
      app: fmt('ramMb', s?.ramAppMb ?? 0),
    });
  }
  if (isDiskKey(key) && measuredScale(v)) return t('res.note.disk.unknown', { peak: fmt(key, diskPeak[key]) });
  return t(`res.note.disk.${v.machine.disk.kind}`);
}

function paintDial(key: ResourceKey): void {
  if (!view) return;
  const svg = document.querySelector<SVGSVGElement>(`#res-dial-${key} svg`);
  if (svg) {
    svg.innerHTML = dialSvg(key, view, sample);
    const r = view.ranges[key];
    svg.setAttribute('aria-valuenow', String(limitOf(key)));
    svg.setAttribute('aria-valuetext', fmt(key, limitOf(key)));
    svg.setAttribute('aria-valuemin', String(r.min));
    svg.setAttribute('aria-valuemax', String(r.max));
  }
  const note = document.getElementById(`res-note-${key}`);
  if (note) note.textContent = dialNote(key, view, sample);
}

interface MiniParts {
  tip: string;
  pct: number;
  value: string;
}

function miniParts(key: ResourceKey, v: ResourceViewLike): MiniParts {
  const limit = limitOf(key);
  const { pc, max } = shownOf(key, v);
  const tip = sample?.running
    ? t('res.mini', { run: num(key, current(key, sample)), limit: fmt(key, limit) })
    : t('res.miniIdle', { limit: fmt(key, limit) });
  return { tip, pct: max > 0 ? Math.min(100, (pc / max) * 100) : 0, value: fmt(key, pc) };
}

function miniHtml(key: ResourceKey): string {
  if (!view) return '';
  const m = miniParts(key, view);
  return `<span class="res-mini" id="res-mini-${key}" data-tip="${m.tip}">
      <span class="res-mini-label">${t(LABEL[key])}</span>
      <span class="res-mini-bar"><span style="width:${m.pct.toFixed(1)}%"></span></span>
      <span class="res-mini-val">${m.value}</span>
    </span>`;
}

/** Update a collapsed-row entry in place — rebuilding it every frame would drop its tooltip. */
function paintMini(key: ResourceKey): void {
  const el = document.getElementById(`res-mini-${key}`);
  if (!el || !view) return;
  const m = miniParts(key, view);
  el.dataset.tip = m.tip;
  const bar = el.querySelector<HTMLElement>('.res-mini-bar > span');
  if (bar) bar.style.width = `${m.pct.toFixed(1)}%`;
  const val = el.querySelector('.res-mini-val');
  if (val && val.textContent !== m.value) val.textContent = m.value;
}

function statusLine(): string {
  if (!view) return '';
  if (!view.supported) return t('res.status.unsupported');
  if (sample?.running && sample.heldBack > 0.05) {
    return t('res.status.heldBack', { pct: Math.round(sample.heldBack * 100) });
  }
  if (sample?.running && !sample.hardCap) return t('res.status.noHardCap');
  return sample?.running ? t('res.status.live') : t('res.status.idle');
}

function paintFrame(): void {
  for (const key of RESOURCE_KEYS) {
    if (expanded) paintDial(key);
    paintMini(key);
  }
}

function paintLive(): void {
  const st = document.getElementById('res-status');
  if (st) st.textContent = statusLine();
  glide();
}

function presetsHtml(): string {
  if (!view) return '';
  const pills = PRESET_IDS.map(
    (id) =>
      `<button type="button" class="res-preset ${view?.preset === id ? 'active' : ''}" data-preset="${id}" aria-pressed="${view?.preset === id}" data-tip="${t(`res.preset.${id}Desc`)}">${t(`res.preset.${id}`)}</button>`,
  ).join('');
  const custom = view.preset === null ? `<span class="res-preset res-preset--custom active">${t('res.preset.custom')}</span>` : '';
  return `<div class="res-presets" role="group" aria-label="${t('res.presetsAria')}">${pills}${custom}</div>`;
}

function render(): void {
  const el = dock();
  if (!el || !view) return;
  el.hidden = false;
  el.setAttribute('aria-label', t('res.title'));
  el.classList.toggle('is-expanded', expanded);
  const head = `
    <div class="res-head">
      <button type="button" class="res-toggle" id="res-toggle" aria-expanded="${expanded}" aria-controls="res-body" data-tip="${t('res.toggleHint')}" data-tip-key="T">
        <span class="res-toggle-icon" aria-hidden="true">${expanded ? '▾' : '▴'}</span>
        <span class="res-title">${t('res.title')}</span>
        <span class="res-preset-name">${view.preset ? t(`res.preset.${view.preset}`) : t('res.preset.custom')}</span>
      </button>
      <div class="res-minis">${RESOURCE_KEYS.map(miniHtml).join('')}</div>
    </div>`;
  const body = expanded
    ? `<div class="res-body" id="res-body">
        <div class="res-body-top">
          ${presetsHtml()}
          <span class="res-status" id="res-status" role="status" aria-live="polite">${statusLine()}</span>
        </div>
        <div class="res-dials">
          ${RESOURCE_KEYS.map(
            (key) => `
            <figure class="res-dial" id="res-dial-${key}">
              <figcaption>${t(LABEL[key])}</figcaption>
              <svg viewBox="0 0 160 120" role="slider" tabindex="0" aria-label="${t(LABEL[key])}" data-key="${key}"></svg>
              <p class="res-note" id="res-note-${key}"></p>
            </figure>`,
          ).join('')}
          <figure class="res-dial res-dial--gpu">
            <figcaption>${t('res.gpu')}</figcaption>
            <p class="res-gpu-text">${t('res.gpuNote')}</p>
          </figure>
        </div>
        <p class="res-foot">${t('res.foot')}</p>
      </div>`
    : '';
  el.innerHTML = head + body;
  wire();
  if (expanded) for (const key of RESOURCE_KEYS) paintDial(key);
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
  // RAM others hold right now cannot be handed to the run.
  if (key === 'ramMb') return view.machine.totalRamMb - taken('ramMb', view, sample);
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

function wire(): void {
  document.getElementById('res-toggle')?.addEventListener('click', () => toggleResourceDock());
  wirePresets();
  dock()
    ?.querySelectorAll<SVGSVGElement>('.res-dial svg[data-key]')
    .forEach((svg) => {
      const key = svg.dataset.key as ResourceKey;
      const move = (e: PointerEvent): void => {
        if (!view) return;
        const r = view.ranges[key];
        const max = scaleMax(key, view);
        dragging = { key, value: snapTo(valueAt(svg, e.clientX, e.clientY, max), r, ceilingFor(key)), max };
        paintDial(key);
      };
      svg.addEventListener('pointerdown', (e) => {
        svg.setPointerCapture(e.pointerId);
        svg.focus();
        move(e);
      });
      svg.addEventListener('pointermove', (e) => {
        if (dragging?.key === key) move(e);
      });
      const end = (): void => {
        if (dragging?.key !== key) return;
        const value = dragging.value;
        dragging = null;
        queue(key, value);
        glide();
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('keydown', (e) => {
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
        // The dial owns the arrows while focused — not the step chevrons.
        e.preventDefault();
        e.stopPropagation();
        queue(key, snapTo(next, r, ceilingFor(key)));
        glide();
      });
    });
}

function adopt(v: ResourceViewLike): void {
  view = v;
  if (v.sample) {
    sample = v.sample;
    notePeak(v.sample);
  }
  // Already on screen: repaint in place. A full render would replace the dial
  // that has keyboard focus every time a change is saved.
  if (document.getElementById('res-toggle')) refresh();
  else render();
}

/** Repaint values, preset pills and the preset name without rebuilding the dock. */
function refresh(): void {
  if (!view) return;
  const name = dock()?.querySelector('.res-preset-name');
  if (name) name.textContent = view.preset ? t(`res.preset.${view.preset}`) : t('res.preset.custom');
  const presets = dock()?.querySelector('.res-presets');
  if (presets) {
    presets.outerHTML = presetsHtml();
    wirePresets();
  }
  paintLive();
}

// ── public ──────────────────────────────────────────────────────────────────

export function toggleResourceDock(): void {
  expanded = !expanded;
  try {
    localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
  render();
  if (expanded) document.querySelector<SVGSVGElement>('.res-dial svg')?.focus();
}

/** Esc handler: folds an open dock back, reports whether it did. */
export function collapseResourceDockIfOpen(): boolean {
  const el = document.activeElement;
  if (!expanded || !el || !dock()?.contains(el)) return false;
  toggleResourceDock();
  return true;
}

/** Tell main which drive the selected game install is on — the disk scales follow it. */
export function noteInstallPath(path: string | null | undefined): void {
  if (path) void window.sc.resources.detectDisk(path).then(adopt).catch(() => undefined);
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
    paintLive();
  });
  // Live numbers only while someone can see them — a hidden tray window does
  // no periodic work (README "Idle behaviour").
  const watch = (): void => void window.sc.resources.watch(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', watch);
  watch();
  adopt(await window.sc.resources.get());
}

/** Re-render after a language switch. */
export function repaintResourceDock(): void {
  render();
}
