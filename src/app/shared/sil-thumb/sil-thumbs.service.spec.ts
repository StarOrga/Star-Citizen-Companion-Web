import { TestBed } from '@angular/core/testing';
import { CodexService } from '../../codex/codex.service';
import type { HoloSilhouette } from '../../codex/holo-silhouette';
import { SilThumbsService, rotateShipBox, silhouetteKindsOf } from './sil-thumbs.service';

describe('silhouette thumbs', () => {
  it('lays a nose-up ship on its side: the box turns about its centre', () => {
    expect(rotateShipBox('0 0 40 100')).toEqual({ viewBox: '-30 30 100 40', transform: 'rotate(90 20 50)' });
    expect(rotateShipBox('nonsense')).toBeNull();
    expect(rotateShipBox('0 0 0 10')).toBeNull();
  });

  it('knows which silhouette slice a kind reads', () => {
    expect(silhouetteKindsOf('ship')).toEqual(['ship']);
    expect(silhouetteKindsOf('item')).toEqual(['item', 'armor']);
    expect(silhouetteKindsOf('material')).toEqual([]);
    expect(silhouetteKindsOf('blueprint')).toEqual([]);
  });

  it('asks once per entry, answers into a signal, and a miss keeps the kind icon (null)', async () => {
    const calls: [string, string[]][] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CodexService,
          useValue: {
            silhouettes: async (kind: string, classNames: string[]) => {
              calls.push([kind, classNames]);
              return new Map(kind === 'weapon' ? [['W1', { viewBox: '0 0 10 10', path: 'M0 0' } as unknown as HoloSilhouette]] : []);
            },
          },
        },
      ],
    });
    const svc = TestBed.inject(SilThumbsService);
    svc.request([{ kind: 'weapon', className: 'W1' }, { kind: 'material', className: 'alu' }]);
    svc.request([{ kind: 'weapon', className: 'W1' }]);
    await new Promise((r) => setTimeout(r));
    expect(calls).toEqual([['weapon', ['W1']]]);
    expect(svc.thumbOf('weapon', 'W1')?.path).toBe('M0 0');
    expect(svc.thumbOf('material', 'alu')).toBeNull();
  });
});
