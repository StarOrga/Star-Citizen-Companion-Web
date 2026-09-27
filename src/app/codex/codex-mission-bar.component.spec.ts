import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexMissionBarComponent } from './codex-mission-bar.component';
import { ShipCapabilities } from './codex-mission';

describe('CodexMissionBarComponent', () => {
  let fixture: ComponentFixture<CodexMissionBarComponent>;

  const fullCaps: ShipCapabilities = { hasCargo: true, hasQuantum: true, hasMining: true, hasSalvage: true };
  const bareCaps: ShipCapabilities = { hasCargo: false, hasQuantum: false, hasMining: false, hasSalvage: false };

  async function setup(caps: ShipCapabilities) {
    await TestBed.configureTestingModule({
      imports: [CodexMissionBarComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexMissionBarComponent);
    fixture.componentRef.setInput('active', 'all');
    fixture.componentRef.setInput('capabilities', caps);
    fixture.detectChanges();
  }

  function chips(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.mission-chip'));
  }

  /** App tooltip text of a chip (REQ-8: the reason is never a native title). */
  function tooltipOf(chip: HTMLElement): string | null | undefined {
    const de = fixture.debugElement.queryAll(By.directive(ScTooltipDirective)).find((d) => d.nativeElement.contains(chip));
    return de?.injector.get(ScTooltipDirective).scTooltip();
  }

  it('renders one chip per mission, all enabled when the hull has every capability', async () => {
    await setup(fullCaps);
    const cs = chips();
    expect(cs.length).toBe(7);
    expect(cs.every((c) => !c.disabled)).toBeTrue();
  });

  it('disables a mission the hull cannot fly and names the reason as an app tooltip', async () => {
    await setup(bareCaps);
    const mining = chips().find((c) => tooltipOf(c) === 'codex.mission.disabled.noMining')!;
    expect(mining).toBeTruthy();
    expect(mining.disabled).toBeTrue();
    expect(mining.getAttribute('title')).toBeNull();
    // An enabled chip repeats nothing: its label is already on screen.
    expect(chips().every((c) => c.disabled || !tooltipOf(c))).toBeTrue();
  });

  it('never disables all/combat/stealth regardless of capabilities', async () => {
    await setup(bareCaps);
    const cs = chips();
    expect(cs[0].disabled).toBeFalse(); // all
    expect(cs[1].disabled).toBeFalse(); // combat
  });

  it('emits missionChange on an enabled chip click, not on a disabled one', async () => {
    await setup(bareCaps);
    const emitted: string[] = [];
    fixture.componentInstance.missionChange.subscribe((id) => emitted.push(id));
    const cs = chips();
    cs[1].click(); // combat — enabled
    const miningChip = cs.find((c) => tooltipOf(c) === 'codex.mission.disabled.noMining')!;
    miningChip.click(); // disabled — no-op
    expect(emitted).toEqual(['combat']);
  });
});
