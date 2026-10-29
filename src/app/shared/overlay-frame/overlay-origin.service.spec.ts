import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { OverlayOriginService } from './overlay-origin.service';

@Component({ standalone: true, template: '' })
class StubComponent {}

describe('OverlayOriginService.close', () => {
  let router: Router;
  let origin: OverlayOriginService;
  let location: Location;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'verse/gallery', component: StubComponent },
          { path: 'verse/gallery/:id', component: StubComponent },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    origin = TestBed.inject(OverlayOriginService);
    location = TestBed.inject(Location);
    await router.navigateByUrl('/verse/gallery');
  });

  it('goes history-back when the entry before the overlay is the list', async () => {
    origin.fromList();
    await router.navigateByUrl('/verse/gallery/a');
    const back = spyOn(location, 'back');
    const nav = spyOn(router, 'navigate').and.callThrough();
    origin.close(['/verse/gallery']);
    expect(back).toHaveBeenCalledTimes(1);
    expect(nav).not.toHaveBeenCalled();
  });

  it('keeps the list as predecessor when prev/next replace the entry', async () => {
    origin.fromList();
    await router.navigateByUrl('/verse/gallery/a');
    await router.navigate(['/verse/gallery', 'b'], { replaceUrl: true });
    await router.navigate(['/verse/gallery', 'c'], { replaceUrl: true });
    const back = spyOn(location, 'back');
    origin.close(['/verse/gallery']);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('replaces the overlay with the list on a direct load instead of pushing', async () => {
    await router.navigateByUrl('/verse/gallery/a', { replaceUrl: true });
    const back = spyOn(location, 'back');
    const nav = spyOn(router, 'navigate').and.callThrough();
    origin.close(['/verse/gallery']);
    expect(back).not.toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/verse/gallery'], jasmine.objectContaining({ replaceUrl: true }));
  });

  it('keeps the overlay flag across prev/next inside the list path', async () => {
    origin.fromList();
    await router.navigateByUrl('/verse/gallery/a');
    expect(origin.overlaid()).toBeTrue();
    await router.navigateByUrl('/verse/gallery/b');
    expect(origin.overlaid()).toBeTrue();
  });
});
