import { PLANET_FS, SUN_FS, VS } from './body-shaders';

/** The four living bodies of the Verse stage. */
export type BodyKind = 'sun' | 'crusader' | 'arccorp' | 'microtech';

interface PlanetSpec {
  readonly layers: Partial<Record<'day' | 'night' | 'cloud', string>>;
  /** Seconds for one turn of the surface. */
  readonly period: number;
  /** Seconds for one turn of the cloud / haze layer (drifts against the surface). */
  readonly cloudPeriod: number;
  readonly cloudK: number;
  readonly cloudColor: readonly [number, number, number];
  /** Axis tilt in the picture, radians (matches the static SVG's bands). */
  readonly roll: number;
  readonly atm: readonly [number, number, number];
  readonly spec: number;
  readonly night: number;
  readonly traffic: number;
}

/**
 * Per planet: which maps, how fast it turns, how its air looks. Turns are slow
 * on purpose — one to four minutes — so the stage lives without pulling the
 * eye away from the headlines.
 */
export const PLANETS: Readonly<Record<Exclude<BodyKind, 'sun'>, PlanetSpec>> = {
  crusader: {
    layers: { day: 'crusader-day', night: 'crusader-night' },
    period: 70, cloudPeriod: 0, cloudK: 0, cloudColor: [1, 1, 1],
    roll: -0.157, atm: [0.9, 0.9, 1.0], spec: 0, night: 1.2, traffic: 0,
  },
  arccorp: {
    layers: { day: 'arccorp-day', night: 'arccorp-night', cloud: 'arccorp-haze' },
    period: 110, cloudPeriod: 75, cloudK: 0.28, cloudColor: [0.86, 0.8, 0.7],
    roll: -0.244, atm: [1.0, 0.8, 0.56], spec: 0.05, night: 1.15, traffic: 1,
  },
  microtech: {
    layers: { day: 'microtech-day', night: 'microtech-night', cloud: 'microtech-cloud' },
    period: 130, cloudPeriod: 95, cloudK: 0.7, cloudColor: [0.97, 0.99, 1.0],
    roll: -0.105, atm: [0.62, 0.88, 1.0], spec: 0.4, night: 1.3, traffic: 0,
  },
};

/** Light direction in view space: top right, towards the viewer (the sun beacon). */
export const SUN_DIR: readonly [number, number, number] = (() => {
  const v = [0.6, 0.64, 0.42];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as const;
})();

/** Disc radius of the sun inside its square canvas (0..1 of the half size). */
export const SUN_DISC = 0.34;

/**
 * Surface turn at a wall-clock time, 0..1 of a full turn. Wall clock, so every
 * visit shows another face and two tabs agree.
 */
export function turnAt(periodS: number, ms: number): number {
  return periodS > 0 ? ((ms / 1000) % periodS) / periodS : 0;
}

export interface BodyEngineOptions {
  /** URL of a map by name (default `/img/verse/maps/<name>.svg`). */
  readonly mapUrl?: (name: string) => string;
  /** Draw once and stand still (prefers-reduced-motion). */
  readonly still?: boolean;
  /** Map raster width in pixels (height is half). */
  readonly mapWidth?: number;
}

interface Entry {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly kind: BodyKind;
  readonly onReady?: () => void;
  ready: boolean;
  visible: boolean;
  io?: IntersectionObserver;
}

const MAX_PX = 1024;
const FRAME_MS = 1000 / 30;

/**
 * One WebGL context for every living body on the page: it renders each body
 * into an offscreen square and copies it into that body's own 2D canvas. The
 * caller's CSS art stays underneath as the fallback — no WebGL, maps still
 * loading — and the canvas only covers it once `onReady` fired.
 *
 * Runs at ~30 fps while at least one attached canvas is on screen; a canvas
 * whose computed `--sc-brief-play` is `paused` freezes time (the stage pause).
 */
export class BodyEngine {
  private readonly gl: WebGLRenderingContext;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly planetProg: WebGLProgram;
  private readonly sunProg: WebGLProgram;
  private readonly mipmaps: boolean;
  private readonly textures = new Map<string, Promise<WebGLTexture | null>>();
  private readonly loaded = new Map<string, WebGLTexture>();
  private readonly blank: WebGLTexture;
  private readonly entries: Entry[] = [];
  private frame = 0;
  private last = 0;
  private clock = 0;
  private lastNow = 0;
  private pausedCheck = 0;
  private paused = false;
  private disposed = false;

  /** Null when WebGL is missing or the shaders do not compile. */
  static create(opts: BodyEngineOptions = {}, onError?: (err: unknown) => void): BodyEngine | null {
    try {
      return new BodyEngine(opts);
    } catch (err) {
      onError?.(err);
      return null;
    }
  }

  private constructor(private readonly opts: BodyEngineOptions) {
    this.glCanvas = document.createElement('canvas');
    const gl = this.glCanvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl unavailable');
    this.gl = gl;
    const deriv = !!gl.getExtension('OES_standard_derivatives');
    this.mipmaps = deriv;
    this.planetProg = this.program(PLANET_FS(deriv));
    this.sunProg = this.program(SUN_FS);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.clock = Date.now();
    this.lastNow = performance.now();
  }

