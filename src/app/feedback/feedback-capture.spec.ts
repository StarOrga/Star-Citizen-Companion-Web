import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { FeedbackCaptureComponent } from './feedback-capture.component';
import {
  captureLine,
  inPage,
  isCaptureClick,
  meaningfulElement,
  nameOf,
  regionsFor,
  roleOf,
  spotFor,
} from './feedback-capture.util';
import { FeedbackComposerSeedService } from './feedback-composer-seed.service';
import { FeedbackSpotDirective } from './feedback-spot.directive';
import { FeedbackSpotService } from './feedback-spot.service';

const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join('|')})` : key;

function click(init: MouseEventInit): MouseEvent {
  return new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
}

describe('isCaptureClick', () => {
  const link = document.createElement('a');
  link.href = '#x';
  const inner = document.createElement('span');
  link.append(inner);
  const plain = document.createElement('div');
  const field = document.createElement('input');

  it('Alt+click captures anywhere, links included', () => {
    expect(isCaptureClick(click({ altKey: true }), plain)).toBe(true);
    expect(isCaptureClick(click({ altKey: true }), inner)).toBe(true);
  });

  it('Ctrl+click captures outside links and fields only', () => {
    expect(isCaptureClick(click({ ctrlKey: true }), plain)).toBe(true);
    expect(isCaptureClick(click({ ctrlKey: true }), inner)).toBe(false);
    expect(isCaptureClick(click({ ctrlKey: true }), field)).toBe(false);
  });

  it('leaves plain, AltGr (Ctrl+Alt), Cmd, Shift and non-left clicks alone', () => {
    expect(isCaptureClick(click({}), plain)).toBe(false);
    expect(isCaptureClick(click({ ctrlKey: true, altKey: true }), plain)).toBe(false);
    expect(isCaptureClick(click({ metaKey: true }), plain)).toBe(false);
    expect(isCaptureClick(click({ altKey: true, shiftKey: true }), plain)).toBe(false);
    expect(isCaptureClick(click({ altKey: true, button: 1 }), plain)).toBe(false);
  });

  it('never captures the feedback UI itself', () => {
    const fab = document.createElement('sc-feedback-fab');
    const btn = document.createElement('button');
    fab.append(btn);
    expect(isCaptureClick(click({ altKey: true }), btn)).toBe(false);
  });
});

describe('element description', () => {
  it('names a button by its text and a labelled control by aria-label', () => {
    const b = document.createElement('button');
    b.textContent = '  Laser-Repeater S3 ';
    expect(roleOf(b)).toBe('button');
    expect(nameOf(b)).toBe('Laser-Repeater S3');
    b.setAttribute('aria-label', 'Schließen');
    expect(nameOf(b)).toBe('Schließen');
  });

  it('never quotes a text field’s typed value', () => {
    const i = document.createElement('input');
    i.value = 'geheim';
    i.placeholder = 'Suche';
    expect(roleOf(i)).toBe('field');
    expect(nameOf(i)).toBe('Suche');
  });

  it('shortens long text', () => {
    const p = document.createElement('a');
    p.textContent = 'x'.repeat(200);
    expect(nameOf(p).length).toBeLessThanOrEqual(60);
  });
});

describe('captureLine', () => {
  const el = { role: 'button' as const, name: 'Laser-Repeater S3' };
  const spot = { kind: 'spot' as const, label: { key: 'L', subKey: 'W', text: null } };

  it('joins view, section and element', () => {
    expect(captureLine([spot], { view: 'classic', path: '/p' }, el, t)).toBe(
      'codex.holo.toggle.classicHint: L W › feedbackCapture.element(feedbackCapture.role.button|Laser-Repeater S3)',
    );
  });

  it('falls back to the route path without a marked section, and to the bare role without a name', () => {
    expect(captureLine([], { view: null, path: '/codex/ships' }, { role: 'image', name: '' }, t)).toBe(
      '/codex/ships › feedbackCapture.role.image',
    );
  });

  it('a shell region gets neither the route nor the Codex view (feedback #342)', () => {
    const header = { kind: 'landmark' as const, key: 'feedbackCapture.area.header', name: '' };
    const nav = { kind: 'landmark' as const, key: 'feedbackCapture.area.navigation', name: 'Haupt' };
    expect(captureLine([header, nav], null, { role: 'button', name: 'Profilbild' }, t)).toBe(
      'feedbackCapture.area.header › feedbackSpot.titled(feedbackCapture.area.navigation|Haupt) › ' +
        'feedbackCapture.element(feedbackCapture.role.button|Profilbild)',
    );
  });

  it('a landmark inside the page keeps the route in front; more than two regions show outermost and innermost', () => {
    const dialog = { kind: 'landmark' as const, key: 'D', name: '' };
    const menu = { kind: 'landmark' as const, key: 'M', name: '' };
    expect(captureLine([dialog, spot, menu], { view: null, path: '/x' }, el, t)).toBe(
      '/x › D › M › feedbackCapture.element(feedbackCapture.role.button|Laser-Repeater S3)',
    );
  });
});

describe('capture of the shell header (feedback #342)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <header id="top">
        <nav aria-label="Haupt"><a id="news" href="/news"><svg id="ico"></svg>News</a></nav>
        <div class="profile-menu">
          <button id="avatar" type="button" aria-label="Konto-Menü" data-feedback-name="Profilbild (Konto-Menü)">
            <img id="pic" src="data:," alt="" />
          </button>
          <div role="menu" aria-label="Konto"><button id="out" role="menuitem">Abmelden</button></div>
        </div>
      </header>
      <div data-feedback-area="feedbackCapture.area.bar"><button id="bar" type="button" aria-label="Suche öffnen"><svg id="barico"></svg></button></div>
      <main><article><header id="inner"><span id="inner-t">Titel</span></header></article></main>`;
    document.body.append(root);
  });

  afterEach(() => root.remove());

  const q = (id: string) => root.querySelector(`#${id}`)!;

  it('an Alt+click on the avatar image names the account button, not a nameless image', () => {
    const el = meaningfulElement(q('pic'));
    expect(el.id).toBe('avatar');
    expect(roleOf(el)).toBe('button');
    expect(nameOf(el)).toBe('Profilbild (Konto-Menü)');
  });

  it('the area is the header, not the route — and the page view stays out', () => {
    const target = q('pic');
    expect(inPage(target)).toBe(false);
    const regions = regionsFor(target, null);
    expect(regions).toEqual([{ kind: 'landmark', key: 'feedbackCapture.area.header', name: '' }]);
    const el = meaningfulElement(target);
    expect(captureLine(regions, null, { role: roleOf(el), name: nameOf(el) }, t)).toBe(
      'feedbackCapture.area.header › feedbackCapture.element(feedbackCapture.role.button|Profilbild (Konto-Menü))',
    );
  });

  it('names navigation, menus and attribute-marked regions, outermost first', () => {
    expect(regionsFor(q('ico'), null).map((r) => r.kind === 'landmark' && r.key)).toEqual([
      'feedbackCapture.area.header',
      'feedbackCapture.area.navigation',
    ]);
    expect(meaningfulElement(q('ico')).id).toBe('news');
    const menu = regionsFor(q('out'), null);
    expect(menu[1]).toEqual({ kind: 'landmark', key: 'feedbackCapture.area.menu', name: 'Konto' });
    expect(roleOf(q('out'))).toBe('menuitem');
    expect(regionsFor(q('barico'), null)).toEqual([{ kind: 'landmark', key: 'feedbackCapture.area.bar', name: '' }]);
    expect(nameOf(meaningfulElement(q('barico')))).toBe('Suche öffnen');
  });

  it('a header inside the page’s own article is no shell header', () => {
    expect(inPage(q('inner-t'))).toBe(true);
    expect(regionsFor(q('inner-t'), null)).toEqual([]);
  });
});

