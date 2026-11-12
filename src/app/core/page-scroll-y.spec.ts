import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideTranslateService } from '@ngx-translate/core';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { CDK_SCROLL_BLOCK_CLASS, pageScrollY } from './page-scroll-y';

/** #336: a confirm dialog over a scrolled page must not read as "back at the top". */
describe('pageScrollY (#336)', () => {
  let spacer: HTMLDivElement;
  let overlayContainer: OverlayContainer;

  const settle = async () => {
    await new Promise<void>((r) => setTimeout(r));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    overlayContainer = TestBed.inject(OverlayContainer);
    spacer = document.createElement('div');
    spacer.style.height = '5000px';
    document.body.appendChild(spacer);
    window.scrollTo({ top: 600, behavior: 'instant' });
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    spacer.remove();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  it('is the window scroll without a blocking overlay', () => {
    expect(window.scrollY).toBe(600);
    expect(pageScrollY()).toBe(600);
  });

  it('keeps the frozen depth while a confirm dialog blocks the scroll, and after it closes', async () => {
    const service = TestBed.inject(ScConfirmService);
    const answer = service.confirm({ titleKey: 't', tone: 'danger' });
    await settle();

    const html = document.documentElement;
    expect(html.classList.contains(CDK_SCROLL_BLOCK_CLASS)).toBe(true);
    // The block pins <html> (window.scrollY reads 0 once its CSS applies); the page still stands at 600.
    expect(html.style.top).toBe('-600px');
    expect(pageScrollY()).toBe(600);

    (document.querySelector('sc-confirm-dialog .cancel') as HTMLButtonElement).click();
    expect(await answer).toBe(false);
    expect(html.classList.contains(CDK_SCROLL_BLOCK_CLASS)).toBe(false);
    expect(window.scrollY).toBe(600);
    expect(pageScrollY()).toBe(600);
  });
});
