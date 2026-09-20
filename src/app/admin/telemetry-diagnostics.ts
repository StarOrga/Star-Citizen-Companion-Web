import { FEEDBACK_MAX_CHARS } from '../feedback/feedback-limits';

/**
 * One uploader run that logged warnings/errors, as `get_telemetry_stats`
 * returns it under `diagnostics.recent` (migration 20260920120000). `lines`
 * is the transcript the uploader sent — `+mm:ss [warn] …` per line, already
 * clamped server-side at 8000 chars.
 */
export interface DiagnosticRow {
  id: number;
  at: number;
  product: string;
  version: string;
  channel: string;
  os: string | null;
  kind: string;
  outcome: string;
  warnings: number;
  errors: number;
  dropped: number;
  phase: string | null;
  pct: number | null;
  elapsedMs: number | null;
  gameChannel: string | null;
  patchVersion: string | null;
  message: string;
  lines: string;
}

/** `translate.instant` shape, so the pure helper stays test-friendly. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * How much of the transcript rides INSIDE the topic text. The full log goes
 * along as an attachment; the excerpt is for the reader who never opens it —
 * the routine included — and for the board card's summary. Sized so the
 * prompt around it still fits the message cap with room for the admin to add
 * a sentence.
 */
export const DIAGNOSTIC_EXCERPT_CHARS = 700;
const EXCERPT_LINES = 12;

/** The first few transcript lines, cut to the excerpt budget. */
export function diagnosticExcerpt(lines: string, maxChars = DIAGNOSTIC_EXCERPT_CHARS): string {
  const all = lines.split('\n').filter((l) => l.trim());
  const head = all.slice(0, EXCERPT_LINES);
  let out = head.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  if (all.length > head.length) out += `\n… (${all.length - head.length} more)`;
  return out;
}

/**
 * The pre-filled topic body: what happened, in one line, then the ask to the
 * routine, then the excerpt. Localized through the caller's translate so the
 * admin reads it in their own language and can rewrite any of it before
 * sending. Always within the message cap — the composer would refuse to send
 * otherwise, and a seed that arrives unsendable is worse than none.
 */
export function buildDiagnosticTopic(row: DiagnosticRow, t: Translate): string {
  const kind = t(`telemetry.diagnostics.kind.${row.kind}`);
  const outcome = t(`telemetry.diagnostics.outcome.${row.outcome}`);
  const game = [row.gameChannel, row.patchVersion].filter(Boolean).join(' ');
  const head = t('telemetry.diagnostics.topic.head', {
    version: row.version,
    ring: row.channel,
    kind: kind.startsWith('telemetry.') ? row.kind : kind,
    outcome: outcome.startsWith('telemetry.') ? row.outcome : outcome,
    warnings: row.warnings,
    errors: row.errors,
    game: game || '—',
    os: row.os ?? '—',
    id: row.id,
  });
  const ask = t('telemetry.diagnostics.topic.ask');
  const excerptTitle = t('telemetry.diagnostics.topic.excerpt');
  const fixed = `${head}\n\n${ask}\n\n${excerptTitle}\n\`\`\`\n`;
  const tail = '\n```';
  const budget = FEEDBACK_MAX_CHARS - fixed.length - tail.length;
  const excerpt = diagnosticExcerpt(row.lines, Math.max(80, Math.min(DIAGNOSTIC_EXCERPT_CHARS, budget)));
  return `${fixed}${excerpt}${tail}`;
}

/** Filename for the attached transcript — sortable, unique per row, no spaces. */
export function diagnosticLogName(row: DiagnosticRow): string {
  const stamp = new Date(row.at).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `data-uploader-${row.version}-${row.kind}-${stamp}-${row.id}.log`;
}

/** The transcript as a text file the composer attaches like a picked file. */
export function diagnosticLogFile(row: DiagnosticRow): File {
  const header = [
    `# Data Uploader ${row.version} (${row.channel}) — ${row.kind} ${row.outcome}`,
    `# at ${new Date(row.at).toISOString()} · telemetry event #${row.id}`,
    `# game ${row.gameChannel ?? '?'} ${row.patchVersion ?? ''} · os ${row.os ?? '?'} · phase ${row.phase ?? '?'} · ${row.pct ?? '?'} %`,
    `# ${row.warnings} warning(s), ${row.errors} error(s)` + (row.dropped ? `, ${row.dropped} not kept` : ''),
    '',
  ].join('\n');
  return new File([header + row.lines + '\n'], diagnosticLogName(row), { type: 'text/plain' });
}
