import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import de from '../../../public/i18n/de.json';
import { KeybindsComponent } from './keybinds.component';
import { CodexService } from './codex.service';
import { CodexKeybind } from './codex.types';
import { RoleService } from '../auth/role.service';
import { KeybindCategoryService } from './keybind-category.service';

/**
 * REQ-24 (AUD-206): the keybind reference must fit a phone. A flex/grid item
 * never shrinks below its min-content width, so one unbreakable label or
 * binding chord widens the whole page and the phone scrolls sideways — the
 * same failure codex-detail-mobile-width.spec.ts guards for the detail page.
 *
 * Measured, not asserted from the source, and in a REAL 375px viewport: Karma
 * renders at ~749px, where the page's phone media queries (max-width: 640px —
 * the device switch wraps there) do not apply. So the rendered page moves into
 * a 375px iframe together with every stylesheet, and the iframe's own viewport
 * decides the media queries. The iframe document must not scroll sideways.
 *
 * The real German bundle is loaded — German runs longest, and an untranslated
 * i18n key is itself an unbreakable word that would fail the check for the
 * wrong reason. The fixture is the realistic worst case: a long German action
 * label and the longest kind of chord the game ships (three modifiers + a key).
 */

const PHONE_PX = 375;

const LONG_LABEL_KEY = '@ui_long_label';
const LONG_LABEL =
  'Geschwindigkeitsbegrenzer-Übersteuerung für den entkoppelten Flugmodus umschalten (gedrückt halten)';
const LONG_CHORD = 'lalt+rctrl+lshift+np_multiply';

const BINDS: CodexKeybind[] = [
  {
    actionmap: 'spaceship_movement',
    actionName: 'v_toggle_decoupled_mode_with_afterburner_override_and_limiter',
    labelKey: LONG_LABEL_KEY,
    descriptionKey: null,
    categoryLabelKey: '@ui_flight',
    activationMode: null,
    bindings: {
      keyboard: LONG_CHORD,
      mouse: 'lalt+mwheel_down',
      gamepad: 'shoulderl+dpad_down',
      joystick: 'js1_button12+js2_hat1_down',
    },
    sort: 0,
  },
];

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeybindsComponent],
  template: `<sc-codex-keybinds />`,
})
class HostComponent {}

describe('Codex keybinds at a 375px viewport (REQ-24)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let iframe: HTMLIFrameElement;

  beforeEach(async () => {
    const labels = new Map<string, string>([
      [LONG_LABEL_KEY, LONG_LABEL],
      ['@ui_flight', 'Flug – Bewegung'],
    ]);
    const codex: Partial<CodexService> = {
      build: signal({ patchVersion: '4.2', buildNumber: '9000000' }) as never,
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listKeybinds: jasmine.createSpy('listKeybinds').and.resolveTo(BINDS),
      resolveLocaleKeys: jasmine.createSpy('resolveLocaleKeys').and.resolveTo(labels),
    };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: RoleService, useValue: { isCollaborator: signal(false), isAdmin: signal(false) } },
        {
          provide: KeybindCategoryService,
          useValue: {
            byAction: signal(new Map()).asReadonly(),
            loaded: signal(true).asReadonly(),
            saving: signal(false),
            error: signal<string | null>(null),
            load: jasmine.createSpy('load').and.resolveTo(undefined),
            apply: jasmine.createSpy('apply').and.resolveTo(true),
          },
        },
      ],
    }).compileComponents();
    const i18n = TestBed.inject(TranslateService);
    i18n.setTranslation('de', de);
    i18n.use('de');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The phone: a 375px viewport of its own, carrying every stylesheet the
    // page rendered with (global + the component styles Angular injected).
    iframe = document.createElement('iframe');
    iframe.style.cssText = `width: ${PHONE_PX}px; height: 812px; border: 0;`;
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    for (const sheet of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
      doc.head.appendChild(sheet.cloneNode(true));
    }
    doc.body.style.margin = '0';
    doc.body.appendChild(doc.adoptNode(fixture.nativeElement as HTMLElement));
    // A cloned <link> loads asynchronously; inline <style> (Karma's case) applies at once.
    await Promise.all(
      Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(
        (l) => new Promise<void>((resolve) => {
          l.addEventListener('load', () => resolve(), { once: true });
          l.addEventListener('error', () => resolve(), { once: true });
          setTimeout(resolve, 1000);
        }),
      ),
    );
  });

  afterEach(() => {
    iframe.remove();
    TestBed.resetTestingModule();
  });

  it('renders the long label and chord without scrolling sideways', () => {
    const doc = iframe.contentDocument!;
    const root = doc.documentElement;
    const text = doc.body.textContent ?? '';
    // Guard against a vacuous pass: the long content must actually be on
    // screen, and the phone branch of the styles must actually be in force.
    expect(text).toContain(LONG_LABEL);
    expect(text).toContain('Linke Alt'); // the chord reads as words now (audit L18)
    expect(text).not.toContain('codex.keybinds.');
    expect(iframe.contentWindow!.matchMedia('(max-width: 640px)').matches).toBeTrue();
    expect(iframe.contentWindow!.innerWidth).toBe(PHONE_PX);

    // On failure, name what sticks out past the viewport's right edge.
    const offenders = Array.from(doc.body.querySelectorAll<HTMLElement>('*'))
      .filter((e) => e.getBoundingClientRect().right > PHONE_PX + 1)
      .map((e) => `${e.tagName.toLowerCase()}.${e.className} (${Math.round(e.getBoundingClientRect().width)}px)`);
    expect(root.scrollWidth).withContext(offenders.slice(0, 8).join(', ')).toBeLessThanOrEqual(root.clientWidth);
  });
});
