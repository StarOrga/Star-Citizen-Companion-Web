import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { ClassChipComponent } from './class-chip.component';

@Component({
  standalone: true,
  imports: [ClassChipComponent],
  template: `<sc-class-chip [value]="value()" [copyable]="copyable()" />`,
})
class HostComponent {
  readonly value = signal('AEGS_Avenger_Stalker');
  readonly copyable = signal(true);
}

describe('ClassChipComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideTranslateService({})] });
  });

  it('copies the class name and confirms it', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button.chip');
    expect(btn.textContent).toContain('AEGS_Avenger_Stalker');
    expect(btn.getAttribute('aria-label')).toBe('classChip.copyAria');

    // Awaited directly: whenStable would also wait out the 1.8 s reset timer.
    const chip = fixture.debugElement.query(By.directive(ClassChipComponent)).componentInstance as ClassChipComponent;
    btn.click();
    await chip.copy();
    fixture.detectChanges();
    expect(write).toHaveBeenCalledWith('AEGS_Avenger_Stalker');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent?.trim()).toBe('classChip.copied');
  });

  it('stays quiet when the clipboard is denied', async () => {
    spyOn(navigator.clipboard, 'writeText').and.rejectWith(new Error('denied'));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const chip = fixture.debugElement.query(By.directive(ClassChipComponent)).componentInstance as ClassChipComponent;
    await chip.copy();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
  });

  it('renders no button inside a link card (copyable=false)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.copyable.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('button')).toBeNull();
    expect(el.querySelector('span.chip')?.textContent?.trim()).toBe('AEGS_Avenger_Stalker');
  });
});
