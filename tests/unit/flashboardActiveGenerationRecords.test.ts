import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import {
  appendFlashBoardPromptHistoryEntry,
  ensureFlashBoardActiveGenerationBoard,
  failFlashBoardActiveGenerationRecord,
  completeFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecords,
  getFlashBoardChatMessages,
  getFlashBoardPromptHistory,
  hydrateFlashBoardActiveGenerationRecords,
  resetFlashBoardActiveGenerationState,
  selectFlashBoardActiveGenerationRecords,
  selectHasFlashBoardActiveGenerationBoard,
  submitFlashBoardActiveGenerationRequest,
  recordFlashBoardImportedGenerationResult,
  updateFlashBoardActiveGenerationJob,
  updateFlashBoardActiveGenerationOutputs,
} from '../../src/stores/flashboardStore/activeGenerationRecords';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';
import { flashBoardJobService } from '../../src/services/flashboard/FlashBoardJobService';
import { useFlashBoardRuntime } from '../../src/components/panels/flashboard/useFlashBoardRuntime';
import { MediaAIGenerationQueue } from '../../src/components/panels/media/MediaAIGenerationQueue';

const generationRecord = {
  id: 'generation-video',
  kind: 'generation' as const,
  createdAt: 10,
  updatedAt: 11,
  job: { status: 'processing' as const },
  request: {
    service: 'cloud' as const,
    providerId: 'kling-3.0',
    version: '3.0',
    outputType: 'video' as const,
    prompt: 'Board prompt',
    referenceMediaFileIds: ['frame-ref'],
  },
};

function FlashBoardRuntimeHarness() {
  useFlashBoardRuntime({ enableKeyboardDelete: false });
  return null;
}

