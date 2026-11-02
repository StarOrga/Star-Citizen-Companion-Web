import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HQ_FIRST_SKIPPED_KEY, HqStartComponent } from './hq-start.component';

describe('HqStartComponent first-visit block', () => {
  beforeEach(() => localStorage.removeItem(HQ_FIRST_SKIPPED_KEY));
  afterEach(() => localStorage.removeItem(HQ_FIRST_SKIPPED_KEY));

  async function mount(opts: { ships: number; app: boolean; einsaetze: number; einsatzReady?: boolean }) {
    const einsatz = {
      items: signal(Array.from({ length: opts.einsaetze }, (_, i) => ({ id: `e${i}` }))),
      ready: signal(opts.einsatzReady ?? true),
      syncError: signal<string | null>(null),
    };
    TestBed.configureTestingModule({
      imports: [HqStartComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        {
          provide: HangarService,
          useValue: {
            ships: signal(Array.from({ length: opts.ships }, (_, i) => ({ id: `s${i}` }))),
            roleLoadouts: signal([]),
            loadAll: () => Promise.resolve(),
          },
        },
        {
          provide: DesktopConnectionService,
          useValue: { connections: signal(opts.app ? [{ product: 'uploader' }] : []), refresh: () => Promise.resolve() },
        },
        { provide: HqEinsatzService, useValue: einsatz },
      ],
    });
    const f = TestBed.createComponent(HqStartComponent);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, einsatz };
  }

  it('stays while ONE step is still open and ticks the done ones', async () => {
    const { el } = await mount({ ships: 2, app: true, einsaetze: 0 });
    expect(el.querySelector('sc-hq-first-visit')).not.toBeNull();
    expect(el.querySelectorAll('.step.done').length).toBe(2);
  });

  it('is gone once all three steps are done', async () => {
    const { el } = await mount({ ships: 1, app: true, einsaetze: 1 });
    expect(el.querySelector('sc-hq-first-visit')).toBeNull();
  });

  it('waits for the first Einsatz pull before deciding', async () => {
    const { f, el, einsatz } = await mount({ ships: 1, app: true, einsaetze: 0, einsatzReady: false });
    expect(el.querySelector('sc-hq-first-visit')).toBeNull();
    einsatz.items.set([{ id: 'e1' }]);
    einsatz.ready.set(true);
    f.detectChanges();
    expect(el.querySelector('sc-hq-first-visit')).toBeNull();
  });

  it('stays hidden after "Überspringen"', async () => {
    localStorage.setItem(HQ_FIRST_SKIPPED_KEY, '1');
    const { el } = await mount({ ships: 0, app: false, einsaetze: 0 });
    expect(el.querySelector('sc-hq-first-visit')).toBeNull();
  });
});
