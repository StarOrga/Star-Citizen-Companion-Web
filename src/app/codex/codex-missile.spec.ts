import {
  MissileRecord,
  defaultMissileScope,
  hasCombatMetrics,
  isMissileRow,
  missileCategoryOf,
  missileKeywords,
  missileMeasures,
  missileRecordOf,
  missileStatGroups,
  rankMissile,
  readCombatMetrics,
  trackingSignalOf,
} from './codex-missile';

function missile(partial: Partial<MissileRecord> & { className: string }): MissileRecord {
  return { name: partial.className, size: 2, category: 'missile', signal: 'ir', metrics: {}, ...partial };
}

/** Four S2 and one S3 missile with real-shaped lengths. */
const COHORT: MissileRecord[] = [
  missile({ className: 'a', metrics: { size: 2, length: 1.8, width: 0.2 } }),
  missile({ className: 'b', metrics: { size: 2, length: 2.0, width: 0.21 } }),
  missile({ className: 'c', signal: 'em', metrics: { size: 2, length: 2.1, width: 0.22 } }),
  missile({ className: 'd', signal: 'cs', metrics: { size: 2, length: 2.4, width: 0.3 } }),
  missile({ className: 'big', size: 3, metrics: { size: 3, length: 3, width: 0.4 } }),
  missile({ className: 'torp', size: 9, category: 'torpedo', metrics: { size: 9, length: 8.8, width: 0.9 } }),
];

