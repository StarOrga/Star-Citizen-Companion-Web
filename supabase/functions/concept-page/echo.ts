// echo.ts — the thread message a concept submit leaves behind.
//
// The routine's queue reads (feedback-routine.md queries (b)/(d)) look at
// `admin_feedback_messages` only; a submit that lands in
// `concept_pages.decisions` and nowhere else is invisible until somebody
// types a reply. So `POST /:id/decisions` with `submitted: true` also posts a
// compact German summary INTO the topic's thread, as the ADMIN (is_system =
// false, author_id = the uid the ticket carries) — a human message is exactly
// what makes those queries fire on the next run.
//
// Pure functions only — no Deno, no network — so this runs under both
// `deno test` and Node's built-in runner (`node --test echo.test.ts`).

export type ConceptAction = 'iterate' | 'implement' | 'finalize';

/** What the engine POSTs to /decisions (the parts the echo reads). */
export interface ConceptSubmission {
  submitted?: unknown;
  action?: unknown;
  submission_id?: unknown;
  /** `[data-decision]` blocks: `{ id, label }`. */
  decisions?: unknown;
  /** decision/free template: `[{ id, text }]`; design template: an object. */
  comments?: unknown;
  /** Every form field of the active iteration; radios land as `dec-<id>` → value. */
  allFields?: unknown;
}

export const ECHO_MAX_CHARS = 2000;
const MAX_DECISION_BULLETS = 8;
const MAX_NOTE_CHARS = 200;
const MAX_LABEL_CHARS = 120;

const ACTION_LABEL: Record<ConceptAction, string> = {
  iterate: 'Zur nächsten Iteration',
  implement: 'Mit Feedback implementieren',
  finalize: 'Finalisieren',
};

/** `body.action` normalised — anything unknown (or missing) is an iterate. */
export function conceptAction(raw: unknown): ConceptAction {
  return raw === 'implement' || raw === 'finalize' ? raw : 'iterate';
}

interface DecisionLine {
  label: string;
  value: string | null;
}

interface NoteLine {
  id: string;
  text: string;
}

/** Collapse whitespace and strip the characters that would break a bullet. */
function clean(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The `[data-decision]` blocks joined with their chosen radio value. */
export function decisionLines(payload: ConceptSubmission): DecisionLine[] {
  const fields = asRecord(payload.allFields) ?? {};
  const out: DecisionLine[] = [];
  if (!Array.isArray(payload.decisions)) return out;
  for (const entry of payload.decisions) {
    const rec = asRecord(entry);
    if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
    const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label : rec.id;
    const raw = fields[`dec-${rec.id}`];
    const value =
      typeof raw === 'string' && raw.trim()
        ? raw
        : typeof raw === 'boolean' || typeof raw === 'number'
          ? String(raw)
          : null;
    out.push({ label: clean(label, MAX_LABEL_CHARS), value: value === null ? null : clean(value, MAX_LABEL_CHARS) });
  }
  return out;
}

/**
 * The free-text notes. The decision/free templates send `[{id, text}]`; the
 * design template sends `{ general, designs: {slot: text}, screens: {...} }`.
 * Both are flattened to `{id, text}` and empty texts are dropped.
 */
export function noteLines(payload: ConceptSubmission): NoteLine[] {
  const out: NoteLine[] = [];
  const push = (id: string, text: unknown) => {
    if (typeof text !== 'string' || !text.trim()) return;
    out.push({ id, text: clean(text, MAX_NOTE_CHARS) });
  };
  const c = payload.comments;
  if (Array.isArray(c)) {
    for (const entry of c) {
      const rec = asRecord(entry);
      if (!rec) continue;
      push(typeof rec.id === 'string' ? rec.id : '', rec.text);
    }
    return out;
  }
  const rec = asRecord(c);
  if (!rec) return out;
  push('general', rec.general);
  for (const group of ['designs', 'screens'] as const) {
    const sub = asRecord(rec[group]);
    if (!sub) continue;
    for (const [slot, text] of Object.entries(sub)) push(slot, text);
  }
  return out;
}

/**
 * The markdown body posted into the feedback thread. Deterministic and
 * capped at ECHO_MAX_CHARS — the column allows 20 000, but a thread row is
 * a summary; the full payload is one `concept-read --id <id>` away.
 */
export function buildEchoBody(conceptId: string, title: string, payload: ConceptSubmission): string {
  const action = conceptAction(payload.action);
  const decisions = decisionLines(payload);
  const notes = noteLines(payload);
  const chosen = decisions.filter((d) => d.value !== null);

  const head =
    `**Konzept abgeschickt:** „${clean(title, MAX_LABEL_CHARS)}" — ${ACTION_LABEL[action]} ` +
    `(${chosen.length} ${chosen.length === 1 ? 'Entscheidung' : 'Entscheidungen'}, ` +
    `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}).`;

  const parts: string[] = [head];

  if (chosen.length) {
    const shown = chosen.slice(0, MAX_DECISION_BULLETS);
    const bullets = shown.map((d) => `- ${d.label} → ${d.value}`);
    if (chosen.length > shown.length) bullets.push(`- … und ${chosen.length - shown.length} weitere`);
    parts.push(`Entscheidungen:\n${bullets.join('\n')}`);
  }

  if (notes.length) {
    const bullets = notes.map((n) => (n.id ? `- ${n.id}: ${n.text}` : `- ${n.text}`));
    parts.push(`Notizen:\n${bullets.join('\n')}`);
  }

  const tail = `Vollständig lesbar mit \`concept-read --id ${conceptId}\`.`;
  let body = parts.join('\n\n');
  const budget = ECHO_MAX_CHARS - tail.length - 2;
  if (body.length > budget) body = body.slice(0, budget - 1).trimEnd() + '…';
  return `${body}\n\n${tail}`;
}

/** JSON with sorted keys, so a jsonb round trip (which reorders keys) still compares equal. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}

/**
 * True when this POST is the engine replaying a submission the row already
 * holds (offline queue / lost response), so a second thread message would be
 * a duplicate. A finalize carries a random `submission_id` — same id, same
 * submission, full stop. Iterate/implement carry none, so those compare the
 * whole stored payload — but only while the row is still unprocessed: the
 * engine re-arms its submit buttons only after `processed_at` is set, so an
 * identical payload arriving AFTER processing is a genuine new answer (the
 * admin chose the same things again), not a replay.
 */
export function isReplayOf(
  stored: { decisions: unknown; submitted_at: string | null; processed_at?: string | null },
  incoming: ConceptSubmission,
): boolean {
  if (!stored.submitted_at) return false;
  const prev = asRecord(stored.decisions);
  if (!prev || prev.submitted !== true) return false;
  const id = incoming.submission_id;
  if (typeof id === 'string' && id) return prev.submission_id === id;
  if (stored.processed_at) return false;
  return stableStringify(prev) === stableStringify(incoming);
}
