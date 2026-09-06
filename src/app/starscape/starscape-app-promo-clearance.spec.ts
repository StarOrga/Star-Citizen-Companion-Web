import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { AdminFeedbackComponent } from '../admin/feedback/admin-feedback.component';
import { RoleService } from '../auth/role.service';
import { FeedbackFabComponent } from '../shell/feedback-fab.component';
import { StarscapeAppPromoComponent } from './starscape-app-promo.component';

@Component({ selector: 'sc-admin-feedback', standalone: true, template: '' })
class AdminFeedbackStub {}

const SESSION_KEY = 'sc.starscapePromo.shown';
const DISMISS_KEY = 'sc.starscapePromo.dismissed';

/** A resolved CSS length, e.g. "92px". */
function px(value: string): number {
  const n = Number.parseFloat(value);
  expect(Number.isFinite(n)).withContext(`"${value}" is a px length`).toBeTrue();
  return n;
}

/**
 * An unregistered custom property is NOT evaluated by the cascade — reading
 * `--sc-fab-lane` would hand back the literal "calc(24px + 56px)". So the test
 * reads the two leaf tokens and does the arithmetic itself; the CSS-side sum is
 * covered by the promo offset, which is a real property and therefore resolved.
 */
function token(name: '--sc-fab-inset' | '--sc-fab-size' | '--sc-fab-gutter'): number {
  return px(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** The strip the launcher occupies, measured from the right viewport edge. */
function lane(): number {
  return token('--sc-fab-inset') + token('--sc-fab-size');
}

/**
 * The Starscape pitch used to land ON the feedback launcher — the 56px disc
 * covered the card's footnote and the card covered the button a user needs
 * exactly when something looks wrong (admin feedback 172ee966).
 *
 * The launcher is the anchor and never moves, so the invariant is one-sided:
 * the promo's right inset must clear the launcher's whole footprint. Both
 * sides read the same `--sc-fab-*` tokens, which is what makes this a real
 * check rather than two copies of the number 24.
 *
 * Karma renders at 749px, i.e. the PHONE branch of the shared tokens
 * (inset 16px). The assertion is therefore written against the tokens, not
 * against literals, so it holds in both branches: the promo clears whatever
 * the lane currently is. The rendered launcher is measured in the same pass to
 * prove the lane still describes the real button.
 */
describe('Starscape promo vs. the feedback launcher', () => {
  let originalWidth: number;

  beforeEach(() => {
    originalWidth = window.innerWidth;
    localStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    localStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  });

  function launcher(): ComponentFixture<FeedbackFabComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FeedbackFabComponent, TranslateModule.forRoot()],
      providers: [{ provide: RoleService, useValue: { isAdmin: signal(true) } }],
    });
    TestBed.overrideComponent(FeedbackFabComponent, {
      remove: { imports: [AdminFeedbackComponent] },
      add: { imports: [AdminFeedbackStub] },
    });
    const fixture = TestBed.createComponent(FeedbackFabComponent);
    fixture.detectChanges();
    return fixture;
  }

  function promo(): ComponentFixture<StarscapeAppPromoComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StarscapeAppPromoComponent, TranslateModule.forRoot()],
    });
    // The pitch refuses to show below 900px; pin a desktop width so the card
    // renders. Its CSS still resolves in Karma's 749px frame — which is the
    // point: the offset must be right in that branch too.
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    const fixture = TestBed.createComponent(StarscapeAppPromoComponent);
    fixture.componentRef.setInput('downloadUrl', 'https://example.test/starscape.exe');
    fixture.componentRef.setInput('wallpapers', ['a.jpg']);
    fixture.detectChanges();
    return fixture;
  }

  it('is the launcher that owns the corner — the lane matches the real button', () => {
    const fixture = launcher();
    const root = fixture.nativeElement.querySelector('.fab-root') as HTMLElement;
    const disc = fixture.nativeElement.querySelector('.fab') as HTMLElement;
    expect(root).not.toBeNull();
    expect(disc).not.toBeNull();

    expect(px(getComputedStyle(root).right)).toBe(token('--sc-fab-inset'));
    expect(disc.getBoundingClientRect().width).toBeCloseTo(token('--sc-fab-size'), 0);

    fixture.destroy();
  });

  it('starts left of the launcher lane, with a gutter', fakeAsync(() => {
    const fixture = promo();
    tick(3000);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.promo') as HTMLElement;
    expect(card).withContext('promo rendered').not.toBeNull();

    const right = px(getComputedStyle(card).right);
    expect(right)
      .withContext('promo must clear the launcher lane, with a gutter')
      .toBeGreaterThanOrEqual(lane() + token('--sc-fab-gutter'));

    fixture.componentInstance.closeForSession();
    fixture.destroy();
  }));
});
