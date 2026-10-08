// Holodeck letter hotkeys (#644), the shared-link banner (#646) and the
// "Einordnung" loading / failure states (holodeck polish) on the real stage.
import { provideNoShipBlueprints } from '../ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloStageComponent, HoloSharedBanner } from './codex-holo-stage.component';
import { CodexDetail, CodexService } from '../codex.service';
import { RoleService } from '../../auth/role.service';
import { ShipCapabilities } from '../codex-mission';
import { isTypeToSearchKey } from '../search/codex-search-hub.service';
import { HOLO_HOTKEYS, holoHotkeyFor, nextHoloView } from './codex-holo-hotkeys';

const CAPS: ShipCapabilities = { hasCargo: false, hasQuantum: true, hasMining: false, hasSalvage: false };

function detail(): CodexDetail {
  return { classNameSlug: 'aegs_gladius', kind: 'ship', row: { role: null }, payload: {} as never, ports: [], strings: [] } as unknown as CodexDetail;
}

async function setup(): Promise<ComponentFixture<CodexHoloStageComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexHoloStageComponent],
    providers: [
      provideNoShipBlueprints(),
      provideRouter([]),
      provideTranslateService({}),
      { provide: CodexService, useValue: { buildsForChannel: () => Promise.resolve({ builds: [], failed: false }), shipDetailForBuild: () => Promise.resolve(null) } },
      { provide: RoleService, useValue: { isCollaborator: () => false } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexHoloStageComponent);
  fixture.componentRef.setInput('detail', detail());
  fixture.componentRef.setInput('displayName', 'Gladius');
  fixture.componentRef.setInput('activeMissionId', 'all');
  fixture.componentRef.setInput('shipCapabilities', CAPS);
  fixture.componentRef.setInput('reducedMotion', true);
  fixture.componentRef.setInput('buildRef', { id: 'b1', patchVersion: '4.3' });
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  return fixture;
}

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe('holo hotkeys (pure)', () => {
  it('maps L / P / V / S and nothing else, case-insensitively', () => {
    expect(HOLO_HOTKEYS).toEqual({ copyLink: 'l', patch: 'p', view: 'v', share: 's' });
    const ev = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, ...init });
    expect(holoHotkeyFor(ev('l'), null)).toBe('copyLink');
    expect(holoHotkeyFor(ev('P'), null)).toBe('patch');
    expect(holoHotkeyFor(ev('v'), null)).toBe('view');
    expect(holoHotkeyFor(ev('s'), null)).toBe('share');
    // Digits stay the pin keys, Esc stays "close", other letters start a search.
    for (const k of ['1', '0', 'Escape', 'g', '3']) expect(holoHotkeyFor(ev(k), null)).toBeNull();
    // No chords: Ctrl+L focuses the address bar, Ctrl+P prints.
    expect(holoHotkeyFor(ev('l', { ctrlKey: true }), null)).toBeNull();
    expect(holoHotkeyFor(ev('p', { metaKey: true }), null)).toBeNull();
    expect(holoHotkeyFor(ev('v', { altKey: true }), null)).toBeNull();
  });

  it('cycles holo → 3D → schema → holo, skipping a view the hull lacks', () => {
    expect(nextHoloView('holo', true, true)).toBe('3d');
    expect(nextHoloView('3d', true, true)).toBe('schema');
    expect(nextHoloView('schema', true, true)).toBe('holo');
    expect(nextHoloView('holo', false, true)).toBe('schema');
    expect(nextHoloView('holo', true, false)).toBe('3d');
    expect(nextHoloView('3d', true, false)).toBe('holo');
    expect(nextHoloView('holo', false, false)).toBe('holo');
  });
});

