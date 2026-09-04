import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwipeActionDirective } from './swipe-action.directive';

/** A card with the two things a real one has: plain text and a button. */
@Component({
  standalone: true,
  imports: [SwipeActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="card"
      scSwipeAction
      [swipeEnabled]="enabled()"
      (swipeLeft)="left = left + 1"
      (swipeRight)="right = right + 1">
      <span class="text">topic</span>
      <button type="button" class="action">Erledigt</button>
    </article>
  `,
  styles: [`.card { width: 300px; height: 120px; touch-action: pan-y; }`],
})
class HostComponent {
  readonly enabled = signal(true);
  left = 0;
  right = 0;
}

/**
 * The gesture is an ADDITION to the buttons (admin feedback 3bc01a3d), so every
 * one of these guards a way it must NOT take over: a mouse drag, a vertical
 * scroll, a press on a control, a half-hearted flick.
 */
describe('SwipeActionDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let card: HTMLElement;

  /** How far a committing drag has to travel (COMMIT_PX = 96) plus headroom. */
  const FAR = 140;

  function pointer(type: string, x: number, y: number, pointerType = 'touch'): PointerEvent {
    return new PointerEvent(type, {
      pointerId: 1,
      pointerType,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
  }

  /** One gesture, delivered move by move so the claim/cancel logic really runs. */
  function drag(dx: number, dy: number, pointerType = 'touch', from: HTMLElement = card): void {
    from.dispatchEvent(pointer('pointerdown', 0, 0, pointerType));
    for (const step of [0.25, 0.5, 0.75, 1]) {
      card.dispatchEvent(pointer('pointermove', dx * step, dy * step, pointerType));
    }
    card.dispatchEvent(pointer('pointerup', dx, dy, pointerType));
  }

  /** The card flies out before the action fires — wait that animation out. */
  const settled = () => new Promise((r) => setTimeout(r, 260));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    card = fixture.nativeElement.querySelector('.card');
  });

  it('fires the right-hand action on a decisive rightward touch drag', async () => {
    drag(FAR, 0);
    await settled();
    expect(fixture.componentInstance.right).toBe(1);
    expect(fixture.componentInstance.left).toBe(0);
  });

  it('fires the left-hand action on a decisive leftward touch drag', async () => {
    drag(-FAR, 0);
    await settled();
    expect(fixture.componentInstance.left).toBe(1);
    expect(fixture.componentInstance.right).toBe(0);
  });

  it('ignores a drag that stops short of the commit threshold', async () => {
    drag(60, 0);
    await settled();
    expect(fixture.componentInstance.left + fixture.componentInstance.right).toBe(0);
  });

  it('leaves the vertical axis to the page — a scroll never becomes a decision', async () => {
    // Down first, then far to the side: the shape of a thumb scrolling a list.
    card.dispatchEvent(pointer('pointerdown', 0, 0));
    card.dispatchEvent(pointer('pointermove', 4, 40));
    card.dispatchEvent(pointer('pointermove', FAR, 60));
    card.dispatchEvent(pointer('pointerup', FAR, 60));
    await settled();
    expect(fixture.componentInstance.left + fixture.componentInstance.right).toBe(0);
  });

  it('does not react to a mouse drag (that is a text selection)', async () => {
    drag(FAR, 0, 'mouse');
    await settled();
    expect(fixture.componentInstance.left + fixture.componentInstance.right).toBe(0);
  });

  it('does not react to a drag that started on a control', async () => {
    const button = fixture.nativeElement.querySelector('.action') as HTMLElement;
    drag(FAR, 0, 'touch', button);
    await settled();
    expect(fixture.componentInstance.left + fixture.componentInstance.right).toBe(0);
  });

  it('is inert while disabled', async () => {
    fixture.componentInstance.enabled.set(false);
    fixture.detectChanges();
    drag(FAR, 0);
    await settled();
    expect(fixture.componentInstance.left + fixture.componentInstance.right).toBe(0);
  });

  it('arms an intent only past the threshold, and disarms when dragged back', () => {
    const directive = fixture.debugElement
      .query((n) => n.name === 'article')
      .injector.get(SwipeActionDirective);
    card.dispatchEvent(pointer('pointerdown', 0, 0));
    card.dispatchEvent(pointer('pointermove', 40, 0));
    expect(directive.intent()).toBeNull();
    card.dispatchEvent(pointer('pointermove', FAR, 0));
    expect(directive.intent()).toBe('right');
    card.dispatchEvent(pointer('pointermove', 20, 0));
    expect(directive.intent()).toBeNull();
    card.dispatchEvent(pointer('pointerup', 20, 0));
  });
});
