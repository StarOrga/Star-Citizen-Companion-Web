import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { StarscapeVoteButtonComponent } from './starscape-vote-button.component';
import { StarscapeVotesService } from './starscape-votes.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

describe('StarscapeVoteButtonComponent', () => {
  const counts = signal<ReadonlyMap<string, number>>(new Map());
  const mine = signal<ReadonlySet<string>>(new Set());
  const busy = signal<ReadonlySet<string>>(new Set());
  const canVote = signal(true);
  let toggle: jasmine.Spy;

  function setup() {
    counts.set(new Map([['img-1', 3]]));
    mine.set(new Set());
    busy.set(new Set());
    canVote.set(true);
    toggle = jasmine.createSpy('toggle').and.resolveTo(undefined);
    TestBed.configureTestingModule({
      imports: [StarscapeVoteButtonComponent],
      providers: [
        provideTranslateService(),
        { provide: StarscapeVotesService, useValue: { counts, mine, busy, canVote, toggle } },
      ],
    });
    const fixture = TestBed.createComponent(StarscapeVoteButtonComponent);
    fixture.componentRef.setInput('imageId', 'img-1');
    fixture.detectChanges();
    const button = () => fixture.nativeElement.querySelector('button.vote') as HTMLButtonElement;
    return { fixture, button };
  }

  it('a click toggles the vote for this image and does not bubble', () => {
    const { fixture, button } = setup();
    const parentClick = jasmine.createSpy('parent');
    fixture.nativeElement.addEventListener('click', parentClick);
    button().click();
    expect(toggle).toHaveBeenCalledOnceWith('img-1');
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('shows the aggregate count and the pressed state', () => {
    const { fixture, button } = setup();
    expect(button().querySelector('.vote-count')?.textContent?.trim()).toBe('3');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    mine.set(new Set(['img-1']));
    fixture.detectChanges();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.classList).toContain('is-voted');
  });

  it('is disabled while this image has a request in flight', () => {
    const { fixture, button } = setup();
    expect(button().disabled).toBeFalse();
    busy.set(new Set(['img-1']));
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
  });

  it('a request for another image does not disable this button', () => {
    const { fixture, button } = setup();
    busy.set(new Set(['other']));
    fixture.detectChanges();
    expect(button().disabled).toBeFalse();
  });

  it('signed out: disabled, with the signedOut key in the tooltip', () => {
    const { fixture, button } = setup();
    canVote.set(false);
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
    const tip = fixture.debugElement.query(By.directive(ScTooltipDirective)).injector.get(ScTooltipDirective).scTooltip();
    expect(tip).toContain('starscape.vote.signedOut');
    expect(button().getAttribute('aria-label')).toContain('starscape.vote.signedOut');
  });
});
