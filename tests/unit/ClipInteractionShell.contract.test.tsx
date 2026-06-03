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

  it('renders a lightweight shell scaffold with built-in fade handles and remaining placeholders', () => {
    const { container } = render(<ClipInteractionShell {...createShellProps()} />);
    const shell = container.querySelector<HTMLElement>('.clip-interaction-shell');

    expect(shell).toBeTruthy();
    expect(shell?.dataset.clipId).toBe('clip-a');
    expect(shell?.dataset.activeSlots).toBe('fade context-menu tool-preview');
    expect(container.querySelectorAll('.shell-fade-handle')).toHaveLength(2);

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

    fireEvent.mouseDown(left as HTMLElement, { button: 0 });

    expect(onFadeStart).toHaveBeenCalledTimes(1);
    expect(onFadeStart.mock.calls[0][1].clip.id).toBe('clip-a');
    expect(onFadeStart.mock.calls[0][2]).toBe('left');
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
