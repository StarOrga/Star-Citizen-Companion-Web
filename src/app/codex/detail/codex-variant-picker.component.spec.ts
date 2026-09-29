import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexVariantPickerComponent } from './codex-variant-picker.component';

describe('CodexVariantPickerComponent', () => {
  let fixture: ComponentFixture<CodexVariantPickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexVariantPickerComponent],
      providers: [provideRouter([]), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexVariantPickerComponent);
    fixture.componentRef.setInput('variant', 'edition');
    fixture.componentRef.setInput('kind', 'weapon');
    fixture.componentRef.setInput('currentSlug', 'gun_b');
    fixture.componentRef.setInput('options', [
      { classNameSlug: 'gun_a', label: null },
      { classNameSlug: 'gun_b', label: 'Tactical' },
    ]);
    fixture.componentRef.setInput('current', 'Tactical');
    fixture.detectChanges();
  });

  it('renders every option as a real anchor and marks the open record', () => {
    const el: HTMLElement = fixture.nativeElement;
    const details = el.querySelector('details') as HTMLElement;
    expect(details.classList).toContain('picker');
    expect(details.classList).toContain('edition-picker');
    expect(details.classList).not.toContain('skin-picker');

    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.sp-opt'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/codex/weapon/gun_a', '/codex/weapon/gun_b']);
    expect(links[0].getAttribute('aria-current')).toBeNull();
    expect(links[1].getAttribute('aria-current')).toBe('true');
    expect(links[1].classList).toContain('current');
    // The base record has no label of its own: it reads "Standard".
    expect(links[0].textContent).toContain('codex.editionPicker.standard');
    expect(el.querySelector('.sp-current')?.textContent).toContain('Tactical');
    expect(el.querySelector('.sp-label')?.textContent).toContain('codex.editionPicker.label');
  });

  it('uses the codex.skinPicker keys for the skin variant', () => {
    fixture.componentRef.setInput('variant', 'skin');
    fixture.componentRef.setInput('current', null);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('details')?.classList).toContain('skin-picker');
    expect(el.querySelector('.sp-label')?.textContent).toContain('codex.skinPicker.label');
    expect(el.querySelector('.sp-current')?.textContent).toContain('codex.skinPicker.standard');
    expect(el.querySelector('.sp-count')?.textContent).toContain('codex.skinPicker.count');
  });
});
