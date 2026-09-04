import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScSelectComponent, ScSelectOption } from './sc-select.component';

const OPTIONS: readonly ScSelectOption[] = [
  { value: 'verse', labelKey: 'tax.verse' },
  { value: 'in_game', labelKey: 'tax.inGame' },
  { value: 'out_of_game', labelKey: 'tax.outOfGame' },
];

@Component({
  standalone: true,
  imports: [ScSelectComponent],
  template: `
    <sc-select
      [options]="options"
      [value]="value()"
      [disabled]="disabled()"
      placeholderKey="none"
      ariaLabel="Scope"
      (valueChange)="value.set($event)"
    />
  `,
})
class HostComponent {
  readonly options = OPTIONS;
  readonly value = signal<string | null>(null);
  readonly disabled = signal(false);
}

describe('ScSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = <T extends HTMLElement>(sel: string) =>
    fixture.nativeElement.querySelector(sel) as T | null;
  const trigger = () => el<HTMLButtonElement>('.trigger')!;
  const options = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.option')) as HTMLElement[];
  const key = (k: string, init: KeyboardEventInit = {}) => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders no native select — the OS-drawn popup is the whole point', () => {
    expect(el('select')).toBeNull();
    expect(trigger().getAttribute('role')).toBe('combobox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the placeholder until a value is picked', () => {
    expect(el('.value')!.textContent!.trim()).toBe('none');
    host.value.set('in_game');
    fixture.detectChanges();
    expect(el('.value')!.textContent!.trim()).toBe('tax.inGame');
  });

  it('opens on click and lists the placeholder plus every option', () => {
    expect(el('.panel')).toBeNull();
    trigger().click();
    fixture.detectChanges();

    expect(el('.panel')).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(options().length).toBe(OPTIONS.length + 1);
    expect(options()[0].textContent!.trim()).toBe('none');
  });

  it('marks the current value as the selected option', () => {
    host.value.set('verse');
    fixture.detectChanges();
    trigger().click();
    fixture.detectChanges();

    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent!.trim()).toBe('tax.verse');
  });

  it('emits the picked value on click and closes', () => {
    trigger().click();
    fixture.detectChanges();
    options()[2].click();
    fixture.detectChanges();

    expect(host.value()).toBe('in_game');
    expect(el('.panel')).toBeNull();
  });

  it('emits null when the placeholder row is picked', () => {
    host.value.set('verse');
    fixture.detectChanges();
    trigger().click();
    fixture.detectChanges();
    options()[0].click();
    fixture.detectChanges();

    expect(host.value()).toBeNull();
  });

  it('drives the list from the keyboard (ArrowDown → Enter)', () => {
    key('ArrowDown'); // opens, active = placeholder (nothing picked yet)
    expect(el('.panel')).not.toBeNull();
    key('ArrowDown'); // → first real option
    key('Enter');

    expect(host.value()).toBe('verse');
    expect(el('.panel')).toBeNull();
  });

  it('jumps to the end and back to the start with End/Home', () => {
    key('ArrowDown');
    key('End');
    key('Enter');
    expect(host.value()).toBe('out_of_game');

    key('ArrowDown');
    key('Home');
    key('Enter');
    expect(host.value()).toBeNull();
  });

  it('closes on Escape without changing the value', () => {
    host.value.set('verse');
    fixture.detectChanges();
    key('ArrowDown');
    key('ArrowDown');
    key('Escape');

    expect(el('.panel')).toBeNull();
    expect(host.value()).toBe('verse');
  });

  it('jumps to a matching label when typing', () => {
    key('ArrowDown');
    key('t'); // every label starts with "tax." — the first match after the placeholder
    key('Enter');
    expect(host.value()).toBe('verse');
  });

  it('closes when a pointer lands outside', () => {
    trigger().click();
    fixture.detectChanges();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(el('.panel')).toBeNull();
  });

  it('stays shut while disabled', () => {
    host.disabled.set(true);
    fixture.detectChanges();

    trigger().click();
    key('ArrowDown');
    fixture.detectChanges();

    expect(el('.panel')).toBeNull();
    expect(trigger().disabled).toBeTrue();
  });
});

/**
 * A caller that needs its labels in a language other than the UI's — the Codex
 * input actions, where an English-original switch has to show the taxonomy the
 * way the game names it. `label` is pre-resolved text and must beat `labelKey`.
 */
@Component({
  standalone: true,
  imports: [ScSelectComponent],
  template: `
    <sc-select
      [options]="options()"
      [value]="value()"
      placeholderKey="tax.none"
      [placeholderLabel]="placeholderLabel()"
      (valueChange)="value.set($event)"
    />
  `,
})
class OverrideHostComponent {
  readonly options = signal<readonly ScSelectOption[]>([
    { value: 'verse', labelKey: 'tax.verse', label: 'Verse' },
    { value: 'in_game', labelKey: 'tax.inGame', label: 'In-Game (UI)' },
  ]);
  readonly value = signal<string | null>(null);
  readonly placeholderLabel = signal<string | null>('— none —');
}

describe('ScSelectComponent with pre-resolved labels', () => {
  let fixture: ComponentFixture<OverrideHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OverrideHostComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(OverrideHostComponent);
    fixture.detectChanges();
  });

  it('renders `label` over `labelKey` for the trigger and every option', () => {
    const trigger = fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement;
    // Placeholder first: no value picked yet.
    expect(trigger.textContent!.trim()).toBe('— none —');

    trigger.click();
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.option .label') as NodeListOf<HTMLElement>,
    ).map((e) => e.textContent!.trim());
    expect(labels).toEqual(['— none —', 'Verse', 'In-Game (UI)']);

    fixture.componentInstance.value.set('in_game');
    fixture.detectChanges();
    expect(trigger.textContent!.trim()).toBe('In-Game (UI)');
  });

  it('still falls back to the i18n key when no `label` is supplied', () => {
    fixture.componentInstance.options.set([{ value: 'verse', labelKey: 'tax.verse' }]);
    fixture.componentInstance.placeholderLabel.set(null);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.option .label') as NodeListOf<HTMLElement>,
    ).map((e) => e.textContent!.trim());
    // No translations loaded in this harness, so ngx-translate echoes the keys.
    expect(labels).toEqual(['tax.none', 'tax.verse']);
  });
});

describe('ScSelectComponent — allowEmpty=false (required picker)', () => {
  @Component({
    standalone: true,
    imports: [ScSelectComponent],
    template: `
      <sc-select
        [options]="options"
        [allowEmpty]="false"
        [value]="value()"
        placeholderKey="none"
        ariaLabel="Role"
        (valueChange)="value.set($event)"
      />
    `,
  })
  class RequiredHost {
    readonly options = OPTIONS;
    readonly value = signal<string | null>('verse');
  }

  let fixture: ComponentFixture<RequiredHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequiredHost],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(RequiredHost);
    fixture.detectChanges();
  });

  it('offers no empty row — a role picker has no "nothing picked" answer', () => {
    (fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.option .label') as NodeListOf<HTMLElement>,
    ).map((e) => e.textContent!.trim());
    expect(labels).toEqual(['tax.verse', 'tax.inGame', 'tax.outOfGame']);
  });

  it('never emits null', () => {
    (fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    const opts = Array.from(
      fixture.nativeElement.querySelectorAll('.option') as NodeListOf<HTMLElement>,
    );
    opts[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('out_of_game');
  });
});
