import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { setNumberLocale } from '../../codex/codex-format';
import { ItemPathService, stepsOf } from '../../hq/data/item-path.service';
import { ScConfirmService } from '../dialog/sc-confirm.service';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { ItemPathComponent, ItemPathLevel, nextStepOf } from './item-path.component';
import { FakeItemPath, fakeItemPath, fakeSignIn, pathState } from './item-path.testing';
import { SignInAskService } from './sign-in-ask.service';
import type { ItemPathState, PathStep } from '../../hq/data/item-path.service';

interface Opts {
  kind?: string;
  level?: ItemPathLevel;
  nextStep?: PathStep | null;
  state?: Partial<ItemPathState>;
  signedIn?: boolean;
  lang?: string;
}

function setup(o: Opts = {}) {
  const path: FakeItemPath = fakeItemPath(o.state);
  const signIn = fakeSignIn(o.signedIn ?? true);
  const confirm = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
  TestBed.configureTestingModule({
    imports: [ItemPathComponent],
    providers: [
      provideRouter([]),
      provideTranslateService(),
      { provide: ItemPathService, useValue: path },
      { provide: SignInAskService, useValue: signIn },
      { provide: ScConfirmService, useValue: confirm },
    ],
  });
  if (o.lang) TestBed.inject(TranslateService).use(o.lang);
  const fixture = TestBed.createComponent(ItemPathComponent);
  fixture.componentRef.setInput('kind', o.kind ?? 'item');
  fixture.componentRef.setInput('className', 'cls');
  fixture.componentRef.setInput('name', 'Helm');
  fixture.componentRef.setInput('level', o.level ?? 'tertiary');
  if (o.nextStep !== undefined) fixture.componentRef.setInput('nextStep', o.nextStep);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const node = (step: PathStep) => el.querySelector<HTMLButtonElement>(`.node[data-step="${step}"]`)!;
  const settle = async () => {
    // Not whenStable: the undo toast holds a 6 s window open in the zone.
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  const click = async (b: HTMLElement) => {
    b.click();
    await settle();
  };
  const popover = () => document.querySelector<HTMLElement>('.cdk-overlay-container .rp');
  return { fixture, el, node, click, settle, popover, path, signIn, confirm, toast: TestBed.inject(UndoToastService) };
}

describe('ItemPathComponent: a mission step (A9)', () => {
  afterEach(() => {
    TestBed.inject(UndoToastService).flush();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  const withMission = (o: Opts = {}) => {
    const t = setup({ kind: 'blueprint', ...o });
    t.fixture.componentRef.setInput('stepKind', 'mission');
    t.fixture.componentRef.setInput('missionLink', ['/codex', 'mission', 'contract_Best']);
    t.fixture.detectChanges();
    return t;
  };

  it('the empty node writes the line as a mission step', async () => {
    const t = withMission();
    await t.click(t.node('nachschub'));
    expect(t.path.addToNachschub).toHaveBeenCalledWith('blueprint', 'cls', 'Helm', 1, { stepKind: 'mission' });
  });

  it('the Nachschub popover offers the mission as a real anchor', async () => {
    const t = withMission({ state: { nachschubQty: 2 } });
    await t.click(t.node('nachschub'));
    t.fixture.detectChanges();
    const a = t.popover()!.querySelector<HTMLAnchorElement>('a.to-mission')!;
    expect(a.getAttribute('href')).toBe('/codex/mission/contract_Best');
  });

  it('without a mission the popover stays as it was', async () => {
    const t = setup({ kind: 'blueprint', state: { nachschubQty: 2 } });
    await t.click(t.node('nachschub'));
    t.fixture.detectChanges();
    expect(t.popover()!.querySelector('a.to-mission')).toBeNull();
  });

  it('ensureNachschubStep adds once and never asks to sign in', async () => {
    const t = withMission();
    await t.fixture.componentInstance.ensureNachschubStep();
    expect(t.path.addToNachschub).toHaveBeenCalledTimes(1);
    expect(t.signIn.ensure).not.toHaveBeenCalled();
  });

  it('ensureNachschubStep leaves a filled stop alone', async () => {
    const t = withMission({ state: { nachschubQty: 1 } });
    await t.fixture.componentInstance.ensureNachschubStep();
    expect(t.path.addToNachschub).not.toHaveBeenCalled();
  });

  it('ensureNachschubStep leaves a signed-out reader alone', async () => {
    const t = withMission({ state: { signedIn: false } });
    await t.fixture.componentInstance.ensureNachschubStep();
    expect(t.path.addToNachschub).not.toHaveBeenCalled();
    expect(t.signIn.ensure).not.toHaveBeenCalled();
  });
});

describe('ItemPathComponent', () => {
  afterEach(() => {
    TestBed.inject(UndoToastService).flush();
    document.querySelectorAll('.cdk-overlay-container .rp').forEach((e) => e.remove());
  });

  describe('rail', () => {
    it('items run wish, Nachschub, Inventar; ships end in the Hangar (C4)', () => {
      const a = setup();
      expect([...a.el.querySelectorAll<HTMLElement>('.node')].map((n) => n.dataset['step'])).toEqual(['wish', 'nachschub', 'inventar']);
      TestBed.resetTestingModule();
      const b = setup({ kind: 'ship' });
      expect([...b.el.querySelectorAll<HTMLElement>('.node')].map((n) => n.dataset['step'])).toEqual(['wish', 'nachschub', 'hangar']);
    });

    it('count bullets on Nachschub and Inventar, none on an empty stop', () => {
      const { node } = setup({ state: { nachschubQty: 2, inventarQty: 1, places: [{ location: 'Area 18', qty: 1 }] } });
      expect(node('nachschub').querySelector('.n')!.textContent).toBe('2');
      expect(node('inventar').querySelector('.n')!.textContent).toBe('1');
      expect(node('wish').querySelector('.n')).toBeNull();
    });

    it('an SCU amount shows exact in the bullet and in the Nachschub popover (0,36 SCU),', async () => {
      try {
        setNumberLocale('de-DE');
        const { node, click, path, popover } = setup({ state: { nachschubQty: 0.36, nachschubUnit: 'scu' } });
        expect(node('nachschub').querySelector('.n')!.textContent).toBe('0,36');
        await click(node('nachschub'));
        const pop = popover()!;
        expect(pop.querySelector('.rp-q')!.textContent).toContain('0,36 SCU');
        expect(pop.querySelector('.st b')!.textContent).toContain('0,36 SCU');
        expect(path.moveToInventar).not.toHaveBeenCalled();
      } finally {
        setNumberLocale(null);
      }
    });

    it('the last filled stop is current and the links up to it light up', () => {
      const { el, node } = setup({ state: { nachschubQty: 2 } });
      expect(node('nachschub').classList).toContain('cur');
      expect(node('wish').classList).not.toContain('on');
      expect([...el.querySelectorAll('.link')].map((l) => l.classList.contains('on'))).toEqual([true, false]);
    });

    it('every node has a tooltip name and no native title; no column header', () => {
      const { el } = setup();
      for (const n of el.querySelectorAll('.node')) {
        expect(n.getAttribute('aria-label')).toContain('itemPath.node.');
        expect(n.hasAttribute('title')).toBeFalse();
      }
      expect(el.querySelector('th, .head')).toBeNull();
    });
  });

  describe('node click', () => {
    it('empty wish adds and offers undo through the toast', async () => {
      const { node, click, path, popover, toast } = setup();
      await click(node('wish'));
      expect(path.addWish).toHaveBeenCalledWith('item', 'cls', 'Helm');
      expect(popover()).toBeNull();
      expect(toast.current()?.messageKey).toBe('itemPath.done.wishOn');
    });

    it('undo in the toast runs the undo of the result', async () => {
      const undo = jasmine.createSpy('undo').and.resolveTo({ ok: true, key: 'itemPath.done.undone' });
      const { node, click, path, toast } = setup();
      path.addWish.and.resolveTo({ ok: true, key: 'itemPath.done.wishOn', undo });
      await click(node('wish'));
      toast.undo();
      expect(undo).toHaveBeenCalled();
    });

    it('empty Nachschub adds one', async () => {
      const { node, click, path } = setup();
      await click(node('nachschub'));
      expect(path.addToNachschub).toHaveBeenCalledWith('item', 'cls', 'Helm', 1);
    });

    it('a filled node opens the popover instead of writing, a second click closes it', async () => {
      const { node, click, path, popover } = setup({ state: { nachschubQty: 2 } });
      await click(node('nachschub'));
      expect(path.addToNachschub).not.toHaveBeenCalled();
      expect(popover()).not.toBeNull();
      expect(node('nachschub').getAttribute('aria-expanded')).toBe('true');
      await click(node('nachschub'));
      expect(popover()).toBeNull();
    });

    it('Nachschub popover: state, -/+, a real anchor, Entfernen (C2, C3)', async () => {
      const { node, click, path, popover } = setup({ state: { nachschubQty: 2 } });
      await click(node('nachschub'));
      const pop = popover()!;
      expect(pop.getAttribute('role')).toBe('dialog');
      expect(pop.querySelector('.rp-q')!.textContent).toContain('2');
      const anchor = pop.querySelector<HTMLAnchorElement>('a.alink')!;
      expect(anchor.getAttribute('href')).toContain('/hq');
      expect(anchor.textContent).toContain('itemPath.pop.viewNachschub');
      const [less, more] = [...pop.querySelectorAll<HTMLButtonElement>('.st button')];
      await click(more);
      expect(path.changeNachschubQty).toHaveBeenCalledWith('item', 'cls', 1);
      await click(less);
      expect(path.changeNachschubQty).toHaveBeenCalledWith('item', 'cls', -1);
      await click(pop.querySelector<HTMLButtonElement>('.txt.quiet')!);
      expect(path.removeFromNachschub).toHaveBeenCalledWith('item', 'cls');
      expect(popover()).toBeNull();
    });

    it('wish popover removes the wish', async () => {
      const { node, click, path, popover } = setup({ state: { wished: true } });
      await click(node('wish'));
      await click(popover()!.querySelector<HTMLButtonElement>('.txt.quiet')!);
      expect(path.removeWish).toHaveBeenCalledWith('item', 'cls', 'Helm');
    });

    it('empty Inventar opens the place popover, the default first; a choice stores the open amount (C3)', async () => {
      const { node, click, path, popover } = setup({ state: { nachschubQty: 3 } });
      await click(node('inventar'));
      expect(path.moveToInventar).not.toHaveBeenCalled();
      const places = [...popover()!.querySelectorAll<HTMLButtonElement>('.place')];
      expect(places[0].classList).toContain('on');
      expect(places[0].textContent).toContain('Bei mir');
      expect(places[1].textContent).toContain('Area 18');
      await click(places[1]);
      expect(path.moveToInventar).toHaveBeenCalledWith('item', 'cls', 'Helm', 'Area 18', 3, { unit: null });
      expect(popover()).toBeNull();
    });

    it('shows the stored place "Bei mir" as "With me" in EN, in the place popover and in the Inventar popover', async () => {
      const { node, click, popover } = setup({ lang: 'en', state: { nachschubQty: 3, inventarQty: 0 } });
      await click(node('inventar'));
      expect([...popover()!.querySelectorAll('.place')][0].textContent).toContain('With me');
      expect(popover()!.textContent).not.toContain('Bei mir');
    });

    it('lists a stored "Bei mir" row as "With me" in EN', async () => {
      const { node, click, popover } = setup({ lang: 'en', state: { inventarQty: 2, places: [{ location: 'Bei mir', qty: 2 }] } });
      await click(node('inventar'));
      expect(popover()!.querySelector('.rp-places .pn')!.textContent).toContain('With me');
    });

    it('"Anderer Ort" asks for a free place', async () => {
      const { node, click, path, popover, settle } = setup();
      await click(node('inventar'));
      const places = [...popover()!.querySelectorAll<HTMLButtonElement>('.place')];
      await click(places[places.length - 1]);
      await settle();
      const input = popover()!.querySelector<HTMLInputElement>('.other input')!;
      input.value = ' Lorville ';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();
      expect(path.moveToInventar).toHaveBeenCalledWith('item', 'cls', 'Helm', 'Lorville', 1, { unit: null });
    });

    it('filled Inventar lists its places with steppers; a step leaves the Nachschub line alone', async () => {
      const { node, click, path, popover } = setup({ state: { inventarQty: 3, places: [{ location: 'Area 18', qty: 2 }, { location: 'Bei mir', qty: 1 }] } });
      await click(node('inventar'));
      const rows = [...popover()!.querySelectorAll('.rp-places li')];
      expect(rows.length).toBe(2);
      await click(rows[0].querySelectorAll<HTMLButtonElement>('.st button')[1]);
      expect(path.adjustInventar).toHaveBeenCalledWith('cls', 'Helm', 'Area 18', 1);
      expect(path.moveToInventar).not.toHaveBeenCalled();
    });

    it('a blueprint is collected without asking for a place (A9)', async () => {
      const { node, click, path, popover } = setup({ kind: 'blueprint' });
      await click(node('inventar'));
      expect(popover()).toBeNull();
      expect(path.moveToInventar).toHaveBeenCalled();
    });

    it('ship: empty Hangar adds straight away; the filled one asks before it removes', async () => {
      const a = setup({ kind: 'ship' });
      await a.click(a.node('hangar'));
      expect(a.path.addToHangar).toHaveBeenCalledWith('cls', 'Helm');
      TestBed.resetTestingModule();
      const b = setup({ kind: 'ship', state: { inHangar: true, hangarShipId: 'id1' } });
      await b.click(b.node('hangar'));
      expect(b.popover()!.querySelector('a.alink')!.getAttribute('href')).toContain('/hq/hangar/id1');
      await b.click(b.popover()!.querySelector<HTMLButtonElement>('.txt.quiet')!);
      expect(b.confirm.confirm).toHaveBeenCalled();
      expect(b.path.removeFromHangar).toHaveBeenCalledWith('cls', 'Helm');
    });

    it('signed out: a write asks for sign-in and writes nothing', async () => {
      const { node, click, path, signIn, popover } = setup({ signedIn: false });
      await click(node('wish'));
      await click(node('inventar'));
      expect(signIn.ensure).toHaveBeenCalledTimes(2);
      expect(path.addWish).not.toHaveBeenCalled();
      expect(popover()).toBeNull();
    });

    it('a failure shows its translated key at the node, no toast', async () => {
      const { node, click, path, popover, toast } = setup();
      path.addWish.and.resolveTo({ ok: false, key: 'errors.itemPath.failed' });
      await click(node('wish'));
      expect(popover()!.getAttribute('role')).toBe('alert');
      expect(popover()!.textContent).toContain('errors.itemPath.failed');
      expect(toast.current()).toBeNull();
    });
  });

  describe('announced ship (C5)', () => {
    it('only the wish stop, the hint in the tooltip name', () => {
      const { el } = setup({ kind: 'upcoming' });
      const nodes = el.querySelectorAll('.node');
      expect(nodes.length).toBe(1);
      expect(nodes[0].getAttribute('aria-label')).toContain('itemPath.hint.notYetInGame');
    });

    it('pill: offers the wish, then only the hint', () => {
      const a = setup({ kind: 'upcoming', level: 'secondary' });
      expect(a.el.querySelector('.go')!.textContent).toContain('itemPath.go.wish');
      expect(a.el.querySelector('.rdy')!.textContent).toContain('itemPath.hint.notYetInGame');
      TestBed.resetTestingModule();
      const b = setup({ kind: 'upcoming', level: 'secondary', state: { wished: true } });
      expect(b.el.querySelector('.go')).toBeNull();
      expect(b.el.querySelector('.rdy')).not.toBeNull();
    });
  });

  describe('pill: the next step follows the state', () => {
    const k = (kind: string, over: Partial<ItemPathState> = {}) => nextStepOf(pathState(kind, over));

    it('nextStepOf', () => {
      expect(k('item')).toBe('wish');
      expect(k('item', { wished: true })).toBe('nachschub');
      expect(k('item', { nachschubQty: 1 })).toBe('inventar');
      expect(k('ship', { nachschubQty: 1 })).toBe('hangar');
      expect(k('item', { inventarQty: 2 })).toBe('nachschub');
      expect(k('ship', { inHangar: true })).toBeNull();
      expect(k('upcoming')).toBe('wish');
      expect(k('upcoming', { wished: true })).toBeNull();
    });

    it('the button runs that step', async () => {
      const { el, click, path } = setup({ level: 'secondary', state: { wished: true } });
      const go = el.querySelector<HTMLButtonElement>('.go')!;
      expect(go.textContent).toContain('itemPath.go.nachschub');
      await click(go);
      expect(path.addToNachschub).toHaveBeenCalled();
    });

    it('the context overrides it (search opened from "Gegenstand suchen")', async () => {
      const { el, click, path } = setup({ level: 'secondary', nextStep: 'nachschub' });
      await click(el.querySelector<HTMLButtonElement>('.go')!);
      expect(path.addToNachschub).toHaveBeenCalled();
      expect(path.addWish).not.toHaveBeenCalled();
    });

    it('an override for a stop this kind does not have falls back to the state', () => {
      const { el } = setup({ kind: 'upcoming', level: 'secondary', nextStep: 'nachschub' });
      expect(el.querySelector('.go')!.textContent).toContain('itemPath.go.wish');
    });

    it('next step Inventar opens the place popover at its node', async () => {
      const { el, click, popover, node } = setup({ level: 'secondary', state: { nachschubQty: 1 } });
      await click(el.querySelector<HTMLButtonElement>('.go')!);
      expect(popover()!.querySelector('.places')).not.toBeNull();
      expect(node('inventar').classList).toContain('open');
    });
  });

  describe('full form', () => {
    it('three stops in words, the next one as the primary button, the agreed text', () => {
      const { el } = setup({ level: 'primary', state: { wished: true } });
      const stops = [...el.querySelectorAll('.stop')];
      expect(stops.length).toBe(3);
      expect(stops[0].classList).toContain('on');
      expect(stops[1].classList).toContain('next');
      expect(stops[1].querySelector('p')!.textContent).toContain('itemPath.full.nachschub');
      expect(stops[1].querySelector('button.sc-action--primary')).not.toBeNull();
      expect(el.querySelectorAll('.sc-action--primary').length).toBe(1);
      expect(el.querySelector('.node')).toBeNull();
    });

    it('a stop out of order is still reachable, a filled one opens', async () => {
      const { el, click, path, popover } = setup({ level: 'primary', state: { wished: true } });
      const stops = el.querySelectorAll('.stop');
      await click(stops[2].querySelector<HTMLButtonElement>('.txt')!);
      expect(popover()!.querySelector('.places')).not.toBeNull();
      await click(stops[2].querySelector<HTMLButtonElement>('.txt')!);
      await click(stops[0].querySelector<HTMLButtonElement>('.txt')!);
      expect(popover()!.textContent).toContain('itemPath.pop.viewWish');
      expect(path.moveToInventar).not.toHaveBeenCalled();
    });
  });

  it('(leave) fires on a plain click of a popover anchor, not on Ctrl+click', async () => {
    const { node, click, popover, fixture } = setup({ state: { wished: true } });
    const leave = jasmine.createSpy('leave');
    fixture.componentInstance.leave.subscribe(leave);
    await click(node('wish'));
    const a = popover()!.querySelector<HTMLAnchorElement>('a.alink')!;
    a.addEventListener('click', (e) => e.preventDefault());
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
    expect(leave).not.toHaveBeenCalled();
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(leave).toHaveBeenCalled();
  });

  it('steps come from the kind', () => {
    expect(stepsOf('upcoming')).toEqual(['wish']);
  });
});
