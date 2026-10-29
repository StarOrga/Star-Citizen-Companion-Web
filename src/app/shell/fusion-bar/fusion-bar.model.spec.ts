import { TemplateRef } from '@angular/core';
import { ADMIN_HUB, AREA_ENTRIES, AREA_SECTIONS, HideTracker, REVEAL_UP_PX, activeAreaOf, activeSectionOf, activeSegmentOf, barModeOf, foldTrail, trailOf, isCodexToolPage, isMainHeaderPage } from './fusion-bar.model';
import { ShellChromeService } from './shell-chrome.service';

describe('fusion-bar model', () => {
  it('finds the area sub-page of a URL, exact for an overview, by prefix otherwise', () => {
    const verse = AREA_SECTIONS.verse!;
    const hq = AREA_SECTIONS.hq!;
    expect(activeSectionOf('/verse/news/abc?x=1', verse)).toBe('news');
    expect(activeSectionOf('/verse/gallery#top', verse)).toBe('gallery');
    expect(activeSectionOf('/verse', verse)).toBeNull();
    expect(activeSectionOf('/verse/newsletter', verse)).toBeNull();
    expect(activeSectionOf('/hq', hq)).toBe('overview');
    expect(activeSectionOf('/hq/', hq)).toBe('overview');
    expect(activeSectionOf('/hq/hangar/42', hq)).toBe('hangar');
  });

  it('derives the bar mode from layout + stage search', () => {
    expect(barModeOf('cinematic', 'stage')).toBe('stage');
    expect(barModeOf('cinematic', 'docked')).toBe('docked');
    expect(barModeOf('cinematic', 'none')).toBe('hub');
    expect(barModeOf('tool', 'none')).toBe('tool');
    expect(barModeOf('content', 'stage')).toBe('content');
    expect(barModeOf('overlay', 'none')).toBe('content');
  });

  it('hides after more than one bar height down, reveals after a few px up', () => {
    const t = new HideTracker();
    t.reset(0);
    expect(t.update(50, 64)).toBeFalse(); // inside the first bar height
    expect(t.update(100, 64)).toBeFalse(); // 50px of downward scroll: less than one bar height
    expect(t.update(200, 64)).toBeTrue(); // 150px: more than one bar height
    expect(t.update(200 - (REVEAL_UP_PX - 1), 64)).toBeTrue();
    expect(t.update(200 - REVEAL_UP_PX - 1, 64)).toBeFalse();
  });

  it('maps URLs to areas and Codex segments', () => {
    expect(activeAreaOf('/codex/ship/x', false)).toBe('codex');
    expect(activeAreaOf('/verse/gallery', true)).toBe('starscape');
    expect(activeAreaOf('/verse/gallery', false)).toBe('verse');
    expect(activeAreaOf('/admin/telemetry', false)).toBe('admin');
    expect(activeAreaOf('/admin/hub', false)).toBe('admin');
    expect(activeAreaOf('/admin', false)).toBe('admin');
    expect(activeAreaOf('/settings', false)).toBeNull();
    expect(activeSegmentOf('/codex/index?kind=weapon')).toBe('weapon');
    expect(activeSegmentOf('/codex/index')).toBe('ship');
    expect(activeSegmentOf('/codex/index?kind=item')).toBeNull();
    expect(activeSegmentOf('/codex/fps')).toBe('fps');
    expect(isCodexToolPage('/codex/index?kind=item')).toBeTrue();
    expect(isCodexToolPage('/codex/ship/x')).toBeFalse();
  });
});

