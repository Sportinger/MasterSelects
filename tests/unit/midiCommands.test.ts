import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useEngineStore } from '../../src/stores/engineStore';
import { resolveOrbitCameraFrame } from '../../src/engine/gaussian/core/SplatCameraUtils';
import { getSharedSceneDefaultCameraDistance } from '../../src/engine/scene/SceneCameraUtils';
import {
  triggerMIDITransportAction,
  triggerMarkerMIDIAction,
  triggerMarkerMIDIBinding,
  triggerMIDIParameterBinding,
  triggerSlotMIDIAction,
  triggerSlotMIDIBinding,
  resetDampedMIDIParameterBindings,
} from '../../src/services/midi/midiCommands';

describe('midiCommands', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    resetDampedMIDIParameterBindings();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    useMediaStore.setState({ slotAssignments: {} });
    useEngineStore.setState({
      sceneNavNoKeyframes: false,
      sceneCameraLiveOverrides: {},
    });
    useTimelineStore.setState({
      clips: [],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      playheadPosition: 0,
    });
    vi.restoreAllMocks();
  });

  it('triggers transport playback actions', async () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();

    useTimelineStore.setState({
      isPlaying: false,
      play,
      pause,
    });

    await triggerMIDITransportAction('playPause');

    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('triggers marker jump actions from an explicit time', async () => {
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: false,
      setDraggingPlayhead,
      setPlayheadPosition,
    });

    await triggerMarkerMIDIAction('jumpToMarker', 12.5);

    expect(setDraggingPlayhead).toHaveBeenCalledWith(false);
    expect(setPlayheadPosition).toHaveBeenCalledWith(12.5);
  });

  it('can force a marker jump to stop playback', async () => {
    const pause = vi.fn();
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: true,
      pause,
      setDraggingPlayhead,
      setPlayheadPosition,
    });

    await triggerMarkerMIDIAction('jumpToMarkerAndStop', 8.25);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(setDraggingPlayhead).toHaveBeenCalledWith(false);
    expect(setPlayheadPosition).toHaveBeenCalledWith(8.25);
  });

  it('resolves marker bindings through the same path as incoming MIDI notes', async () => {
    const play = vi.fn(async () => undefined);
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();
    const setPlaybackSpeed = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: false,
      playbackSpeed: 1,
      play,
      setDraggingPlayhead,
      setPlayheadPosition,
      setPlaybackSpeed,
      markers: [
        {
          id: 'marker-1',
          time: 9.75,
          label: 'Drop',
          color: '#ff0',
          midiBindings: [{ action: 'playFromMarker', channel: 2, note: 40 }],
        },
      ],
    });

    await triggerMarkerMIDIBinding({
      action: 'playFromMarker',
      channel: 2,
      note: 40,
    });

    expect(setPlayheadPosition).toHaveBeenCalledWith(9.75);
    expect(play).toHaveBeenCalledTimes(1);
    expect(setPlaybackSpeed).toHaveBeenCalledWith(1);
  });

  it('triggers slot bindings on the assigned slot layer', async () => {
    const triggerLiveSlot = vi.fn();
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      slotAssignments: {
        'comp-slot': 13,
      },
      triggerLiveSlot,
    } as ReturnType<typeof useMediaStore.getState>);

    await triggerSlotMIDIAction(13);
    await triggerSlotMIDIBinding({
      action: 'triggerSlot',
      slotIndex: 13,
      channel: 1,
      note: 36,
    });

    expect(triggerLiveSlot).toHaveBeenCalledTimes(2);
    expect(triggerLiveSlot).toHaveBeenCalledWith('comp-slot', 1);
  });

  it('maps MIDI parameter bindings through setPropertyValue', async () => {
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      clips: [{ id: 'clip-midi-param' }],
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-param:opacity',
      clipId: 'clip-midi-param',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      currentValue: 0.5,
      message: {
        type: 'control-change',
        channel: 1,
        control: 7,
      },
    }, 127);

    expect(setPropertyValue).toHaveBeenCalledWith('clip-midi-param', 'opacity', 1);
  });

  it('can invert MIDI parameter ranges', async () => {
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      clips: [{ id: 'clip-midi-param-invert' }],
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-param-invert:opacity',
      clipId: 'clip-midi-param-invert',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      invert: true,
      message: {
        type: 'control-change',
        channel: 1,
        control: 7,
      },
    }, 127);

    expect(setPropertyValue).toHaveBeenCalledWith('clip-midi-param-invert', 'opacity', 0);
  });

  it('uses custom MIDI parameter ranges', async () => {
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      clips: [{ id: 'clip-midi-param-range' }],
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-param-range:scale.x',
      clipId: 'clip-midi-param-range',
      property: 'scale.x',
      label: 'Scale X',
      min: 2,
      max: 4,
      message: {
        type: 'control-change',
        channel: 1,
        control: 7,
      },
    }, 0);

    expect(setPropertyValue).toHaveBeenCalledWith('clip-midi-param-range', 'scale.x', 2);
  });

  it('damps MIDI parameter bindings over animation frames', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    globalThis.cancelAnimationFrame = vi.fn();
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      clips: [{
        id: 'clip-midi-param-damped',
        transform: {
          opacity: 0,
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          blendMode: 'normal',
        },
      }],
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-param-damped:opacity',
      clipId: 'clip-midi-param-damped',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      damping: true,
      message: {
        type: 'control-change',
        channel: 1,
        control: 7,
      },
    }, 127);

    expect(setPropertyValue).not.toHaveBeenCalled();

    for (let i = 0; i < 20 && frameCallbacks.length > 0; i += 1) {
      const callback = frameCallbacks.shift();
      callback?.(i * 50);
    }

    expect(setPropertyValue).toHaveBeenCalled();
    const firstValue = setPropertyValue.mock.calls[0]?.[2];
    const lastValue = setPropertyValue.mock.calls.at(-1)?.[2];
    expect(firstValue).toBeGreaterThan(0);
    expect(firstValue).toBeLessThan(1);
    expect(lastValue).toBeCloseTo(1, 4);
  });

  it('starts damped keyframed transform changes from the interpolated playhead value', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    globalThis.cancelAnimationFrame = vi.fn();
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      playheadPosition: 5,
      clips: [{
        id: 'clip-midi-keyframed-damped',
        startTime: 0,
        duration: 10,
        transform: {
          opacity: 1,
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          blendMode: 'normal',
        },
      }],
      clipKeyframes: new Map([[
        'clip-midi-keyframed-damped',
        [
          { id: 'op-0', clipId: 'clip-midi-keyframed-damped', property: 'opacity', time: 0, value: 0.4, easing: 'linear' },
          { id: 'op-1', clipId: 'clip-midi-keyframed-damped', property: 'opacity', time: 10, value: 0.6, easing: 'linear' },
        ],
      ]]),
      keyframeRecordingEnabled: new Set(),
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-keyframed-damped:opacity',
      clipId: 'clip-midi-keyframed-damped',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      damping: true,
      message: {
        type: 'control-change',
        channel: 1,
        control: 7,
      },
    }, 66);

    frameCallbacks.shift()?.(0);

    const firstValue = setPropertyValue.mock.calls[0]?.[2];
    expect(firstValue).toBeGreaterThan(0.5);
    expect(firstValue).toBeLessThan(0.51);
  });

  it('can drive grouped MIDI parameter bindings', async () => {
    const setPropertyValue = vi.fn();

    useTimelineStore.setState({
      clips: [{ id: 'clip-midi-scale' }],
      setPropertyValue,
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-scale:scale.x',
      clipId: 'clip-midi-scale',
      property: 'scale.x',
      properties: ['scale.x', 'scale.y'],
      label: 'Scale All',
      min: 0,
      max: 2,
      currentValue: 1,
      message: {
        type: 'control-change',
        channel: 1,
        control: 8,
      },
    }, 64);

    expect(setPropertyValue).toHaveBeenCalledTimes(2);
    expect(setPropertyValue).toHaveBeenNthCalledWith(1, 'clip-midi-scale', 'scale.x', expect.closeTo(1.0079, 4));
    expect(setPropertyValue).toHaveBeenNthCalledWith(2, 'clip-midi-scale', 'scale.y', expect.closeTo(1.0079, 4));
  });

  it('can drive camera source parameters', async () => {
    useTimelineStore.setState({
      clips: [
        {
          id: 'clip-midi-camera',
          source: {
            type: 'camera',
            cameraSettings: { fov: 50, near: 0.1, far: 1000 },
          },
        },
      ],
      updateDuration: vi.fn(),
      invalidateCache: vi.fn(),
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-camera:camera.fov',
      clipId: 'clip-midi-camera',
      property: 'camera.fov',
      label: 'Camera FOV',
      min: 10,
      max: 140,
      currentValue: 50,
      message: {
        type: 'control-change',
        channel: 1,
        control: 9,
      },
    }, 127);

    expect(useTimelineStore.getState().clips[0]?.source?.cameraSettings?.fov).toBe(140);
  });

  it('keeps the camera eye fixed when MIDI drives camera look rotation', async () => {
    const cameraSettings = { fov: 60, near: 0.1, far: 1000 };
    const transform = {
      position: { x: 0.4, y: -0.2, z: 4 },
      scale: { x: 1, y: 1, z: 0.75 },
      rotation: { x: 5, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal' as const,
    };
    const settings = {
      nearPlane: cameraSettings.near,
      farPlane: cameraSettings.far,
      fov: cameraSettings.fov,
      minimumDistance: getSharedSceneDefaultCameraDistance(cameraSettings.fov),
    };
    const viewport = { width: 1920, height: 1080 };
    const beforeFrame = resolveOrbitCameraFrame(transform, settings, viewport);

    useTimelineStore.setState({
      clips: [
        {
          id: 'clip-midi-camera-look',
          transform,
          source: {
            type: 'camera',
            cameraSettings,
          },
        },
      ],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      updateDuration: vi.fn(),
      invalidateCache: vi.fn(),
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-camera-look:rotation.y',
      clipId: 'clip-midi-camera-look',
      property: 'rotation.y',
      label: 'Camera Yaw',
      min: 0,
      max: 90,
      currentValue: 0,
      message: {
        type: 'control-change',
        channel: 1,
        control: 11,
      },
    }, 127);

    const nextTransform = useTimelineStore.getState().clips[0]?.transform;
    expect(nextTransform?.rotation.y).toBe(90);
    const afterFrame = resolveOrbitCameraFrame(nextTransform!, settings, viewport);
    expect(afterFrame.eye.x).toBeCloseTo(beforeFrame.eye.x, 5);
    expect(afterFrame.eye.y).toBeCloseTo(beforeFrame.eye.y, 5);
    expect(afterFrame.eye.z).toBeCloseTo(beforeFrame.eye.z, 5);
    expect(afterFrame.forward.x).not.toBeCloseTo(beforeFrame.forward.x, 2);
  });

  it('writes camera look compensation as keyframes when editing an animated camera', async () => {
    const cameraSettings = { fov: 60, near: 0.1, far: 1000 };
    const transform = {
      position: { x: 0.2, y: 0.1, z: 4 },
      scale: { x: 1, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal' as const,
    };

    useTimelineStore.setState({
      playheadPosition: 1,
      clips: [
        {
          id: 'clip-midi-animated-camera-look',
          trackId: 'track-camera',
          startTime: 0,
          duration: 2,
          transform,
          source: {
            type: 'camera',
            cameraSettings,
          },
        },
      ],
      clipKeyframes: new Map([[
        'clip-midi-animated-camera-look',
        [
          { id: 'ry0', clipId: 'clip-midi-animated-camera-look', property: 'rotation.y', time: 0, value: 0, easing: 'linear' },
          { id: 'ry1', clipId: 'clip-midi-animated-camera-look', property: 'rotation.y', time: 2, value: 45, easing: 'linear' },
        ],
      ]]),
      keyframeRecordingEnabled: new Set(),
      updateDuration: vi.fn(),
      invalidateCache: vi.fn(),
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-animated-camera-look:rotation.y',
      clipId: 'clip-midi-animated-camera-look',
      property: 'rotation.y',
      label: 'Camera Yaw',
      min: 0,
      max: 90,
      currentValue: 0,
      message: {
        type: 'control-change',
        channel: 1,
        control: 12,
      },
    }, 127);

    const keyframes = useTimelineStore.getState().clipKeyframes.get('clip-midi-animated-camera-look') ?? [];
    expect(keyframes.some((keyframe) => keyframe.property === 'rotation.y' && keyframe.time === 1 && keyframe.value === 90)).toBe(true);
    expect(keyframes.some((keyframe) => keyframe.property === 'position.x' && keyframe.time === 1)).toBe(true);
    expect(keyframes.some((keyframe) => keyframe.property === 'position.y' && keyframe.time === 1)).toBe(true);
    expect(keyframes.some((keyframe) => keyframe.property === 'scale.z' && keyframe.time === 1)).toBe(true);
    expect(useTimelineStore.getState().clips[0]?.transform.position).toEqual(transform.position);
  });

  it('routes camera look MIDI to live overrides when camera keyframes are bypassed', async () => {
    const transform = {
      position: { x: 0.2, y: 0.1, z: 4 },
      scale: { x: 1, y: 1, z: 0 },
      rotation: { x: 0, y: 30, z: 0 },
      opacity: 1,
      blendMode: 'normal' as const,
    };
    const addKeyframe = vi.fn();
    const updateClipTransform = vi.fn();

    useEngineStore.setState({
      sceneNavNoKeyframes: true,
      sceneCameraLiveOverrides: {},
    });
    useTimelineStore.setState({
      playheadPosition: 1,
      clips: [
        {
          id: 'clip-midi-live-camera-look',
          trackId: 'track-camera',
          startTime: 0,
          duration: 2,
          transform,
          source: {
            type: 'camera',
            cameraSettings: { fov: 60, near: 0.1, far: 1000 },
          },
        },
      ],
      clipKeyframes: new Map([[
        'clip-midi-live-camera-look',
        [
          { id: 'ry0', clipId: 'clip-midi-live-camera-look', property: 'rotation.y', time: 0, value: 30, easing: 'linear' },
          { id: 'ry1', clipId: 'clip-midi-live-camera-look', property: 'rotation.y', time: 2, value: 60, easing: 'linear' },
        ],
      ]]),
      keyframeRecordingEnabled: new Set(),
      addKeyframe,
      updateClipTransform,
      updateDuration: vi.fn(),
      invalidateCache: vi.fn(),
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-live-camera-look:rotation.y',
      clipId: 'clip-midi-live-camera-look',
      property: 'rotation.y',
      label: 'Camera Yaw Override',
      min: -45,
      max: 45,
      currentValue: 0,
      message: {
        type: 'control-change',
        channel: 1,
        control: 13,
      },
    }, 127);

    expect(addKeyframe).not.toHaveBeenCalled();
    expect(updateClipTransform).not.toHaveBeenCalled();
    expect(useEngineStore.getState().sceneCameraLiveOverrides['clip-midi-live-camera-look']?.rotation?.y).toBe(45);
  });

  it('can drive mask parameters', async () => {
    useTimelineStore.setState({
      clips: [
        {
          id: 'clip-midi-mask',
          masks: [
            {
              id: 'mask-1',
              name: 'Mask 1',
              vertices: [],
              closed: true,
              opacity: 1,
              feather: 0,
              featherQuality: 50,
              inverted: false,
              mode: 'add',
              expanded: true,
              position: { x: 0, y: 0 },
              enabled: true,
              visible: true,
            },
          ],
        },
      ],
      invalidateCache: vi.fn(),
    } as Partial<ReturnType<typeof useTimelineStore.getState>>);

    await triggerMIDIParameterBinding({
      id: 'parameter:clip-midi-mask:mask.mask-1.position.x',
      clipId: 'clip-midi-mask',
      property: 'mask.mask-1.position.x',
      label: 'Mask Position X',
      min: -1,
      max: 1,
      currentValue: 0,
      message: {
        type: 'control-change',
        channel: 1,
        control: 10,
      },
    }, 127);

    expect(useTimelineStore.getState().clips[0]?.masks?.[0]?.position.x).toBe(1);
  });
});