describe('FeedbackCaptureComponent', () => {
  @Component({
    standalone: true,
    imports: [FeedbackSpotDirective],
    template: `
      <section id="sec" [scFeedbackSpot]="'codex.detail.columnLoadout'">
        <button id="btn" type="button" (click)="fired.set(fired() + 1)">Laser-Repeater S3</button>
        <a id="lnk" href="#nowhere" (click)="$event.preventDefault()">Zum Schiff</a>
      </section>
    `,
  })
  class PageComponent {
    readonly fired = signal(0);
  }

  function setup(admin: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: RoleService, useValue: { isAdmin: signal(admin) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { feedbackCapture: { element: '{{role}} “{{name}}”' } });
    translate.use('en');
    const cap = TestBed.createComponent(FeedbackCaptureComponent);
    const page = TestBed.createComponent(PageComponent);
    document.body.append(page.nativeElement);
    cap.detectChanges();
    page.detectChanges();
    const seeds = TestBed.inject(FeedbackComposerSeedService);
    return { cap, page, seeds, root: page.nativeElement as HTMLElement };
  }

  afterEach(() => TestBed.resetTestingModule());

  /** The page's own handler cancels the link, so no spec can open a real tab. */
  function fire(el: Element, init: MouseEventInit): MouseEvent {
    const ev = click(init);
    el.dispatchEvent(ev);
    return ev;
  }

  it('admin: Alt+click captures the element, cancels its action and seeds the draft', () => {
    const { page, seeds, root } = setup(true);
    const ev = fire(root.querySelector('#btn')!, { altKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(page.componentInstance.fired()).toBe(0);
    const body = seeds.take('admin:new')?.body ?? '';
    expect(body).toContain('›');
    expect(body).toContain('Laser-Repeater S3');
    expect(seeds.openRequests()).toBe(1);
    root.remove();
  });

  it('admin: Ctrl+click on a non-link captures, on a link it is left to open a tab', () => {
    const { page, seeds, root } = setup(true);
    fire(root.querySelector('#btn')!, { ctrlKey: true });
    expect(seeds.openRequests()).toBe(1);
    expect(page.componentInstance.fired()).toBe(0);

    fire(root.querySelector('#lnk')!, { ctrlKey: true });
    expect(seeds.openRequests()).toBe(1);
    root.remove();
  });

  it('non-admin: nothing is captured and the click reaches the page', () => {
    const { page, seeds, root } = setup(false);
    const ev = fire(root.querySelector('#btn')!, { altKey: true });
    fire(root.querySelector('#btn')!, { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(page.componentInstance.fired()).toBe(2);
    expect(seeds.openRequests()).toBe(0);
    expect(TestBed.inject(FeedbackSpotService).captureActive()).toBe(false);
    root.remove();
  });

  it('finds the innermost marked section', () => {
    const { root } = setup(true);
    const spots = TestBed.inject(FeedbackSpotService).spots();
    expect(spotFor(spots, root.querySelector('#btn')!)?.el.id).toBe('sec');
    expect(spotFor(spots, document.body)).toBeNull();
    root.remove();
  });
});