  /**
   * Starts drawing `kind` into `canvas` (a 2D canvas the caller sizes with
   * CSS). Returns the detach function.
   */
  attach(canvas: HTMLCanvasElement, kind: BodyKind, onReady?: () => void): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx || this.disposed) return () => undefined;
    const e: Entry = { canvas, ctx, kind, onReady, ready: false, visible: true };
    if ('IntersectionObserver' in window) {
      e.io = new IntersectionObserver((xs) => { e.visible = xs.some((x) => x.isIntersecting); this.kick(); });
      e.io.observe(canvas);
    }
    this.entries.push(e);
    void this.prepare(kind).then((ok) => {
      if (!ok || this.disposed || !this.entries.includes(e)) return;
      e.ready = true;
      this.draw(e, this.clock);
      e.onReady?.();
      this.kick();
    });
    return () => {
      e.io?.disconnect();
      const i = this.entries.indexOf(e);
      if (i >= 0) this.entries.splice(i, 1);
      if (!this.entries.length) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    };
  }

  /** Redraws every ready body once (resize, reduced motion). */
  redraw(): void {
    for (const e of this.entries) if (e.ready) this.draw(e, this.clock);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const e of this.entries) e.io?.disconnect();
    this.entries.length = 0;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private kick(): void {
    if (this.opts.still || this.frame || this.disposed) return;
    if (!this.entries.some((e) => e.ready && e.visible)) return;
    this.lastNow = performance.now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    this.frame = 0;
    const live = this.entries.filter((e) => e.ready && e.visible);
    if (!live.length) return;
    if (now - this.pausedCheck > 500) {
      this.pausedCheck = now;
      this.paused = live.some((e) => getComputedStyle(e.canvas).getPropertyValue('--sc-brief-play').trim() === 'paused');
    }
    const dt = Math.min(100, now - this.lastNow);
    this.lastNow = now;
    if (!this.paused) this.clock += dt;
    if (now - this.last >= FRAME_MS - 2) {
      this.last = now;
      for (const e of live) this.draw(e, this.clock);
    }
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private async prepare(kind: BodyKind): Promise<boolean> {
    if (kind === 'sun') return true;
    const names = Object.values(PLANETS[kind].layers);
    const tex = await Promise.all(names.map((n) => this.texture(n)));
    return tex.every((t) => !!t);
  }

  private texture(name: string): Promise<WebGLTexture | null> {
    let p = this.textures.get(name);
    if (!p) {
      p = this.rasterize(name).then((src) => {
        if (!src || this.disposed) return null;
        const gl = this.gl, t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        } catch {
          // A tainted raster (map from another origin): keep the CSS art.
          gl.deleteTexture(t);
          return null;
        }
        if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        src.width = src.height = 0;
        this.loaded.set(name, t);
        return t;
      });
      this.textures.set(name, p);
    }
    return p;
  }

  /** The SVG map rasterised into a canvas (its filters run once, here). */
  private async rasterize(name: string): Promise<HTMLCanvasElement | null> {
    const w = this.opts.mapWidth ?? 1024;
    const img = new Image();
    img.decoding = 'async';
    img.src = this.opts.mapUrl ? this.opts.mapUrl(name) : `/img/verse/maps/${name}.svg`;
    try {
      await img.decode();
    } catch {
      return null;
    }
    // Let the page breathe between the heavy filter rasters.
    await new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 16)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = w / 2;
    c.getContext('2d')!.drawImage(img, 0, 0, w, w / 2);
    return c;
  }

  private draw(e: Entry, ms: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.min(MAX_PX, Math.round(e.canvas.clientWidth * dpr));
    if (size <= 0) return;
    if (e.canvas.width !== size) e.canvas.width = e.canvas.height = size;
    const gl = this.gl, g = this.glCanvas;
    if (g.width < size) g.width = g.height = Math.max(size, 256);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = (ms / 1000) % 3600;
    if (e.kind === 'sun') {
      const p = this.use(this.sunProg);
      gl.uniform2f(p('uRes'), size, size);
      gl.uniform1f(p('uTime'), t);
      gl.uniform1f(p('uR'), SUN_DISC);
    } else {
      const s = PLANETS[e.kind];
      const p = this.use(this.planetProg);
      const bind = (unit: number, uni: string, layer: string | undefined) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, (layer && this.loaded.get(layer)) || this.blank);
        gl.uniform1i(p(uni), unit);
      };
      bind(0, 'tDay', s.layers.day);
      bind(1, 'tNight', s.layers.night);
      bind(2, 'tCloud', s.layers.cloud);
      gl.uniform2f(p('uRes'), size, size);
      gl.uniform3f(p('uSun'), SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
      gl.uniform3f(p('uAtm'), s.atm[0], s.atm[1], s.atm[2]);
      gl.uniform3f(p('uCloudC'), s.cloudColor[0], s.cloudColor[1], s.cloudColor[2]);
      gl.uniform1f(p('uRot'), turnAt(s.period, ms));
      gl.uniform1f(p('uCloudRot'), turnAt(s.cloudPeriod, ms));
      gl.uniform1f(p('uRoll'), s.roll);
      gl.uniform1f(p('uSpec'), s.spec);
      gl.uniform1f(p('uNight'), s.night);
      gl.uniform1f(p('uCloudK'), s.cloudK);
      gl.uniform1f(p('uTraffic'), s.traffic);
      gl.uniform1f(p('uTime'), t);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    e.ctx.clearRect(0, 0, size, size);
    e.ctx.drawImage(g, 0, g.height - size, size, size, 0, 0, size, size);
  }

  private readonly uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private use(prog: WebGLProgram): (name: string) => WebGLUniformLocation | null {
    const gl = this.gl;
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    let m = this.uniforms.get(prog);
    if (!m) this.uniforms.set(prog, (m = new Map()));
    const cache = m;
    return (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n));
      return cache.get(n) ?? null;
    };
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl, prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    return prog;
  }
}
