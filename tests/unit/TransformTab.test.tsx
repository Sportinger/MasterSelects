import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformTab } from '../../src/components/panels/properties/TransformTab';
import { KEYFRAME_RECORDING_FEEDBACK_EVENT } from '../../src/utils/keyframeRecordingFeedback';
import type { BlendMode } from '../../src/types/blendMode';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockState = vi.hoisted(() => ({
  sourceType: 'gaussian-splat',
  meshType: undefined as string | undefined,
  sourceWidth: 3840,
  sourceHeight: 2160,
  isPlaying: false,
  hasLinkedAudio: false,
  linkedAudioFollowsVideo: true,
  sceneNavNoKeyframes: false,
  setPropertyValue: vi.fn(),
  setClipSpeed: vi.fn(),
  setLinkedClipSpeedEnabled: vi.fn(),
  updateClipTransform: vi.fn(),
  toggle3D: vi.fn(),
  updateClip: vi.fn(),
  replaceClipSource: vi.fn(() => true),
  replaceClipSourceWithComposition: vi.fn(() => true),
  setTimelineState: vi.fn(),
  isRecording: vi.fn(() => false),
  hasKeyframes: vi.fn(() => false),
  addKeyframe: vi.fn(),
  toggleKeyframeRecording: vi.fn(),
  disablePropertyKeyframes: vi.fn(),
  cameraSettings: { fov: 60, near: 0.1, far: 1000 },
}));

vi.mock('../../src/stores/timeline', () => {
  const buildClip = () => mockState.sourceType === 'restoring-video' ? {
    id: 'clip-1',
    source: null,
    mediaFileId: 'media-1',
    wireframe: false,
  } : ({
    id: 'clip-1',
    source: {
      type: mockState.sourceType,
      ...(mockState.meshType ? { meshType: mockState.meshType } : {}),
      threeDEffectorsEnabled: true,
      ...(mockState.sourceType === 'video' || mockState.sourceType === 'image'
        ? { mediaFileId: 'media-1' }
        : {}),
      ...(mockState.sourceType === 'camera'
        ? { cameraSettings: mockState.cameraSettings }
        : {}),
    },
    ...(mockState.hasLinkedAudio ? { linkedClipId: 'audio-1' } : {}),
    wireframe: false,
  });
  const buildClips = () => [
    buildClip(),
    ...(mockState.hasLinkedAudio ? [{
      id: 'audio-1',
      source: { type: 'audio' },
      linkedClipId: 'clip-1',
      followsLinkedVideoSpeed: mockState.linkedAudioFollowsVideo ? undefined : false,
    }] : []),
  ];

  const useTimelineStore = Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector({
      clips: buildClips(),
      isPlaying: mockState.isPlaying,
      replaceClipSource: mockState.replaceClipSource,
      replaceClipSourceWithComposition: mockState.replaceClipSourceWithComposition,
    })),
    {
      getState: vi.fn(() => ({
        clips: buildClips(),
        setPropertyValue: mockState.setPropertyValue,
        setClipSpeed: mockState.setClipSpeed,
        setLinkedClipSpeedEnabled: mockState.setLinkedClipSpeedEnabled,
        updateClipTransform: mockState.updateClipTransform,
        toggle3D: mockState.toggle3D,
        updateClip: mockState.updateClip,
        replaceClipSource: mockState.replaceClipSource,
        isRecording: mockState.isRecording,
        hasKeyframes: mockState.hasKeyframes,
        addKeyframe: mockState.addKeyframe,
        toggleKeyframeRecording: mockState.toggleKeyframeRecording,
        disablePropertyKeyframes: mockState.disablePropertyKeyframes,
      })),
      setState: mockState.setTimelineState,
    },
  );

  return { useTimelineStore };
});

