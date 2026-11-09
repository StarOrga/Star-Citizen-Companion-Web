import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexHoloEinsatzComponent } from './codex-holo-einsatz.component';

const MISSIONS = [
  { id: 'all' as const, labelKey: 'codex.mission.all', sub: '17 Ports', disabledKey: null },
  { id: 'combat' as const, labelKey: 'codex.mission.combat', sub: '119 Alpha', disabledKey: null },
  { id: 'mining' as const, labelKey: 'codex.mission.mining', sub: '', disabledKey: 'codex.mission.disabled' },
];

async function setup(): Promise<ComponentFixture<CodexHoloEinsatzComponent>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CodexHoloEinsatzComponent],
    providers: [provideTranslateService({})],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexHoloEinsatzComponent);
  fixture.componentRef.setInput('active', 'combat');
  fixture.componentRef.setInput('missions', MISSIONS);
  fixture.detectChanges();
  return fixture;
}

describe('CodexHoloEinsatzComponent (head centre, concept holotisch-feinschliff C4)', () => {
  it('the default Einsatz names the class and the group, any other its own word', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('defaultLabelKey', 'codex.rank.class.transport');
    fixture.componentRef.setInput('cohortLabel', '21 × Mittlerer Frachter');
    fixture.componentRef.setInput('active', 'all');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.einsatz .val')!.textContent).toContain('codex.rank.class.transport');
    expect(el.querySelector('.einsatz .val svg')).not.toBeNull();
    expect(el.querySelector('.einsatz .sub')!.textContent).toContain('21 × Mittlerer Frachter');
    fixture.componentRef.setInput('active', 'combat');
    fixture.detectChanges();
    expect(el.querySelector('.einsatz .val')!.textContent).toContain('codex.mission.combat');
  });

  it('opens, picks, closes and gives the focus back; a disabled choice only says why', async () => {
    const fixture = await setup();
    const picked: string[] = [];
    fixture.componentInstance.missionChange.subscribe((m) => picked.push(m));
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>('button.einsatz')!;
    expect(el.querySelector('.mission-pop')).toBeNull();
    btn.click();
    fixture.detectChanges();
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.mission-pop .mp'));
    expect(rows.length).toBe(3);
    expect(rows[1].getAttribute('aria-checked')).toBe('true');
    expect(rows[2].getAttribute('aria-disabled')).toBe('true');
    rows[2].click();
    expect(picked).toEqual([]);
    rows[0].click();
    fixture.detectChanges();
    expect(picked).toEqual(['all']);
    expect(el.querySelector('.mission-pop')).toBeNull();
  });

  it('closes on Escape and on a click elsewhere', async () => {
    const fixture = await setup();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button.einsatz')!.click();
    fixture.detectChanges();
    el.querySelector('.mission-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.mission-pop')).toBeNull();
    el.querySelector<HTMLButtonElement>('button.einsatz')!.click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('.mission-pop')).toBeNull();
  });
});
