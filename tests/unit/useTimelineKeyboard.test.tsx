import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineKeyboard } from '../../src/components/timeline/hooks/useTimelineKeyboard';
import { usePointerFocusHandoff } from '../../src/hooks/usePointerFocusHandoff';
import { ALL_BLEND_MODES } from '../../src/components/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Composition } from '../../src/stores/mediaStore';
import type { TimelineEditOperationActions } from '../../src/stores/timeline/types';
import type { TimelineClip } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

function KeyboardHarness({
  selectedClipIds = new Set<string>(),
  selectedKeyframeIds = new Set<string>(),
  clipMap = new Map<string, TimelineClip>(),
  activeComposition = null,
  playheadPosition = 0,
  duration = 10,
  setPlayheadPosition = vi.fn(),
  play = vi.fn(),
  toggleTimelineCurveMode = vi.fn(),
  applyTimelineEditOperation,
}: {
  selectedClipIds?: Set<string>;
  selectedKeyframeIds?: Set<string>;
  clipMap?: Map<string, TimelineClip>;
  activeComposition?: Composition | null;
  playheadPosition?: number;
  duration?: number;
  setPlayheadPosition?: (time: number) => void;
  play?: () => void;
  toggleTimelineCurveMode?: () => void;
  applyTimelineEditOperation: TimelineEditOperationActions['applyTimelineEditOperation'];
}) {
  usePointerFocusHandoff();
  useTimelineKeyboard({
    isPlaying: false,
    play,
    pause: vi.fn(),
    playForward: vi.fn(),
    playReverse: vi.fn(),
    setInPointAtPlayhead: vi.fn(),
    setOutPointAtPlayhead: vi.fn(),
    clearInOut: vi.fn(),
    toggleLoopPlayback: vi.fn(),
    toggleTimelineCurveMode,
    selectedClipIds,
    selectedKeyframeIds,
    applyTimelineEditOperation,
    splitClipAtPlayhead: vi.fn(),
    copyClips: vi.fn(),
    pasteClips: vi.fn(),
    copyKeyframes: vi.fn(),
    pasteKeyframes: vi.fn(),
    toolMode: 'select',
    toggleCutTool: vi.fn(),
    clipMap,
    activeComposition,
    playheadPosition,
    duration,
    setPlayheadPosition,
    addMarker: vi.fn(),
  });

  return (
    <>
      <input data-testid="text-input" />
      <button data-testid="focused-button" type="button">Control</button>
      <input data-testid="focused-slider" type="range" />
      <div data-testid="editor-surface" onPointerDown={(event) => event.preventDefault()} />
    </>
  );
}

