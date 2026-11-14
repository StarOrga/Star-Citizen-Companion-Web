import type { Mock } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseRankIdea } from '../data/verse.models';
import { RankIdeasComponent } from './rank-ideas.component';

const idea = (id: string, votes: number, extra: Partial<VerseRankIdea> = {}): VerseRankIdea => ({
  id,
  body: `Idea ${id}`,
  votes,
  voted: false,
  mine: false,
  createdAt: 'x',
  archived: false,
  ...extra,
});

describe('reward ideas', () => {
  const isAdmin = signal(false);
  let rankIdeas: Mock;
  let submitRankIdea: Mock;
  let voteRankIdea: Mock;
  let archiveRankIdea: Mock;
  let confirm: Mock;

  beforeEach(() => {
    isAdmin.set(false);
    rankIdeas = vi.fn().mockName('rankIdeas').mockResolvedValue({ ok: true, data: [idea('a', 5), idea('b', 2)] });
    submitRankIdea = vi.fn().mockName('submitRankIdea').mockResolvedValue({ ok: true, data: 'new' });
    voteRankIdea = vi.fn().mockName('voteRankIdea').mockResolvedValue({ ok: true, data: { voted: true, votes: 6 } });
    archiveRankIdea = vi.fn().mockName('archiveRankIdea').mockResolvedValue({ ok: true, data: undefined });
    confirm = vi.fn().mockName('confirm').mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({}),
        { provide: VerseApiService, useValue: { rankIdeas, submitRankIdea, voteRankIdea, archiveRankIdea } },
        { provide: RoleService, useValue: { isAdmin } },
        { provide: ScConfirmService, useValue: { confirm } },
      ],
    });
  });

  async function make(tier: number) {
    const f = TestBed.createComponent(RankIdeasComponent);
    f.componentRef.setInput('tier', tier);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  }

  it('below tier 5 the list is readable, with no submit or vote control, and names tier 5', async () => {
    const f = await make(4);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.list li').length).toBe(2);
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('.vote')).toBeNull();
    expect(el.querySelector('.lock')?.textContent).toContain('starmap.ideas.locked');
    expect(f.componentInstance.tierName).toBe('starmap.rankPage.tier.astrographer.name');
  });

  it('from tier 5 an idea can be submitted (trimmed, length-checked) and the list reloads', async () => {
    const f = await make(5);
    const el = f.nativeElement as HTMLElement;
    const submit = el.querySelector('form button[type=submit]') as HTMLButtonElement;
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    expect(submit.disabled).toBe(true);
    box.value = ' a ';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(submit.disabled).toBe(true);
    box.value = '  A comet-tail crest  ';
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
    submit.click();
    await f.whenStable();
    expect(submitRankIdea).toHaveBeenCalledWith('A comet-tail crest');
    expect(rankIdeas).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.draft()).toBe('');
  });

  it('shows a translated refusal when the server says no', async () => {
    submitRankIdea.mockResolvedValue({ ok: false, errorKey: 'errors.rankIdeaLimit' });
    const f = await make(5);
    f.componentInstance.draft.set('Something nice');
    await f.componentInstance.submit();
    f.detectChanges();
    expect(f.nativeElement.querySelector('form [role=status]')?.textContent).toContain('errors.rankIdeaLimit');
  });

  it('the vote toggles with aria-pressed and re-sorts by votes', async () => {
    const f = await make(6);
    const el = f.nativeElement as HTMLElement;
    const votes = [...el.querySelectorAll('.vote')] as HTMLButtonElement[];
    expect(votes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    voteRankIdea.mockResolvedValue({ ok: true, data: { voted: true, votes: 9 } });
    votes[1].click();
    await f.whenStable();
    f.detectChanges();
    expect(voteRankIdea).toHaveBeenCalledWith('b');
    const after = [...el.querySelectorAll('.list li')] as HTMLElement[];
    expect(after[0].textContent).toContain('Idea b');
    expect(after[0].querySelector('.vote')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('only admins get the archive control, confirmed first; archived ideas are marked', async () => {
    rankIdeas.mockResolvedValue({ ok: true, data: [idea('a', 5), idea('z', 1, { archived: true })] });
    const plain = await make(5);
    expect(plain.nativeElement.querySelector('.hot, .sc-action--hot')).toBeNull();
    isAdmin.set(true);
    const f = await make(5);
    const el = f.nativeElement as HTMLElement;
    const hot = el.querySelectorAll('.sc-action--hot');
    expect(hot.length).toBe(1);
    expect(el.querySelector('li.archived .tag')).not.toBeNull();
    expect(el.querySelector('li.archived .vote')).toBeNull();
    (hot[0] as HTMLButtonElement).click();
    await f.whenStable();
    expect(confirm).toHaveBeenCalled();
    expect(archiveRankIdea).toHaveBeenCalledWith('a');
    confirm.mockResolvedValue(false);
    archiveRankIdea.mockClear();
    await f.componentInstance.archive(idea('q', 0));
    expect(archiveRankIdea).not.toHaveBeenCalled();
  });

  it('is absent when the RPC does not exist yet and shows an error state with retry on a failure', async () => {
    rankIdeas.mockResolvedValue({ ok: true, data: null });
    const gone = await make(5);
    expect(gone.nativeElement.querySelector('.ideas')).toBeNull();
    rankIdeas.mockResolvedValue({ ok: false, errorKey: 'errors.timeout' });
    const f = await make(5);
    expect(f.nativeElement.querySelector('[role=alert]')?.textContent).toContain('errors.timeout');
    rankIdeas.mockResolvedValue({ ok: true, data: [idea('a', 1)] });
    (f.nativeElement.querySelector('[role=alert] button') as HTMLButtonElement).click();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('.list li').length).toBe(1);
  });
});
