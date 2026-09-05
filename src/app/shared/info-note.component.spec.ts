import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InfoNoteComponent } from './info-note.component';

@Component({
  standalone: true,
  imports: [InfoNoteComponent],
  template: `<sc-info-note label="Woher?"><p class="body">Median-Schätzung</p></sc-info-note>`,
})
class HostComponent {}

/**
 * The (i) that hides the caveats until they are asked for (feedback
 * 01df732d). Three contracts: it starts closed, it toggles, and it gets out
 * of the way again on Escape or a click somewhere else.
 */
describe('InfoNoteComponent — the folded-away explanation', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const button = () => root().querySelector('button.dot') as HTMLButtonElement;
  const pop = () => root().querySelector('.pop') as HTMLElement;

  it('starts closed, with the note hidden but present for its label', () => {
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(pop().hidden).toBeTrue();
    expect(pop().textContent).toContain('Median-Schätzung');
  });

  it('opens and closes on the button', () => {
    button().click();
    fixture.detectChanges();
    expect(pop().hidden).toBeFalse();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    button().click();
    fixture.detectChanges();
    expect(pop().hidden).toBeTrue();
  });

  it('closes on Escape and on a click outside, and stays open on a click inside', () => {
    button().click();
    fixture.detectChanges();
    pop().click();
    fixture.detectChanges();
    expect(pop().hidden).withContext('a click on the note itself keeps it open').toBeFalse();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(pop().hidden).toBeTrue();

    button().click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(pop().hidden).toBeTrue();
  });
});