describe('useTimelineKeyboard edit operation routing', () => {
  let applyTimelineEditOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useTimelineStore.setState({
      propertiesSelection: null,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      playheadPosition: 0,
      maskPanelActive: false,
      maskEditMode: 'none',
      selectedVertexIds: new Set(),
    });
    applyTimelineEditOperation = vi.fn(() => ({
      success: true,
      operationId: 'operation',
      changedClipIds: [],
      warnings: [],
    }));
  });

  it('routes delete through keyboard-delete-command with keyframes-first priority', () => {
    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        selectedKeyframeIds={new Set(['kf-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-delete-command',
      command: 'delete',
      priority: 'keyframes-first',
      keyframeIds: ['kf-1'],
      clipIds: ['clip-1'],
      includeLinked: false,
      source: 'shortcut',
    });
    expect(applyTimelineEditOperation.mock.calls[0][1]).toMatchObject({
      source: 'shortcut',
      historyLabel: 'Delete keyframes',
    });
  });

  it('toggles the universal Timeline/Graph view with G outside text entry', () => {
    const toggleTimelineCurveMode = vi.fn();
    const { getByTestId } = render(
      <KeyboardHarness
        toggleTimelineCurveMode={toggleTimelineCurveMode}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'g' });
    expect(toggleTimelineCurveMode).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(getByTestId('text-input'), { key: 'g' });
    expect(toggleTimelineCurveMode).toHaveBeenCalledTimes(1);
  });

  it('routes delete to transition removal when a transition is selected', () => {
    useTimelineStore.setState({
      propertiesSelection: {
        kind: 'transition',
        clipId: 'clip-a',
        edge: 'out',
        transitionId: 'transition-a',
      },
    });

    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        selectedKeyframeIds={new Set(['kf-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'transition-remove',
      clipId: 'clip-a',
      edge: 'out',
      transitionId: 'transition-a',
      source: 'shortcut',
    });
    expect(applyTimelineEditOperation.mock.calls[0][1]).toMatchObject({
      source: 'shortcut',
      historyLabel: 'Remove transition',
    });
  });

  it('routes delete through keyboard-delete-command for clips-only fallback', () => {
    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1', 'clip-2'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-delete-command',
      command: 'delete',
      priority: 'clips-only',
      keyframeIds: [],
      clipIds: ['clip-1', 'clip-2'],
      includeLinked: false,
    });
  });

  it('routes next blend mode through keyboard-cycle-blend-mode-command', () => {
    const clipMap = new Map<string, TimelineClip>([
      ['clip-a', createMockClip({ id: 'clip-a', transform: { ...createMockClip().transform, blendMode: 'normal' } })],
      ['clip-b', createMockClip({ id: 'clip-b' })],
    ]);

    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-a', 'clip-b'])}
        clipMap={clipMap}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: '+', code: 'NumpadAdd' });

    expect(applyTimelineEditOperation).toHaveBeenCalledTimes(1);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyboard-cycle-blend-mode-command',
      command: 'cycle-blend-mode',
      clipIds: ['clip-a', 'clip-b'],
      direction: 'next',
      anchorClipId: 'clip-a',
      currentBlendMode: 'normal',
      nextBlendMode: 'dissolve',
      blendModeSequence: ALL_BLEND_MODES,
    });
  });

  it('does not route edit shortcuts from text entry targets', () => {
    const { getByTestId } = render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(getByTestId('text-input'), { key: 'Delete' });

    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('keeps Space assigned to timeline playback outside text entry', () => {
    const play = vi.fn();
    const { getByTestId } = render(
      <KeyboardHarness
        play={play}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const button = getByTestId('focused-button');
    button.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    const mayRunNativeDefault = button.dispatchEvent(event);

    expect(mayRunNativeDefault).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(button);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not claim timeline Space while the user is typing', () => {
    const play = vi.fn();
    const { getByTestId } = render(
      <KeyboardHarness
        play={play}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const input = getByTestId('text-input');
    input.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(play).not.toHaveBeenCalled();
  });

  it('plays normally after pointer focus moves away from a control', () => {
    const play = vi.fn();
    const { getByTestId } = render(
      <KeyboardHarness
        play={play}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const button = getByTestId('focused-button');
    button.focus();
    fireEvent.pointerDown(getByTestId('editor-surface'), {
      button: 0,
      isPrimary: true,
      pointerId: 1,
    });
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    window.dispatchEvent(event);

    expect(document.activeElement).not.toBe(button);
    expect(event.defaultPrevented).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('defers frame arrows to an intentionally focused range slider', () => {
    const setPlayheadPosition = vi.fn();
    const activeComposition: Composition = {
      id: 'comp-slider-focus',
      name: 'Slider focus comp',
      type: 'composition',
      parentId: null,
      createdAt: 0,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 10,
      backgroundColor: '#000000',
    };
    const { getByTestId } = render(
      <KeyboardHarness
        activeComposition={activeComposition}
        setPlayheadPosition={setPlayheadPosition}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const slider = getByTestId('focused-slider');
    slider.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    slider.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(slider);
    expect(setPlayheadPosition).not.toHaveBeenCalled();
  });

  it('yields conflicting tool and delete shortcuts to an active mask context', () => {
    useTimelineStore.setState({
      maskPanelActive: true,
      maskEditMode: 'editing',
      selectedVertexIds: new Set(['vertex-1']),
      activeTimelineTool: 'blade',
    });
    render(
      <KeyboardHarness
        selectedClipIds={new Set(['clip-1'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const toolEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'v',
    });
    const deleteEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Delete',
    });

    window.dispatchEvent(toolEvent);
    window.dispatchEvent(deleteEvent);

    expect(toolEvent.defaultPrevented).toBe(false);
    expect(deleteEvent.defaultPrevented).toBe(false);
    expect(useTimelineStore.getState().activeTimelineTool).toBe('blade');
    expect(applyTimelineEditOperation).not.toHaveBeenCalled();
  });

  it('deletes selected keyframes even while the mask editor is active', () => {
    useTimelineStore.setState({
      maskPanelActive: true,
      maskEditMode: 'editing',
      selectedVertexIds: new Set(),
    });
    render(
      <KeyboardHarness
        selectedKeyframeIds={new Set(['kf-mask-path'])}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    const deleteEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Delete',
    });
    window.dispatchEvent(deleteEvent);

    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(applyTimelineEditOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'keyboard-delete-command',
        priority: 'keyframes-first',
        keyframeIds: ['kf-mask-path'],
      }),
      expect.objectContaining({ historyLabel: 'Delete keyframes' }),
    );
  });

  it('steps repeated frame shortcuts from the fresh store position without waiting for rerender', () => {
    const activeComposition: Composition = {
      id: 'comp-60fps',
      name: '60 fps comp',
      type: 'composition',
      parentId: null,
      createdAt: 0,
      width: 1920,
      height: 1080,
      frameRate: 60,
      duration: 10,
      backgroundColor: '#000000',
    };
    const setPlayheadPosition = vi.fn((time: number) => {
      useTimelineStore.setState({ playheadPosition: time });
    });

    useTimelineStore.setState({ playheadPosition: 6 });

    render(
      <KeyboardHarness
        activeComposition={activeComposition}
        playheadPosition={6}
        duration={10}
        setPlayheadPosition={setPlayheadPosition}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(setPlayheadPosition).toHaveBeenCalledTimes(3);
    expect(setPlayheadPosition.mock.calls[0][0]).toBeCloseTo(5.983333333333333, 8);
    expect(setPlayheadPosition.mock.calls[1][0]).toBeCloseTo(5.966666666666667, 8);
    expect(setPlayheadPosition.mock.calls[2][0]).toBeCloseTo(5.983333333333333, 8);
  });
});
