import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { ScColumnMenuComponent } from './column-menu.component';

describe('ScColumnMenuComponent', () => {
  let fixture: ComponentFixture<ScColumnMenuComponent>;
  let component: ScColumnMenuComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScColumnMenuComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(ScColumnMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Mass');
    fixture.componentRef.setInput('kind', 'numeric');
    // Required inputs (LOW finding: no untranslated English fallback) — every
    // consumer must supply these, so the spec does too.
    fixture.componentRef.setInput('menuOpenLabel', 'Sort and filter column');
    fixture.componentRef.setInput('sortLabel', 'Sort');
    fixture.componentRef.setInput('ascLabel', 'Ascending');
    fixture.componentRef.setInput('descLabel', 'Descending');
    fixture.componentRef.setInput('rangeLabel', 'Range');
    fixture.componentRef.setInput('fromLabel', 'From');
    fixture.componentRef.setInput('toLabel', 'To');
    fixture.componentRef.setInput('filterLabel', 'Filter');
    fixture.componentRef.setInput('clearLabel', 'Clear');
    fixture.detectChanges();
  });

  function labelButton(): HTMLElement {
    return fixture.debugElement.query(By.css('.cm-label')).nativeElement as HTMLElement;
  }
  function summary(): HTMLElement {
    return fixture.debugElement.query(By.css('summary')).nativeElement as HTMLElement;
  }

  it('emits headClick on a plain click of the label (sorts, or flips)', () => {
    const spy = jasmine.createSpy();
    component.headClick.subscribe(spy);
    labelButton().click();
    expect(spy).toHaveBeenCalled();
  });

  it('shows the active sort arrow', () => {
    fixture.componentRef.setInput('sortDir', 'asc');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cm-arrow').textContent).toBe('▲');
  });

  it('opens the popover and emits a sort pick', () => {
    summary().click();
    fixture.detectChanges();
    const spy = jasmine.createSpy();
    component.sortPick.subscribe(spy);
    const buttons = fixture.debugElement.queryAll(By.css('.cm-sortbtn'));
    (buttons[0].nativeElement as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith('asc');
    (buttons[1].nativeElement as HTMLElement).click();
    expect(spy).toHaveBeenCalledWith('desc');
  });

  it('emits a numeric range on the from/to inputs', () => {
    const spy = jasmine.createSpy();
    component.rangeChange.subscribe(spy);
    const [from, to] = fixture.debugElement.queryAll(By.css('.cm-range input')).map((d) => d.nativeElement as HTMLInputElement);
    from.value = '10';
    from.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith({ min: 10, max: null });
    to.value = '50';
    to.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith({ min: 10, max: 50 });
  });

  it('renders a categorical facet list and emits a toggle per checkbox', () => {
    fixture.componentRef.setInput('kind', 'categorical');
    fixture.componentRef.setInput('facets', [
      { value: 'A', count: 3, selected: false },
      { value: 'B', count: 1, selected: true },
    ]);
    fixture.detectChanges();
    const spy = jasmine.createSpy();
    component.facetToggle.subscribe(spy);
    const boxes = fixture.debugElement.queryAll(By.css('.cm-facet input'));
    expect(boxes.length).toBe(2);
    (boxes[0].nativeElement as HTMLInputElement).dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith('A');
  });

  it('emits clearFilter and closes the popover', () => {
    summary().click();
    fixture.detectChanges();
    const det = fixture.debugElement.query(By.css('details')).nativeElement as HTMLDetailsElement;
    det.open = true;
    const spy = jasmine.createSpy();
    component.clearFilter.subscribe(spy);
    (fixture.debugElement.query(By.css('.cm-clear')).nativeElement as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
    expect(det.open).toBeFalse();
  });

  it('Escape closes the popover from inside the panel', () => {
    const det = fixture.debugElement.query(By.css('details')).nativeElement as HTMLDetailsElement;
    det.open = true;
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.css('.cm-panel')).nativeElement as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(det.open).toBeFalse();
  });

  it('arrow keys move focus within the facet checkbox list', () => {
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('kind', 'categorical');
    fixture.componentRef.setInput('facets', [
      { value: 'A', count: 3, selected: false },
      { value: 'B', count: 1, selected: false },
    ]);
    fixture.detectChanges();
    summary().click(); // native <details> hides its content — and blocks focus — until open
    fixture.detectChanges();
    const boxes = fixture.debugElement
      .queryAll(By.css('.cm-facet input'))
      .map((d) => d.nativeElement as HTMLInputElement);
    boxes[0].focus();
    const panel = fixture.debugElement.query(By.css('.cm-panel')).nativeElement as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(boxes[1]);
    fixture.nativeElement.remove();
  });
});