describe('codex-missile', () => {
  describe('record reading', () => {
    it('recognises a missile by its attach type only', () => {
      expect(isMissileRow({ attach_type: 'Missile' })).toBe(true);
      expect(isMissileRow({ attach_type: 'MissileLauncher' })).toBe(false);
      expect(isMissileRow(null)).toBe(false);
    });

    it('reads the tracking signal from the class name, or says it does not know', () => {
      expect(trackingSignalOf('MISL_S02_IR_NOVP_Rattler')).toBe('ir');
      expect(trackingSignalOf('GMISL_S01_EM_BEHR_Pioneer')).toBe('em');
      expect(trackingSignalOf('MISL_S09_CS_TALN_Argos_2')).toBe('cs');
      expect(trackingSignalOf('NOVP_Rocket_Venom_S1_Strike_TL_IR')).toBe('ir');
      expect(trackingSignalOf('Colonialism_Outpost_RN_AA_Missile')).toBeNull();
      expect(trackingSignalOf(null)).toBeNull();
    });

    it('maps the extract sub types and nothing else', () => {
      expect(missileCategoryOf('GroundVehicleMissile')).toBe('ground');
      expect(missileCategoryOf('Torpedo')).toBe('torpedo');
      expect(missileCategoryOf(null)).toBeNull();
    });

    it('takes measurements from the silhouette box, never without its scale', () => {
      const m = missileMeasures({ bbox: { w: 106.45, h: 1000 }, scaleMPerUnit: 0.002019 });
      expect(m).toEqual({ length: 2.02, width: 0.21 });
      expect(missileMeasures({ bbox: { w: 100, h: 100 }, scaleMPerUnit: null })).toEqual({});
      expect(missileMeasures(null)).toEqual({});
    });

    it('builds a record with only what the row carries', () => {
      const r = missileRecordOf(
        { class_name: 'MISL_S02_IR_NOVP_Rattler', name_localized: 'Rattler II Missile', sub_type: 'Missile', size: 2 },
        { name: {} },
        null,
      );
      expect(r.signal).toBe('ir');
      expect(r.metrics).toEqual({ size: 2 });
    });

    it('reads combat numbers only where the payload has them', () => {
      expect(readCombatMetrics({ name: {} })).toEqual({});
      expect(
        readCombatMetrics({
          stats: {
            SCItemMissileParams: {
              'GCSParams.linearSpeed': 450,
              'GCSParams.interceptPhase.angularSpeed': 300,
              'targetingParams.lockTime': 0,
              'explosionParams.maxRadius': 6,
              'explosionParams.damage.DamagePhysical': 100,
              'explosionParams.damage.DamageEnergy': 50,
              'explosionParams.damage.DamageStun': 'n/a',
            },
          },
        }),
      ).toEqual({ speed: 450, agility: 300, blastRadius: 6, damage: 150 });
    });
  });

  describe('comparison', () => {
    const armed = (className: string, n: number, extra: Partial<MissileRecord> = {}) =>
      missile({ className, metrics: { damage: n, speed: n * 2, agility: n * 3, range: n * 4, length: n, size: n }, ...extra });
    const field = [armed('p', 1), armed('q', 2), armed('r', 3), armed('s', 4)];

    it('opens on the same kind, or on everything when the kind is too small', () => {
      expect(defaultMissileScope(COHORT[0], COHORT)).toBe('career');
      expect(defaultMissileScope(COHORT[5], COHORT)).toBe('all');
    });

    it('ranks damage, speed, agility and range against the chosen group only', () => {
      const r = rankMissile(field[2], field, 'career')!;
      expect(r.scope).toBe('career');
      expect(r.cohortSize).toBe(4);
      expect(r.axes.map((a) => a.key)).toEqual(['damage', 'speed', 'agility', 'range']);
      const range = r.axes.find((a) => a.key === 'range')!;
      expect(range.value).toBe(12);
      expect(range.labelKey).toBe('codex.missile.axis.range');
    });

    it('never draws measurements or lock time as an axis', () => {
      const keys = rankMissile(field[1], field, 'all')!.axes.map((a) => a.key);
      expect(keys).not.toContain('length');
      expect(keys).not.toContain('size');
    });

    it('draws no axis a value is missing for', () => {
      const noRange = missile({ className: 'n', metrics: { damage: 2, speed: 4, agility: 6 } });
      const r = rankMissile(noRange, [...field, noRange], 'all')!;
      expect(r.axes.map((a) => a.key)).toEqual(['damage', 'speed', 'agility']);
    });

    it('is null while fewer than three values can be compared (data not uploaded yet)', () => {
      expect(rankMissile(COHORT[0], COHORT, 'all')).toBeNull();
      const two = missile({ className: 't', metrics: { damage: 2, speed: 4 } });
      expect(rankMissile(two, [...field, two], 'all')).toBeNull();
    });

    it('offers a group of one as disabled and falls back to everything', () => {
      const torp = armed('torp', 9, { size: 9, category: 'torpedo' });
      const r = rankMissile(torp, [...field, torp], 'sizeClass')!;
      expect(r.scopeAvailable.sizeClass).toBe(false);
      expect(r.scope).toBe('all');
    });

    it('keeps a same-size group that differs on too few values, without a verdict (#331)', () => {
      // S2 missiles share speed, agility and range; only the warhead differs.
      const s2 = (className: string, damage: number) =>
        missile({ className, size: 2, metrics: { damage, speed: 900, agility: 60, range: 4000, size: 2 } });
      const mixed = [s2('m1', 100), s2('m2', 200), s2('m3', 300), armed('big5', 5, { size: 5 })];
      const r = rankMissile(mixed[1], mixed, 'sizeClass')!;
      expect(r).not.toBeNull();
      expect(r.scope).toBe('sizeClass');
      expect(r.thinKey).toBe('codex.missile.rank.gapThinGroup');
      expect(r.overall).toBeNull();
      expect(r.axes.map((a) => a.key)).toEqual(['damage']);
      expect(rankMissile(mixed[1], mixed, 'all')!.thinKey).toBeUndefined();
    });

    it('marks the value below the group as weak, so the bar paints the warning colour', () => {
      const r = rankMissile(field[0], field, 'career')!;
      expect(r.axes.find((a) => a.key === 'damage')!.weak).toBe(true);
    });
  });

  describe('keywords', () => {
    const ids = (m: MissileRecord, cohort = COHORT) => missileKeywords(m, cohort).map((k) => k.id);

    it('derives signal, kind and weight from the record', () => {
      expect(ids(missile({ className: 'x', size: 1, signal: 'cs' }))).toEqual(['cs', 'missile', 'light']);
      expect(ids(missile({ className: 'x', size: 5, signal: 'em', category: 'torpedo' }))).toEqual(['em', 'torpedo', 'medium']);
      expect(ids(missile({ className: 'x', size: 12, signal: 'ir', category: 'torpedo' }))).toEqual(['ir', 'torpedo', 'heavy']);
    });

    it('invents nothing for a record without attributes', () => {
      expect(ids(missile({ className: 'x', size: null, signal: null, category: null }))).toEqual([]);
    });

    it('calls a missile compact or long only against its own size', () => {
      expect(ids(COHORT[0])).toContain('compact');
      expect(ids(COHORT[3])).toContain('long');
      expect(ids(COHORT[1])).not.toContain('compact');
      expect(ids(COHORT[1])).not.toContain('long');
    });

    it('gives no peer word without a field to measure against', () => {
      expect(ids(COHORT[5])).toEqual(['ir', 'torpedo', 'heavy']);
    });

    it('earns a combat word from the top quarter of the real number', () => {
      const field = [1, 2, 3, 10].map((speed) =>
        missile({ className: `s${speed}`, metrics: { speed, lockTime: 11 - speed } }),
      );
      expect(ids(field[3], field)).toContain('fast');
      expect(ids(field[3], field)).toContain('quickLock');
      expect(ids(field[0], field)).not.toContain('fast');
    });

    it('has a translation key pair for every keyword', () => {
      const k = missileKeywords(COHORT[0], COHORT)[0];
      expect(k.labelKey).toBe('codex.missile.keyword.ir');
      expect(k.tipKey).toBe('codex.missile.keywordTip.ir');
    });
  });

  describe('data card', () => {
    it('lists only present values and leaves empty groups out', () => {
      const groups = missileStatGroups(COHORT[0]);
      expect(groups.map((g) => g.id)).toEqual(['guidance', 'build']);
      expect(groups[1].rows.map((r) => r.key)).toEqual(['category', 'size', 'length', 'width']);
      expect(groups[0].rows[0].valueKey).toBe('codex.missile.signal.ir');
    });

    it('fills the flight and warhead groups once the numbers exist', () => {
      const armed = missile({ className: 'x', metrics: { damage: 100, speed: 400, lockTime: 2 } });
      const groups = missileStatGroups(armed);
      expect(groups.map((g) => g.id)).toEqual(['warhead', 'flight', 'guidance', 'build']);
      expect(groups[1].rows[0]).toEqual(expect.objectContaining({ key: 'speed', value: 400, unit: 'm/s' }));
      expect(hasCombatMetrics(armed)).toBe(true);
    });

    it('says combat numbers are missing while they are', () => {
      expect(hasCombatMetrics(COHORT[0])).toBe(false);
    });
  });
});
