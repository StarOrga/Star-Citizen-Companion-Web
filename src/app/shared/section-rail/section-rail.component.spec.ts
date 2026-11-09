import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';
import { SectionRailComponent, SectionRailGo, SectionRailItem } from './section-rail.component';

const ITEMS: SectionRailItem[] = [
  { id: 'a', href: '/page#a', label: 'Alpha', short: 'Al', icon: 'M0 0h1', active: true, current: 'location' },
  { id: 'b', href: '/page#b', label: 'Beta', icon: 'M0 0h1', active: false, ariaLabel: 'Go to Beta', dot: 'Open events' },
];

@Component({
  imports: [SectionRailComponent],
  template: `<div [class.pm-on]="motion()"><sc-section-rail [items]="items" ariaLabel="Sections" [variant]="variant()" (go)="onGo($event)" /></div>`,
})
class HostComponent {
  items = ITEMS;
  seen: SectionRailGo[] = [];
  motion = signal(false);
  /** The page decides: here it swallows the click so the test iframe never navigates. */
  onGo(go: SectionRailGo): void {
    go.event.preventDefault();
    this.seen.push(go);
  }
  variant = signal<'edge' | 'inline'>('edge');
}

function mount() {
  TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideTranslateService()] });
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  return f;
}

describe('SectionRailComponent', () => {
  it('renders every stop as a real anchor with the page url, icon and both names', () => {
    const el: HTMLElement = mount().nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a.stop'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/page#a', '/page#b']);
    expect(links.every((a) => a.querySelector('svg path'))).toBe(true);
    expect(links[0].querySelector('.full')!.textContent).toBe('Alpha');
    expect(links[0].querySelector('.short')!.textContent).toBe('Al');
    // No short name given: the full one stands in.
    expect(links[1].querySelector('.short')!.textContent).toBe('Beta');
    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Sections');
  });

  it('marks only the stop in view with aria-current and keeps the full name as the accessible one', () => {
    const el: HTMLElement = mount().nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a.stop'));
    expect(links[0].getAttribute('aria-current')).toBe('location');
    expect(links[1].hasAttribute('aria-current')).toBe(false);
    expect(links[0].getAttribute('aria-label')).toBe('Alpha');
    expect(links[1].getAttribute('aria-label')).toBe('Go to Beta');
  });

  it('shows a dot with an accessible name where the item asks for one', () => {
    const el: HTMLElement = mount().nativeElement;
    const dot = el.querySelector<HTMLElement>('a.stop:nth-child(2) .evdot')!;
    expect(dot.getAttribute('aria-label')).toBe('Open events');
    expect(el.querySelector('a.stop:nth-child(1) .evdot')).toBeNull();
  });

  it('reports the click with the item and leaves the default to the page', () => {
    const f = mount();
    const link = (f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav a.stop')[1];
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(ev);
    expect(f.componentInstance.seen.length).toBe(1);
    expect(f.componentInstance.seen[0].item.id).toBe('b');
    // The click reaches the page untouched (the rail never prevents it itself): the page decides.
    expect(f.componentInstance.seen[0].event).toBe(ev);
  });

  it('marks the inline variant on its host', () => {
    const f = mount();
    f.componentInstance.variant.set('inline');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('sc-section-rail')!.classList.contains('inline')).toBe(true);
  });

  it('glides the icons in one after the other only when the page root carries the motion class', () => {
    const f = mount();
    const first = (f.nativeElement as HTMLElement).querySelector<HTMLElement>('a.stop')!;
    expect(getComputedStyle(first).animationName).toBe('none');
    f.componentInstance.motion.set(true);
    f.detectChanges();
    const second = (f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('a.stop')[1];
    expect(getComputedStyle(second).animationName).not.toBe('none');
    // 60 ms between two icons (rounds/05 d5-pb-minor-ri*).
    expect(getComputedStyle(second).animationDelay).toBe('0.06s');
    expect(getComputedStyle(first).animationDelay).toBe('0s');
  });
});
