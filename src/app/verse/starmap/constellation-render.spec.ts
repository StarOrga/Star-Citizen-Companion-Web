import { ConstellationRenderOptions, Ctx2D, constellationBoxes, renderConstellationWallpaper } from './constellation-render';
import { FALLBACK_POINTS } from './starmap.model';

/** A context that records every call and property write as a string. */
function recorder(): { ctx: Ctx2D; log: string[] } {
  const log: string[] = [];
  const grad = { addColorStop: (o: number, c: string) => log.push(`stop ${o} ${c}`) };
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (...a: number[]) => (log.push(`${prop} ${a.map((n) => n.toFixed(3)).join(',')}`), grad);
      }
      if (prop in target) return target[prop];
      return (...a: unknown[]) => log.push(`${prop}(${a.map((n) => (typeof n === 'number' ? n.toFixed(3) : String(n))).join(',')})`);
    },
    set(t, prop: string, v: unknown) {
      t[prop] = v;
      log.push(`${prop}=${typeof v === 'object' ? 'gradient' : String(v)}`);
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, log };
}

describe('constellation renderer', () => {
  const opts: ConstellationRenderOptions = {
    width: 640,
    height: 360,
    seed: 'wallpaper:4.4',
    constellations: [
      { patchLine: '4.4', points: FALLBACK_POINTS, starCount: 5, sun: true },
      { patchLine: '4.3', points: FALLBACK_POINTS, starCount: 7, sun: true },
    ],
    nebula: true,
    road: true,
  };

  it('is deterministic for identical inputs', () => {
    const a = recorder();
    const b = recorder();
    renderConstellationWallpaper(a.ctx, opts);
    renderConstellationWallpaper(b.ctx, opts);
    expect(a.log.length).toBeGreaterThan(100);
    expect(a.log).toEqual(b.log);
  });

  it('changes with the seed', () => {
    const a = recorder();
    const b = recorder();
    renderConstellationWallpaper(a.ctx, opts);
    renderConstellationWallpaper(b.ctx, { ...opts, seed: 'wallpaper:4.3' });
    expect(a.log).not.toEqual(b.log);
  });

  it('writes the patch number as a faint watermark without a prefix', () => {
    const r = recorder();
    renderConstellationWallpaper(r.ctx, opts);
    const text = r.log.filter((l) => l.startsWith('fillText('));
    expect(text.length).toBe(1);
    expect(text[0]).toMatch(/^fillText\(4\.4,/);
    const i = r.log.indexOf(text[0]);
    expect(r.log.slice(0, i).reverse().find((l) => l.startsWith('globalAlpha='))).toBe('globalAlpha=0.07');
  });

  it('adds the subtle SCC hint only to the supernova', () => {
    const r = recorder();
    renderConstellationWallpaper(r.ctx, { ...opts, supernova: true });
    expect(r.log.some((l) => l.startsWith('fillText(SCC'))).toBeTrue();
  });

  it('draws only the current constellation large', () => {
    const boxes = constellationBoxes(3840, 2160, 3);
    expect(boxes[0].w).toBeGreaterThan(boxes[1].w * 3);
    expect(boxes[1].w).toBe(boxes[2].w);
  });

  it('renders identical pixels on a real canvas', () => {
    const draw = () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      renderConstellationWallpaper(c.getContext('2d')!, { ...opts, width: 320, height: 180 });
      return c.toDataURL();
    };
    expect(draw()).toBe(draw());
  });
});
