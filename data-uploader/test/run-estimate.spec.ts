import { describe, expect, it } from 'vitest';
import {
  LIVE_MIN_ELAPSED_MS,
  RunTracker,
  estimateFor,
  estimateRun,
  formatApprox,
  parseHistory,
  relativeTime,
  scaleSeconds,
  type StepHistory,
} from '../src/lib/run-estimate';

const MIN = 60_000;

describe('run-estimate · scaling', () => {
  it('more workers shorten a run, but never proportionally', () => {
    expect(relativeTime(1)).toBe(1);
    expect(relativeTime(2)).toBeCloseTo(0.7);
    // Amdahl: the serial part stays.
    expect(relativeTime(1000)).toBeGreaterThan(0.4);
    expect(scaleSeconds(100, 2, 2)).toBeCloseTo(100);
    expect(scaleSeconds(100, 1, 2)).toBeCloseTo(70);
    expect(scaleSeconds(70, 2, 1)).toBeCloseTo(100);
  });

  it('treats zero or fractional workers as at least one', () => {
    expect(relativeTime(0)).toBe(1);
    expect(relativeTime(0.5)).toBe(1);
  });
});

describe('run-estimate · estimateRun', () => {
  const history: StepHistory = {
    codex: { ms: 20 * MIN, workers: 4 },
    silhouettes: { ms: 10 * MIN, workers: 4 },
    models: { ms: 30 * MIN, workers: 4 },
  };

  it('idle: the whole planned run from the last finished one', () => {
    const est = estimateRun({ now: 0, current: null, upcoming: ['codex', 'silhouettes', 'models'], history, workers: 4 });
    expect(est).toEqual({ seconds: 60 * 60, scope: 'run', basis: 'last', idle: true, workers: 4 });
  });

  it('idle without a full history says nothing', () => {
    expect(estimateRun({ now: 0, current: null, upcoming: ['codex', 'models'], history: { codex: history.codex }, workers: 4 })).toBeNull();
    expect(estimateRun({ now: 0, current: null, upcoming: [], history, workers: 4 })).toBeNull();
  });

  it('early in a step it falls back to the stored step duration, pro rata', () => {
    const est = estimateRun({
      now: 10_000,
      current: { step: 'codex', startedAt: 0, pct: 50, samples: [{ t: 0, current: 0 }, { t: 10_000, current: 50 }] },
      upcoming: ['silhouettes', 'models'],
      history,
      workers: 4,
    });
    // Too young for its own pace (< 30 s): half of 20 min + 10 + 30.
    expect(est?.basis).toBe('last');
    expect(est?.seconds).toBe(50 * 60);
    expect(est?.scope).toBe('run');
  });

  it('no stored duration and too little observed: nothing', () => {
    expect(
      estimateRun({
        now: 10_000,
        current: { step: 'codex', startedAt: 0, pct: 5, samples: [{ t: 0, current: 0 }, { t: 10_000, current: 5 }] },
        upcoming: [],
        history: {},
        workers: 4,
      }),
    ).toBeNull();
  });

  it('once enough is observed the running step goes by its own pace', () => {
    // 10 % per minute → 60 % left = 6 min.
    const now = 4 * MIN;
    const est = estimateRun({
      now,
      current: {
        step: 'codex',
        startedAt: 0,
        pct: 40,
        samples: [0, 1, 2, 3, 4].map((m) => ({ t: m * MIN, current: m * 10 })),
      },
      upcoming: ['silhouettes', 'models'],
      history,
      workers: 4,
    });
    expect(est?.basis).toBe('live');
    expect(est?.scope).toBe('run');
    expect(est?.seconds).toBe(6 * 60 + 40 * 60);
  });

  it('later steps without a stored duration narrow the scope to the running step', () => {
    const est = estimateRun({
      now: 4 * MIN,
      current: { step: 'codex', startedAt: 0, pct: 40, samples: [0, 1, 2, 3, 4].map((m) => ({ t: m * MIN, current: m * 10 })) },
      upcoming: ['silhouettes', 'models'],
      history: {},
      workers: 4,
    });
    expect(est).toMatchObject({ scope: 'step', basis: 'live', seconds: 6 * 60 });
  });

  it('stored durations are projected onto the workers in force now', () => {
    const est = estimateRun({ now: 0, current: null, upcoming: ['codex'], history: { codex: { ms: 70_000, workers: 2 } }, workers: 1 });
    expect(est?.seconds).toBe(100);
  });

  it('respects the live warm-up threshold exactly', () => {
    const cur = { step: 'codex' as const, startedAt: 0, pct: 10, samples: [{ t: 0, current: 0 }, { t: LIVE_MIN_ELAPSED_MS, current: 10 }] };
    expect(estimateRun({ now: LIVE_MIN_ELAPSED_MS - 1, current: cur, upcoming: [], history: {}, workers: 1 })).toBeNull();
    expect(estimateRun({ now: LIVE_MIN_ELAPSED_MS, current: cur, upcoming: [], history: {}, workers: 1 })?.seconds).toBe(270);
  });
});