describe('FlashBoard active generation record adapter', () => {
  beforeEach(() => {
    useFlashBoardStore.setState({
      activeGenerationRecords: [generationRecord],
      selectedActiveGenerationRecordIds: [],
      composer: createDefaultFlashBoardComposer(),
      promptHistory: [],
      hoveredComposerReference: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a stable active generation record for request metadata', () => {
    const record = getFlashBoardActiveGenerationRecord('generation-video');

    expect(record).toMatchObject({
      id: 'generation-video',
      kind: 'generation',
      createdAt: 10,
      updatedAt: 11,
      request: {
        service: 'cloud',
        providerId: 'kling-3.0',
        prompt: 'Board prompt',
        referenceMediaFileIds: ['frame-ref'],
      },
    });
  });

  it('completes the active generation record with imported media result', () => {
    completeFlashBoardActiveGenerationRecord('generation-video', {
      mediaFileId: 'media-video',
      mediaType: 'video',
      duration: 3,
      width: 1280,
      height: 720,
    });

    const record = getFlashBoardActiveGenerationRecord('generation-video');

    expect(record?.job).toMatchObject({ status: 'completed' });
    expect(record?.result).toEqual({
      mediaFileId: 'media-video',
      mediaType: 'video',
      duration: 3,
      width: 1280,
      height: 720,
    });
  });

  it('maps multiple imported outputs by stable provider id', () => {
    updateFlashBoardActiveGenerationOutputs('generation-video', [{
      id: 'track-1',
      availability: 'preview',
      mediaType: 'audio',
      previewUrl: 'https://cdn.example/track-1.mp3',
    }, {
      id: 'track-2',
      availability: 'preview',
      mediaType: 'audio',
      previewUrl: 'https://cdn.example/track-2.mp3',
    }]);
    recordFlashBoardImportedGenerationResult('generation-video', {
      mediaFileId: 'media-track-2',
      mediaType: 'audio',
      outputId: 'track-2',
    });
    completeFlashBoardActiveGenerationRecord('generation-video', [{
      mediaFileId: 'media-track-2',
      mediaType: 'audio',
      outputId: 'track-2',
    }, {
      mediaFileId: 'media-track-1',
      mediaType: 'audio',
      outputId: 'track-1',
    }]);

    const record = getFlashBoardActiveGenerationRecord('generation-video');
    expect(record?.results).toHaveLength(2);
    expect(record?.outputs).toMatchObject([
      { id: 'track-1', availability: 'completed', mediaFileId: 'media-track-1' },
      { id: 'track-2', availability: 'completed', mediaFileId: 'media-track-2' },
    ]);
  });

  it('renders streamable Suno outputs as players inside the generation card', () => {
    vi.mocked(useMediaStore).mockImplementation((selector) => selector({
      files: [],
    } as ReturnType<typeof useMediaStore.getState>));
    useFlashBoardStore.setState({
      activeGenerationRecords: [{
        id: 'suno-generation',
        kind: 'generation',
        createdAt: 10,
        updatedAt: 11,
        job: { status: 'processing', progress: 0.75 },
        outputs: [{
          id: 'track-1',
          availability: 'preview',
          artworkUrl: 'https://cdn.example/cover.jpg',
          mediaType: 'audio',
          previewUrl: 'https://cdn.example/preview.mp3',
          title: 'Early Track',
        }],
        request: {
          service: 'cloud',
          providerId: 'suno-music',
          version: 'V5_5',
          outputType: 'audio',
          prompt: 'Ambient piano',
          referenceMediaFileIds: [],
        },
      }],
    });

    const { container } = render(createElement(MediaAIGenerationQueue));

    expect(screen.getByLabelText('Generated tracks')).toBeInTheDocument();
    expect(screen.getByText('Early Track')).toBeInTheDocument();
    expect(container.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/preview.mp3');
    expect(container.querySelector('.media-ai-generation-track-art img')).toHaveAttribute(
      'src',
      'https://cdn.example/cover.jpg',
    );
  });

  it('selects active generation records directly from store state', () => {
    const records = selectFlashBoardActiveGenerationRecords(useFlashBoardStore.getState());

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: 'generation-video',
      kind: 'generation',
      job: { status: 'processing' },
      request: {
        prompt: 'Board prompt',
      },
    });
  });

  it('keeps the legacy board readiness adapter ready after board deletion', () => {
    expect(selectHasFlashBoardActiveGenerationBoard(useFlashBoardStore.getState())).toBe(true);

    resetFlashBoardActiveGenerationState();

    expect(selectHasFlashBoardActiveGenerationBoard(useFlashBoardStore.getState())).toBe(true);
  });

  it('keeps runtime bootstrap as a no-op after board deletion', () => {
    resetFlashBoardActiveGenerationState();

    ensureFlashBoardActiveGenerationBoard();

    expect(getFlashBoardActiveGenerationRecords()).toEqual([]);
  });

  it('hydrates and resets active generation records for current project persistence', () => {
    hydrateFlashBoardActiveGenerationRecords([{
      id: 'persisted-generation',
      kind: 'generation',
      createdAt: 20,
      updatedAt: 21,
      request: {
        service: 'cloud',
        providerId: 'cloud-kling',
        version: 'latest',
        outputType: 'video',
        prompt: 'Persisted prompt',
        referenceMediaFileIds: [],
      },
      job: { status: 'completed', completedAt: 22 },
      result: {
        mediaFileId: 'media-persisted',
        mediaType: 'video',
      },
    }]);

    expect(getFlashBoardActiveGenerationRecords()).toHaveLength(1);
    expect(getFlashBoardActiveGenerationRecord('persisted-generation')).toMatchObject({
      id: 'persisted-generation',
      request: { prompt: 'Persisted prompt' },
      result: { mediaFileId: 'media-persisted' },
    });

    resetFlashBoardActiveGenerationState();

    expect(getFlashBoardActiveGenerationRecords()).toEqual([]);
    expect(useFlashBoardStore.getState()).toMatchObject({
      activeGenerationRecords: [],
      selectedActiveGenerationRecordIds: [],
      promptHistory: [],
      hoveredComposerReference: null,
    });
  });

  it('updates and fails generation jobs through the adapter', () => {
    updateFlashBoardActiveGenerationJob('generation-video', {
      status: 'processing',
      progress: 0.5,
      remoteTaskId: 'remote-1',
    });

    expect(getFlashBoardActiveGenerationRecord('generation-video')?.job).toMatchObject({
      status: 'processing',
      progress: 0.5,
      remoteTaskId: 'remote-1',
    });

    failFlashBoardActiveGenerationRecord('generation-video', 'Provider failed');

    expect(getFlashBoardActiveGenerationRecord('generation-video')?.job).toMatchObject({
      status: 'failed',
      error: 'Provider failed',
    });
  });

  it('submits a generation request through the active record queue', () => {
    const submitSpy = vi.spyOn(flashBoardJobService, 'submit').mockReturnValue(null);
    const request = {
      service: 'cloud' as const,
      providerId: 'kling-3.0',
      version: '3.0',
      outputType: 'video' as const,
      prompt: 'New prompt',
      referenceMediaFileIds: ['frame-ref'],
    };

    const record = submitFlashBoardActiveGenerationRequest(request);
    const durableRequest = {
      ...request,
      idempotencyKey: `flashboard-video:${record?.id}`,
    };

    expect(record).toMatchObject({
      kind: 'generation',
      request: durableRequest,
      job: { status: 'queued' },
    });
    expect(getFlashBoardActiveGenerationRecords()).toContainEqual(record);
    expect(getFlashBoardPromptHistory()).toMatchObject([
      { kind: 'generation', prompt: 'New prompt' },
    ]);
    expect(submitSpy).toHaveBeenCalledWith({
      recordId: record?.id,
      request: durableRequest,
    });
  });

  it('stores project prompt history and moves reused prompts to the top', () => {
    appendFlashBoardPromptHistoryEntry({ kind: 'chat', prompt: '  Ask for variants  ' });
    appendFlashBoardPromptHistoryEntry({ kind: 'generation', prompt: 'Clean canvas' });
    appendFlashBoardPromptHistoryEntry({ kind: 'chat', prompt: 'Ask for variants' });

    expect(getFlashBoardPromptHistory()).toMatchObject([
      { kind: 'chat', prompt: 'Ask for variants' },
      { kind: 'generation', prompt: 'Clean canvas' },
    ]);
  });

  it('hydrates persisted chat messages with tool calls', () => {
    hydrateFlashBoardActiveGenerationRecords([], createDefaultFlashBoardComposer(), [], [{
      createdAt: 20,
      id: 'assistant-1',
      role: 'assistant',
      text: 'Done.',
      toolCalls: [{
        modelContent: '{"success":true}',
        result: { success: true },
        toolCall: {
          arguments: '{"trackId":0}',
          id: 'call-1',
          name: 'addClipSegment',
        },
      }],
    }]);

    expect(getFlashBoardChatMessages()).toMatchObject([{
      id: 'assistant-1',
      role: 'assistant',
      toolCalls: [{ toolCall: { name: 'addClipSegment' } }],
    }]);
  });

  it('stores multishot prompts when the generation is submitted', () => {
    vi.spyOn(flashBoardJobService, 'submit').mockReturnValue(null);

    submitFlashBoardActiveGenerationRequest({
      service: 'cloud',
      providerId: 'kling-3.0',
      version: '3.0',
      outputType: 'video',
      prompt: '',
      multiShots: true,
      multiPrompt: [
        { index: 1, prompt: 'Opening shot', duration: 2 },
        { index: 2, prompt: 'Closing shot', duration: 3 },
      ],
      referenceMediaFileIds: [],
    });

    expect(getFlashBoardPromptHistory()).toMatchObject([
      { kind: 'generation', prompt: 'Opening shot' },
      { kind: 'generation', prompt: 'Closing shot' },
    ]);
  });

  it('returns undefined for unknown records', () => {
    expect(getFlashBoardActiveGenerationRecord('missing')).toBeUndefined();
  });

  it('resubmits an orphaned in-flight generation record once after reload', async () => {
    vi.spyOn(flashBoardJobService, 'hasJob').mockReturnValue(false);
    const submitSpy = vi.spyOn(flashBoardJobService, 'submit').mockReturnValue(null);
    useFlashBoardStore.setState({
      activeGenerationRecords: [{
        ...generationRecord,
        id: 'orphaned-generation',
        job: { status: 'queued' },
      }],
      selectedActiveGenerationRecordIds: [],
      composer: createDefaultFlashBoardComposer(),
      promptHistory: [],
      hoveredComposerReference: null,
    });

    render(createElement(FlashBoardRuntimeHarness));

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect(submitSpy).toHaveBeenCalledWith({
      recordId: 'orphaned-generation',
      request: generationRecord.request,
    });
  });
});
