import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionAdjustmentTab } from '../../src/components/panels/properties/MotionAdjustmentTab';
import { getMotionAdjustmentDiagnostics } from '../../src/components/panels/properties/motionAdjustmentDiagnostics';
import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { PropertiesPanel } from '../../src/components/panels/properties';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { Effect } from '../../src/types';

const initialState = useTimelineStore.getState();

function effect(type: string, params: Effect['params']): Effect {
  return {
    id: `effect:${type}`,
    name: type,
    type,
    enabled: true,
    params,
  };
}

describe('MotionAdjustmentTab MD7 authoring', () => {
  let clipId: string;

  beforeEach(() => {
    useTimelineStore.setState({
      ...initialState,
      clips: [],
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clipKeyframes: new Map(),
    });
    vi.mocked(useMediaStore).mockImplementation(((selector: (state: Record<string, unknown>) => unknown) => selector({
      compositions: [],
      files: [],
      selectedSlotCompositionId: null,
      slotAssignments: {},
      selectSlotComposition: vi.fn(),
      ensureSlotClipSettings: vi.fn(),
    })) as typeof useMediaStore);
    clipId = useTimelineStore.getState().addMotionAdjustmentClip('video-1', 0, 5)!;
  });

  afterEach(() => {
    act(() => {
      useTimelineStore.setState(initialState);
    });
  });

  it('exposes only the frozen mix controls and updates blend mode', () => {
    render(<MotionAdjustmentTab clipId={clipId} opacity={1} blendMode="normal" />);

    const blend = screen.getByLabelText('Blend');
    expect(Array.from((blend as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'normal',
      'multiply',
      'screen',
      'overlay',
      'add',
    ]);
    expect(screen.queryByText('Position')).not.toBeInTheDocument();
    expect(screen.queryByText('Color')).not.toBeInTheDocument();

    fireEvent.change(blend, { target: { value: 'screen' } });
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.transform.blendMode)
      .toBe('screen');
  });

  it('shows a fail-closed diagnostic for unsupported effects', () => {
    act(() => {
      useTimelineStore.setState((state) => ({
        clips: state.clips.map((clip) => clip.id === clipId
          ? { ...clip, effects: [effect('vignette', { amount: 0.5 })] }
          : clip),
      }));
    });

    render(<MotionAdjustmentTab clipId={clipId} opacity={1} blendMode="normal" />);

    expect(screen.getByTestId('motion-adjustment-diagnostics')).toHaveTextContent('Render blocked');
    expect(screen.getByTestId('motion-adjustment-diagnostics')).toHaveTextContent('unsupported effect vignette');
  });

  it('reports complete supported-effect parity for valid effect data', () => {
    const diagnostics = getMotionAdjustmentDiagnostics(clipId, [
      effect('brightness', { amount: 0.2 }),
      effect('blur', { radius: 8, samples: 5 }),
    ], 'normal');

    expect(diagnostics).toEqual({
      compatible: true,
      effectCount: 2,
      message: '2 supported effects ready on preview, nested comps, targets, and export.',
    });
  });

  it('limits the Effects picker to the renderer-supported adjustment matrix', () => {
    render(<EffectsTab clipId={clipId} effects={[]} />);

    const picker = screen.getByRole('combobox');
    const values = Array.from((picker as HTMLSelectElement).options)
      .map((option) => option.value)
      .filter(Boolean);
    expect(values).toEqual(expect.arrayContaining([
      'brightness',
      'contrast',
      'saturation',
      'invert',
      'gaussian-blur',
    ]));
    expect(values).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Particle Out' })).not.toBeInTheDocument();
    expect(screen.getByText('Adjustment-safe effects')).toBeInTheDocument();
  });

  it('routes an adjustment selection to its safe properties surface', async () => {
    act(() => {
      useTimelineStore.setState({
        selectedClipIds: new Set([clipId]),
        primarySelectedClipId: clipId,
        propertiesSelection: { kind: 'clip', clipId },
      });
    });

    render(<PropertiesPanel />);

    expect(await screen.findByRole('button', { name: 'Adjustment' })).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Transform' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Color' })).not.toBeInTheDocument();
    expect(await screen.findByTestId('motion-adjustment-diagnostics')).toHaveTextContent('Render compatible');
  });
});
