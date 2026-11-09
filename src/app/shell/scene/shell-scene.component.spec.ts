import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BetaService } from '../../core/beta.service';
import { SCENE_HTML_ATTR, ShellSceneComponent } from './shell-scene.component';
import { SceneCameraService } from './scene-camera.service';
import {
  CameraPose,
  POSES,
  SCENE_FLIGHT_MS,
  SCENE_PUSH_MS,
  WORLD_RECTS,
  doorRects,
  easeInOutCubic,
  framedLikeNews,
  poseAt,
  poseCam,
  poseTransform,
  sceneTargetOf,
  verseCam,
  zoomAbout,
} from './scene.model';

@Component({ standalone: true, template: '' })
class BlankPage {}

const ROUTES = ['verse', 'verse/news', 'verse/explorer', 'hq', 'hq/lager', 'codex', 'codex/ships', 'codex/ships/x', 'admin/hub', 'settings'].map((path) => ({
  path,
  component: BlankPage,
}));

/** Screen position (vw) of world point (wx, wy) under pose p. */
const screen = (p: CameraPose, wx: number, wy: number): [number, number] => [p.s * (wx + p.x), p.s * (wy + p.y)];

describe('Shell scene — model', () => {
  it('maps every URL to its pose and push depth', () => {
    expect(sceneTargetOf('/verse')).toEqual({ pose: 'verse', depth: 0 });
    expect(sceneTargetOf('/verse/news?x=1')).toEqual({ pose: 'news', depth: 0 });
    expect(sceneTargetOf('/verse/news/abc')).toEqual({ pose: 'news', depth: 1 });
    expect(sceneTargetOf('/verse/patches/4.3')).toEqual({ pose: 'patches', depth: 1 });
    expect(sceneTargetOf('/verse/explorer')).toEqual({ pose: 'starmap', depth: 0 });
    expect(sceneTargetOf('/codex#a')).toEqual({ pose: 'codex', depth: 0 });
    expect(sceneTargetOf('/codex/ships')).toEqual({ pose: 'codex-index', depth: 0 });
    expect(sceneTargetOf('/codex/ships/x')).toEqual({ pose: 'codex-index', depth: 1 });
    expect(sceneTargetOf('/hq/')).toEqual({ pose: 'hq', depth: 0 });
    expect(sceneTargetOf('/hq/lager')).toEqual({ pose: 'hq-sub', depth: 0 });
    expect(sceneTargetOf('/admin/hub')).toEqual({ pose: 'admin', depth: 0 });
    expect(sceneTargetOf('/settings')).toEqual({ pose: 'deep', depth: 0 });
  });

  it('takes the camera poses of the mock (rounds/05 d5-*-cam end frames)', () => {
    expect(POSES.verse.cam).toEqual({ s: 1, x: -100, y: -50 });
    expect(POSES.news.cam).toEqual({ s: 7.8571, x: -106.756, y: -81.801 });
    expect(POSES.starmap.cam).toEqual({ s: 3, x: -155.427, y: -70.5 });
    expect(POSES.codex.cam).toEqual({ s: 1, x: -225, y: -37.5 });
    expect(POSES.hq.cam).toEqual({ s: 3.6, x: -162.986, y: -120.313 });
    expect(POSES['hq-sub'].cam.y).toBeLessThan(POSES.hq.cam.y); // below HQ
    expect(POSES.admin.cam.s).toBe(6);
    expect(POSES.hq.veil).toBe(0.38);
  });

  it('frames Patches and Galerie exactly like News: big at the left edge', () => {
    const [nx, ny, nw] = WORLD_RECTS.news;
    const news = screen(POSES.news.cam, nx, ny);
    expect(news[0]).toBeLessThan(0); // cut by the left edge
    for (const w of ['patches', 'gallery'] as const) {
      const [x, y, size] = WORLD_RECTS[w];
      const p = framedLikeNews(WORLD_RECTS[w]);
      const at = screen(p, x, y);
      expect(at[0]).toBeCloseTo(news[0], 3);
      expect(at[1]).toBeCloseTo(news[1], 3);
      expect(p.s * size).toBeCloseTo(POSES.news.cam.s * nw, 3);
    }
  });

  it('isolates the objects per pose (C5): News only its planet, Admin only the station, Sternkarte faint planet without Galerie', () => {
    expect(POSES.news.show).toEqual({ news: 1 });
    expect(POSES.admin.show).toEqual({ station: 1 });
    expect(POSES.starmap.show.planet).toBe(0.3);
    expect(POSES.starmap.show.gallery ?? 0).toBe(0);
    // One planet in one world (G1): the scene's planet stands on /verse, the hub draws none.
    expect(POSES.verse.show.planet).toBe(1);
  });

  it('G1: the verse camera stands the world planet on the hub planet and frames the doors like News', () => {
    const anchors = { planet: [-30, 60, 160, 160] as const, doors: { news: [8, 52, 5, 5] as const } };
    const cam = verseCam(anchors);
    const [px, py, pw] = WORLD_RECTS.planet;
    expect(cam.s * (px + cam.x)).toBeCloseTo(-30, 4);
    expect(cam.s * (py + cam.y)).toBeCloseTo(60, 4);
    expect(cam.s * pw).toBeCloseTo(160, 4);
    const news = doorRects(anchors).news;
    expect(cam.s * (news[0] + cam.x)).toBeCloseTo(8, 4);
    expect(cam.s * (news[1] + cam.y)).toBeCloseTo(52, 4);
    // News frames its (moved) planet exactly where the static pose framed the static one.
    const framed = poseCam('news', anchors);
    const ref = POSES.news.cam;
    expect(framed.s * (news[0] + framed.x)).toBeCloseTo(ref.s * (WORLD_RECTS.news[0] + ref.x), 3);
    expect(framed.s * news[2]).toBeCloseTo(ref.s * WORLD_RECTS.news[2], 3);
    expect(poseCam('codex', anchors)).toEqual(POSES.codex.cam);
  });

  it('poseAt: a straight path — the fixed point stands still, the zoom grows logarithmically, the ends match', () => {
    const a = POSES.verse.cam;
    const b = POSES.news.cam;
    expect(poseAt(a, b, 0)).toEqual(a);
    expect(poseAt(a, b, 1)).toEqual(b);
    const mid = poseAt(a, b, 0.5);
    expect(mid.s).toBeCloseTo(Math.sqrt(a.s * b.s), 6);
    // Fixed point of both poses keeps its screen spot all the way.
    const fx = (b.s * b.x - a.s * a.x) / (a.s - b.s);
    const fy = (b.s * b.y - a.s * a.y) / (a.s - b.s);
    const c = screen(a, fx, fy);
    for (const u of [0.1, 0.3, 0.7, 0.9]) {
      const p = poseAt(a, b, u);
      const at = screen(p, fx, fy);
      expect(at[0]).toBeCloseTo(c[0], 6);
      expect(at[1]).toBeCloseTo(c[1], 6);
    }
    // Every other point moves monotonically towards its end (no direction change).
    const [nx, ny] = WORLD_RECTS.news;
    let last = screen(a, nx, ny)[1];
    const dir = Math.sign(screen(b, nx, ny)[1] - last);
    for (let i = 1; i <= 20; i++) {
      const y = screen(poseAt(a, b, i / 20), nx, ny)[1];
      expect(Math.sign(y - last) === dir || Math.abs(y - last) < 1e-9).toBe(true);
      last = y;
    }
    // Equal zoom: a plain pan.
    expect(poseAt(POSES.verse.cam, POSES.codex.cam, 0.5)).toEqual({ s: 1, x: -162.5, y: -43.75 });
  });

  it('zoomAbout keeps the clicked screen point in place', () => {
    const p = zoomAbout(POSES.codex.cam, 1.12, 30, 20);
    const base = POSES.codex.cam;
    const wx = 30 / base.s - base.x;
    const wy = 20 / base.s - base.y;
    const at = screen(p, wx, wy);
    expect(at[0]).toBeCloseTo(30, 6);
    expect(at[1]).toBeCloseTo(20, 6);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });
});

