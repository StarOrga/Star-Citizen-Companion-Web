import { describe, it, expect } from 'vitest';
import { collapseErrorBody } from '../src/lib/error-body.js';
import { IngestHttpError } from '../src/main/catalog-bridge.js';

const CF = `<!DOCTYPE html>\n<html>\n<head>\n<title>supabase.co | 520: Web server is returning an unknown error</title>\n</head><body>${'x\n'.repeat(50)}</body></html>`;

describe('collapseErrorBody', () => {
  it('reduces a Cloudflare page to its title on one line', () => {
    const out = collapseErrorBody(CF);
    expect(out).toBe('[HTML error page: supabase.co | 520: Web server is returning an unknown error]');
    expect(out).not.toContain('\n');
  });
  it('bounds plain text to one line', () => {
    const out = collapseErrorBody('a\n'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out).not.toContain('\n');
  });
  it('keeps short messages (and the timeout classifier) intact', () => {
    expect(collapseErrorBody('canceling statement due to statement timeout')).toBe(
      'canceling statement due to statement timeout',
    );
  });
});

describe('IngestHttpError', () => {
  it('never carries a multi-line HTML body in its message', () => {
    const e = new IngestHttpError('upsert', 500, 'ingest_failed', CF);
    expect(e.message).not.toContain('\n');
    expect(e.message).toContain('520');
  });
});
