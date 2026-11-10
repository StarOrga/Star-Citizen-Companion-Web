import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHeroPartPopupComponent, resolveHeroPart, type HeroPartPick } from './codex-hero-part-popup.component';
import { AssetPackageService } from '../asset-package/asset-package.service';
import type { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';

const slot = (o: Partial<LayoutSlot>): LayoutSlot =>
  ({ port: 'Port', className: null, kind: null, name: null, size: null, grade: null, manufacturerCode: null, portSize: null, ...o }) as LayoutSlot;

const pick = (o: Partial<HeroPartPick>): HeroPartPick => ({
  id: 'p1', portName: 'hardpoint_x', itemClass: null, swappable: false, portChain: ['hardpoint_x'], ...o,
});

describe('resolveHeroPart', () => {
  const sections: LayoutSection[] = [
    { section: 'shields', slots: [slot({ rawPort: 'hardpoint_shield', name: 'FR-66', size: 2, grade: 'A', className: 'SHLD_FR66' })] },
  ];

  it('finds the loadout slot of the picked port', () => {
    const part = resolveHeroPart(sections, pick({ portName: 'hardpoint_shield', portChain: ['hardpoint_shield'] }));
    expect(part.name).toBe('FR-66');
    expect(part.size).toBe(2);
  });

  it('walks up the mount chain to the nearest slot', () => {
    const part = resolveHeroPart(sections, pick({ portName: 'inner', portChain: ['inner', 'hardpoint_shield'] }));
    expect(part.className).toBe('SHLD_FR66');
  });

  it('falls back to the placed class for a part without a slot', () => {
    const part = resolveHeroPart(sections, pick({ itemClass: 'LOOSE_PART' }));
    expect(part.name).toBe('LOOSE_PART');
    expect(part.stats.length).toBe(0);
  });
});

describe('CodexHeroPartPopupComponent', () => {
  function setup(findRow: () => Promise<unknown>) {
    TestBed.configureTestingModule({
      imports: [CodexHeroPartPopupComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: AssetPackageService, useValue: { findRow } },
      ],
    });
    const fixture = TestBed.createComponent(CodexHeroPartPopupComponent);
    const sections: LayoutSection[] = [
      { section: 'shields', slots: [slot({ rawPort: 'hp', name: 'FR-66', size: 2, grade: 'A', className: 'SHLD_FR66' })] },
    ];
    fixture.componentRef.setInput('part', resolveHeroPart(sections, pick({ portName: 'hp', portChain: ['hp'] })));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the name and the values, no scrim', async () => {
    const { fixture, el } = setup(() => Promise.resolve(null));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.hpp-name')?.textContent).toContain('FR-66');
    expect(el.querySelectorAll('.hpp-stats > div').length).toBe(2);
    // No package: no 3D stage.
    expect(el.querySelector('.hpp-stage')).toBeNull();
    expect(el.querySelector('.sc-scrim, .scrim')).toBeNull();
  });

  it('keeps a stage while the package lookup is pending', () => {
    const { el } = setup(() => new Promise(() => undefined));
    expect(el.querySelector('.hpp-stage')).not.toBeNull();
  });

  it('closes on the X', () => {
    const { fixture, el } = setup(() => new Promise(() => undefined));
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    (el.querySelector('.hpp-close') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });
});
