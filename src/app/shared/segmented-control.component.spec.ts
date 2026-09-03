import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ScSegmentOption, ScSegmentedComponent } from './segmented-control.component';

const BUTTON_OPTIONS: ScSegmentOption[] = [
  { value: 'all', labelKey: 'starscape.filterAll' },
  { value: 'series:Release Info', label: 'Release Info' },
  { value: 'series:Roadmap Roundup', label: 'Roadmap Roundup' },
];

describe('ScSegmentedComponent', () => {
  function setup(
    options: ScSegmentOption[] = BUTTON_OPTIONS,
    value = 'all',
  ): ComponentFixture<ScSegmentedComponent> {
    TestBed.configureTestingModule({
      imports: [ScSegmentedComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    const f = TestBed.createComponent(ScSegmentedComponent);
    f.componentRef.setInput('options', options);
    f.componentRef.setInput('value', value);
    f.componentRef.setInput('ariaLabel', 'Image source');
    f.detectChanges();
    return f;
  }

  function segments(f: ComponentFixture<ScSegmentedComponent>): HTMLElement[] {
    return Array.from(f.nativeElement.querySelectorAll('.seg-btn'));
  }

  it('is a radio group of real buttons when picking is a client-side action', () => {
    const f = setup();
    const group = f.nativeElement.querySelector('.seg') as HTMLElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Image source');
    const btns = segments(f);
    expect(btns.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(btns.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // Roving tabindex: one tab stop for the whole group, as a radio group has.
    expect(btns.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    f.destroy();
  });

  it('emits the picked value once, and never re-emits the current one', () => {
    const f = setup();
    const seen: string[] = [];
    f.componentInstance.valueChange.subscribe((v: string) => seen.push(v));
    segments(f)[1].click();
    segments(f)[0].click(); // already selected — a no-op, not a reload
    expect(seen).toEqual(['series:Release Info']);
    f.destroy();
  });

  it('moves the selection with the arrow keys, wrapping at both ends', () => {
    const f = setup();
    const seen: string[] = [];
    f.componentInstance.valueChange.subscribe((v: string) => seen.push(v));
    const group = f.nativeElement.querySelector('.seg') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(seen).toEqual(['series:Release Info', 'series:Roadmap Roundup', 'series:Roadmap Roundup']);
    f.destroy();
  });

  it('scrolls inside its slot instead of widening it', () => {
    const f = setup([
      { value: 'all', label: 'All the wallpapers there have ever been' },
      { value: 'a', label: 'Release Info' },
      { value: 'b', label: 'Roadmap Roundup' },
    ]);
    // What a phone row does: hand the control a slot narrower than its labels.
    const host = f.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = '320px';
    const seg = f.nativeElement.querySelector('.seg') as HTMLElement;
    // It must stay inside the slot — a control that grows past its column is
    // what pushes whatever shares the row off screen.
    expect(seg.offsetWidth).toBeLessThanOrEqual(320);
    // ...and the segments must still all be there, reachable by scrolling the
    // pill, rather than squeezed into ellipses.
    expect(seg.scrollWidth).toBeGreaterThan(seg.offsetWidth);
    expect(segments(f).every((b) => b.offsetWidth > 0)).toBeTrue();
    f.destroy();
  });

  it('renders anchors when the state lives in the URL', () => {
    const f = setup(
      [7, 30, 90].map((days) => ({
        value: String(days),
        labelKey: `telemetry.window.short.${days}`,
        titleKey: `telemetry.window.${days}`,
        link: { commands: [], queryParams: { days }, queryParamsHandling: 'merge' as const },
      })),
      '30',
    );
    const links = segments(f);
    // Middle click and "open in new tab" are browser features that only work on
    // an anchor — a bookmarkable range must never be a click handler.
    expect(links.map((l) => l.tagName)).toEqual(['A', 'A', 'A']);
    expect(links[1].getAttribute('aria-current')).toBe('true');
    expect(links[0].getAttribute('aria-current')).toBeNull();
    // A group of links is not a radio group, and links keep the browser's own
    // tab order rather than a roving tabindex.
    expect((f.nativeElement.querySelector('.seg') as HTMLElement).getAttribute('role')).toBe('group');
    expect(links[0].getAttribute('tabindex')).toBeNull();
    f.destroy();
  });
});
