import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { STEP_KINDS, STEP_SHAPES, ScStepComponent, StepKind, StepState } from './sc-step.component';

@Component({
  standalone: true,
  imports: [ScStepComponent],
  template: `<sc-step [kind]="kind()" [state]="state()" label="Gold" [qty]="3" location="Lorville" [undoable]="true" (undo)="undone = true" />`,
})
class HostComponent {
  readonly kind = signal<StepKind>('buy');
  readonly state = signal<StepState>('todo');
  undone = false;
}

describe('ScStepComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTranslateService({ fallbackLang: 'en' })] }));

  function setup() {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    return f;
  }

  it('has one shape per kind (D29)', () => {
    expect(STEP_KINDS.length).toBe(8);
    for (const k of STEP_KINDS) expect(STEP_SHAPES[k]).toBeTruthy();
  });

  it('renders verb key, label, quantity and place for a todo step without undo', () => {
    const el: HTMLElement = setup().nativeElement;
    expect(el.querySelector('.verb')?.textContent).toContain('hq.step.kind.buy');
    expect(el.querySelector('.label')?.textContent).toContain('Gold');
    expect(el.querySelector('.qty')?.textContent).toContain('×3');
    expect(el.querySelector('.where')?.textContent).toContain('Lorville');
    expect(el.querySelector('.state')?.textContent).toContain('hq.step.state.todo');
    expect(el.querySelector('.undo')).toBeNull();
    expect(el.querySelector('sc-step')?.getAttribute('data-state')).toBe('todo');
  });

  it('draws the transport kind as a circle and others as polygons', () => {
    const f = setup();
    expect(f.nativeElement.querySelector('.shape polygon')).not.toBeNull();
    f.componentInstance.kind.set('transport');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.shape circle')).not.toBeNull();
  });

  it('the done variant shows the state and the undo button', () => {
    const f = setup();
    f.componentInstance.state.set('done');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.state.done')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.undo')!.click();
    expect(f.componentInstance.undone).toBe(true);
  });
});
