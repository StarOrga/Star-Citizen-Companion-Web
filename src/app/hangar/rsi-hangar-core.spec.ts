import {
  DISMISS_COOLDOWN_MS,
  buildPageUrls,
  cleanShipName,
  clearDismissal,
  companionImportUrl,
  countShips,
  emptyState,
  fingerprintShips,
  isLoggedInHangar,
  normalizeState,
  parseHangarDocument,
  readPagination,
  recordDismissal,
  recordImport,
  shouldOfferImport,
  toCompanionPayload,
} from '../../../browser-extension/src/lib/hangar-core.js';

/**
 * Unit tests for the browser extension's pure core (browser-extension/).
 *
 * The extension ships no build step and no test runner of its own — the logic
 * that is actually easy to get wrong (RSI DOM parsing, the fleet fingerprint,
 * the anti-nagging rule) lives in one dependency-free ES module, and this spec
 * runs it inside the app's existing Karma suite so `npm test` covers it.
 */
const HANGAR_HTML = `
<html><body>
  <div class="account-content">
    <div class="pledges">
      <ul class="list-items">
        <li class="raw-item" data-pledge-id="111">
          <div class="information"><div class="title">Aurora MR Starter Pack</div></div>
          <div class="items">
            <ul class="js-items">
              <li><span class="kind">Ship</span><span class="title">Aurora MR</span></li>
              <li><span class="kind">Skin</span><span class="title">Aurora Dark Green</span></li>
              <li><span class="kind">Decoration</span><span class="title">Poster</span></li>
            </ul>
          </div>
        </li>
        <li class="raw-item" data-pledge-id="222">
          <div class="information"><div class="title">Carrack Upgrade</div></div>
          <div class="items">
            <ul class="js-items">
              <li><span class="kind">Ship</span><span class="title">Anvil Carrack - LTI</span></li>
            </ul>
          </div>
        </li>
        <li class="raw-item">
          <div class="information"><div class="title">Store Credit</div></div>
          <div class="items"><ul class="js-items">
            <li><span class="kind">Credit</span><span class="title">10 USD</span></li>
          </ul></div>
        </li>
      </ul>
      <div class="pagination">
        <span class="active">1</span>
        <a href="/en/account/pledges?page=2">2</a>
        <a href="/en/account/pledges?page=3">3</a>
      </div>
    </div>
  </div>
</body></html>`;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('extension core — RSI hangar parsing', () => {
  it('extracts ships and ignores non-ship pledge items', () => {
    const { ships } = parseHangarDocument(parse(HANGAR_HTML));
    expect(ships.map((s) => s.name)).toEqual(['Aurora MR', 'Anvil Carrack']);
  });

  it('keeps the pledge each ship came from', () => {
    const { ships } = parseHangarDocument(parse(HANGAR_HTML));
    expect(ships[0].pledgeName).toBe('Aurora MR Starter Pack');
    expect(ships[0].pledgeId).toBe('111');
  });

  it('returns nothing for an unrelated document instead of guessing', () => {
    const { ships } = parseHangarDocument(parse('<html><body><h1>Nope</h1></body></html>'));
    expect(ships).toEqual([]);
  });

  it('strips LTI/duration noise from ship names', () => {
    expect(cleanShipName('Anvil Carrack - LTI')).toBe('Anvil Carrack');
    expect(cleanShipName('  Drake   Cutlass Black ')).toBe('Drake Cutlass Black');
    expect(cleanShipName('Origin 300i — 6 Months Insurance')).toBe('Origin 300i');
  });

  it('reads the pagination range', () => {
    expect(readPagination(parse(HANGAR_HTML))).toEqual({ current: 1, last: 3 });
  });

  it('treats a page without pagination as a single page', () => {
    expect(readPagination(parse('<html><body></body></html>'))).toEqual({ current: 1, last: 1 });
  });

  it('builds capped crawl URLs with a large pagesize', () => {
    const urls = buildPageUrls('https://robertsspaceindustries.com/en/account/pledges', 2);
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain('page=1');
    expect(urls[0]).toContain('pagesize=100');
    expect(urls[1]).toContain('page=2');
    expect(buildPageUrls('https://robertsspaceindustries.com/en/account/pledges', 999).length)
      .toBeLessThanOrEqual(10);
  });
});

describe('extension core — login detection', () => {
  const url = 'https://robertsspaceindustries.com/en/account/pledges';

  it('accepts a rendered account page', () => {
    expect(isLoggedInHangar(parse(HANGAR_HTML), url)).toBe(true);
  });

  it('refuses when a sign-in form is present', () => {
    const doc = parse('<html><body><form action="/connect"></form><div class="pledges"></div></body></html>');
    expect(isLoggedInHangar(doc, url)).toBe(false);
  });

  it('refuses outside the hangar URL', () => {
    expect(isLoggedInHangar(parse(HANGAR_HTML), 'https://robertsspaceindustries.com/en/comm-link')).toBe(false);
  });
});

