import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { LightboxComponent } from './lightbox.component';

describe('LightboxComponent', () => {
  let fixture: ComponentFixture<LightboxComponent>;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LightboxComponent],
      providers: [provideRouter([]), provideTranslateService()],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(LightboxComponent);
    fixture.componentRef.setInput('image', {
      title: 'Idris', sourceUrl: '/o.jpg', previewUrl: '/p.jpg', articleUrl: 'https://example.com/a',
    });
    fixture.componentRef.setInput('prev', { commands: ['/verse/gallery', 'a'] });
    fixture.componentRef.setInput('next', { commands: ['/verse/gallery', 'c'] });
    fixture.detectChanges();
  });

  const press = (key: string): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev;
  };

  it('ArrowRight / ArrowLeft navigate to the neighbours and replace the history entry', () => {
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    press('ArrowRight');
    expect(nav).toHaveBeenCalledWith(['/verse/gallery', 'c'], { replaceUrl: true });
    press('ArrowLeft');
    expect(nav).toHaveBeenCalledWith(['/verse/gallery', 'a'], { replaceUrl: true });
  });

  it('ignores arrows with a modifier and in text fields', () => {
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    input.remove();
    expect(nav).not.toHaveBeenCalled();
  });

  it('renders prev/next, download and RSI as real anchors', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('a.edge[href]').length).toBe(2);
    expect(el.querySelector('a.ab[download]')?.getAttribute('href')).toBe('/o.jpg');
    expect(el.querySelector('a.ab:not([download])')?.getAttribute('href')).toBe('https://example.com/a');
  });

  it('emits closed from the close button', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.ib:last-of-type')?.click();
    expect(closed).toBe(1);
  });
});
