import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { ShellSceneComponent } from './shell-scene.component';
import { POSES, SCENES, SceneKind, flightMs, isMainPage, sceneOf, sceneStep } from './scene.model';

@Component({ standalone: true, template: '' })
class BlankPage {}

const ROUTES = ['verse', 'verse/news', 'hq', 'hq/hangar', 'codex', 'codex/ships/x', 'admin/hub', 'settings'].map((path) => ({ path, component: BlankPage }));

describe('Shell scene — model', () => {
  it('maps every URL to its main area, the open sky outside the three', () => {
    expect(sceneOf('/verse')).toBe('verse');
    expect(sceneOf('/verse/patches/4.3?x=1')).toBe('verse');
    expect(sceneOf('/hq/hangar')).toBe('hq');
    expect(sceneOf('/codex/ships/x#a')).toBe('codex');
    expect(sceneOf('/settings')).toBe('verse');
    expect(isMainPage('/hq/')).toBeTrue();
    expect(isMainPage('/codex?q=a')).toBeTrue();
    expect(isMainPage('/codex/index')).toBeFalse();
  });

  it('moves the camera on all six directed main-page routes, cuts for sub-pages, dissolves under reduced motion', () => {
    const scenes: SceneKind[] = ['verse', 'hq', 'codex', 'admin'];
    const target = { verse: '/verse', hq: '/hq', codex: '/codex', admin: '/admin/hub' };
    for (const from of scenes) {
      for (const to of scenes) {
        const step = sceneStep(from, target[to], false);
        if (from === to) expect(step).withContext(`${from}→${to}`).toBeNull();
        else expect(step).withContext(`${from}→${to}`).toEqual({ scene: to, mode: 'move' });
      }
    }
    expect(sceneStep('verse', '/hq/hangar', false)).toEqual({ scene: 'hq', mode: 'still' });
    expect(sceneStep('hq', '/hq/hangar', false)).toBeNull();
    expect(sceneStep('hq', '/codex', true)).toEqual({ scene: 'codex', mode: 'fade' });
  });
});

describe('Shell scene — poses and flights', () => {
  it('defines a pose per area: Verse neutral, Codex small and panned, HQ deep zoom with surface detail, admin dimmed', () => {
    expect(SCENES.length).toBe(4);
    expect(POSES.verse.planet).toBe('none');
    expect(POSES.verse.detail).toBe(0);
    expect(POSES.codex.planet).toBe('translate(10%, 8%) scale(0.62)');
    expect(POSES.hq.planet).toContain('scale(3.4)');
    expect(POSES.hq.detail).toBe(1);
    expect(POSES.codex.detail).toBe(0);
    expect(POSES.admin.dim).toBeGreaterThan(0);
  });

  it('flight time: 0.9 s + distance, symmetric, capped at 1.6 s', () => {
    expect(flightMs('verse', 'verse')).toBe(0);
    expect(flightMs('verse', 'codex')).toBeCloseTo(1100, -2);
    expect(flightMs('verse', 'hq')).toBeCloseTo(1400, -2);
    expect(flightMs('codex', 'hq')).toBeCloseTo(1500, -2);
    for (const a of SCENES) {
      for (const b of SCENES) {
        if (a === b) continue;
        expect(flightMs(a, b)).withContext(`${a}→${b}`).toBe(flightMs(b, a));
        expect(flightMs(a, b)).toBeGreaterThanOrEqual(900);
        expect(flightMs(a, b)).toBeLessThanOrEqual(1600);
      }
    }
  });
});

