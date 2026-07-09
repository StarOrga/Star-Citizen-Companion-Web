/**
 * Shared progress component — plain TS + CSS (no framework, keeps the
 * renderer bundle tiny; see main.ts header comment for the same rationale).
 *
 * Both long-running flows in this app — the extractor (Run view) and the
 * upload chain (bundle → codex → 3D skins, Upload view) — used to look and
 * behave differently, and both could sit on the same text for 300s+ with no
 * visible motion. This module is the single "sibling" progress surface for
 * both: a phase/stage line, a bar that is either determinate (a subtle
 * shimmer keeps it alive — see `.progress-bar > span` in styles.css) or
 * indeterminate (sliding pulse), an optional step-chip row for multi-stage
 * flows, live sub-count chips, an elapsed clock, and a heartbeat dot that
 * keeps pulsing independent of whether any number actually changed — so a
 * long opaque stretch never reads as "frozen".
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
  /** Full sub-count map, repainted as a horizontal chip strip each call. */
  counters?: Record<string, number>;
  /** Explicit override; otherwise inferred from current/total presence. */
  indeterminate?: boolean;
}

export interface ProgressController {
  /** Reset + (re)start the elapsed clock and heartbeat. */
  start(): void;
  /** Freeze the elapsed clock (final render still happens once). */
  stop(): void;
  /** Push a partial update; omitted fields keep their last painted value. */
  update(u: ProgressUpdate): void;
  /** Mark step `idx` (0-based) active in the step-chip row, earlier ones done. */
  setStep(idx: number): void;
  /** Milliseconds elapsed since the last `start()`. */
  elapsedMs(): number;
}

/**
 * Markup for one progress card. Mount inside any `.card`; the caller owns
 * layout/placement (Run view: left column; Upload view: one per step or a
 * single card driven through the sub-flows in sequence).
 */
export function progressCardHtml(id: string, steps?: ProgressStep[]): string {
  const stepsHtml =
    steps && steps.length
      ? `<div class="sc-progress-steps" id="${id}-steps">${steps
          .map(
            (s, i) =>
              `${i > 0 ? '<span class="sc-progress-step-arrow">→</span>' : ''}` +
              `<span class="sc-progress-step" id="${id}-step-${escapeHtml(s.key)}" data-idx="${i}">${escapeHtml(s.label)}</span>`,
          )
          .join('')}</div>`
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
      <div class="counters" id="${id}-counters"></div>
    </div>
  `;
}

export interface MountProgressOptions {
  counterLabel?: (key: string) => string;
  steps?: ProgressStep[];
}

/** Wire up a card previously rendered via `progressCardHtml(id, ...)`. */
export function mountProgress(id: string, opts: MountProgressOptions = {}): ProgressController {
  const byId = (suffix: string): HTMLElement | null => document.getElementById(`${id}${suffix}`);
  const phaseEl = byId('-phase');
  const barWrap = byId('-bar-wrap');
  const bar = byId('-bar');
  const detailEl = byId('-detail');
  const countersEl = byId('-counters');
  const elapsedEl = byId('-elapsed');
  const labelFn = opts.counterLabel ?? ((k: string) => k);
  const stepEls = (opts.steps ?? []).map((s) => byId(`-step-${s.key}`));

  let startedAt = Date.now();
  let timer: number | null = null;

  const tick = (): void => {
    if (elapsedEl) elapsedEl.textContent = fmtElapsed(Date.now() - startedAt);
  };

  return {
    start(): void {
      startedAt = Date.now();
      tick();
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(tick, 1000);
    },
    stop(): void {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      tick();
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
    },
    update(u: ProgressUpdate): void {
      if (u.phaseLabel !== undefined && phaseEl) phaseEl.textContent = u.phaseLabel;
      if (typeof u.overallPct === 'number' && bar) bar.style.width = `${u.overallPct}%`;

      const hasGoal = typeof u.total === 'number' && u.total > 0 && typeof u.current === 'number';
      let txt = u.stageLabel ?? '';
      if (hasGoal) {
        const pct =
          typeof u.overallPct === 'number' ? u.overallPct : Math.floor(((u.current as number) / (u.total as number)) * 100);
        txt += `${txt ? ' — ' : ''}${(u.current as number).toLocaleString()} / ${(u.total as number).toLocaleString()} (${pct} %)`;
      } else if (typeof u.current === 'number') {
        txt += `${txt ? ' — ' : ''}${u.current.toLocaleString()}`;
      } else if (txt) {
        txt += ' …';
      }
      if (u.detail) txt += `${txt ? '  ·  ' : ''}${u.detail}`;
      if (detailEl) detailEl.textContent = txt;

      const indeterminate = u.indeterminate ?? (!hasGoal && typeof u.current !== 'number');
      barWrap?.classList.toggle('indeterminate', indeterminate);

      if (u.counters && countersEl) {
        countersEl.innerHTML = Object.entries(u.counters)
          .map(
            ([k, v]) =>
              `<div class="counter"><div class="label">${escapeHtml(labelFn(k))}</div><div class="value">${v.toLocaleString()}</div></div>`,
          )
          .join('');
      }
    },
  };
}
