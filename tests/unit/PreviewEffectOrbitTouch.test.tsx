import { act, cleanup, render } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewEffectOrbit } from '../../src/components/preview/usePreviewEffectOrbit';
import { usePreviewPinchZoom } from '../../src/components/preview/usePreviewPinchZoom';
import { useTouchMouseBridge } from '../../src/components/preview/useTouchMouseBridge';
import { useEngineStore } from '../../src/stores/engineStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';

const CLIP_ID = 'clip:voxel-touch';
const EFFECT_ID = 'effect:voxel-touch';
const initialTimelineState = useTimelineStore.getState();
const initialEngineState = useEngineStore.getState();
let animationFrameCallbacks: FrameRequestCallback[] = [];
let pinchWheelEvents: WheelEvent[] = [];

function pointerEvent(
  type: string,
  init: { clientX: number; clientY: number; pointerId: number },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  }) as PointerEvent;
  Object.defineProperties(event, {
    isPrimary: { value: init.pointerId === 11 },
    pointerId: { value: init.pointerId },
    pointerType: { value: 'touch' },
  });
  return event;
}

function flushAnimationFrames(): void {
  const callbacks = animationFrameCallbacks;
  animationFrameCallbacks = [];
  callbacks.forEach(callback => callback(performance.now()));
}

function readVoxelParams(): Record<string, unknown> {
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === CLIP_ID);
  return clip?.effects.find(effect => effect.id === EFFECT_ID)?.params ?? {};
}

function TouchOrbitHarness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isCanvasInteractionTarget = useCallback(
    (target: EventTarget | null) => target === canvasRef.current,
    [],
  );
  const orbit = usePreviewEffectOrbit({
    selectedClipId: CLIP_ID,
    editMode: false,
    canvasRef,
    canvasSize: { width: 400, height: 200 },
  });
  const touchBridge = useTouchMouseBridge<HTMLDivElement>({
    enabled: orbit.orbitActive,
    emitClick: false,
    shouldStart: event => event.target === canvasRef.current,
  });
  usePreviewPinchZoom({
    containerRef,
    enabled: orbit.orbitActive,
    handleWheel: event => {
      pinchWheelEvents.push(event);
      orbit.handleWheel(event);
    },
    isCanvasInteractionTarget,
  });

  return (
    <div
      ref={containerRef}
      data-testid="preview"
      {...touchBridge}
      onMouseDown={event => orbit.beginOrbitDrag(event, 'orbit')}
    >
      <canvas
        ref={element => {
          canvasRef.current = element;
          if (!element) return;
          element.getBoundingClientRect = () => ({
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          });
        }}
        data-testid="canvas"
      />
    </div>
  );
}

beforeEach(() => {
  animationFrameCallbacks = [];
  pinchWheelEvents = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const clip = {
    id: CLIP_ID,
    trackId: 'video-1',
    name: 'Voxel touch',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'solid', color: '#808080', naturalDuration: 5 },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [{
      id: EFFECT_ID,
      type: 'voxel-relief',
      name: 'Voxel Relief',
      enabled: true,
      params: {
        centerX: 0.5,
        centerY: 0.5,
        distance: 1,
        tilt: 10,
        yaw: 20,
      },
    }],
    isLoading: false,
  } as TimelineClip;
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [clip],
    selectedClipIds: new Set([CLIP_ID]),
    primarySelectedClipId: CLIP_ID,
  });
  useEngineStore.setState({
    ...initialEngineState,
    effectOrbitTarget: { clipId: CLIP_ID, effectId: EFFECT_ID },
  });
});

afterEach(() => {
  cleanup();
  useTimelineStore.setState(initialTimelineState);
  useEngineStore.setState(initialEngineState);
  vi.unstubAllGlobals();
});

describe('Voxel Relief Preview orbit touch', () => {
  it('routes a one-finger touch drag through the existing orbit path', () => {
    const view = render(<TouchOrbitHarness />);
    const canvas = view.getByTestId('canvas');
    const preview = view.getByTestId('preview');

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        pointerId: 11,
      }));
    });
    act(() => {
      preview.dispatchEvent(pointerEvent('pointermove', {
        clientX: 140,
        clientY: 120,
        pointerId: 11,
      }));
    });
    act(() => {
      preview.dispatchEvent(pointerEvent('pointerup', {
        clientX: 140,
        clientY: 120,
        pointerId: 11,
      }));
    });

    expect(readVoxelParams()).toMatchObject({ yaw: 30, tilt: 15 });
  });

  it('uses a two-finger pinch for distance and centroid movement for focus pan', () => {
    const view = render(<TouchOrbitHarness />);
    const canvas = view.getByTestId('canvas');

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        pointerId: 11,
      }));
    });
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', {
        clientX: 200,
        clientY: 100,
        pointerId: 12,
      }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', {
        clientX: 120,
        clientY: 120,
        pointerId: 11,
      }));
      window.dispatchEvent(pointerEvent('pointermove', {
        clientX: 240,
        clientY: 120,
        pointerId: 12,
      }));
    });
    act(() => {
      flushAnimationFrames();
    });
    act(() => {
      flushAnimationFrames();
    });

    expect(pinchWheelEvents).toHaveLength(1);
    expect(readVoxelParams()).toMatchObject({
      centerX: 0.425,
      centerY: 0.4,
    });
    expect(readVoxelParams().distance).toBeTypeOf('number');
    expect(readVoxelParams().distance as number).toBeLessThan(1);
  });
});
