import { createElement, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EffectSectionBypass, useEffectSectionBypass } from '../../src/components/panels/properties/resolveInspector/EffectSectionBypass';
import { getDefaultParams } from '../../src/effects';
import { setEffectGroupEnabled } from '../../src/services/operators/effectGroupBypassEditing';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

import {
  applyVideoInspectorSpeedBypass,
  applyVideoInspectorTransformBypass,
  isVideoInspectorSectionEnabled,
} from '../../src/services/videoInspector/sectionBypass';
import type { ClipTransform, TimelineClip } from '../../src/types';

// Graph recognition is the expensive step a parameter drag must not repeat.
const recognition = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/services/operators/recognizeOperatorCompositions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/services/operators/recognizeOperatorCompositions')>();
  return { ...actual, recognizeOperatorCompositions: (...args: Parameters<typeof actual.recognizeOperatorCompositions>) => {
    recognition.calls++;
    return actual.recognizeOperatorCompositions(...args);
  } };
});

const editedTransform: ClipTransform = {
  opacity: 0.4,
  blendMode: 'screen',
  position: { x: 0.5, y: -0.25, z: 3 },
  scale: { all: 2, x: -2, y: 2, z: 0.5 },
  rotation: { x: 12, y: 24, z: 36 },
};

function clipWithSections(videoInspectorSections: TimelineClip['videoInspectorSections']): TimelineClip {
  return {
    id: 'clip-1',
    videoInspectorSections,
  } as TimelineClip;
}

describe('video inspector section bypass', () => {
  it('defaults Dynamic Zoom off and implemented sections on', () => {
    expect(isVideoInspectorSectionEnabled(undefined, 'dynamicZoom')).toBe(false);
    expect(isVideoInspectorSectionEnabled(undefined, 'transform')).toBe(true);
    expect(isVideoInspectorSectionEnabled(undefined, 'composite')).toBe(true);
    expect(isVideoInspectorSectionEnabled(undefined, 'speedChange')).toBe(true);
  });

  it('bypasses transform and composite while preserving the edited input', () => {
    const clip = clipWithSections({ transform: false, composite: false });
    const resolved = applyVideoInspectorTransformBypass(clip, editedTransform);

    expect(resolved).toEqual({
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0, z: 0 },
      scale: { all: 1, x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(editedTransform).toEqual({
      opacity: 0.4,
      blendMode: 'screen',
      position: { x: 0.5, y: -0.25, z: 3 },
      scale: { all: 2, x: -2, y: 2, z: 0.5 },
      rotation: { x: 12, y: 24, z: 36 },
    });
  });

  it('bypasses speed without changing the stored speed', () => {
    const clip = clipWithSections({ speedChange: false });
    expect(applyVideoInspectorSpeedBypass(clip, 2.5)).toBe(1);
    expect(clip.videoInspectorSections?.speedChange).toBe(false);
  });
});

describe('effect section bypass during parameter drags', () => {
  const initial = useTimelineStore.getState();
  const seen: Array<ReturnType<typeof useEffectSectionBypass>> = [];
  function Probe({ id }: { id: string }) {
    const binding = useEffectSectionBypass(`group:${id}`);
    seen.push(binding);
    return createElement('span', { 'data-testid': id }, binding ? String(binding.enabled) : 'none');
  }
  const mount = (clipId: string, effectId: string, groupId: string, extra?: ReactNode) => render(createElement(EffectSectionBypass,
    { clipId, effectId, children: [createElement(Probe, { key: 'probe', id: groupId }), extra] }));
  const savedEffect = (clipId: string) => useTimelineStore.getState().clips.find(clip => clip.id === clipId)!.effects[0];

  beforeEach(() => { seen.length = 0; });
  afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

  function setup(type: Effect['type'], id: string) {
    const effect: Effect = { id, type, name: type, enabled: true, params: getDefaultParams(type) };
    const clip = createMockClip({ id: `${id}-clip`, trackId: 'bypass-track', effects: [effect] });
    const other = createMockClip({ id: `${id}-other`, trackId: 'bypass-track', effects: [] });
    useTimelineStore.setState({ clips: [clip, other], tracks: [createMockTrack({ id: 'bypass-track', locked: false })] });
    return { clip, effect };
  }

  it('does not resolve the operator graph again when only a parameter value changes', () => {
    const { clip, effect } = setup('gaussian-blur', 'blur-fx');
    mount(clip.id, effect.id, 'organized-gaussian-blur-vertical');
    expect(screen.getByTestId('organized-gaussian-blur-vertical').textContent).toBe('true');
    const binding = seen.at(-1);
    recognition.calls = 0;
    const renders = seen.length;
    for (let radius = 11; radius <= 40; radius++) act(() => useTimelineStore.getState().updateClipEffect(clip.id, effect.id, { radius }));
    expect(savedEffect(clip.id).params.radius).toBe(40);
    expect(recognition.calls).toBe(0);
    // The bindings keep their identity, so the section switches do not re-render per sample.
    expect(seen.length).toBe(renders);
    expect(seen.at(-1)).toBe(binding);
    // Edits to another clip do not reach this form at all.
    act(() => useTimelineStore.getState().updateClip(`${effect.id}-other`, { name: 'renamed' }));
    expect(seen.length).toBe(renders);
  });

  it('re-resolves the graph when a group is bypassed and keeps parameter drags cached afterwards', () => {
    const { clip, effect } = setup('slit-scan', 'slit-fx');
    mount(clip.id, effect.id, 'subject-protection');
    expect(screen.getByTestId('subject-protection').textContent).toBe('true');
    recognition.calls = 0;
    act(() => setEffectGroupEnabled(clip.id, effect.id, 'subject-protection', false));
    expect(recognition.calls).toBeGreaterThan(0);
    expect(screen.getByTestId('subject-protection').textContent).toBe('false');
    expect(savedEffect(clip.id).operatorGraph?.groups?.find(group => group.id === 'subject-protection')?.bypassed).toBe(true);

    recognition.calls = 0;
    for (let step = 1; step <= 10; step++) act(() => useTimelineStore.getState().updateClipEffect(clip.id, effect.id, { geometryTimeDepth: step / 20 }));
    expect(recognition.calls).toBe(0);
    expect(screen.getByTestId('subject-protection').textContent).toBe('false');

    act(() => setEffectGroupEnabled(clip.id, effect.id, 'subject-protection', true));
    expect(recognition.calls).toBeGreaterThan(0);
    expect(screen.getByTestId('subject-protection').textContent).toBe('true');
  });

  it('follows renderer switches of scene groups', () => {
    const { clip, effect } = setup('splat-exploration', 'splat-fx');
    mount(clip.id, effect.id, 'splat-branch-1');
    expect(screen.getByTestId('splat-branch-1').textContent).toBe('true');
    act(() => setEffectGroupEnabled(clip.id, effect.id, 'splat-branch-1', false));
    expect(screen.getByTestId('splat-branch-1').textContent).toBe('false');
    act(() => setEffectGroupEnabled(clip.id, effect.id, 'splat-branch-1', true));
    expect(screen.getByTestId('splat-branch-1').textContent).toBe('true');
  });

  it('locks the switches while exporting', () => {
    const { clip, effect } = setup('gaussian-blur', 'locked-fx');
    mount(clip.id, effect.id, 'organized-gaussian-blur-vertical');
    expect(seen.at(-1)?.onEnabledChange).toBeTypeOf('function');
    act(() => useTimelineStore.setState({ isExporting: true }));
    expect(seen.at(-1)?.onEnabledChange).toBeUndefined();
  });
});