describe('extension core — fleet fingerprint', () => {
  it('is stable regardless of order', () => {
    const a = fingerprintShips([{ name: 'Carrack' }, { name: 'Aurora MR' }]);
    const b = fingerprintShips([{ name: 'Aurora MR' }, { name: 'Carrack' }]);
    expect(a).toBe(b);
  });

  it('is case-insensitive on names', () => {
    expect(fingerprintShips([{ name: 'carrack' }])).toBe(fingerprintShips([{ name: 'Carrack' }]));
  });

  it('changes when a ship is added', () => {
    const before = fingerprintShips([{ name: 'Carrack' }]);
    const after = fingerprintShips([{ name: 'Carrack' }, { name: 'Aurora MR' }]);
    expect(after).not.toBe(before);
  });

  it('changes when the same ship is owned twice', () => {
    const one = fingerprintShips([{ name: 'Carrack' }]);
    const two = fingerprintShips([{ name: 'Carrack' }, { name: 'Carrack' }]);
    expect(two).not.toBe(one);
    expect(countShips([{ name: 'Carrack' }, { name: 'Carrack' }])).toEqual([
      { name: 'Carrack', count: 2 },
    ]);
  });
});

describe('extension core — the update nudge', () => {
  const now = 1_800_000_000_000;
  const fp = 'aaaa1111';

  it('offers the import when nothing was ever imported', () => {
    expect(shouldOfferImport(emptyState(), fp, now)).toEqual({
      offer: true,
      reason: 'first-import',
    });
  });

  it('stays silent for an unchanged hangar — the "10x a day" case', () => {
    const state = recordImport(emptyState(), fp, now);
    expect(shouldOfferImport(state, fp, now + 60_000)).toEqual({
      offer: false,
      reason: 'unchanged',
    });
  });

  it('offers again as soon as the fleet actually changes', () => {
    const state = recordImport(emptyState(), fp, now);
    expect(shouldOfferImport(state, 'bbbb2222', now + 60_000)).toEqual({
      offer: true,
      reason: 'changed',
    });
  });

  it('suppresses a dismissed fingerprint for the cooldown only', () => {
    const state = recordDismissal(emptyState(), fp, now);
    expect(shouldOfferImport(state, fp, now + 1000).offer).toBe(false);
    expect(shouldOfferImport(state, fp, now + DISMISS_COOLDOWN_MS + 1).offer).toBe(true);
  });

  it('lets a changed hangar through an active dismissal', () => {
    const state = recordDismissal(emptyState(), fp, now);
    expect(shouldOfferImport(state, 'cccc3333', now + 1000).offer).toBe(true);
  });

  it('prunes expired dismissals instead of growing forever', () => {
    let state = recordDismissal(emptyState(), 'old', now);
    state = recordDismissal(state, 'new', now + DISMISS_COOLDOWN_MS + 1);
    expect(Object.keys(state.dismissals)).toEqual(['new']);
  });

  it('caps the dismissal map', () => {
    let state = emptyState();
    for (let i = 0; i < 40; i++) state = recordDismissal(state, `fp${i}`, now + i);
    expect(Object.keys(state.dismissals).length).toBeLessThanOrEqual(20);
  });

  it('drops the dismissal once that state is imported', () => {
    let state = recordDismissal(emptyState(), fp, now);
    state = recordImport(state, fp, now + 1000);
    expect(state.dismissals[fp]).toBeUndefined();
    expect(state.lastImport?.fingerprint).toBe(fp);
  });

  it('can re-open a dismissed offer on demand', () => {
    const state = clearDismissal(recordDismissal(emptyState(), fp, now), fp);
    expect(shouldOfferImport(state, fp, now + 1000).offer).toBe(true);
  });

  it('survives corrupt stored state', () => {
    expect(normalizeState(null)).toEqual(emptyState());
    expect(normalizeState({ lastImport: 'nope', dismissals: 7 })).toEqual(emptyState());
    expect(normalizeState({ dismissals: { a: 'x', b: 5 } }).dismissals).toEqual({ b: 5 });
  });
});

describe('extension core — handover payload', () => {
  it('emits Hangar-Transfer-Format shaped rows and no personal fields', () => {
    const payload = toCompanionPayload(
      [{ name: 'Carrack', pledgeName: 'Carrack Upgrade' }],
      1_700_000_000_000,
    );
    expect(payload.ships).toEqual([
      { name: 'Carrack', ship_name: 'Carrack Upgrade', ship_code: null, entity_type: 'ship' },
    ]);
    expect(Object.keys(payload).sort()).toEqual([
      'capturedAt',
      'fingerprint',
      'ships',
      'source',
      'version',
    ]);
  });

  it('caps the payload size', () => {
    const many = Array.from({ length: 900 }, (_, i) => ({ name: `Ship ${i}`, pledgeName: null }));
    expect(toCompanionPayload(many, 0).ships.length).toBeLessThanOrEqual(500);
  });

  it('never points the handover at a foreign origin', () => {
    expect(companionImportUrl('https://evil.example')).toContain('sc-companion.vercel.app');
    expect(companionImportUrl('https://sc-companion.vercel.app')).toBe(
      'https://sc-companion.vercel.app/hangar/import?src=extension',
    );
  });
});
