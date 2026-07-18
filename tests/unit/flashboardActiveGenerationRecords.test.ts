import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
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
  updateFlashBoardActiveGenerationJob,
} from '../../src/stores/flashboardStore/activeGenerationRecords';
import { createDefaultFlashBoardComposer } from '../../src/stores/flashboardStore/defaults';
import { flashBoardJobService } from '../../src/services/flashboard/FlashBoardJobService';
import { useFlashBoardRuntime } from '../../src/components/panels/flashboard/useFlashBoardRuntime';

const generationRecord = {
  id: 'generation-video',
  kind: 'generation' as const,
  createdAt: 10,
  updatedAt: 11,
  job: { status: 'processing' as const },
  request: {
    service: 'kieai' as const,
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
        service: 'kieai',
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
      service: 'kieai' as const,
      providerId: 'kling-3.0',
      version: '3.0',
      outputType: 'video' as const,
      prompt: 'New prompt',
      referenceMediaFileIds: ['frame-ref'],
    };

    const record = submitFlashBoardActiveGenerationRequest(request);

    expect(record).toMatchObject({
      kind: 'generation',
      request,
      job: { status: 'queued' },
    });
    expect(getFlashBoardActiveGenerationRecords()).toContainEqual(record);
    expect(getFlashBoardPromptHistory()).toMatchObject([
      { kind: 'generation', prompt: 'New prompt' },
    ]);
    expect(submitSpy).toHaveBeenCalledWith({
      recordId: record?.id,
      request,
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
      service: 'kieai',
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

  it('fails orphaned in-flight generation records after reload', async () => {
    vi.spyOn(flashBoardJobService, 'hasJob').mockReturnValue(false);
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

    await waitFor(() => expect(getFlashBoardActiveGenerationRecord('orphaned-generation')?.job).toMatchObject({
      status: 'failed',
      error: 'Generation was interrupted before a provider task id was created.',
    }));
  });
});
