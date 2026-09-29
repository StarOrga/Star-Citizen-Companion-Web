import { TestBed } from '@angular/core/testing';
import { StarscapeTilesService } from './starscape-tiles.service';

/** The service is pure render state — no Supabase, no network. */
describe('StarscapeTilesService', () => {
  let svc: StarscapeTilesService;
  const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h }) as HTMLImageElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(StarscapeTilesService);
  });

  it('markDecoded records the id and lifts it out of broken()', () => {
    svc.markBroken('a');
    expect(svc.broken().has('a')).toBeTrue();
    svc.markDecoded('a');
    expect(svc.decoded().has('a')).toBeTrue();
    expect(svc.broken().has('a')).toBeFalse();
  });

  it('a second markDecoded keeps the same set instance (no redundant signal write)', () => {
    svc.markDecoded('a');
    const first = svc.decoded();
    svc.markDecoded('a');
    expect(svc.decoded()).toBe(first);
  });

  it('markBroken never demotes a tile that already painted', () => {
    svc.markDecoded('a');
    svc.markBroken('a');
    expect(svc.broken().has('a')).toBeFalse();
    svc.markBroken('b');
    expect(svc.broken().has('b')).toBeTrue();
  });

  it('clearBroken clears the given ids, or every id when omitted', () => {
    for (const id of ['a', 'b', 'c']) svc.markBroken(id);
    svc.clearBroken(['a']);
    expect([...svc.broken()].sort()).toEqual(['b', 'c']);
    svc.clearBroken();
    expect(svc.broken().size).toBe(0);
  });

  it('bumpRetry counts up and retrySuffix reads #r<n>', () => {
    expect(svc.retrySuffix('a')).toBe('');
    svc.bumpRetry(['a', 'b']);
    expect(svc.retrySuffix('a')).toBe('#r1');
    svc.bumpRetry(['a']);
    expect(svc.retrySuffix('a')).toBe('#r2');
    expect(svc.retrySuffix('b')).toBe('#r1');
    expect(svc.retrySuffix('untouched')).toBe('');
    expect(svc.retrySuffix()).toBe('');
  });

  it('ratioOf keeps the first measurable ratio only', () => {
    expect(svc.ratioOf('a')).toBeNull();
    svc.markDecoded('a', img(0, 0));
    expect(svc.ratioOf('a')).toBeNull();
    svc.markDecoded('a', img(400, 200));
    expect(svc.ratioOf('a')).toBe(2);
    svc.markDecoded('a', img(100, 100));
    expect(svc.ratioOf('a')).toBe(2);
  });

  it('markDecoded without an element records no ratio', () => {
    svc.markDecoded('a', null);
    expect(svc.decoded().has('a')).toBeTrue();
    expect(svc.ratioOf('a')).toBeNull();
  });
});
