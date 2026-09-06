import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AdminFeedbackComponent } from '../admin/feedback/admin-feedback.component';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { ConsentBannerComponent } from '../core/consent-banner.component';
import { ConsentService } from '../core/consent.service';
import { UserFeedbackPanelComponent } from '../feedback/user-feedback-panel.component';
import { UserFeedbackService } from '../feedback/user-feedback.service';
import { FeedbackFabComponent } from './feedback-fab.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

@Component({ selector: 'sc-admin-feedback', standalone: true, template: '' })
class AdminFeedbackStub {}
@Component({ selector: 'sc-user-feedback-panel', standalone: true, template: '' })
class UserFeedbackPanelStub {}

/**
 * Every popup in this app is its own `position: fixed; inset: 0` layer with a
 * locally chosen z-index (60–1300). The feedback launcher used to sit at 40,
 * among the page furniture — so an open popup's backdrop covered it and, being
 * a full-viewport box, ate its clicks too: the user could see a broken popup
 * and had no way to report it (admin feedback bb2c82de).
 *
 * These are the two numbers that fix has to keep true forever, in both
 * launchers: above the whole modal band, below the global notice band. Karma
 * renders at 749px, so the launchers' `max-width: 720px` branch is NOT active
 * here — the invariant is asserted on the desktop branch, and the media query
 * deliberately touches only `right` / `bottom` / `gap`, never the layer, so
 * both branches carry the same z-index by construction.
 */
describe('feedback launcher layering', () => {
  /**
   * Known popup layers, each a full-viewport backdrop that used to bury the
   * launcher. Keep in sync with the ladder comment in `feedback-fab.component`.
   */
  const MODAL_BAND = [
    60, // news/patch-dossier
    100, // shell/quick-search
    120, // news lightbox
    140, // codex component modal
    145, // codex weapon detail
    150, // codex swap picker
    1200, // starscape, uploader-access, desktop-download
    1300, // feedback attachments viewer
  ];

  /** Bottom-anchored notices that must keep their own clicks (see below). */
  const NOTICE_BAND = 1500;

  const FAB_LAYER = 1400;

  function adminFab() {
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

  function userFab() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserFeedbackFabComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: RoleService, useValue: { loaded: signal(true), isAdmin: signal(false) } },
        { provide: ImpersonationService, useValue: { activeOrPending: signal(false) } },
        {
          provide: UserFeedbackService,
          useValue: {
            unreadTopics: signal(0),
            loaded: signal(true),
            refresh: () => Promise.resolve(),
            markAllRead: () => Promise.resolve(),
          },
        },
      ],
    });
    TestBed.overrideComponent(UserFeedbackFabComponent, {
      remove: { imports: [UserFeedbackPanelComponent] },
      add: { imports: [UserFeedbackPanelStub] },
    });
    const fixture = TestBed.createComponent(UserFeedbackFabComponent);
    fixture.detectChanges();
    return fixture;
  }

  function layerOf(fixture: { nativeElement: HTMLElement }, selector: string): number {
    const el = fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    expect(el).withContext(`${selector} rendered`).not.toBeNull();
    return Number(getComputedStyle(el as HTMLElement).zIndex);
  }

  for (const [who, build] of [
    ['admin', adminFab],
    ['viewer', userFab],
  ] as const) {
    it(`puts the ${who} launcher above every popup backdrop`, () => {
      const z = layerOf(build(), '.fab-root');

      expect(z).toBe(FAB_LAYER);
      for (const modalZ of MODAL_BAND) {
        expect(z).withContext(`launcher must beat the popup layer ${modalZ}`).toBeGreaterThan(modalZ);
      }
    });
  }

  it('layers both launchers identically — one corner, one rule', () => {
    expect(layerOf(adminFab(), '.fab-root')).toBe(layerOf(userFab(), '.fab-root'));
  });

  it('still yields to the storage-consent bar, which shares its bottom edge', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ConsentBannerComponent, TranslateModule.forRoot()],
      providers: [{ provide: ConsentService, useValue: { decided: signal(false) } }],
    });
    const fixture = TestBed.createComponent(ConsentBannerComponent);
    fixture.detectChanges();

    // The consent bar is bottom-centred and, on a phone, nearly full width —
    // a launcher stacked over it would drop its 56px disc onto these buttons,
    // and an undecided storage question owns the screen. Same reasoning for
    // the update prompt in `AppComponent`, which shares this rung.
    expect(layerOf(fixture, '.consent')).toBe(NOTICE_BAND);
    expect(FAB_LAYER).toBeLessThan(NOTICE_BAND);
  });
});