describe('ShellChromeService', () => {
  it('keeps the newest crumbs and toolbar and drops them on unregister', () => {
    const s = new ShellChromeService();
    const a = {};
    const b = {};
    const offA = s.publishCrumbs(a, { crumbs: [], title: 'A' });
    const offB = s.publishCrumbs(b, { crumbs: [], title: 'B' });
    expect(s.crumbs()?.title).toBe('B');
    offB();
    expect(s.crumbs()?.title).toBe('A');
    offA();
    expect(s.crumbs()).toBeNull();

    const tpl = {} as TemplateRef<unknown>;
    const off = s.registerToolbar(tpl);
    expect(s.toolbar()).toBe(tpl);
    off();
    expect(s.toolbar()).toBeNull();
  });

  it('tracks the stage search state', () => {
    const s = new ShellChromeService();
    expect(s.stageSearch()).toBe('none');
    s.setStageSearch('docked');
    expect(s.stageSearch()).toBe('docked');
  });

  it('paints the condense progress on its targets and lands "full" only at 1', () => {
    const s = new ShellChromeService();
    const el = document.createElement('div');
    const off = s.registerDockTarget(el);
    expect(s.dockProgress).toBeNull();
    s.setDockProgress(0.4);
    expect(el.style.getPropertyValue('--sc-dock-p')).toBe('0.4');
    expect(s.dockFull()).toBeFalse();
    s.setDockProgress(7);
    expect(el.style.getPropertyValue('--sc-dock-p')).toBe('1');
    expect(s.dockFull()).toBeTrue();
    s.setDockProgress(0.9);
    expect(s.dockFull()).toBeFalse();
    off();
    s.setDockProgress(0);
    expect(el.style.getPropertyValue('--sc-dock-p')).toBe('0.9');
  });

  it('publishes the hub intro (scale + first-visit flag) until it ends', () => {
    const s = new ShellChromeService();
    expect(s.heroIntro()).toBeNull();
    s.startHeroIntro(1, true);
    expect(s.heroIntro()).toEqual({ k: 1, full: true });
    s.endHeroIntro();
    expect(s.heroIntro()).toBeNull();
  });

  it('a page that is not a main page condenses the header at once (the first value never glides)', () => {
    const s = new ShellChromeService();
    const el = document.createElement('div');
    s.registerDockTarget(el);
    s.setStageSearch('none');
    expect(s.dockProgress).toBe(1);
    expect(s.dockFull()).toBeTrue();
    expect(el.hasAttribute('data-ease')).toBeFalse();
    // Arriving on a main page expands it again, eased.
    s.setStageSearch('stage');
    expect(s.dockProgress).toBe(0);
    expect(el.hasAttribute('data-ease')).toBeTrue();
  });

  it('merges Benutzer and Telemetrie into one admin entry that links to the hub', () => {
    const elevated = AREA_ENTRIES.filter((a) => a.elevated);
    expect(elevated.map((a) => a.id)).toEqual(['admin']);
    expect(elevated[0].link).toBe(ADMIN_HUB);
    expect(elevated[0].labelKey).toBe('nav.adminMenu');
  });

  it('knows the main pages the cinematic header stands on', () => {
    for (const url of ['/verse', '/codex', '/hq', '/admin/hub', '/verse?x=1', '/codex/']) {
      expect(isMainHeaderPage(url)).withContext(url).toBeTrue();
    }
    for (const url of ['/verse/news', '/codex/index', '/admin', '/admin/telemetry', '/settings']) {
      expect(isMainHeaderPage(url)).withContext(url).toBeFalse();
    }
  });

  it('brandcrumb: the area root leads the path, a long path folds its middle', () => {
    const codex = AREA_ENTRIES.find((a) => a.id === 'codex')!;
    expect(trailOf(null, null, codex)).toEqual([{ labelKey: 'nav.codex', link: null }]);
    const t = trailOf([{ label: 'Schiffe', link: '/codex/index' }], 'Avenger', codex);
    expect(t.map((p) => p.label ?? p.labelKey)).toEqual(['nav.codex', 'Schiffe', 'Avenger']);
    expect(t[0].link).toBe('/codex');
    // No second area entry when the crumbs already start at the root.
    expect(trailOf([{ labelKey: 'nav.codex', link: '/codex' }], 'X', codex).length).toBe(2);
    const long = [1, 2, 3, 4, 5].map((n) => ({ label: `p${n}`, link: `/p${n}` }));
    expect(foldTrail(long).map((p) => (p.fold ? '…' : p.label))).toEqual(['p1', '…', 'p5']);
    expect(foldTrail(long.slice(0, 3)).length).toBe(3);
  });
});
