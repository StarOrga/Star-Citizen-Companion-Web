import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexOffensivePanelComponent } from './codex-analysis-panels.component';
import {
  CodexHardpointLayoutComponent,
  LayoutSection,
  LayoutSlot,
} from './codex-hardpoint-layout.component';
import { OffensivePanel } from './codex-loadout-stats';

/**
 * The Codex detail page (`/codex/ship/:class`, `/codex/component/:class`) is one
 * flex column of blocks, and a flex/grid item never shrinks below its own
 * min-content width. So ANY row inside a block that cannot wrap becomes the
 * floor for the whole page: the page grows past the viewport and the phone
 * scrolls sideways (admin feedback 2c7ed0d0 — "horizontal breiter scrollbar als
 * mein Handy breit ist").
 *
 * Measured, not asserted from the source: each block renders inside a 375px
 * frame — the viewport it was reported on — and the frame must not be widened
 * by its content. The two blocks below are the ones that actually did it, both
 * on `/codex/ship/AEGS_Avenger_Stalker`: the hardpoint section head (label +
 * count + two toggles on one non-wrapping flex line) and the weapon analysis
 * table (five columns of unbreakable class names).
 */

const PHONE_PX = 375;

const I18N_DE = {
  codex: {
    moduleSection: {
      structure: 'Zelle & feste Systeme',
      remoteTurrets: 'Ferngesteuerte Türme',
      fixedTag: 'nicht konfigurierbar',
      splitRows: 'Einzeln',
      groupRows: 'Zusammenfassen',
      splitRowsHint: 'Jeden Platz einzeln auflisten',
      groupRowsHint: 'Gleiche Plätze wieder zusammenfassen',
      unfold: 'Anzeigen',
      foldAway: 'Einklappen',
    },
    analysis: {
      offensive: {
        title: 'Offensive',
        weapons: 'Waffen ({{count}} montiert)',
        colWeapon: 'Waffe',
        colSize: 'Größe',
        colAlpha: 'Alpha',
        colSustained: 'Dauer-DPS',
        colBurst: 'Salve',
        total: 'Gesamt',
      },
    },
  },
};

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CodexHardpointLayoutComponent, CodexOffensivePanelComponent],
  template: `
    <div class="frame">
      @if (sections(); as s) {
        <sc-codex-hardpoint-layout [sections]="s" />
      }
      @if (offensive(); as p) {
        <sc-codex-offensive-panel [panel]="p" />
      }
    </div>
  `,
  styles: [
    `
      /* Stand-in for the phone viewport: it must NOT be widened by its content. */
      .frame { width: ${PHONE_PX}px; }
    `,
  ],
})
class FrameHostComponent {
  readonly sections = signal<LayoutSection[] | null>(null);
  readonly offensive = signal<OffensivePanel | null>(null);
}

function slot(over: Partial<LayoutSlot> & { port: string }): LayoutSlot {
  return {
    className: null,
    kind: null,
    name: null,
    size: null,
    grade: null,
    manufacturerCode: null,
    ...over,
  };
}

function offensivePanel(rows: OffensivePanel['weaponRows']): OffensivePanel {
  return {
    weaponCount: rows.length,
    weaponRows: rows,
    hasAlphaColumn: true,
    hasDpsColumn: true,
    footerAlpha: 500.7,
    footerDps: 2359.5,
    damageChannelTotals: [],
    effectiveRange: null,
    longestRangeGun: null,
    mixedRangeWarning: false,
    projectileSpeed: null,
    missileCount: 0,
    missileSalvoDamage: null,
    missileLockTime: null,
    missileLockNoteSlowest: false,
    missileRange: null,
    missileSignalTypes: [],
    gapKeys: [],
  };
}

describe('Codex detail blocks at a 375px viewport', () => {
  let fixture: ComponentFixture<FrameHostComponent>;
  let frame: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FrameHostComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();

    const i18n = TestBed.inject(TranslateService);
    i18n.setTranslation('de', I18N_DE);
    i18n.use('de');

    fixture = TestBed.createComponent(FrameHostComponent);
    fixture.detectChanges();
    frame = fixture.nativeElement.querySelector('.frame') as HTMLElement;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps a hardpoint section head with both toggles inside the phone width', () => {
    // The worst case on a real hull: a long section label, a count, the
    // "nicht konfigurierbar" tag and BOTH toggles (splittable + foldable) on
    // one line. Three identical slots make the block splittable; `structure`
    // is the foldable block.
    const mount = slot({
      port: 'Hardpoint Turret Remote',
      className: 'BEHR_BallisticGatling_S4',
      kind: 'weapon',
      name: 'Sledge II Mass Driver Cannon',
      size: 4,
    });
    fixture.componentInstance.sections.set([
      {
        section: 'structure',
        slots: [
          { ...mount, port: 'Hardpoint Turret Remote Left' },
          { ...mount, port: 'Hardpoint Turret Remote Right' },
          { ...mount, port: 'Hardpoint Turret Remote Top' },
        ],
      },
    ]);
    fixture.detectChanges();

    const head = frame.querySelector('.sec-head') as HTMLElement;
    expect(head).withContext('the section head renders').not.toBeNull();
    expect(head.querySelectorAll('.sec-btn').length)
      .withContext('both toggles are on this head')
      .toBe(2);
    expect(frame.scrollWidth).toBeLessThanOrEqual(PHONE_PX);
  });

  it('keeps the weapon analysis table inside the phone width', () => {
    fixture.componentInstance.offensive.set(
      offensivePanel([
        { className: 'APAR_BallisticGatling_S4', size: 4, alpha: 63.3, sustainedDps: 1266, burstDps: 1266 },
        { className: 'AMRS_LaserCannon_S3', size: 3, alpha: 218.7, sustainedDps: 546.75, burstDps: 546.75 },
      ]),
    );
    fixture.detectChanges();

    // The panel ships open (`useCollapse` starts at true), so the table is on
    // screen straight away — the state the page is read in.
    const table = frame.querySelector('table.analysis-table') as HTMLElement;
    expect(table).withContext('the table renders with the panel open').not.toBeNull();
    // Whatever is still too wide scrolls inside its own wrapper, never the page.
    expect((table.parentElement as HTMLElement).classList).toContain('table-wrap');
    expect(frame.scrollWidth).toBeLessThanOrEqual(PHONE_PX);
  });
});
