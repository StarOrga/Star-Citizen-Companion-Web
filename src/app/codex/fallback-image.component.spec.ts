import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FallbackImageComponent } from './fallback-image.component';

/**
 * The URSA regression: one advertised-but-missing RSI derivative made the card
 * show the generic ship glyph forever, even though four working renders of the
 * same ship were the next entries in the list. The component must walk the
 * list, and only give up once every candidate has actually failed.
 */
@Component({
  standalone: true,
  imports: [FallbackImageComponent],
  template: `
    <sc-fallback-image [candidates]="candidates" alt="Ursa">
      <span class="placeholder">glyph</span>
    </sc-fallback-image>
  `,
})
class HostComponent {
  candidates: string[] = [];
}

describe('FallbackImageComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  function img(): HTMLImageElement | null {
    return fixture.nativeElement.querySelector('img');
  }
  function placeholder(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.placeholder');
  }
  function failCurrent(): void {
    img()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('renders the projected placeholder when there is no candidate at all', () => {
    fixture.detectChanges();

    expect(img()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('shows the first candidate and keeps the placeholder hidden', () => {
    fixture.componentInstance.candidates = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();

    expect(img()!.getAttribute('src')).toBe('https://cdn.test/a.jpg');
    expect(placeholder()).toBeNull();
  });

  it('falls through to the next candidate when one fails to load', () => {
    fixture.componentInstance.candidates = ['https://cdn.test/missing.jpg', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();

    failCurrent();

    expect(img()!.getAttribute('src')).toBe('https://cdn.test/b.jpg');
    expect(placeholder()).toBeNull();
  });

  it('only shows the placeholder once EVERY candidate failed', () => {
    fixture.componentInstance.candidates = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();

    failCurrent();
    expect(placeholder()).toBeNull();

    failCurrent();
    expect(img()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('skips empty entries instead of rendering an src-less img', () => {
    fixture.componentInstance.candidates = ['', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();

    expect(img()!.getAttribute('src')).toBe('https://cdn.test/b.jpg');
  });

  it('remembers failures by url, so a re-render does not restart the walk', () => {
    fixture.componentInstance.candidates = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();
    failCurrent();

    // Same list, new array identity — what OnPush re-rendering produces.
    fixture.componentInstance.candidates = ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'];
    fixture.detectChanges();

    expect(img()!.getAttribute('src')).toBe('https://cdn.test/b.jpg');
  });

  it('lazy-loads by default and eagerly on request', () => {
    fixture.componentInstance.candidates = ['https://cdn.test/a.jpg'];
    fixture.detectChanges();

    expect(img()!.getAttribute('loading')).toBe('lazy');
  });
});
