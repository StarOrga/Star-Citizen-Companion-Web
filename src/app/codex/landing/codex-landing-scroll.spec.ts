import { INDEX_WHEEL_GAP_MS, INDEX_WHEEL_THRESHOLD, IndexWheelGate, wheelBelongsToInner } from './codex-landing-scroll';

describe('codex landing → index wheel gate', () => {
  it('opens only once the downward sum crosses the threshold', () => {
    const gate = new IndexWheelGate();
    expect(gate.push(INDEX_WHEEL_THRESHOLD / 2, 0)).toBeFalse();
    expect(gate.push(INDEX_WHEEL_THRESHOLD / 2, 50)).toBeTrue();
  });

  it('starts over after an upward turn', () => {
    const gate = new IndexWheelGate();
    gate.push(INDEX_WHEEL_THRESHOLD - 10, 0);
    expect(gate.push(-20, 20)).toBeFalse();
    expect(gate.push(20, 40)).toBeFalse();
  });

  it('starts over after a pause', () => {
    const gate = new IndexWheelGate();
    gate.push(INDEX_WHEEL_THRESHOLD - 10, 0);
    expect(gate.push(20, INDEX_WHEEL_GAP_MS + 1)).toBeFalse();
  });

  it('starts over on reset', () => {
    const gate = new IndexWheelGate();
    gate.push(INDEX_WHEEL_THRESHOLD - 10, 0);
    gate.reset();
    expect(gate.push(20, 10)).toBeFalse();
  });
});

describe('wheelBelongsToInner', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('is true inside a pane that can still scroll down', () => {
    const pane = document.createElement('div');
    pane.style.cssText = 'overflow-y:auto;height:40px';
    const tall = document.createElement('div');
    tall.style.height = '200px';
    pane.appendChild(tall);
    host.appendChild(pane);
    expect(wheelBelongsToInner(tall, host)).toBeTrue();
  });

  it('is false once that pane is scrolled to its end', () => {
    const pane = document.createElement('div');
    pane.style.cssText = 'overflow-y:auto;height:40px';
    const tall = document.createElement('div');
    tall.style.height = '200px';
    pane.appendChild(tall);
    host.appendChild(pane);
    pane.scrollTop = 1000;
    expect(wheelBelongsToInner(tall, host)).toBeFalse();
  });

  it('is true inside the hologram (it zooms on the wheel)', () => {
    const viewer = document.createElement('model-viewer');
    const inner = document.createElement('span');
    viewer.appendChild(inner);
    host.appendChild(viewer);
    expect(wheelBelongsToInner(inner, host)).toBeTrue();
  });

  it('is false on plain page content', () => {
    const p = document.createElement('p');
    host.appendChild(p);
    expect(wheelBelongsToInner(p, host)).toBeFalse();
  });
});
