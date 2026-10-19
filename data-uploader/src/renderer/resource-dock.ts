/**
 * Performance dock — the always-present panel at the bottom of the window where
 * the operator decides how much of the PC a run may take.
 *
 * One colour language everywhere (cells AND dials): the uploader's share is
 * accent blue — the run (sidecar tree) PLUS the app's own processes; other
 * programs are white; free is the dark well. The Tempomat (cruise control)
 * limits only the run, so the blue share may sit above a limit by the app's
 * part — the tooltips say so and keep run / app / limit as separate numbers.
 *
 * Folded it is one strip in one rounded frame: the PERFORMANCE tab (preset
 * name, ▴) and one cell per resource — CPU, RAM, one per drive the run touches
 * (game drive, work drive, or one cell when both are the same disk) and the
 * GPU while the uploader may use it (gpuPct > 0, GPU available). A cell is
 * icon · label · a 12-LED bar · "41 % von 100 %" (uploader first, then the
 * whole PC), always in percent: RAM of the total RAM, a drive's active time,
 * the GPU's load. The LED bars stay when the dock unfolds; the icons go.
 *
 * Unfolded, one card per resource grows out of the strip, the rest of the app
 * dims, and the preset pills sit in the tab. Every card is the same grid —
 * header · gauge (identical size in every card) · control row (fixed height,
 * empty for CPU/RAM) · phase pips — so gauges and pips line up across cards.
 *
 * The gauge is a segment ring: ~30 segments lit blue up to the uploader, white
 * up to the whole PC, dark beyond; a small pointer tip marks the total, the big
 * centre number is the total, a trio below names Uploader · andere · frei with
 * units. The Tempomat is a blue knob outside the ring — the only part that
 * drags (or focus the dial and use the arrow keys); calm = accent, at its limit
 * = bright glow, held back by a disk budget = amber, explained in the tooltip.
 *
 * Drive cards: a segmented toggle Lesen / Schreiben / Zugriffe picks the metric
 * the gauge shows (whole-PC value of the disk + the run's share). The disk
 * limits are ONE budget for the run, scaled to the game drive, so only the
 * game / both drive's gauge carries a knob. The default metric is the budget
 * holding the run back (`defaultDiskMetric`), else read — picked once per
 * unfold, never switched while open. Every disk scale adapts to the highest
 * load measured on this PC (persisted peaks, grow-only — `diskScaleTop`).
 *
 * GPU card: Auslastung | VRAM; the load gauge's knob is `gpuPct` (0 = GPU off,
 * the gauge dims and says how to turn it on). Without a usable GPU there is no
 * knob, only a note that silhouettes and 3D run on the CPU.
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
  diskScaleTop,
  dumpWorkers,
  presetLimits,
  ramOthersMb,
  type LimitKey,
  type PresetId,
  type Range,
  type MachineInfo,
  type ResourceLimits,
  type ResourceSample,
  type SampleGpu,
} from '../lib/resource-limits.js';
import { estimateFor, formatApprox, type RunEstimate } from '../lib/run-estimate.js';
import type { DriveLoad, DriveSlot, GpuInfo } from '../lib/drive-load.js';
import {
  History,
  PHASES,
  bindingDiskLimit,
  boostLevels,
  defaultDiskMetric,
  dots,
  driveRunPct,
  ledSplit,
  padCell,
  type BoostSubject,
  type DiskLimitKey,
} from '../lib/dock-metrics.js';
import { refreshTooltip } from './tooltip.js';

/** Mirror of `main/resources.ts:ResourceView` (the renderer cannot import main). */
export interface ResourceViewLike {
  machine: { cores: number; totalRamMb: number; disk: { kind: string; readMBs: number; writeMBs: number; iops: number } };
  limits: ResourceLimits;
  ranges: Record<LimitKey, Range>;
  preset: PresetId | null;
  supported: boolean;
  liveJobs: number;
  sample: ResourceSample | null;
  /** See `lib/drive-load.ts`. */
  drives: DriveSlot[];
  gpu: GpuInfo;
}

type GpuMetric = 'load' | 'vram';

const EXPANDED_KEY = 'sc.resourceDock.expanded';
const PEAK_KEY = 'sc.resourceDock.diskPeak';
/** Session flag: the knobs pulse once, on the first unfold of a session. */
const PULSED_KEY = 'sc.resourceDock.pulsed';

const DISK_KEYS: readonly DiskLimitKey[] = ['readMBs', 'writeMBs', 'iops'];
const GPU_METRICS: readonly GpuMetric[] = ['load', 'vram'];
/** Cells of the strip's LED bar and segments of a dial's ring. */
const LEDS = 12;
const SEGMENTS = 30;

let view: ResourceViewLike | null = null;
let sample: ResourceSample | null = null;
let expanded = false;
/**
 * The Tempomat being dragged, its uncommitted value — samples must not snap it
 * back — and its scale top, frozen for the drag: a measured scale follows the
 * limit, and a scale moving under the pointer would chase the knob away.
 */
