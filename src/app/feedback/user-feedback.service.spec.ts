import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { UserFeedbackService } from './user-feedback.service';
import type { AuthorFeedbackRow } from './user-feedback.types';

const UID = 'user-1';
const OPEN_TOPIC = '11111111-1111-4111-8111-111111111111';
const WORKED_TOPIC = '22222222-2222-4222-8222-222222222222';

function topic(id: string, canDelete: boolean): AuthorFeedbackRow {
  return {
    id,
    body: 'please add X',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    decision_note: null,
    author_status: 'in_progress',
    area: null,
    can_delete: canDelete,
  };
}

/**
 * Stand-in for the PostgREST builder the service uses. `my_feedback` is the read
 * path, `admin_feedback` the withdraw path — and the fake enforces the same
 * asymmetry the database does: the delete reports success but is only *honoured*
 * for a row the RLS policy would let through, so the "server said ok, row is
 * still there" case (the one the service has to catch) is reachable in a test.
 */
class FakeSupabase {
  rows: AuthorFeedbackRow[] = [];
  /** Ids the policy refuses — deleted rows stay, exactly as PostgREST behaves. */
  refuse = new Set<string>();
  deletes: string[] = [];
  failNextDelete: string | null = null;

  readonly client = {
    from: (table: string) => {
      switch (table) {
        case 'my_feedback':
          return {
            select: () => ({
              order: () => Promise.resolve({ data: this.rows.map((r) => ({ ...r })), error: null }),
            }),
          };
        case 'feedback_author_messages':
          return {
            select: () => ({
              in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
            }),
          };
        case 'feedback_read_state':
          return {
            select: () => Promise.resolve({ data: [], error: null }),
            upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
          };
        case 'admin_feedback':
          return {
            delete: () => ({
              eq: (_col: string, id: string) => {
                this.deletes.push(id);
                if (this.failNextDelete === id) {
                  this.failNextDelete = null;
                  return Promise.resolve({ error: { message: 'network down' } });
                }
                if (!this.refuse.has(id)) this.rows = this.rows.filter((r) => r.id !== id);
                return Promise.resolve({ error: null });
              },
            }),
          };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
}

describe('UserFeedbackService — withdraw (feedback 892013b6)', () => {
  let sb: FakeSupabase;
  let svc: UserFeedbackService;
  const user = signal<{ id: string } | null>({ id: UID });
  const previewing = signal(false);

  function setup(seed: AuthorFeedbackRow[]): UserFeedbackService {
    sb = new FakeSupabase();
    sb.rows = seed;
    user.set({ id: UID });
    previewing.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: sb },
        { provide: AuthService, useValue: { user, session: () => null } },
        { provide: ImpersonationService, useValue: { activeOrPending: () => previewing() } },
      ],
    });
    svc = TestBed.inject(UserFeedbackService);
    return svc;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reads can_delete off the view instead of guessing from the coarse status', async () => {
    setup([topic(OPEN_TOPIC, true), topic(WORKED_TOPIC, false)]);
    await svc.refresh();

    // Both topics read as "in Bearbeitung" — only the flag separates them.
    expect(svc.topics().map((t) => t.author_status)).toEqual(['in_progress', 'in_progress']);
    expect(svc.topics().map((t) => t.can_delete)).toEqual([true, false]);
  });

  it('withdraws a topic and drops it from the list', async () => {
    setup([topic(OPEN_TOPIC, true), topic(WORKED_TOPIC, false)]);
    await svc.refresh();

    await expectAsync(svc.withdraw(OPEN_TOPIC)).toBeResolvedTo(true);
    expect(sb.deletes).toEqual([OPEN_TOPIC]);
    expect(svc.topics().map((t) => t.id)).toEqual([WORKED_TOPIC]);
    expect(svc.error()).toBeNull();
  });

  it('reports a refusal when the row survives the delete', async () => {
    // The routine claimed the topic between render and click: PostgREST answers
    // 204 either way, so a surviving row is the only evidence of the "no".
    setup([topic(OPEN_TOPIC, true)]);
    sb.refuse.add(OPEN_TOPIC);
    await svc.refresh();

    await expectAsync(svc.withdraw(OPEN_TOPIC)).toBeResolvedTo(false);
    expect(svc.error()).toBe('withdrawRefused');
    expect(svc.topics().map((t) => t.id)).toEqual([OPEN_TOPIC]);
  });

  it('surfaces a server error and keeps the topic', async () => {
    setup([topic(OPEN_TOPIC, true)]);
    sb.failNextDelete = OPEN_TOPIC;
    await svc.refresh();

    await expectAsync(svc.withdraw(OPEN_TOPIC)).toBeResolvedTo(false);
    expect(svc.error()).toBe('network down');
    expect(svc.topics().map((t) => t.id)).toEqual([OPEN_TOPIC]);
    expect(svc.busy()).toBeFalse();
  });

  it('refuses to withdraw while a role preview is active', async () => {
    // The JWT stays the admin's during a preview, so the delete would run under
    // their real identity — the same choke point that blocks send and reply.
    setup([topic(OPEN_TOPIC, true)]);
    await svc.refresh();
    previewing.set(true);

    await expectAsync(svc.withdraw(OPEN_TOPIC)).toBeResolvedTo(false);
    expect(sb.deletes).toEqual([]);
    expect(svc.error()).toBe('preview');
  });
});
