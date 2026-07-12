import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mediaState: { files: [], compositions: [], activeCompositionId: null },
  timelineState: {
    clips: [],
    tracks: [{ id: 'track', type: 'video', visible: true }],
    playheadPosition: 0,
    maskDragging: false,
    clipDragPreview: null,
    getInterpolatedMasks: vi.fn(),
  },
  getOutputDimensions: vi.fn(() => ({ width: 100, height: 100 })),
  updateMaskTexture: vi.fn(),
  removeMaskTexture: vi.fn(),
  requestRender: vi.fn(),
  generateMaskTexture: vi.fn(() => ({})),
  findActiveTransitionPlanForTrack: vi.fn(),
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    getOutputDimensions: mocks.getOutputDimensions,
    updateMaskTexture: mocks.updateMaskTexture,
    removeMaskTexture: mocks.removeMaskTexture,
    requestRender: mocks.requestRender,
  },
}));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(
    (selector: (state: typeof mocks.mediaState) => unknown) => selector(mocks.mediaState),
    { subscribe: vi.fn(() => () => {}) },
  ),
}));
vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => mocks.timelineState,
    subscribe: vi.fn(() => () => {}),
  },
}));
vi.mock('../../src/stores/sam2Store', () => ({
  useSAM2Store: { getState: () => ({ isActive: false }), subscribe: vi.fn(() => () => {}) },
  maskToImageData: vi.fn(),
}));
vi.mock('../../src/stores/timeline/clipDragPreview', () => ({ applyClipDragPreview: (clips: unknown[]) => clips }));
vi.mock('../../src/stores/timeline/editOperations/transitionPlanner', () => ({
  DEFAULT_TRANSITION_PLACEMENT: 'center',
  findActiveTransitionPlanForTrack: mocks.findActiveTransitionPlanForTrack,
}));
vi.mock('../../src/utils/maskRenderer', () => ({ generateMaskTexture: mocks.generateMaskTexture }));

import { useEngineMaskTextureSync } from '../../src/hooks/engine/useEngineMaskTextureSync';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.mediaState.compositions = [];
  mocks.findActiveTransitionPlanForTrack.mockReset();
});

describe('useEngineMaskTextureSync', () => {
  it('removes a stale transition mask when its v2 map becomes invalid', () => {
    const mask = {
      id: 'source-mask', name: 'Source mask', closed: true, opacity: 1, feather: 0, inverted: false,
      mode: 'add', expanded: false, position: { x: 0, y: 0 }, enabled: true, visible: true,
      vertices: [{ id: 'vertex', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'mirrored' }],
    };
    const transitionClip = {
      id: 'transition-child', startTime: 0, duration: 1, masks: [mask], keyframes: [],
      transform: {
        opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      transitionSourceMap: {
        version: 2,
        mediaDuration: 1,
        parent: {
          duration: 1, inPoint: 0, outPoint: 1, defaultSpeed: 1,
          animation: {
            baseTransform: {
              opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
            },
            keyframes: [], sourceEffectIds: [], sourceMaskIds: ['source-mask'],
          },
        },
        segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 1, parentStart: 0, parentEnd: 1 }],
      },
    };
    mocks.mediaState.compositions = [{
      id: 'transition-comp', duration: 1,
      timelineData: { clips: [transitionClip], inPoint: 0, outPoint: 1 },
    }];
    mocks.findActiveTransitionPlanForTrack.mockReturnValue({
      plan: { bodyStart: 0, bodyEnd: 1 },
      outgoingClip: { transitionOut: { compositionId: 'transition-comp' } },
    });

    const { result } = renderHook(() => useEngineMaskTextureSync(true));
    expect(mocks.updateMaskTexture).toHaveBeenCalledWith('transition-child', expect.anything());

    transitionClip.transitionSourceMap = { version: 2, segments: [] } as never;
    act(() => result.current(true));

    expect(mocks.removeMaskTexture).toHaveBeenCalledWith('transition-child');
  });
});
