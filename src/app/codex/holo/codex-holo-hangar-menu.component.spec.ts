import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloHangarMenuComponent, HangarExemplar } from './codex-holo-hangar-menu.component';

const ex = (id: string, diffCount: number, summary: string | null = null): HangarExemplar => ({
  id,
  name: `Gladius · ${id}`,
  diffCount,
  summary,
  link: { commands: ['/hq/hangar', 'ship-1'], queryParams: { v: id } },
});

describe('CodexHoloHangarMenuComponent', () => {
  let fixture: ComponentFixture<CodexHoloHangarMenuComponent>;
  const q = (sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(fixture.nativeElement.querySelectorAll(sel)) as HTMLElement[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CodexHoloHangarMenuComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    });
    fixture = TestBed.createComponent(CodexHoloHangarMenuComponent);
    fixture.componentRef.setInput('shipName', 'Gladius');
    fixture.componentRef.setInput('count', 2);
    fixture.componentRef.setInput('signedIn', true);
    fixture.componentRef.setInput('exemplars', [ex('pvp', 1, 'Laser-Nase für PvP'), ex('bounty', 0)]);
  });

  function open(): void {
    fixture.detectChanges();
    q('.hb')!.click();
    fixture.detectChanges();
  }

  it('lists Werk and every exemplar as links, with the summary and the diff marker', () => {
    open();
    const rows = all('a.row');
    expect(rows.length).toBe(3);
    expect(rows[1].getAttribute('href')).toContain('/hq/hangar/ship-1?v=pvp');
    expect(rows[1].textContent).toContain('Laser-Nase für PvP');
    expect(rows[1].querySelector('sc-holo-diff-marker')).not.toBeNull();
    expect(rows[2].querySelector('sc-holo-diff-marker')).toBeNull();
    expect(rows[2].querySelector('.sum')).toBeNull();
  });

  it('on Werk offers saving as an exemplar, never "new exemplar from Werk"', () => {
    fixture.componentRef.setInput('activeId', null);
    open();
    const labels = all('button.add').map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('codex.holo.hangar.newFromWerk'))).toBe(false);
    expect(labels.some((l) => l.includes('codex.holo.hangar.saveWerk'))).toBe(true);
    expect(q('.acts')).toBeNull();
  });

  it('on an exemplar offers copy, new from Werk and the exemplar actions', () => {
    fixture.componentRef.setInput('activeId', 'pvp');
    const copied: string[] = [];
    fixture.componentInstance.copyExemplar.subscribe((id) => copied.push(id));
    open();
    const labels = all('button.add').map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('codex.holo.hangar.newFromWerk'))).toBe(true);
    expect(all('.acts button').length).toBe(4);
    all('button.add').find((b) => b.textContent?.includes('codex.holo.hangar.copy'))!.click();
    fixture.detectChanges();
    expect(copied).toEqual(['pvp']);
    expect(q('.menu')).toBeNull();
  });

  it('keeps Hangar and Wunschliste apart and shows no patch label', () => {
    open();
    const heads = all('.gh').map((h) => h.textContent?.trim());
    expect(heads).toEqual(['codex.holo.hangar.loadouts', 'codex.holo.hangar.hangar', 'codex.holo.hangar.wishlist']);
    expect(fixture.nativeElement.textContent).not.toMatch(/\d+\.\d+\.\d+/);
  });
});
