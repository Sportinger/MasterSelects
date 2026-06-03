import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CLIP_INTERACTION_SHELL_MODULE_SLOTS,
  CLIP_INTERACTION_SHELL_PARITY_MATRIX,
  CLIP_INTERACTION_SHELL_PARITY_STATES,
  ClipInteractionShell,
  getClipInteractionShellActiveSlots,
  type ClipInteractionShellActiveModules,
  type ClipInteractionShellProps,
  type ClipInteractionShellRect,
} from '../../src/components/timeline/interactionShell';
import { useTimelineStore } from '../../src/stores/timeline';

const rect = (overrides: Partial<ClipInteractionShellRect> = {}): ClipInteractionShellRect => ({
  x: 0,
  y: 0,
  width: 120,
  height: 48,
  ...overrides,
});

function createShellProps(overrides: Partial<ClipInteractionShellProps> = {}): ClipInteractionShellProps {
  return {
    clip: {
      id: 'clip-a',
      trackId: 'track-video',
      name: 'Clip A',
      startTime: 1,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'video' },
    },
    track: {
      id: 'track-video',
      type: 'video',
      locked: false,
      muted: false,
      visible: true,
    },
    geometry: {
      clip: rect({ x: 40, y: 8, width: 160 }),
      visibleClip: rect({ x: 40, y: 8, width: 160 }),
      track: rect({ width: 800, height: 64 }),
      viewport: rect({ width: 800, height: 64 }),
      trimHandles: { left: rect({ width: 8 }), right: rect({ x: 152, width: 8 }) },
      fadeHandles: { left: rect({ width: 10 }), right: rect({ x: 150, width: 10 }) },
      keyframeRows: [],
    },
    mountState: {
      clipId: 'clip-a',
      shouldMount: true,
      reasons: ['fade', 'context-menu-open', 'tool-preview'],
      isFading: true,
      hasOpenContextMenu: true,
      hasToolPreview: true,
    },
    activeModules: {
      fade: {
        slot: 'fade',
        enabled: true,
        state: null,
        activeEdges: ['left'],
        previewDurationSeconds: 0.4,
        fadeInDuration: 0.4,
        fadeOutDuration: 0,
        curveKeyframes: [
          { id: 'fade-start', time: 0, value: 0, easing: 'linear' },
          { id: 'fade-end', time: 0.4, value: 1, easing: 'linear' },
        ],
        curveKey: 'fade-start:0|fade-end:0.4',
        clipDuration: 4,
        isAudioClip: false,
      },
      contextMenu: {
        slot: 'context-menu',
        enabled: true,
        state: { x: 80, y: 24, clipId: 'clip-a' },
        isOpen: true,
      },
      toolPreview: {
        slot: 'tool-preview',
        enabled: true,
        toolId: 'select',
        label: 'Select',
      },
    },
    ...overrides,
  };
}