describe('CodexHoloStageComponent hotkeys (#644)', () => {
  let fixture: ComponentFixture<CodexHoloStageComponent>;
  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.test-dialog, .test-input').forEach((n) => n.remove());
  });

  it('V cycles the table view and claims the key from type-to-search', async () => {
    fixture = await setup();
    const c = fixture.componentInstance;
    c.has3d.set(true);
    let typeToSearch: boolean | null = null;
    // The quick-search listener: a bubbling document listener, registered first.
    const qs = (e: Event) => (typeToSearch = isTypeToSearchKey(e as KeyboardEvent));
    document.addEventListener('keydown', qs);
    try {
      const ev = press('v');
      expect(ev.defaultPrevented).toBeTrue();
      expect(typeToSearch).toBeFalse();
      expect(c.viewMode()).toBe('3d');
      press('v');
      expect(c.viewMode()).toBe('holo'); // no schema for this hull
      // Any other letter still starts the Codex search.
      const g = press('g');
      expect(g.defaultPrevented).toBeFalse();
      expect(typeToSearch).toBeTrue();
    } finally {
      document.removeEventListener('keydown', qs);
    }
  });

  it('S toggles the share popover, P the patch chooser', async () => {
    fixture = await setup();
    const c = fixture.componentInstance;
    press('s');
    fixture.detectChanges();
    expect(c.sharePopoverOpen()).toBeTrue();
    press('s');
    expect(c.sharePopoverOpen()).toBeFalse();

    const patch = fixture.nativeElement.querySelector('sc-codex-holo-patch');
    expect(patch).toBeTruthy();
    press('p');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.patch-pop')).toBeTruthy();
    // The chooser is a role="dialog" INSIDE the stage — its own key still closes it.
    press('p');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.patch-trigger')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('L copies the page address and confirms with a toast; a refused copy says so', async () => {
    fixture = await setup();
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    press('l');
    // Not whenStable(): that would also wait out the toast's hide timer.
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(write).toHaveBeenCalledWith(location.href);
    expect(fixture.componentInstance.copyToast()).toBe('ok');
    expect(fixture.nativeElement.querySelector('.copy-toast')).toBeTruthy();

    write.and.rejectWith(new DOMException('denied', 'NotAllowedError'));
    press('l');
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(fixture.componentInstance.copyToast()).toBe('failed');
    expect(fixture.nativeElement.querySelector('.copy-toast.failed')).toBeTruthy();
  });

  it('ignores every hotkey while a text field has focus', async () => {
    fixture = await setup();
    const c = fixture.componentInstance;
    c.has3d.set(true);
    const input = document.createElement('input');
    input.className = 'test-input';
    document.body.appendChild(input);
    input.focus();
    const ev = press('v', input);
    expect(ev.defaultPrevented).toBeFalse();
    expect(c.viewMode()).toBe('holo');
    press('s', input);
    expect(c.sharePopoverOpen()).toBeFalse();
  });

  it('ignores the keys while a dialog outside the stage is open', async () => {
    fixture = await setup();
    const c = fixture.componentInstance;
    c.has3d.set(true);
    const dialog = document.createElement('div');
    dialog.className = 'test-dialog';
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    press('v');
    expect(c.viewMode()).toBe('holo');
  });

  it('digits keep selecting pins — no letter key collides with them', async () => {
    fixture = await setup();
    const inspect = spyOn(fixture.componentInstance, 'inspectPin');
    press('1');
    // No pins on this hull: the digit is simply not a holodeck letter.
    expect(inspect).not.toHaveBeenCalled();
    expect(holoHotkeyFor(new KeyboardEvent('keydown', { key: '1' }), null)).toBeNull();
  });

  it('shows the key as a <kbd> in each trigger, with aria-keyshortcuts', async () => {
    fixture = await setup();
    fixture.componentInstance.has3d.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const kbds = [...el.querySelectorAll('kbd.hk')].map((k) => k.textContent?.trim());
    expect(kbds).toContain('P');
    expect(kbds).toContain('V');
    expect(kbds).toContain('S');
    expect(el.querySelector('.patch-trigger')?.getAttribute('aria-keyshortcuts')).toBe('P');
  });
});

describe('CodexHoloStageComponent shared-link banner (#646)', () => {
  let fixture: ComponentFixture<CodexHoloStageComponent>;
  afterEach(() => fixture?.destroy());

  function banner(over: Partial<HoloSharedBanner>): HoloSharedBanner {
    return { status: 'ready', ownerName: 'Kestrel', configName: 'Brawler', errorKey: null, ...over };
  }

  it('says who shared it, offers adopt and exit, and passes read-only on', async () => {
    fixture = await setup();
    fixture.componentRef.setInput('sharedBanner', banner({}));
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.shared-banner')?.textContent).toContain('codex.holo.shared.banner');
    let adopted = false;
    let exited = false;
    fixture.componentInstance.adoptShared.subscribe(() => (adopted = true));
    fixture.componentInstance.exitShared.subscribe(() => (exited = true));
    (el.querySelector('.sb-adopt') as HTMLButtonElement).click();
    (el.querySelector('.sb-exit') as HTMLButtonElement).click();
    expect(adopted).toBeTrue();
    expect(exited).toBeTrue();
  });

  it('a failed read shows an error with retry, never the ready banner', async () => {
    fixture = await setup();
    fixture.componentRef.setInput('sharedBanner', banner({ status: 'error', errorKey: 'errors.network' }));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.shared-banner')?.getAttribute('role')).toBe('alert');
    expect(el.querySelector('.sb-adopt')).toBeNull();
    let retried = false;
    fixture.componentInstance.retryShared.subscribe(() => (retried = true));
    (el.querySelector('.sb-retry') as HTMLButtonElement).click();
    expect(retried).toBeTrue();
  });
});

describe('CodexHoloStageComponent Einordnung states', () => {
  let fixture: ComponentFixture<CodexHoloStageComponent>;
  afterEach(() => fixture?.destroy());
  // Karma renders at 749px — the tablet layout starts with both rails folded.
  async function setupOpen(): Promise<ComponentFixture<CodexHoloStageComponent>> {
    const f = await setup();
    f.componentInstance.leftCollapsed.set(false);
    return f;
  }

  it('says it is comparing while the cohort loads — no empty chart box', async () => {
    fixture = await setupOpen();
    fixture.componentRef.setInput('rankLoading', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-state.loading')?.textContent).toContain('codex.holo.stage.rankLoading');
    expect(el.querySelector('sc-codex-rank-card')).toBeNull();
  });

  it('a failed cohort read offers a retry', async () => {
    fixture = await setupOpen();
    fixture.componentRef.setInput('rankFailed', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-state')?.textContent).toContain('codex.holo.stage.rankFailed');
    let retried = false;
    fixture.componentInstance.retryRank.subscribe(() => (retried = true));
    (el.querySelector('.rank-retry') as HTMLButtonElement).click();
    expect(retried).toBeTrue();
  });

  it('a cohort without values is an empty state, not an error', async () => {
    fixture = await setupOpen();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-state')?.textContent).toContain('codex.holo.stage.rankEmpty');
    expect(el.querySelector('.rank-retry')).toBeNull();
  });
});
