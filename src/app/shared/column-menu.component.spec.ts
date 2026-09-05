import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { OverlayContainer } from '@angular/cdk/overlay';
import { provideTranslateService } from '@ngx-translate/core';
import { ScColumnMenuComponent } from './column-menu.component';

// MEDIUM-5: the popover panel is portaled through CDK's `Overlay` (into a
// `.cdk-overlay-container` appended to `<body>`) rather than rendered as a
// plain child of `<details>` — so it is only present in the DOM at all while
// the menu is open, and it must be queried via `OverlayContainer`, not via
// `fixture.debugElement`/`fixture.nativeElement`.
describe('ScColumnMenuComponent', () => {
  let fixture: ComponentFixture<ScColumnMenuComponent>;
  let component: ScColumnMenuComponent;
  let overlayContainer: OverlayContainer;
  let overlayContainerElement: HTMLElement;

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
    // Connected to the document — the overlay's `flexibleConnectedTo` position
    // strategy and the scroll-close strategy both need a real, laid-out origin.
    document.body.appendChild(fixture.nativeElement);
    overlayContainer = TestBed.inject(OverlayContainer);
    overlayContainerElement = overlayContainer.getContainerElement();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    overlayContainer.ngOnDestroy();
  });

  function labelButton(): HTMLElement {
    return fixture.debugElement.query(By.css('.cm-label')).nativeElement as HTMLElement;
  }
  function summary(): HTMLElement {
    return fixture.debugElement.query(By.css('summary')).nativeElement as HTMLElement;
  }
  // A real click on <summary> toggles the native `open` attribute
  // synchronously, but the browser fires the associated `toggle` EVENT as a
  // queued task rather than inline with the click — so a synchronous
  // Jasmine spec never observes it via `.click()` alone. Driving both the
  // attribute and the event by hand keeps the open path deterministic for
  // tests while the component itself is exercised exactly the way it would
  // be by a real (later) `toggle` event.
  function openPanel(): void {
    const det = fixture.debugElement.query(By.css('details')).nativeElement as HTMLDetailsElement;
    det.open = true;
    det.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
  }
  function panel(): HTMLElement | null {
    return overlayContainerElement.querySelector('.cm-panel');
  }

  it('emits headClick on a plain click of the label (sorts, or flips)', () => {
    const spy = jasmine.createSpy();
    component.headClick.subscribe(spy);
    labelButton().click();
    expect(spy).toHaveBeenCalledWith(false);
  });

  it('emits headClick(true) on a Ctrl-click of the label (E-main-gap #41 secondary-sort shortcut)', () => {
    const spy = jasmine.createSpy();
    component.headClick.subscribe(spy);
    labelButton().dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('renders a unit suffix as a separate <small>, never concatenated into the label', () => {
    fixture.componentRef.setInput('unit', 'kg');
    fixture.detectChanges();
    const unitEl = fixture.nativeElement.querySelector('.unit') as HTMLElement;
    expect(unitEl.textContent).toBe('kg');
    expect(labelButton().textContent).toContain('Mass');
  });

  it('portals the popover panel into the CDK overlay container, not as a DOM child of .cm-pop', () => {
    expect(panel()).toBeNull();
    openPanel();
    expect(panel()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.cm-panel')).toBeNull();
  });

  it('hides the secondary-sort entry when no label is supplied, shows it and emits otherwise', () => {
    openPanel();
    expect(panel()!.querySelector('.cm-secondary')).toBeNull();
    fixture.componentRef.setInput('secondarySortLabel', 'Als zweite Sortierung');
    fixture.detectChanges();
    const btn = panel()!.querySelector('.cm-secondary') as HTMLElement;
    expect(btn.textContent?.trim()).toBe('Als zweite Sortierung');
    const spy = jasmine.createSpy();
    component.secondarySortToggle.subscribe(spy);
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('LOW-3 (ui-spec-13-a11y): exposes the secondary-sort toggle state via aria-pressed', () => {
    fixture.componentRef.setInput('secondarySortLabel', 'Als zweite Sortierung');
    openPanel();
    const btn = panel()!.querySelector('.cm-secondary') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fixture.componentRef.setInput('secondaryActive', true);
    fixture.detectChanges();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the active sort arrow', () => {
    fixture.componentRef.setInput('sortDir', 'asc');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cm-arrow').textContent).toBe('▲');
  });

  it('opens the popover and emits a sort pick', () => {
    openPanel();
    const spy = jasmine.createSpy();
    component.sortPick.subscribe(spy);
    const buttons = Array.from(panel()!.querySelectorAll('.cm-sortbtn')) as HTMLElement[];
    buttons[0].click();
    expect(spy).toHaveBeenCalledWith('asc');
    buttons[1].click();
    expect(spy).toHaveBeenCalledWith('desc');
  });

  it('emits a numeric range on the from/to inputs', () => {
    openPanel();
    const spy = jasmine.createSpy();
    component.rangeChange.subscribe(spy);
    const [from, to] = Array.from(panel()!.querySelectorAll('.cm-range input')) as HTMLInputElement[];
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
    openPanel();
    const spy = jasmine.createSpy();
    component.facetToggle.subscribe(spy);
    const boxes = Array.from(panel()!.querySelectorAll('.cm-facet input')) as HTMLInputElement[];
    expect(boxes.length).toBe(2);
    boxes[0].dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith('A');
  });

  it('emits clearFilter and closes the popover', () => {
    openPanel();
    const det = fixture.debugElement.query(By.css('details')).nativeElement as HTMLDetailsElement;
    const spy = jasmine.createSpy();
    component.clearFilter.subscribe(spy);
    (panel()!.querySelector('.cm-clear') as HTMLElement).click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalled();
    expect(det.open).toBeFalse();
    expect(panel()).toBeNull();
  });

  it('Escape closes the popover from inside the panel', () => {
    openPanel();
    const det = fixture.debugElement.query(By.css('details')).nativeElement as HTMLDetailsElement;
    panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(det.open).toBeFalse();
    expect(panel()).toBeNull();
  });

  it('arrow keys move focus within the facet checkbox list', () => {
    fixture.componentRef.setInput('kind', 'categorical');
    fixture.componentRef.setInput('facets', [
      { value: 'A', count: 3, selected: false },
      { value: 'B', count: 1, selected: false },
    ]);
    fixture.detectChanges();
    openPanel();
    const boxes = Array.from(panel()!.querySelectorAll('.cm-facet input')) as HTMLInputElement[];
    boxes[0].focus();
    panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(boxes[1]);
  });
});
