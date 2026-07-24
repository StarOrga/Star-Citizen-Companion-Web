/**
 * Shared progress component — plain TS + CSS (no framework, keeps the
 * renderer bundle tiny; see main.ts header comment for the same rationale).
 *
 * Both long-running flows in this app — the extractor (Run view) and the
 * upload chain (bundle → codex → 3D skins, Upload view) — use this single
 * "sibling" surface so they look and behave the same. It answers the two
 * questions a waiting user actually has — "is it stuck?" and "how much
 * longer?" — with:
 *
 *  - a phase/stage head + a step-chip journey (which of the known stages)
 *  - a bar that is determinate (a subtle shimmer keeps it alive even while
 *    the width holds for minutes) or indeterminate (sliding pulse)
 *  - a detail line with concrete current / total
 *  - a **meta line** that shows live throughput + ETA when the goal is known
 *    ("~318/s · Rest 0:54"), and otherwise a stall timer that names how long
 *    the current step has been running ("arbeitet noch · 42s") plus an
 *    optional contextual hint for known-slow opaque steps
 *  - live sub-count chips that flash when they tick
 *  - a heartbeat dot + elapsed clock that keep moving no matter what, so a
 *    300s opaque stretch never reads as "frozen"
 *
 * `prefers-reduced-motion: reduce` is handled globally in styles.css (kills
 * all animation/transition durations), so nothing extra is needed here.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Compact "time on this step": bare seconds under a minute, m:ss beyond. */
function fmtSince(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : fmtElapsed(ms);
}

// After this long with no observable change, the step is treated as "slow":
// the meta line surfaces a running "…still working (Xs)" timer so the user
// knows the app is alive, not hung.
const STALL_MS = 3500;
// Rolling window over which throughput is averaged (smooths out bursty events).
const RATE_WINDOW_MS = 6000;

export interface ProgressStep {
  key: string;
  label: string;
}

export interface ProgressUpdate {
  /** Big head label — which flow/phase is active right now. */
  phaseLabel?: string;
  /** Short sub-stage label prefixed onto the detail line (e.g. "Ships"). */
  stageLabel?: string;
  /** Overall 0–100 bar position. Omit to leave the bar where it was. */
  overallPct?: number;
  current?: number;
  total?: number;
  /** Free-text hint appended to the detail line (e.g. a filename). */
  detail?: string;
  /**
   * Contextual reassurance for a known-slow / opaque step (e.g. "opening the
   * ~157 GB archive"), shown on the meta line while indeterminate or stalled.
   * Pass '' to clear it. Auto-cleared on a phase change.
   */
  hint?: string;
  /** Full sub-count map, repainted as a horizontal chip strip when it changes. */
  counters?: Record<string, number>;
  /** Explicit override; otherwise inferred from current/total presence. */
  indeterminate?: boolean;
}

export interface ProgressController {
  /** Reset + (re)start the elapsed clock, stall timer and heartbeat. */
  start(): void;
  /** Freeze the clocks (final render still happens once). */
  stop(): void;
  /** Push a partial update; omitted fields keep their last painted value. */
  update(u: ProgressUpdate): void;
  /** Mark step `idx` (0-based) active in the step-chip row, earlier ones done. */
  setStep(idx: number): void;
  /** Milliseconds elapsed since the last `start()`. */
  elapsedMs(): number;
}

/** Localized labels for the meta line (defaults are English). */
export interface ProgressLabels {
  still: string;
  eta: string;
  perSec: string;
}

/**
 * Markup for one progress card. Mount inside any `.card`; the caller owns
 * layout/placement. Pass `steps` to render the journey chip row (used by both
 * flows now — the extract phases and the upload sub-steps).
 */
export function progressCardHtml(id: string, steps?: ProgressStep[]): string {
  const stepsHtml =
    steps && steps.length
      ? `<div class="sc-progress-steps" id="${id}-steps">` +
        `<span class="sc-progress-stepcount" id="${id}-stepcount"></span>` +
        steps
          .map(
            (s, i) =>
              `${i > 0 ? '<span class="sc-progress-step-arrow">›</span>' : ''}` +
              `<span class="sc-progress-step" id="${id}-step-${escapeHtml(s.key)}" data-idx="${i}">${escapeHtml(s.label)}</span>`,
          )
          .join('') +
        `</div>`
      : '';
  return `
    <div class="sc-progress" id="${id}">
      <div class="sc-progress-head">
        <span class="sc-progress-phase" id="${id}-phase">…</span>
        <span class="sc-progress-heartbeat" id="${id}-heartbeat" title="still working">
          <span class="sc-progress-dot"></span>
          <span class="run-elapsed" id="${id}-elapsed">0:00</span>
        </span>
      </div>
      ${stepsHtml}
      <div class="progress-bar" id="${id}-bar-wrap"><span id="${id}-bar" style="width:0%"></span></div>
      <div class="progress-detail" id="${id}-detail"></div>
      <div class="sc-progress-meta" id="${id}-meta"></div>
      <div class="counters" id="${id}-counters"></div>
    </div>
  `;
}

