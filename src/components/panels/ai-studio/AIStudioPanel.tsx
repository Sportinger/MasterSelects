import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  cancelFlashBoardDirectChatRun,
  getFlashBoardDirectChatRunConversationRefsSnapshot,
  subscribeFlashBoardDirectChatRun,
} from '../../../services/flashboard/FlashBoardDirectChatRun';
import { resetDirectCodexSession } from '../../../services/flashboard/FlashBoardDirectCodexTransport';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { AIStudioChat } from './AIStudioChat';
import { AIStudioMetaballStage } from './AIStudioMetaballStage';
import { AIStudioReferenceSurface } from './AIStudioReferenceSurface';
import { AIStudioWorkspaceTab } from './AIStudioWorkspaceTab';
import './AIStudioPanel.css';

const EMPTY_CONVERSATION_REFS: readonly string[] = [];
const GENERATED_TAB_PULSE_MS = 2000;

interface WorkspaceContextMenuState {
  left: number;
  top: number;
  workspaceId: string;
}

export function AIStudioPanel() {
  const workspaces = useFlashBoardStore((state) => state.aiWorkspaces);
  const generationRecords = useFlashBoardStore((state) => state.activeGenerationRecords);
  const activeWorkspaceId = useFlashBoardStore((state) => state.activeAIWorkspaceId);
  const activateWorkspace = useFlashBoardStore((state) => state.activateAIWorkspace);
  const closeWorkspace = useFlashBoardStore((state) => state.closeAIWorkspace);
  const createWorkspace = useFlashBoardStore((state) => state.createAIWorkspace);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const chatWorkspaces = workspaces.filter((workspace) => workspace.kind === 'chat');
  const generationWorkspaces = workspaces.filter((workspace) => workspace.kind === 'generation');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenuState | null>(null);
  const [pulseClock, setPulseClock] = useState(() => Date.now());
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const runningConversationRefs = useSyncExternalStore(
    subscribeFlashBoardDirectChatRun,
    getFlashBoardDirectChatRunConversationRefsSnapshot,
    () => EMPTY_CONVERSATION_REFS,
  );
  const runningConversationRefSet = new Set(runningConversationRefs);
  const anyChatRunning = runningConversationRefs.length > 0;

  useEffect(() => {
    if (!createMenuOpen) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) setCreateMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [createMenuOpen]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = generationRecords
      .map((record) => record.createdAt + GENERATED_TAB_PULSE_MS)
      .filter((expiry) => expiry > now)
      .toSorted((left, right) => left - right)[0];
    if (nextExpiry === undefined) return undefined;
    const timeoutId = window.setTimeout(() => setPulseClock(Date.now()), nextExpiry - now + 20);
    return () => window.clearTimeout(timeoutId);
  }, [generationRecords, pulseClock]);

  const openPrimaryChat = () => {
    const existingChat = chatWorkspaces[0];
    if (existingChat) {
      activateWorkspace(existingChat.id);
      return;
    }
    createWorkspace({
      kind: 'chat',
      title: 'Chat',
      chatConversationRef: activeWorkspace?.chatConversationRef,
      composer: activeWorkspace?.composer,
      chatMessages: activeWorkspace?.chatMessages,
    });
  };

  const createChatWorkspace = () => {
    createWorkspace({
      kind: 'chat',
      title: chatWorkspaces.length === 0 ? 'Chat' : `Chat ${chatWorkspaces.length + 1}`,
    });
    setCreateMenuOpen(false);
  };

  const createGenerationWorkspace = () => {
    createWorkspace({
      kind: 'generation',
      title: generationWorkspaces.length === 0 ? 'Gen' : `Gen ${generationWorkspaces.length + 1}`,
      outputType: activeWorkspace?.composer.outputType ?? 'image',
    });
    setCreateMenuOpen(false);
  };

  const openWorkspaceMenu = (workspaceId: string, clientX: number, clientY: number) => {
    setCreateMenuOpen(false);
    setContextMenu({
      left: Math.max(6, Math.min(clientX, window.innerWidth - 118)),
      top: Math.max(6, Math.min(clientY, window.innerHeight - 54)),
      workspaceId,
    });
  };

  const removeContextWorkspace = () => {
    if (!contextMenu || workspaces.length <= 1) return;
    const workspace = workspaces.find((candidate) => candidate.id === contextMenu.workspaceId);
    if (workspace?.kind === 'chat') {
      cancelFlashBoardDirectChatRun(workspace.chatConversationRef);
      resetDirectCodexSession(workspace.chatConversationRef);
    }
    closeWorkspace(contextMenu.workspaceId);
    setContextMenu(null);
  };

  const isWorkspacePulsing = (workspaceId: string) => generationRecords.some((record) => (
    record.workspaceId === workspaceId
    && record.createdAt + GENERATED_TAB_PULSE_MS > pulseClock
  ));

  const renderWorkspaceTab = (
    workspaceId: string,
    label: string,
    conversationRef?: string,
  ) => {
    const running = conversationRef !== undefined && runningConversationRefSet.has(conversationRef);
    return (
      <AIStudioWorkspaceTab
        active={workspaceId === activeWorkspaceId}
        dimmed={anyChatRunning && !running}
        key={workspaceId}
        label={label}
        pulsing={isWorkspacePulsing(workspaceId)}
        running={running}
        workspaceId={workspaceId}
        onActivate={activateWorkspace}
        onOpenMenu={openWorkspaceMenu}
      />
    );
  };

  return (
    <section className="ai-studio" aria-label="AI Studio">
      <nav className="ai-studio-subtabs" aria-label="AI workspaces">
        {chatWorkspaces.length === 0 ? (
          <button type="button" className="ai-studio-subtab" onClick={openPrimaryChat}>
            Chat
          </button>
        ) : chatWorkspaces.map((workspace, index) => renderWorkspaceTab(
          workspace.id,
          index === 0 ? 'Chat' : `Chat ${index + 1}`,
          workspace.chatConversationRef,
        ))}
        {generationWorkspaces.map((workspace, index) => renderWorkspaceTab(
          workspace.id,
          index === 0 ? 'Gen' : `Gen ${index + 1}`,
        ))}
        <div className="ai-studio-subtab-create" ref={createMenuRef}>
          <button
            type="button"
            className={`ai-studio-subtab-add ${anyChatRunning ? 'is-run-dimmed' : ''}`}
            aria-label="New AI workspace"
            aria-expanded={createMenuOpen}
            aria-haspopup="menu"
            onClick={() => setCreateMenuOpen((open) => !open)}
            title="New Chat or Gen workspace"
          >
            +
          </button>
          {createMenuOpen && (
            <div className="ai-studio-subtab-create-menu" role="menu" aria-label="New AI workspace type">
              <button type="button" role="menuitem" onClick={createChatWorkspace}>Chat</button>
              <button type="button" role="menuitem" onClick={createGenerationWorkspace}>Gen</button>
            </div>
          )}
        </div>
      </nav>

      {contextMenu && (
        <div
          className="ai-studio-workspace-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label="Workspace actions"
          style={{ left: contextMenu.left, top: contextMenu.top } as CSSProperties}
        >
          <button
            disabled={workspaces.length <= 1}
            onClick={removeContextWorkspace}
            role="menuitem"
            title={workspaces.length <= 1 ? 'The last workspace cannot be removed' : 'Remove workspace'}
            type="button"
          >
            Remove
          </button>
        </div>
      )}

      <AIStudioReferenceSurface workspaceKind={activeWorkspace?.kind ?? 'chat'}>
        {activeWorkspace?.kind === 'chat'
          ? <AIStudioChat key={activeWorkspace.id} />
          : <AIStudioMetaballStage />}
      </AIStudioReferenceSurface>
    </section>
  );
}