describe('Shell scene — camera and component', () => {
  let fixture: ComponentFixture<ShellSceneComponent>;
  let router: Router;
  let cam: SceneCameraService;
  const shellOn = signal(true);
  let reduced = false;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const world = (): HTMLElement => el().querySelector('.world') as HTMLElement;
  const scene = (): HTMLElement => el().querySelector('.scene') as HTMLElement;
  const go = async (url: string): Promise<void> => {
    await router.navigateByUrl(url);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    shellOn.set(true);
    reduced = false;
    TestBed.configureTestingModule({
      providers: [provideRouter(ROUTES), { provide: BetaService, useValue: { isEnabled: () => shellOn } }],
    });
    router = TestBed.inject(Router);
    cam = TestBed.inject(SceneCameraService);
    cam.reducedMotion = () => reduced;
    await router.navigateByUrl('/verse');
    fixture = TestBed.createComponent(ShellSceneComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    for (const a of document.getAnimations()) a.cancel();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it('renders nothing with the shell beta off (C9)', () => {
    shellOn.set(false);
    fixture.detectChanges();
    expect(scene()).toBeNull();
    expect(document.documentElement.hasAttribute(SCENE_HTML_ATTR)).toBe(false);
  });

  it('starts still in the pose of the current page and marks <html> for the flight styles', () => {
    expect(world().style.transform).toBe(poseTransform(POSES.verse.cam));
    expect(world().getAnimations()).toEqual([]);
    expect(scene().dataset['pose']).toBe('verse');
    expect(document.documentElement.hasAttribute(SCENE_HTML_ATTR)).toBe(true);
  });

  it('flies 1100 ms between main poses on a straight path, ending in the target pose', async () => {
    await go('/codex');
    const [anim] = world().getAnimations();
    expect(anim).toBeDefined();
    expect(anim.effect!.getTiming().duration).toBe(SCENE_FLIGHT_MS);
    const frames = (anim.effect as KeyframeEffect).getKeyframes();
    expect(frames[0]['transform']).toBe(poseTransform(POSES.verse.cam));
    expect(frames.at(-1)!['transform']).toBe(poseTransform(POSES.codex.cam));
    expect(scene().dataset['pose']).toBe('codex');
    anim.finish();
    await anim.finished;
    await Promise.resolve();
    expect(world().style.transform).toBe(poseTransform(POSES.codex.cam));
  });

  it('retargets mid-flight from the current pose, without a jump (C3)', async () => {
    let t = 0;
    cam.now = () => t;
    await go('/hq');
    t = SCENE_FLIGHT_MS / 2;
    const mid = cam.current();
    await go('/codex');
    const anims = world().getAnimations();
    expect(anims.length).toBe(1);
    const first = String((anims[0].effect as KeyframeEffect).getKeyframes()[0]['transform']);
    const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    nums(first).forEach((n, i) => expect(n).toBeCloseTo(nums(poseTransform(mid))[i], 2));
    expect(mid.s).toBeGreaterThan(POSES.verse.cam.s);
  });

  it('pushes in towards the click for a page below its pose, and pulls out on the way back (C4)', async () => {
    await go('/codex/ships');
    for (const a of world().getAnimations()) a.finish();
    await Promise.resolve();
    document.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    await go('/codex/ships/x');
    const push = world().getAnimations()[0];
    expect(push.effect!.getTiming().duration).toBe(SCENE_PUSH_MS);
    const end = (push.effect as KeyframeEffect).getKeyframes().at(-1)!['transform'] as string;
    expect(end).toContain(`scale(${Math.round(POSES['codex-index'].cam.s * 1.12 * 10000) / 10000})`);
    expect(scene().hasAttribute('data-pushed')).toBe(true);
    await go('/codex/ships');
    const back = (world().getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!['transform'];
    expect(back).toBe(poseTransform(POSES['codex-index'].cam));
    expect(scene().hasAttribute('data-pushed')).toBe(false);
  });

  it('fades the objects a pose does not show over the flight (isolation as custom properties)', async () => {
    await go('/verse/news');
    expect(scene().style.getPropertyValue('--o-news')).toBe('1');
    expect(scene().style.getPropertyValue('--o-planet')).toBe('0');
    expect(scene().style.getPropertyValue('--scene-move')).toBe(`${SCENE_FLIGHT_MS}ms`);
    await go('/verse/explorer');
    expect(scene().style.getPropertyValue('--o-planet')).toBe('0.3');
    expect(scene().style.getPropertyValue('--o-gallery')).toBe('0');
    await go('/hq');
    expect(scene().style.getPropertyValue('--scene-veil')).toBe('0.38');
  });

  it('crossfades in 420 ms instead of flying under reduced motion (C8)', async () => {
    reduced = true;
    const tick = cam.fadeTick();
    await go('/hq');
    expect(world().getAnimations()).toEqual([]);
    expect(world().style.transform).toBe(poseTransform(POSES.hq.cam));
    expect(cam.fadeTick()).toBe(tick + 1);
  });

  it('flyTo is the public API: from a given pose, own duration, resolves when the camera stands', async () => {
    const done = cam.flyTo('verse', { from: 'entrance', durationMs: 50 });
    const [anim] = world().getAnimations();
    expect((anim.effect as KeyframeEffect).getKeyframes()[0]['transform']).toBe(poseTransform(POSES.entrance.cam));
    anim.finish();
    await done;
    expect(cam.flying()).toBe(false);
    expect(world().style.transform).toBe(poseTransform(POSES.verse.cam));
  });

  it('paints the stars as one image (no per-star gradient layers)', () => {
    const near = el().querySelector('.stars.near')!;
    const bg = getComputedStyle(near).backgroundImage;
    expect(bg.startsWith('url(')).toBe(true);
  });
});
