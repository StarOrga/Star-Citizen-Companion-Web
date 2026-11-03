import { Directive, ElementRef, Input, NgZone, OnDestroy, OnInit, inject } from '@angular/core';

/**
 * Neuronenfeld — die Ladeanimation der Inhaltskacheln.
 *
 * Nachbau der Mechanik aus dem Setup-Wizard der Desktop-App
 * (`modules/desktop/ui-angular/src/app/setup-wizard-canvas.ts`, `drawAiFx` /
 * `spawnAiLightning`): weiche Blobs driften und pulsieren, ein fast
 * unsichtbares Grundnetz verbindet nahe Blobs, und sporadisch springt eine
 * gezackte Entladung zwischen zweien — aufbauen, halten, verglühen.
 *
 * Warum genau so und nicht als fester Graph: ein regelmässiges Netz aus
 * festen Knoten und geraden Kanten liest sich als Diagramm. Lebendig wird es
 * erst durch die Unregelmässigkeit — driftende Positionen, zufällige Paare,
 * seltene Entladungen (Concept-Runde 4).
 *
 * Drei bewusste Abweichungen vom Original:
 *  1. Ein Canvas je Kachel, aber Blobzahl und Radius skalieren mit der
 *     Fläche. Zehn Blobs mit r = 30 auf einem 90-px-Thumbnail wären ein Fleck.
 *  2. Rechnet nur, was sichtbar ist (`IntersectionObserver`) — der Wizard hat
 *     immer nur eine Ansicht, eine Codex-Seite hat 24 Kacheln.
 *  3. Läuft ausserhalb der Angular-Zone: die RAF-Schleife darf keine
 *     Change-Detection auslösen.
 *
 * Verwendung:
 *   <span class="sc-skel-field" scNeuroField [neuroIndex]="i"></span>
 */

interface Blob {
  x: number; y: number; vx: number; vy: number;
  r: number; baseR: number; phase: number; speed: number;
}

interface Bolt {
  pts: { x: number; y: number }[];
  state: 'build' | 'hold' | 'fade';
  startedAt: number;
  buildMs: number; holdMs: number; fadeMs: number;
}

/** Werte aus der Quelle; nur die Farben sind auf die App-Palette gezogen. */
const BLOB_ALPHA = 0.13;
const MESH_ALPHA = 0.035;
const BOLT_ALPHA = 0.6;
/** Eine Blob-„Portion" Fläche in px². Bestimmt, wie viele Blobs eine Kachel bekommt. */
const AREA_PER_BLOB = 9000;
const SPAWN_MIN_MS = 1200;
const SPAWN_JITTER_MS = 1800;

/**
 * How long a field keeps drawing after its host said it is no longer needed
 * (`neuroActive` false): long enough for a fade-out on top of it to finish
 * (news-thumb fades its skeleton over 450 ms), so nothing freezes mid-fade.
 */
const FADE_OUT_MS = 600;

/**
 * One IntersectionObserver and one ResizeObserver for every field on the page.
 * Their callbacks run after layout and hand over each tile's box, and the
 * callback reads every tile first and writes (canvas sizes, loops) second — so
 * no tile forces a layout of its own. With one observer per tile, a news page
 * mounting 80 thumbnails read each tile's rect and colour between the canvas
 * writes of the previous one: a chain of forced reflows that showed up as
 * ~100 ms long tasks right after the list rendered (profiled 2026-11-03).
 */
class FieldRegistry {
  private io?: IntersectionObserver;
  private ro?: ResizeObserver;
  private readonly fields = new Map<Element, NeuroFieldDirective>();

  add(host: Element, field: NeuroFieldDirective, zone: NgZone): void {
    if (!this.io) {
      zone.runOutsideAngular(() => {
        this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { threshold: 0 });
        if (typeof ResizeObserver !== 'undefined') this.ro = new ResizeObserver((entries) => this.onResize(entries));
      });
    }
    this.fields.set(host, field);
    this.io!.observe(host);
    this.ro?.observe(host);
  }

  remove(host: Element): void {
    if (!this.fields.delete(host)) return;
    this.io?.unobserve(host);
    this.ro?.unobserve(host);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    const read: [NeuroFieldDirective, boolean, number, number][] = [];
    for (const e of entries) {
      const field = this.fields.get(e.target);
      if (!field) continue;
      const host = e.target as HTMLElement;
      // Reads only: layout is clean in this callback until the write pass below.
      if (e.isIntersecting) field.readAccentOnce();
      read.push([field, e.isIntersecting, host.offsetWidth, host.offsetHeight]);
    }
    for (const [field, visible, w, h] of read) field.setVisible(visible, w, h);
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    for (const e of entries) {
      const box = e.borderBoxSize?.[0];
      const w = box ? box.inlineSize : e.contentRect.width;
      const h = box ? box.blockSize : e.contentRect.height;
      this.fields.get(e.target)?.resize(w, h);
    }
  }
}

