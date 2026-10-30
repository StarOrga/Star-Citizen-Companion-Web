import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { OVERLAY_ROUTE_DATA } from '../overlay-route-scroll';
import { LayoutService } from './layout.service';
import { LAYOUT_TRACK, PAGE_LAYOUTS } from './page-layout';

@Component({ standalone: true, template: '' })
class Stub {}

const routes: Routes = [
  { path: 'stage', component: Stub, data: { layout: 'cinematic' } },
  { path: 'bare', component: Stub },
  {
    path: 'parent',
    component: Stub,
    data: { layout: 'tool' },
    children: [
      { path: 'child', component: Stub, data: { layout: 'content' } },
      { path: 'inherit', component: Stub },
      { path: 'over', component: Stub, data: { layout: 'overlay', [OVERLAY_ROUTE_DATA]: true } },
    ],
  },
];

describe('LayoutService', () => {
  let router: Router;
  let service: LayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    router = TestBed.inject(Router);
    service = TestBed.inject(LayoutService);
  });

  it('falls back to content before any navigation and for routes without data', async () => {
    expect(service.layout()).toBe('content');
    await router.navigateByUrl('/bare');
    expect(service.layout()).toBe('content');
  });

  it('reads the layout of the active route', async () => {
    await router.navigateByUrl('/stage');
    expect(service.layout()).toBe('cinematic');
    expect(service.track()).toBe('full');
  });

  it('lets the deepest declaration win and inherits from the parent otherwise', async () => {
    await router.navigateByUrl('/parent/child');
    expect(service.layout()).toBe('content');
    await router.navigateByUrl('/parent/inherit');
    expect(service.layout()).toBe('tool');
    // Two widths only: a tool page sits in B like every non-stage page.
    expect(service.track()).toBe('narrow');
  });

  it('ignores the layout of a routed overlay child', async () => {
    await router.navigateByUrl('/parent/over');
    expect(service.layout()).toBe('tool');
  });

  it('maps every layout to a track', () => {
    for (const l of PAGE_LAYOUTS) expect(LAYOUT_TRACK[l]).toBeTruthy();
  });

  it('knows only the two beta widths: the stage spans full, everything else B', () => {
    for (const l of PAGE_LAYOUTS) expect(LAYOUT_TRACK[l]).toBe(l === 'cinematic' ? 'full' : 'narrow');
  });
});
