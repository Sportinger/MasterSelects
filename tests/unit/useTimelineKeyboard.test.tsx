import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineKeyboard } from '../../src/components/timeline/hooks/useTimelineKeyboard';
import { ALL_BLEND_MODES } from '../../src/components/timeline/constants';
import type { TimelineEditOperationActions } from '../../src/stores/timeline/types';
import type { TimelineClip } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

function KeyboardHarness({
  selectedClipIds = new Set<string>(),
  selectedKeyframeIds = new Set<string>(),
  clipMap = new Map<string, TimelineClip>(),
  applyTimelineEditOperation,
}: {
  selectedClipIds?: Set<string>;
  selectedKeyframeIds?: Set<string>;
  clipMap?: Map<string, TimelineClip>;
  applyTimelineEditOperation: TimelineEditOperationActions['applyTimelineEditOperation'];
}) {
  useTimelineKeyboard({
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    playForward: vi.fn(),
    playReverse: vi.fn(),
    setInPointAtPlayhead: vi.fn(),
    setOutPointAtPlayhead: vi.fn(),
    clearInOut: vi.fn(),
    toggleLoopPlayback: vi.fn(),
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
    activeComposition: null,
    playheadPosition: 0,
    duration: 10,
    setPlayheadPosition: vi.fn(),
    addMarker: vi.fn(),
  });

  return <input data-testid="text-input" />;
}

describe('useTimelineKeyboard edit operation routing', () => {
  let applyTimelineEditOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
});
