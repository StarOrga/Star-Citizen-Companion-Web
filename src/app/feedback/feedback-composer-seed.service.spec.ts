import { TestBed } from '@angular/core/testing';
import { FeedbackComposerSeedService } from './feedback-composer-seed.service';

describe('FeedbackComposerSeedService', () => {
  let svc: FeedbackComposerSeedService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FeedbackComposerSeedService);
  });

  it('hands a planted seed to exactly one taker', () => {
    svc.plant('admin:new', { body: 'hello', area: 'desktop' });
    expect(svc.pendingScopes().has('admin:new')).toBe(true);

    expect(svc.take('admin:new')).toEqual({ body: 'hello', area: 'desktop' });
    // One-shot: the full board and the docked panel share this scope, and the
    // second composer must find nothing.
    expect(svc.take('admin:new')).toBeNull();
    expect(svc.pendingScopes().has('admin:new')).toBe(false);
  });

  it('keeps seeds per scope apart and lets a newer seed replace an older one', () => {
    svc.plant('admin:new', { body: 'one' });
    svc.plant('user:new', { body: 'other' });
    svc.plant('admin:new', { body: 'two' });
    expect(svc.take('admin:new')?.body).toBe('two');
    expect(svc.take('user:new')?.body).toBe('other');
  });

  it('counts open requests so every request is observable', () => {
    expect(svc.openRequests()).toBe(0);
    svc.requestOpen();
    svc.requestOpen();
    expect(svc.openRequests()).toBe(2);
  });
});
