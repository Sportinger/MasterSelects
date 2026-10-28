import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaPanel } from '../../src/components/panels/MediaPanel';
import { useMediaStore, type MediaFile, type TextItem } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

// An inspector drag replaces the timeline `clips` array on every sample. The bin used to subscribe
// to it and re-rendered every list cell per sample (the "bin lag"). It now subscribes only to the
// derived list of timeline-owned media ids.

vi.mock('../../src/stores/dockStore', () => ({
  FACTORY_IMAGE_EDIT_LAYOUT_ID: 'factory-image-edit',
  useDockStore: Object.assign(vi.fn((selector: (state: unknown) => unknown) => selector({
    activatePanelType: vi.fn(),
  })), {
    getState: vi.fn(() => ({ activatePanelType: vi.fn() })),
  }),
}));

const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};
const initialTimelineState = useTimelineStore.getState();

function videoFile(id: string, name: string): MediaFile {
  return {
    id, name, type: 'video', parentId: null, createdAt: 1, url: `blob:${id}`, duration: 10, width: 1920, height: 1080,
    file: new File(['video'], name, { type: 'video/mp4' }),
  };
}

const titleItem: TextItem = {
  id: 'text-item-1', name: 'Lower Third', type: 'text', parentId: null, createdAt: 3,
  text: 'Hello', fontFamily: 'Inter', fontSize: 64, color: '#ffffff', duration: 5,
};

function createMediaState(): Record<string, unknown> {
  const files = [videoFile('file-1', 'A.mp4'), videoFile('file-2', 'B.mp4'), videoFile('file-3', 'C.mp4')];
  const state: Record<string, unknown> = {
    files,
    compositions: [],
    folders: [],
    textItems: [titleItem],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    lightItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    trackingAssets: [],
    selectedIds: [],
    expandedFolderIds: [],
    fileSystemSupported: false,
    proxyFolderName: null,
    activeCompositionId: null,
    sourceMonitorFileId: null,
    sourceMonitorPlaybackRequestId: 0,
    getItemsByFolder: (folderId: string | null) => files.filter(item => item.parentId === folderId),
    copyMediaItems: vi.fn(),
    pasteMediaItems: vi.fn(() => []),
    duplicateMediaItems: vi.fn(() => []),
    hasMediaClipboard: vi.fn(() => false),
    refreshFileUrls: vi.fn(),
    ensureFileThumbnail: vi.fn(async () => false),
    setSelection: vi.fn(),
    setSourceMonitorFile: vi.fn(),
  };
  return new Proxy(state, {
    // Every other action the panel reads is a no-op.
    get: (target, key: string) => (key in target ? target[key] : vi.fn()),
  });
}

function textClip(id: string, mediaFileId: string): TimelineClip {
  return createMockClip({
    id, mediaFileId, name: 'Lower Third',
    source: { type: 'text', mediaFileId } as TimelineClip['source'],
  });
}

describe('MediaPanel timeline subscription', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('media-panel-view-mode', 'classic');
    const mediaState = createMediaState();
    mockedUseMediaStore.mockImplementation((selector: (state: unknown) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockReturnValue(mediaState);
    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [createMockClip({ id: 'clip-a', mediaFileId: 'file-1' }), createMockClip({ id: 'clip-b', mediaFileId: 'file-2' })],
    });
  });

  afterEach(() => {
    cleanup();
    act(() => useTimelineStore.setState(initialTimelineState));
    vi.clearAllMocks();
  });

  it('does not re-render the bin while a clip value is dragged, and still hides newly timeline-owned items', () => {
    let commits = 0;
    const { container } = render(
      <Profiler id="media-panel" onRender={() => { commits += 1; }}>
        <MediaPanel />
      </Profiler>,
    );
    expect(container.querySelector('[data-item-id="file-1"]')).not.toBeNull();
    expect(container.querySelector(`[data-item-id="${titleItem.id}"]`)).not.toBeNull();

    commits = 0;
    // 30 drag samples: every one replaces the clips array and the edited clip.
    for (let sample = 1; sample <= 30; sample += 1) {
      act(() => useTimelineStore.setState(state => ({
        clips: state.clips.map(clip => clip.id === 'clip-a'
          ? { ...clip, transform: { ...clip.transform, opacity: 1 - sample / 100 } }
          : clip),
      })));
    }
    expect(commits).toBe(0);

    // A clip edit that changes the timeline-owned ids still reaches the bin: the timeline-native
    // text clip linked to the Media Panel item hides that item.
    act(() => useTimelineStore.setState(state => ({ clips: [...state.clips, textClip('clip-title', titleItem.id)] })));
    expect(commits).toBeGreaterThan(0);
    expect(container.querySelector(`[data-item-id="${titleItem.id}"]`)).toBeNull();
    expect(container.querySelector('[data-item-id="file-1"]')).not.toBeNull();

    // Removing it shows the item again.
    act(() => useTimelineStore.setState(state => ({ clips: state.clips.filter(clip => clip.id !== 'clip-title') })));
    expect(container.querySelector(`[data-item-id="${titleItem.id}"]`)).not.toBeNull();
  });
});
