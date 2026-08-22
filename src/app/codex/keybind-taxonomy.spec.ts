import {
  EMPTY_ASSIGNMENT,
  KEYBIND_ACTION_GROUPS,
  KEYBIND_ACTIVITIES,
  environmentsFor,
  isAssigned,
  normalizeAssignment,
  rolesFor,
  taxonomyKey,
} from './keybind-taxonomy';

describe('keybind taxonomy', () => {
  it('offers only the environments of the picked scope', () => {
    expect(environmentsFor('verse')).toEqual(['on_foot', 'in_vehicle', 'spectator']);
    expect(environmentsFor('in_game')).toEqual(['mobiglas', 'starmap', 'chat']);
    expect(environmentsFor('out_of_game')).toEqual(['console']);
    expect(environmentsFor(null)).toEqual([]);
  });

  it('offers roles only where the layer applies', () => {
    expect(rolesFor('in_vehicle')).toEqual(['pilot', 'copilot', 'gunner', 'driver']);
    expect(rolesFor('on_foot')).toEqual(['normal', 'eva', 'ladder']);
    // MobiGlas has no roles — the picker stays empty rather than offering Pilot.
    expect(rolesFor('mobiglas')).toEqual([]);
    expect(rolesFor(null)).toEqual([]);
  });

  it('drops a child the new parent no longer allows', () => {
    const pilotInVehicle = normalizeAssignment({
      ...EMPTY_ASSIGNMENT,
      scope: 'verse',
      environment: 'in_vehicle',
      role: 'pilot',
    });
    expect(pilotInVehicle.role).toBe('pilot');

    // Switching the scope invalidates BOTH the environment and the role —
    // exactly what the DB's cross-column CHECKs would otherwise reject on save.
    const switched = normalizeAssignment({ ...pilotInVehicle, scope: 'in_game' });
    expect(switched.environment).toBeNull();
    expect(switched.role).toBeNull();

    // Switching only the environment keeps the scope but drops the role.
    const onFoot = normalizeAssignment({ ...pilotInVehicle, environment: 'on_foot' });
    expect(onFoot.scope).toBe('verse');
    expect(onFoot.role).toBeNull();
  });

  it('keeps the parallel layers independent of the context chain', () => {
    const a = normalizeAssignment({
      ...EMPTY_ASSIGNMENT,
      activity: 'mining',
      actionGroup: 'mining_tools',
    });
    expect(a.activity).toBe('mining');
    expect(a.actionGroup).toBe('mining_tools');
    expect(isAssigned(a)).toBeTrue();
  });

  it('treats an all-null assignment as unassigned', () => {
    expect(isAssigned(EMPTY_ASSIGNMENT)).toBeFalse();
    expect(isAssigned({ ...EMPTY_ASSIGNMENT, scope: 'verse' })).toBeTrue();
  });

  it('builds i18n keys, never literal labels', () => {
    expect(taxonomyKey('actionGroup', 'flight_control'))
      .toBe('codex.keybinds.taxonomy.actionGroup.flight_control');
  });

  it('carries the full L4/L5 vocabulary of the concept doc', () => {
    expect(KEYBIND_ACTIVITIES.length).toBe(9);
    expect(KEYBIND_ACTION_GROUPS.length).toBe(11);
  });
});
