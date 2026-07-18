import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationMetadata,
  FlashBoardPromptHistoryEntry,
} from '../../../stores/flashboardStore';
import type { AIProvider } from '../../../stores/settingsStore';
import {
  type SavedAiSystemPrompt,
} from '../../../services/aiPromptLibrary';
import { flashBoardMediaBridge } from '../../../services/flashboard/FlashBoardMediaBridge';
import { redactFlashBoardChatImageData } from '../../../services/flashboard/FlashBoardChatImageData';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';
import { PromptBookSparkles } from './PromptBookSparkles';
import { useBookOpening, usePrefersReducedMotion, usePromptBookTurnSheet } from './promptBookAnimations';

interface FlashBoardPromptBookProps {
  activeSystemPrompt?: string;
  activeSystemPromptProvider?: AIProvider;
  chatMessages?: FlashBoardChatMessage[];
  entries: FlashBoardPromptHistoryEntry[];
  generationRecords: FlashBoardActiveGenerationRecord[];
  initialKind?: PromptBookKind;
  isPromptLibraryLoading?: boolean;
  mediaFiles: MediaFile[];
  copiedEntryId: string | null;
  projectPromptStorageReady?: boolean;
  promptDialogError?: string | null;
  promptDialogStatus?: string | null;
  promptDraft?: string;
  promptHasOverride?: boolean;
  promptNameDraft?: string;
  promptSendContext?: boolean;
  savedSystemPrompts?: SavedAiSystemPrompt[];
  selectedPromptFile?: string;
  onClose: () => void;
  onCopy: (prompt: string, pageId: string) => void;
  onDeleteSystemPrompt?: () => void;
  onLoadSystemPrompt?: (fileName?: string) => void;
  onOverwriteSystemPrompt?: () => void;
  onRefreshSystemPrompts?: () => void;
  onResetSystemPromptDraft?: () => void;
  onSaveSystemPrompt?: () => void;
  onSetPromptDraft?: (prompt: string) => void;
  onSetPromptSendContext?: (sendContext: boolean) => void;
  onSetPromptName?: (name: string) => void;
  onSetSelectedPromptFile?: (fileName: string) => void;
  onApplySystemPromptDraft?: () => void;
}

const EMPTY_SAVED_SYSTEM_PROMPTS: SavedAiSystemPrompt[] = [];
const EMPTY_FLASHBOARD_CHAT_MESSAGES: FlashBoardChatMessage[] = [];
const EMPTY_PROMPT_BOOK_CHAT_MESSAGES: PromptBookChatTurn[] = [];

type PromptBookKind = FlashBoardPromptHistoryEntry['kind'] | 'system';

interface PromptBookRun {
  id: string;
  settings: string[];
  title: string;
}

type PromptBookRunSource = FlashBoardActiveGenerationRecord | FlashBoardGenerationMetadata;
type PromptBookMediaSource = 'user' | 'magic';

interface PromptBookMedia {
  id: string;
  name: string;
  source: PromptBookMediaSource;
  thumbnailUrl?: string;
  type: 'image' | 'video';
  url: string;
}

interface PromptBookMediaGroup {
  items: Array<{
    media: PromptBookMedia;
    run?: PromptBookRun;
  }>;
  source: PromptBookMediaSource;
}

interface PromptBookChatTurn {
  createdAt: number;
  id: string;
  role: FlashBoardChatMessage['role'];
  text: string;
  isError?: boolean;
  isPending?: boolean;
  toolCalls: PromptBookToolCall[];
}

interface PromptBookToolCall {
  body: string;
  createdAt: number;
  id: string;
  title: string;
}

type PromptBookExecutedToolCall = NonNullable<FlashBoardChatMessage['toolCalls']>[number];

interface PromptBookPage {
  id: string;
  kind: PromptBookKind;
  createdAt: number;
  chatMessages?: PromptBookChatTurn[];
  provider?: AIProvider;
  title?: string;
  toolCalls?: PromptBookToolCall[];
  userPrompt: string;
  magicPrompt?: string;
  media: PromptBookMedia[];
  runs: PromptBookRun[];
}

const PROMPT_BOOK_KINDS: Array<{ kind: PromptBookKind; label: string }> = [
  { kind: 'generation', label: 'Gen' },
  { kind: 'system', label: 'System prompt' },
  { kind: 'chat', label: 'Chat' },
];

function trimPrompt(prompt: string | null | undefined): string {
  return prompt?.trim() ?? '';
}

function formatPromptBookTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(createdAt));
}

function formatPromptBookDay(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(createdAt));
}

function getPromptBookDayKey(createdAt: number): string {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatSystemPromptProvider(provider: AIProvider | undefined): string {
  return provider === 'lemonade' ? 'Lemonade' : 'OpenAI';
}

function formatPromptBookKind(kind: PromptBookPage['kind']): string {
  return kind === 'generation' ? 'Gen' : kind === 'system' ? 'System' : 'Chat';
}

function formatPromptBookChatRole(role: FlashBoardChatMessage['role']): string {
  return role === 'user' ? 'You' : 'AI';
}

function formatPromptBookPageLabel(page: PromptBookPage): string {
  if (page.kind === 'chat') return formatPromptBookDay(page.createdAt);
  const label = trimPrompt(page.kind === 'system' ? page.title : page.userPrompt) || formatPromptBookKind(page.kind);
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
}

function buildPromptBookCopyText(page: PromptBookPage): string {
  if (page.kind !== 'chat') return page.magicPrompt ?? page.userPrompt;
  return (page.chatMessages ?? [])
    .map((message) => `${formatPromptBookChatRole(message.role)}: ${stripPromptBookToolBlocks(message.text) || message.text}`)
    .join('\n\n');
}

function addRunSetting(settings: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '' || value === false) return;
  settings.push(`${label} ${String(value)}`);
}

