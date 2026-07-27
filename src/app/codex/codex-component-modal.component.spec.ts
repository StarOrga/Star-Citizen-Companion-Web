import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  CodexComponentModalComponent,
  ComponentInspectEntry,
} from './codex-component-modal.component';

// The overlay is the answer to "wenn ich auf die Waffe drücke, soll sich ein
// Fenster öffnen — vor allem die Tabelle mit allen Werten", so these guard that
// the table actually renders every value the payload carries, not just the
// curated headline chips.

const PANTHER: ComponentInspectEntry = {
  className: 'KLWE_LaserRepeater_S3',
  kind: 'weapon',
  name: 'CF-337 Panther Repeater',
  port: 'Hardpoint Weapon Top Left',
  count: 3,
  size: 3,
  grade: 'A',
  manufacturerCode: 'KLA',
  typeLabel: 'Gun',
  payload: {
    entityKind: 'weapon',
    className: 'KLWE_LaserRepeater_S3',
    size: 3,
    grade: 'A',
    subType: 'Gun',
    weaponParams: { heatPerShot: 12.5 },
  },
  ammoPayload: {
    speed: 1480,
    lifetime: 1.3,
    impactDamage: { energy: 43.65 },
  },
};

describe('CodexComponentModalComponent', () => {
  let fixture: ComponentFixture<CodexComponentModalComponent>;

  function render(entry: ComponentInspectEntry | null): HTMLElement {
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexComponentModalComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexComponentModalComponent);
  });

  it('renders nothing while no component is selected', () => {
    const el = render(null);
    expect(el.querySelector('.cm-backdrop')).toBeNull();
  });

  it('leads with the item identity and the hardpoint it sits on', () => {
    const el = render(PANTHER);
    expect(el.querySelector('.cm-titles h2')?.textContent?.trim()).toBe(
      'CF-337 Panther Repeater',
    );
    expect(el.querySelector('.cm-size')?.textContent?.trim()).toBe('3× S3');
    expect(el.querySelector('.cm-meta-txt')?.textContent?.trim()).toBe('KLA · Gun');
    expect(el.querySelector('.cm-port')?.textContent).toContain('Hardpoint Weapon Top Left');
  });

  it('shows the curated headline stats with their units', () => {
    const el = render(PANTHER);
    const values = Array.from(el.querySelectorAll('.cm-headline dd')).map((d) =>
      d.textContent?.trim(),
    );
    expect(values).toContain('43.65');
    expect(values).toContain('1,480 m/s');
  });

  it('renders the full value table, including the projectile block', () => {
    const el = render(PANTHER);
    const keys = Array.from(el.querySelectorAll('.ct-key')).map((k) => k.textContent?.trim());
    // weaponParams row …
    expect(keys).toContain('Heat Per Shot');
    // … and the ammo payload's own numbers, in their own block.
    expect(el.querySelector('.cm-block.ammo')).toBeTruthy();
    expect(keys).toContain('Speed');
    expect(keys).toContain('Lifetime');
  });

  it('emits closed on the backdrop, the button and Escape', () => {
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => closes++);
    const el = render(PANTHER);
    (el.querySelector('.cm-close') as HTMLButtonElement).click();
    (el.querySelector('.cm-backdrop') as HTMLElement).click();
    fixture.componentInstance.onEscape();
    expect(closes).toBe(3);
  });

  it('says so instead of rendering an empty window when nothing is extracted', () => {
    const el = render({ ...PANTHER, payload: null, ammoPayload: undefined });
    expect(el.querySelector('.cm-empty')).toBeTruthy();
    expect(el.querySelector('.cm-table')).toBeNull();
  });
});
