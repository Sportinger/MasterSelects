import type {
  CreateFlashBoardAIWorkspaceInput,
  FlashBoardAIWorkspace,
  FlashBoardChatMessage,
  FlashBoardComposerState,
  FlashBoardHoveredComposerReference,
  FlashBoardStoreState,
} from '../types';
import { createFlashBoardAIWorkspace } from '../defaults';

type Set = (partial: Partial<FlashBoardStoreState> | ((state: FlashBoardStoreState) => Partial<FlashBoardStoreState>)) => void;

export interface UiSliceActions {
  updateComposer: (patch: Partial<FlashBoardComposerState>) => void;
  setChatMessages: (
    updater: FlashBoardChatMessage[] | ((current: FlashBoardChatMessage[]) => FlashBoardChatMessage[]),
  ) => void;
  setWorkspaceChatMessages: (
    workspaceId: string,
    updater: FlashBoardChatMessage[] | ((current: FlashBoardChatMessage[]) => FlashBoardChatMessage[]),
  ) => void;
  rotateChatConversationRef: () => string;
  createAIWorkspace: (
    input: CreateFlashBoardAIWorkspaceInput,
    options?: { activate?: boolean },
  ) => string;
  duplicateAIWorkspace: (workspaceId: string) => string | null;
  activateAIWorkspace: (workspaceId: string) => void;
  closeAIWorkspace: (workspaceId: string) => void;
  renameAIWorkspace: (workspaceId: string, title: string) => void;
  setHoveredComposerReference: (reference: FlashBoardHoveredComposerReference | null) => void;
}

function cloneComposer(composer: FlashBoardComposerState): FlashBoardComposerState {
  return {
    ...composer,
    multiPrompt: composer.multiPrompt.map((shot) => ({ ...shot })),
    referenceMediaFileIds: [...composer.referenceMediaFileIds],
    modelSettingsByKey: Object.fromEntries(
      Object.entries(composer.modelSettingsByKey ?? {}).map(([key, value]) => [key, { ...value }]),
    ),
    voiceSettings: composer.voiceSettings ? { ...composer.voiceSettings } : undefined,
  };
}

function updateActiveWorkspace(
  state: FlashBoardStoreState,
  patch: Partial<Pick<FlashBoardAIWorkspace, 'composer' | 'chatMessages'>>,
): FlashBoardAIWorkspace[] {
  const now = Date.now();
  return state.aiWorkspaces.map((workspace) => (
    workspace.id === state.activeAIWorkspaceId
      ? { ...workspace, ...patch, updatedAt: now }
      : workspace
  ));
}

function getWorkspaceTitle(input: CreateFlashBoardAIWorkspaceInput, workspaces: FlashBoardAIWorkspace[]): string {
  if (input.title?.trim()) return input.title.trim();
  const base = input.kind === 'chat'
    ? 'Chat'
    : input.kind === 'download'
      ? 'Downloads'
      : input.outputType === 'video'
        ? 'Video'
        : input.outputType === 'audio'
          ? 'Audio'
          : 'Image';
  const count = workspaces.filter((workspace) => workspace.title.startsWith(base)).length;
  return input.kind === 'download' ? base : `${base} ${count + 1}`;
}

