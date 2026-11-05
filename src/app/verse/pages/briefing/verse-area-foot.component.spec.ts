import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BetaService } from '../../../core/beta.service';
import { VerseAreaFootComponent } from './verse-area-foot.component';

describe('VerseAreaFootComponent', () => {
  function render(codex: boolean): HTMLElement {
    TestBed.configureTestingModule({
      imports: [VerseAreaFootComponent, TranslateModule.forRoot()],
      providers: [provideRouter([]), { provide: BetaService, useValue: { state: () => ({ codex, verse: true }) } }],
    });
    const f = TestBed.createComponent(VerseAreaFootComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders Verse, Codex and HQ as real anchors in order, Verse current', () => {
    const links = Array.from(render(true).querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq']);
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].hasAttribute('aria-current')).toBeFalse();
  });

  it('hides HQ while the codex beta is off', () => {
    expect(Array.from(render(false).querySelectorAll('a')).length).toBe(2);
  });
});
