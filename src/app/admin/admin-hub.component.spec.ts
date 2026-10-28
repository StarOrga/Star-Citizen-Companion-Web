import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AdminHubComponent } from './admin-hub.component';

describe('AdminHubComponent', () => {
  it('links every admin page as a real anchor, Benutzer and Telemetrie first', () => {
    TestBed.configureTestingModule({
      imports: [AdminHubComponent],
      providers: [provideTranslateService(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AdminHubComponent);
    fixture.detectChanges();
    const tiles = Array.from(fixture.nativeElement.querySelectorAll('a.tile')) as HTMLAnchorElement[];
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/telemetry',
      '/admin/feedback',
      '/admin/api-tokens',
      '/uploader',
    ]);
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
  });
});

describe('AdminHubComponent stage slot (beta shell)', () => {
  afterEach(() => localStorage.removeItem('sc.beta'));

  function render(shell: boolean) {
    localStorage.setItem('sc.beta', JSON.stringify({ shell }));
    TestBed.configureTestingModule({
      imports: [AdminHubComponent],
      providers: [provideTranslateService(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AdminHubComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('stands the search slot UNDER the hero title, not above it', () => {
    const el = render(true);
    const h1 = el.querySelector('h1')!;
    const slot = el.querySelector('[data-stage-slot]')!;
    expect(slot).withContext('slot rendered with the shell β on').not.toBeNull();
    expect(h1.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves no sized slot behind with the shell β off', () => {
    const el = render(false);
    expect(el.querySelector('[data-stage-slot]')).toBeNull();
  });
});