export interface MountProgressOptions {
  counterLabel?: (key: string) => string;
  steps?: ProgressStep[];
  labels?: Partial<ProgressLabels>;
  /**
   * Formats the always-visible macro position ("Schritt 2/3") shown ahead of the
   * step chips. Given the 1-based active step and the total, returns the label.
   * Omit for a bare "2/3". Only rendered when `steps` are present.
   */
  stepLabel?: (step: number, total: number) => string;
}

/** Wire up a card previously rendered via `progressCardHtml(id, ...)`. */
export function mountProgress(id: string, opts: MountProgressOptions = {}): ProgressController {
  const byId = (suffix: string): HTMLElement | null => document.getElementById(`${id}${suffix}`);
  const phaseEl = byId('-phase');
  const barWrap = byId('-bar-wrap');
  const bar = byId('-bar');
  const detailEl = byId('-detail');
  const metaEl = byId('-meta');
  const countersEl = byId('-counters');
  const elapsedEl = byId('-elapsed');
  const stepCountEl = byId('-stepcount');
  const labelFn = opts.counterLabel ?? ((k: string) => k);
  const steps = opts.steps ?? [];
  const stepEls = steps.map((s) => byId(`-step-${s.key}`));
  const labels: ProgressLabels = {
    still: opts.labels?.still ?? 'still working',
    eta: opts.labels?.eta ?? 'ETA',
    perSec: opts.labels?.perSec ?? '/s',
  };

  // Merged view-model — partial updates fold into this, so a counters-only
  // event no longer blanks the detail line and vice-versa.
  const vm: {
    phaseLabel: string;
    stageLabel: string;
    overallPct: number | undefined;
    current: number | undefined;
    total: number | undefined;
    detail: string;
    hint: string;
    indeterminate: boolean;
    counters: Record<string, number>;
  } = {
    phaseLabel: '',
    stageLabel: '',
    overallPct: undefined,
    current: undefined,
    total: undefined,
    detail: '',
    hint: '',
    indeterminate: false,
    counters: {},
  };

  let startedAt = Date.now();
  let lastChangeAt = Date.now();
  let prevSig = '';
  let prevCountersSig = '';
  let prevCounters: Record<string, number> = {};
  const samples: { t: number; current: number }[] = [];
  let timer: number | null = null;

  // Throughput over the rolling window → items/sec + ETA to the current goal.
  const rateInfo = (): { rate: number; etaSec: number | null } | null => {
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    const dc = last.current - first.current;
    if (dt < 1 || dc <= 0) return null;
    const rate = dc / dt;
    let etaSec: number | null = null;
    if (
      typeof vm.total === 'number' &&
      vm.total > 0 &&
      typeof vm.current === 'number' &&
      vm.current < vm.total &&
      rate > 0
    ) {
      etaSec = Math.round((vm.total - vm.current) / rate);
    }
    return { rate, etaSec };
  };

  const renderHeadAndDetail = (): void => {
    if (phaseEl) phaseEl.textContent = vm.phaseLabel || '…';
    if (typeof vm.overallPct === 'number' && bar) bar.style.width = `${vm.overallPct}%`;

    const hasGoal = typeof vm.total === 'number' && vm.total > 0 && typeof vm.current === 'number';
    let txt = vm.stageLabel ?? '';
    if (hasGoal) {
      const pct =
        typeof vm.overallPct === 'number'
          ? vm.overallPct
          : Math.floor(((vm.current as number) / (vm.total as number)) * 100);
      txt += `${txt ? ' — ' : ''}${(vm.current as number).toLocaleString()} / ${(vm.total as number).toLocaleString()} (${pct} %)`;
    } else if (typeof vm.current === 'number') {
      txt += `${txt ? ' — ' : ''}${vm.current.toLocaleString()}`;
    } else if (txt) {
      txt += ' …';
    }
    if (vm.detail) txt += `${txt ? '  ·  ' : ''}${vm.detail}`;
    if (detailEl) detailEl.textContent = txt;

    barWrap?.classList.toggle('indeterminate', vm.indeterminate);
  };

  // Rebuild the chip strip only when the counts actually changed — otherwise a
  // high-frequency progress stream would reset the strip's horizontal scroll
  // and restart the flash animation on every unrelated event.
  const renderCounters = (): void => {
    if (!countersEl) return;
    const sig = Object.entries(vm.counters)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    if (sig === prevCountersSig) return;
    countersEl.innerHTML = Object.entries(vm.counters)
      .map(([k, v]) => {
        const bumped = prevCounters[k] !== undefined && prevCounters[k] !== v ? ' bumped' : '';
        return `<div class="counter${bumped}"><div class="label">${escapeHtml(labelFn(k))}</div><div class="value">${v.toLocaleString()}</div></div>`;
      })
      .join('');
    prevCounters = { ...vm.counters };
    prevCountersSig = sig;
  };

  // The one part that must paint on its own clock (independent of events), so a
  // long opaque step still visibly counts up instead of freezing.
  const renderMeta = (): void => {
    if (elapsedEl) elapsedEl.textContent = fmtElapsed(Date.now() - startedAt);
    if (!metaEl) return;
    const since = Date.now() - lastChangeAt;
    const stalled = since > STALL_MS;
    const ri = vm.indeterminate ? null : rateInfo();

    let txt = '';
    if (vm.hint && (vm.indeterminate || stalled)) {
      txt = vm.hint + (stalled ? ` · ${fmtSince(since)}` : '');
    } else if (ri) {
      const r = ri.rate >= 10 ? String(Math.round(ri.rate)) : ri.rate.toFixed(1);
      txt = `~${r}${labels.perSec}`;
      if (ri.etaSec != null) txt += ` · ${labels.eta} ${fmtElapsed(ri.etaSec * 1000)}`;
    } else if (stalled) {
      txt = `${labels.still} · ${fmtSince(since)}`;
    }
    metaEl.textContent = txt;
    // Warn-tint only for a stall with no throughput to show — a gentle "this is
    // taking a while", never for healthy determinate work with an ETA.
    metaEl.classList.toggle('anxious', stalled && !ri);
  };

  return {
    start(): void {
      startedAt = Date.now();
      lastChangeAt = Date.now();
      samples.length = 0;
      prevSig = '';
      renderMeta();
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(renderMeta, 500);
    },
    stop(): void {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      renderMeta();
    },
    elapsedMs(): number {
      return Date.now() - startedAt;
    },
    setStep(idx: number): void {
      stepEls.forEach((el, i) => {
        if (!el) return;
        el.classList.toggle('active', i === idx);
        el.classList.toggle('done', i < idx);
      });
      // The macro "2/3" — always answers "which of the N stages am I on" at a
      // glance, even during an otherwise opaque stage (e.g. the bundle POST).
      // Cleared when idx points past the last step (a "done" sweep), so a
      // finished run doesn't read as "6/5".
      if (stepCountEl) {
        const total = steps.length;
        stepCountEl.textContent =
          total > 0 && idx >= 0 && idx < total
            ? (opts.stepLabel?.(idx + 1, total) ?? `${idx + 1}/${total}`)
            : '';
      }
    },
    update(u: ProgressUpdate): void {
      // A phase change invalidates the previous stage's numbers/hint/throughput
      // so they don't bleed (stale "134/210") into the new phase.
      if (u.phaseLabel !== undefined && u.phaseLabel !== vm.phaseLabel) {
        vm.stageLabel = '';
        vm.current = undefined;
        vm.total = undefined;
        vm.detail = '';
        vm.hint = '';
        samples.length = 0;
      }
      if (u.phaseLabel !== undefined) vm.phaseLabel = u.phaseLabel;
      if (u.stageLabel !== undefined) vm.stageLabel = u.stageLabel;
      if (u.overallPct !== undefined) vm.overallPct = u.overallPct;
      if (u.current !== undefined) vm.current = u.current;
      if (u.total !== undefined) vm.total = u.total;
      if (u.detail !== undefined) vm.detail = u.detail;
      if (u.hint !== undefined) vm.hint = u.hint;
      if (u.counters !== undefined) vm.counters = u.counters;

      const hasGoal = typeof vm.total === 'number' && vm.total > 0 && typeof vm.current === 'number';
      vm.indeterminate = u.indeterminate ?? (!hasGoal && typeof vm.current !== 'number');

      if (hasGoal) samples.push({ t: Date.now(), current: vm.current as number });
      while (samples.length > 2 && Date.now() - samples[0].t > RATE_WINDOW_MS) samples.shift();

      // Reset the stall timer only on a *real* change (new stage, more items,
      // new detail, ticked counter) — not on a no-op repaint.
      const countersSum = Object.values(vm.counters).reduce((a, b) => a + b, 0);
      const sig = `${vm.phaseLabel}|${vm.stageLabel}|${vm.current}|${vm.detail}|${countersSum}`;
      if (sig !== prevSig) {
        lastChangeAt = Date.now();
        prevSig = sig;
      }

      renderHeadAndDetail();
      renderCounters();
      renderMeta();
    },
  };
}
