import {
  deriveActionName,
  resolveKeybindLabel,
  sharedContext,
} from './keybind-format';

describe('deriveActionName', () => {
  it('strips the vehicle prefix and title-cases the remainder', () => {
    const d = deriveActionName('v_strafe_up');
    expect(d.label).toBe('Strafe Up');
    expect(d.context).toBe('vehicle');
    expect(d.raw).toBe('v_strafe_up');
  });

  it('strips the spectator prefix', () => {
    expect(deriveActionName('spectate_enterpuremode')).toEqual({
      label: 'Enterpuremode',
      context: 'spectator',
      raw: 'spectate_enterpuremode',
    });
  });

  it('maps the interface prefix family to one context', () => {
    expect(deriveActionName('ui_back').context).toBe('interface');
    expect(deriveActionName('mapui_zoom_in').context).toBe('interface');
    expect(deriveActionName('flashui_toggle').context).toBe('interface');
  });

  it('maps the eva prefix family to one context', () => {
    expect(deriveActionName('eva_brake').context).toBe('eva');
    expect(deriveActionName('zgt_push_off').context).toBe('eva');
  });

  it('strips only the first prefix, so a nested family stays in the label', () => {
    const d = deriveActionName('v_view_yaw_absolute');
    expect(d.label).toBe('View Yaw Absolute');
    expect(d.context).toBe('vehicle'); // not 'camera'
  });

  it('keeps verb/noun heads that are not context prefixes', () => {
    expect(deriveActionName('toggle_lights')).toEqual({
      label: 'Toggle Lights',
      context: null,
      raw: 'toggle_lights',
    });
    expect(deriveActionName('weapon_reload').context).toBeNull();
    expect(deriveActionName('select_item').context).toBeNull();
  });

  it('splits camelCase and letter/digit boundaries', () => {
    expect(deriveActionName('useAttachmentTop').label).toBe('Use Attachment Top');
    expect(deriveActionName('pc_conversation_option1').label).toBe('Conversation Option 1');
  });

  it('keeps known acronyms upper-cased', () => {
    expect(deriveActionName('v_ads_hold').label).toBe('ADS Hold');
    expect(deriveActionName('v_ifcs_vtol_on').label).toBe('IFCS VTOL On');
    expect(deriveActionName('v_hud_left_panel_up').label).toBe('HUD Left Panel Up');
  });

  it('never collapses a bare prefix into an empty label', () => {
    expect(deriveActionName('v')).toEqual({ label: 'V', context: null, raw: 'v' });
    expect(deriveActionName('v_')).toEqual({ label: 'V', context: null, raw: 'v_' });
  });

  it('handles empty / nullish input', () => {
    expect(deriveActionName(null)).toEqual({ label: '', context: null, raw: '' });
    expect(deriveActionName('   ')).toEqual({ label: '', context: null, raw: '' });
  });
});

describe('resolveKeybindLabel', () => {
  it('prefers the active language translation', () => {
    const l = resolveKeybindLabel({
      actionName: 'v_strafe_up',
      localized: 'Seitwärts aufwärts',
      english: 'Strafe Up',
    });
    expect(l.text).toBe('Seitwärts aufwärts');
    expect(l.source).toBe('localized');
    expect(l.context).toBe('vehicle');
  });

  it('falls back to the English original when the language has no entry', () => {
    const l = resolveKeybindLabel({
      actionName: 'v_strafe_up',
      localized: null,
      english: 'Strafe Up',
    });
    expect(l.text).toBe('Strafe Up');
    expect(l.source).toBe('english');
  });

  it('derives the name when no translation exists in any language', () => {
    const l = resolveKeybindLabel({ actionName: 'v_ifcs_vector_decoupling_toggle' });
    expect(l.text).toBe('IFCS Vector Decoupling Toggle');
    expect(l.source).toBe('derived');
    expect(l.context).toBe('vehicle');
    expect(l.raw).toBe('v_ifcs_vector_decoupling_toggle');
  });

  it('treats an unresolved @-key as no translation at all', () => {
    const l = resolveKeybindLabel({
      actionName: 'v_toggle_scan_mode',
      localized: '@ui_CIScanningMode',
      english: '@ui_CIScanningMode',
    });
    expect(l.source).toBe('derived');
    expect(l.text).toBe('Toggle Scan Mode');
  });

  it('still reports the context when the label came from a translation', () => {
    expect(resolveKeybindLabel({ actionName: 'ui_back', english: 'Back' }).context)
      .toBe('interface');
  });
});

describe('sharedContext', () => {
  it('returns the context every row shares', () => {
    expect(sharedContext(['vehicle', 'vehicle', 'vehicle'])).toBe('vehicle');
  });

  it('returns null for mixed contexts', () => {
    expect(sharedContext(['vehicle', 'interface'])).toBeNull();
  });

  it('returns null when any row has no context (hoisting would over-claim)', () => {
    expect(sharedContext(['vehicle', null])).toBeNull();
    expect(sharedContext([null, null])).toBeNull();
  });

  it('returns null for an empty group', () => {
    expect(sharedContext([])).toBeNull();
  });
});
