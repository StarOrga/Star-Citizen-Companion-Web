import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FeedbackDraftService } from './feedback-draft.service';
import { draftScopes } from './feedback-draft.types';

const UID = 'user-1';
const TOPIC = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const BUCKET_URL =
  'https://db.test/storage/v1/object/public/feedback-images/user-1/8b0f6bd2-0000-4000-8000-000000000001.jpg';

interface DraftRow {
  user_id: string;
  scope: string;
  feedback_id: string | null;
  body: string;
  images: { id: string; name: string; url: string }[];
  updated_at?: string;
}

/**
 * Minimal stand-in for the PostgREST query builder the service uses: select all,
 * upsert one row, delete by (user_id, scope). It records every write so the
 * tests can assert on what actually reached the server.
 */
class FakeSupabase {
  rows: DraftRow[] = [];
  removed: string[] = [];
  upserts = 0;
  deletes = 0;
  failNextWrite = false;

  readonly client = {
    from: (table: string) => {
      if (table !== 'feedback_drafts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => Promise.resolve({ data: this.rows.map((r) => toRow(r)), error: null }),
        upsert: (row: DraftRow) => {
          this.upserts++;
          if (this.failNextWrite) {
            this.failNextWrite = false;
            return Promise.resolve({ error: { message: 'offline' } });
          }
          const idx = this.rows.findIndex(
            (r) => r.user_id === row.user_id && r.scope === row.scope,
          );
          if (idx >= 0) this.rows[idx] = { ...row };
          else this.rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        delete: () => {
          const filters: Record<string, string> = {};
          const builder = {
            eq: (col: string, value: string) => {
              filters[col] = value;
              // Two eq() calls, then the caller awaits — resolve on the second.
              if (Object.keys(filters).length < 2) return builder;
              return Promise.resolve(this.applyDelete(filters)) as never;
            },
          };
          return builder;
        },
      };
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          this.removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };

  private applyDelete(filters: Record<string, string>) {
    this.deletes++;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return { error: { message: 'offline' } };
    }
    this.rows = this.rows.filter(
      (r) => !(r.user_id === filters['user_id'] && r.scope === filters['scope']),
    );
    return { error: null };
  }
}

function toRow(r: DraftRow) {
  return {
    scope: r.scope,
    feedback_id: r.feedback_id,
    body: r.body,
    images: r.images,
    updated_at: r.updated_at ?? '2026-07-29T10:00:00Z',
  };
}

describe('FeedbackDraftService', () => {
  let sb: FakeSupabase;
  let svc: FeedbackDraftService;
  const user = signal<{ id: string } | null>({ id: UID });

  function setup(seed: DraftRow[] = []): FeedbackDraftService {
    sb = new FakeSupabase();
    sb.rows = seed;
    user.set({ id: UID });
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: sb },
        { provide: AuthService, useValue: { user, session: () => null } },
      ],
    });
    svc = TestBed.inject(FeedbackDraftService);
    return svc;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem('sc.userFeedback.draft');
    localStorage.removeItem('sc.adminFeedback.draft');
  });

  it('restores a stored draft with its attachments', async () => {
    setup([
      {
        user_id: UID,
        scope: draftScopes.adminNew,
        feedback_id: null,
        body: 'half a topic',
        images: [{ id: 'i1', name: 'shot.png', url: BUCKET_URL }],
      },
    ]);
    await svc.ready();

    const entry = svc.entry(draftScopes.adminNew);
    expect(entry?.body).toBe('half a topic');
    expect(entry?.images.map((i) => i.url)).toEqual([BUCKET_URL]);
    expect(entry?.dirty).toBeFalse();
  });

  it('writes a staged draft once the debounce elapses, not on every keystroke', async () => {
    setup();
    await svc.ready();

    svc.stage(draftScopes.adminNew, 'a', []);
    svc.stage(draftScopes.adminNew, 'ab', []);
    svc.stage(draftScopes.adminNew, 'abc', []);
    expect(sb.upserts).toBe(0);

    await svc.flush(draftScopes.adminNew);
    expect(sb.upserts).toBe(1);
    expect(sb.rows[0].body).toBe('abc');
    expect(svc.entry(draftScopes.adminNew)?.dirty).toBeFalse();
  });

  it('derives the topic id from a scoped key so the row can cascade', async () => {
    setup();
    await svc.ready();

    svc.stage(draftScopes.adminThread(TOPIC), 'reply text', []);
    await svc.flush(draftScopes.adminThread(TOPIC));

    expect(sb.rows[0].feedback_id).toBe(TOPIC);
  });

  it('keeps two composers of the same topic apart', async () => {
    setup();
    await svc.ready();

    svc.stage(draftScopes.adminThread(TOPIC), 'to the routine', []);
    svc.stage(draftScopes.adminAuthor(TOPIC), 'to the author', []);
    await svc.flush(draftScopes.adminThread(TOPIC));
    await svc.flush(draftScopes.adminAuthor(TOPIC));

    expect(sb.rows.length).toBe(2);
    expect(svc.entry(draftScopes.adminThread(TOPIC))?.body).toBe('to the routine');
    expect(svc.entry(draftScopes.adminAuthor(TOPIC))?.body).toBe('to the author');
  });

  it('deletes the row when the composer is emptied out', async () => {
    setup();
    await svc.ready();

    svc.stage(draftScopes.adminNew, 'something', []);
    await svc.flush(draftScopes.adminNew);
    expect(sb.rows.length).toBe(1);

    svc.stage(draftScopes.adminNew, '   ', []);
    await svc.flush(draftScopes.adminNew);
    expect(sb.rows.length).toBe(0);
    expect(svc.entry(draftScopes.adminNew)).toBeNull();
  });

  it('keeps the value and stays dirty when the write fails — never clears', async () => {
    setup();
    await svc.ready();

    sb.failNextWrite = true;
    svc.stage(draftScopes.adminNew, 'precious text', []);
    await svc.flush(draftScopes.adminNew);

    const entry = svc.entry(draftScopes.adminNew);
    expect(entry?.body).toBe('precious text');
    expect(entry?.dirty).toBeTrue();
    expect(entry?.failed).toBeTrue();
  });

  it('discard removes the row AND the screenshots that never became a message', async () => {
    setup([
      {
        user_id: UID,
        scope: draftScopes.adminNew,
        feedback_id: null,
        body: 'with a shot',
        images: [{ id: 'i1', name: 'shot.png', url: BUCKET_URL }],
      },
    ]);
    await svc.ready();

    await svc.discard(draftScopes.adminNew);

    expect(svc.entry(draftScopes.adminNew)).toBeNull();
    expect(sb.rows.length).toBe(0);
    expect(sb.removed).toEqual(['user-1/8b0f6bd2-0000-4000-8000-000000000001.jpg']);
  });

  it('a sent draft drops its row but keeps the uploads the message now references', async () => {
    setup([
      {
        user_id: UID,
        scope: draftScopes.adminNew,
        feedback_id: null,
        body: 'sent this',
        images: [{ id: 'i1', name: 'shot.png', url: BUCKET_URL }],
      },
    ]);
    await svc.ready();

    await svc.clearSent(draftScopes.adminNew);

    expect(sb.rows.length).toBe(0);
    expect(sb.removed).toEqual([]);
  });

  it('imports a pre-existing localStorage draft once and removes the old key', async () => {
    localStorage.setItem('sc.adminFeedback.draft', 'written before this shipped');
    setup();
    await svc.ready();

    expect(svc.entry(draftScopes.adminNew)?.body).toBe('written before this shipped');
    expect(localStorage.getItem('sc.adminFeedback.draft')).toBeNull();
  });

  it('drops everything in memory when the account changes', async () => {
    setup([
      {
        user_id: UID,
        scope: draftScopes.adminNew,
        feedback_id: null,
        body: 'mine',
        images: [],
      },
    ]);
    await svc.ready();
    expect(svc.entry(draftScopes.adminNew)).not.toBeNull();

    user.set({ id: 'somebody-else' });
    TestBed.tick();

    expect(svc.entry(draftScopes.adminNew)).toBeNull();
  });
});
