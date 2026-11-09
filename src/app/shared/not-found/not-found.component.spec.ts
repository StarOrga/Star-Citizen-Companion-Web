import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { NotFoundComponent } from './not-found.component';

describe('NotFoundComponent', () => {
  function setup(inputs: Record<string, unknown>) {
    TestBed.configureTestingModule({ imports: [NotFoundComponent], providers: [provideRouter([]), provideTranslateService()] });
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.componentRef.setInput('titleKey', 't.title');
    fixture.componentRef.setInput('bodyKey', 't.body');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the heading as the h1, one line and a real anchor with the query', () => {
    const el = setup({ back: { labelKey: 'x.list', link: '/codex/index', queryParams: { kind: 'ship' } } });
    expect(el.querySelector('h1')?.textContent).toContain('t.title');
    expect(el.querySelector('p')?.textContent).toContain('t.body');
    const a = el.querySelector('a.nf-back') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/codex/index?kind=ship');
  });

  it('uses an h2 when the page already has its h1, and omits the anchor without a target', () => {
    const el = setup({ level: 2 });
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelector('h2')?.textContent).toContain('t.title');
    expect(el.querySelector('a')).toBeNull();
  });
});
