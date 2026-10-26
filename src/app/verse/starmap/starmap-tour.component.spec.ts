import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { StarmapTourComponent } from './starmap-tour.component';

@Component({
  imports: [StarmapTourComponent],
  template: `
    <section #map style="position: relative; height: 400px">
      <div data-tour="stage" style="height: 100px">stage</div>
      <span data-tour="count">3/7</span>
      <button data-tour="more" type="button">Logbuch</button>
      <sc-starmap-tour [root]="map" (closed)="closed = closed + 1" />
    </section>
  `,
})
class HostComponent {
  closed = 0;
}

describe('StarmapTourComponent', () => {
  let f: ComponentFixture<HostComponent>;
  const q = <T extends Element>(sel: string) => f.nativeElement.querySelector(sel) as T;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideTranslateService()] }).compileComponents();
    f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    await f.whenStable();
  });

  it('opens with three bullets and no ring', () => {
    expect(f.nativeElement.querySelectorAll('.points li').length).toBe(3);
    expect(q('.ring')).toBeNull();
    expect(q('.card').getAttribute('role')).toBe('dialog');
  });

  it('walks only the steps whose element is on the panel and rings the real element', async () => {
    q<HTMLButtonElement>('.row .btn').click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(q('.ring')).not.toBeNull();
    expect(q('.count')).not.toBeNull();
    // stage -> count -> more (tracks and series are absent from this panel): 3 steps
    const next = () => {
      const b = f.nativeElement.querySelectorAll('.row .btn');
      (b[1] as HTMLButtonElement).click();
      f.detectChanges();
    };
    next();
    next();
    const last = Array.from(f.nativeElement.querySelectorAll('.row .btn') as NodeListOf<HTMLButtonElement>).map((b) => b.textContent);
    expect(last.length).toBe(3);
  });

  it('closes on Escape', () => {
    q<HTMLElement>('.card').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.componentInstance.closed).toBe(1);
  });
});
