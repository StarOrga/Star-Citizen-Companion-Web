import {
  GLOSSARY_PAGE_SIZE,
  buildGlossaryQuery,
  canApprove,
  canCancel,
  glossarySearchFilter,
  jobErrorKey,
  judgeScore,
  monthStartUtc,
  revertPatch,
  spendPercent,
  sumLedger,
} from './translations.logic';

describe('translations.logic', () => {
  it('offers Approve only while awaiting approval', () => {
    expect(canApprove('awaiting_approval')).toBeTrue();
    expect(canApprove('queued')).toBeFalse();
    expect(canApprove('published')).toBeFalse();
  });

  it('offers Cancel for every unfinished status only', () => {
    for (const s of ['estimating', 'awaiting_approval', 'queued', 'submitted', 'validating', 'post_editing', 'publishing']) {
      expect(canCancel(s)).withContext(s).toBeTrue();
    }
    for (const s of ['published', 'failed', 'cancelled', 'skipped']) {
      expect(canCancel(s)).withContext(s).toBeFalse();
    }
  });

  it('keys the ledger month on the UTC month start', () => {
    expect(monthStartUtc(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10-01');
    expect(monthStartUtc(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
  });

  it('sums ledger rows, tolerating numeric strings and nulls', () => {
    expect(sumLedger([{ usd: 1.5 }, { usd: '2.25' }, { usd: null }])).toBe(3.75);
    expect(sumLedger([])).toBe(0);
  });

  it('clamps the spend share and handles a zero cap', () => {
    expect(spendPercent(95, 190)).toBe(50);
    expect(spendPercent(500, 190)).toBe(100);
    expect(spendPercent(5, 0)).toBe(0);
  });

  it('reads the judge mean from stats', () => {
    expect(judgeScore({ judge: { n: 3, mean: 4.2 } })).toBe(4.2);
    expect(judgeScore({ judge: null })).toBeNull();
    expect(judgeScore(null)).toBeNull();
  });

  it('maps job errors to keys, unknown codes to the generic one', () => {
    expect(jobErrorKey(null)).toBeNull();
    expect(jobErrorKey('translate.no_api_key')).toBe('admin.translations.jobErrors.no_api_key');
    expect(jobErrorKey('some raw failure text')).toBe('admin.translations.jobErrors.unknown');
  });

  describe('glossary query', () => {
    it('builds the or-filter over source and target', () => {
      expect(glossarySearchFilter('quantum')).toBe('source_term.ilike.%quantum%,target_term.ilike.%quantum%');
    });

    it('strips characters that could break out of the filter', () => {
      expect(glossarySearchFilter('a,b)(c*"d%')).toBe('source_term.ilike.%a b c d%,target_term.ilike.%a b c d%');
      expect(glossarySearchFilter(' ,() ')).toBeNull();
    });

    it('turns filters and page into eq pairs and a range', () => {
      const q = buildGlossaryQuery({ search: '', lang: 'de', origin: 'admin', category: 'dnt', page: 2 });
      expect(q.or).toBeNull();
      expect(q.eq).toEqual([['lang', 'de'], ['origin', 'admin'], ['category', 'dnt']]);
      expect(q.from).toBe(2 * GLOSSARY_PAGE_SIZE);
      expect(q.to).toBe(3 * GLOSSARY_PAGE_SIZE - 1);
    });

    it('adds no eq pair for unset filters', () => {
      expect(buildGlossaryQuery({ search: 'x', lang: null, origin: null, category: null, page: -1 }).eq).toEqual([]);
    });
  });

  it('restores only the editable fields from a history snapshot', () => {
    expect(revertPatch({ id: 'x', lang: 'de', target_term: 'Alt', category: 'term', origin: 'ai', locked: false, needs_retranslate: true }))
      .toEqual({ target_term: 'Alt', category: 'term', origin: 'ai', locked: false, needs_retranslate: true });
    expect(revertPatch(null)).toBeNull();
    expect(revertPatch({ id: 'x' })).toBeNull();
  });
});
