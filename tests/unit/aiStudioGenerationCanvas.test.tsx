import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIStudioGenerationCanvas } from '../../src/components/panels/ai-studio/AIStudioGenerationCanvas';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { createDefaultFlashBoardAIWorkspace } from '../../src/stores/flashboardStore/defaults';
import type { FlashBoardActiveGenerationRecord } from '../../src/stores/flashboardStore/types';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';

const setSourceMonitorFile = vi.fn();

type MediaStoreSelector = (state: {
  files: MediaFile[];
  setSourceMonitorFile: (id: string | null) => void;
}) => unknown;
const mediaStoreMock = useMediaStore as unknown as {
  getState: ReturnType<typeof vi.fn>;
  mockImplementation: (implementation: (selector: MediaStoreSelector) => unknown) => void;
};

function setStudioState(record: FlashBoardActiveGenerationRecord, mediaFiles: MediaFile[] = []) {
  const workspace = createDefaultFlashBoardAIWorkspace();
  useFlashBoardStore.setState({
    activeGenerationRecords: [{ ...record, workspaceId: workspace.id }],
    activeAIWorkspaceId: workspace.id,
    aiWorkspaces: [workspace],
    composer: workspace.composer,
  });
  const mediaState = { files: mediaFiles, setSourceMonitorFile };
  mediaStoreMock.mockImplementation((selector) => selector(mediaState));
  mediaStoreMock.getState.mockReturnValue(mediaState);
}

function createRecord(status: 'queued' | 'completed'): FlashBoardActiveGenerationRecord {
  return {
    id: 'generation-1',
    kind: 'generation',
    createdAt: 1_000,
    updatedAt: 1_000,
    request: {
      service: 'cloud',
      providerId: 'nano-banana-2',
      version: 'latest',
      outputType: 'image',
      prompt: 'A tree beside a quiet lake',
      aspectRatio: '9:16',
      imageSize: '1K',
      referenceMediaFileIds: [],
    },
    job: { status },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setSourceMonitorFile.mockReset();
  useFlashBoardStore.setState({ activeGenerationRecords: [] });
  const mediaState = { files: [], setSourceMonitorFile };
  mediaStoreMock.mockImplementation((selector) => selector(mediaState));
  mediaStoreMock.getState.mockReturnValue(mediaState);
});

describe('AI Studio generation canvas', () => {
  it('shows the aspect ratio pictogram while a generation is queued', () => {
    setStudioState(createRecord('queued'));
    render(<AIStudioGenerationCanvas />);

    expect(screen.getByLabelText('Aspect ratio 9:16')).toBeTruthy();
  });

  it('makes completed image, video, or audio media draggable through the timeline protocol', () => {
    const mediaFile = {
      id: 'generated-media-1',
      name: 'generated.png',
      type: 'image',
      url: 'blob:generated-media-1',
      width: 1080,
      height: 1920,
      duration: 5,
      isImporting: false,
    } as MediaFile;
    const record = {
      ...createRecord('completed'),
      result: { mediaFileId: mediaFile.id, mediaType: 'image' as const },
    };
    setStudioState(record, [mediaFile]);
    const startDrag = vi.spyOn(flashBoardMediaBridge, 'startDragToTimeline');
    const { container } = render(<AIStudioGenerationCanvas />);
    const tile = container.querySelector('article');

    expect(tile?.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(tile as HTMLElement, {
      dataTransfer: { effectAllowed: 'none', setData: vi.fn(), setDragImage: vi.fn() },
    });
    expect(startDrag).toHaveBeenCalledWith(expect.anything(), mediaFile.id);
  });

  it('fits completed media into the tile without using a cropped thumbnail', () => {
    const mediaFile = {
      id: 'generated-media-1',
      name: 'generated.png',
      type: 'image',
      url: 'blob:full-generated-media',
      thumbnailUrl: 'blob:cropped-thumbnail',
      width: 1080,
      height: 1920,
      isImporting: false,
    } as MediaFile;
    setStudioState({
      ...createRecord('completed'),
      result: { mediaFileId: mediaFile.id, mediaType: 'image', width: 1080, height: 1920 },
    }, [mediaFile]);
    const { container } = render(<AIStudioGenerationCanvas />);
    const preview = container.querySelector('.ai-studio-generation-tile-preview') as HTMLElement;
    const image = preview.querySelector('img') as HTMLImageElement;

    expect(image.getAttribute('src')).toBe(mediaFile.url);
  });

  it('opens completed media in the Source Monitor on tile double-click', () => {
    const mediaFile = {
      id: 'generated-media-1',
      name: 'generated.png',
      type: 'image',
      url: 'blob:generated-media-1',
      width: 1080,
      height: 1920,
      isImporting: false,
    } as MediaFile;
    setStudioState({
      ...createRecord('completed'),
      result: { mediaFileId: mediaFile.id, mediaType: 'image' },
    }, [mediaFile]);
    const { container } = render(<AIStudioGenerationCanvas />);

    fireEvent.doubleClick(container.querySelector('.ai-studio-generation-tile-preview') as HTMLElement);

    expect(setSourceMonitorFile).toHaveBeenCalledWith(mediaFile.id);
  });

  it('expands the one-line prompt only while it is hovered', () => {
    setStudioState(createRecord('queued'));
    render(<AIStudioGenerationCanvas />);
    const prompt = screen.getByRole('button', { name: 'A tree beside a quiet lake' });

    expect(prompt.getAttribute('aria-expanded')).toBe('false');
    fireEvent.mouseEnter(prompt);
    expect(prompt.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseLeave(prompt);
    expect(prompt.getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the prompt to the clipboard on double-click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    setStudioState(createRecord('queued'));
    render(<AIStudioGenerationCanvas />);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'A tree beside a quiet lake' }));

    expect(writeText).toHaveBeenCalledWith('A tree beside a quiet lake');
  });

  it('applies the continuous tile size to the generation grid', () => {
    setStudioState(createRecord('queued'));
    const { container } = render(<AIStudioGenerationCanvas tileSize={347} />);
    const grid = container.querySelector('.ai-studio-generation-grid') as HTMLElement;

    expect(grid.style.getPropertyValue('--ai-studio-tile-size')).toBe('347px');
  });

  it('restores the consumed generation time for durable completed tiles', () => {
    const workspace = createDefaultFlashBoardAIWorkspace();
    const mediaFile = {
      id: 'durable-generated-media',
      name: 'durable.png',
      type: 'image',
      url: 'blob:durable-generated-media',
      isImporting: false,
    } as MediaFile;
    useFlashBoardStore.setState({
      activeGenerationRecords: [],
      activeAIWorkspaceId: workspace.id,
      aiWorkspaces: [workspace],
      composer: workspace.composer,
    });
    const mediaState = { files: [mediaFile], setSourceMonitorFile };
    mediaStoreMock.mockImplementation((selector) => selector(mediaState));
    mediaStoreMock.getState.mockReturnValue(mediaState);
    vi.spyOn(flashBoardMediaBridge, 'getMetadata').mockReturnValue({
      mediaFileId: mediaFile.id,
      workspaceId: workspace.id,
      generationElapsedMs: 12_500,
      providerId: 'nano-banana-2',
      version: 'latest',
      mediaType: 'image',
      prompt: 'A tree beside a quiet lake',
      referenceMediaFileIds: [],
      createdAt: new Date(20_000).toISOString(),
    });

    render(<AIStudioGenerationCanvas />);

    expect(screen.getByTitle('Elapsed time').textContent).toBe('12s');
  });
});
