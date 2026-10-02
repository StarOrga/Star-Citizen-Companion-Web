import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexSwapPickerComponent, SwapTarget } from './codex-swap-picker.component';
import { CodexKind, CodexService, CompatibleItem } from './codex.service';

// A failed candidate load used to leave the picker on a red sentence with no
// way forward but closing it (Codex UX audit 2026-10-02, AUD-S18). CLAUDE.md:
// a load failure renders an error state WITH retry.

const ITEM: CompatibleItem = {
  kind: 'weapon',
  classNameSlug: 'KLWE_LaserRepeater_S3',
  nameLocalized: 'CF-337 Panther Repeater',
  manufacturerCode: 'KLA',
  size: 3,
  subType: 'Gun',
  grade: 'A',
};

const TARGET: SwapTarget = {
  port: 'Hardpoint Weapon Top Left',
  count: 1,
  className: ITEM.classNameSlug,
  kind: 'weapon',
  name: 'CF-337 Panther Repeater',
  size: 3,
  factoryClassName: ITEM.classNameSlug,
};

class FlakyService {
  calls = 0;
  async getCompatibleItems(): Promise<CompatibleItem[]> {
    this.calls++;
    if (this.calls === 1) throw new Error('network down');
    return [ITEM];
  }
  async getEntityPayloads(): Promise<Map<string, { kind: CodexKind; payload: unknown }>> {
    return new Map([[ITEM.classNameSlug, { kind: 'weapon', payload: { entityKind: 'weapon', attachType: 'WeaponGun', subType: 'Gun', size: 3 } }]]);
  }
  async getAmmoPayloads(): Promise<Map<string, unknown>> {
    return new Map();
  }
}

describe('CodexSwapPickerComponent — load failure', () => {
  it('offers a retry that loads the candidates again', async () => {
    const svc = new FlakyService();
    await TestBed.configureTestingModule({
      imports: [CodexSwapPickerComponent],
      providers: [provideTranslateService({}), { provide: CodexService, useValue: svc }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CodexSwapPickerComponent);
    const el = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('target', TARGET);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.pick-msg.err')).toBeTruthy();
    const retry = el.querySelector('.pick-retry') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    expect(retry.tagName).toBe('BUTTON');

    retry.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(svc.calls).toBe(2);
    expect(el.querySelector('.pick-msg.err')).toBeNull();
    expect(el.querySelector('.pick-retry')).toBeNull();
  });
});
