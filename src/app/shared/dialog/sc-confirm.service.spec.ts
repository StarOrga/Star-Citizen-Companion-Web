import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideTranslateService } from '@ngx-translate/core';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';
import {
  SC_CONFIRM_DEFAULT_CANCEL_KEY,
  SC_CONFIRM_DEFAULT_CONFIRM_KEY,
  ScConfirmService,
} from './sc-confirm.service';

describe('ScConfirmService', () => {
  let service: ScConfirmService;
  let overlayContainer: OverlayContainer;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    service = TestBed.inject(ScConfirmService);
    overlayContainer = TestBed.inject(OverlayContainer);
    overlayContainer.getContainerElement();
  });

  afterEach(() => overlayContainer.ngOnDestroy());

  // The dialog may live in the overlay container or (popover mode) in a
  // popover host next to it — search the whole document.
  const q = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
  const tick = () => new Promise<void>((r) => setTimeout(r));
  const settle = async () => {
    await tick();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  };

  it('resolves true on confirm', async () => {
    const p = service.confirm({ titleKey: 't' });
    await settle();
    q<HTMLButtonElement>('sc-confirm-dialog .confirm')!.click();
    expect(await p).toBeTrue();
    expect(q('sc-confirm-dialog')).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const p = service.confirm({ titleKey: 't' });
    await settle();
    q<HTMLButtonElement>('sc-confirm-dialog .cancel')!.click();
    expect(await p).toBeFalse();
  });

  it('resolves false on Escape', async () => {
    const p = service.confirm({ titleKey: 't' });
    await settle();
    q('sc-confirm-dialog .cancel')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(await p).toBeFalse();
  });

  it('resolves false on a backdrop click', async () => {
    const p = service.confirm({ titleKey: 't' });
    await settle();
    q<HTMLElement>('.sc-dialog-backdrop')!.click();
    expect(await p).toBeFalse();
  });

  it('renders an alertdialog labelled by its title and described by its message', async () => {
    const p = service.confirm({ titleKey: 't', messageKey: 'm' });
    await settle();
    const form = q<HTMLElement>('sc-confirm-dialog form')!;
    expect(form.getAttribute('role')).toBe('alertdialog');
    expect(q(`#${form.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe('t');
    expect(q(`#${form.getAttribute('aria-describedby')}`)?.textContent?.trim()).toBe('m');
    q<HTMLButtonElement>('sc-confirm-dialog .cancel')!.click();
    await p;
  });

  it("focuses Cancel for tone 'danger' and Confirm otherwise", async () => {
    let p = service.confirm({ titleKey: 't', tone: 'danger' });
    await settle();
    expect(document.activeElement).toBe(q('sc-confirm-dialog .cancel'));
    expect(q('sc-confirm-dialog .confirm')!.classList).toContain('danger');
    q<HTMLButtonElement>('sc-confirm-dialog .cancel')!.click();
    await p;

    p = service.confirm({ titleKey: 't' });
    await settle();
    expect(document.activeElement).toBe(q('sc-confirm-dialog .confirm'));
    q<HTMLButtonElement>('sc-confirm-dialog .cancel')!.click();
    await p;
  });

  it('prompt resolves the typed text, and null on cancel', async () => {
    let p = service.prompt({ titleKey: 't', inputLabelKey: 'l' });
    await settle();
    const input = q<HTMLInputElement>('sc-confirm-dialog input')!;
    expect(document.activeElement).toBe(input);
    input.value = ' alt ';
    input.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>('sc-confirm-dialog .confirm')!.click();
    expect(await p).toBe(' alt ');

    p = service.prompt({ titleKey: 't', inputLabelKey: 'l' });
    await settle();
    q<HTMLButtonElement>('sc-confirm-dialog .cancel')!.click();
    expect(await p).toBeNull();
  });

  it('resolves a second call while one is open as cancelled', async () => {
    const first = service.confirm({ titleKey: 't' });
    await settle();
    expect(await service.confirm({ titleKey: 't2' })).toBeFalse();
    expect(document.querySelectorAll('sc-confirm-dialog').length).toBe(1);
    q<HTMLButtonElement>('sc-confirm-dialog .confirm')!.click();
    expect(await first).toBeTrue();
  });

  it('ships the default button keys in both catalogues', () => {
    const get = (cat: unknown, key: string) =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cat);
    for (const key of [SC_CONFIRM_DEFAULT_CONFIRM_KEY, SC_CONFIRM_DEFAULT_CANCEL_KEY]) {
      expect(typeof get(de, key)).withContext(`de ${key}`).toBe('string');
      expect(typeof get(en, key)).withContext(`en ${key}`).toBe('string');
    }
  });
});
