import { TemplateRef } from '@angular/core';
import { HideTracker, REVEAL_UP_PX, activeAreaOf, activeSegmentOf, barModeOf, isCodexToolPage } from './fusion-bar.model';
import { ShellChromeService } from './shell-chrome.service';

describe('fusion-bar model', () => {
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
    expect(activeAreaOf('/admin/telemetry', false)).toBe('telemetry');
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
});