describe('run-estimate · estimateFor', () => {
  it('rescales one estimate to another preset', () => {
    const est = { seconds: 1000, scope: 'run' as const, basis: 'live' as const, idle: false, workers: 2 };
    expect(estimateFor(est, 2)).toBe(1000);
    expect(estimateFor(est, 1)).toBe(Math.round(1000 / 0.7));
    expect(estimateFor(est, 8)).toBeLessThan(1000);
  });
});

describe('run-estimate · formatApprox', () => {
  it('reads like a rough figure', () => {
    expect(formatApprox(30)).toBe('< 1 min');
    expect(formatApprox(60)).toBe('1 min');
    expect(formatApprox(25 * 60 + 10)).toBe('25 min');
    expect(formatApprox(70 * 60)).toBe('1 h 10 min');
    expect(formatApprox(72 * 60)).toBe('1 h 10 min');
    expect(formatApprox(179 * 60)).toBe('3 h');
  });
});

describe('run-estimate · RunTracker', () => {
  it('records a step that finished, with its average workers', () => {
    const tr = new RunTracker();
    expect(tr.note('codex', 0, 0, 2)).toBeNull();
    tr.note('codex', 50, MIN, 4); // 1 min at 2 workers
    tr.note('codex', 100, 2 * MIN, 4); // 1 min at 4 workers
    const ended = tr.note('silhouettes', 0, 2 * MIN, 4);
    expect(ended).toEqual({ step: 'codex', record: { ms: 2 * MIN, workers: 3 } });
    expect(tr.running()?.step).toBe('silhouettes');
  });

  it('does not record a step that was skipped or cut short', () => {
    const tr = new RunTracker();
    tr.note('silhouettes', 0, 0, 2);
    expect(tr.note('models', 0, 1000, 2)).toBeNull();
    tr.note('models', 60, 5000, 2);
    expect(tr.finish(9000)).toBeNull();
    expect(tr.running()).toBeNull();
  });

  it('ignores a transient 0 from a remounted card', () => {
    const tr = new RunTracker();
    tr.note('codex', 40, 0, 2);
    tr.note('codex', 0, 1000, 2);
    expect(tr.running()?.pct).toBe(40);
  });
});

describe('run-estimate · parseHistory', () => {
  it('keeps valid records and drops the rest', () => {
    expect(
      parseHistory({ codex: { ms: 1000, workers: 2 }, silhouettes: { ms: -1, workers: 2 }, models: { ms: 5, workers: 0 }, other: { ms: 1, workers: 1 } }),
    ).toEqual({ codex: { ms: 1000, workers: 2 } });
    expect(parseHistory(null)).toEqual({});
    expect(parseHistory('x')).toEqual({});
  });
});