let dragging: { key: LimitKey; value: number; max: number } | null = null;
/** Highest whole-PC disk load seen on this PC — the scale of every drive gauge. */
let diskPeak: Record<DiskLimitKey, number> = { readMBs: 0, writeMBs: 0, iops: 0 };
/** Scale tops already drawn, per drive and metric — a scale only grows. */
const scaleTops = new Map<string, number>();
let commitTimer: number | null = null;
let pending: Partial<ResourceLimits> = {};
/** Layout the markup was built for (drives, GPU cell) — a new layout needs a new render. */
let layoutSig = '';
const history = new History();
/** The run's duration estimate under the limits in force, or null (nothing honest to say). */
let estimate: RunEstimate | null = null;
/** Metric each drive card shows — picked at unfold, kept until the dock folds. */
const diskSel = new Map<string, DiskLimitKey>();
let gpuSel: GpuMetric = 'load';

// Dial geometry (viewBox 0 0 160 108).
const START = -120;
const SWEEP = 240;
const CX = 80;
const CY = 60;
const R = 42;
/** Gap between two ring segments, degrees. */
const SEG_GAP = 1.8;

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

function unit(key: LimitKey): string {
  switch (key) {
    case 'cpuPct':
    case 'gpuPct':
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
function num(key: LimitKey, v: number): string {
  switch (key) {
    case 'cpuPct':
    case 'gpuPct':
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

function fmt(key: LimitKey, v: number): string {
  // A run that holds a few dozen MB is not "0,0 GB".
  if (key === 'ramMb' && v > 0 && v < 1024) return `${Math.round(v)} MB`;
  return `${num(key, v)} ${unit(key)}`;
}

function fmtOr(key: LimitKey, v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? fmt(key, v) : '—';
}

function pctText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)} %` : '—';
}

function msText(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${dec(v, v >= 10 ? 0 : 1)} ms` : '—';
}

/** A disk value: the label already names what is counted, so operations read "640/s". */
function rowValue(key: DiskLimitKey, v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return key === 'iops' ? `${num('iops', v)}/s` : fmt(key, v);
}

const LIMIT_LABEL: Record<DiskLimitKey, string> = {
  readMBs: 'res.num.read',
  writeMBs: 'res.num.write',
  iops: 'res.num.iops',
};

// ── data access ─────────────────────────────────────────────────────────────

function isDiskKey(key: LimitKey): key is DiskLimitKey {
  return (DISK_KEYS as readonly string[]).includes(key);
}

/** The drive layout; before an install is selected one unnamed drive stands for the run's disk. */
function slots(): DriveSlot[] {
  if (view?.drives.length) return view.drives;
  return [{ letter: '', letters: [], role: 'both', kind: (view?.machine.disk.kind ?? 'unknown') as DriveSlot['kind'] }];
}

function slotId(slot: DriveSlot): string {
  return `drive-${slot.role}-${slot.letter || 'x'}`;
}

/** The drive the disk budget belongs to (and whose gauge carries its knob). */
function hasLimits(slot: DriveSlot): boolean {
  return slot.role !== 'work';
}

function limitSlot(): DriveSlot | undefined {
  return slots().find(hasLimits);
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

/** Scale top of a drive gauge: the highest load measured so far, grow-only. */
function diskTop(key: DiskLimitKey, v: ResourceViewLike, slot: DriveSlot | undefined): number {
  const id = `${slot ? slotId(slot) : 'x'}:${key}`;
  const lim = slot && hasLimits(slot) ? limitOf(key) : 0;
  const top = diskScaleTop(diskPeak[key], lim, v.ranges[key].min, v.ranges[key].max, scaleTops.get(id) ?? 0);
  scaleTops.set(id, top);
  return top;
}

/** Top of the drawn scale (the limit range may stop short of it). */
function scaleMax(key: LimitKey, v: ResourceViewLike, slot: DriveSlot | undefined = limitSlot()): number {
  if (dragging?.key === key) return dragging.max;
  if (key === 'ramMb') return v.machine.totalRamMb;
  if (isDiskKey(key)) return diskTop(key, v, slot);
  return 100;
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
    const v = Math.max(diskTotal(key, s), ...s.drives.map((d) => d[key] ?? 0));
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

function limitOf(key: LimitKey): number {
  if (dragging?.key === key) return dragging.value;
  return pending[key] ?? view?.limits[key] ?? 0;
}

/** The uploader's CPU share: the run plus the app itself. */
function cpuUploader(s: ResourceSample | null): number {
  return s ? s.cpuRunPct + (s.cpuAppPct ?? 0) : 0;
}

/** RAM others hold right now cannot be handed to the run. */
function ramTaken(v: ResourceViewLike, s: ResourceSample | null): number {
  return s ? ramOthersMb(s) + s.ramAppMb : v.machine.totalRamMb - v.ranges.ramMb.max;
}

function gpuSample(): SampleGpu | null {
  return sample?.gpu ?? null;
}

function gpuAvailable(): boolean {
  return Boolean(view?.gpu.available);
}

function vramTotal(): number | null {
  return gpuSample()?.vramTotalMb ?? view?.gpu.vramTotalMb ?? null;
}

/** The folded GPU cell exists only while the uploader may use the GPU. */
function gpuCellShown(): boolean {
  return gpuAvailable() && (view?.limits.gpuPct ?? 0) > 0;
}

function layoutKey(): string {
  return `${slots().map(slotId).join('|')}|gpu:${gpuAvailable() ? 1 : 0}${gpuCellShown() ? 1 : 0}`;
}

/** The metric a drive card shows; picked the first time it is drawn after an unfold. */
function selOf(slot: DriveSlot): DiskLimitKey {
  const id = slotId(slot);
  let sel = diskSel.get(id);
  if (!sel) {
    sel = hasLimits(slot) ? defaultDiskMetric(sample, view?.limits ?? null) : 'readMBs';
    diskSel.set(id, sel);
  }
  return sel;
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
  if (id === 'gpu') {
    const g = gpuSample();
    const lim = limitOf('gpuPct');
    return g && lim > 0 && g.runLoadPct >= lim * 0.92 ? 'at' : '';
  }
  const slot = slots().find((s) => slotId(s) === id);
  if (slot && hasLimits(slot) && sample.heldBack > 0.05) return 'held';
  return '';
}

// ── motion ──────────────────────────────────────────────────────────────────
//
// A sample lands about once a second. Drawn as it arrives, every segment, arc
// and number jumps — the dock ticks like a clock. Instead each part shows a
// value that glides toward the latest one (exponential ease, settles in about
// half a second), so a jump reads as motion. The dragged knob never lags the
// pointer, and reduced motion draws the target straight away.

/** The four moving parts of a gauge (+ the limit it draws, for the drag). */
interface Shown {
  pc: number;
  use: number;
  max: number;
  limit: number;
  key?: LimitKey;
}
const SHOWN_FIELDS = ['pc', 'use', 'max', 'limit'] as const;
/** Time constant of the glide, ms. */
const GLIDE_MS = 140;

const shown = new Map<string, Shown>();
let frame: number | null = null;
let lastFrame = 0;

function driveGaugeId(slot: DriveSlot): string {
  return `${slotId(slot)}:${selOf(slot)}`;
}

/** Every gauge's latest values: 'cpu', 'ram', 'gpu:load', 'gpu:vram', per drive its cell and its card's metric. */
function targets(v: ResourceViewLike): Map<string, Shown> {
  const s = sample;
  const out = new Map<string, Shown>();
  out.set('cpu', { pc: s?.cpuTotalPct ?? 0, use: cpuUploader(s), max: 100, limit: limitOf('cpuPct'), key: 'cpuPct' });
  out.set('ram', { pc: s?.ramUsedMb ?? 0, use: s ? s.ramRunMb + s.ramAppMb : 0, max: scaleMax('ramMb', v), limit: limitOf('ramMb'), key: 'ramMb' });
  for (const slot of slots()) {
    const d = loadOf(slot);
    out.set(slotId(slot), { pc: d?.activePct ?? 0, use: driveRunPct(d?.activePct ?? null, d?.runSharePct ?? null), max: 100, limit: 0 });
    if (!expanded) continue;
    const key = selOf(slot);
    const lim = hasLimits(slot);
    out.set(driveGaugeId(slot), {
      pc: d?.[key] ?? (lim ? diskTotal(key, s) : 0),
      use: lim ? diskRun(key, s) : (d?.run[key] ?? 0),
      max: scaleMax(key, v, slot),
      limit: lim ? limitOf(key) : 0,
      key: lim ? key : undefined,
    });
  }
  const g = gpuSample();
  out.set('gpu:load', { pc: g?.loadPct ?? 0, use: g?.runLoadPct ?? 0, max: 100, limit: limitOf('gpuPct'), key: 'gpuPct' });
  const vt = vramTotal();
  out.set('gpu:vram', { pc: g?.vramUsedMb ?? 0, use: g?.vramRunMb ?? 0, max: vt && vt > 0 ? vt : Math.max(1, g?.vramUsedMb ?? 1), limit: 0 });
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
  if (dragging && target.key === dragging.key) {
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
    y = ((clientY - box.top) / box.height) * 108;
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

function dialMarkup(id: string, key: LimitKey | null, label: string): string {
  const step = SWEEP / SEGMENTS;
  const segs = Array.from({ length: SEGMENTS }, (_, i) => {
    const a1 = START + step * i + SEG_GAP / 2;
    return `<path class="dial-sg" d="${arc(a1, a1 + step - SEG_GAP)}"/>`;
  }).join('');
  const trio = ([
    [40, 'run', 'res.trio.run'],
    [80, 'oth', 'res.trio.others'],
    [120, 'free', 'res.trio.free'],
  ] as const)
    .map(
      ([x, cls, lbl]) =>
        `<text class="dial-trio dial-trio--${cls}" x="${x}" y="96" text-anchor="middle"></text><text class="dial-trio-lbl" x="${x}" y="105" text-anchor="middle">${esc(t(lbl))}</text>`,
    )
    .join('');
  const parts = `
    <g class="dial-ring">${segs}</g>
    <path class="dial-pointer" d=""/>
    <text class="dial-value" x="${CX}" y="${CY + 4}" text-anchor="middle"></text>
    <text class="dial-sub" x="${CX}" y="${CY + 15}" text-anchor="middle"></text>
    <g class="dial-trios">${trio}</g>`;
  if (!key) {
    return `<svg class="res-dial" id="res-dial-${id}" viewBox="0 0 160 108" role="img" aria-label="${esc(label)}">${parts}</svg>`;
  }
  return `<svg class="res-dial res-dial--tempo" id="res-dial-${id}" viewBox="0 0 160 108" role="slider" tabindex="0" aria-label="${esc(label)}" data-key="${key}">${parts}
    <g class="dial-tempo">
      <line class="dial-tempo-tick"/>
      <circle class="dial-tempo-halo" r="9"/>
      <circle class="dial-tempo-knob" r="5"/>
    </g></svg>`;
}

function boostHtml(subject: BoostSubject, off = false): string {
  const lv = boostLevels(subject);
  const items = PHASES.map((p, i) => {
    const n = off ? 0 : (lv[i] ?? 0);
    // Drawn as shapes, not glyphs: a ● at this size merges into a bar in some fonts.
    const pips = [1, 2, 3].map((k) => `<span class="res-pip${k <= n ? ' on' : ''}"></span>`).join('');
    return `<span class="res-boost-item">${t(`res.phase.${p}`)} <span class="res-pips" role="img" aria-label="${dots(n)}">${pips}</span></span>`;
  }).join('');
  return `<p class="res-boost" tabindex="0" data-tip="${esc(t(`res.boost.${subject}`))}" aria-label="${esc(t('res.boostAria'))}">${icon('bolt', 'res-ico res-ico--bolt')}${items}</p>`;
}

function cellHtml(id: string, ico: keyof typeof ICON, label: string, withLimit: boolean): string {
  const leds = Array.from({ length: LEDS }, () => '<i class="res-led"></i>').join('');
  return `<div class="res-cell" id="res-cell-${id}" data-res-tip="${id}" tabindex="0" role="meter" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)}">
      ${icon(ico)}
      <span class="res-cell-label">${esc(label)}</span>
      <span class="res-leds" aria-hidden="true">${leds}${withLimit ? '<span class="lim"></span>' : ''}</span>
      <span class="res-cell-num"><b class="res-n-run">—</b><span class="res-n-of">${esc(t('res.cell.of'))}</span><b class="res-n-pc">—</b></span>
    </div>`;
}

/** A segmented toggle: exactly one option selected, arrows move it (roving focus). */
function segHtml(group: string, aria: string, options: ReadonlyArray<readonly [string, string]>, selected: string): string {
  const btns = options
    .map(([val, label]) => {
      const on = val === selected;
      return `<button type="button" class="res-seg-btn" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-seg="${esc(group)}" data-val="${esc(val)}">${esc(label)}</button>`;
    })
    .join('');
  return `<div class="res-seg" role="radiogroup" aria-label="${esc(aria)}" style="--n:${options.length}">${btns}</div>`;
}

function boxHtml(i: number, id: string, ico: keyof typeof ICON, name: string, gauge: string, ctrl: string, boost: string, extra = ''): string {
  return `<figure class="res-box${extra}" id="res-box-${id}" style="--i:${i}">
      <figcaption data-res-tip="${id}">${icon(ico)}<span class="res-box-name">${esc(name)}</span><span class="res-box-aside" id="res-aside-${id}"></span></figcaption>
      <div class="res-garea" data-res-tip="g-${id}">${gauge}</div>
      <div class="res-ctrl">${ctrl}</div>
      ${boost}
    </figure>`;
}

function driveBoxHtml(i: number, slot: DriveSlot): string {
  const id = slotId(slot);
  const sel = selOf(slot);
  const gauge = dialMarkup(id, hasLimits(slot) ? sel : null, `${driveName(slot)} · ${t(LIMIT_LABEL[sel])}`);
  const seg = segHtml(id, t('res.seg.aria'), DISK_KEYS.map((k) => [k, t(LIMIT_LABEL[k])] as const), sel);
  return boxHtml(i, id, 'disk', cellLabel(slot), gauge, seg, boostHtml(slot.role), ' res-box--drive');
}

function gpuBoxHtml(i: number): string {
  if (!gpuAvailable()) {
    const msg = `<div class="res-gpu-msg"><p>${esc(t('res.gpuNoneTitle'))}</p><p class="res-gpu-msg-hint">${esc(t('res.gpuNoneHint'))}</p></div>`;
    return boxHtml(i, 'gpu', 'gpu', t('res.gpu'), msg, '', boostHtml('gpu', true), ' res-box--gpu is-none');
  }
  const load = gpuSel === 'load';
  const gauge =
    dialMarkup('gpu', load ? 'gpuPct' : null, load ? t('res.gpuLoad') : t('res.seg.vram')) +
    (load ? `<p class="res-gpu-off" aria-hidden="true">${esc(t('res.gpuOffHint'))}</p>` : '');
  const seg = segHtml('gpu', t('res.seg.aria'), GPU_METRICS.map((m) => [m, t(`res.seg.${m}`)] as const), gpuSel);
  return boxHtml(i, 'gpu', 'gpu', t('res.gpu'), gauge, seg, boostHtml('gpu'), ' res-box--gpu');
}

function presetsHtml(): string {
  if (!view) return '';
  const pills = PRESET_IDS.map(
    (id) =>
      `<button type="button" class="res-preset ${view?.preset === id ? 'active' : ''}" data-preset="${id}" aria-pressed="${view?.preset === id}" data-tip="${esc(presetTip(id))}">${t(`res.preset.${id}`)} <span class="res-preset-eta" data-eta="${id}">${esc(etaText(id))}</span></button>`,
  ).join('');
  const custom =
    view.preset === null
      ? `<span class="res-preset res-preset--custom active" tabindex="0" data-tip="${esc(presetTip(null))}">${t('res.preset.custom')} <span class="res-preset-eta" data-eta="custom">${esc(etaText(null))}</span></span>`
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
  layoutSig = layoutKey();
  const cells = [
    cellHtml('cpu', 'cpu', t('res.cell.cpu'), true),
    cellHtml('ram', 'ram', t('res.cell.ram'), true),
    ...drives.map((d) => cellHtml(slotId(d), 'disk', cellLabel(d), false)),
    ...(gpuCellShown() ? [cellHtml('gpu', 'gpu', t('res.gpu'), true)] : []),
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
      boxHtml(i++, 'cpu', 'cpu', t('res.cell.cpu'), dialMarkup('cpu', 'cpuPct', t('res.cell.cpu')), '', boostHtml('cpu')),
      boxHtml(i++, 'ram', 'ram', t('res.cell.ram'), dialMarkup('ram', 'ramMb', t('res.cell.ram')), '', boostHtml('ram')),
      ...drives.map((d) => driveBoxHtml(i++, d)),
    ];
    boxes.push(gpuBoxHtml(i));
    // Equal columns: every gauge the same size.
    body = `<div class="res-body" id="res-body"><div class="res-boxes" style="grid-template-columns:repeat(${boxes.length}, minmax(0, 1fr))">${boxes.join('')}</div></div>`;
  }
  el.innerHTML = strip + body;
  syncDim();
  wire();
  paintLive();
  paintFrame();
}

// ── painting ────────────────────────────────────────────────────────────────

function setText(root: ParentNode, sel: string, text: string): void {
  const el = root.querySelector(sel);
  if (el && el.textContent !== text) el.textContent = text;
}

function setCls(el: Element, cls: string): void {
  if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
}

/** Percent of a gauge's scale, 0..100. */
function pctOf(v: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}

function paintDial(id: string, key: LimitKey | null, s: Shown, value: string, sub: string, trio: readonly [string, string, string]): void {
  const svg = document.getElementById(`res-dial-${id}`);
  if (!svg) return;
  const total = Math.max(s.pc, s.use);
  const lit = ledSplit(pctOf(total, s.max), pctOf(s.use, s.max), SEGMENTS);
  svg.querySelectorAll('.dial-sg').forEach((seg, i) => {
    setCls(seg, i < lit.run ? 'dial-sg run' : i < lit.run + lit.others ? 'dial-sg oth' : 'dial-sg');
  });
  const pointer = svg.querySelector('.dial-pointer');
  if (pointer) {
    let d = '';
    if (total > 0) {
      const a = angleFor(total, s.max);
      const [tx, ty] = pt(a, R - 6);
      const [b1x, b1y] = pt(a - 6, R - 13);
      const [b2x, b2y] = pt(a + 6, R - 13);
      d = `M${tx.toFixed(2)} ${ty.toFixed(2)} L${b1x.toFixed(2)} ${b1y.toFixed(2)} L${b2x.toFixed(2)} ${b2y.toFixed(2)} Z`;
    }
    if (pointer.getAttribute('d') !== d) pointer.setAttribute('d', d);
  }
  setText(svg, '.dial-value', value);
  setText(svg, '.dial-sub', sub);
  setText(svg, '.dial-trio--run', trio[0]);
  setText(svg, '.dial-trio--oth', trio[1]);
  setText(svg, '.dial-trio--free', trio[2]);
  if (!key || !view) return;
  const aLim = angleFor(s.limit, s.max);
  const [t1x, t1y] = pt(aLim, R - 7);
  const [t2x, t2y] = pt(aLim, R + 7);
  const [kx, ky] = pt(aLim, R + 14);
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
  svg.setAttribute('aria-valuetext', key === 'gpuPct' && lim <= 0 ? t('res.gpuOffShort') : fmt(key, lim));
  svg.setAttribute('aria-valuemin', String(r.min));
  svg.setAttribute('aria-valuemax', String(r.max));
}

/** A strip cell: LEDs (uploader blue, others white), "41 % von 100 %", the limit tick. */
function paintCell(id: string, runPct: number, totalPct: number, limitPct: number | null, measured = true): void {
  const el = document.getElementById(`res-cell-${id}`);
  if (!el) return;
  const total = Math.max(totalPct, runPct);
  const lit = ledSplit(total, runPct, LEDS);
  el.querySelectorAll('.res-led').forEach((led, i) => {
    setCls(led, i < lit.run ? 'res-led run' : i < lit.run + lit.others ? 'res-led oth' : 'res-led');
  });
  const l = el.querySelector<HTMLElement>('.res-leds .lim');
  if (l) {
    l.hidden = limitPct === null;
    if (limitPct !== null) l.style.left = `calc(${Math.max(0, Math.min(100, limitPct)).toFixed(1)}% - 1px)`;
  }
  const run = measured ? `${Math.round(Math.min(runPct, total))} %` : '—';
  const all = measured ? `${Math.round(total)} %` : '—';
  setText(el, '.res-n-run', run);
  setText(el, '.res-n-pc', all);
  el.setAttribute('aria-valuenow', String(Math.round(total)));
  el.setAttribute('aria-valuetext', t('res.cell.aria', { run, total: all }));
}

/** Uploader · others · free of a gauge, formatted. */
function trioOf(s: Shown, f: (v: number) => string): [string, string, string] {
  const total = Math.max(s.pc, s.use);
  return [f(s.use), f(Math.max(0, total - s.use)), f(Math.max(0, s.max - total))];
}

/** One glide frame: every segment, LED, pointer and number. */
function paintFrame(): void {
  if (!view) return;
  const all = targets(view);
  const p = (v: number): string => `${Math.round(v)} %`;
  const cpu = shownOf('cpu', all);
  paintCell('cpu', cpu.use, cpu.pc, cpu.limit, Boolean(sample));
  const ram = shownOf('ram', all);
  const totalRam = view.machine.totalRamMb || 1;
  paintCell('ram', (ram.use / totalRam) * 100, (ram.pc / totalRam) * 100, (ram.limit / totalRam) * 100, Boolean(sample));
  for (const slot of slots()) {
    const d = shownOf(slotId(slot), all);
    paintCell(slotId(slot), d.use, d.pc, null, typeof loadOf(slot)?.activePct === 'number');
  }
  const load = shownOf('gpu:load', all);
  paintCell('gpu', load.use, load.pc, load.limit, Boolean(gpuSample()));
  if (!expanded) return;
  const pcSub = t('res.dial.pc');
  paintDial('cpu', 'cpuPct', cpu, p(Math.max(cpu.pc, cpu.use)), pcSub, trioOf(cpu, p));
  paintDial('ram', 'ramMb', ram, p((Math.max(ram.pc, ram.use) / totalRam) * 100), pcSub, trioOf(ram, (v) => fmt('ramMb', v)));
  for (const slot of slots()) {
    const key = selOf(slot);
    const g = shownOf(driveGaugeId(slot), all);
    const measured = typeof loadOf(slot)?.[key] === 'number' || (hasLimits(slot) && Boolean(sample));
    paintDial(
      slotId(slot),
      hasLimits(slot) ? key : null,
      g,
      measured ? num(key, Math.max(g.pc, g.use)) : '—',
      t('res.dial.scale', { unit: key === 'iops' ? t('res.unitIops') : unit(key), top: num(key, g.max) }),
      trioOf(g, (v) => rowValue(key, v)),
    );
  }
  const box = document.getElementById('res-box-gpu');
  box?.classList.toggle('is-off', gpuAvailable() && gpuSel === 'load' && limitOf('gpuPct') <= 0);
  if (!gpuAvailable()) return;
  const gs = gpuSample();
  if (gpuSel === 'load') {
    paintDial('gpu', 'gpuPct', load, gs ? p(Math.max(load.pc, load.use)) : '—', pcSub, trioOf(load, p));
  } else {
    const vram = shownOf('gpu:vram', all);
    const vt = vramTotal();
    const big = !gs ? '—' : vt ? p((Math.max(vram.pc, vram.use) / vt) * 100) : fmt('ramMb', vram.pc);
    const sub = vt ? `${pcSub} · ${fmt('ramMb', vt)}` : pcSub;
    paintDial('gpu', null, vram, big, sub, trioOf(vram, (v) => fmt('ramMb', v)));
  }
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
    t('res.tip.runOnly'),
    s?.running && !s.hardCap ? t('res.tip.cpuNoHardCap') : '',
  ].filter(Boolean);
  return {
    title: state === 'at' ? t('res.tip.atLimit') : undefined,
    text: text.join('\n\n'),
    nums: numsGrid([
      [t('res.num.pc'), s ? p(s.cpuTotalPct) : '—', ...stat('cpu.pc', p)],
      [t('res.num.run'), s ? p(s.cpuRunPct) : '—', ...stat('cpu.run', p)],
      [t('res.num.app'), s ? p(s.cpuAppPct ?? 0) : '—', ...stat('cpu.app', p)],
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
    text: [state === 'at' ? t('res.tip.atLimitText') : '', t('res.tip.ram'), t('res.tip.runOnly')].filter(Boolean).join('\n\n'),
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

/** The drive card's gauge: the selected metric, whole PC / run / limit. */
function metricTip(slot: DriveSlot): Tip {
  const key = selOf(slot);
  const plain = !hasLimits(slot);
  const d = loadOf(slot);
  const L = slot.letter || 'x';
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
  const text = [t(`res.tip.${histKey}`), t('res.tip.scale')];
  if (plain) text.push(t('res.tip.driveWork'));
  else if (sample && running() && sample.heldBack > 0.05 && view && bindingDiskLimit(sample, view.limits) === key) {
    return {
      title: t('res.tip.heldTitle', { drive: driveName(slot) }),
      text: t('res.tip.held', { pct: heldPct(), which: t(`res.limitName.${key}`), limit: f(limitOf(key)) }),
      nums: numsGrid(rows),
    };
  }
  return { text: text.join('\n\n'), nums: numsGrid(rows) };
}

function gpuTip(): Tip {
  if (!gpuAvailable()) return { text: `${t('res.gpuNoneTitle')} · ${t('res.gpuNoneHint')}` };
  const g = gpuSample();
  const p = (v: number): string => `${Math.round(v)} %`;
  const mb = (v: number): string => fmt('ramMb', v);
  const lim = limitOf('gpuPct');
  const state = stateOf('gpu');
  const text = [
    state === 'at' ? t('res.tip.atLimitText') : '',
    lim <= 0 ? t('res.gpuOffHint') : '',
    t('res.tip.gpu'),
    t('res.tip.runOnly'),
  ].filter(Boolean);
  const vt = vramTotal();
  return {
    title: state === 'at' ? t('res.tip.atLimit') : undefined,
    text: text.join('\n\n'),
    nums: numsGrid([
      [t('res.num.pc'), g ? p(g.loadPct) : '—', ...stat('gpu.pc', p)],
      [t('res.num.uploader'), g ? p(g.runLoadPct) : '—', ...stat('gpu.run', p)],
      [t('res.num.limit'), lim <= 0 ? t('res.gpuOffShort') : p(lim)],
      [t('res.num.vramUsed'), g ? mb(g.vramUsedMb) : '—', ...stat('gpu.vram', mb)],
      [t('res.num.vramRun'), g ? mb(g.vramRunMb) : '—'],
      [t('res.num.vramTotal'), vt ? mb(vt) : '—'],
    ]),
  };
}

function tempoTip(key: LimitKey): string {
  if (key === 'gpuPct') {
    const lim = limitOf('gpuPct');
    return t('res.tip.tempoGpu', { value: lim <= 0 ? t('res.gpuOffShort') : fmt('gpuPct', lim) });
  }
  const what = key === 'cpuPct' ? t('res.cell.cpu') : key === 'ramMb' ? t('res.cell.ram') : t(LIMIT_LABEL[key as DiskLimitKey]);
  return t(key === 'ramMb' ? 'res.tip.tempoRam' : 'res.tip.tempo', { what, value: fmt(key, limitOf(key)) });
}

function setTip(el: HTMLElement | SVGElement, tip: Tip): void {
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
  const drives = slots();
  const gpu = gpuTip();
  const tips = new Map<string, Tip>([
    ['cpu', cpuTip()],
    ['ram', ramTip()],
    ['gpu', gpu],
    ['g-cpu', cpuTip()],
    ['g-ram', ramTip()],
    ['g-gpu', gpu],
  ]);
  for (const slot of drives) {
    tips.set(slotId(slot), driveTip(slot));
    if (expanded) tips.set(`g-${slotId(slot)}`, metricTip(slot));
  }
  root.querySelectorAll<HTMLElement>('[data-res-tip]').forEach((el) => {
    const tip = tips.get(el.dataset.resTip ?? '');
    if (tip) setTip(el, tip);
  });
  // States: glow on the cell and the card.
  for (const id of ['cpu', 'ram', ...drives.map(slotId), 'gpu']) {
    const st = stateOf(id);
    for (const el of [document.getElementById(`res-cell-${id}`), document.getElementById(`res-box-${id}`)]) {
      el?.classList.toggle('is-at', st === 'at');
      el?.classList.toggle('is-held', st === 'held');
    }
  }
  // A Tempomat names its current limit; its card's live numbers ride along.
  root.querySelectorAll<SVGElement>('svg[data-key]').forEach((el) => {
    const key = el.dataset.key as LimitKey;
    const gid = el.closest<HTMLElement>('.res-garea')?.dataset.resTip ?? '';
    setTip(el, { text: tempoTip(key), nums: tips.get(gid)?.nums });
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
    const parts = [t(`res.kind.${slot.kind}`)];
    if (typeof d?.responseMs === 'number') parts.push(msText(d.responseMs));
    if (typeof d?.activePct === 'number') parts.push(t('res.aside.active', { pct: pctText(d.activePct) }));
    aside(slotId(slot), parts.join(' · '));
  }
  aside('gpu', view.gpu.shortName ?? view.gpu.name ?? '—');
  refreshTooltip();
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

function queue(key: LimitKey, value: number): void {
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

function ceilingFor(key: LimitKey): number {
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
function onTempoKey(key: LimitKey, e: KeyboardEvent): void {
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

function wireDrag(el: Element, key: LimitKey, grab: string, valueAt: (e: PointerEvent, max: number) => number): void {
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

/** Pick a segmented option: the card redraws its gauge, focus stays on the option. */
function selectSeg(group: string, val: string): void {
  if (group === 'gpu') {
    if (!(GPU_METRICS as readonly string[]).includes(val) || gpuSel === val) return;
    gpuSel = val as GpuMetric;
  } else {
    if (!isDiskKey(val as LimitKey) || diskSel.get(group) === val) return;
    diskSel.set(group, val as DiskLimitKey);
  }
  render();
  dock()?.querySelector<HTMLElement>(`.res-seg-btn[data-seg="${group}"][data-val="${val}"]`)?.focus();
}

function onSegKey(btn: HTMLElement, e: KeyboardEvent): void {
  const all = Array.from(btn.parentElement?.querySelectorAll<HTMLElement>('.res-seg-btn') ?? []);
  const i = all.indexOf(btn);
  let j: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % all.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + all.length) % all.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = all.length - 1;
  if (j === null) return;
  // The toggle owns the arrows while focused — not the step chevrons.
  e.preventDefault();
  e.stopPropagation();
  const next = all[j];
  if (next?.dataset.seg && next.dataset.val) selectSeg(next.dataset.seg, next.dataset.val);
}

function wire(): void {
  document.getElementById('res-toggle')?.addEventListener('click', () => toggleResourceDock());
  wirePresets();
  const root = dock();
  root?.querySelectorAll<SVGSVGElement>('svg.res-dial--tempo[data-key]').forEach((svg) => {
    const key = svg.dataset.key as LimitKey;
    wireDrag(svg, key, '.dial-tempo', (e, max) => dialValueAt(svg, e.clientX, e.clientY, max));
  });
  root?.querySelectorAll<HTMLElement>('.res-seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.seg && btn.dataset.val) selectSeg(btn.dataset.seg, btn.dataset.val);
    });
    btn.addEventListener('keydown', (e) => onSegKey(btn, e));
  });
}

// ── state in ────────────────────────────────────────────────────────────────

function noteHistory(s: ResourceSample): void {
  history.push('cpu.pc', s.cpuTotalPct);
  history.push('cpu.run', s.cpuRunPct);
  history.push('cpu.app', s.cpuAppPct ?? 0);
  history.push('ram.used', s.ramUsedMb);
  history.push('ram.run', s.ramRunMb);
  history.push('run.read', s.readMBs);
  history.push('run.write', s.writeMBs);
  history.push('run.iops', s.iops);
  if (s.gpu) {
    history.push('gpu.pc', s.gpu.loadPct);
    history.push('gpu.run', s.gpu.runLoadPct);
    history.push('gpu.vram', s.gpu.vramUsedMb);
  }
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
  // Already on screen with the same layout: repaint in place. A full render
  // would replace the Tempomat that has keyboard focus every time a change is saved.
  if (document.getElementById('res-toggle') && layoutKey() === layoutSig) refresh();
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
  // The cards' metric picks live for one unfold; the next one starts fresh.
  diskSel.clear();
  gpuSel = 'load';
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
