import {
  draftScopes,
  feedbackIdFromScope,
  isEmptyDraft,
  memoScope,
  normalizeDraftImages,
  parseDraftRow,
} from './feedback-draft.types';

const TOPIC = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

describe('feedback draft scopes', () => {
  it('gives every composer of one topic its own key', () => {
    const keys = [
      draftScopes.userReply(TOPIC),
      draftScopes.adminThread(TOPIC),
      draftScopes.adminAuthor(TOPIC),
      draftScopes.adminWorkflow(TOPIC),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  it('keeps the two new-topic boxes apart', () => {
    expect(draftScopes.userNew).not.toBe(draftScopes.adminNew);
  });

  it('reads the topic back out of a scoped key', () => {
    expect(feedbackIdFromScope(draftScopes.adminThread(TOPIC))).toBe(TOPIC);
    expect(feedbackIdFromScope(draftScopes.userReply(TOPIC))).toBe(TOPIC);
  });

  it('reports no topic for the new-topic boxes', () => {
    expect(feedbackIdFromScope(draftScopes.userNew)).toBeNull();
    expect(feedbackIdFromScope(draftScopes.adminNew)).toBeNull();
  });

  it('refuses a malformed suffix instead of forwarding it into the foreign key', () => {
    expect(feedbackIdFromScope('admin:thread:not-a-uuid')).toBeNull();
    expect(feedbackIdFromScope('admin:thread:')).toBeNull();
    expect(feedbackIdFromScope('nocolon')).toBeNull();
  });

  it('memoizes a scope so a template binding keeps its identity', () => {
    const cache = new Map<string, string>();
    const first = memoScope(cache, TOPIC, draftScopes.adminThread);
    const second = memoScope(cache, TOPIC, draftScopes.adminThread);
    expect(second).toBe(first);
  });
});

describe('normalizeDraftImages', () => {
  it('keeps well-formed references', () => {
    const images = normalizeDraftImages([
      { id: 'a', name: 'shot.png', url: 'https://example.test/a.jpg' },
    ]);
    expect(images).toEqual([{ id: 'a', name: 'shot.png', url: 'https://example.test/a.jpg' }]);
  });

  it('drops entries without a url but keeps the rest of the draft usable', () => {
    const images = normalizeDraftImages([
      { id: 'a', name: 'gone' },
      null,
      'nonsense',
      { id: 'b', name: 'kept', url: 'https://example.test/b.jpg' },
    ]);
    expect(images.map((i) => i.url)).toEqual(['https://example.test/b.jpg']);
  });

  it('substitutes a missing id/name rather than discarding the image', () => {
    const [img] = normalizeDraftImages([{ url: 'https://example.test/c.jpg' }]);
    expect(img.url).toBe('https://example.test/c.jpg');
    expect(img.name).toBe('image');
    expect(img.id.length).toBeGreaterThan(0);
  });

  it('treats a non-array (or null) column as no attachments', () => {
    expect(normalizeDraftImages(null)).toEqual([]);
    expect(normalizeDraftImages({ id: 'a' })).toEqual([]);
  });
});

describe('parseDraftRow', () => {
  it('maps the row shape and defaults a null body to empty text', () => {
    const draft = parseDraftRow({
      scope: draftScopes.adminNew,
      feedback_id: null,
      body: null,
      images: [],
      updated_at: '2026-07-29T10:00:00Z',
    });
    expect(draft).toEqual({
      scope: draftScopes.adminNew,
      feedbackId: null,
      body: '',
      images: [],
      updatedAt: '2026-07-29T10:00:00Z',
    });
  });
});

describe('isEmptyDraft', () => {
  it('counts whitespace-only text with no attachments as empty', () => {
    expect(isEmptyDraft('   \n ', [])).toBeTrue();
  });

  it('is not empty while an attachment is queued, even without text', () => {
    expect(isEmptyDraft('', [{}])).toBeFalse();
  });

  it('is not empty with real text', () => {
    expect(isEmptyDraft('hi', [])).toBeFalse();
  });
});
