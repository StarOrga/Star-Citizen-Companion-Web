import { EnvironmentInjector, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Route, Routes } from '@angular/router';
import { of } from 'rxjs';
import { loadRouteCode, matchCount } from './route-code';
import { BetaService } from '../beta.service';

class Leaf {}

describe('loadRouteCode', () => {
  const injector = (): EnvironmentInjector => TestBed.inject(EnvironmentInjector);

  it('matches literal, param, full and wildcard paths', () => {
    expect(matchCount({ path: 'codex' }, ['codex', 'ship'])).toBe(1);
    expect(matchCount({ path: 'codex', pathMatch: 'full' }, ['codex', 'ship'])).toBe(-1);
    expect(matchCount({ path: 'codex/:kind/:className' }, ['codex', 'ship', 'x'])).toBe(3);
    expect(matchCount({ path: 'codex/:kind/:className' }, ['codex', 'ship'])).toBe(-1);
    expect(matchCount({ path: '' }, ['verse'])).toBe(0);
    expect(matchCount({ path: '**' }, ['a', 'b'])).toBe(2);
  });

  it('loads the matched leaf and its layout parent, never a sibling layout', async () => {
    const publicLayout = vi.fn(() => Promise.resolve(Leaf));
    const shell = vi.fn(() => Promise.resolve(Leaf));
    const codex = vi.fn(() => Promise.resolve(Leaf));
    const routes: Routes = [
      { path: '', pathMatch: 'full', redirectTo: 'verse' },
      { path: '', loadComponent: publicLayout, children: [{ path: 'about', loadComponent: () => Promise.resolve(Leaf) }] },
      { path: '', loadComponent: shell, children: [{ path: 'codex', pathMatch: 'full', loadComponent: codex }] },
    ];
    const res = await loadRouteCode(routes, ['codex'], injector());
    expect(res.leaf?.path).toBe('codex');
    expect(codex).toHaveBeenCalledTimes(1);
    expect(shell).toHaveBeenCalledTimes(1);
    expect(publicLayout).not.toHaveBeenCalled();
  });

  it('follows lazy children (Promise or Observable) and string redirects', async () => {
    const hub = vi.fn(() => Promise.resolve(Leaf));
    const children = vi.fn(() => of([{ path: '', pathMatch: 'full', loadComponent: hub }] as Routes));
    const routes: Routes = [
      { path: '', pathMatch: 'full', redirectTo: 'verse' },
      { path: 'verse', loadChildren: children },
    ];
    const res = await loadRouteCode(routes, [], injector());
    expect(res.leaf?.loadComponent).toBe(hub);
    expect(children).toHaveBeenCalledTimes(1);
    expect(hub).toHaveBeenCalledTimes(1);
  });

  it('calls each loader once across walks', async () => {
    const load = vi.fn(() => Promise.resolve(Leaf));
    const routes: Routes = [{ path: 'hq', loadComponent: load }];
    await loadRouteCode(routes, ['hq'], injector());
    await loadRouteCode(routes, ['hq'], injector());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('skips a route whose canMatch does not answer true synchronously', async () => {
    const beta = vi.fn(() => Promise.resolve(Leaf));
    const plain = vi.fn(() => Promise.resolve(Leaf));
    const off: Route['canMatch'] = [() => inject(BetaService).isEnabled('shell')()];
    TestBed.configureTestingModule({ providers: [{ provide: BetaService, useValue: { isEnabled: () => () => false } }] });
    const routes: Routes = [
      { path: 'codex/upcoming', canMatch: off, loadComponent: beta },
      { path: 'codex/upcoming', canMatch: [() => Promise.resolve(true)], loadComponent: plain },
      { path: 'codex/upcoming', loadComponent: plain },
    ];
    const res = await loadRouteCode(routes, ['codex', 'upcoming'], injector());
    expect(beta).not.toHaveBeenCalled();
    expect(plain).toHaveBeenCalledTimes(1);
    expect(res.leaf).toBe(routes[2]);
  });

  it('swallows a failed import and answers no leaf for an unknown path', async () => {
    const routes: Routes = [{ path: 'x', loadComponent: () => Promise.reject(new Error('chunk')) }];
    await expect(loadRouteCode(routes, ['x'], injector())).resolves.toBeTruthy();
    expect((await loadRouteCode(routes, ['nope'], injector())).leaf).toBeNull();
  });
});
