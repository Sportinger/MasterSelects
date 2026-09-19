import { beforeEach, describe, expect, it } from 'vitest';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import {
  hydrateFlashBoardActiveGenerationRecords,
  prepareFlashBoardActiveGenerationRequest,
  resetFlashBoardActiveGenerationState,
} from '../../src/stores/flashboardStore/activeGenerationRecords';

describe('FlashBoard AI workspaces', () => {
  beforeEach(() => {
    resetFlashBoardActiveGenerationState();
  });

  it('defaults new and legacy AI Studio state to chat', () => {
    expect(useFlashBoardStore.getState().aiWorkspaces).toHaveLength(1);
    expect(useFlashBoardStore.getState().aiWorkspaces[0]).toMatchObject({
      kind: 'chat',
      title: 'Chat',
    });

    hydrateFlashBoardActiveGenerationRecords([]);

    const state = useFlashBoardStore.getState();
    expect(state.aiWorkspaces).toHaveLength(1);
    expect(state.aiWorkspaces[0]).toMatchObject({
      id: state.activeAIWorkspaceId,
      kind: 'chat',
      title: 'Chat',
    });
  });

  it('preserves a persisted non-chat workspace selection', () => {
    const chatWorkspace = useFlashBoardStore.getState().aiWorkspaces[0];
    const generationWorkspaceId = useFlashBoardStore.getState().createAIWorkspace({
      kind: 'generation',
      outputType: 'video',
    });
    const workspaces = useFlashBoardStore.getState().aiWorkspaces;

    hydrateFlashBoardActiveGenerationRecords([], undefined, [], [], workspaces, generationWorkspaceId);

    expect(useFlashBoardStore.getState().activeAIWorkspaceId).toBe(generationWorkspaceId);
    expect(useFlashBoardStore.getState().aiWorkspaces.find((workspace) => (
      workspace.id === generationWorkspaceId
    ))?.kind).toBe('generation');
    expect(useFlashBoardStore.getState().aiWorkspaces).toContainEqual(chatWorkspace);
  });

  it('keeps composer drafts and settings isolated when switching tabs', () => {
    const initialWorkspaceId = useFlashBoardStore.getState().activeAIWorkspaceId;
    useFlashBoardStore.getState().updateComposer({
      draftPrompt: 'A still image prompt',
      aspectRatio: '1:1',
    });

    const videoWorkspaceId = useFlashBoardStore.getState().createAIWorkspace({
      kind: 'generation',
      outputType: 'video',
    });
    useFlashBoardStore.getState().updateComposer({
      draftPrompt: 'A cinematic video prompt',
      aspectRatio: '21:9',
      duration: 10,
    });

    useFlashBoardStore.getState().activateAIWorkspace(initialWorkspaceId);
    expect(useFlashBoardStore.getState().composer).toMatchObject({
      draftPrompt: 'A still image prompt',
      outputType: 'image',
      aspectRatio: '1:1',
    });

    useFlashBoardStore.getState().activateAIWorkspace(videoWorkspaceId);
    expect(useFlashBoardStore.getState().composer).toMatchObject({
      draftPrompt: 'A cinematic video prompt',
      outputType: 'video',
      aspectRatio: '21:9',
      duration: 10,
    });
  });

  it('duplicates a workspace without sharing its mutable draft', () => {
    const sourceId = useFlashBoardStore.getState().activeAIWorkspaceId;
    useFlashBoardStore.getState().updateComposer({ draftPrompt: 'Original' });

    const duplicateId = useFlashBoardStore.getState().duplicateAIWorkspace(sourceId);
    expect(duplicateId).toBeTypeOf('string');
    useFlashBoardStore.getState().updateComposer({ draftPrompt: 'Variant' });

    const source = useFlashBoardStore.getState().aiWorkspaces.find((workspace) => workspace.id === sourceId);
    const duplicate = useFlashBoardStore.getState().aiWorkspaces.find((workspace) => workspace.id === duplicateId);
    expect(source?.composer.draftPrompt).toBe('Original');
    expect(duplicate?.composer.draftPrompt).toBe('Variant');
  });

  it('associates submitted generation records with the active workspace', () => {
    const workspaceId = useFlashBoardStore.getState().createAIWorkspace({
      kind: 'generation',
      outputType: 'video',
    });
    const record = prepareFlashBoardActiveGenerationRequest({
      service: 'cloud',
      providerId: 'cloud-kling',
      version: 'latest',
      outputType: 'video',
      prompt: 'Workspace-owned request',
      referenceMediaFileIds: [],
    });

    expect(record.workspaceId).toBe(workspaceId);
  });

  it('creates a background generation workspace without interrupting its chat', () => {
    const chatWorkspaceId = useFlashBoardStore.getState().createAIWorkspace({ kind: 'chat' });
    const generationWorkspaceId = useFlashBoardStore.getState().createAIWorkspace({
      kind: 'generation',
      outputType: 'image',
      draftPrompt: 'A softly lit tree',
    }, { activate: false });

    expect(useFlashBoardStore.getState().activeAIWorkspaceId).toBe(chatWorkspaceId);
    expect(useFlashBoardStore.getState().aiWorkspaces.find((workspace) => (
      workspace.id === generationWorkspaceId
    ))).toMatchObject({ kind: 'generation' });

    const record = prepareFlashBoardActiveGenerationRequest({
      service: 'cloud',
      providerId: 'nano-banana-2',
      version: 'latest',
      outputType: 'image',
      prompt: 'A softly lit tree',
      referenceMediaFileIds: [],
    }, { workspaceId: generationWorkspaceId });
    expect(record.workspaceId).toBe(generationWorkspaceId);
  });

  it('stores chat histories in their own workspaces', () => {
    const firstId = useFlashBoardStore.getState().createAIWorkspace({ kind: 'chat' });
    useFlashBoardStore.getState().setChatMessages([{ id: 'first', role: 'user', text: 'First chat' }]);
    const secondId = useFlashBoardStore.getState().createAIWorkspace({ kind: 'chat' });
    useFlashBoardStore.getState().setChatMessages([{ id: 'second', role: 'user', text: 'Second chat' }]);

    useFlashBoardStore.getState().activateAIWorkspace(firstId);
    expect(useFlashBoardStore.getState().chatMessages.map((message) => message.text)).toEqual(['First chat']);
    useFlashBoardStore.getState().activateAIWorkspace(secondId);
    expect(useFlashBoardStore.getState().chatMessages.map((message) => message.text)).toEqual(['Second chat']);
  });

  it('finishes a background chat into its originating workspace', () => {
    const firstId = useFlashBoardStore.getState().createAIWorkspace({ kind: 'chat' });
    const secondId = useFlashBoardStore.getState().createAIWorkspace({ kind: 'chat' });

    useFlashBoardStore.getState().setWorkspaceChatMessages(firstId, [{
      id: 'first-result',
      role: 'assistant',
      text: 'First chat completed in the background',
    }]);

    expect(useFlashBoardStore.getState().activeAIWorkspaceId).toBe(secondId);
    expect(useFlashBoardStore.getState().chatMessages).toEqual([]);
    expect(useFlashBoardStore.getState().aiWorkspaces.find((workspace) => (
      workspace.id === firstId
    ))?.chatMessages.map((message) => message.text)).toEqual([
      'First chat completed in the background',
    ]);
  });
});
