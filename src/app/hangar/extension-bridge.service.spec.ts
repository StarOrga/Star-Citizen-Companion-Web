import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ExtensionBridgeService } from './extension-bridge.service';

// Audit D16 step 5 (AUD-071): the page side of the extension handover only
// trusts same-window, same-origin replies from the extension's content script.
describe('ExtensionBridgeService', () => {
  const PAYLOAD = {
    version: 1,
    source: 'rsi',
    capturedAt: 1700000000000,
    fingerprint: 'fp-1',
    ships: [{ name: 'Carrack', ship_name: null, ship_code: 'ANVL_Carrack', entity_type: 'ship' }],
  };

  let svc: ExtensionBridgeService;

  function reply(init: MessageEventInit, data: unknown = {
    source: 'sc-companion-extension',
    type: 'hangar-import:payload',
    payload: PAYLOAD,
  }): void {
    window.dispatchEvent(new MessageEvent('message', { data, ...init }));
  }

  beforeEach(() => {
    document.documentElement.removeAttribute('data-sc-companion-extension');
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ExtensionBridgeService);
  });

  afterEach(() => document.documentElement.removeAttribute('data-sc-companion-extension'));

  it('resolves a matching reply and marks the extension installed', fakeAsync(() => {
    let result: unknown = 'unset';
    void svc.requestPayload().then((p) => (result = p));
    reply({ origin: window.location.origin, source: window });
    tick();
    expect(result).toEqual(PAYLOAD);
    expect(svc.installed()).toBeTrue();
  }));

  it('ignores a reply from a foreign origin', fakeAsync(() => {
    let result: unknown = 'unset';
    void svc.requestPayload().then((p) => (result = p));
    reply({ origin: 'https://evil.example.com', source: window });
    tick();
    expect(result).toBe('unset');
    expect(svc.installed()).toBeFalse();
    tick(2500);
    expect(result).toBeNull();
  }));

  it('ignores a reply whose source is not this window', fakeAsync(() => {
    let result: unknown = 'unset';
    void svc.requestPayload().then((p) => (result = p));
    reply({ origin: window.location.origin, source: null });
    tick();
    expect(result).toBe('unset');
    tick(2500);
    expect(result).toBeNull();
  }));

  it('resolves null for a malformed payload from the extension', fakeAsync(() => {
    let result: unknown = 'unset';
    void svc.requestPayload().then((p) => (result = p));
    reply(
      { origin: window.location.origin, source: window },
      { source: 'sc-companion-extension', type: 'hangar-import:payload', payload: { nope: true } },
    );
    tick();
    expect(result).toBeNull();
  }));

  it('resolves null after 2500 ms without a reply', fakeAsync(() => {
    let result: unknown = 'unset';
    void svc.requestPayload().then((p) => (result = p));
    tick(2499);
    expect(result).toBe('unset');
    tick(1);
    expect(result).toBeNull();
  }));

  it('waitForExtension(800) is false without the presence attribute', fakeAsync(() => {
    let result: boolean | undefined;
    void svc.waitForExtension(800).then((v) => (result = v));
    tick(1000);
    expect(result).toBeFalse();
    expect(svc.installed()).toBeFalse();
  }));

  it('waitForExtension is true once the attribute appears', fakeAsync(() => {
    let result: boolean | undefined;
    void svc.waitForExtension(800).then((v) => (result = v));
    tick(200);
    document.documentElement.setAttribute('data-sc-companion-extension', '1.2.3');
    tick(200);
    expect(result).toBeTrue();
    expect(svc.version()).toBe('1.2.3');
  }));
});
