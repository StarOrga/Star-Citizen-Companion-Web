// Compare the EM/IR model (src/app/codex/codex-em-model.ts) with the
// StarCitizenWiki API's ship values (#967 M2). Reads a local extract:
//   node scripts/em-model-compare.mts <extract-dir>
// The wiki's per-component EM already carries the hull armor factor (Gladius:
// radar 2,034 = 1,800 x 1.13), so the armor factor is applied here too.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { emModel, minimumSegments, type EmModelItem, type EmModelRole } from '../src/app/codex/codex-em-model.ts';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/em-model-compare.mts <extract-dir>');
  process.exitCode = 2;
} else {
  // wiki: [version, IR shields, IR quantum, EM shields, EM quantum]
  const REF: Record<string, [string, number, number, number, number]> = {
    AEGS_Gladius: ['4.10.2', 8711, 7263, 22078, 40520],
    AEGS_Avenger_Titan: ['4.9.0', 8714, 6835, 24227, 37449],
    ANVL_Carrack: ['4.10.2', 12828, 10732, 48822, 88462],
    DRAK_Cutlass_Black: ['4.9.0', 6503, 6503, 18127, 39497],
  };
  const load = (cls: string): any => {
    for (const d of ['components', 'items', 'weapons']) {
      const p = join(root, d, `${cls}.json`);
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
    }
    return null;
  };
  const roleOf = (cls: string, gen: number): EmModelRole =>
    gen > 0 ? 'powerPlant'
      : /^SHLD_/i.test(cls) ? 'shield'
        : /^QDRV_/i.test(cls) ? 'quantum'
          : /^COOL_/i.test(cls) ? 'cooler'
            : /_Thruster_/i.test(cls) ? 'thruster'
            : 'consumer';
  for (const [ship, ref] of Object.entries(REF)) {
    const j = JSON.parse(readFileSync(join(root, 'ships', `${ship}.json`), 'utf8'));
    const items: (EmModelItem & { cls: string })[] = [];
    let armor = { em: 1, ir: 1 };
    const walk = (entries: any[]): void => {
      for (const e of entries ?? []) {
        if (/^ARMR_/i.test(e.entityClassName ?? '')) {
          const a = load(e.entityClassName)?.stats ?? {};
          const v = Object.values(a).find((x: any) => x && typeof x === 'object' && 'signalElectromagnetic' in x) as any;
          if (v) armor = { em: Number(v.signalElectromagnetic) || 1, ir: Number(v.signalInfrared) || 1 };
        }
        if (e.entityClassName) {
          const rc = load(e.entityClassName)?.stats?.ItemResourceComponentParams;
          if (rc) {
            const st = (String(rc.stateNames ?? 'Online').split('|')[0] || 'Online').trim().toLowerCase();
            const n = (f: string): number => Number(rc[`${st}.${f}`] ?? 0) || 0;
            const gen = n('power.generateSegments');
            const seg = n('power.consumeSegments') + n('power.consumeUnits') / (4 / 3);
            if (gen || seg || n('em.nominal') || n('ir.nominal')) {
              items.push({ cls: e.entityClassName, role: roleOf(e.entityClassName, gen), segments: seg,
                minFraction: n('power.minFraction'), generateSegments: gen, em: n('em.nominal'), ir: n('ir.nominal') });
            }
          }
        }
        walk(e.entries);
      }
    };
    walk(j.defaultLoadout);
    const idle = emModel(items, 'idle', armor);
    const max = emModel(items, 'max', armor);
    const qt = emModel(items, 'quantum', armor);
    const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(1)} %`;
    console.log(`\n${ship} (wiki ${ref[0]}, extract LIVE 4.10.2)`);
    for (const i of items) {
      console.log(`  ${i.role.padEnd(10)} ${i.cls.padEnd(42)} S=${i.segments.toFixed(2)} min=${minimumSegments(i.segments, i.minFraction)} gen=${i.generateSegments} em=${i.em} ir=${i.ir}`);
    }
    console.log(`  idle    EM ${idle.em}  IR ${idle.ir}  load ${idle.load}/${idle.capacity}`);
    console.log(`  max     EM ${max.em} vs ${ref[3]} (${pct(max.em, ref[3])})  IR ${max.ir} vs ${ref[1]} (${pct(max.ir, ref[1])})  load ${max.load}/${max.capacity}`);
    console.log(`  quantum EM ${qt.em} vs ${ref[4]} (${pct(qt.em, ref[4])})  IR ${qt.ir} vs ${ref[2]} (${pct(qt.ir, ref[2])})  load ${qt.load}/${qt.capacity}`);
  }
}
