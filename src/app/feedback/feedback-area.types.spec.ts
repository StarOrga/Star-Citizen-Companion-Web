import {
  FEEDBACK_AREAS,
  areaForUrl,
  areaRoute,
  asFeedbackArea,
  feedbackAreaLabelKey,
  isFeedbackArea,
  splitViewMarker,
  viewForUrl,
  withViewMarker,
} from './feedback-area.types';
import { topicTitle } from '../admin/feedback/feedback.types';

/**
 * The auto-detection is the whole feature (admin feedback 835fec58): if it
 * guesses wrong, the tag is worse than no tag, because the reader trusts it.
 * These lock the mapping down — including the two groupings that are NOT
 * one-to-one with the router, which is exactly where a later refactor would
 * quietly change behaviour.
 */
describe('areaForUrl', () => {
  it('maps every top-level section to its own area', () => {
    expect(areaForUrl('/news')).toBe('news');
    expect(areaForUrl('/codex')).toBe('codex');
    expect(areaForUrl('/hangar')).toBe('hangar');
    expect(areaForUrl('/starscape')).toBe('starscape');
    expect(areaForUrl('/settings')).toBe('settings');
    expect(areaForUrl('/admin')).toBe('admin');
  });

  it('keeps a sub-route with its section, however deep', () => {
    expect(areaForUrl('/codex/blueprint/AEGS_Gladius')).toBe('codex');
    expect(areaForUrl('/codex/keybinds')).toBe('codex');
    expect(areaForUrl('/news/patches')).toBe('news');
    expect(areaForUrl('/verse/patches/4.3')).toBe('news');
    expect(areaForUrl('/verse/gallery?image=x')).toBe('starscape');
    expect(areaForUrl('/hangar/ship/42')).toBe('hangar');
    expect(areaForUrl('/admin/telemetry')).toBe('admin');
  });

  it('folds every app-outside-the-website route into one area', () => {
    expect(areaForUrl('/download')).toBe('desktop');
    expect(areaForUrl('/uploader')).toBe('desktop');
    expect(areaForUrl('/p4k')).toBe('desktop');
    expect(areaForUrl('/desktop/connect')).toBe('desktop');
  });

  it('ignores query strings and fragments', () => {
    expect(areaForUrl('/codex/index?q=gladius')).toBe('codex');
    expect(areaForUrl('/settings#input')).toBe('settings');
    expect(areaForUrl('/news?tab=all#top')).toBe('news');
  });

  it('is honest about everything it does not know', () => {
    // An unmapped page must not be filed under the nearest-looking section.
    expect(areaForUrl('/about')).toBe('other');
    expect(areaForUrl('/legal/privacy')).toBe('other');
    expect(areaForUrl('/release-notes')).toBe('other');
    expect(areaForUrl('/tools/extension')).toBe('other');
    expect(areaForUrl('/')).toBe('other');
    expect(areaForUrl('')).toBe('other');
  });
});

describe('feedback area narrowing', () => {
  it('accepts exactly the published vocabulary', () => {
    for (const area of FEEDBACK_AREAS) expect(isFeedbackArea(area)).toBeTrue();
  });

  it('rejects anything else, so an unknown column renders as nothing', () => {
    // The null case is every topic filed before the tag existed.
    expect(asFeedbackArea(null)).toBeNull();
    expect(asFeedbackArea(undefined)).toBeNull();
    expect(asFeedbackArea('')).toBeNull();
    expect(asFeedbackArea('Codex')).toBeNull();
    expect(asFeedbackArea('verse')).toBeNull();
    expect(asFeedbackArea(7)).toBeNull();
  });

  it('derives a label key per area', () => {
    expect(feedbackAreaLabelKey('codex')).toBe('feedbackArea.codex');
  });
});

describe('areaRoute (the "▸ Ansehen" deep link)', () => {
  it('sends every real section to its root', () => {
    expect(areaRoute('news')).toBe('/news');
    expect(areaRoute('codex')).toBe('/codex');
    expect(areaRoute('hangar')).toBe('/hangar');
    expect(areaRoute('starscape')).toBe('/starscape');
    expect(areaRoute('desktop')).toBe('/download');
    expect(areaRoute('settings')).toBe('/settings');
    expect(areaRoute('admin')).toBe('/admin');
  });

  it('draws no link for "other" or an untagged topic', () => {
    expect(areaRoute('other')).toBeNull();
    expect(areaRoute(null)).toBeNull();
    expect(areaRoute(undefined)).toBeNull();
  });

  it('round-trips with areaForUrl for every routable area', () => {
    for (const area of FEEDBACK_AREAS) {
      const route = areaRoute(area);
      if (route) expect(areaForUrl(route)).toBe(area);
    }
  });
});

describe('Codex view (admin feedback #241)', () => {
  it('reads the Holotable as the default of a ship page', () => {
    expect(viewForUrl('/codex/ship/aegs_gladius')).toBe('holo');
    expect(viewForUrl('/codex/ship/aegs_gladius?view=holo')).toBe('holo');
    expect(viewForUrl('/codex/ship/aegs_gladius?shared=abc#x')).toBe('holo');
  });

  it('reads ?view=classic as the classic view', () => {
    expect(viewForUrl('/codex/ship/aegs_gladius?view=classic')).toBe('classic');
    expect(viewForUrl('/codex/ship/aegs_gladius?config=1&view=classic')).toBe('classic');
  });

  it('has no view anywhere but a ship detail page', () => {
    expect(viewForUrl('/codex')).toBeNull();
    expect(viewForUrl('/codex/index?kind=ship&view=classic')).toBeNull();
    expect(viewForUrl('/codex/ship')).toBeNull();
    expect(viewForUrl('/codex/weapon/klwe_gun?view=classic')).toBeNull();
    expect(viewForUrl('/hq/hangar')).toBeNull();
    expect(viewForUrl('')).toBeNull();
  });

  it('round-trips the view through the body trailer', () => {
    const stored = withViewMarker('Die Tabelle ist zu eng', 'holo');
    expect(stored).toBe('Die Tabelle ist zu eng

[sc-view:holo]');
    expect(splitViewMarker(stored)).toEqual({ body: 'Die Tabelle ist zu eng', view: 'holo' });
  });

  it('leaves a body without a view untouched', () => {
    expect(withViewMarker('Text', null)).toBe('Text');
    expect(withViewMarker('Text', undefined)).toBe('Text');
    expect(splitViewMarker('Text')).toEqual({ body: 'Text', view: null });
    expect(splitViewMarker(null)).toEqual({ body: '', view: null });
  });

  it('ignores an unknown or mid-text marker', () => {
    expect(splitViewMarker('a

[sc-view:space]').view).toBeNull();
    expect(splitViewMarker('[sc-view:holo] then more text').view).toBeNull();
  });

  it('keeps the trailer out of a derived card title', () => {
    expect(topicTitle(withViewMarker('Holotisch zu dunkel', 'holo'))).toBe('Holotisch zu dunkel');
  });
});

