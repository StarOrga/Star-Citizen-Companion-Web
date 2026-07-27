import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StarscapeAppPromoComponent } from './starscape-app-promo.component';

const DISMISS_KEY = 'sc.starscapePromo.dismissed';
const SESSION_KEY = 'sc.starscapePromo.shown';

describe('StarscapeAppPromoComponent', () => {
  let originalWidth: number;

  beforeEach(() => {
    localStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    originalWidth = window.innerWidth;
    // The promo self-hides below the desktop breakpoint; the Karma frame can be
    // narrower than that, so pin a desktop width for the visibility tests.
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    TestBed.configureTestingModule({
      imports: [StarscapeAppPromoComponent, TranslateModule.forRoot()],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    localStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  });

  function setup(): ComponentFixture<StarscapeAppPromoComponent> {
    const f = TestBed.createComponent(StarscapeAppPromoComponent);
    f.componentRef.setInput('downloadUrl', 'https://example.test/starscape.exe');
    f.componentRef.setInput('wallpapers', ['a.jpg', 'b.jpg']);
    f.detectChanges();
    return f;
  }

  it('stays hidden until the 3s delay has passed', fakeAsync(() => {
    const f = setup();
    tick(2000);
    f.detectChanges();
    expect(f.componentInstance.visible()).toBeFalse();

    tick(1000);
    f.detectChanges();
    expect(f.componentInstance.visible()).toBeTrue();
    expect(f.nativeElement.querySelector('.promo')).not.toBeNull();

    f.componentInstance.closeForSession();
    f.destroy();
  }));

  it('shows at most once per browser session', fakeAsync(() => {
    const first = setup();
    tick(3000);
    first.detectChanges();
    expect(first.componentInstance.visible()).toBeTrue();
    first.componentInstance.closeForSession();
    first.destroy();

    const second = setup();
    tick(3000);
    second.detectChanges();
    expect(second.componentInstance.visible()).toBeFalse();
    second.destroy();
  }));

  it('never returns once ✕ was clicked', fakeAsync(() => {
    const f = setup();
    tick(3000);
    f.detectChanges();
    (f.nativeElement.querySelector('.x') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.componentInstance.visible()).toBeFalse();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
    f.destroy();

    // A fresh session must still stay quiet.
    sessionStorage.removeItem(SESSION_KEY);
    const later = setup();
    tick(3000);
    later.detectChanges();
    expect(later.componentInstance.visible()).toBeFalse();
    later.destroy();
  }));

  it('does not pitch a Windows tray app on a narrow viewport', fakeAsync(() => {
    Object.defineProperty(window, 'innerWidth', { value: 720, configurable: true });
    const f = setup();
    tick(3000);
    f.detectChanges();
    expect(f.componentInstance.visible()).toBeFalse();
    f.destroy();
  }));

  it('rotates through at most three wallpapers in the mock desktop', fakeAsync(() => {
    const f = TestBed.createComponent(StarscapeAppPromoComponent);
    f.componentRef.setInput('downloadUrl', 'https://example.test/starscape.exe');
    f.componentRef.setInput('wallpapers', ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    f.detectChanges();
    tick(3000);
    f.detectChanges();

    expect(f.componentInstance.posters().length).toBe(3);
    expect(f.componentInstance.frame()).toBe(0);
    tick(2600);
    expect(f.componentInstance.frame()).toBe(1);

    f.componentInstance.closeForSession();
    f.destroy();
  }));
});
