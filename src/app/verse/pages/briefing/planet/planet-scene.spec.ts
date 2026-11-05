import { fakeAsync, tick } from '@angular/core/testing';
import { CONTEXT_LOST_GRACE_MS, PlanetDrawer, PlanetScene, PlanetStatus, PlanetView } from './planet-scene';
import { project, sph } from './planet-world';

function drawer(): PlanetDrawer & { draw: jasmine.Spy; clear: jasmine.Spy } {
  return { draw: jasmine.createSpy('draw'), clear: jasmine.createSpy('clear'), dispose: jasmine.createSpy('dispose') } as never;
}

describe('Verse planet — scene', () => {
  const view: PlanetView = { cx: 200, cy: 200, r: 100, w: 400, h: 400 };
  let gl: HTMLCanvasElement, trains: HTMLCanvasElement, status: PlanetStatus[], first: ReturnType<typeof drawer>;

  /** A point on the planet's lit-by-city side, facing the viewer, at the frozen clock. */
  function nightFront(): readonly [number, number, number] {
    for (let lat = -1.2; lat < 1.2; lat += 0.1) {
      for (let lon = -3.1; lon < 3.1; lon += 0.1) {
        const v = sph(lat, lon), p = project(v, 0, view.cx, view.cy, view.r);
        if (p.ndl < -0.2 && p.z > 0.5) return v;
      }
    }
    throw new Error('no night side found');
  }

  function scene(reduce = false, rebuild: () => Promise<PlanetDrawer> = () => Promise.resolve(drawer())): PlanetScene {
    return new PlanetScene({
      glCanvas: gl, trainCanvas: trains, reduce, renderer: first, rebuild,
      world: { cities: [], edges: [] },
      onStatus: (s) => status.push(s),
    });
  }

  beforeEach(() => {
    gl = document.createElement('canvas');
    trains = document.createElement('canvas');
    status = [];
    first = drawer();
    spyOn(Date, 'now').and.returnValue(0); // rot 0: the scene and nightFront() agree
  });

  it('redraws the planet at 15 fps, and at once when it moved on screen', () => {
    const s = scene();
    s.draw(view, 1000);
    s.draw(view, 1030);
    expect(first.draw).toHaveBeenCalledTimes(1);
    s.draw({ ...view, cy: 201 }, 1040);
    expect(first.draw).toHaveBeenCalledTimes(2);
    s.draw({ ...view, cy: 201 }, 1110);
    expect(first.draw).toHaveBeenCalledTimes(3);
  });

  it('forwards the device pixel ratio, capped at 2, and redraws after a resize', () => {
    const s = scene();
    s.resize(300, 100, 3);
    expect([gl.width, gl.height, trains.width, trains.height]).toEqual([600, 200, 600, 200]);
    s.draw(view, 1000);
    s.resize(300, 100, 1);
    s.draw(view, 1001);
    expect(first.draw).toHaveBeenCalledTimes(2);
    expect(first.draw.calls.mostRecent().args[1]).toBe(1);
  });

  it('draws nothing below the viewport, and once more when disc and halo left upwards', () => {
    const s = scene();
    s.draw({ ...view, cy: 600 }, 1000);
    expect(first.draw).not.toHaveBeenCalled();
    s.draw({ ...view, cy: -109 }, 1100); // 1.08 r reach: still touches the canvas's top
    s.draw({ ...view, cy: -120 }, 1200); // gone: this one empties the canvas
    s.draw({ ...view, cy: -130 }, 1300); // and nothing changes from here on
    s.draw({ ...view, cy: -140 }, 1400);
    expect(first.draw).toHaveBeenCalledTimes(2);
    s.draw(view, 1500);
    expect(first.draw).toHaveBeenCalledTimes(3);
  });

  it('leaves the train layer alone while no train is lit, and wipes a gone train exactly once', () => {
    const s = scene();
    const ctx = trains.getContext('2d')!;
    const clear = spyOn(ctx, 'clearRect').and.callThrough();
    const net = (s as unknown as { net: { trains: object[]; position: () => readonly number[] } }).net;
    let now = 1000;
    const frames = (n: number) => { for (let i = 0; i < n; i++) s.draw(view, (now += 40)); };

    frames(3);
    expect(clear).withContext('an empty layer stays untouched').not.toHaveBeenCalled();

    const lit = nightFront();
    net.position = () => lit;
    net.trains.push({ visible: false });
    frames(3);
    expect(clear).withContext('a lit train repaints every frame').toHaveBeenCalledTimes(3);

    net.trains.length = 0;
    frames(4);
    expect(clear).withContext('the gone train is wiped once').toHaveBeenCalledTimes(4);
  });

  it('never moves trains under reduced motion', () => {
    const s = scene(true);
    const clear = spyOn(trains.getContext('2d')!, 'clearRect');
    (s as unknown as { net: { trains: object[] } }).net.trains.push({ visible: false });
    s.draw(view, 1000);
    expect(first.draw).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });

  it('a lost context that stays lost hands over to the CSS planet', fakeAsync(() => {
    const s = scene();
    const ev = new Event('webglcontextlost', { cancelable: true });
    gl.dispatchEvent(ev);
    expect(ev.defaultPrevented).withContext('or the browser never restores it').toBeTrue();
    s.draw(view, 1000);
    expect(first.draw).not.toHaveBeenCalled();
    tick(CONTEXT_LOST_GRACE_MS - 1);
    expect(status).toEqual([]);
    tick(1);
    expect(status).toEqual(['unavailable']);
  }));

  it('a context that comes back rebuilds and draws on, and takes the CSS planet away again', fakeAsync(() => {
    const next = drawer();
    const s = scene(false, () => Promise.resolve(next));
    gl.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    tick(CONTEXT_LOST_GRACE_MS);
    gl.dispatchEvent(new Event('webglcontextrestored'));
    tick();
    expect(status).toEqual(['unavailable', 'restored']);
    s.draw(view, 5000);
    expect(next.draw).toHaveBeenCalledTimes(1);
    expect(first.draw).not.toHaveBeenCalled();
  }));

  it('a failed rebuild stays with the CSS planet, without a blank stage', fakeAsync(() => {
    scene(false, () => Promise.reject(new Error('gone')));
    gl.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    gl.dispatchEvent(new Event('webglcontextrestored'));
    tick(CONTEXT_LOST_GRACE_MS);
    expect(status[0]).toBe('unavailable');
  }));

  it('a parked scene empties both canvases', () => {
    const s = scene();
    const clear = spyOn(trains.getContext('2d')!, 'clearRect');
    s.clear();
    expect(first.clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
