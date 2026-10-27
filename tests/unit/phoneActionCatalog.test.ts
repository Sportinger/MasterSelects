import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/mobileSkin/actions/phoneCutActions', () => ({
  splitSelectedAtPlayhead: vi.fn(() => ({ ok: true })),
}));
vi.mock('../../src/components/mobileSkin/actions/phoneClipEditActions', () => ({
  deleteSelectedClips: vi.fn(() => ({ ok: true, message: 'deleted' })),
  rippleDeleteSelectedClips: vi.fn(() => ({ ok: true, message: 'rippled' })),
  duplicateSelectedClips: vi.fn(() => ({ ok: true, message: 'duplicated' })),
}));

import type { PhoneActionContext } from '../../src/components/mobileSkin/contracts';
import { PHONE_SHIPPED_MILESTONE, isMilestoneShipped } from '../../src/components/mobileSkin/contracts';
import * as clipEdits from '../../src/components/mobileSkin/actions/phoneClipEditActions';
import {
  PHONE_ACTIONS,
  getPhoneActionsForScope,
  resolvePhoneActionState,
  resolveSplitAvailability,
} from '../../src/components/mobileSkin/actions/phoneActionCatalog';
import { clampPhoneTimelineZoom, usePhoneUiStore } from '../../src/components/mobileSkin/state/phoneUiStore';

const baseContext: PhoneActionContext = {
  selectedClipIds: ['a'],
  playheadTime: 2,
  projectOpen: true,
  engineReady: true,
};
const clips = [{ id: 'a', startTime: 1, duration: 4 }, { id: 'b', startTime: 5, duration: 2 }];

function byId(id: string) {
  const action = PHONE_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`missing action ${id}`);
  return action;
}

