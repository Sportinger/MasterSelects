import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/mobileSkin/actions/phoneCutActions', () => ({
  splitSelectedAtPlayhead: vi.fn(() => ({ ok: true })),
}));

import type { PhoneActionContext } from '../../src/components/mobileSkin/contracts';
import { isMilestoneShipped } from '../../src/components/mobileSkin/contracts';
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
      'Split', 'Delete', 'Duplicate', 'Speed', 'Volume', 'Animation', 'Effects', 'Filters', 'Adjust', 'Mask',
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

  it('makes shipped actions available once their milestone ships', () => {
    expect(resolvePhoneActionState(byId('delete'), baseContext, 'M1')).toEqual({ kind: 'available' });
    expect(resolvePhoneActionState(byId('assistant'), baseContext, 'M4').kind).toBe('unavailable');
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
