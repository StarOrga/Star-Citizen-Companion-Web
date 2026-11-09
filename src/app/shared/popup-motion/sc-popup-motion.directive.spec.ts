import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  POPUP_MOTION_CLOSE_SHARE,
  POPUP_MOTION_TOTAL,
  SCENE_PUSHIN_CLASS,
  ScPopupMotionDirective,
  popupStarShadow,
} from './sc-popup-motion.directive';

@Component({
  standalone: true,
  imports: [ScPopupMotionDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="small" scPopupMotion="small" scPopupMotionItems=".e" scPopupMotionOrigin="br">
      <a class="e">1</a><a class="e">2</a>
    </div>
    <div class="veil" scPopupMotion="large" scPopupMotionPlate=".win" scPopupMotionFoot=".foot">
      <article class="win">
        <header>head</header>
        <table><tbody>@for (r of rows; track r) { <tr><td>{{ r }}</td></tr> }</tbody></table>
        <footer class="foot">foot</footer>
      </article>
    </div>
  `,
})
class HostComponent {
  readonly rows = Array.from({ length: 30 }, (_, i) => i);
  readonly motions = viewChild.required<ScPopupMotionDirective>(ScPopupMotionDirective);
}

describe('ScPopupMotionDirective', () => {
  function mount() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('small: marks the host, adds limb, beam and ring and numbers the entries', async () => {
    const f = mount();
    await f.whenStable();
    const el = f.nativeElement.querySelector('.small') as HTMLElement;
    expect(el.classList.contains('pm-small')).toBe(true);
    expect(el.classList.contains('pm-in')).toBe(true);
    expect(el.classList.contains('pm-o-br')).toBe(true);
    for (const cls of ['pm-limb', 'pm-beam', 'pm-ring']) expect(el.querySelector(`.${cls}`)).not.toBeNull();
    const items = el.querySelectorAll<HTMLElement>('.e.pm-item');
    expect(items.length).toBe(2);
    expect(items[1].style.getPropertyValue('--pm-i')).toBe('1');
  });

  it('large: builds stars + horizon, lifts the plate, cascades only the first rows, no corner brackets', async () => {
    const f = mount();
    await f.whenStable();
    const veil = f.nativeElement.querySelector('.veil') as HTMLElement;
    expect(veil.querySelector('.pm-stars')).not.toBeNull();
    expect(veil.querySelector('.pm-horizon')).not.toBeNull();
    expect(veil.querySelector('.win')!.classList.contains('pm-plate')).toBe(true);
    expect(veil.querySelector('.win > .pm-edge')).not.toBeNull();
    expect(veil.querySelectorAll('tbody tr.pm-row').length).toBe(16);
    expect(veil.querySelector('.foot')!.classList.contains('pm-foot')).toBe(true);
    expect(veil.querySelector('[class*="corner"], [class*="bracket"], [class*="scan"]')).toBeNull();
  });

  it('exit() plays the open reversed (pm-out) in 60 % of the time and resolves once', async () => {
    vi.useFakeTimers();
    try {
      const f = mount();
      const m = f.componentInstance.motions();
      const el = f.nativeElement.querySelector('.small') as HTMLElement;
      let done = false;
      const p = m.exit().then(() => { done = true; });
      expect(el.classList.contains('pm-out')).toBe(true);
      expect(el.classList.contains('pm-in')).toBe(false);
      await vi.advanceTimersByTimeAsync(POPUP_MOTION_TOTAL.small * POPUP_MOTION_CLOSE_SHARE - 20);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(80);
      await p;
      expect(done).toBe(true);
      expect(m.exit()).toBe(m.exit());
    } finally {
      vi.useRealTimers();
    }
  });

  it('restart() replays the open when the close was interrupted', async () => {
    vi.useFakeTimers();
    try {
      const f = mount();
      const m = f.componentInstance.motions();
      const el = f.nativeElement.querySelector('.small') as HTMLElement;
      void m.exit();
      m.restart();
      expect(el.classList.contains('pm-out')).toBe(false);
      expect(el.classList.contains('pm-in')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles after the open: pm-in is dropped, the layers stay', async () => {
    vi.useFakeTimers();
    try {
      const f = mount();
      const el = f.nativeElement.querySelector('.small') as HTMLElement;
      await vi.advanceTimersByTimeAsync(POPUP_MOTION_TOTAL.small + 200);
      expect(el.classList.contains('pm-in')).toBe(false);
      expect(el.querySelector('.pm-limb')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('large: the scene pushes in while it is open and pulls back out with the close', async () => {
    const root = document.documentElement;
    const f = mount();
    await f.whenStable();
    expect(root.classList.contains(SCENE_PUSHIN_CLASS)).toBe(true);
    const large = f.debugElement
      .queryAll((d) => d.nativeElement?.classList?.contains('veil'))[0]
      .injector.get(ScPopupMotionDirective);
    void large.exit();
    expect(root.classList.contains(SCENE_PUSHIN_CLASS), 'the pull-out starts with the close').toBe(false);
    large.restart();
    expect(root.classList.contains(SCENE_PUSHIN_CLASS)).toBe(true);
    f.destroy();
    expect(root.classList.contains(SCENE_PUSHIN_CLASS)).toBe(false);
  });

  it('popupStarShadow is deterministic', () => {
    expect(popupStarShadow(5)).toBe(popupStarShadow(5));
    expect(popupStarShadow(5).split('),').length + popupStarShadow(5).split(',#').length).toBeGreaterThan(0);
  });
});
