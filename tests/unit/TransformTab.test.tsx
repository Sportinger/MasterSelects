import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformTab } from '../../src/components/panels/properties/TransformTab';
import type { BlendMode } from '../../src/types';

const mockState = vi.hoisted(() => ({
  sourceType: 'gaussian-splat',
  setPropertyValue: vi.fn(),
  updateClipTransform: vi.fn(),
  toggle3D: vi.fn(),
  updateClip: vi.fn(),
  isRecording: vi.fn(() => false),
  hasKeyframes: vi.fn(() => false),
  addKeyframe: vi.fn(),
  toggleKeyframeRecording: vi.fn(),
  disablePropertyKeyframes: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => {
  const useTimelineStore = Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector({
      clips: [{
        id: 'clip-1',
        source: {
          type: mockState.sourceType,
          threeDEffectorsEnabled: true,
        },
        wireframe: false,
      }],
    })),
    {
      getState: vi.fn(() => ({
        setPropertyValue: mockState.setPropertyValue,
        updateClipTransform: mockState.updateClipTransform,
        toggle3D: mockState.toggle3D,
        updateClip: mockState.updateClip,
        isRecording: mockState.isRecording,
        hasKeyframes: mockState.hasKeyframes,
        addKeyframe: mockState.addKeyframe,
        toggleKeyframeRecording: mockState.toggleKeyframeRecording,
        disablePropertyKeyframes: mockState.disablePropertyKeyframes,
      })),
    },
  );

  return { useTimelineStore };
});

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      getActiveComposition: () => ({ width: 1920, height: 1080 }),
    })),
  }),
}));

vi.mock('../../src/stores/engineStore', () => {
  const engineState = {
    sceneNavFpsMode: false,
    sceneNavFpsMoveSpeed: 1,
    sceneNavNoKeyframes: false,
    setSceneNavFpsMode: vi.fn(),
    setSceneNavFpsMoveSpeed: vi.fn(),
    setSceneNavNoKeyframes: vi.fn(),
  };

  return {
    SCENE_NAV_FPS_MOVE_SPEED_STEPS: [0.25, 0.5, 1, 2],
    getSceneNavFpsMoveSpeedStepIndex: () => 2,
    selectSceneNavFpsMode: (state: typeof engineState) => state.sceneNavFpsMode,
    selectSceneNavFpsMoveSpeed: (state: typeof engineState) => state.sceneNavFpsMoveSpeed,
    selectSceneNavNoKeyframes: (state: typeof engineState) => state.sceneNavNoKeyframes,
    useEngineStore: vi.fn((selector: (state: typeof engineState) => unknown) => selector(engineState)),
  };
});

vi.mock('../../src/stores/historyStore', () => ({
  startBatch: vi.fn(),
  endBatch: vi.fn(),
}));

function makeTransform(position: { x: number; y: number; z: number }) {
  return {
    opacity: 1,
    blendMode: 'normal' as BlendMode,
    position,
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function numberTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.draggable-number'))
    .map((element) => element.textContent ?? '');
}

describe('TransformTab position units', () => {
  beforeEach(() => {
    mockState.sourceType = 'gaussian-splat';
    mockState.setPropertyValue.mockClear();
    mockState.updateClipTransform.mockClear();
    mockState.toggle3D.mockClear();
    mockState.updateClip.mockClear();
    mockState.isRecording.mockClear();
    mockState.hasKeyframes.mockClear();
    mockState.addKeyframe.mockClear();
    mockState.toggleKeyframeRecording.mockClear();
    mockState.disablePropertyKeyframes.mockClear();
  });

  it('edits native 3D splat positions in scene units', () => {
    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 1.25, y: -2.5, z: 3.75 })}
      />,
    );

    expect(numberTexts(container)).toContain('1.250');
    expect(numberTexts(container)).toContain('-2.500');
    expect(numberTexts(container)).toContain('3.750');
    expect(numberTexts(container)).not.toContain('1200.0');

    const positionXControl = container.querySelectorAll('.draggable-number')[2];
    fireEvent.doubleClick(positionXControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'position.x', 2.5);
  });

  it('keeps 2D clips in composition pixel units', () => {
    mockState.sourceType = 'video';
    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0.5, y: -0.25, z: 0 })}
      />,
    );

    expect(numberTexts(container)).toContain('480.0');
    expect(numberTexts(container)).toContain('-135.0');

    const positionXControl = container.querySelectorAll('.draggable-number')[2];
    fireEvent.doubleClick(positionXControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '960' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'position.x', 1);
  });

  it('edits 3D video plane positions in scene units', () => {
    mockState.sourceType = 'video';
    const { container } = render(
      <TransformTab
        clipId="clip-1"
        is3D
        transform={makeTransform({ x: 0.5, y: -0.25, z: 2 })}
      />,
    );

    expect(numberTexts(container)).toContain('0.500');
    expect(numberTexts(container)).toContain('-0.250');
    expect(numberTexts(container)).toContain('2.000');
    expect(numberTexts(container)).not.toContain('480.0');
  });
});
