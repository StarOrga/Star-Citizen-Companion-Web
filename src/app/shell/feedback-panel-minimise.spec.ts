import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { PanelNavigationService } from '../feedback/panel-navigation.service';
import { UserFeedbackService } from '../feedback/user-feedback.service';
import { FeedbackFabComponent } from './feedback-fab.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

/**
 * #517: on a phone both feedback panels are full-bleed sheets, so a deep link
 * inside them routed the page *behind* the sheet and nothing appeared to
 * happen. The shells minimize themselves when the interior reports an in-app
 * navigation — but only on the phone sheet; docked next to the page there is
 * nothing to get out of the way.
 *
 * Karma renders at 749px, so the real media query would answer "not a phone"
 * for every case here — `matchMedia` is stubbed per test on purpose.
 */
describe('feedback panels — minimize after an in-app deep link', () => {
  const realMatchMedia = globalThis.matchMedia;

  function pretendViewport(isPhone: boolean) {
    (globalThis as { matchMedia: unknown }).matchMedia = ((query: string) =>
      ({ matches: isPhone, media: query, addEventListener() {}, removeEventListener() {} })) as unknown;
  }

  afterEach(() => {
    (globalThis as { matchMedia: unknown }).matchMedia = realMatchMedia;
  });

  describe('admin shell', () => {
    function mount() {
      TestBed.configureTestingModule({
        imports: [FeedbackFabComponent, TranslateModule.forRoot()],
        // isAdmin false keeps the embedded board (and its Supabase deps) out of
        // the DOM; the minimize logic under test lives in the class, not the
        // template.
        providers: [{ provide: RoleService, useValue: { isAdmin: () => false } }],
      });
      const fixture = TestBed.createComponent(FeedbackFabComponent);
      fixture.detectChanges();
      return { fixture, cmp: fixture.componentInstance, nav: TestBed.inject(PanelNavigationService) };
    }

    it('minimizes an open panel on a phone', () => {
      pretendViewport(true);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);
      expect(cmp.isOpen()).toBe(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();

      expect(cmp.minimized()).toBe(true);
      // Minimized, never unmounted — the board keeps its state.
      expect(cmp.mounted()).toBe(true);
    });

    it('leaves the docked panel alone above 720px', () => {
      pretendViewport(false);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();

      expect(cmp.minimized()).toBe(false);
    });

    it('does not reopen a panel the user already minimized', () => {
      pretendViewport(true);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);
      cmp.minimize();

      nav.notifyInAppNavigation();
      fixture.detectChanges();

      expect(cmp.minimized()).toBe(true);
    });

    it('reacts to a second navigation, not just the first', () => {
      pretendViewport(true);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();
      expect(cmp.minimized()).toBe(true);

      // Panel opened again, another delivered topic, another deep link.
      cmp.toggle(new MouseEvent('click'));
      fixture.detectChanges();
      expect(cmp.isOpen()).toBe(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();
      expect(cmp.minimized()).toBe(true);
    });
  });

  describe('viewer shell', () => {
    function mount() {
      TestBed.configureTestingModule({
        imports: [UserFeedbackFabComponent, TranslateModule.forRoot()],
        providers: [
          { provide: AuthService, useValue: { user: signal(null) } },
          { provide: RoleService, useValue: { loaded: () => true, isAdmin: () => false } },
          { provide: ImpersonationService, useValue: { activeOrPending: () => false } },
          {
            provide: UserFeedbackService,
            useValue: {
              loaded: () => true,
              topics: signal([]),
              unreadTopics: signal([]),
              refresh: () => Promise.resolve(),
              markAllRead: () => Promise.resolve(),
            },
          },
        ],
      });
      const fixture = TestBed.createComponent(UserFeedbackFabComponent);
      fixture.detectChanges();
      return { fixture, cmp: fixture.componentInstance, nav: TestBed.inject(PanelNavigationService) };
    }

    it('minimizes an open sheet on a phone', () => {
      pretendViewport(true);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();

      expect(cmp.minimized()).toBe(true);
    });

    it('leaves the docked panel alone above 720px', () => {
      pretendViewport(false);
      const { fixture, cmp, nav } = mount();
      cmp.mounted.set(true);

      nav.notifyInAppNavigation();
      fixture.detectChanges();

      expect(cmp.minimized()).toBe(false);
    });
  });
});
