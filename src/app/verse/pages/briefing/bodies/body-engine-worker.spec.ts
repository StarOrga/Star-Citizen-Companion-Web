import { fakeAsync, tick } from '@angular/core/testing';
import { BODY_WORKER_DEADLINE_MS, BodyEngine, bodyMapWidth } from './body-engine';
import type { BodyCommand, BodyEvent } from './body-worker-core';

class FakeWorker {
  readonly sent: BodyCommand[] = [];
  onmessage: ((e: MessageEvent<BodyEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(m: BodyCommand): void { this.sent.push(m); }
  terminate(): void { this.terminated = true; }
  say(e: BodyEvent): void { this.onmessage?.({ data: e } as MessageEvent<BodyEvent>); }
  of<T extends BodyCommand['t']>(t: T): Extract<BodyCommand, { t: T }>[] {
    return this.sent.filter((m) => m.t === t) as Extract<BodyCommand, { t: T }>[];
  }
}

/** Past the wait for the page's next paint. */
const START = 1000;

describe('body engine — worker path', () => {
  let w: FakeWorker, canvas: HTMLCanvasElement;
  const engine = (still = false) => BodyEngine.create({ still, spawn: () => w as unknown as Worker })!;

  beforeEach(() => {
    w = new FakeWorker();
    canvas = document.createElement('canvas');
    canvas.style.width = '120px';
    document.body.appendChild(canvas);
  });
  afterEach(() => canvas.remove());

  it('starts the worker only after the next paint, and hands nothing over before it can draw', fakeAsync(() => {
    const e = engine();
    e.attach(canvas, 'sun');
    expect(w.sent).toEqual([]);
    tick(START);
    expect(w.of('init')[0].base).toBe(document.baseURI);
    w.say({ t: 'alive' });
    expect(w.of('add')).withContext('it has not said it can draw').toEqual([]);
    w.say({ t: 'capable', ok: true });
    const add = w.of('add')[0];
    expect(add.kind).toBe('sun');
    expect(add.cssWidth).toBe(120);
    expect(add.dpr).toBe(devicePixelRatio);
    expect(add.mapWidth).toBe(bodyMapWidth(120 * Math.max(1, screen.availWidth / innerWidth), devicePixelRatio));
    e.dispose();
    expect(w.terminated).toBeTrue();
  }));

  it('a canvas attached later goes over at once; the stage pause reaches the worker', fakeAsync(() => {
    const e = engine();
    tick(START);
    w.say({ t: 'alive' });
    w.say({ t: 'capable', ok: true });
    canvas.style.setProperty('--sc-brief-play', 'paused');
    e.attach(canvas, 'sun');
    expect(w.of('add').length).toBe(1);
    expect(w.of('paused')).withContext('not read while the page renders').toEqual([]);
    tick(600);
    expect(w.of('paused')).toEqual([{ t: 'paused', paused: true }]);
    canvas.style.setProperty('--sc-brief-play', 'running');
    tick(600);
    expect(w.of('paused').pop()).toEqual({ t: 'paused', paused: false });
    e.dispose();
  }));

  it('answers a map request with a bitmap, passes ready on, and takes the art back on a lost context', async () => {
    const e = engine();
    const ready = jasmine.createSpy('ready'), lost = jasmine.createSpy('lost');
    e.attach(canvas, 'sun', ready, lost);
    w.say({ t: 'alive' });
    w.say({ t: 'capable', ok: true });
    w.say({ t: 'ready', id: 1 });
    expect(ready).toHaveBeenCalledTimes(1);
    w.say({ t: 'lost', id: 1 });
    expect(lost).toHaveBeenCalledTimes(1);
    e.dispose();
  });

  it('answers the worker when a baked map failed: the page rasterises, or says it cannot', async () => {
    const real = engine();
    w.say({ t: 'map', name: 'no-such-map', width: 512 });
    for (let i = 0; i < 200 && !w.of('map').length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(w.of('map')).toEqual([{ t: 'map', name: 'no-such-map', bitmap: null }]);
    real.dispose();
  });

  it('a worker dying after the hand-over shows the CSS art instead of a blank canvas', fakeAsync(() => {
    const e = engine();
    const lost = jasmine.createSpy('lost');
    e.attach(canvas, 'sun', undefined, lost);
    tick(START);
    w.say({ t: 'alive' });
    w.say({ t: 'capable', ok: true });
    w.onerror?.({ preventDefault: () => undefined, message: 'crash' } as ErrorEvent);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBeTrue();
    e.dispose();
  }));

  it('a worker that never runs or cannot draw leaves the canvas to the page', fakeAsync(() => {
    const transfer = spyOn(canvas, 'transferControlToOffscreen');
    const e = engine();
    e.attach(canvas, 'sun');
    tick(START + BODY_WORKER_DEADLINE_MS);
    expect(w.terminated).toBeTrue();
    expect(transfer).not.toHaveBeenCalled();
    e.dispose();
    tick(1000);
  }));

  it('without a worker it draws on the page: an engine with WebGL, null without, as ever', () => {
    const webgl = !!document.createElement('canvas').getContext('webgl');
    const e = BodyEngine.create({ spawn: () => null });
    expect(!!e).toBe(webgl);
    e?.dispose();
  });
});

describe('body map width', () => {
  it('stays at or above one texel per device pixel at the disc centre', () => {
    for (const css of [38, 46, 62, 86, 99, 115, 160]) {
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        const w = bodyMapWidth(css, dpr);
        const need = Math.PI * css * Math.min(2, dpr) * 1.06;
        expect(w >= need || w === 1024).withContext(`${css}px @${dpr}`).toBeTrue();
      }
    }
  });

  it('full HD at dpr 1 takes half the raster, high density keeps today\'s', () => {
    expect(bodyMapWidth(115, 1)).toBe(512);
    expect(bodyMapWidth(115, 2)).toBe(1024);
    expect(bodyMapWidth(46, 2)).toBe(512);
    expect(bodyMapWidth(0, 1)).withContext('not laid out yet').toBe(1024);
  });
});
