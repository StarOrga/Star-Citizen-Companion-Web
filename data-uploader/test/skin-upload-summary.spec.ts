import { describe, it, expect } from 'vitest';
import {
  tallySkinUpload,
  skinUploadFrame,
  skinUploadStatus,
  type SkinUploadTallyInput,
} from '../src/lib/skin-upload-summary.js';
import { load as loadI18n, t } from '../src/lib/i18n.js';

const fresh = (n: number): SkinUploadTallyInput[] => Array.from({ length: n }, () => ({ ok: true }));
const cached = (n: number): SkinUploadTallyInput[] =>
  Array.from({ length: n }, () => ({ ok: true, cached: true }));
const empty = (n: number): SkinUploadTallyInput[] =>
  Array.from({ length: n }, () => ({ ok: true, empty: true }));
const failed = (n: number): SkinUploadTallyInput[] => Array.from({ length: n }, () => ({ ok: false }));

/** Echoes key + params so the composition is asserted independent of a dictionary. */
const echo = (key: string, params: Record<string, string | number> = {}): string =>
  `${key}${Object.keys(params).length ? JSON.stringify(params) : ''}`;

describe('tallySkinUpload', () => {
  it('buckets every ship exactly once', () => {
    const tally = tallySkinUpload([...fresh(3), ...cached(2), ...empty(4), ...failed(1)]);
    expect(tally).toEqual({
      total: 10,
      attempted: 6,
      live: 5,
      fresh: 3,
      cached: 2,
      empty: 4,
      failed: 1,
      pct: 83,
    });
  });

  it('a failed ship is never counted as cached or empty, whatever else it carries', () => {
    const tally = tallySkinUpload([{ ok: false, cached: true, empty: true }]);
    expect(tally.failed).toBe(1);
    expect(tally.empty).toBe(0);
    expect(tally.cached).toBe(0);
    expect(tally.attempted).toBe(1);
  });

  it('an empty run is 100 % of nothing, not NaN', () => {
    expect(tallySkinUpload([]).pct).toBe(100);
    expect(tallySkinUpload(empty(5)).pct).toBe(100);
  });

  it('the fraction and the percentage always describe the same numbers', () => {
    for (const results of [
      [...fresh(251), ...empty(25)],
      [...fresh(251), ...failed(25)],
      [...fresh(200), ...cached(51), ...empty(20), ...failed(5)],
      [...failed(3)],
    ]) {
      const tally = tallySkinUpload(results);
      expect(tally.pct).toBe(Math.floor((tally.live / tally.attempted) * 100));
      expect(tally.live + tally.failed).toBe(tally.attempted);
      expect(tally.attempted + tally.empty).toBe(tally.total);
    }
  });
});

describe('the 251 / 276 run (admin feedback 59853b44)', () => {
  it('25 ships without a livery model: 251 / 251 (100 %), and the 25 are named as skipped', () => {
    const tally = tallySkinUpload([...fresh(240), ...cached(11), ...empty(25)]);
    const frame = skinUploadFrame(tally, echo);
    expect(frame.current).toBe(251);
    expect(frame.total).toBe(251);
    expect(frame.overallPct).toBe(100);
    expect(frame.phaseLabel).toBe('skins.stepUploadDone');
    expect(frame.detail).toBe('skins.skippedNoModel{"n":25}');
  });

  it('25 ships failed: 251 / 276 (90 %), the head says so, and the status line is a warning', () => {
    const tally = tallySkinUpload([...fresh(251), ...failed(25)]);
    const frame = skinUploadFrame(tally, echo);
    expect(frame.current).toBe(251);
    expect(frame.total).toBe(276);
    expect(frame.overallPct).toBe(90);
    expect(frame.phaseLabel).toBe('skins.stepUploadDonePartial{"n":25}');
    expect(frame.detail).toBe('skins.failedCount{"n":25}');
    const status = skinUploadStatus(tally, echo);
    expect(status.level).toBe('warn');
    expect(status.message).toBe('skins.partialStatus{"live":251,"attempted":276,"failed":25}');
  });

  it('never again "251 / 276 (100 %)": a full bar implies nothing was lost', () => {
    const tally = tallySkinUpload([...fresh(251), ...empty(20), ...failed(5)]);
    const frame = skinUploadFrame(tally, echo);
    expect(frame.overallPct).toBe(98);
    expect(frame.current).toBe(251);
    expect(frame.total).toBe(256);
    expect(frame.detail).toBe('skins.skippedNoModel{"n":20} · skins.failedCount{"n":5}');
  });
});

describe('skinUploadStatus', () => {
  it('a clean run keeps the plain "done" line', () => {
    const status = skinUploadStatus(tallySkinUpload([...fresh(4), ...cached(1)]), echo);
    expect(status).toEqual({ level: 'ok', message: 'skins.done{"n":5}' });
  });

  it('skipped ships are appended even on an otherwise clean run', () => {
    const status = skinUploadStatus(tallySkinUpload([...fresh(4), ...empty(2)]), echo);
    expect(status).toEqual({ level: 'ok', message: 'skins.done{"n":4} · skins.noModels{"n":2}' });
  });
});

describe('with the shipped dictionaries', () => {
  it('renders the German card frame and status for a run with skips and failures', async () => {
    await loadI18n('de');
    const tally = tallySkinUpload([...fresh(251), ...empty(20), ...failed(5)]);
    const frame = skinUploadFrame(tally, t);
    expect(frame.phaseLabel).toBe('Liveries hochgeladen — 5 fehlgeschlagen');
    expect(frame.detail).toBe('20 übersprungen (kein Livery-Modell) · 5 fehlgeschlagen');
    expect(skinUploadStatus(tally, t).message).toBe(
      '251 / 256 Schiffe hochgeladen — 5 fehlgeschlagen (siehe Protokoll) · 20 Schiff(e) ohne baubare Livery',
    );
  });

  it('renders the English equivalent', async () => {
    await loadI18n('en');
    const tally = tallySkinUpload([...fresh(251), ...empty(25)]);
    const frame = skinUploadFrame(tally, t);
    expect(frame.phaseLabel).toBe('Liveries uploaded');
    expect(frame.detail).toBe('25 skipped (no livery model)');
    expect(skinUploadStatus(tally, t)).toEqual({
      level: 'ok',
      message: '3D skins done — 251 ship(s) live. · 25 ship(s) without a buildable livery',
    });
  });
});
