import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ConceptPageComponent } from './concept-page.component';
import { ConceptPageService, ConceptTicket, ConceptTicketFailure } from './concept-page.service';

/**
 * `/konzept/:id` (admin feedback #224): the page mints a ticket for the
 * concept id and frames the document the edge function serves. It never
 * renders concept content itself, so the assertions are about the frame
 * and the three failure copies.
 */
const ID = '2c8f6c5e-0b8d-4d7e-9c7a-4d9f1e2a3b4c';
const TICKET: ConceptTicket = {
  url: `https://example.supabase.co/functions/v1/concept-page/${ID}?t=abc`,
  title: 'Layout Bewaffnung',
  expiresAt: '2026-09-15T00:00:00Z',
};

async function mount(mint: () => Promise<ConceptTicket>) {
  await TestBed.configureTestingModule({
    imports: [ConceptPageComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: ID })) } },
      { provide: ConceptPageService, useValue: { mintTicket: mint } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ConceptPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('ConceptPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('frames the ticketed document once the ticket is minted', async () => {
    const mint = jasmine.createSpy('mintTicket').and.resolveTo(TICKET);
    const { cmp, el } = await mount(mint);

    expect(mint).toHaveBeenCalledWith(ID);
    expect(cmp.state()).toBe('ready');
    const frame = el.querySelector('iframe.frame') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute('src')).toBe(TICKET.url);
    // The document runs its own scripts and same-origin fetches, nothing more.
    expect(frame!.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame!.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(el.querySelector('.title')?.textContent?.trim()).toBe('Layout Bewaffnung');
  });

  it('keeps every navigation a real anchor', async () => {
    const { el } = await mount(() => Promise.resolve(TICKET));
    const back = el.querySelector('a.back') as HTMLAnchorElement | null;
    expect(back).not.toBeNull();
    expect(back!.getAttribute('href')).toBe('/admin/feedback');
    const open = el.querySelector('a.open') as HTMLAnchorElement | null;
    expect(open).not.toBeNull();
    expect(open!.getAttribute('href')).toBe(TICKET.url);
    expect(open!.getAttribute('target')).toBe('_blank');
    expect(open!.getAttribute('rel')).toContain('noopener');
  });

  it('shows the admin-only copy and no frame when the function refuses', async () => {
    const { cmp, el } = await mount(() => Promise.reject(new ConceptTicketFailure('forbidden')));
    expect(cmp.state()).toBe('forbidden');
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('a.open')).toBeNull();
    expect(el.querySelector('.msg.err')?.textContent).toContain('conceptPage.forbidden');
  });

  it('tells a missing concept apart from a broken one', async () => {
    const missing = await mount(() => Promise.reject(new ConceptTicketFailure('notFound')));
    expect(missing.el.querySelector('.msg.err')?.textContent).toContain('conceptPage.notFound');
    TestBed.resetTestingModule();
    const broken = await mount(() => Promise.reject(new Error('network')));
    expect(broken.cmp.state()).toBe('error');
    expect(broken.el.querySelector('.msg.err')?.textContent).toContain('conceptPage.error');
  });
});
