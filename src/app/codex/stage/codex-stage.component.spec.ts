import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { installResizeDriver } from '../../testing/frames';
import { CodexStageComponent } from './codex-stage.component';

// Valid 1x1 GIFs, so the browser never fires a REAL error/load of its own:
// every event in these specs is the one the spec dispatches.
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SRC_A = `${GIF}#a`;
const SRC_B = `${GIF}#b`;
const SRC_C = `${GIF}#c`;

interface IdleGlobal { requestIdleCallback: (cb: () => void) => number }

describe('CodexStageComponent', () => {
  function setup(kind: 'ship' | 'person' = 'ship'): ComponentFixture<CodexStageComponent> {
    TestBed.configureTestingModule({
      imports: [CodexStageComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(CodexStageComponent);
    fixture.componentRef.setInput('kind', kind);
    return fixture;
  }

  const img = (f: ComponentFixture<CodexStageComponent>): HTMLImageElement | null =>
    (f.nativeElement as HTMLElement).querySelector<HTMLImageElement>('img.stage-img');

  /** Run the post-load work at once instead of waiting for an idle slot / a real decode. */
  function runLoadWorkImmediately(): void {
    spyOn(globalThis as unknown as IdleGlobal, 'requestIdleCallback').and.callFake((cb: () => void) => {
      cb();
      return 0;
    });
    spyOn(HTMLImageElement.prototype, 'decode').and.resolveTo();
  }

  async function flush(fixture: ComponentFixture<CodexStageComponent>): Promise<void> {
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders no image while there is no art', () => {
    const fixture = setup();
    fixture.detectChanges();
    expect(img(fixture)).toBeNull();
  });

  it('starts on the primary source and walks the fallbacks on each error event', () => {
    const fixture = setup();
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [SRC_B, SRC_C] });
    fixture.componentRef.setInput('stageTitle', 'Avenger');
    fixture.detectChanges();
    expect(img(fixture)!.getAttribute('src')).toBe(SRC_A);

    img(fixture)!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(img(fixture)!.getAttribute('src')).toBe(SRC_B);

    img(fixture)!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(img(fixture)!.getAttribute('src')).toBe(SRC_C);
  });

  it('stays on the last candidate and keeps the contain fallback when the chain is exhausted', () => {
    const fixture = setup();
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [SRC_B] });
    fixture.detectChanges();
    img(fixture)!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    img(fixture)!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(img(fixture)!.getAttribute('src')).toBe(SRC_B);
    expect((fixture.nativeElement as HTMLElement).querySelector('article.stage')!.classList).toContain('fallback');
    expect(img(fixture)!.classList).not.toContain('loaded');
  });

  it('restarts the chain from the top when a new subject arrives', () => {
    const fixture = setup();
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [SRC_B] });
    fixture.detectChanges();
    img(fixture)!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(img(fixture)!.getAttribute('src')).toBe(SRC_B);

    fixture.componentRef.setInput('art', { src: SRC_C, fallbacks: [] });
    fixture.detectChanges();
    expect(img(fixture)!.getAttribute('src')).toBe(SRC_C);
  });

  it('renders the whole picture as an anchor to the ship page', () => {
    const fixture = setup();
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [] });
    fixture.componentRef.setInput('stageTitle', 'Avenger');
    fixture.componentRef.setInput('routerLinkTo', ['/codex', 'avenger']);
    fixture.detectChanges();
    const hit = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a.stage-hit')!;
    expect(hit.getAttribute('href')).toBe('/codex/avenger');
    expect(hit.textContent).toContain('Avenger');
  });

  it('re-lays the image out when the stage is resized', async () => {
    const resize = installResizeDriver();
    runLoadWorkImmediately();

    const fixture = setup();
    const host = fixture.nativeElement as HTMLElement;
    host.style.cssText = 'display:block;width:400px;height:200px';
    document.body.appendChild(host);
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [] });
    fixture.detectChanges();

    img(fixture)!.dispatchEvent(new Event('load'));
    await flush(fixture);
    fixture.detectChanges();

    const article = host.querySelector<HTMLElement>('article.stage')!;
    expect(resize.observed()).toContain(article);
    const before = Number.parseFloat(article.style.getPropertyValue('--sw'));
    expect(before).toBeGreaterThan(0);

    host.style.width = '900px';
    host.style.height = '600px';
    resize.notify();
    fixture.detectChanges();

    expect(Number.parseFloat(article.style.getPropertyValue('--sw'))).toBeGreaterThan(before);
    host.remove();
  });

  it('stops observing the stage when destroyed', async () => {
    const resize = installResizeDriver();
    runLoadWorkImmediately();
    const fixture = setup();
    const host = fixture.nativeElement as HTMLElement;
    host.style.cssText = 'display:block;width:300px;height:200px';
    document.body.appendChild(host);
    fixture.componentRef.setInput('art', { src: SRC_A, fallbacks: [] });
    fixture.detectChanges();
    img(fixture)!.dispatchEvent(new Event('load'));
    await flush(fixture);
    expect(resize.observed().length).toBe(1);

    fixture.destroy();
    expect(resize.observed().length).toBe(0);
    host.remove();
  });

  it('person kind renders no image and the title as h1 when asked', () => {
    const fixture = setup('person');
    fixture.componentRef.setInput('stageTitle', 'Loadout');
    fixture.componentRef.setInput('titleAs', 'h1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(img(fixture)).toBeNull();
    expect(el.querySelector('h1.stage-title')!.textContent).toContain('Loadout');
  });
});
