import { FIELD_H, FIELD_W, PlanetWorld, SEA, gauss, seeded, slerp, toLatLon } from './planet-world';

/**
 * Paints the world into equirect canvases for the shader: the day surface
 * (muted, non-Earth palette), the cloud cover and the night lights — sodium
 * clusters that sprawl along roads, plus lit rail corridors between them.
 * The light colours are the hub's existing amber; nothing new.
 */

/** City-light tones (the hub's amber, from warm to pale). */
const SODIUM: readonly (readonly [number, number, number])[] = [
  [255, 184, 107], [255, 206, 150], [255, 226, 186], [255, 196, 128],
];

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function paintDay(world: PlanetWorld): { day: HTMLCanvasElement; cloud: HTMLCanvasElement } {
  const day = canvas(FIELD_W, FIELD_H), cloud = canvas(FIELD_W, FIELD_H);
  const dctx = day.getContext('2d')!, cctx = cloud.getContext('2d')!;
  const dimg = dctx.createImageData(FIELD_W, FIELD_H), cimg = cctx.createImageData(FIELD_W, FIELD_H);
  for (let j = 0; j < FIELD_H; j++) {
    const lat = (0.5 - (j + 0.5) / FIELD_H) * Math.PI;
    for (let i = 0; i < FIELD_W; i++) {
      const k = j * FIELD_W + i, h = world.height[k], o = k * 4;
      let r: number, g: number, b: number;
      if (h <= SEA) {
        const d = 1 - (SEA - h) / SEA;
        r = 10 + 14 * d; g = 38 + 30 * d; b = 58 + 40 * d;
        if (h > SEA - 0.012) { r += 18; g += 26; b += 22; }
      } else {
        const e = Math.min(1, (h - SEA) / 0.2), dry = world.people[k];
        r = 62 + 70 * e + 40 * dry; g = 72 + 44 * e + 10 * dry; b = 46 + 30 * e - 6 * dry;
      }
      if (Math.abs(lat) > 1.18) {
        const t = Math.min(1, (Math.abs(lat) - 1.18) / 0.15);
        r += (220 - r) * t; g += (228 - g) * t; b += (232 - b) * t;
      }
      dimg.data[o] = r; dimg.data[o + 1] = g; dimg.data[o + 2] = b; dimg.data[o + 3] = 255;
      const c = Math.max(0, Math.min(1, (world.cloud[k] - 0.5) * 3.2)) * 255;
      cimg.data[o] = cimg.data[o + 1] = cimg.data[o + 2] = c; cimg.data[o + 3] = 255;
    }
  }
  dctx.putImageData(dimg, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  return { day, cloud };
}

/**
 * The night lights, painted in slices (a generator, like the world) so the
 * page stays responsive. `size` is the texture width (height = size / 2).
 */
export function* paintNight(world: PlanetWorld, size: number, seed = 7): Generator<void, HTMLCanvasElement> {
  const nw = size, nh = size / 2, scale = size / 4096;
  const c = canvas(nw, nh), ctx = c.getContext('2d')!;
  const rnd = seeded(seed);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, nw, nh);
  ctx.globalCompositeOperation = 'lighter';
  const toPx = (lat: number, lon: number): [number, number] => [(lon / (2 * Math.PI) + 0.5) * nw, (0.5 - lat / Math.PI) * nh];
  const dot = (x: number, y: number, r: number, col: readonly number[], a: number) => {
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
    ctx.beginPath();
    ctx.arc(((x % nw) + nw) % nw, y, Math.max(0.35, r * scale), 0, Math.PI * 2);
    ctx.fill();
  };

  // Rail corridors first, so the towns along them read as chains of light.
  for (let n = 0; n < world.edges.length; n++) {
    const e = world.edges[n], A = world.cities[e.a].v, B = world.cities[e.b].v, steps = Math.ceil(e.w * 2200 * scale);
    for (let i = 0; i <= steps; i++) {
      const [la, lo] = toLatLon(slerp(A, B, i / steps));
      const [x, y] = toPx(la, lo), sx = 1 / Math.max(0.3, Math.cos(la));
      if (rnd() < 0.5) dot(x + gauss(rnd) * 0.8 * scale * sx, y + gauss(rnd) * 0.8 * scale, 0.5, SODIUM[1], 0.07);
      if (rnd() < 0.006) for (let t = 0; t < 14; t++) dot(x + gauss(rnd) * 3 * scale * sx, y + gauss(rnd) * 3 * scale, 0.55, SODIUM[0], 0.16);
    }
    if (n % 200 === 199) yield;
  }

  // Cities: a soft glow, a dense core, and sprawl that wanders along a few
  // roads (random walks) — no straight spokes, nothing on a grid.
  for (let n = 0; n < world.cities.length; n++) {
    const city = world.cities[n], s = city.size;
    const [x, y] = toPx(city.lat, city.lon), sx = 1 / Math.max(0.3, Math.cos(city.lat));
    const gr = (12 * s + 3) * scale;
    const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
    g.addColorStop(0, `rgba(255,186,116,${0.1 + 0.22 * s})`);
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, 1);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const core = Math.floor((20 + 380 * s * s) * Math.max(0.5, scale));
    for (let i = 0; i < core; i++) {
      const rr = Math.abs(gauss(rnd)) * (2 + 7 * s) * scale, a = rnd() * Math.PI * 2;
      dot(x + Math.cos(a) * rr * sx, y + Math.sin(a) * rr, 0.6, SODIUM[Math.floor(rnd() * 4)], 0.22 + 0.25 * rnd());
    }
    const roads = 2 + Math.floor(rnd() * 4 * (0.4 + s));
    for (let r = 0; r < roads; r++) {
      let px = x, py = y, a = rnd() * Math.PI * 2;
      const len = 6 + Math.floor(rnd() * 40 * (0.3 + s));
      for (let k = 0; k < len; k++) {
        a += gauss(rnd) * 0.5;
        px += Math.cos(a) * 1.4 * scale * sx;
        py += Math.sin(a) * 1.4 * scale;
        if (rnd() < 0.7) dot(px + gauss(rnd) * 0.7 * scale, py + gauss(rnd) * 0.7 * scale, 0.5, SODIUM[Math.floor(rnd() * 4)], 0.1 + 0.14 * rnd());
      }
    }
    if (n % 120 === 119) yield;
  }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}