describe('Shell scene — component', () => {
  let fixture: ComponentFixture<ShellSceneComponent>;
  let router: Router;
  const shellOn = signal(true);

  const scene = (): HTMLElement => fixture.nativeElement.querySelector('.scene') as HTMLElement;
  const planet = (): HTMLElement => fixture.nativeElement.querySelector('.planet') as HTMLElement;
  const go = async (url: string): Promise<void> => {
    await router.navigateByUrl(url);
    fixture.detectChanges();
  };
  /** Running CSS transitions on transform — the camera really moving. */
  const moving = (el: HTMLElement): boolean =>
    el.getAnimations().some((a) => (a as CSSTransition).transitionProperty === 'transform');

  beforeEach(async () => {
    shellOn.set(true);
    TestBed.configureTestingModule({
      providers: [provideRouter(ROUTES), { provide: BetaService, useValue: { isEnabled: () => shellOn } }],
    });
    router = TestBed.inject(Router);
    await router.navigateByUrl('/verse');
    fixture = TestBed.createComponent(ShellSceneComponent);
    fixture.detectChanges();
    // Flush the first pose so later changes start from it.
    void getComputedStyle(planet()).transform;
  });

  afterEach(() => {
    for (const a of document.getAnimations()) a.cancel();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('renders nothing with the shell beta off', () => {
    shellOn.set(false);
    fixture.detectChanges();
    expect(scene()).toBeNull();
  });

  it('starts still in the pose of the current page, the planet following the hub', () => {
    expect(scene().dataset['scene']).toBe('verse');
    expect(scene().dataset['mode']).toBe('still');
    expect(scene().hasAttribute('data-home')).toBeTrue();
    expect(moving(planet())).toBeFalse();
  });

  it('plays a real camera transition for every directed route between the main pages (incl. HQ <-> Codex)', async () => {
    const order: [string, SceneKind][] = [['/hq', 'hq'], ['/codex', 'codex'], ['/hq', 'hq'], ['/verse', 'verse'], ['/codex', 'codex'], ['/verse', 'verse']];
    let from: SceneKind = 'verse';
    for (const [url, to] of order) {
      await go(url);
      expect(scene().dataset['scene']).withContext(`${from}→${to}`).toBe(to);
      expect(scene().dataset['mode']).withContext(`${from}→${to}`).toBe('move');
      expect(scene().dataset['from']).withContext(`${from}→${to}`).toBe(from);
      expect(moving(planet())).withContext(`${from}→${to} transition`).toBeTrue();
      for (const a of document.getAnimations()) if (a instanceof CSSTransition) a.finish();
      from = to;
    }
  });

  it('sets the flight length from the pose distance and fades the surface detail in only at HQ', async () => {
    await go('/hq');
    expect(scene().style.getPropertyValue('--scene-move')).toBe(`${flightMs('verse', 'hq')}ms`);
    const detail = fixture.nativeElement.querySelector('.detail') as HTMLElement;
    expect(detail.getAnimations().some((a) => (a as CSSTransition).transitionProperty === 'opacity')).toBeTrue();
  });

  it('an interrupted flight re-targets from the current position without a jump', async () => {
    await go('/hq');
    for (const a of planet().getAnimations()) if (a instanceof CSSTransition) a.currentTime = 600;
    const mid = getComputedStyle(planet()).transform;
    expect(mid).not.toBe('none');
    await go('/codex');
    expect(getComputedStyle(planet()).transform).toBe(mid);
    expect(moving(planet())).toBeTrue();
  });

  it('cuts without motion when the target is a sub-page, and stays static inside an area', async () => {
    await go('/codex/ships/x');
    expect(scene().dataset['scene']).toBe('codex');
    expect(scene().dataset['mode']).toBe('still');
    expect(moving(planet())).toBeFalse();
    await go('/codex');
    expect(scene().dataset['mode']).toBe('still');
    expect(moving(planet())).toBeFalse();
    await go('/verse/news');
    expect(scene().dataset['scene']).toBe('verse');
    expect(scene().hasAttribute('data-home')).toBeFalse();
    expect(moving(planet())).toBeFalse();
  });

  it('dissolves instead of moving under reduced motion', async () => {
    fixture.componentInstance.reducedMotion = () => true;
    await go('/hq');
    expect(scene().dataset['mode']).toBe('fade');
    expect(moving(planet())).toBeFalse();
    const names = scene().getAnimations().map((a) => (a as CSSAnimation).animationName);
    expect(names.some((n) => n.includes('fade-'))).toBeTrue();
    const tick = scene().dataset['fade'];
    await go('/codex');
    expect(scene().dataset['fade']).not.toBe(tick);
  });
});
