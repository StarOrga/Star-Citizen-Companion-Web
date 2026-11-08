import { fakeAsync, tick } from '@angular/core/testing';
import { PLANET_WORKER_DEADLINE_MS, PlanetWorkerLink } from './planet-worker-link';
import { PlanetStatus, PlanetView } from './planet-scene';
import type { PlanetCommand, PlanetEvent } from './planet-worker-core';

class FakeWorker {
  readonly sent: PlanetCommand[] = [];
  readonly transfers: Transferable[][] = [];
  onmessage: ((e: MessageEvent<PlanetEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  postMessage(m: PlanetCommand, t: Transferable[] = []): void {
    this.sent.push(m);
    this.transfers.push(t);
  }
  terminate(): void {
    this.terminated = true;
  }
  say(e: PlanetEvent): void {
    this.onmessage?.({ data: e } as MessageEvent<PlanetEvent>);
  }
}

describe('Verse planet — worker link', () => {
  const link = (w: FakeWorker) => new PlanetWorkerLink(w as unknown as Worker, 4096, 'https://app.test/');

  it('starts the download at once and probes WebGL only after the next paint', fakeAsync(() => {
    const w = new FakeWorker();
    link(w);
    expect(w.sent.map((m) => m.t)).toEqual(['load']);
    tick(7000);
    expect(w.sent.map((m) => m.t)).toEqual(['load', 'probe']);
  }));

  it('a worker whose script never runs leaves the planet to the page', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    const got: boolean[] = [];
    void l.capable.then((v) => got.push(v));
    void l.settled.then((v) => got.push(v));
    tick(PLANET_WORKER_DEADLINE_MS);
    expect(got).toEqual([false, false]);
    expect(w.terminated).toBe(true);
    expect(l.alive).toBe(false);
  }));

  it('a slow first WebGL context is not a dead worker', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    w.say({ t: 'alive' });
    tick(PLANET_WORKER_DEADLINE_MS * 3);
    expect(w.terminated).toBe(false);
    expect(l.alive).toBe(true);
  }));

  it('a script error (dead chunk answering HTML, CSP) leaves the planet to the page', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    const got: boolean[] = [];
    void l.capable.then((v) => got.push(v));
    w.onerror?.({ preventDefault: () => undefined, message: 'x' } as ErrorEvent);
    tick(1000);
    expect(got).toEqual([false]);
    expect(w.terminated).toBe(true);
  }));

  it('a worker that cannot draw is told to go before anything is handed over', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    const got: boolean[] = [];
    void l.settled.then((v) => got.push(v));
    w.say({ t: 'alive' });
    w.say({ t: 'capable', ok: false });
    tick(1000);
    expect(got).toEqual([false]);
    expect(l.canvases).toBeNull();
    expect(w.terminated).toBe(true);
  }));

  it('hands both canvases over as transferables and keeps them for the next visit', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    tick(1000);
    w.say({ t: 'alive' });
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    l.attach(a, b, [0.1, 0.2, 0.3], true);
    const m = w.sent.find((x) => x.t === 'attach') as Extract<PlanetCommand, { t: 'attach' }>;
    expect(m.reduce).toBe(true);
    expect(w.transfers[w.sent.indexOf(m)]).toEqual([m.gl, m.trains]);
    expect(l.canvases).toEqual([a, b]);
  }));

  it('forwards size, device pixel ratio and the anchor geometry of every frame', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    tick(1000);
    w.say({ t: 'alive' });
    const view: PlanetView = { cx: 1, cy: 2, r: 3, w: 4, h: 5 };
    l.resize(800, 600, 1.5);
    l.tick(view, 10);
    l.draw(view, 11);
    l.resume(12);
    l.suspend();
    l.wake(13);
    expect(w.sent.slice(-6)).toEqual([
      { t: 'resize', w: 800, h: 600, dpr: 1.5 },
      { t: 'tick', view, now: 10 },
      { t: 'draw', view, now: 11 },
      { t: 'resume', now: 12 },
      { t: 'suspend' },
      { t: 'wake', now: 13 },
    ]);
  }));

  it('reports a worker that dies after the planet stood, so the stage never stays blank', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w), seen: PlanetStatus[] = [];
    l.onStatus = (s) => seen.push(s);
    w.say({ t: 'alive' });
    w.say({ t: 'capable', ok: true });
    w.say({ t: 'ready' });
    tick();
    expect(l.isReady).toBe(true);
    w.onerror?.({ preventDefault: () => undefined, message: 'crash' } as ErrorEvent);
    expect(seen).toEqual(['unavailable']);
    expect(l.alive).toBe(false);
    tick(1000);
  }));

  it('remembers a context lost while parked, and forgets it when it came back', fakeAsync(() => {
    const w = new FakeWorker(), l = link(w);
    w.say({ t: 'alive' });
    w.say({ t: 'status', status: 'unavailable' });
    expect(l.alive).toBe(false);
    w.say({ t: 'status', status: 'restored' });
    expect(l.alive).toBe(true);
    tick(1000);
  }));
});
