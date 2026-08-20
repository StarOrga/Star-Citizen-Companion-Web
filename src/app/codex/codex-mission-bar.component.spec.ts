import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CodexMissionBarComponent } from './codex-mission-bar.component';
import { ShipCapabilities } from './codex-mission';

describe('CodexMissionBarComponent', () => {
  let fixture: ComponentFixture<CodexMissionBarComponent>;

  const fullCaps: ShipCapabilities = { hasCargo: true, hasQuantum: true, hasMining: true, hasSalvage: true };
  const bareCaps: ShipCapabilities = { hasCargo: false, hasQuantum: false, hasMining: false, hasSalvage: false };

  async function setup(caps: ShipCapabilities) {
    await TestBed.configureTestingModule({
      imports: [CodexMissionBarComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexMissionBarComponent);
    fixture.componentRef.setInput('active', 'all');
    fixture.componentRef.setInput('capabilities', caps);
    fixture.detectChanges();
  }

  function chips(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.mission-chip'));
  }

  it('renders one chip per mission, all enabled when the hull has every capability', async () => {
    await setup(fullCaps);
    const cs = chips();
    expect(cs.length).toBe(7);
    expect(cs.every((c) => !c.disabled)).toBeTrue();
  });

  it('disables a mission the hull cannot fly and names the reason via title', async () => {
    await setup(bareCaps);
    const mining = chips().find((c) => c.title === 'codex.mission.disabled.noMining')!;
    expect(mining).toBeTruthy();
    expect(mining.disabled).toBeTrue();
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
    const miningChip = cs.find((c) => c.title === 'codex.mission.disabled.noMining')!;
    miningChip.click(); // disabled — no-op
    expect(emitted).toEqual(['combat']);
  });
});
