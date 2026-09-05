import { TestBed } from '@angular/core/testing';
import { ConsentService } from './consent.service';

/**
 * ConsentService reads localStorage in a field initializer, so every case must
 * seed storage BEFORE TestBed.inject constructs the service.
 */
function makeService(): ConsentService {
  TestBed.configureTestingModule({ providers: [ConsentService] });
  return TestBed.inject(ConsentService);
}

describe('ConsentService', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('undecided visitor', () => {
    it('is not decided and denies both opt-in categories', () => {
      const svc = makeService();
      expect(svc.decided()).toBe(false);
      expect(svc.preferencesAllowed()).toBe(false);
      expect(svc.statisticsAllowed()).toBe(false);
    });
  });

  describe('acceptAll', () => {
    it('allows preferences and statistics', () => {
      const svc = makeService();
      svc.acceptAll();
      expect(svc.decided()).toBe(true);
      expect(svc.preferencesAllowed()).toBe(true);
      expect(svc.statisticsAllowed()).toBe(true);
    });
  });

  describe('essentialOnly', () => {
    it('denies both categories but counts as a decision', () => {
      const svc = makeService();
      svc.essentialOnly();
      expect(svc.decided()).toBe(true);
      expect(svc.preferencesAllowed()).toBe(false);
      expect(svc.statisticsAllowed()).toBe(false);
    });
  });

  describe('setStatistics', () => {
    it('toggles statistics without touching preferences', () => {
      const svc = makeService();
      svc.acceptAll();
      svc.setStatistics(false);
      expect(svc.statisticsAllowed()).toBe(false);
      expect(svc.preferencesAllowed()).toBe(true);
    });

    it('purges PostHog localStorage keys when declined', () => {
      const svc = makeService();
      localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"abc"}');
      localStorage.setItem('sc.lang', 'de');
      svc.setStatistics(false);
      expect(localStorage.getItem('ph_phc_test_posthog')).toBeNull();
      // essential keys are never touched
      expect(localStorage.getItem('sc.lang')).toBe('de');
    });
  });

  describe('setPreferences', () => {
    it('purges preference keys when declined, leaving statistics consent intact', () => {
      const svc = makeService();
      svc.acceptAll();
      localStorage.setItem('sc-companion.news.favorites', '["a"]');
      svc.setPreferences(false);
      expect(localStorage.getItem('sc-companion.news.favorites')).toBeNull();
      expect(svc.statisticsAllowed()).toBe(true);
    });

    // The 2026-09-04 rethink stopped writing these four; they were never
    // registered, so before #518 a decline left them behind forever.
    it('purges the retired admin-feedback keys when declined', () => {
      const svc = makeService();
      svc.acceptAll();
      const retired = [
        'sc.adminFeedback.view',
        'sc.adminFeedback.handled',
        'sc.adminFeedback.workflowScope',
        'sc.adminFeedback.workflowKind',
      ];
      for (const key of retired) localStorage.setItem(key, 'stale');
      svc.setPreferences(false);
      for (const key of retired) expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe('persistence', () => {
    it('restores a stored decision', () => {
      localStorage.setItem(
        'sc.consent',
        JSON.stringify({ preferences: true, statistics: true, decidedAt: '2026-01-01T00:00:00Z' }),
      );
      const svc = makeService();
      expect(svc.decided()).toBe(true);
      expect(svc.preferencesAllowed()).toBe(true);
      expect(svc.statisticsAllowed()).toBe(true);
    });

    it('treats a pre-#139 decision (no statistics field) as statistics-denied', () => {
      localStorage.setItem(
        'sc.consent',
        JSON.stringify({ preferences: true, decidedAt: '2026-01-01T00:00:00Z' }),
      );
      const svc = makeService();
      expect(svc.decided()).toBe(true);
      expect(svc.preferencesAllowed()).toBe(true);
      expect(svc.statisticsAllowed()).toBe(false);
    });

    it('ignores malformed stored state', () => {
      localStorage.setItem('sc.consent', 'not json');
      const svc = makeService();
      expect(svc.decided()).toBe(false);
    });
  });
});
