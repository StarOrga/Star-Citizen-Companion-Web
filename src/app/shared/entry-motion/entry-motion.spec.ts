import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EntryMotionService, ScEntryDirective } from './entry-motion';

@Component({ standalone: true, imports: [ScEntryDirective], template: `<div [scEntry]="key"><i class="ce"></i></div>` })
class HostComponent {
  key = 'spec-page';
}

describe('entry motion', () => {
  beforeEach(() => localStorage.removeItem('sc.entry.seen'));
  afterEach(() => localStorage.removeItem('sc.entry.seen'));

  it('the first open of a page kind is cinematic, every later one is quick', () => {
    const svc = TestBed.inject(EntryMotionService);
    // Reduced motion is the machine's setting: the cinematic/quick pair only exists without it.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(svc.tempoFor('x')).toBe('still');
      return;
    }
    expect(svc.tempoFor('a')).toBe('cine');
    expect(svc.tempoFor('a')).toBe('quick');
    expect(svc.tempoFor('b')).toBe('cine');
  });

  it('the directive sets data-entry on the page root', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const root = (f.nativeElement as HTMLElement).querySelector('div')!;
    expect(['cine', 'quick', 'still']).toContain(root.getAttribute('data-entry')!);
    const second = TestBed.createComponent(HostComponent);
    second.detectChanges();
    const tempo = (second.nativeElement as HTMLElement).querySelector('div')!.getAttribute('data-entry');
    expect(tempo).toBe(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'quick');
  });
});
