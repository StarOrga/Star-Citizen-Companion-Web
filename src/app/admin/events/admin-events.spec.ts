import { approveField, normalizeSheet, publicSheet, setByAdmin } from '../../hq/events/event-sheet';
import { fieldSummary, needsReview, rejectField } from './admin-events.component';

const pendingSheet = () =>
  normalizeSheet({ schema: 1, fields: { end: { value: '2026-12-01', confidence: 0.5, source: 'ai', review: 'pending' } } });

describe('admin event review', () => {
  it('F11: a pending field needs a decision and is blank in the public sheet', () => {
    const s = pendingSheet();
    expect(needsReview(s.fields.end)).toBeTrue();
    expect(publicSheet(s).fields.end.value).toBeNull();
  });

  it('F11: approve makes the value public, set by hand wins with confidence 1', () => {
    const approved = approveField(pendingSheet(), 'end');
    expect(publicSheet(approved).fields.end.value).toBe('2026-12-01');
    const edited = setByAdmin(pendingSheet(), 'end', '2026-12-05');
    expect(edited.fields.end.confidence).toBe(1);
    expect(edited.fields.end.review).toBe('edited');
    expect(edited.fields.end.source).toBe('admin');
  });

  it('F11: reject keeps the value in the draft but hides it from readers', () => {
    const rejected = rejectField(pendingSheet(), 'end');
    expect(rejected.fields.end.review).toBe('rejected');
    expect(publicSheet(rejected).fields.end.value).toBeNull();
  });

  it('summarises values in one line', () => {
    expect(fieldSummary(null)).toBe('');
    expect(fieldSummary('2026-12-01')).toBe('2026-12-01');
    expect(fieldSummary(['verse'])).toBe('["verse"]');
  });
});
