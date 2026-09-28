import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsThumbComponent } from './news-thumb.component';
import { channelIconSvg } from './channel-icons';

/**
 * Audit D10: the channel pill label is neutral for every channel. A foreign
 * brand (YouTube) is carried by its unaltered logo, never by a red label —
 * red means elevated access or an error (CLAUDE.md).
 */
@Component({
  standalone: true,
  imports: [NewsThumbComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <sc-news-thumb
      style="display: block; width: 320px; height: 180px;"
      channel="youtube"
      channelLabel="YouTube"
      [channelIcon]="icon" />
  `,
})
class PillHost {
  readonly icon = channelIconSvg('youtube');
}

describe('sc-news-thumb — channel pill', () => {
  // A token as the browser resolves it (styles.scss is part of the test build).
  const resolved = (token: string): string => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };

  it('labels YouTube neutrally and shows the original red/white mark', () => {
    TestBed.configureTestingModule({ imports: [PillHost] });
    const fixture = TestBed.createComponent(PillHost);
    fixture.detectChanges();

    const pill = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ch-pill');
    expect(pill).withContext('pill rendered').not.toBeNull();

    const neutral = resolved('--sc-fg-1');
    expect(neutral).not.toBe(resolved('--sc-danger'));
    expect(getComputedStyle(pill!).color).toBe(neutral);
    expect(getComputedStyle(pill!).color).not.toBe(resolved('--sc-danger'));

    expect(pill!.querySelector('svg path[fill="#FF0000"]'))
      .withContext('YouTube brand red preserved')
      .not.toBeNull();
  });

  it('renders the YouTube icon at the 20px brand minimum, untinted', () => {
    TestBed.configureTestingModule({ imports: [PillHost] });
    const fixture = TestBed.createComponent(PillHost);
    fixture.detectChanges();

    const svg = (fixture.nativeElement as HTMLElement).querySelector<SVGSVGElement>('.ch-pill .ch-icon svg');
    expect(svg).withContext('icon rendered').not.toBeNull();
    const box = svg!.getBoundingClientRect();
    expect(box.width).withContext('icon width').toBeGreaterThanOrEqual(20);
    expect(box.height).withContext('icon height').toBeGreaterThanOrEqual(20);

    // No filter or fade on the icon or anything between it and the pill.
    for (let node: Element | null = svg; node && !node.classList.contains('ch-pill'); node = node.parentElement) {
      const style = getComputedStyle(node);
      expect(style.filter).withContext('filter').toBe('none');
      expect(style.opacity).withContext('opacity').toBe('1');
    }
  });
});