vi.mock('../../src/stores/mediaStore', () => {
  const mediaState = {
      getActiveComposition: () => ({ width: 1920, height: 1080 }),
      files: [{
        id: 'media-1',
        name: 'Current Source.mp4',
        type: 'video',
        width: mockState.sourceWidth,
        height: mockState.sourceHeight,
      }],
      compositions: [],
  };
  return {
    DEFAULT_SCENE_CAMERA_SETTINGS: { fov: 60, near: 0.1, far: 1000 },
    useMediaStore: Object.assign(
      vi.fn((selector: (state: typeof mediaState) => unknown) => selector(mediaState)),
      { getState: vi.fn(() => mediaState) },
    ),
  };
});

vi.mock('../../src/stores/engineStore', () => {
  const engineState = {
    sceneNavFpsMode: false,
    sceneNavFpsMoveSpeed: 1,
    sceneNavTouchControlsOverride: null,
    get sceneNavNoKeyframes() {
      return mockState.sceneNavNoKeyframes;
    },
    setSceneNavFpsMode: vi.fn(),
    setSceneNavFpsMoveSpeed: vi.fn(),
    setSceneNavNoKeyframes: vi.fn(),
    setSceneNavTouchControlsOverride: vi.fn(),
  };

  return {
    SCENE_NAV_FPS_MOVE_SPEED_STEPS: [0.25, 0.5, 1, 2],
    getSceneNavFpsMoveSpeedStepIndex: () => 2,
    resolveSceneNavTouchControlsVisible: (override: boolean | null | undefined, mobile: boolean) => override ?? mobile,
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
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    useSettingsStore.setState({ theme: 'dark' });
    mockState.sourceType = 'gaussian-splat';
    mockState.meshType = undefined;
    mockState.isPlaying = false;
    mockState.hasLinkedAudio = false;
    mockState.linkedAudioFollowsVideo = true;
    mockState.sceneNavNoKeyframes = false;
    mockState.setPropertyValue.mockClear();
    mockState.setClipSpeed.mockClear();
    mockState.setLinkedClipSpeedEnabled.mockClear();
    mockState.updateClipTransform.mockClear();
    mockState.setTimelineState.mockClear();
    mockState.toggle3D.mockClear();
    mockState.updateClip.mockClear();
    mockState.replaceClipSource.mockClear();
    mockState.replaceClipSource.mockImplementation(() => true);
    mockState.replaceClipSourceWithComposition.mockClear();
    mockState.replaceClipSourceWithComposition.mockImplementation(() => true);
    mockState.isRecording.mockClear();
    mockState.hasKeyframes.mockClear();
    mockState.isRecording.mockImplementation(() => false);
    mockState.hasKeyframes.mockImplementation(() => false);
    mockState.addKeyframe.mockClear();
    mockState.toggleKeyframeRecording.mockClear();
    mockState.disablePropertyKeyframes.mockClear();
    mockState.cameraSettings = { fov: 60, near: 0.1, far: 1000 };
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

    const positionXControl = container.querySelector(
      '[data-guided-property="position.x"] .draggable-number',
    ) as HTMLElement;
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

    expect(numberTexts(container)).toContain('480.000');
    expect(numberTexts(container)).toContain('-135.000');

    const positionXControl = container.querySelector(
      '[data-guided-property="position.x"] .draggable-number',
    ) as HTMLElement;
    fireEvent.doubleClick(positionXControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '960' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'position.x', 1);
  });

  it('shows the current video source and accepts a replacement media drop', () => {
    mockState.sourceType = 'video';
    const { getByRole, getByText } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );
    const source = getByRole('group', { name: 'Video source: Current Source.mp4' });
    const dataTransfer = {
      dropEffect: 'none',
      getData: (type: string) => type === 'application/x-media-file-id' ? 'media-2' : '',
      types: ['application/x-media-file-id'],
    };

    fireEvent.dragOver(source, { dataTransfer });
    expect(source).toHaveClass('is-drag-active');
    fireEvent.drop(source, { dataTransfer });

    expect(mockState.replaceClipSource).toHaveBeenCalledWith('clip-1', 'media-2');
    expect(getByText('Source replaced')).toBeInTheDocument();
    expect(source).not.toHaveClass('is-drag-active');
  });

  it('highlights the replacement drop zone when the source name is activated', () => {
    vi.useFakeTimers();
    mockState.sourceType = 'video';
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );
    const source = getByRole('group', { name: 'Video source: Current Source.mp4' });
    const sourceName = getByRole('button', {
      name: 'Show replacement drop zone for Current Source.mp4',
    });

    fireEvent.click(sourceName);
    expect(source).toHaveClass('is-drop-hint-active');
    expect(getByRole('group', { name: 'Video source: Current Source.mp4' }))
      .toHaveTextContent('DROP');

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(source).not.toHaveClass('is-drop-hint-active');

    fireEvent.pointerDown(sourceName, { pointerType: 'touch' });
    expect(source).toHaveClass('is-drop-hint-active');
  });

  it('accepts clip speed values up to the native 1000 percent limit', () => {
    mockState.sourceType = 'video';
    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
        speed={1}
      />,
    );

    const speedControl = Array.from(container.querySelectorAll('.draggable-number'))
      .find((element) => element.textContent === '100%') as HTMLElement;
    fireEvent.doubleClick(speedControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setClipSpeed).toHaveBeenCalledWith('clip-1', 10);
  });

  it('accepts negative speed values for reverse playback and ramps', () => {
    mockState.sourceType = 'video';
    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
        speed={1}
      />,
    );

    const speedControl = Array.from(container.querySelectorAll('.draggable-number'))
      .find((element) => element.textContent === '100%') as HTMLElement;
    fireEvent.doubleClick(speedControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-200' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setClipSpeed).toHaveBeenCalledWith('clip-1', -2);
  });

  it('shows an enabled linked-audio speed toggle for imported video pairs', () => {
    mockState.sourceType = 'video';
    mockState.hasLinkedAudio = true;
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
        speed={1}
      />,
    );

    const toggle = getByRole('button', { name: 'Linked Audio' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(mockState.setLinkedClipSpeedEnabled).toHaveBeenCalledWith('clip-1', false);
  });

  it('uses compact 2D/3D and free-run toggle buttons', () => {
    mockState.sourceType = 'video';
    const { getAllByRole, getByRole, queryByText } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    expect(queryByText('3D Layer')).not.toBeInTheDocument();
    const dimensionToggle = getByRole('button', { name: 'Layer Mode: Switch to 3D layer' });
    expect(dimensionToggle).toHaveAttribute('aria-pressed', 'false');
    expect(getAllByRole('button', { name: /Switch to 3D layer/ })).toHaveLength(1);
    fireEvent.click(dimensionToggle);
    expect(mockState.toggle3D).toHaveBeenCalledWith('clip-1');

    const freeRunToggle = getByRole('button', { name: 'Playback Mode: Switch to Free Run' });
    expect(freeRunToggle).toHaveAttribute('aria-pressed', 'false');
    expect(freeRunToggle).toHaveTextContent('LockFree');
    fireEvent.click(freeRunToggle);
    expect(mockState.updateClip).toHaveBeenCalledWith('clip-1', { freeRun: true });
  });

  it('keeps the video inspector for a video clip whose source is still restoring', () => {
    mockState.sourceType = 'restoring-video';
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    expect(getByRole('group', { name: 'Video source: Current Source.mp4' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Playback Mode: Switch to Free Run' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Layer Mode: Switch to 3D layer' })).toBeInTheDocument();
  });

  it('renders the Resolve transform section as a collapsible inspector group', () => {
    mockState.sourceType = 'video';
    const { getByRole, getByText, queryByText } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const disclosure = getByRole('button', { name: 'Transform', exact: true });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(getByText('Anchor Point').closest('.resolve-inspector-row')).not.toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Zoom')).not.toBeInTheDocument();
  });

  it('persists Resolve inspector section bypasses without resetting their values', () => {
    mockState.sourceType = 'video';
    useSettingsStore.setState({ theme: 'resolve' });
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0.5, y: -0.25, z: 0 })}
      />,
    );

    const transformSwitch = getByRole('switch', { name: 'Disable Transform' });
    expect(transformSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(transformSwitch);

    expect(mockState.updateClip).toHaveBeenCalledWith('clip-1', {
      videoInspectorSections: { transform: false },
    });
    expect(mockState.updateClipTransform).not.toHaveBeenCalled();
    expect(mockState.setPropertyValue).not.toHaveBeenCalled();
  });

  it('keeps the working 3D toggle in Resolve and omits unimplemented video sections', () => {
    mockState.sourceType = 'video';
    useSettingsStore.setState({ theme: 'resolve' });
    const { getByRole, queryByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const dimensionToggle = getByRole('button', { name: 'Layer Mode: Switch to 3D layer' });
    expect(dimensionToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(dimensionToggle);
    expect(mockState.toggle3D).toHaveBeenCalledWith('clip-1');
    expect(queryByRole('button', { name: 'Smart Reframe' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Dynamic Zoom' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Lens Correction' })).not.toBeInTheDocument();
    const stabilization = getByRole('button', { name: 'Stabilization' });
    expect(stabilization).toBeDisabled();
    expect(stabilization).toHaveAttribute('aria-expanded', 'false');
    expect(stabilization.closest('.resolve-inspector-section')).toHaveClass('is-disabled');
  });

  it('groups video composite controls in the standard theme and writes mode, opacity, and reset changes', () => {
    mockState.sourceType = 'video';
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={{
          ...makeTransform({ x: 0, y: 0, z: 0 }),
          blendMode: 'screen',
          opacity: 0.75,
        }}
      />,
    );

    const disclosure = getByRole('button', { name: 'Composite', exact: true });
    const section = disclosure.closest('.resolve-inspector-section') as HTMLElement;
    const composite = within(section);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const compositeMode = composite.getByRole('combobox', { name: 'Composite Mode' });
    expect(compositeMode).toHaveTextContent('Screen');
    expect(getByRole('button', { name: 'Speed Change', exact: true })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(compositeMode);
    fireEvent.click(composite.getByRole('option', { name: 'Multiply' }));
    expect(mockState.updateClipTransform).toHaveBeenCalledWith('clip-1', { blendMode: 'multiply' });

    const opacityValue = section.querySelector('.draggable-number') as HTMLElement;
    fireEvent.doubleClick(opacityValue);
    const opacityInput = section.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(opacityInput, { target: { value: '40' } });
    fireEvent.keyDown(opacityInput, { key: 'Enter' });
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'opacity', 0.4);

    fireEvent.click(composite.getByRole('button', { name: 'Reset composite' }));
    expect(mockState.updateClipTransform).toHaveBeenCalledWith('clip-1', {
      blendMode: 'normal',
    });
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'opacity', 1);
  });

  it('uses the shared visual inspector modules for image clips', () => {
    mockState.sourceType = 'image';
    const { container, getByRole, queryByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    expect(getByRole('button', { name: 'Transform', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Composite', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cropping', exact: true })).toBeInTheDocument();
    expect(getByRole('combobox', { name: 'Composite Mode' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Layer Mode: Switch to 3D layer' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Speed Change', exact: true })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Stabilization', exact: true })).not.toBeInTheDocument();
    expect(container.querySelector('.transform-options-section')).toBeNull();
  });

  it('uses the shared visual inspector modules for normal text clips', () => {
    mockState.sourceType = 'text';
    const { container, getByRole, queryByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    expect(getByRole('button', { name: 'Transform', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Composite', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cropping', exact: true })).toBeInTheDocument();
    expect(getByRole('combobox', { name: 'Composite Mode' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Layer Mode: Switch to 3D layer' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Speed Change', exact: true })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Stabilization', exact: true })).not.toBeInTheDocument();
    expect(container.querySelector('.transform-options-section')).toBeNull();
  });

  it('uses shared sections for 3D text transform and keeps 3D-only controls', () => {
    mockState.sourceType = 'model';
    mockState.meshType = 'text3d';
    const { container, getByRole, queryByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    expect(getByRole('button', { name: '3D Options', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Wireframe' })).toHaveTextContent('Off');
    expect(getByRole('button', { name: '3D Effector' })).toHaveTextContent('On');
    expect(getByRole('button', { name: 'Transform', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Composite', exact: true })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cropping', exact: true })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Speed Change', exact: true })).not.toBeInTheDocument();
    expect(container.querySelector('.transform-options-section')).toBeNull();
  });

  it('keys and resets every property in the Transform group together', () => {
    mockState.sourceType = 'video';
    const { getByRole, getByTitle } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0.25, y: -0.5, z: 0 })}
      />,
    );

    const groupKeyframe = getByTitle('Add transform keyframes');
    fireEvent.pointerDown(groupKeyframe, { button: 0, buttons: 1, pointerId: 41 });
    fireEvent.pointerUp(window, { pointerId: 41 });

    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'position.x', 0.25);
    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'position.y', -0.5);
    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'rotation.z', 0);
    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'scale.x', 1);
    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'scale.y', 1);

    fireEvent.click(getByRole('button', { name: 'Reset transform' }));

    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'position.x', 0);
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'position.y', 0);
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'rotation.z', 0);
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'scale.x', 1);
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'scale.y', 1);
  });

  it('exposes grouped Speed keyframe and reset actions in the standard theme', () => {
    mockState.sourceType = 'video';
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        speed={2}
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const speedSection = getByRole('button', { name: 'Speed Change', exact: true })
      .closest('.resolve-inspector-section') as HTMLElement;
    expect(speedSection.querySelector('.resolve-inspector-header-actions .keyframe-toggle'))
      .toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Reset speed' }));
    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'speed', 1);
  });

  it('links Resolve zoom axes by default and supports independent editing', () => {
    mockState.sourceType = 'video';
    const { container, getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const zoomX = container.querySelector(
      '[data-guided-property="scale.x"] .draggable-number',
    ) as HTMLElement;
    fireEvent.doubleClick(zoomX);
    let input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.25' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.x', 1.25);
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.y', 1.25);

    mockState.setPropertyValue.mockClear();
    fireEvent.click(getByRole('button', { name: 'Unlink zoom axes' }));
    const zoomY = container.querySelector(
      '[data-guided-property="scale.y"] .draggable-number',
    ) as HTMLElement;
    fireEvent.doubleClick(zoomY);
    input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.75' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.y', 0.75);
    expect(mockState.setPropertyValue).not.toHaveBeenCalledWith('clip-1', 'scale.x', 0.75);
  });

  it('accepts negative X and Y scale values for mirrored clips', () => {
    mockState.sourceType = 'video';
    const { container, getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Unlink zoom axes' }));

    const scaleXValue = container.querySelector(
      '[data-guided-property="scale.x"] .draggable-number',
    ) as HTMLElement;
    fireEvent.doubleClick(scaleXValue);
    let input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-1.25' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const scaleYValue = container.querySelector(
      '[data-guided-property="scale.y"] .draggable-number',
    ) as HTMLElement;
    fireEvent.doubleClick(scaleYValue);
    input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-0.75' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.x', -1.25);
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.y', -0.75);
  });

  it('runs neutral horizontal and vertical flip actions while preserving scale magnitude', () => {
    mockState.sourceType = 'video';
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={{
          ...makeTransform({ x: 0, y: 0, z: 0 }),
          scale: { x: 1.25, y: -0.5, z: 1 },
        }}
      />,
    );

    const horizontalFlip = getByRole('button', { name: 'Flip horizontal' });
    const verticalFlip = getByRole('button', { name: 'Flip vertical' });

    expect(horizontalFlip).not.toHaveAttribute('aria-pressed');
    expect(verticalFlip).not.toHaveAttribute('aria-pressed');

    fireEvent.click(horizontalFlip);
    fireEvent.click(verticalFlip);

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.x', -1.25);
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.y', 0.5);
  });

  it('fits explicitly while keeping 100 percent reserved for native source pixels', () => {
    mockState.sourceType = 'video';
    mockState.sourceWidth = 3840;
    mockState.sourceHeight = 2160;
    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Fit source to composition' }));

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.all', 1);
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.x', 0.5);
    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'scale.y', 0.5);
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

  it('groups all three 3D anchor axes in one inspector row', () => {
    mockState.sourceType = 'gaussian-splat';
    const { getByText } = render(
      <TransformTab
        clipId="clip-1"
        transform={{
          ...makeTransform({ x: 0, y: 0, z: 0 }),
          anchor: { x: 0.1, y: -0.2, z: 0.3 },
        }}
      />,
    );

    const row = getByText('Anchor Point').closest('.resolve-inspector-row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByLabelText('Anchor X')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByLabelText('Anchor Y')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByLabelText('Anchor Z')).toBeInTheDocument();
    expect(row?.querySelector('.resolve-inspector-values--triple')).toBeInTheDocument();
  });

  it('groups camera controls in the properties inspector without a separate resolution', () => {
    mockState.sourceType = 'camera';

    const { container, getByRole, queryByRole, queryByText } = render(
      <TransformTab
        clipId="clip-1"
        transform={{
          ...makeTransform({ x: 0, y: 0, z: 5 }),
          scale: { all: 1, x: 1, y: 1, z: 0 },
        }}
      />,
    );

    const text = container.textContent ?? '';
    expect(getByRole('button', { name: 'Navigation' })).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('button', { name: 'Lens' })).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('button', { name: 'Clipping Planes' })).toHaveAttribute('aria-expanded', 'false');
    expect(getByRole('button', { name: 'Transform' })).toHaveAttribute('aria-expanded', 'true');
    expect(queryByRole('button', { name: 'Reset camera transform' })).not.toBeInTheDocument();
    expect(queryByRole('button', {
      name: 'Enable all camera transform stopwatches and set keyframes at the playhead',
    })).not.toBeInTheDocument();
    const keyframeModeButton = getByRole('button', {
      name: 'Live camera override: MIDI and scene-nav controls do not write camera keyframes',
    });
    expect(getByRole('button', { name: 'Orbit camera navigation' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'FPS camera navigation' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: 'Show FPS touch controls on Preview' })).toHaveAttribute('aria-pressed', 'false');
    expect(queryByRole('button', { name: /FPS mouse look/i })).not.toBeInTheDocument();
    expect(getByRole('slider', { name: 'Camera movement speed' })).toBeInTheDocument();
    expect(keyframeModeButton).toHaveAttribute('aria-pressed', 'false');
    expect(keyframeModeButton).toHaveClass('resolve-camera-keyframe-mode-button');
    expect(keyframeModeButton.closest('.resolve-inspector-row-actions')).toBeInTheDocument();
    expect(keyframeModeButton.querySelector('.scene-nav-keyframe-strike')).not.toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Reset lens' }));
    expect(mockState.disablePropertyKeyframes)
      .toHaveBeenCalledWith('clip-1', 'camera.fov', 60);
    expect(text).toContain('Lens');
    expect(text).toContain('Field of View');
    expect(text).toContain('mm');
    expect(text).toContain('Clipping Planes');
    expect(queryByText('Resolution')).not.toBeInTheDocument();
    expect(queryByText('Res')).not.toBeInTheDocument();
    expect(text).not.toContain('Zoom');

    const values = numberTexts(container);
    expect(values.some((value) => value.includes('60.0deg'))).toBe(true);
    expect(values.some((value) => value.includes('20.8mm'))).toBe(true);
    expect(values.some((value) => value.includes('100.0%'))).toBe(false);

    const fovControl = container.querySelectorAll('.draggable-number')[0];
    fireEvent.doubleClick(fovControl);
    const input = container.querySelector('input.draggable-number-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockState.setPropertyValue).toHaveBeenCalledWith('clip-1', 'camera.fov', 45);

    fireEvent.click(getByRole('button', { name: 'Clipping Planes' }));
    expect(queryByText('Near')).toBeInTheDocument();
    expect(queryByText('Far')).toBeInTheDocument();
  });

  it('marks the active live camera override red and crossed out', () => {
    mockState.sourceType = 'camera';
    mockState.sceneNavNoKeyframes = true;

    const { getByRole } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 5 })}
      />,
    );

    const keyframeModeButton = getByRole('button', {
      name: 'Live camera override: MIDI and scene-nav controls do not write camera keyframes',
    });
    expect(keyframeModeButton).toHaveAttribute('aria-pressed', 'true');
    expect(keyframeModeButton).toHaveClass('is-active');
    expect(keyframeModeButton.querySelector('.scene-nav-keyframe-strike')).toBeInTheDocument();
  });

  it('left-clicking an active stopwatch adds a keyframe instead of disabling it', () => {
    mockState.isRecording.mockImplementation(() => true);

    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const stopwatch = container.querySelector('.keyframe-toggle') as HTMLButtonElement;
    fireEvent.pointerDown(stopwatch, { button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(mockState.addKeyframe).toHaveBeenCalledWith('clip-1', 'opacity', 1);
    expect(mockState.disablePropertyKeyframes).not.toHaveBeenCalled();
  });

  it('right-clicking a stopwatch disables its keyframes', () => {
    mockState.isRecording.mockImplementation(() => true);

    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const stopwatch = container.querySelector('.keyframe-toggle') as HTMLButtonElement;
    fireEvent.contextMenu(stopwatch);

    expect(mockState.disablePropertyKeyframes).toHaveBeenCalledWith('clip-1', 'opacity', 1);
    expect(mockState.addKeyframe).not.toHaveBeenCalled();
  });

  it('shows stopwatch feedback while playback writes a keyed value', () => {
    vi.useFakeTimers();
    mockState.hasKeyframes.mockImplementation((_, property: string) => property === 'opacity');

    const { container } = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    const stopwatch = container.querySelector('.keyframe-toggle') as HTMLButtonElement;
    expect(stopwatch).not.toHaveClass('recording-feedback');

    act(() => {
      window.dispatchEvent(new CustomEvent(KEYFRAME_RECORDING_FEEDBACK_EVENT, {
        detail: { clipId: 'clip-1', property: 'opacity' },
      }));
    });

    expect(stopwatch).toHaveClass('recording-feedback');

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(stopwatch).not.toHaveClass('recording-feedback');
  });

  it('shows stopwatch feedback when playback changes the displayed keyed value', () => {
    vi.useFakeTimers();
    mockState.isPlaying = true;
    mockState.hasKeyframes.mockImplementation((_, property: string) => property === 'opacity');

    const view = render(
      <TransformTab
        clipId="clip-1"
        transform={makeTransform({ x: 0, y: 0, z: 0 })}
      />,
    );

    let stopwatch = view.container.querySelector('.keyframe-toggle') as HTMLButtonElement;
    expect(stopwatch).not.toHaveClass('recording-feedback');

    view.rerender(
      <TransformTab
        clipId="clip-1"
        transform={{
          ...makeTransform({ x: 0, y: 0, z: 0 }),
          opacity: 0.5,
        }}
      />,
    );

    stopwatch = view.container.querySelector('.keyframe-toggle') as HTMLButtonElement;
    expect(stopwatch).toHaveClass('recording-feedback');

    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(stopwatch).not.toHaveClass('recording-feedback');
  });
});
