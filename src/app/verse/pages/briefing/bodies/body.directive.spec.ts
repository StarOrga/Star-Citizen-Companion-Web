import type { Mock } from 'vitest';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BodyEngine } from './body-engine';
import { ENGINE_LINGER_MS, VerseBodiesService } from './body.directive';

describe('VerseBodiesService', () => {
  let create: Mock, dispose: Mock;
  const canvas = () => document.createElement('canvas');

  beforeEach(() => {
    dispose = vi.fn().mockName('dispose');
    const engine = { attach: () => () => undefined, dispose, redraw: () => undefined } as unknown as BodyEngine;
    create = vi.spyOn(BodyEngine, 'create').mockReturnValue(engine);
  });

  it('keeps the engine when the last body leaves: the next visit needs no new context', fakeAsync(() => {
    const bodies = TestBed.inject(VerseBodiesService);
    const detach = bodies.attach(canvas(), 'sun', () => undefined);
    detach();
    tick(ENGINE_LINGER_MS - 1);
    expect(dispose).not.toHaveBeenCalled();
    const again = bodies.attach(canvas(), 'sun', () => undefined);
    expect(create).toHaveBeenCalledTimes(1);
    tick(ENGINE_LINGER_MS);
    expect(dispose, 'a body is back').not.toHaveBeenCalled();
    again();
    tick(ENGINE_LINGER_MS);
  }));

  it('gives the context back when the reader stays away', fakeAsync(() => {
    const bodies = TestBed.inject(VerseBodiesService);
    bodies.attach(canvas(), 'sun', () => undefined)();
    tick(ENGINE_LINGER_MS);
    expect(dispose).toHaveBeenCalledTimes(1);
    bodies.attach(canvas(), 'sun', () => undefined)();
    expect(create).toHaveBeenCalledTimes(2);
    tick(ENGINE_LINGER_MS);
  }));
});
