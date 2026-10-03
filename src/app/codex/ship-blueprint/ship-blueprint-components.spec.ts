import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ShipBlueprintIconComponent } from './ship-blueprint-icon.component';
import { ShipTileArtComponent } from './ship-tile-art.component';
import { ShipBlueprintSchemaComponent } from './ship-blueprint-schema.component';
import { ShipBlueprintService } from './ship-blueprint.service';
import { blueprintFixture, fakeShipBlueprints } from './ship-blueprint.testing';
import { blueprintView, placeSchemaMarkers, type SchemaHardpoint } from './ship-blueprint.model';

const flush = async (fixture: ComponentFixture<unknown>) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

@Component({
  standalone: true,
  imports: [ShipBlueprintIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sc-ship-blueprint-icon [shipId]="ship()"><span class="kind-icon">K</span></sc-ship-blueprint-icon>`,
})
class IconHost {
  readonly ship = signal('AEGS_Gladius');
}

@Component({
  standalone: true,
  imports: [ShipTileArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="thumb">
      <sc-ship-tile-art [shipId]="ship()" [candidates]="[url()]" alt="Gladius"><span class="kind-icon">K</span></sc-ship-tile-art>
    </div>
  `,
})
class TileHost {
  readonly ship = signal('AEGS_Gladius');
  readonly url = signal('https://media.test/gladius.jpg');
}

describe('ship blueprint components', () => {
  let blueprints: ReturnType<typeof fakeShipBlueprints>;

  beforeEach(async () => {
    blueprints = fakeShipBlueprints();
    await TestBed.configureTestingModule({
      imports: [IconHost, TileHost, ShipBlueprintSchemaComponent],
      providers: [provideTranslateService({}), { provide: ShipBlueprintService, useValue: blueprints }],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('search-row icon', () => {
    it('keeps the kind icon for a ship without a drawing — no empty slot, no request', async () => {
      const fixture = TestBed.createComponent(IconHost);
      await flush(fixture);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.kind-icon')).not.toBeNull();
      expect(el.querySelector('sc-ship-blueprint-art')).toBeNull();
      expect(blueprints.drawing).not.toHaveBeenCalled();
    });

    it('swaps in the icon drawing once the ship has one', async () => {
      blueprints.set('AEGS_Gladius');
      const fixture = TestBed.createComponent(IconHost);
      await flush(fixture);
      const el = fixture.nativeElement as HTMLElement;
      expect(blueprints.drawing).toHaveBeenCalledWith('AEGS_Gladius', 'icon');
      expect(el.querySelector('.kind-icon')).toBeNull();
      const art = el.querySelector('sc-ship-blueprint-art')!;
      expect(art.classList).toContain('d-icon');
      expect(art.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      expect(art.querySelector('path.hull')!.getAttribute('d')).toBe('M10 10l100 0 0 40 -100 0z');
      // The icon LOD never draws detail lines.
      expect(art.querySelector('path.minor')).toBeNull();
    });

    it('matches the ship id case-insensitively and follows a change of ship', async () => {
      blueprints.set('aegs_gladius');
      const fixture = TestBed.createComponent(IconHost);
      await flush(fixture);
      expect((fixture.nativeElement as HTMLElement).querySelector('sc-ship-blueprint-art')).not.toBeNull();
      fixture.componentInstance.ship.set('ANVL_Hornet');
      await flush(fixture);
      expect((fixture.nativeElement as HTMLElement).querySelector('.kind-icon')).not.toBeNull();
    });
  });

  describe('tile placeholder', () => {
    function parts(fixture: ComponentFixture<TileHost>) {
      const el = fixture.nativeElement as HTMLElement;
      return {
        stack: el.querySelector('.stack') as HTMLElement,
        img: el.querySelector('img') as HTMLImageElement | null,
        art: el.querySelector('sc-ship-blueprint-art'),
        icon: el.querySelector('.kind-icon'),
      };
    }

    it('without a drawing behaves as before: the image shows at once, no fade', async () => {
      const fixture = TestBed.createComponent(TileHost);
      await flush(fixture);
      const { stack, img, art } = parts(fixture);
      expect(art).toBeNull();
      expect(img).not.toBeNull();
      expect(stack.classList).not.toContain('has-bp');
      expect(getComputedStyle(img!).opacity).toBe('1');
    });

    it('without a drawing and without a working image, the kind icon remains', async () => {
      const fixture = TestBed.createComponent(TileHost);
      await flush(fixture);
      parts(fixture).img!.dispatchEvent(new Event('error'));
      await flush(fixture);
      expect(parts(fixture).icon).not.toBeNull();
    });

    it('shows the drawing until the image has loaded, then cross-fades', async () => {
      blueprints.set('AEGS_Gladius');
      const fixture = TestBed.createComponent(TileHost);
      await flush(fixture);
      let p = parts(fixture);
      expect(p.art).not.toBeNull();
      expect(p.art!.classList).toContain('d-tile');
      expect(p.stack.classList).toContain('has-bp');
      expect(p.stack.classList).not.toContain('shown');
      expect(getComputedStyle(p.img!).opacity).toBe('0');

      p.img!.dispatchEvent(new Event('load'));
      await flush(fixture);
      p = parts(fixture);
      expect(p.stack.classList).toContain('shown');
      // The fade is a transition: the target opacities are what the classes set.
      expect(getComputedStyle(p.img!).getPropertyValue('--sc-img-opacity').trim()).toBe('');
    });

    it('keeps the drawing when the image fails, and never shows the kind icon over it', async () => {
      blueprints.set('AEGS_Gladius');
      const fixture = TestBed.createComponent(TileHost);
      await flush(fixture);
      parts(fixture).img!.dispatchEvent(new Event('error'));
      await flush(fixture);
      const p = parts(fixture);
      expect(p.img).toBeNull();
      expect(p.art).not.toBeNull();
      expect(p.icon).toBeNull();
    });

    it('a re-render with an equal candidate list keeps the loaded state; a new image resets it', async () => {
      blueprints.set('AEGS_Gladius');
      const fixture = TestBed.createComponent(TileHost);
      await flush(fixture);
      parts(fixture).img!.dispatchEvent(new Event('load'));
      await flush(fixture);
      // The host hands in a fresh array on every render ([url()]).
      fixture.componentInstance.ship.set('AEGS_Gladius');
      await flush(fixture);
      expect(parts(fixture).stack.classList).toContain('shown');
      fixture.componentInstance.url.set('https://media.test/other.jpg');
      await flush(fixture);
      expect(parts(fixture).stack.classList).not.toContain('shown');
    });
  });

  describe('schema view', () => {
    const hardpoints: SchemaHardpoint[] = [
      { port: 'hardpoint_nose', position: [0, 0, -4], group: 'weapons', size: 3, itemClass: 'GUN', type: 'WeaponGun' },
      { port: 'hardpoint_rack', position: [-1, 0, 1], group: 'missiles', size: 2, itemClass: null, type: 'MissileLauncher' },
      { port: 'hardpoint_shield', position: [0, 0, 3], group: 'components', size: 1, itemClass: 'SHLD', type: 'Shield' },
    ];

    async function setup() {
      const bp = blueprintFixture('full');
      const markers = placeSchemaMarkers(blueprintView(bp, 'top')!, hardpoints, [
        { portName: 'hardpoint_nose', label: 'Nose gun', index: 1 },
      ]);
      const fixture = TestBed.createComponent(ShipBlueprintSchemaComponent);
      fixture.componentRef.setInput('blueprint', bp);
      fixture.componentRef.setInput('markers', markers);
      fixture.componentRef.setInput('inspectedPort', 'hardpoint_shield');
      await flush(fixture);
      const hovered: (string[] | null)[] = [];
      const inspected: string[] = [];
      fixture.componentInstance.hovered.subscribe((v) => hovered.push(v));
      fixture.componentInstance.inspect.subscribe((v) => inspected.push(v));
      return { fixture, el: fixture.nativeElement as HTMLElement, hovered, inspected };
    }

    it('draws the top view with one marker per hardpoint, and the side elevation', async () => {
      const { el } = await setup();
      const plan = el.querySelector('svg.plan')!;
      expect(plan.getAttribute('role')).toBe('img');
      expect(plan.querySelectorAll('g.mk').length).toBe(3);
      expect(plan.querySelector('g.mk.g-weapons')!.getAttribute('transform')).toBe('translate(100 30)');
      expect(el.querySelector('svg.elevation path.hull')).not.toBeNull();
      expect(el.querySelector('.dim')!.textContent).toContain('codex.shipBlueprint.schema.extent');
    });

    it('lists every hardpoint as a keyboard-reachable button with its group, size and type', async () => {
      const { el } = await setup();
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.hp-list button'));
      expect(buttons.length).toBe(3);
      expect(buttons[0]!.textContent).toContain('Nose gun');
      expect(buttons[0]!.textContent).toContain('codex.shipBlueprint.group.weapons');
      expect(buttons[0]!.textContent).toContain('Weapon Gun');
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    });

    it('focus on a list entry lights its marker; Enter/click opens it', async () => {
      const { el, hovered, inspected } = await setup();
      const first = el.querySelector<HTMLButtonElement>('.hp-list button')!;
      first.dispatchEvent(new FocusEvent('focus'));
      first.click();
      first.dispatchEvent(new FocusEvent('blur'));
      expect(hovered).toEqual([['hardpoint_nose'], null]);
      expect(inspected).toEqual(['hardpoint_nose']);
    });

    it('a click on a marker opens the same component info', async () => {
      const { el, inspected, hovered } = await setup();
      const rack = el.querySelector('g.mk.g-missiles')!;
      rack.dispatchEvent(new MouseEvent('mouseenter'));
      rack.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(hovered).toEqual([['hardpoint_rack']]);
      expect(inspected).toEqual(['hardpoint_rack']);
    });

    it('highlights the markers of the active ports', async () => {
      const { fixture, el } = await setup();
      fixture.componentRef.setInput('activePorts', ['hardpoint_rack']);
      await flush(fixture);
      expect(el.querySelector('g.mk.on')!.classList).toContain('g-missiles');
    });

    it('says so when the hull has no hardpoint positions, instead of an empty list', async () => {
      const { fixture, el } = await setup();
      fixture.componentRef.setInput('markers', []);
      await flush(fixture);
      expect(el.querySelector('.hp-list')).toBeNull();
      expect(el.querySelector('.hint')!.textContent).toContain('codex.shipBlueprint.schema.noPositions');
    });
  });
});