export const createUiSlice = (set: Set): UiSliceActions => ({
  updateComposer: (patch: Partial<FlashBoardComposerState>): void => {
    set((state) => ({
      composer: (() => {
        const composer = {
        ...state.composer,
        ...patch,
        generateAudio: patch.generateAudio ?? state.composer.generateAudio ?? false,
        multiShots: patch.multiShots ?? state.composer.multiShots ?? false,
        multiPrompt: patch.multiPrompt ?? state.composer.multiPrompt ?? [],
        referenceMediaFileIds: patch.referenceMediaFileIds ?? state.composer.referenceMediaFileIds ?? [],
        };
        return composer;
      })(),
      aiWorkspaces: updateActiveWorkspace(state, {
        composer: {
          ...state.composer,
          ...patch,
          generateAudio: patch.generateAudio ?? state.composer.generateAudio ?? false,
          multiShots: patch.multiShots ?? state.composer.multiShots ?? false,
          multiPrompt: patch.multiPrompt ?? state.composer.multiPrompt ?? [],
          referenceMediaFileIds: patch.referenceMediaFileIds ?? state.composer.referenceMediaFileIds ?? [],
        },
      }),
    }));
  },

  setChatMessages: (updater): void => {
    set((state) => {
      const chatMessages = typeof updater === 'function' ? updater(state.chatMessages) : updater;
      return {
        chatMessages,
        aiWorkspaces: updateActiveWorkspace(state, { chatMessages }),
      };
    });
  },

  setWorkspaceChatMessages: (workspaceId, updater): void => {
    set((state) => {
      const workspace = state.aiWorkspaces.find((candidate) => candidate.id === workspaceId);
      if (!workspace) return {};
      const chatMessages = typeof updater === 'function'
        ? updater(workspace.chatMessages)
        : updater;
      return {
        ...(state.activeAIWorkspaceId === workspaceId ? { chatMessages } : {}),
        aiWorkspaces: state.aiWorkspaces.map((candidate) => (
          candidate.id === workspaceId
            ? { ...candidate, chatMessages, updatedAt: Date.now() }
            : candidate
        )),
      };
    });
  },

  rotateChatConversationRef: (): string => {
    const chatConversationRef = crypto.randomUUID();
    set((state) => ({
      aiWorkspaces: state.aiWorkspaces.map((workspace) => (
        workspace.id === state.activeAIWorkspaceId
          ? { ...workspace, chatConversationRef, updatedAt: Date.now() }
          : workspace
      )),
    }));
    return chatConversationRef;
  },

  createAIWorkspace: (input, options): string => {
    let createdId = '';
    set((state) => {
      const workspace = createFlashBoardAIWorkspace(input, getWorkspaceTitle(input, state.aiWorkspaces));
      createdId = workspace.id;
      if (options?.activate === false) {
        return { aiWorkspaces: [...state.aiWorkspaces, workspace] };
      }
      return {
        aiWorkspaces: [...state.aiWorkspaces, workspace],
        activeAIWorkspaceId: workspace.id,
        composer: cloneComposer(workspace.composer),
        chatMessages: [...workspace.chatMessages],
        hoveredComposerReference: null,
      };
    });
    return createdId;
  },

  duplicateAIWorkspace: (workspaceId): string | null => {
    let duplicateId: string | null = null;
    set((state) => {
      const source = state.aiWorkspaces.find((workspace) => workspace.id === workspaceId);
      if (!source) return {};
      const duplicate = createFlashBoardAIWorkspace({
        kind: source.kind,
        title: `${source.title} copy`,
        composer: cloneComposer(source.composer),
        chatMessages: source.chatMessages.map((message) => ({ ...message })),
      });
      duplicateId = duplicate.id;
      return {
        aiWorkspaces: [...state.aiWorkspaces, duplicate],
        activeAIWorkspaceId: duplicate.id,
        composer: cloneComposer(duplicate.composer),
        chatMessages: [...duplicate.chatMessages],
        hoveredComposerReference: null,
      };
    });
    return duplicateId;
  },

  activateAIWorkspace: (workspaceId): void => {
    set((state) => {
      if (workspaceId === state.activeAIWorkspaceId) return {};
      const workspace = state.aiWorkspaces.find((candidate) => candidate.id === workspaceId);
      if (!workspace) return {};
      return {
        activeAIWorkspaceId: workspace.id,
        composer: cloneComposer(workspace.composer),
        chatMessages: [...workspace.chatMessages],
        hoveredComposerReference: null,
      };
    });
  },

  closeAIWorkspace: (workspaceId): void => {
    set((state) => {
      if (state.aiWorkspaces.length <= 1) return {};
      const removedIndex = state.aiWorkspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (removedIndex < 0) return {};
      const aiWorkspaces = state.aiWorkspaces.filter((workspace) => workspace.id !== workspaceId);
      if (workspaceId !== state.activeAIWorkspaceId) return { aiWorkspaces };
      const nextWorkspace = aiWorkspaces[Math.min(removedIndex, aiWorkspaces.length - 1)];
      return {
        aiWorkspaces,
        activeAIWorkspaceId: nextWorkspace.id,
        composer: cloneComposer(nextWorkspace.composer),
        chatMessages: [...nextWorkspace.chatMessages],
        hoveredComposerReference: null,
      };
    });
  },

  renameAIWorkspace: (workspaceId, title): void => {
    const safeTitle = title.trim().slice(0, 60);
    if (!safeTitle) return;
    set((state) => ({
      aiWorkspaces: state.aiWorkspaces.map((workspace) => (
        workspace.id === workspaceId
          ? { ...workspace, title: safeTitle, updatedAt: Date.now() }
          : workspace
      )),
    }));
  },

  setHoveredComposerReference: (reference: FlashBoardHoveredComposerReference | null): void => {
    set({ hoveredComposerReference: reference });
  },
});
