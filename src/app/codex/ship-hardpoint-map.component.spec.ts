import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HardpointFrame, HardpointMarker, buildHardpointMarkers } from './hardpoint-map';
import { ShipHardpointMapComponent } from './ship-hardpoint-map.component';

// Renders the real SVG, because the whole point of this component is that a
// marker actually appears at a position — a pure-function test cannot catch a
// template that renders an empty hull box.

const FRAME: HardpointFrame = { min: [-4, -8, -1.5], max: [4, 8, 2.5], source: 'bbox' };

const MARKERS: HardpointMarker[] = buildHardpointMarkers(
  [
    { port: 'hardpoint_weapon_left', label: 'Weapon Left', itemName: 'Panther Repeater', position: [-3.5, 2, 0.5] },
    { port: 'hardpoint_weapon_right', label: 'Weapon Right', itemName: null, position: [3.5, 2, 0.5] },
  ],
  FRAME,
);

describe('ShipHardpointMapComponent', () => {
  let fixture: ComponentFixture<ShipHardpointMapComponent>;

  function render(
    markers: HardpointMarker[],
    frame: HardpointFrame = FRAME,
    active: string[] = [],
  ): HTMLElement {
    fixture.componentRef.setInput('markers', markers);
    fixture.componentRef.setInput('frame', frame);
    fixture.componentRef.setInput('activePorts', active);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShipHardpointMapComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(ShipHardpointMapComponent);
  });

  it('draws one marker per hardpoint in both views', () => {
    const el = render(MARKERS);
    expect(el.querySelectorAll('svg').length).toBe(2);
    expect(el.querySelectorAll('.mk').length).toBe(4); // 2 hardpoints × 2 views
  });

  it('renders nothing at all when a ship carries no positions', () => {
    const el = render([]);
    expect(el.querySelector('.hp-map')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('highlights only the active hardpoint and names it in the readout', () => {
    const el = render(MARKERS, FRAME, ['hardpoint_weapon_left']);
    expect(el.querySelectorAll('.mk.on').length).toBe(2); // one per view
    expect(el.querySelector('.readout')?.textContent).toContain('Weapon Left');
    expect(el.querySelector('.readout')?.textContent).toContain('Panther Repeater');
  });

  it('keeps the readout idle-styled while nothing is hovered', () => {
    const el = render(MARKERS);
    expect(el.querySelector('.readout')?.classList).toContain('empty');
    expect(el.querySelectorAll('.mk.on').length).toBe(0);
  });

  it('emits the port on hover and null on leave', () => {
    const seen: (string[] | null)[] = [];
    fixture.componentInstance.hovered.subscribe((v) => seen.push(v));
    const el = render(MARKERS);
    const marker = el.querySelector('.mk') as SVGElement;
    marker.dispatchEvent(new MouseEvent('mouseenter'));
    marker.dispatchEvent(new MouseEvent('mouseleave'));
    expect(seen).toEqual([['hardpoint_weapon_left'], null]);
  });

  it('says the extent is approximated when the frame came from the points', () => {
    const el = render(MARKERS, { ...FRAME, source: 'ports' });
    expect(el.querySelector('.hint')?.textContent).toContain('codex.hardpointMap.approximate');
  });

  it('scales the panels to the hull proportions', () => {
    const el = render(MARKERS);
    // 16 m long / 8 m wide -> a top view twice as tall as it is wide.
    expect(el.querySelectorAll('svg')[0].getAttribute('viewBox')).toBe('0 0 100 200');
  });
});
