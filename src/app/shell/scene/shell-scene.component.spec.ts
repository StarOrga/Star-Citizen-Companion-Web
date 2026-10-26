import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { ShellSceneComponent } from './shell-scene.component';
import { SceneKind, isMainPage, sceneOf, sceneStep } from './scene.model';

@Component({ standalone: true, template: '' })
class BlankPage {}

const ROUTES = ['verse', 'verse/news', 'hq', 'hq/hangar', 'codex', 'codex/ships/x', 'settings'].map((path) => ({ path, component: BlankPage }));

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
    const scenes: SceneKind[] = ['verse', 'hq', 'codex'];
    for (const from of scenes) {
      for (const to of scenes) {
        const step = sceneStep(from, `/${to}`, false);
        if (from === to) expect(step).withContext(`${from}→${to}`).toBeNull();
        else expect(step).withContext(`${from}→${to}`).toEqual({ scene: to, mode: 'move' });
      }
    }
    expect(sceneStep('verse', '/hq/hangar', false)).toEqual({ scene: 'hq', mode: 'still' });
    expect(sceneStep('hq', '/hq/hangar', false)).toBeNull();
    expect(sceneStep('hq', '/codex', true)).toEqual({ scene: 'codex', mode: 'fade' });
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

  it('opens the hangar doors after the descent', async () => {
    await go('/hq');
    const door = fixture.nativeElement.querySelector('.door.l') as HTMLElement;
    const t = door.getAnimations().find((a) => (a as CSSTransition).transitionProperty === 'transform');
    expect(t).withContext('door transition').toBeTruthy();
    expect(Number(t!.effect!.getTiming().delay)).toBeGreaterThan(0);
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
