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
