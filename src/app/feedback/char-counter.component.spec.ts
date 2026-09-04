import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CharCounterComponent } from './char-counter.component';
import { FEEDBACK_COUNTER_WARN_AT, FEEDBACK_MAX_CHARS } from './feedback-limits';

/**
 * The live readout the admin asked for (admin feedback 0a0fad31): "welches dem
 * nutzer im input feld rechts unten halb transparente live angezeigt wird".
 * Half-transparent furniture while there is room, a warning as the cap comes
 * into view, and unmistakable once it is reached.
 */
describe('CharCounterComponent', () => {
  async function setup(used: number, max = FEEDBACK_MAX_CHARS) {
    await TestBed.configureTestingModule({
      imports: [CharCounterComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    }).compileComponents();

    const fixture = TestBed.createComponent(CharCounterComponent);
    fixture.componentRef.setInput('used', used);
    fixture.componentRef.setInput('max', max);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the live count against the shared cap', async () => {
    const fixture = await setup(120);
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe(
      `120 / ${FEEDBACK_MAX_CHARS}`,
    );
  });

  it('stays quiet while there is room', async () => {
    const fixture = await setup(10);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('warn')).toBeFalse();
    expect(host.classList.contains('over')).toBeFalse();
    expect(fixture.componentInstance.warn()).toBeFalse();
  });

  it('warns once the remaining characters fall to the warn window', async () => {
    const fixture = await setup(FEEDBACK_MAX_CHARS - FEEDBACK_COUNTER_WARN_AT);
    expect(fixture.componentInstance.warn()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).classList.contains('warn')).toBeTrue();
  });

  it('switches from warning to "at the limit" on the last character', async () => {
    const fixture = await setup(FEEDBACK_MAX_CHARS);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('over')).toBeTrue();
    // Never both: the limit state replaces the warning, it does not add to it.
    expect(host.classList.contains('warn')).toBeFalse();
  });

  it('is hidden from assistive tech — the field maxlength is what speaks', async () => {
    const fixture = await setup(5);
    expect((fixture.nativeElement as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });
});
