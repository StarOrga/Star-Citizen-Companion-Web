import { describe, it, expect, vi } from 'vitest';
import { ProgressHub, trayLines, trayTooltip, emptyHub } from '../src/lib/progress-hub.js';

describe('trayLines', () => {
  it('shows an idle label when nothing has run', () => {
    expect(trayLines(emptyHub())).toEqual(['Idle']);
  });

  it('shows phase + percent for an active track', () => {
    const hub = new ProgressHub();
    hub.start('extract');
    hub.update('extract', 'datacore', 42);
    expect(trayLines(hub.get())).toEqual(['Extraction: datacore 42%']);
  });

  it('shows both tracks at once', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'datacore', 100);
    hub.update('upload', 'codex_ships', 10);
    expect(trayLines(hub.get())).toEqual(['Extraction: datacore 100%', 'Upload: codex_ships 10%']);
  });

  it('renders an indeterminate track without a bogus percentage', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'opening', null);
    expect(trayLines(hub.get())).toEqual(['Extraction: opening']);
  });

  it('renders a phase-less active track', () => {
    const hub = new ProgressHub();
    hub.start('upload');
    expect(trayLines(hub.get())).toEqual(['Upload: …']);
  });

  it('keeps the outcome visible after a track finishes', () => {
    const hub = new ProgressHub();
    hub.start('extract');
    hub.finish('extract', 'done');
    expect(trayLines(hub.get())).toEqual(['Extraction: done']);
  });

  it('shows a failure outcome', () => {
    const hub = new ProgressHub();
    hub.start('upload');
    hub.finish('upload', 'error');
    expect(trayLines(hub.get())).toEqual(['Upload: failed']);
  });

  it('adds a paused line only while the upload is actually running', () => {
    const hub = new ProgressHub();
    hub.update('upload', 'codex_ships', 10);
    hub.setPaused(true);
    expect(trayLines(hub.get())).toContain('Upload: paused');

    hub.finish('upload', 'done');
    expect(trayLines(hub.get())).not.toContain('Upload: paused');
  });

  it('clamps and rounds nonsense percentages instead of rendering NaN', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'x', 150);
    expect(trayLines(hub.get())).toEqual(['Extraction: x 100%']);
    hub.update('extract', 'x', -5);
    expect(trayLines(hub.get())).toEqual(['Extraction: x 0%']);
    hub.update('extract', 'x', Number.NaN);
    expect(trayLines(hub.get())).toEqual(['Extraction: x']);
    hub.update('extract', 'x', 41.6);
    expect(trayLines(hub.get())).toEqual(['Extraction: x 42%']);
  });

  it('honours localized labels', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'datacore', 5);
    expect(trayLines(hub.get(), { extract: 'Extraktion' })).toEqual(['Extraktion: datacore 5%']);
  });
});

describe('trayTooltip', () => {
  it('joins the lines onto one line with the app name', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'datacore', 42);
    expect(trayTooltip(hub.get(), 'SC Data Uploader')).toBe('SC Data Uploader — Extraction: datacore 42%');
  });
});

describe('ProgressHub', () => {
  it('notifies subscribers on every change', () => {
    const hub = new ProgressHub();
    const cb = vi.fn();
    hub.onChange(cb);
    hub.start('extract');
    hub.update('extract', 'a', 1);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const hub = new ProgressHub();
    const cb = vi.fn();
    hub.onChange(cb)();
    hub.start('extract');
    expect(cb).not.toHaveBeenCalled();
  });

  it('survives a listener that throws — a tray repaint must not break the run', () => {
    const hub = new ProgressHub();
    const good = vi.fn();
    hub.onChange(() => {
      throw new Error('tray exploded');
    });
    hub.onChange(good);
    expect(() => hub.update('extract', 'a', 1)).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('clears a previous outcome when the track restarts', () => {
    const hub = new ProgressHub();
    hub.start('extract');
    hub.finish('extract', 'error');
    hub.start('extract');
    expect(hub.get().extract.outcome).toBeNull();
    expect(hub.get().extract.active).toBe(true);
  });

  it('tracks the two pipelines independently', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'a', 1);
    hub.finish('upload', 'done');
    expect(hub.get().extract.active).toBe(true);
    expect(hub.get().upload.active).toBe(false);
  });

  it('resets to empty', () => {
    const hub = new ProgressHub();
    hub.update('extract', 'a', 1);
    hub.setPaused(true);
    hub.reset();
    expect(hub.get()).toEqual(emptyHub());
  });
});