function formatGenerationRun(source: PromptBookRunSource): PromptBookRun {
  const request = 'kind' in source ? source.request : source;
  const titleParts = [
    request?.providerId || request?.service || 'Generation',
    request?.version,
  ].filter(Boolean);
  const settings: string[] = [];
  addRunSetting(settings, 'Mode', request?.mode);
  addRunSetting(settings, 'Size', request?.imageSize);
  addRunSetting(settings, 'Aspect', request?.aspectRatio);
  addRunSetting(settings, 'Duration', request?.duration ? `${request.duration}s` : undefined);
  addRunSetting(settings, 'Audio', request?.generateAudio ? 'on' : undefined);
  addRunSetting(settings, 'Shots', request?.multiShots ? request.multiPrompt?.length || 'multi' : undefined);

  return {
    id: 'kind' in source ? source.id : source.mediaFileId,
    settings,
    title: titleParts.join(' / '),
  };
}

function addPromptBookMedia(page: PromptBookPage, mediaFile: MediaFile, source: PromptBookMediaSource = 'user'): void {
  const existing = page.media.find((item) => item.id === mediaFile.id);
  if (existing) {
    if (source === 'magic') existing.source = source;
    return;
  }
  if (
    (mediaFile.type === 'image' || mediaFile.type === 'video')
  ) {
    page.media.push({
      id: mediaFile.id,
      name: mediaFile.name,
      source,
      thumbnailUrl: mediaFile.thumbnailUrl,
      type: mediaFile.type,
      url: mediaFile.url,
    });
  }
}

function ensureGenerationPage(
  pagesByPrompt: Map<string, PromptBookPage>,
  userPrompt: string,
  createdAt: number,
  magicPrompt?: string,
): PromptBookPage {
  const pageId = `generation:${userPrompt}`;
  let page = pagesByPrompt.get(pageId);
  if (!page) {
    page = {
      id: pageId,
      kind: 'generation',
      createdAt,
      userPrompt,
      magicPrompt,
      media: [],
      runs: [],
    };
    pagesByPrompt.set(pageId, page);
  } else {
    page.createdAt = Math.max(page.createdAt, createdAt);
    page.magicPrompt ??= magicPrompt;
  }
  return page;
}

function addPromptBookRun(page: PromptBookPage, run: PromptBookRun): void {
  if (!page.runs.some((candidate) => candidate.id === run.id)) {
    page.runs.push(run);
  }
}

function formatPromptBookMediaSource(source: PromptBookMediaSource): string {
  return source === 'magic' ? 'Magic wand prompt' : 'User prompt';
}

function buildPromptBookMediaGroups(page: PromptBookPage | null): PromptBookMediaGroup[] {
  if (!page || page.kind !== 'generation') return [];
  const groups: PromptBookMediaGroup[] = [
    { source: 'user', items: [] },
    { source: 'magic', items: [] },
  ];
  for (const [index, media] of page.media.entries()) {
    const group = groups.find((candidate) => candidate.source === media.source);
    group?.items.push({ media, run: page.runs[index] ?? page.runs[0] });
  }
  return groups.filter((group) => group.items.length > 0);
}

function stripPromptBookToolBlocks(text: string): string {
  return text.replace(/```tool[\s\S]*?```/gi, '').trim();
}

function getPromptBookChatBubbleText(message: PromptBookChatTurn): string {
  return stripPromptBookToolBlocks(message.text) || 'Tool call';
}