describe('phone action catalog', () => {
  it('has unique ids and non-empty scopes in the specified order', () => {
    const ids = PHONE_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getPhoneActionsForScope('root').map((a) => a.label)).toEqual([
      'Edit', 'Audio', 'Text', 'Effects', 'Overlay', 'Captions', 'Filters', 'Adjust', 'Format', 'Assistant', 'Media',
    ]);
    expect(getPhoneActionsForScope('clip').map((a) => a.label)).toEqual([
      'Split', 'Delete', 'Delete & close gap', 'Duplicate', 'Edit text', 'Speed', 'Volume', 'Animation', 'Effects', 'Filters', 'Adjust', 'Mask',
      'Crop', 'Transition', 'Keyframe', 'Replace', 'Reorder',
    ]);
  });

  it('resolves every unshipped milestone to unavailable with a reason', () => {
    for (const action of PHONE_ACTIONS) {
      const state = resolvePhoneActionState(action, baseContext, 'M0');
      if (isMilestoneShipped(action.milestone, 'M0')) continue;
      expect(state.kind).toBe('unavailable');
      if (state.kind === 'unavailable') expect(state.reason.length).toBeGreaterThan(10);
    }
    const del = resolvePhoneActionState(byId('delete'), baseContext, 'M0');
    expect(del).toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('Delete arrives with milestone M1'),
    });
  });

  it('ships M2 and resolves every M1 action as available', () => {
    expect(PHONE_SHIPPED_MILESTONE).toBe('M2');
    const m1 = PHONE_ACTIONS.filter((action) => action.milestone === 'M1');
    expect(m1.map((action) => action.id).toSorted()).toEqual(
      ['assistant', 'delete', 'duplicate', 'edit', 'media', 'reorder', 'ripple-delete', 'text'],
    );
    for (const action of m1) {
      expect(resolvePhoneActionState(action, baseContext)).toEqual({ kind: 'available' });
      expect(action.run).toBeTypeOf('function');
    }
  });

  it('keeps actions of later milestones unavailable with a reason', () => {
    const later = PHONE_ACTIONS.filter((action) => !isMilestoneShipped(action.milestone));
    expect(later.length).toBeGreaterThan(0);
    for (const action of later) {
      const state = resolvePhoneActionState(action, baseContext);
      expect(state.kind).toBe('unavailable');
      if (state.kind === 'unavailable') expect(state.reason).toContain(`milestone ${action.milestone}`);
    }
  });

  it('opens a design sheet from every M2 action', () => {
    const m2 = PHONE_ACTIONS.filter((action) => action.milestone === 'M2' && action.id !== 'edit-text');
    expect(m2.length).toBe(16);
    for (const action of m2) {
      expect(resolvePhoneActionState(action, baseContext)).toEqual({ kind: 'available' });
      expect(action.run).toBeTypeOf('function');
    }
  });

  it('makes shipped actions available once their milestone ships', () => {
    expect(resolvePhoneActionState(byId('delete'), baseContext, 'M1')).toEqual({ kind: 'available' });
    expect(resolvePhoneActionState(byId('captions'), baseContext, 'M2').kind).toBe('unavailable');
    expect(resolvePhoneActionState(byId('assistant'), baseContext, 'M1')).toEqual({ kind: 'available' });
  });

  it('offers Delete and Delete & close gap as separate commands on the same icon', () => {
    const del = byId('delete');
    const ripple = byId('ripple-delete');
    expect(ripple).toMatchObject({ label: 'Delete & close gap', icon: 'delete', scope: 'clip', milestone: 'M1' });
    expect(del.run?.(baseContext)).toEqual({ ok: true, message: 'deleted' });
    expect(ripple.run?.(baseContext)).toEqual({ ok: true, message: 'rippled' });
    expect(clipEdits.deleteSelectedClips).toHaveBeenCalledTimes(1);
    expect(clipEdits.rippleDeleteSelectedClips).toHaveBeenCalledTimes(1);
    expect(byId('duplicate').run?.(baseContext)).toEqual({ ok: true, message: 'duplicated' });
  });

  it('opens sheets for Media and Text and hints for Edit and Reorder', async () => {
    const { usePhoneUiStore } = await import('../../src/components/mobileSkin/state/phoneUiStore');
    expect(byId('media').run?.(baseContext)).toEqual({ ok: true });
    expect(usePhoneUiStore.getState().activeSheet).toBe('media');
    expect(byId('text').run?.(baseContext)).toEqual({ ok: true });
    expect(usePhoneUiStore.getState().activeSheet).toBe('title');
    usePhoneUiStore.getState().closeSheet();
    expect(byId('edit').run?.(baseContext)).toEqual({ ok: true, message: 'Tap a clip to edit it' });
    expect(byId('reorder').run?.(baseContext)).toEqual({ ok: true, message: 'Long-press a clip and drag it' });
  });

  it('allows split only strictly inside a selected clip', () => {
    expect(resolveSplitAvailability(baseContext, clips)).toEqual({ kind: 'available' });
    const unavailable = (context: PhoneActionContext) => resolveSplitAvailability(context, clips).kind;
    expect(unavailable({ ...baseContext, selectedClipIds: [] })).toBe('unavailable');
    expect(unavailable({ ...baseContext, playheadTime: 1 })).toBe('unavailable');
    expect(unavailable({ ...baseContext, playheadTime: 5 })).toBe('unavailable');
    expect(unavailable({ ...baseContext, playheadTime: 6 })).toBe('unavailable'); // inside clip b, not selected
    expect(unavailable({ ...baseContext, projectOpen: false })).toBe('unavailable');
    expect(unavailable({ ...baseContext, engineReady: false })).toBe('unavailable');
  });

  it('gives every unavailable split state a concrete reason', () => {
    const state = resolveSplitAvailability({ ...baseContext, selectedClipIds: [] }, clips);
    expect(state).toEqual({ kind: 'unavailable', reason: expect.stringContaining('Select a clip') });
  });
});

describe('phone ui store', () => {
  it('clamps the timeline zoom and keeps notices and toasts', () => {
    expect(clampPhoneTimelineZoom(0)).toBe(4);
    expect(clampPhoneTimelineZoom(1e9)).toBe(1200);
    usePhoneUiStore.getState().setTimelineZoom(5000);
    expect(usePhoneUiStore.getState().timelineZoom).toBe(1200);
    usePhoneUiStore.getState().showToast('boom', 'error');
    expect(usePhoneUiStore.getState().toast).toMatchObject({ message: 'boom', tone: 'error' });
    usePhoneUiStore.getState().dismissToast();
    expect(usePhoneUiStore.getState().toast).toBeNull();
  });
});
