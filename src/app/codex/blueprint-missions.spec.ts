import { blueprintMissions } from './blueprint-missions';
import { BlueprintMissionRef, BlueprintMissionSource } from './codex.types';

const ref = (over: Partial<BlueprintMissionRef> = {}): BlueprintMissionRef => ({
  className: 'contract_Patrol_Easy',
  title: { en: 'Routine Patrol', de: 'Routinepatrouille' },
  giver: { en: 'Foxwell', de: 'Foxwell' },
  location: { en: 'Stanton', de: 'Stanton' },
  ...over,
});

describe('blueprintMissions', () => {
  it('is null without data, so the page and the line stay plain', () => {
    expect(blueprintMissions(null, 'de')).toBeNull();
    expect(blueprintMissions(undefined, 'de')).toBeNull();
    expect(blueprintMissions({ total: 0, missions: [] }, 'de')).toBeNull();
    expect(blueprintMissions({ total: 1 } as unknown as BlueprintMissionSource, 'de')).toBeNull();
  });

  it('reads a row in the language, with its route and its meta line', () => {
    const out = blueprintMissions({ total: 1, missions: [ref()] }, 'de')!;
    expect(out.rows).toEqual([{
      className: 'contract_Patrol_Easy',
      title: 'Routinepatrouille',
      meta: 'Foxwell · Stanton',
      link: ['/codex', 'mission', 'contract_Patrol_Easy'],
    }]);
    expect(out.more).toBe(0);
  });

  it('falls back to English where the game has no German text', () => {
    const out = blueprintMissions({ total: 1, missions: [ref({ title: { en: 'Routine Patrol', de: '' } })] }, 'de')!;
    expect(out.rows[0].title).toBe('Routine Patrol');
  });

  it('has an empty meta when the data names neither giver nor location', () => {
    const out = blueprintMissions({ total: 1, missions: [ref({ giver: null, location: null })] }, 'en')!;
    expect(out.rows[0].meta).toBe('');
  });

  it('counts what the payload does not carry', () => {
    expect(blueprintMissions({ total: 5, missions: [ref()] }, 'en')!.more).toBe(4);
  });

  it('leaves out rows without a usable class or title', () => {
    const out = blueprintMissions({ total: 3, missions: [
      ref({ className: '../evil' }),
      ref({ className: 'contract_NoTitle', title: { en: '', de: '' } }),
      ref(),
    ] }, 'en')!;
    expect(out.rows.map((r) => r.className)).toEqual(['contract_Patrol_Easy']);
  });
});