function extractPromptBookToolCalls(message: PromptBookChatTurn): PromptBookToolCall[] {
  const calls: PromptBookToolCall[] = [];
  const pattern = /```tool\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message.text)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    const title = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'Tool call';
    calls.push({
      body,
      createdAt: message.createdAt,
      id: `${message.id}:tool:${calls.length}`,
      title: title.length > 72 ? `${title.slice(0, 69)}...` : title,
    });
  }
  return calls;
}

function formatPromptBookToolJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatPromptBookToolResult(result: unknown): string {
  const redacted = redactFlashBoardChatImageData(result);
  return typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);
}

function formatPromptBookExecutedToolBody(toolCall: PromptBookExecutedToolCall): string {
  const args = toolCall.toolCall.arguments.trim();
  const sections: string[] = [];
  if (args) sections.push(`Arguments\n${formatPromptBookToolJson(args)}`);
  sections.push(`Result\n${formatPromptBookToolResult(toolCall.result)}`);
  sections.push(`Model content\n${toolCall.modelContent}`);
  return sections.join('\n\n');
}

function getPromptBookExecutedToolCalls(message: FlashBoardChatMessage, createdAt: number): PromptBookToolCall[] {
  return (message.toolCalls ?? []).map((toolCall, index) => ({
    body: formatPromptBookExecutedToolBody(toolCall),
    createdAt,
    id: `${message.id}:executed-tool:${toolCall.toolCall.id || index}`,
    title: `${toolCall.toolCall.name}${toolCall.result.success ? ' done' : ' failed'}`,
  }));
}

function buildPromptBookChatPages(
  entries: FlashBoardPromptHistoryEntry[],
  chatMessages: FlashBoardChatMessage[],
): PromptBookPage[] {
  const chatEntries = entries.filter((entry) => entry.kind === 'chat' && trimPrompt(entry.prompt));
  const fallbackMessages: FlashBoardChatMessage[] = chatMessages.length > 0
    ? chatMessages
    : chatEntries.map((entry) => ({
      createdAt: entry.createdAt,
      id: entry.id,
      role: 'user' as const,
      text: entry.prompt,
    }));
  const pagesByDay = new Map<string, PromptBookPage>();
  let fallbackEntryIndex = 0;
  let lastCreatedAt = chatEntries[0]?.createdAt ?? Date.now();

  for (const message of fallbackMessages) {
    const matchedEntry = message.createdAt === undefined && message.role === 'user'
      ? chatEntries.slice(fallbackEntryIndex).find((entry, offset) => {
        if (entry.prompt !== message.text) return false;
        fallbackEntryIndex += offset + 1;
        return true;
      })
      : undefined;
    const createdAt = message.createdAt ?? matchedEntry?.createdAt ?? lastCreatedAt;
    lastCreatedAt = createdAt;
    const dayKey = getPromptBookDayKey(createdAt);
    let page = pagesByDay.get(dayKey);
    if (!page) {
      page = {
        id: `chat:${dayKey}`,
        kind: 'chat',
        createdAt,
        userPrompt: formatPromptBookDay(createdAt),
        chatMessages: [],
        toolCalls: [],
        media: [],
        runs: [],
      };
      pagesByDay.set(dayKey, page);
    }
    page.createdAt = Math.max(page.createdAt, createdAt);
    const turn: PromptBookChatTurn = {
      createdAt,
      id: message.id,
      isError: message.isError,
      isPending: message.isPending,
      role: message.role,
      text: message.text,
      toolCalls: [],
    };
    turn.toolCalls = [
      ...getPromptBookExecutedToolCalls(message, createdAt),
      ...extractPromptBookToolCalls(turn),
    ];
    page.chatMessages?.push(turn);
    page.toolCalls?.push(...turn.toolCalls);
  }

  return [...pagesByDay.values()];
}

function getPromptBookTurnIndex(pages: PromptBookPage[], currentIndex: number, direction: -1 | 1): number {
  const kind = pages[currentIndex]?.kind;
  if (!kind) return currentIndex;
  for (let index = currentIndex + direction; index >= 0 && index < pages.length; index += direction) {
    if (pages[index]?.kind === kind) return index;
  }
  return currentIndex;
}

function buildPromptBookPages(
  entries: FlashBoardPromptHistoryEntry[],
  chatMessages: FlashBoardChatMessage[],
  generationRecords: FlashBoardActiveGenerationRecord[],
  mediaFiles: MediaFile[],
  activeSystemPrompt: string | undefined,
  activeSystemPromptProvider: AIProvider | undefined,
): PromptBookPage[] {
  const mediaFilesById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile]));
  const generationPagesByPrompt = new Map<string, PromptBookPage>();
  const systemPromptPages: PromptBookPage[] = [];
  const activeSystemPromptText = trimPrompt(activeSystemPrompt);
  if (activeSystemPromptText) {
    systemPromptPages.push({
      id: `system:active:${activeSystemPromptProvider ?? 'openai'}`,
      kind: 'system',
      createdAt: Date.now(),
      provider: activeSystemPromptProvider,
      title: 'Current system prompt',
      userPrompt: activeSystemPromptText,
      media: [],
      runs: [],
    });
  }

  for (const record of generationRecords) {
    const finalPrompt = trimPrompt(record.request?.prompt);
    const originalPrompt = trimPrompt(record.request?.originalPrompt);
    const userPrompt = originalPrompt || finalPrompt;
    if (!userPrompt) continue;

    const run = formatGenerationRun(record);
    const magicPrompt = originalPrompt && finalPrompt && originalPrompt !== finalPrompt
      ? finalPrompt
      : undefined;
    const page = ensureGenerationPage(generationPagesByPrompt, userPrompt, record.createdAt, magicPrompt);
    addPromptBookRun(page, run);

    const mediaFileId = record.result?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFilesById.get(mediaFileId) : undefined;
    if (mediaFile) {
      addPromptBookMedia(page, mediaFile, magicPrompt ? 'magic' : 'user');
    }
  }

  for (const mediaFile of mediaFiles) {
    const metadata = flashBoardMediaBridge.getMetadata(mediaFile.id);
    const finalPrompt = trimPrompt(metadata?.prompt);
    const originalPrompt = trimPrompt(metadata?.originalPrompt);
    const userPrompt = originalPrompt || finalPrompt;
    if (!metadata || !userPrompt) continue;

    const magicPrompt = originalPrompt && finalPrompt && originalPrompt !== finalPrompt ? finalPrompt : undefined;
    const createdAt = Date.parse(metadata.createdAt) || mediaFile.createdAt;
    const page = ensureGenerationPage(generationPagesByPrompt, userPrompt, createdAt, magicPrompt);
    const pageAlreadyHasMedia = page.media.some((item) => item.id === mediaFile.id);
    if (!pageAlreadyHasMedia) addPromptBookRun(page, formatGenerationRun(metadata));
    addPromptBookMedia(page, mediaFile, magicPrompt ? 'magic' : 'user');
  }

  const generationPromptKeys = new Set<string>();
  for (const page of generationPagesByPrompt.values()) {
    generationPromptKeys.add(page.userPrompt);
    if (page.magicPrompt) generationPromptKeys.add(page.magicPrompt);
  }

  const pages = [...systemPromptPages, ...generationPagesByPrompt.values(), ...buildPromptBookChatPages(entries, chatMessages)];
  for (const entry of entries) {
    const prompt = trimPrompt(entry.prompt);
    if (!prompt) continue;
    if (entry.kind === 'chat') continue;
    if (entry.kind === 'generation' && generationPromptKeys.has(prompt)) continue;
    pages.push({
      id: entry.id,
      kind: entry.kind,
      createdAt: entry.createdAt,
      userPrompt: prompt,
      media: [],
      runs: [],
    });
  }

  return pages.toSorted((left, right) => right.createdAt - left.createdAt);
}

function PromptBookVideo({
  active,
  media,
}: {
  active: boolean;
  media: PromptBookMedia;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.volume = 0;
    if (active) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, media.url]);

  return (
    <video
      ref={videoRef}
      src={media.url}
      poster={media.thumbnailUrl}
      muted
      loop
      playsInline
      preload={active ? 'auto' : 'metadata'}
    />
  );
}

export function FlashBoardPromptBook({
  activeSystemPrompt,
  activeSystemPromptProvider,
  chatMessages = EMPTY_FLASHBOARD_CHAT_MESSAGES,
  entries,
  generationRecords,
  initialKind,
  isPromptLibraryLoading = false,
  mediaFiles,
  copiedEntryId,
  projectPromptStorageReady = false,
  promptDialogError = null,
  promptDialogStatus = null,
  promptDraft,
  promptHasOverride = false,
  promptNameDraft = '',
  promptSendContext = true,
  savedSystemPrompts = EMPTY_SAVED_SYSTEM_PROMPTS,
  selectedPromptFile = '',
  onClose,
  onCopy,
  onDeleteSystemPrompt,
  onLoadSystemPrompt,
  onOverwriteSystemPrompt,
  onRefreshSystemPrompts,
  onResetSystemPromptDraft,
  onSaveSystemPrompt,
  onSetPromptDraft,
  onSetPromptSendContext,
  onSetPromptName,
  onSetSelectedPromptFile,
  onApplySystemPromptDraft,
}: FlashBoardPromptBookProps) {
  const setSourceMonitorFile = useMediaStore((state) => state.setSourceMonitorFile);
  const prefersReducedMotion = usePrefersReducedMotion();
  const bookOpening = useBookOpening(!prefersReducedMotion);
  const { beginTurn, finishTurn, turnSheet } = usePromptBookTurnSheet(!prefersReducedMotion);
  const [editingSystemPrompt, setEditingSystemPrompt] = useState(false);
  const [visibleChatTime, setVisibleChatTime] = useState<{ pageId: string; value: number } | null>(null);
  const [chatRowHeights, setChatRowHeights] = useState<{
    pageId: string;
    values: Record<string, number>;
  } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatToolScrollRef = useRef<HTMLDivElement | null>(null);
  const chatTurnRefs = useRef(new Map<string, HTMLDivElement>());
  const mediaClickTimerRef = useRef<number | null>(null);
  const syncingChatScrollRef = useRef(false);

  const pages = useMemo(
    () => buildPromptBookPages(
      entries,
      chatMessages,
      generationRecords,
      mediaFiles,
      activeSystemPrompt,
      activeSystemPromptProvider,
    ),
    [activeSystemPrompt, activeSystemPromptProvider, chatMessages, entries, generationRecords, mediaFiles],
  );
  const initialPageIndex = initialKind ? pages.findIndex((page) => page.kind === initialKind) : -1;
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, initialPageIndex));
  const [syncedInitialPageIndex, setSyncedInitialPageIndex] = useState(initialPageIndex);
  const lastPageIndex = Math.max(0, pages.length - 1);
  if (initialPageIndex !== syncedInitialPageIndex) {
    setSyncedInitialPageIndex(initialPageIndex);
    if (initialPageIndex >= 0) setPageIndex(initialPageIndex);
  } else if (pageIndex > lastPageIndex) {
    setPageIndex(lastPageIndex);
  }
  const canGoBack = getPromptBookTurnIndex(pages, pageIndex, -1) !== pageIndex;
  const canGoForward = getPromptBookTurnIndex(pages, pageIndex, 1) !== pageIndex;
  const activePage = pages[pageIndex] ?? null;
  const activeChatMessages = activePage?.kind === 'chat'
    ? activePage.chatMessages ?? EMPTY_PROMPT_BOOK_CHAT_MESSAGES
    : EMPTY_PROMPT_BOOK_CHAT_MESSAGES;
  const displayedPageTime = activePage?.kind === 'chat'
    ? (visibleChatTime?.pageId === activePage.id ? visibleChatTime.value : null)
      ?? activeChatMessages[0]?.createdAt
      ?? activePage.createdAt
    : activePage?.createdAt;
  const mediaGroups = useMemo(() => buildPromptBookMediaGroups(activePage), [activePage]);
  const pageDayGroups = useMemo(() => {
    const activeKind = activePage?.kind;
    const groups: Array<{ day: string; pages: Array<{ index: number; page: PromptBookPage }> }> = [];
    for (const [index, page] of pages.entries()) {
      if (activeKind && page.kind !== activeKind) continue;
      const day = formatPromptBookDay(page.createdAt);
      let group = groups[groups.length - 1];
      if (!group || group.day !== day) {
        group = { day, pages: [] };
        groups.push(group);
      }
      group.pages.push({ index, page });
    }
    return groups;
  }, [activePage?.kind, pages]);

  const navigateToIndex = useCallback((index: number) => {
    if (index === pageIndex || !pages[index]) return;
    beginTurn(index > pageIndex ? 1 : -1);
    setPageIndex(index);
  }, [beginTurn, pageIndex, pages]);

  const turnPage = useCallback((direction: -1 | 1) => {
    navigateToIndex(getPromptBookTurnIndex(pages, pageIndex, direction));
  }, [navigateToIndex, pageIndex, pages]);

  const updateVisibleChatTime = useCallback(() => {
    if (activePage?.kind !== 'chat') return;
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const visibleMessage = activeChatMessages.find((message) => {
      const element = chatTurnRefs.current.get(message.id);
      return element ? element.getBoundingClientRect().bottom >= scrollerTop + 8 : false;
    });
    const value = visibleMessage?.createdAt ?? activeChatMessages.at(-1)?.createdAt ?? activePage.createdAt;
    setVisibleChatTime(current => current?.pageId === activePage.id && current.value === value
      ? current
      : { pageId: activePage.id, value });
  }, [activeChatMessages, activePage]);

  useEffect(() => {
    if (activePage?.kind !== 'chat') return undefined;
    const pageId = activePage.id;

    const updateHeights = () => {
      const nextHeights: Record<string, number> = {};
      for (const message of activeChatMessages) {
        const element = chatTurnRefs.current.get(message.id);
        if (element) nextHeights[message.id] = Math.ceil(element.getBoundingClientRect().height);
      }
      setChatRowHeights((current) => (
        current?.pageId === pageId
        && Object.keys(nextHeights).length === Object.keys(current.values).length
        && Object.entries(nextHeights).every(([id, height]) => current.values[id] === height)
          ? current
          : { pageId, values: nextHeights }
      ));
      updateVisibleChatTime();
    };

    updateHeights();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeights);
      return () => window.removeEventListener('resize', updateHeights);
    }

    const observer = new ResizeObserver(updateHeights);
    for (const message of activeChatMessages) {
      const element = chatTurnRefs.current.get(message.id);
      if (element) observer.observe(element);
    }
    window.addEventListener('resize', updateHeights);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeights);
    };
  }, [activeChatMessages, activePage?.id, activePage?.kind, updateVisibleChatTime]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        turnPage(-1);
      } else if (event.key === 'ArrowRight') {
        turnPage(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, turnPage]);

  const clearMediaClickTimer = useCallback(() => {
    if (mediaClickTimerRef.current === null) return;
    window.clearTimeout(mediaClickTimerRef.current);
    mediaClickTimerRef.current = null;
  }, []);

  useEffect(() => () => clearMediaClickTimer(), [clearMediaClickTimer]);

  const handleSpreadPageClick = (event: MouseEvent<HTMLElement>, direction: -1 | 1) => {
    if ((event.target as HTMLElement).closest('button, summary, details, a, input, textarea, select, .fb-prompt-book-media-tile')) return;
    if (window.getSelection()?.toString()) return;
    turnPage(direction);
  };

  const handleMediaClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    clearMediaClickTimer();
    if (event.detail > 1) return;
    mediaClickTimerRef.current = window.setTimeout(() => {
      mediaClickTimerRef.current = null;
      turnPage(1);
    }, 75);
  };

  const handleMediaDoubleClick = (event: MouseEvent<HTMLElement>, mediaFileId: string) => {
    event.stopPropagation();
    clearMediaClickTimer();
    setSourceMonitorFile(mediaFileId);
    onClose();
  };

  const handleChatScroll = (source: 'chat' | 'tools') => {
    if (source === 'tools') return;
    if (syncingChatScrollRef.current) return;
    const sourceScroller = source === 'chat' ? chatScrollRef.current : chatToolScrollRef.current;
    const targetScroller = source === 'chat' ? chatToolScrollRef.current : chatScrollRef.current;
    if (!sourceScroller || !targetScroller) return;

    syncingChatScrollRef.current = true;
    targetScroller.scrollTop = sourceScroller.scrollTop;
    window.requestAnimationFrame(() => {
      syncingChatScrollRef.current = false;
    });
    updateVisibleChatTime();
  };

  const setChatTurnRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element) {
      chatTurnRefs.current.set(id, element);
    } else {
      chatTurnRefs.current.delete(id);
    }
  };

  const goToFirstKind = (kind: PromptBookKind) => {
    const index = pages.findIndex((page) => page.kind === kind);
    if (index >= 0) {
      if (kind === 'system') onSetPromptDraft?.(pages[index]?.userPrompt ?? '');
      navigateToIndex(index);
    }
  };

  const selectedSystemPrompt = savedSystemPrompts.find((prompt) => prompt.fileName === selectedPromptFile);
  const systemPromptEditorValue = promptDraft ?? activePage?.userPrompt ?? '';
  const systemPromptFeedback = promptDialogError || promptDialogStatus || (
    !projectPromptStorageReady ? 'Open a project to use saved presets.' : null
  );
  const canEditSystemPrompt = activePage?.kind === 'system' && Boolean(onSetPromptDraft);
  const canUseSystemPresets = activePage?.kind === 'system' && projectPromptStorageReady;
  const selectedSystemPromptUpdatedAt = selectedSystemPrompt
    ? Date.parse(selectedSystemPrompt.updatedAt) || activePage?.createdAt || 0
    : 0;

  const promptBook = (
    <div className="fb-prompt-book-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="fb-prompt-book" role="dialog" aria-modal="true" aria-label="Prompt book" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="fb-prompt-book-close" onClick={onClose} aria-label="Close prompt book">
          &times;
        </button>

        <div className="fb-prompt-book-stage">
          <div className={`fb-prompt-book-volume ${bookOpening ? 'is-opening' : ''}`} aria-live="polite">
            <div className="fb-prompt-book-cover-shell" aria-hidden="true" />
            <div className="fb-prompt-book-page-edges" aria-hidden="true" />
            <div className="fb-prompt-book-jump-nav">
              <div className="fb-prompt-book-page-pills" aria-label="Prompt pages">
                {pageDayGroups.flatMap((group) => group.pages).map(({ index, page }) => (
                  <button
                    type="button"
                    className={`fb-prompt-book-jump-pill page ${pageIndex === index ? 'active' : ''}`}
                    key={page.id}
                    onClick={() => navigateToIndex(index)}
                    title={page.userPrompt}
                  >
                    {formatPromptBookPageLabel(page)}
                  </button>
                ))}
              </div>
            </div>
            <div className="fb-prompt-book-kind-pills" aria-label="Prompt type">
              {PROMPT_BOOK_KINDS.map(({ kind, label }) => {
                const available = pages.some((page) => page.kind === kind);
                return (
                  <button
                    type="button"
                    className={`fb-prompt-book-jump-pill ${activePage?.kind === kind ? 'active' : ''}`}
                    disabled={!available}
                    key={kind}
                    onClick={() => goToFirstKind(kind)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="fb-prompt-book-spine" aria-hidden="true" />

            {!activePage ? (
              <div className="fb-prompt-book-spread">
                <article className="fb-prompt-book-page-face fb-prompt-book-left-page is-empty">
                  <div className="fb-prompt-book-empty">No prompts yet.</div>
                </article>
                <article className="fb-prompt-book-page-face fb-prompt-book-right-page is-empty" />
              </div>
            ) : (
              <div className={`fb-prompt-book-spread ${activePage.kind}`} key={activePage.id}>
                <article
                  className="fb-prompt-book-page-face fb-prompt-book-left-page"
                  onClick={(event) => handleSpreadPageClick(event, -1)}
                  title={canGoBack ? 'Previous prompt' : undefined}
                >
                  <div className="fb-prompt-book-entry-meta">
                    <span>{activePage.kind === 'system' ? 'System' : activePage.kind === 'chat' ? 'Chat' : 'Gen'}</span>
                    {displayedPageTime !== undefined && (
                      <time dateTime={new Date(displayedPageTime).toISOString()}>{formatPromptBookTime(displayedPageTime)}</time>
                    )}
                  </div>
                  {activePage.kind === 'chat' && (
                    <div className="fb-prompt-book-chat-head">
                      <div className="fb-prompt-book-section-label">Chat history</div>
                      <button type="button" onClick={() => onCopy(buildPromptBookCopyText(activePage), activePage.id)}>
                        {copiedEntryId === activePage.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                  <div
                    className="fb-prompt-book-page-scroll"
                    onScroll={activePage.kind === 'chat' ? () => handleChatScroll('chat') : undefined}
                    ref={activePage.kind === 'chat' ? chatScrollRef : undefined}
                  >
                    {activePage.kind === 'chat' ? (
                        <div className="fb-prompt-book-chat-log">
                          {(activePage.chatMessages ?? []).map((message) => (
                            <div
                              className={`fb-prompt-book-chat-turn ${message.role} ${message.isError ? 'is-error' : ''} ${message.isPending ? 'is-pending' : ''}`}
                              key={message.id}
                              ref={setChatTurnRef(message.id)}
                            >
                              <div className="fb-prompt-book-chat-turn-meta">
                                <span>{message.isError ? 'Error' : formatPromptBookChatRole(message.role)}</span>
                                <button
                                  className="fb-prompt-book-bubble-copy"
                                  type="button"
                                  onClick={() => onCopy(getPromptBookChatBubbleText(message), message.id)}
                                >
                                  {copiedEntryId === message.id ? 'Copied' : 'Copy'}
                                </button>
                                <time dateTime={new Date(message.createdAt).toISOString()}>{formatPromptBookTime(message.createdAt)}</time>
                              </div>
                              <p>{getPromptBookChatBubbleText(message)}</p>
                            </div>
                          ))}
                        </div>
                    ) : activePage.kind === 'system' ? (
                      <section className="fb-prompt-book-prompt-section">
                        <div className="fb-prompt-book-prompt-head">
                          <div className="fb-prompt-book-section-label">
                            {`${activePage.title ?? 'System prompt'} - ${formatSystemPromptProvider(activePage.provider)}`}
                          </div>
                          <button
                            type="button"
                            onClick={() => onCopy(systemPromptEditorValue, activePage.id)}
                          >
                            {copiedEntryId === activePage.id ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        {editingSystemPrompt && canEditSystemPrompt ? (
                          <textarea
                            className="fb-prompt-book-system-textarea"
                            value={systemPromptEditorValue}
                            onChange={(event) => onSetPromptDraft?.(event.target.value)}
                            spellCheck={false}
                          />
                        ) : (
                          <p>{activePage.userPrompt}</p>
                        )}
                      </section>
                    ) : (
                      <>
                        <section className="fb-prompt-book-prompt-section is-user">
                          <div className="fb-prompt-book-prompt-head">
                            <div className="fb-prompt-book-prompt-title">
                              <div className="fb-prompt-book-section-label">User prompt</div>
                              <button
                                className="fb-prompt-book-prompt-copy"
                                type="button"
                                onClick={() => onCopy(activePage.userPrompt, `${activePage.id}:user`)}
                              >
                                {copiedEntryId === `${activePage.id}:user` ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                          <p>{activePage.userPrompt}</p>
                        </section>
                        {activePage.magicPrompt && (
                          <section className="fb-prompt-book-prompt-section is-magic">
                            <div className="fb-prompt-book-prompt-head">
                              <div className="fb-prompt-book-prompt-title">
                                <div className="fb-prompt-book-section-label">Magic wand prompt</div>
                                <button
                                  className="fb-prompt-book-prompt-copy"
                                  type="button"
                                  onClick={() => onCopy(activePage.magicPrompt ?? '', `${activePage.id}:magic`)}
                                >
                                  {copiedEntryId === `${activePage.id}:magic` ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                            </div>
                            <p>{activePage.magicPrompt}</p>
                          </section>
                        )}
                      </>
                    )}
                  </div>
                  {activePage.kind === 'system' && (
                    <div className="fb-prompt-book-actions">
                      <button
                        type="button"
                        onClick={() => {
                          if (!editingSystemPrompt) onSetPromptDraft?.(activePage.userPrompt);
                          setEditingSystemPrompt(!editingSystemPrompt);
                        }}
                      >
                        {editingSystemPrompt ? 'Preview' : 'Edit'}
                      </button>
                      {editingSystemPrompt && (
                        <>
                          <button
                            type="button"
                            onClick={onApplySystemPromptDraft}
                            disabled={!systemPromptEditorValue.trim() || isPromptLibraryLoading}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={onResetSystemPromptDraft}
                            disabled={isPromptLibraryLoading}
                          >
                            Reset
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </article>

                <article
                  className="fb-prompt-book-page-face fb-prompt-book-right-page"
                  onClick={(event) => handleSpreadPageClick(event, 1)}
                  title={canGoForward ? 'Next prompt' : undefined}
                >
                  {activePage.kind !== 'generation' && activePage.kind !== 'system' && (
                    <div className="fb-prompt-book-media-header">
                      {activePage.kind === 'chat' ? (
                        <div className="fb-prompt-book-run">
                          <strong>Toolcalls</strong>
                        </div>
                      ) : activePage.runs.length > 0 ? activePage.runs.map((run) => (
                        <div className="fb-prompt-book-run" key={run.id}>
                          <strong>{run.title}</strong>
                          {run.settings.length > 0 && <span>{run.settings.join(' / ')}</span>}
                        </div>
                      )) : (
                        <div className="fb-prompt-book-run empty">
                          <strong>No generated media</strong>
                        </div>
                      )}
                    </div>
                  )}
                  <div
                    className="fb-prompt-book-page-scroll"
                    onScroll={activePage.kind === 'chat' ? () => handleChatScroll('tools') : undefined}
                    ref={activePage.kind === 'chat' ? chatToolScrollRef : undefined}
                  >
                    {activePage.kind === 'system' ? (
                      <div className="fb-prompt-book-system-presets">
                        <div className="fb-prompt-book-run">
                          <strong>Presets</strong>
                          <span>{activePage.provider === 'lemonade' ? 'Lemonade Local' : 'OpenAI / Cloud'}</span>
                        </div>
                        <label className="fb-prompt-book-preset-field">
                          <span>Name</span>
                          <input
                            value={promptNameDraft}
                            onChange={(event) => onSetPromptName?.(event.target.value)}
                            disabled={isPromptLibraryLoading}
                          />
                        </label>
                        <label className="fb-prompt-book-context-toggle">
                          <input
                            type="checkbox"
                            checked={promptSendContext}
                            onChange={(event) => onSetPromptSendContext?.(event.target.checked)}
                            disabled={isPromptLibraryLoading}
                          />
                          <span>Send current MasterSelects context</span>
                        </label>
                        {selectedSystemPrompt && (
                          <div className="fb-prompt-book-preset-meta">
                            Updated {formatPromptBookTime(selectedSystemPromptUpdatedAt)} - Context {selectedSystemPrompt.sendContext ? 'on' : 'off'}
                          </div>
                        )}
                        {systemPromptFeedback && (
                          <div className={`fb-prompt-book-preset-feedback ${promptDialogError ? 'is-error' : ''}`}>
                            {systemPromptFeedback}
                          </div>
                        )}
                        <div className="fb-prompt-book-preset-actions">
                          <button type="button" onClick={onSaveSystemPrompt} disabled={!systemPromptEditorValue.trim() || !canUseSystemPresets || isPromptLibraryLoading}>
                            Save new
                          </button>
                          <button type="button" onClick={onOverwriteSystemPrompt} disabled={!selectedPromptFile || !systemPromptEditorValue.trim() || isPromptLibraryLoading}>
                            Overwrite
                          </button>
                          <button type="button" onClick={onDeleteSystemPrompt} disabled={!selectedPromptFile || isPromptLibraryLoading}>
                            Delete
                          </button>
                          <button type="button" onClick={onRefreshSystemPrompts} disabled={isPromptLibraryLoading}>
                            Refresh
                          </button>
                        </div>
                        <div className="fb-prompt-book-preset-list" aria-label="Saved system prompt presets">
                          {savedSystemPrompts.length === 0 ? (
                            <div className="fb-prompt-book-preset-empty">No saved presets.</div>
                          ) : (
                            savedSystemPrompts.map((prompt) => (
                              <button
                                className={`fb-prompt-book-preset-item ${selectedPromptFile === prompt.fileName ? 'active' : ''}`}
                                key={prompt.fileName}
                                type="button"
                                onClick={() => {
                                  onSetSelectedPromptFile?.(prompt.fileName);
                                  onLoadSystemPrompt?.(prompt.fileName);
                                }}
                                disabled={!canUseSystemPresets || isPromptLibraryLoading}
                              >
                                <span>{prompt.name}</span>
                                <small>{prompt.sendContext ? 'Context on' : 'Context off'}</small>
                                <time dateTime={prompt.updatedAt}>{formatPromptBookTime(Date.parse(prompt.updatedAt) || activePage.createdAt)}</time>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="fb-prompt-book-preset-status">
                          {promptHasOverride ? 'Custom active prompt' : 'Default active prompt'} - {systemPromptEditorValue.length} chars
                        </div>
                      </div>
                    ) : activePage.kind === 'chat' ? (
                      (activePage.toolCalls?.length ?? 0) > 0 ? (
                        <div className="fb-prompt-book-tool-list">
                          {(activePage.chatMessages ?? []).map((message) => (
                            <div
                              className={`fb-prompt-book-tool-row ${message.toolCalls.length > 0 ? 'has-tools' : ''}`}
                              key={message.id}
                              style={chatRowHeights?.pageId === activePage.id && chatRowHeights.values[message.id]
                                ? { minHeight: chatRowHeights.values[message.id] }
                                : undefined}
                            >
                              {message.toolCalls.map((toolCall) => (
                                <details className="fb-prompt-book-tool-call" key={toolCall.id}>
                                  <summary>
                                    <span>{toolCall.title}</span>
                                    <time dateTime={new Date(toolCall.createdAt).toISOString()}>{formatPromptBookTime(toolCall.createdAt)}</time>
                                    <button
                                      className="fb-prompt-book-tool-copy"
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onCopy(`${toolCall.title}\n\n${toolCall.body}`, toolCall.id);
                                      }}
                                    >
                                      {copiedEntryId === toolCall.id ? 'Copied' : 'Copy'}
                                    </button>
                                  </summary>
                                  <pre>{toolCall.body}</pre>
                                </details>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="fb-prompt-book-empty">No toolcalls for this chat day.</div>
                      )
                    ) : activePage.media.length > 0 ? (
                      <div className="fb-prompt-book-media-list">
                        {mediaGroups.map((group) => (
                          <section className={`fb-prompt-book-media-group ${group.source}`} key={group.source}>
                            <div className="fb-prompt-book-media-group-label">{formatPromptBookMediaSource(group.source)}</div>
                            {group.items.map(({ media, run }) => (
                              <div className="fb-prompt-book-media-row" key={media.id}>
                                <div
                                  className="fb-prompt-book-media-tile"
                                  title={`${media.name} - double-click to open in Source Monitor`}
                                  onClick={handleMediaClick}
                                  onDoubleClick={(event) => handleMediaDoubleClick(event, media.id)}
                                >
                                  {media.type === 'video' ? (
                                    <PromptBookVideo active media={media} />
                                  ) : (
                                    <img src={media.thumbnailUrl ?? media.url} alt="" draggable={false} />
                                  )}
                                </div>
                                {run && (
                                  <div className="fb-prompt-book-media-caption">
                                    <span className={`fb-prompt-book-media-source ${media.source}`}>
                                      {formatPromptBookMediaSource(media.source)}
                                    </span>
                                    <strong>{run.title}</strong>
                                    {run.settings.length > 0 && <span>{run.settings.join(' / ')}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </section>
                        ))}
                        {activePage.runs.slice(activePage.media.length).map((run) => (
                          <div className="fb-prompt-book-media-caption is-orphan" key={run.id}>
                            <strong>{run.title}</strong>
                            {run.settings.length > 0 && <span>{run.settings.join(' / ')}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="fb-prompt-book-empty">No generated media for this prompt.</div>
                    )}
                  </div>
                </article>
              </div>
            )}

            {turnSheet && (
              <div
                className={`fb-prompt-book-turn-sheet ${turnSheet.direction === 1 ? 'is-forward' : 'is-backward'}`}
                key={turnSheet.id}
                aria-hidden="true"
              >
                <div className="fb-prompt-book-turn-card" onAnimationEnd={() => finishTurn(turnSheet.id)}>
                  <div className="fb-prompt-book-turn-face is-front" />
                  <div className="fb-prompt-book-turn-face is-back" />
                </div>
              </div>
            )}
            {(bookOpening || turnSheet !== null) && (
              <PromptBookSparkles key={turnSheet ? `turn-${turnSheet.id}` : 'open'} />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return promptBook;
  }

  return createPortal(promptBook, document.body);
}
