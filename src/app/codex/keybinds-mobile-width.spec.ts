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
 * Measured, not asserted from the source: the page renders inside a 375px
 * frame and the frame must not be widened by its content. The real German
 * bundle is loaded — German runs longest, and an untranslated i18n key is
 * itself an unbreakable word that would fail the check for the wrong reason.
 * The fixture is the realistic worst case: a long German action label and the
 * longest kind of chord the game ships (three modifiers + a key).
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
    bindings: { keyboard: LONG_CHORD, mouse: 'lalt+mwheel_down', gamepad: 'shoulderl+dpad_down', joystick: 'js1_button12+js2_hat1_down' },
    sort: 0,
  },
];

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeybindsComponent],
  template: `<div class="frame"><sc-codex-keybinds /></div>`,
  styles: [
    `
      /* Stand-in for the phone viewport: it must NOT be widened by its content. */
      .frame { width: ${PHONE_PX}px; }
    `,
  ],
})
class FrameHostComponent {}

describe('Codex keybinds at a 375px viewport (REQ-24)', () => {
  let fixture: ComponentFixture<FrameHostComponent>;

  beforeEach(async () => {
    const labels = new Map<string, string>([
      [LONG_LABEL_KEY, LONG_LABEL],
      ['@ui_flight', 'Flight – Movement'],
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
      imports: [FrameHostComponent],
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
    fixture = TestBed.createComponent(FrameHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
    TestBed.resetTestingModule();
  });

  it('renders the long label and chord without widening the frame', () => {
    const frame = (fixture.nativeElement as HTMLElement).querySelector('.frame') as HTMLElement;
    const text = frame.textContent ?? '';
    // Guard against a vacuous pass: the long content must actually be on screen.
    expect(text).toContain(LONG_LABEL);
    expect(text).toContain('lalt');
    expect(text).not.toContain('codex.keybinds.');
    // On failure, name what sticks out past the frame's right edge.
    const edge = frame.getBoundingClientRect().right + 1;
    const offenders = Array.from(frame.querySelectorAll<HTMLElement>('*'))
      .filter((e) => e.getBoundingClientRect().right > edge)
      .map((e) => `${e.tagName.toLowerCase()}.${e.className} (${Math.round(e.getBoundingClientRect().width)}px)`);
    expect(frame.scrollWidth).withContext(offenders.slice(0, 8).join(', ')).toBeLessThanOrEqual(frame.clientWidth);
  });
});
