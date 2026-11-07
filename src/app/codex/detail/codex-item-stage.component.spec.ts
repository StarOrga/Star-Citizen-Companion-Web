import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { AssetPackageRow } from '../asset-package/asset-package.model';
import { CodexService } from '../codex.service';
import type { HoloSilhouette } from '../holo-silhouette';
import { CodexItemStageComponent } from './codex-item-stage.component';

const SIL = { viewBox: '0 0 100 40', path: 'M0 0h100v40H0z', kind: 'item' } as unknown as HoloSilhouette;

function mount(opts: { sil?: HoloSilhouette | null; pkg?: AssetPackageRow | null } = {}) {
  const asked: string[] = [];
  TestBed.configureTestingModule({
    imports: [CodexItemStageComponent],
    providers: [
      provideTranslateService({}),
      {
        provide: CodexService,
        useValue: {
          silhouette: async (kind: string) => {
            asked.push(kind);
            return opts.sil ?? null;
          },
        },
      },
    ],
  });
  const f = TestBed.createComponent(CodexItemStageComponent);
  f.componentRef.setInput('kind', 'item');
  f.componentRef.setInput('className', 'klwe_rifle_energy_01');
  f.componentRef.setInput('displayName', 'Gallant');
  f.componentRef.setInput('package', opts.pkg ?? null);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, asked };
}

const settle = async (f: { detectChanges: () => void }) => {
  await new Promise((r) => setTimeout(r));
  f.detectChanges();
};

describe('CodexItemStageComponent', () => {
  it('draws the traced silhouette, with the switch placed like the Holotable (head row, top right)', async () => {
    const { f, el } = mount({ sil: SIL });
    await settle(f);
    expect(el.querySelector('svg.sil path')!.getAttribute('d')).toBe(SIL.path);
    const head = el.querySelector('.head')!;
    const tools = head.querySelector('.tools')!;
    expect(tools.querySelectorAll('.tt').length).toBe(2);
    expect(tools.querySelector('.tt.on')!.textContent).toContain('itemStage.viewSilhouette');
  });

  it('the 3D switch is disabled with a reason when the build has no 3D model, and stays on the silhouette', async () => {
    const { f, el } = mount({ sil: SIL });
    await settle(f);
    const three = el.querySelectorAll<HTMLButtonElement>('.tools .tt')[1];
    expect(three.getAttribute('aria-disabled')).toBe('true');
    three.click();
    f.detectChanges();
    expect(three.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('svg.sil')).not.toBeNull();
  });

  it('with a 3D package the switch works and the model replaces the silhouette', async () => {
    const { f, el } = mount({ sil: SIL, pkg: { id: 'p' } as unknown as AssetPackageRow });
    await settle(f);
    const three = el.querySelectorAll<HTMLButtonElement>('.tools .tt')[1];
    expect(three.getAttribute('aria-disabled')).toBeNull();
    three.click();
    f.detectChanges();
    expect(three.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('svg.sil')).toBeNull();
    expect(el.querySelector('.surface.mode-3d')).not.toBeNull();
  });

  it('without a silhouette the preview stands in and the head says so', async () => {
    const { f, el } = mount({ sil: null });
    await settle(f);
    expect(el.querySelector('svg.sil')).toBeNull();
    expect(el.querySelector('.art')).not.toBeNull();
    expect(el.querySelector('.nogeo')).not.toBeNull();
  });

  it('asks the item slice first, then the armor slice the uploader emits for FPS gear', async () => {
    const { f, asked } = mount({ sil: null });
    await settle(f);
    expect(asked).toEqual(['item', 'armor']);
  });
});