describe('ClipInteractionShell contract', () => {
  it('defines the Phase 0 active module slots in stable render order', () => {
    expect(CLIP_INTERACTION_SHELL_MODULE_SLOTS).toEqual([
      'trim',
      'fade',
      'keyframe',
      'audio-region',
      'spectral-region',
      'video-bake',
      'stem',
      'context-menu',
      'tool-preview',
    ]);
  });

  it('defines the selected/open/fade/keyframe/audio/spectral/video/stem parity states', () => {
    expect(CLIP_INTERACTION_SHELL_PARITY_STATES).toEqual([
      'selected',
      'open-context-menu',
      'fade',
      'keyframe',
      'audio-region',
      'spectral-region',
      'video-bake',
      'stem',
    ]);

    const casesByState = new Map(CLIP_INTERACTION_SHELL_PARITY_MATRIX.map((entry) => [entry.state, entry]));

    expect(casesByState.get('selected')).toMatchObject({
      shouldMount: false,
      expectedSlots: [],
    });
    expect(casesByState.get('open-context-menu')?.expectedSlots).toEqual(['context-menu']);
    expect(casesByState.get('fade')?.expectedSlots).toEqual(['fade']);
    expect(casesByState.get('keyframe')?.expectedSlots).toEqual(['keyframe']);
    expect(casesByState.get('audio-region')?.expectedSlots).toEqual(['audio-region']);
    expect(casesByState.get('spectral-region')?.expectedSlots).toEqual(['spectral-region']);
    expect(casesByState.get('video-bake')?.expectedSlots).toEqual(['video-bake']);
    expect(casesByState.get('stem')?.expectedSlots).toEqual(['stem']);
  });

  it('resolves enabled module slots without selected-only DOM mounting', () => {
    const activeModules: ClipInteractionShellActiveModules = {
      keyframe: {
        slot: 'keyframe',
        enabled: true,
        keyframes: [],
        keyframeGroups: [],
        selectedKeyframeIds: ['kf-a'],
      },
      audioRegion: {
        slot: 'audio-region',
        enabled: true,
        selection: null,
        mode: 'select',
      },
      stem: {
        slot: 'stem',
        enabled: false,
        stemState: null,
      },
    };

    expect(getClipInteractionShellActiveSlots(activeModules)).toEqual(['keyframe', 'audio-region']);
  });

  it('renders a lightweight shell scaffold with built-in fade controls and remaining placeholders', () => {
    const { container } = render(<ClipInteractionShell {...createShellProps()} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-a');
    expect(shell?.dataset.activeSlots).toBe('fade context-menu tool-preview');
    expect(container.querySelectorAll('.shell-fade-handle')).toHaveLength(2);
    expect(container.querySelector('[data-shell-fade-curve="true"]')).toBeTruthy();

    const slots = Array.from(container.querySelectorAll<HTMLElement>('[data-clip-interaction-slot]'))
      .map((node) => node.dataset.clipInteractionSlot);
    expect(slots).toEqual(['context-menu', 'tool-preview']);
  });

  it('passes typed command context through root callbacks', () => {
    const onRootMouseDown = vi.fn();
    const props = createShellProps({
      commands: { onRootMouseDown },
    });
    const { container } = render(<ClipInteractionShell {...props} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    fireEvent.mouseDown(shell as HTMLElement);

    expect(onRootMouseDown).toHaveBeenCalledTimes(1);
    expect(onRootMouseDown.mock.calls[0][1].clip.id).toBe('clip-a');
    expect(onRootMouseDown.mock.calls[0][1].activeModules.fade?.slot).toBe('fade');
  });

  it('renders active trim handles and dispatches trim commands with edge context', () => {
    const onTrimStart = vi.fn();
    const props = createShellProps({
      geometry: {
        ...createShellProps().geometry,
        clip: rect({ x: 40, y: 8, width: 160 }),
        trimHandles: {
          left: rect({ x: 36, y: 8, width: 8, height: 56 }),
          right: rect({ x: 196, y: 8, width: 8, height: 56 }),
        },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['trim'],
        isTrimming: true,
      },
      activeModules: {
        trim: {
          slot: 'trim',
          enabled: true,
          state: null,
          activeEdges: ['left'],
        },
      },
      commands: { onTrimStart },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const left = container.querySelector<HTMLElement>('.shell-trim-handle.left');
    const right = container.querySelector<HTMLElement>('.shell-trim-handle.right');

    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left?.dataset.shellTrimEdge).toBe('left');
    expect(right?.dataset.shellTrimEdge).toBe('right');
    expect(left?.style.left).toBe('-4px');
    expect(right?.style.left).toBe('156px');
    expect(container.querySelectorAll('.trim-handle-arrow')).toHaveLength(2);

    fireEvent.mouseDown(right as HTMLElement, { button: 0 });

    expect(onTrimStart).toHaveBeenCalledTimes(1);
    expect(onTrimStart.mock.calls[0][1].clip.id).toBe('clip-a');
    expect(onTrimStart.mock.calls[0][2]).toBe('right');
  });

  it('renders active fade handles and dispatches fade commands with edge context', () => {
    const onFadeStart = vi.fn();
    const props = createShellProps({
      geometry: {
        ...createShellProps().geometry,
        clip: rect({ x: 40, y: 8, width: 160 }),
        fadeHandles: {
          left: rect({ x: 40, y: 8, width: 12, height: 12 }),
          right: rect({ x: 188, y: 8, width: 12, height: 12 }),
        },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['fade'],
        isFading: true,
      },
      activeModules: {
        fade: {
          slot: 'fade',
          enabled: true,
          state: null,
          activeEdges: ['right'],
          fadeInDuration: 1,
          fadeOutDuration: 0.5,
          curveKeyframes: [
            { id: 'fade-start', time: 0, value: 0, easing: 'linear' },
            { id: 'fade-mid', time: 1, value: 1, easing: 'linear' },
            { id: 'fade-end', time: 4, value: 0, easing: 'linear' },
          ],
          curveKey: 'fade-start:0|fade-mid:1|fade-end:4',
          clipDuration: 4,
          isAudioClip: false,
        },
      },
      commands: { onFadeStart },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const left = container.querySelector<HTMLElement>('.shell-fade-handle.left');
    const right = container.querySelector<HTMLElement>('.shell-fade-handle.right');

    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left?.dataset.shellFadeEdge).toBe('left');
    expect(right?.dataset.shellFadeEdge).toBe('right');
    expect(left?.style.left).toBe('0px');
    expect(right?.style.right).toBe('0px');
    expect(right?.classList.contains('active')).toBe(true);
    expect(container.querySelector('.fade-curve-svg')).toBeTruthy();

    fireEvent.mouseDown(left as HTMLElement, { button: 0 });

    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFadeStart.mock.calls[0][1].clip.id).toBe('clip-a');
    expect(onFadeStart.mock.calls[0][2]).toBe('left');
  });

  it('renders active keyframe ticks and dispatches grouped keyframe moves', () => {
    const onMoveKeyframeGroup = vi.fn();
    const props = createShellProps({
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['selected-keyframes'],
        hasVisibleKeyframes: true,
      },
      activeModules: {
        keyframe: {
          slot: 'keyframe',
          enabled: true,
          activeProperty: 'opacity',
          keyframes: [
            {
              id: 'kf-a',
              clipId: 'clip-a',
              time: 1,
              property: 'opacity',
              value: 0.5,
              easing: 'linear',
            },
          ],
          keyframeGroups: [
            {
              time: 1,
              keyframeIds: ['kf-a'],
              properties: ['opacity'],
            },
          ],
          selectedKeyframeIds: ['kf-a'],
        },
      },
      commands: { onMoveKeyframeGroup },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const tick = container.querySelector<HTMLElement>('.keyframe-tick');

    expect(shell?.dataset.activeSlots).toBe('keyframe');
    expect(tick).toBeTruthy();
    expect(tick?.style.left).toBe('25%');

    fireEvent.mouseDown(tick as HTMLElement, { button: 0, clientX: 40 });
    fireEvent.mouseMove(document, { clientX: 80 });
    fireEvent.mouseUp(document);

    expect(onMoveKeyframeGroup).toHaveBeenCalledTimes(1);
    expect(onMoveKeyframeGroup.mock.calls[0][0]).toEqual(['kf-a']);
    expect(onMoveKeyframeGroup.mock.calls[0][1]).toBeCloseTo(2);
    expect(onMoveKeyframeGroup.mock.calls[0][2].clip.id).toBe('clip-a');
  });

  it('renders active audio-region visuals through the shell module', () => {
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        source: { type: 'audio' },
        audioState: {
          editStack: [
            {
              id: 'gain-op',
              type: 'gain',
              enabled: true,
              timeRange: { start: 1, end: 3 },
              params: { gainDb: -6, fadeInSeconds: 0.2, fadeOutSeconds: 0.3 },
              createdAt: 1,
            },
          ],
        },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['audio-region-active'],
        hasActiveAudioRegion: true,
      },
      activeModules: {
        audioRegion: {
          slot: 'audio-region',
          enabled: true,
          selection: {
            clipId: 'clip-a',
            trackId: 'track-video',
            startTime: 2,
            endTime: 4,
            sourceInPoint: 1,
            sourceOutPoint: 3,
          },
          mode: 'select',
        },
      },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const module = container.querySelector<HTMLElement>('.shell-audio-region-module');
    const selection = container.querySelector<HTMLElement>('.clip-audio-region-selection');
    const gainValue = container.querySelector<HTMLElement>('.clip-audio-region-gain-value');

    expect(shell?.dataset.activeSlots).toBe('audio-region');
    expect(module?.dataset.clipInteractionSlot).toBe('audio-region');
    expect(selection).toBeTruthy();
    expect(selection?.classList.contains('read-only')).toBe(false);
    expect(selection?.style.left).toBe('40px');
    expect(selection?.style.width).toBe('80px');
    expect(gainValue?.textContent).toBe('-6.0 dB');
  });

  it('moves active audio regions from the shell selection geometry', () => {
    const setAudioRegionSelectionSpy = vi.spyOn(
      useTimelineStore.getState(),
      'setAudioRegionSelection',
    );
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        source: { type: 'audio' },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['audio-region-active'],
        hasActiveAudioRegion: true,
      },
      activeModules: {
        audioRegion: {
          slot: 'audio-region',
          enabled: true,
          selection: {
            clipId: 'clip-a',
            trackId: 'track-video',
            startTime: 2,
            endTime: 4,
            sourceInPoint: 1,
            sourceOutPoint: 3,
          },
          mode: 'select',
        },
      },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const selection = container.querySelector<HTMLElement>('.clip-audio-region-selection');

    fireEvent.mouseDown(selection as HTMLElement, { button: 0, clientX: 40 });
    fireEvent.mouseMove(document, { clientX: 80 });
    fireEvent.mouseUp(document, { clientX: 80 });

    expect(setAudioRegionSelectionSpy).toHaveBeenCalled();
    expect(setAudioRegionSelectionSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      clipId: 'clip-a',
      startTime: 3,
      endTime: 5,
      sourceInPoint: 2,
      sourceOutPoint: 4,
    });

    setAudioRegionSelectionSpy.mockRestore();
  });

  it('runs audio-region context menu commands from the shell portal', () => {
    const applyAudioRegionEditSpy = vi.spyOn(
      useTimelineStore.getState(),
      'applyAudioRegionEdit',
    ).mockReturnValue('operation-a');
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        name: 'clip.wav',
        source: { type: 'audio' },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['audio-region-active'],
        hasActiveAudioRegion: true,
      },
      activeModules: {
        audioRegion: {
          slot: 'audio-region',
          enabled: true,
          selection: {
            clipId: 'clip-a',
            trackId: 'track-video',
            startTime: 2,
            endTime: 4,
            sourceInPoint: 1,
            sourceOutPoint: 3,
          },
          mode: 'select',
        },
      },
    });

    try {
      const { container } = render(<ClipInteractionShell {...props} />);
      const selection = container.querySelector<HTMLElement>('.clip-audio-region-selection');

      fireEvent.contextMenu(selection as HTMLElement, { clientX: 96, clientY: 48 });

      const menu = document.body.querySelector<HTMLElement>('.clip-audio-region-context-menu');
      const silenceCommand = document.body.querySelector<HTMLElement>('[data-audio-region-command="silence"]');

      expect(menu).toBeTruthy();
      expect(silenceCommand).toBeTruthy();

      fireEvent.pointerDown(silenceCommand as HTMLElement, { button: 0 });

      expect(applyAudioRegionEditSpy).toHaveBeenCalledWith('silence', { keepSelection: true });
      expect(document.body.querySelector('.clip-audio-region-context-menu')).toBeNull();
    } finally {
      applyAudioRegionEditSpy.mockRestore();
    }
  });

  it('renders audio edit stack controls in the audio-region shell', () => {
    const previousAudioFocusMode = useTimelineStore.getState().audioFocusMode;
    const toggleOperationSpy = vi.spyOn(
      useTimelineStore.getState(),
      'setClipAudioEditOperationEnabled',
    );
    let unmount: (() => void) | undefined;
    useTimelineStore.setState({ audioFocusMode: true });
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        name: 'clip.wav',
        source: { type: 'audio' },
        audioState: {
          editStack: [
            {
              id: 'gain-op',
              type: 'gain',
              enabled: true,
              timeRange: { start: 0.5, end: 1.5 },
              params: { label: 'Boost', gainDb: 3 },
              createdAt: 1,
            },
          ],
        },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['audio-region-active'],
        hasActiveAudioRegion: true,
      },
      activeModules: {
        audioRegion: {
          slot: 'audio-region',
          enabled: true,
          selection: {
            clipId: 'clip-a',
            trackId: 'track-video',
            startTime: 2,
            endTime: 4,
            sourceInPoint: 1,
            sourceOutPoint: 3,
          },
          mode: 'select',
        },
      },
    });

    try {
      const rendered = render(<ClipInteractionShell {...props} />);
      unmount = rendered.unmount;
      const { container } = rendered;
      const stack = container.querySelector<HTMLElement>('.clip-audio-edit-stack');
      const operationButton = stack?.querySelector<HTMLElement>('button[title*="Boost"]');

      expect(stack).toBeTruthy();
      expect(stack?.querySelector('.clip-audio-edit-stack-count')?.textContent).toBe('1/1');
      expect(operationButton).toBeTruthy();

      fireEvent.click(operationButton as HTMLElement);

      expect(toggleOperationSpy).toHaveBeenCalledWith('clip-a', 'gain-op', false);
    } finally {
      unmount?.();
      toggleOperationSpy.mockRestore();
      useTimelineStore.setState({ audioFocusMode: previousAudioFocusMode });
    }
  });

  it('selects existing audio edit operation overlays from the shell', () => {
    const previousAudioFocusMode = useTimelineStore.getState().audioFocusMode;
    const previousShowMarkers = useTimelineStore.getState().showAudioRegionEditMarkers;
    const setAudioRegionSelectionSpy = vi.spyOn(
      useTimelineStore.getState(),
      'setAudioRegionSelection',
    );
    let unmount: (() => void) | undefined;
    useTimelineStore.setState({
      audioFocusMode: true,
      showAudioRegionEditMarkers: true,
    });
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        name: 'clip.wav',
        source: { type: 'audio' },
        audioState: {
          editStack: [
            {
              id: 'silence-op',
              type: 'silence',
              enabled: true,
              timeRange: { start: 0.25, end: 0.75 },
              params: { label: 'Silence' },
              createdAt: 1,
            },
          ],
        },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['audio-region-active'],
        hasActiveAudioRegion: true,
      },
      activeModules: {
        audioRegion: {
          slot: 'audio-region',
          enabled: true,
          selection: {
            clipId: 'clip-a',
            trackId: 'track-video',
            startTime: 2,
            endTime: 4,
            sourceInPoint: 1,
            sourceOutPoint: 3,
          },
          mode: 'select',
        },
      },
    });

    try {
      const rendered = render(<ClipInteractionShell {...props} />);
      unmount = rendered.unmount;
      const { container } = rendered;
      const operationOverlay = container.querySelector<HTMLElement>('.clip-audio-edit-operation-overlay');

      expect(operationOverlay).toBeTruthy();
      expect(operationOverlay?.dataset.audioEditType).toBe('silence');

      fireEvent.mouseDown(operationOverlay as HTMLElement, { button: 0 });

      expect(setAudioRegionSelectionSpy).toHaveBeenCalledWith(expect.objectContaining({
        clipId: 'clip-a',
        sourceInPoint: 0.25,
        sourceOutPoint: 0.75,
      }));
    } finally {
      unmount?.();
      setAudioRegionSelectionSpy.mockRestore();
      useTimelineStore.setState({
        audioFocusMode: previousAudioFocusMode,
        showAudioRegionEditMarkers: previousShowMarkers,
      });
    }
  });

  it('renders active stem progress through the shell module', () => {
    const props = createShellProps({
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['stem-active'],
        hasActiveStemControls: true,
      },
      activeModules: {
        stem: {
          slot: 'stem',
          enabled: true,
          stemState: null,
          job: {
            jobId: 'job-a',
            clipId: 'clip-a',
            requestedClipId: 'clip-a',
            modelId: 'htdemucs',
            phase: 'separating',
            progress: 0.42,
            message: 'Separating',
            startedAt: 1,
            updatedAt: 2,
          },
        },
      },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');
    const stemModule = container.querySelector<HTMLElement>('.shell-stem-module');

    expect(shell?.dataset.activeSlots).toBe('stem');
    expect(stemModule).toBeTruthy();
    expect(stemModule?.dataset.clipInteractionSlot).toBe('stem');
    expect(container.querySelector('.stem-percent')?.textContent).toBe('42%');
  });

  it('renders completed stem choices through the shell switcher', () => {
    const props = createShellProps({
      clip: {
        ...createShellProps().clip,
        source: { type: 'audio', mediaFileId: 'source-audio' },
      },
      mountState: {
        clipId: 'clip-a',
        shouldMount: true,
        reasons: ['stem-active'],
        hasActiveStemControls: true,
      },
      activeModules: {
        stem: {
          slot: 'stem',
          enabled: true,
          stemState: {
            activeSetId: 'set-a',
            modelId: 'htdemucs',
            modelVersion: '1',
            createdAt: 1,
            sourceFingerprint: 'fp',
            range: { start: 0, end: 4 },
            sampleRate: 48000,
            channelCount: 2,
            mixMode: 'stems',
            stems: [
              {
                id: 'stem-vocals',
                kind: 'vocals',
                label: 'Vocals',
                analysisArtifactId: 'analysis-a',
                manifestArtifactId: 'manifest-a',
                payloadRef: { kind: 'media-file', mediaFileId: 'stem-vocals-media' },
                mediaFileId: 'stem-vocals-media',
                enabled: true,
                gainDb: 0,
                phaseAligned: true,
                modelId: 'htdemucs',
                sourceFingerprint: 'fp',
              },
            ],
          },
        },
      },
    });

    const { container } = render(<ClipInteractionShell {...props} />);
    const badge = container.querySelector<HTMLElement>('.clip-stem-ready-badge');

    expect(badge).toBeTruthy();
    fireEvent.click(badge as HTMLElement);

    expect(container.querySelector('.clip-stem-menu')).toBeTruthy();
    expect(container.querySelector('[aria-label="Use Vocals stem"]')).toBeTruthy();
  });

  it('does not render when mount state says the shell is not active', () => {
    const { container } = render(
      <ClipInteractionShell
        {...createShellProps({
          mountState: {
            clipId: 'clip-a',
            shouldMount: false,
            reasons: [],
            isSelected: true,
          },
          activeModules: {},
        })}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
