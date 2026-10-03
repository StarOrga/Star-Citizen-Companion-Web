import { ChangeDetectionStrategy, Component, ElementRef, type WritableSignal, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { ShipSkinsService } from '../ship-skins.service';
import { parseGlbNodePositions } from '../glb-hardpoints';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { modelViewerScene } from '../ship-skin-viewer.component';
import type { Vec3 } from '../glb-hardpoints';
import * as THREE from 'three';

/**
 * DEV-ONLY harness (registered only under isDevMode(), never in a production
 * build): the holo stage's 3D viewer for one ship without the login wall, so
 * the concept-hologram variants can be screenshotted headless.
 *
 *   /dev/holo?ship=AEGS_Gladius_Dunlevy&holo=b&focus=weapon
 *
 * `focus` selects every locator whose name contains the text — the same
 * activePorts input the holo stage drives on hover. Legacy hulls carry no
 * locators, so `demo=x,y,z` (fractions of the hull box, -0.5..0.5) plants one
 * synthetic locator and focuses it — only to show the highlight.
 */
@Component({
  selector: 'sc-holo-harness',
  standalone: true,
  imports: [ShipSkinViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <sc-ship-skin-viewer
        [shipId]="ship"
        [embedded]="true"
        [holo]="true"
        [still]="still"
        [hardpointPorts]="ports()"
        [activePorts]="active()"
        #viewer
      />
    </div>
  `,
  styles: `
    :host { display: block; background: var(--sc-bg, #05080d); min-height: 100dvh; }
    .stage { width: 100%; height: 100dvh; }
    .stage sc-ship-skin-viewer { display: block; height: 100%; }
  `,
})
export class HoloHarnessComponent {
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;
  private readonly skins = inject(ShipSkinsService);
  readonly ship = this.params.get('ship') ?? 'AEGS_Gladius_Dunlevy';
  readonly still = this.params.get('still') === '1';
  private readonly focus = (this.params.get('focus') ?? '').toLowerCase();
  private readonly nodes = signal<string[]>([]);
  private readonly demo = this.params.get('demo');
  private readonly viewer = viewChild('viewer', { read: ElementRef });
  private readonly viewerCmp = viewChild(ShipSkinViewerComponent);

  readonly ports = computed<HardpointPortRef[]>(() =>
    this.nodes()
      .filter((n) => /hardpoint/i.test(n))
      .map((n) => ({ port: n, label: n, itemName: null })),
  );
  readonly active = computed(() =>
    this.demo ? this.ports().map((p) => p.port) : this.focus ? this.ports().filter((p) => p.port.toLowerCase().includes(this.focus)).map((p) => p.port) : [],
  );

  /** Plant the demo locator once model-viewer's scene is dressed. */
  private plantDemo(tries = 0): void {
    const el = (this.viewer()?.nativeElement as HTMLElement | undefined)?.querySelector('model-viewer.materialised');
    const scene = modelViewerScene(el);
    const cmp = this.viewerCmp() as unknown as { nodePositions: WritableSignal<Map<string, Vec3>> } | undefined;
    if (!scene || !cmp || !this.demo) {
      if (tries < 120) setTimeout(() => this.plantDemo(tries + 1), 500);
      return;
    }
    const f = this.demo.split(',').map(Number);
    const box = new THREE.Box3().setFromObject(scene.target);
    const size = box.getSize(new THREE.Vector3());
    const p = box.getCenter(new THREE.Vector3()).add(new THREE.Vector3(f[0] * size.x, f[1] * size.y, f[2] * size.z));
    scene.target.worldToLocal(p);
    this.nodes.set(['hardpoint_demo']);
    setTimeout(() => cmp.nodePositions.set(new Map([['hardpoint_demo', [p.x, p.y, p.z] as Vec3]])), 300);
  }

  constructor() {
    void this.readNodes();
    if (this.demo) setTimeout(() => this.plantDemo(), 500);
  }

  private async readNodes(): Promise<void> {
    const { skins } = await this.skins.listSkins(this.ship);
    const url = this.skins.assetUrl(skins.find((s) => s.modelPath)?.modelPath);
    if (!url) return;
    const res = await fetch(url, { headers: { Range: 'bytes=0-1048575' } });
    if (!res.ok || this.demo) return;
    this.nodes.set([...parseGlbNodePositions(await res.arrayBuffer()).keys()]);
  }
}