const registry = new FieldRegistry();

@Directive({
  selector: '[scNeuroField]',
  standalone: true,
})
export class NeuroFieldDirective implements OnInit, OnDestroy {
  /** Position im Raster — staffelt den ersten Blitz, damit nicht alle gleichzeitig zünden. */
  @Input() neuroIndex = 0;

  /**
   * False once the host no longer shows the field (its content arrived and the
   * skeleton fades out). The field finishes the fade (`FADE_OUT_MS`) and then
   * stops: a skeleton that is only faded to opacity 0 still counts as
   * intersecting, and every loaded news thumbnail kept redrawing an invisible
   * canvas each frame — under a backdrop-filter pill that re-blurred with it.
   */
  @Input() set neuroActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    clearTimeout(this.fadeTimer);
    if (active) {
      if (this.visible) this.start();
    } else {
      this.zone.runOutsideAngular(() => (this.fadeTimer = setTimeout(() => this.stop(), FADE_OUT_MS)));
    }
  }

  private readonly host = inject(ElementRef).nativeElement as HTMLElement;
  private readonly zone = inject(NgZone);

  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private blobs: Blob[] = [];
  private bolts: Bolt[] = [];
  private nextSpawn = 0;
  private w = 0;
  private h = 0;
  private raf: number | null = null;
  private visible = false;
  private active = true;
  private reduced = false;
  private accentRead = false;
  private stillDrawn = false;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;

  /* Eigener Generator statt Math.random(): zwei Kacheln nebeneinander sollen
     unterschiedlich aussehen, dieselbe Kachel aber bei jedem Aufbau gleich —
     sonst flackert das Feld bei jedem Re-Render neu durch. */
  private seed = 0;
  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  ngOnInit(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    this.seed = 0x9e3779b9 ^ ((this.neuroIndex + 1) * 2654435761);
    const canvas = document.createElement('canvas');
    canvas.className = 'sc-neuro';
    canvas.setAttribute('aria-hidden', 'true');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;                       // kein Canvas → CSS-Rückfallebene bleibt
    this.host.appendChild(canvas);
    this.host.dataset['neuroReady'] = '1';

    // Ein Standbild bei reduzierter Bewegung: die Struktur ist da, es bewegt
    // sich nichts. Gezeichnet wird es, sobald die Kachel sichtbar ist.
    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof IntersectionObserver === 'undefined') {
      this.readAccentOnce();
      this.resize(this.host.offsetWidth, this.host.offsetHeight);
      this.draw(0);
      return;
    }
    registry.add(this.host, this, this.zone);
  }

  ngOnDestroy(): void {
    clearTimeout(this.fadeTimer);
    this.stop();
    registry.remove(this.host);
    this.canvas?.remove();
  }

  /** Registry callback, after layout: visibility plus the host's layout box. */
  setVisible(visible: boolean, w: number, h: number): void {
    this.visible = visible;
    if (!visible) {
      this.stop();
      return;
    }
    this.resize(w, h);
    if (this.reduced) {
      if (!this.stillDrawn) {
        this.stillDrawn = true;
        this.draw(0);
      }
      return;
    }
    if (this.active) this.start();
  }

  private start(): void {
    if (this.raf !== null || this.reduced) return;
    const loop = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /** Sizes the canvas bitmap to the host's layout box; a no-op when it did not change. */
  resize(width: number, height: number): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.initBlobs();
    // A resized still frame has to be drawn again (the bitmap was cleared).
    if (this.reduced && this.stillDrawn) this.draw(0);
  }

  private initBlobs(): void {
    const count = Math.max(3, Math.min(10, Math.round((this.w * this.h) / AREA_PER_BLOB)));
    // 18 % der kürzeren Kante, gedeckelt — auf einer Bühne wie auf einem Thumbnail
    // soll ein Blob denselben Anteil der Fläche einnehmen, nicht dieselbe Pixelzahl.
    const rBase = Math.max(6, Math.min(30, Math.min(this.w, this.h) * 0.18));
    this.blobs = [];
    for (let i = 0; i < count; i++) {
      const base = rBase * (0.7 + this.rnd() * 0.6);
      this.blobs.push({
        x: 0.15 + this.rnd() * 0.7,
        y: 0.15 + this.rnd() * 0.7,
        vx: (this.rnd() - 0.5) * 0.0009,
        vy: (this.rnd() - 0.5) * 0.0009,
        r: base, baseR: base,
        phase: this.rnd() * Math.PI * 2,
        speed: 0.02 + this.rnd() * 0.02,
      });
    }
    this.bolts = [];
    this.nextSpawn = 0;
  }

  /** Einmal aufgelöst und gemerkt — nicht je Blob und Frame. */
  private rgb = '82, 193, 230';
  readAccentOnce(): void {
    if (this.accentRead) return;
    this.accentRead = true;
    const raw = getComputedStyle(this.host).getPropertyValue('--sc-neuro-rgb').trim();
    if (raw) this.rgb = raw;
  }
  private accent(alpha: number): string {
    return `rgba(${this.rgb}, ${alpha})`;
  }

  private spawnBolt(now: number): void {
    if (this.blobs.length < 2) return;
    const si = Math.floor(this.rnd() * this.blobs.length);
    let di = Math.floor(this.rnd() * this.blobs.length);
    while (di === si) di = Math.floor(this.rnd() * this.blobs.length);
    const a = this.blobs[si];
    const b = this.blobs[di];

    const segments = 6 + Math.floor(this.rnd() * 5);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      if (i === 0 || i === segments) pts.push({ x: mx, y: my });
      else pts.push({ x: mx + (this.rnd() - 0.5) * 0.06, y: my + (this.rnd() - 0.5) * 0.06 });
    }

    this.bolts.push({
      pts, state: 'build', startedAt: now,
      buildMs: 50 + this.rnd() * 30,
      holdMs: 200 + this.rnd() * 100,
      fadeMs: 600 + this.rnd() * 200,
    });
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);

    for (const b of this.blobs) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < 0.05 || b.x > 0.95) b.vx *= -1;
      if (b.y < 0.05 || b.y > 0.95) b.vy *= -1;
      b.phase += b.speed;
      b.r = b.baseR + Math.sin(b.phase) * (b.baseR * 0.16);

      const px = b.x * w;
      const py = b.y * h;
      const r = Math.max(1, b.r);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, this.accent(BLOB_ALPHA));
      g.addColorStop(0.6, this.accent(BLOB_ALPHA * 0.5));
      g.addColorStop(1, this.accent(0));
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Grundnetz — es trägt nicht, es deutet an. Nur nahe Paare.
    ctx.strokeStyle = this.accent(MESH_ALPHA);
    ctx.lineWidth = 0.5;
    for (let i = 0; i < this.blobs.length; i++) {
      for (let j = i + 1; j < this.blobs.length; j++) {
        const a = this.blobs[i];
        const b = this.blobs[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.35) {
          ctx.beginPath();
          ctx.moveTo(a.x * w, a.y * h);
          ctx.lineTo(b.x * w, b.y * h);
          ctx.stroke();
        }
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const l = this.bolts[i];
      const elapsed = now - l.startedAt;
      let alpha = 1;
      let segs = l.pts.length;

      if (l.state === 'build') {
        segs = Math.floor(Math.min(1, elapsed / l.buildMs) * l.pts.length);
        if (elapsed >= l.buildMs) { l.state = 'hold'; l.startedAt = now; }
      } else if (l.state === 'hold') {
        if (elapsed >= l.holdMs) { l.state = 'fade'; l.startedAt = now; }
      } else {
        alpha = 1 - Math.min(1, elapsed / l.fadeMs);
        if (alpha <= 0) { this.bolts.splice(i, 1); continue; }
      }
      if (segs < 2) continue;

      ctx.strokeStyle = this.accent(BOLT_ALPHA * alpha);
      ctx.lineWidth = 1.5;
      ctx.shadowColor = this.accent(0.4 * alpha);
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(l.pts[0].x * w, l.pts[0].y * h);
      for (let k = 1; k < segs; k++) ctx.lineTo(l.pts[k].x * w, l.pts[k].y * h);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (now >= this.nextSpawn) {
      this.spawnBolt(now);
      this.nextSpawn = now + SPAWN_MIN_MS + this.rnd() * SPAWN_JITTER_MS;
    }
  }
}
