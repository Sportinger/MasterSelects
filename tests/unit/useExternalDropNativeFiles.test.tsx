import { act, renderHook } from '@testing-library/react';
import type { DragEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTrack } from '../helpers/mockData';
import { collectDroppedMediaFiles } from '../../src/components/panels/media/dropImport';

const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock('../../src/components/timeline/hooks/useDroppedTimelineMediaFiles', () => ({
  useDroppedTimelineMediaFiles: () => mocks.collect,
}));
import { useExternalDrop } from '../../src/components/timeline/hooks/useExternalDrop';
import type { UseExternalDropProps } from '../../src/components/timeline/hooks/useExternalDropTypes';

function props(): UseExternalDropProps {
  return {
    timelineRef: { current: document.createElement('div') },
    scrollX: 0,
    tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
    clips: [],
    isExporting: false,
    activeTimelineToolId: 'select',
    pixelToTime: pixel => pixel / 100,
    addTrack: () => 'audio-new',
  } as UseExternalDropProps;
}

beforeEach(() => {
  mocks.collect.mockReset();
  mocks.collect.mockImplementation(({ dataTransfer }) => collectDroppedMediaFiles(dataTransfer));
});

describe('native timeline drop lifetime', () => {
  it.each(['existing', 'new'] as const)('captures MP3 files on %s tracks before yielding', async target => {
    const file = new File(['mp3'], 'desktop.mp3', { type: 'audio/mpeg' });
    let readable = true;
    const dataTransfer = {
      types: ['Files'],
      get files() { return readable ? [file] : []; },
      get items() { return readable ? [{ kind: 'file', getAsFile: () => file }] : []; },
      getData: () => '',
    } as unknown as DataTransfer;
    const event = { dataTransfer, clientX: 100, clientY: 100,
      preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent;
    const { result } = renderHook(() => useExternalDrop(props()));
    await act(async () => {
      const pending = target === 'existing'
        ? result.current.handleTrackDrop(event, 'audio-1')
        : result.current.handleNewTrackDrop(event, 'audio');
      // Native dispatch ends here; a later continuation cannot read the transfer.
      readable = false;
      await pending;
    });
    expect(mocks.collect).toHaveBeenCalledOnce();
    expect(await mocks.collect.mock.results[0].value).toEqual([{ file, folderSegments: [] }]);
  });
});
