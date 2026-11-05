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
      expect(isMissileRow({ attach_type: 'Missile' })).toBeTrue();
      expect(isMissileRow({ attach_type: 'MissileLauncher' })).toBeFalse();
      expect(isMissileRow(null)).toBeFalse();
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
    it('opens on the same kind, or on everything when the kind is too small', () => {
      expect(defaultMissileScope(COHORT[0], COHORT)).toBe('career');
      expect(defaultMissileScope(COHORT[5], COHORT)).toBe('all');
    });

    it('ranks against the chosen group only', () => {
      const r = rankMissile(COHORT[3], COHORT, 'career')!;
      expect(r.scope).toBe('career');
      expect(r.cohortSize).toBe(5);
      const length = r.axes.find((a) => a.key === 'length')!;
      expect(length.value).toBe(2.4);
      expect(length.percentile).toBe(70);
      expect(length.labelKey).toBe('codex.missile.axis.length');
    });

    it('leaves measurements out once enough combat numbers can be compared', () => {
      const armed = (className: string, n: number) =>
        missile({ className, metrics: { damage: n, speed: n, range: n, length: n, size: n } });
      const field = [armed('p', 1), armed('q', 2), armed('r', 3)];
      expect(rankMissile(field[1], field, 'all')!.axes.map((a) => a.key)).toEqual(['damage', 'speed', 'range']);
    });

    it('draws no axis a value is missing for', () => {
      const bare = missile({ className: 'bare', metrics: { size: 2 } });
      const r = rankMissile(bare, COHORT, 'all')!;
      expect(r.axes.map((a) => a.key)).toEqual(['size']);
    });

    it('drops an axis the group does not differ on: same size has no size axis', () => {
      const r = rankMissile(COHORT[0], COHORT, 'sizeClass')!;
      expect(r.axes.map((a) => a.key)).not.toContain('size');
      expect(r.axes.map((a) => a.key)).toContain('length');
    });

    it('offers a group of one as disabled and falls back to everything', () => {
      const r = rankMissile(COHORT[5], COHORT, 'sizeClass')!;
      expect(r.scopeAvailable.sizeClass).toBeFalse();
      expect(r.scope).toBe('all');
    });

    it('is null when there is nothing to compare', () => {
      const lonely = missile({ className: 'lonely', size: null, metrics: {} });
      expect(rankMissile(lonely, COHORT, 'all')).toBeNull();
    });

    it('marks the value below the group as weak, so the bar paints the warning colour', () => {
      const r = rankMissile(COHORT[0], COHORT, 'career')!;
      expect(r.axes.find((a) => a.key === 'length')!.weak).toBeTrue();
    });

    it('treats a shorter lock time as the better one', () => {
      const quick = missile({ className: 'q', metrics: { lockTime: 1 } });
      const slow = missile({ className: 's', metrics: { lockTime: 5 } });
      const r = rankMissile(quick, [quick, slow], 'all')!;
      expect(r.axes[0].key).toBe('lockTime');
      expect(r.axes[0].percentile).toBe(75);
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
      expect(groups[1].rows[0]).toEqual(jasmine.objectContaining({ key: 'speed', value: 400, unit: 'm/s' }));
      expect(hasCombatMetrics(armed)).toBeTrue();
    });

    it('says combat numbers are missing while they are', () => {
      expect(hasCombatMetrics(COHORT[0])).toBeFalse();
    });
  });
});
