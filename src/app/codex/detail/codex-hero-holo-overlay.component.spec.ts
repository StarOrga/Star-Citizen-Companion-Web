import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHeroHoloOverlayComponent } from './codex-hero-holo-overlay.component';
import { AssetPackageService } from '../asset-package/asset-package.service';

@Component({
  standalone: true,
  imports: [CodexHeroHoloOverlayComponent],
  template: `
    <button type="button" class="opener" (click)="open.set(true)">3D</button>
    <div class="pair" style="position: relative; width: 400px; height: 300px">
      @if (open()) {
        <sc-codex-hero-holo-overlay shipClassName="AEGS_Gladius" displayName="Gladius" (closed)="open.set(false)" />
      }
    </div>
    <button type="button" class="beside">beside</button>
  `,
})
class HostComponent {
  readonly open = signal(false);
}

describe('CodexHeroHoloOverlayComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        // The lookup never answers: the overlay holds its placeholder and no WebGL scene starts.
        { provide: AssetPackageService, useValue: { findRow: () => new Promise(() => undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const overlay = () => el.querySelector('sc-codex-hero-holo-overlay') as HTMLElement | null;
    const open = () => {
      (el.querySelector('.opener') as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    return { fixture, el, overlay, open };
  }

  it('opens over its box without a scrim and leaves the page usable', () => {
    const { el, overlay, open } = setup();
    expect(overlay()).toBeNull();
    open();
    const o = overlay()!;
    expect(o).not.toBeNull();
    expect(getComputedStyle(o).position).toBe('absolute');
    const box = (el.querySelector('.pair') as HTMLElement).getBoundingClientRect();
    const r = o.getBoundingClientRect();
    expect(Math.round(r.width)).toBe(Math.round(box.width));
    expect(Math.round(r.height)).toBe(Math.round(box.height));
    // Non-modal: nothing outside is made inert.
    expect((el.querySelector('.beside') as HTMLElement).closest('[inert]')).toBeNull();
    expect(o.querySelector('.hho')!.getAttribute('aria-modal')).toBeNull();
  });

  it('closes on its X', () => {
    const { fixture, overlay, open } = setup();
    open();
    (overlay()!.querySelector('.hho-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(overlay()).toBeNull();
  });

  it('toggles fullscreen, and Escape steps back from fullscreen, then closes', () => {
    const { fixture, overlay, open } = setup();
    open();
    const full = overlay()!.querySelector('.hho-full') as HTMLButtonElement;
    full.click();
    fixture.detectChanges();
    expect(overlay()!.classList.contains('full')).toBe(true);
    expect(getComputedStyle(overlay()!).position).toBe('fixed');
    expect(full.getAttribute('aria-pressed')).toBe('true');

    const section = overlay()!.querySelector('.hho') as HTMLElement;
    section.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(overlay()!.classList.contains('full')).toBe(false);

    section.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(overlay()).toBeNull();
  });
});
