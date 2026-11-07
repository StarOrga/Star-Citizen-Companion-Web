import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { HangarService } from '../../hangar/hangar.service';
import type { HangarShip } from '../../hangar/hangar.types';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { CodexOwnShipActionsComponent } from './codex-own-ship-actions.component';

const SHIP: HangarShip = {
  id: 'sh1', shipClassName: 'AEGS_Gladius', customName: null, status: 'owned', pinnedRank: null,
  selectedSkinId: null, notes: null, createdAt: '', updatedAt: '',
};

describe('CodexOwnShipActionsComponent', () => {
  function setup(confirmAnswer: boolean) {
    const hangar = jasmine.createSpyObj('HangarService', ['updateShip', 'pinShip', 'removeShip'], { error: signal(null), ships: signal([SHIP]) });
    hangar.removeShip.and.resolveTo(true);
    hangar.pinShip.and.resolveTo(true);
    hangar.updateShip.and.resolveTo(true);
    const confirm = jasmine.createSpyObj('ScConfirmService', ['confirm', 'prompt']);
    confirm.confirm.and.resolveTo(confirmAnswer);
    confirm.prompt.and.resolveTo('Mein Gladius');
    const ownership = jasmine.createSpyObj('HqOwnershipService', ['configsForShip', 'invalidate']);
    ownership.configsForShip.and.returnValue([{ id: 'c1' }, { id: 'c2' }]);
    TestBed.configureTestingModule({
      imports: [CodexOwnShipActionsComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: HangarService, useValue: hangar },
        { provide: ScConfirmService, useValue: confirm },
        { provide: HqOwnershipService, useValue: ownership },
      ],
    });
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(CodexOwnShipActionsComponent);
    fixture.componentRef.setInput('ship', SHIP);
    fixture.detectChanges();
    return { fixture, hangar, confirm, nav };
  }

  const click = (fixture: { nativeElement: HTMLElement }, cls: string): void =>
    (fixture.nativeElement.querySelector(`button.${cls}`) as HTMLButtonElement).click();

  afterEach(() => TestBed.resetTestingModule());

  it('renders rename, note, pin and remove as labelled icon buttons', () => {
    const { fixture } = setup(true);
    for (const c of ['own-rename', 'own-note', 'own-pin', 'own-remove']) {
      const b = fixture.nativeElement.querySelector(`button.${c}`) as HTMLElement | null;
      expect(b).withContext(c).not.toBeNull();
      expect(b!.getAttribute('aria-label')).withContext(c).toBeTruthy();
    }
  });

  it('asks a danger confirmation before removing, then goes back to the hangar list', async () => {
    const { fixture, hangar, confirm, nav } = setup(true);
    click(fixture, 'own-remove');
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
    expect(hangar.removeShip).toHaveBeenCalledWith('sh1');
    expect(nav).toHaveBeenCalledWith(['/hq/hangar']);
  });

  it('removes nothing when the confirmation is declined', async () => {
    const { fixture, hangar, nav } = setup(false);
    click(fixture, 'own-remove');
    await fixture.whenStable();
    expect(hangar.removeShip).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it('pins into the first free slot and renames through the prompt', async () => {
    const { fixture, hangar } = setup(true);
    click(fixture, 'own-pin');
    click(fixture, 'own-rename');
    await fixture.whenStable();
    expect(hangar.pinShip).toHaveBeenCalledWith('sh1', 1);
    expect(hangar.updateShip).toHaveBeenCalledWith('sh1', { customName: 'Mein Gladius' });
  });
});
