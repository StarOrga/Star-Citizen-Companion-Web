import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BriefingPlanetComponent, forgetPlanetSession } from './briefing-planet.component';
import { PlanetStatus, PlanetView } from './planet/planet-scene';
import { PLANET_LINK, PlanetLink } from './planet/planet-worker-link';

class FakeLink implements PlanetLink {
  capable: Promise<boolean> = Promise.resolve(true);
  settled: Promise<boolean> = Promise.resolve(true);
  isReady = false;
  alive = true;
  canvases: readonly [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  onStatus: ((status: PlanetStatus) => void) | null = null;
  reduce: boolean | null = null;
  views: PlanetView[] = [];
  draws: PlanetView[] = [];
  sizes: [number, number, number][] = [];
  parked = 0;
  terminated = false;
  accents = 0;
  attach(gl: HTMLCanvasElement, trains: HTMLCanvasElement, _accent: readonly [number, number, number], reduce: boolean): void {
    this.canvases = [gl, trains];
    this.reduce = reduce;
  }
  setAccent(): void { this.accents++; }
  resize(w: number, h: number, dpr: number): void { this.sizes.push([w, h, dpr]); }
  tick(view: PlanetView): void { this.views.push(view); }
  draw(view: PlanetView): void { this.draws.push(view); }
  resume(): void { /* the scene's business */ }
  suspended = 0;
  woken = 0;
  suspend(): void { this.suspended++; }
  wake(): void { this.woken++; }
  park(): void { this.parked++; }
  terminate(): void { this.terminated = true; }
}

@Component({
  standalone: true,
  imports: [BriefingPlanetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #a [style.width.px]="200" [style.height.px]="200"></div>
    <sc-briefing-planet [anchor]="a" (drawn)="drawn = drawn + 1" (unavailable)="gone = gone + 1" />`,
})
class HostComponent {
  drawn = 0;
  gone = 0;
}

describe('BriefingPlanetComponent — worker path', () => {
  let link: FakeLink | null, spawned: number, frames: FrameRequestCallback[], reduce: boolean;

  const planet = (f: ComponentFixture<HostComponent>) =>
    f.debugElement.children.find((d) => d.componentInstance instanceof BriefingPlanetComponent)!.componentInstance as BriefingPlanetComponent;
  const runFrames = (t: number) => frames.splice(0).forEach((cb) => cb(t));
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const mount = async () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    await settle();
    return f;
  };

  beforeEach(() => {
    forgetPlanetSession();
    link = new FakeLink();
    spawned = 0;
    frames = [];
    reduce = false;
    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => frames.push(cb));
    spyOn(window, 'cancelAnimationFrame');
    spyOn(window, 'matchMedia').and.callFake((q: string) => ({ matches: q.includes('reduced-motion') && reduce, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);
    TestBed.configureTestingModule({
      providers: [{ provide: PLANET_LINK, useValue: () => { spawned++; return link; } }],
    });
  });

  afterEach(() => forgetPlanetSession());

  it('hands the canvases to the worker, stands when it is ready, and fires drawn once', async () => {
    const f = await mount();
    expect(spawned).toBe(1);
    expect(link!.canvases).toEqual(Array.from(f.nativeElement.querySelectorAll('canvas')) as [HTMLCanvasElement, HTMLCanvasElement]);
    expect(planet(f).ready()).toBeTrue();
    expect(f.componentInstance.drawn).toBe(1);
    expect(f.componentInstance.gone).toBe(0);
  });

  it('measures at 15 Hz at rest, and every frame while the planet moves on screen', async () => {
    const f = await mount();
    runFrames(16);
    const a = link!.views[0];
    expect(a.r).toBe(100);
    expect(frames.length).withContext('at rest a timer sets the pace, not the monitor').toBe(0);
    await new Promise((r) => setTimeout(r, 90));
    expect(frames.length).withContext('the timer asks for the next frame').toBe(1);
    (f.nativeElement.querySelector('div') as HTMLElement).style.transform = 'translateY(40px)';
    runFrames(200);
    const b = link!.views[1];
    expect(b.cy - a.cy).toBe(40);
    expect(frames.length).withContext('it moved: every frame now').toBe(1);
    runFrames(216);
    expect(link!.views.length).withContext('the loop goes on').toBe(3);
  });

  it('a scroll is followed from the next frame, without waiting for the timer', async () => {
    await mount();
    runFrames(16);
    expect(frames.length).toBe(0);
    document.dispatchEvent(new Event('scroll'));
    expect(frames.length).toBe(1);
  });

  it('stands without focus, stays under the page, and carries on with focus', async () => {
    await mount();
    runFrames(16);
    window.dispatchEvent(new Event('blur'));
    expect(link!.suspended).toBe(1);
    await new Promise((r) => setTimeout(r, 90));
    expect(frames.length).withContext('no timer left running').toBe(0);
    document.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
    expect(frames.length).withContext('one redraw for a burst of scrolls').toBe(1);
    runFrames(200);
    expect(link!.draws.length).toBe(1);
    expect(link!.views.length).withContext('drawn, not turned').toBe(1);
    window.dispatchEvent(new Event('focus'));
    expect(link!.woken).toBe(1);
    runFrames(216);
    expect(link!.views.length).toBe(2);
  });

  it('sends size and device pixel ratio, again on every resize', async () => {
    await mount();
    expect(link!.sizes.length).toBe(1);
    expect(link!.sizes[0][2]).toBe(devicePixelRatio);
    window.dispatchEvent(new Event('resize'));
    expect(link!.sizes.length).toBe(2);
  });

  it('reduced motion: drawn once, no animation frame, redrawn only on scroll and resize', async () => {
    reduce = true;
    await mount();
    expect(link!.reduce).toBeTrue();
    expect(link!.draws.length).toBe(1);
    runFrames(16);
    expect(link!.views.length).withContext('no animation').toBe(0);
    document.dispatchEvent(new Event('scroll'));
    expect(link!.draws.length).toBe(2);
    window.dispatchEvent(new Event('resize'));
    expect(link!.draws.length).toBe(3);
    expect(link!.views.length).toBe(0);
    window.dispatchEvent(new Event('blur'));
    expect(link!.suspended).withContext('nothing runs that could stand').toBe(0);
    window.dispatchEvent(new Event('focus'));
  });

  it('session re-entry: same canvases, same worker, instant, nothing compiled again', async () => {
    const first = await mount();
    expect(planet(first).instant()).withContext('the first time it slides in').toBeFalse();
    const held = link!.canvases!;
    first.destroy();
    expect(link!.parked).toBe(1);
    link!.isReady = true;

    const again = await mount();
    expect(spawned).withContext('the worker lives on').toBe(1);
    expect(planet(again).instant()).toBeTrue();
    expect(planet(again).ready()).toBeTrue();
    expect(again.componentInstance.drawn).toBe(1);
    const canvases = Array.from(again.nativeElement.querySelectorAll('canvas')) as HTMLCanvasElement[];
    expect(canvases[0]).toBe(held[0]);
    expect(canvases[1]).toBe(held[1]);
    expect(link!.accents).toBe(1);
  });

  it('keeps downloading when the page leaves before the planet stood; the next visit picks it up', async () => {
    let answer!: (ok: boolean) => void;
    link!.settled = new Promise((r) => (answer = r));
    const attach = spyOn(link!, 'attach').and.callThrough();
    const first = await mount();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(first.componentInstance.drawn).toBe(0);
    first.destroy();
    answer(true);
    await settle();
    expect(link!.terminated).toBeFalse();

    const again = await mount();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(planet(again).ready()).toBeTrue();
  });

  it('a lost planet hands over to the CSS one, and a restored one takes it back', async () => {
    const f = await mount();
    link!.onStatus!('unavailable');
    expect(planet(f).failed()).toBeTrue();
    expect(f.componentInstance.gone).toBe(1);
    link!.onStatus!('restored');
    expect(planet(f).failed()).toBeFalse();
  });

  describe('fallback to the page', () => {
    it('no worker at all: nothing is handed over, and the existing path runs', async () => {
      link = null;
      const transfer = spyOn(HTMLCanvasElement.prototype, 'transferControlToOffscreen').and.callThrough();
      const f = await mount();
      expect(spawned).toBe(1);
      expect(transfer).withContext('still the page\'s canvas').not.toHaveBeenCalled();
      f.destroy();
    });

    it('a worker that cannot draw keeps the canvases untouched', async () => {
      link!.capable = Promise.resolve(false);
      link!.settled = Promise.resolve(false);
      const attach = spyOn(link!, 'attach');
      const f = await mount();
      expect(attach).not.toHaveBeenCalled();
      f.destroy();
    });

    it('a worker failing after the hand-over: fresh canvases replace the ones it took', async () => {
      link!.settled = Promise.resolve(false);
      const f = TestBed.createComponent(HostComponent);
      f.detectChanges();
      const before = Array.from(f.nativeElement.querySelectorAll('canvas'));
      await settle();
      await settle();
      const after = Array.from(f.nativeElement.querySelectorAll('canvas')) as HTMLCanvasElement[];
      expect(link!.terminated).toBeTrue();
      expect(after.length).toBe(2);
      expect(after[0]).not.toBe(before[0] as HTMLCanvasElement);
      expect(after[0].className).toBe('bp-gl');
      expect(after[1].className).toBe('bp-trains');
      f.destroy();
    });

    it('a parked worker that died since: the new visit does not take its dead canvases back', async () => {
      const first = await mount();
      const held = link!.canvases!;
      first.destroy();
      link!.alive = false;
      const again = await mount();
      const now = Array.from(again.nativeElement.querySelectorAll('canvas')) as HTMLCanvasElement[];
      expect(now.includes(held[0])).toBeFalse();
      expect(link!.terminated).toBeTrue();
      again.destroy();
    });
  });
});
