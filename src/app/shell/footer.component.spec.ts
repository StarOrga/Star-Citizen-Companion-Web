import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { BetaService } from '../core/beta.service';
import { LayoutService } from '../core/layout/layout.service';
import { ReleaseSeenService } from '../release-notes/release-seen.service';
import { FooterComponent } from './footer.component';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('FooterComponent area links', () => {
  function setup(codex: boolean) {
    TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideTranslateService(),
        { provide: BetaService, useValue: { isEnabled: () => () => true, state: () => ({ codex }) } },
        { provide: AuthService, useValue: { user: () => null } },
        { provide: LayoutService, useValue: { layout: () => 'standard' } },
        { provide: ReleaseSeenService, useValue: { unseen: () => false } },
      ],
    });
    const f = TestBed.createComponent(FooterComponent);
    f.detectChanges();
    return f;
  }
  const links = (f: { nativeElement: unknown }) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.sf-areas a'));

  it('renders Verse, Codex and HQ as real anchors in the shell footer', () => {
    const f = setup(true);
    expect(links(f).map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq']);
  });

  it('hides HQ while the codex beta is off', () => {
    expect(links(setup(false)).length).toBe(2);
  });

  it('marks the current area from the router URL', async () => {
    const f = setup(true);
    await TestBed.inject(Router).navigateByUrl('/codex/ships');
    f.detectChanges();
    const current = links(f).filter((a) => a.hasAttribute('aria-current')).map((a) => a.getAttribute('href'));
    expect(current).toEqual(['/codex']);
  });
});

describe('FooterComponent disclaimer bubble', () => {
  function open() {
    TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideTranslateService(),
        { provide: BetaService, useValue: { isEnabled: () => () => true, state: () => ({ codex: true }) } },
        { provide: AuthService, useValue: { user: () => null } },
        { provide: LayoutService, useValue: { layout: () => 'standard' } },
        { provide: ReleaseSeenService, useValue: { unseen: () => false } },
      ],
    });
    const f = TestBed.createComponent(FooterComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.sf-badge-btn')!.click();
    f.detectChanges();
    return { f, el };
  }

  it('closes on Escape inside the bubble', () => {
    const { f, el } = open();
    const bubble = el.querySelector<HTMLElement>('.sf-bubble[role="dialog"]')!;
    expect(bubble).not.toBeNull();
    bubble.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    f.detectChanges();
    expect(el.querySelector('.sf-bubble')).toBeNull();
  });

  it('closes on a press beside it, but not on a press inside the badge', () => {
    const { f, el } = open();
    el.querySelector<HTMLElement>('.sf-bubble')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    f.detectChanges();
    expect(el.querySelector('.sf-bubble')).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    f.detectChanges();
    expect(el.querySelector('.sf-bubble')).toBeNull();
  });
});
