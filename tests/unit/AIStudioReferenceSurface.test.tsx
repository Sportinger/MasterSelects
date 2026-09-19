import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(),
}));

import { AIStudioReferenceSurface } from '../../src/components/panels/ai-studio/AIStudioReferenceSurface';
import { AIStudioPromptCapsule } from '../../src/components/panels/ai-studio/AIStudioComposerBar';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { resetFlashBoardActiveGenerationState } from '../../src/stores/flashboardStore/activeGenerationRecords';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';

const IMAGE_FILE: MediaFile = {
  createdAt: 1,
  height: 1080,
  id: 'media-reference-image',
  name: 'Reference frame.png',
  parentId: null,
  type: 'image',
  url: 'blob:reference-frame',
  width: 1920,
};

function mediaPanelTransfer(mediaFileId: string): DataTransfer {
  return {
    dropEffect: 'copy',
    effectAllowed: 'copy',
    getData: vi.fn((type: string) => (
      type === 'application/x-media-panel-item' ? mediaFileId : ''
    )),
    setData: vi.fn(),
    types: ['application/x-media-panel-item'],
  } as unknown as DataTransfer;
}

describe('AIStudioReferenceSurface', () => {
  beforeEach(() => {
    resetFlashBoardActiveGenerationState();
    useMediaStore.setState({ files: [IMAGE_FILE] });
  });

  afterEach(() => {
    cleanup();
    useMediaStore.setState({ files: [] });
  });

  it('attaches Media-panel drops as chat context', () => {
    render(
      <AIStudioReferenceSurface workspaceKind="chat">
        <AIStudioPromptCapsule>Chat prompt</AIStudioPromptCapsule>
      </AIStudioReferenceSurface>,
    );

    const surface = screen.getByTestId('ai-studio-reference-surface');
    const dataTransfer = mediaPanelTransfer(IMAGE_FILE.id);
    fireEvent.dragOver(surface, { dataTransfer });
    expect(screen.getAllByText('Drop to attach as reference').length).toBeGreaterThan(0);
    fireEvent.drop(surface, { dataTransfer });

    expect(useFlashBoardStore.getState().composer.referenceMediaFileIds).toEqual([IMAGE_FILE.id]);
    expect(screen.getByText(IMAGE_FILE.name)).toBeTruthy();
  });

  it('exposes model-aware start, reference, and end slots for Gen drops', () => {
    useFlashBoardStore.getState().createAIWorkspace({
      kind: 'generation',
      outputType: 'video',
      providerId: 'cloud-kling',
    });
    useFlashBoardStore.getState().updateComposer({
      multiShots: false,
      outputType: 'video',
      providerId: 'cloud-kling',
      service: 'cloud',
    });

    render(
      <AIStudioReferenceSurface workspaceKind="generation">
        <AIStudioPromptCapsule>Generation prompt</AIStudioPromptCapsule>
      </AIStudioReferenceSurface>,
    );

    expect(screen.getByLabelText('Start frame input')).toBeTruthy();
    expect(screen.getByLabelText('Image reference input')).toBeTruthy();
    expect(screen.getByLabelText('End frame input')).toBeTruthy();

    fireEvent.drop(screen.getByLabelText('Start frame input'), {
      clientX: 0,
      clientY: 0,
      dataTransfer: mediaPanelTransfer(IMAGE_FILE.id),
    });

    expect(useFlashBoardStore.getState().composer.startMediaFileId).toBe(IMAGE_FILE.id);
    expect(useFlashBoardStore.getState().composer.referenceMediaFileIds).toEqual([]);
    expect(screen.getByText(IMAGE_FILE.name)).toBeTruthy();
  });
});
