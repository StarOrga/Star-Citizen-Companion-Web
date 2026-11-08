import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FeedbackAttachmentSignerService } from './feedback-attachment-signer.service';

const BASE = 'https://proj.supabase.co/storage/v1/object/public/feedback-images';

type Result = { data: unknown; error: unknown } | Error;

class FakeStorage {
  calls: string[][] = [];
  next: Result[] = [];

  readonly client = {
    storage: {
      from: () => ({
        createSignedUrls: (paths: string[]) => {
          this.calls.push([...paths]);
          const r = this.next.shift() ?? {
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}?t=1`, error: null })),
            error: null,
          };
          if (r instanceof Error) throw r;
          return Promise.resolve(r);
        },
      }),
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('FeedbackAttachmentSignerService', () => {
  let fake: FakeStorage;
  let svc: FeedbackAttachmentSignerService;

  beforeEach(() => {
    fake = new FakeStorage();
    spyOn(console, 'warn');
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 28, 12, 0, 0));
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseClientProvider, useValue: fake }],
    });
    svc = TestBed.inject(FeedbackAttachmentSignerService);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('batches every path asked for in one tick into one call', async () => {
    svc.request(['u1/a.jpg', 'u1/b.jpg']);
    svc.request(['u1/a.jpg', 'u1/c.jpg']);
    expect(fake.calls.length).toBe(0);
    await settle();
    expect(fake.calls).toEqual([['u1/a.jpg', 'u1/b.jpg', 'u1/c.jpg']]);
    expect(svc.signed().get('u1/b.jpg')).toBe('https://signed/u1/b.jpg?t=1');
  });

  it('passes data URIs and foreign URLs through and signs bucket URLs', async () => {
    expect(svc.urlFor('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(svc.urlFor('https://a.b/x.png')).toBe('https://a.b/x.png');
    expect(svc.urlFor(`${BASE}/u1/a.jpg`)).toBeNull();
    await settle();
    expect(svc.urlFor(`${BASE}/u1/a.jpg`)).toBe('https://signed/u1/a.jpg?t=1');
  });

  it('does not re-sign a fresh entry', async () => {
    svc.request(['u1/a.jpg']);
    await settle();
    svc.request(['u1/a.jpg']);
    svc.urlFor(`${BASE}/u1/a.jpg`);
    await settle();
    expect(fake.calls.length).toBe(1);
  });

  it('re-signs shortly before the URL expires', async () => {
    svc.request(['u1/a.jpg']);
    await settle();
    jasmine.clock().tick(56 * 60 * 1000);
    expect(svc.urlFor(`${BASE}/u1/a.jpg`)).toBe('https://signed/u1/a.jpg?t=1');
    await settle();
    expect(fake.calls.length).toBe(2);
  });

  it('marks every path failed on a batch error and does not retry within 60 s', async () => {
    fake.next.push({ data: null, error: { message: 'boom' } });
    svc.request(['u1/a.jpg']);
    await settle();
    expect(svc.failed(`${BASE}/u1/a.jpg`)).toBeTrue();
    expect(svc.urlFor(`${BASE}/u1/a.jpg`)).toBeNull();
    jasmine.clock().tick(59 * 1000);
    svc.urlFor(`${BASE}/u1/a.jpg`);
    await settle();
    expect(fake.calls.length).toBe(1);
    expect(console.warn).toHaveBeenCalled();
    jasmine.clock().tick(2 * 1000);
    svc.urlFor(`${BASE}/u1/a.jpg`);
    await settle();
    expect(fake.calls.length).toBe(2);
    expect(svc.failed(`${BASE}/u1/a.jpg`)).toBeFalse();
  });

  it('marks a single failed entry without failing the rest', async () => {
    fake.next.push({
      data: [
        { path: 'u1/a.jpg', signedUrl: 'https://signed/a', error: null },
        { path: 'u1/gone.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    });
    svc.request(['u1/a.jpg', 'u1/gone.jpg']);
    await settle();
    expect(svc.failed(`${BASE}/u1/gone.jpg`)).toBeTrue();
    expect(svc.failed(`${BASE}/u1/a.jpg`)).toBeFalse();
    svc.urlFor(`${BASE}/u1/gone.jpg`);
    await settle();
    expect(fake.calls.length).toBe(1);
  });

  it('treats a thrown error (e.g. a stub without createSignedUrls) as a failure', async () => {
    fake.next.push(new TypeError('createSignedUrls is not a function'));
    svc.request(['u1/a.jpg']);
    await settle();
    expect(svc.failed(`${BASE}/u1/a.jpg`)).toBeTrue();
  });
});
