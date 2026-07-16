/**
 * Main-process mirror of pipeline progress, for the tray menu.
 *
 * Progress events are produced in main but were only ever *forwarded* to the
 * renderer, so main itself never knew how far a run had got. The tray lives in
 * main and must show extraction + upload progress at a glance ("den Fortschritt
 * im Tray-Menü synchronisieren") — including while the window is hidden, when
 * there may be no renderer listening at all. So main keeps its own copy here.
 *
 * Pure state + label formatting (no Electron), so the tray's text is testable.
 */

export type TrackKind = 'extract' | 'upload';

export interface TrackState {
  active: boolean;
  /** Human/i18n-resolved label of the current phase, e.g. 'datacore'. */
  phase: string | null;
  /** 0..100, or null when the work is indeterminate. */
  pct: number | null;
  /** Set when the track finished or failed — shown until the next run starts. */
  outcome: 'done' | 'error' | null;
}

export interface HubState {
  extract: TrackState;
  upload: TrackState;
  /** True while the upload is paused (drives the tray's Pause/Resume entry). */
  paused: boolean;
}

const idle = (): TrackState => ({ active: false, phase: null, pct: null, outcome: null });

export function emptyHub(): HubState {
  return { extract: idle(), upload: idle(), paused: false };
}

export interface TrayLabels {
  idle: string;
  extract: string;
  upload: string;
  done: string;
  error: string;
  paused: string;
}

const DEFAULT_LABELS: TrayLabels = {
  idle: 'Idle',
  extract: 'Extraction',
  upload: 'Upload',
  done: 'done',
  error: 'failed',
  paused: 'paused',
};

/** Clamp to a sane 0..100 integer — a bad event must not render "NaN%". */
function pctText(pct: number | null): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

/**
 * One line per track, e.g. `Extraction: datacore 42%`. Returns the idle label
 * when nothing has run yet, so the menu never shows an empty section.
 */
export function trayLines(state: HubState, labels: Partial<TrayLabels> = {}): string[] {
  const l = { ...DEFAULT_LABELS, ...labels };
  const line = (name: string, t: TrackState): string | null => {
    if (t.active) {
      const parts = [t.phase, pctText(t.pct)].filter(Boolean);
      return parts.length ? `${name}: ${parts.join(' ')}` : `${name}: …`;
    }
    if (t.outcome === 'done') return `${name}: ${l.done}`;
    if (t.outcome === 'error') return `${name}: ${l.error}`;
    return null;
  };

  const lines = [line(l.extract, state.extract), line(l.upload, state.upload)].filter(
    (x): x is string => x !== null,
  );
  if (state.paused && state.upload.active) lines.push(`${l.upload}: ${l.paused}`);
  return lines.length ? lines : [l.idle];
}

/** Short tooltip for the tray icon itself (single line). */
export function trayTooltip(state: HubState, appName: string, labels: Partial<TrayLabels> = {}): string {
  const lines = trayLines(state, labels);
  return `${appName} — ${lines.join(' · ')}`;
}

/** Mutable hub with change notification — the tray subscribes to repaint. */
export class ProgressHub {
  private state: HubState = emptyHub();
  private readonly listeners = new Set<(s: HubState) => void>();

  get(): HubState {
    return this.state;
  }

  /** Mark a track as started, clearing any previous outcome. */
  start(kind: TrackKind): void {
    this.set(kind, { active: true, phase: null, pct: null, outcome: null });
  }

  update(kind: TrackKind, phase: string | null, pct: number | null): void {
    this.set(kind, { ...this.state[kind], active: true, phase, pct });
  }

  finish(kind: TrackKind, outcome: 'done' | 'error'): void {
    this.set(kind, { ...this.state[kind], active: false, outcome });
  }

  setPaused(paused: boolean): void {
    this.state = { ...this.state, paused };
    this.emit();
  }

  reset(): void {
    this.state = emptyHub();
    this.emit();
  }

  onChange(cb: (s: HubState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(kind: TrackKind, track: TrackState): void {
    this.state = { ...this.state, [kind]: track };
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.state);
      } catch {
        /* a failing tray repaint must never break the pipeline */
      }
    }
  }
}
