import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from 'react';
import { getCatalogEntries, getCatalogEntry } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry } from '../../../services/flashboard/types';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_PROVIDER_ID,
} from '../../../services/sunoContracts';
import { submitFlashBoardActiveGenerationRequest } from '../../../stores/flashboardStore/activeGenerationRecords';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardComposerState } from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  PromptDictationButton,
  appendPromptDictationText,
} from '../../common/PromptDictationButton';
import { FlashBoardPromptBook } from '../flashboard/FlashBoardPromptBook';
import { buildFlashBoardReferenceBadges } from '../flashboard/FlashBoardReferenceBadgePlanner';
import { useFlashBoardComposerAccessState } from '../flashboard/useFlashBoardComposerAccessState';
import { useFlashBoardPromptRefineController } from '../flashboard/useFlashBoardPromptRefineController';
import {
  AIStudioComposerBar,
  AIStudioPill,
  AIStudioPillRow,
  AIStudioPromptCapsule,
  AIStudioSplitButton,
} from './AIStudioComposerBar';
import { buildAIStudioGenerationRequest } from './AIStudioGenerationRequest';
import { buildAIStudioModelPatch } from './AIStudioModelDefaults';
import '../flashboard/FlashBoard.css';

type GenerationPopover = 'model' | 'aspect' | 'imageSize' | 'duration' | 'mode';
type ModelCategory = 'all' | 'image' | 'video' | 'audio';

const MODEL_CATEGORIES: Array<{ id: ModelCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
];

interface GenerationPill {
  active?: boolean;
  id: 'model' | 'prompt-book' | 'aspect' | 'imageSize' | 'duration' | 'mode' | 'sound' | 'multi-shot';
  label: string;
}

interface PopoverOption {
  active: boolean;
  aspectRatio?: string;
  category?: Exclude<ModelCategory, 'all'>;
  id: string;
  label: string;
  meta?: string;
  onSelect: () => void;
}

interface PopoverPosition {
  arrowLeft: number;
  left: number;
}

function resolveStateUpdate<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === 'function'
    ? (update as (previous: T) => T)(current)
    : update;
}

function isReferenceableMediaType(type: string | undefined): type is 'image' | 'video' | 'audio' {
  return type === 'image' || type === 'video' || type === 'audio';
}

function getAspectGlyphStyle(value: string): CSSProperties {
  const [width, height] = value.split(':').map(Number);
  if (!width || !height) return {};
  const ratio = Math.min(3.5, Math.max(0.3, width / height));
  const glyphWidth = ratio >= 1 ? 17 : Math.max(6, 17 * ratio);
  const glyphHeight = ratio >= 1 ? Math.max(6, 17 / ratio) : 17;
  return { width: glyphWidth, height: glyphHeight };
}

function AspectRatioGlyph({ value }: { value: string }) {
  const isAuto = !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value);
  return (
    <span
      aria-hidden="true"
      className={`ai-studio-aspect-glyph ${isAuto ? 'is-auto' : ''}`}
      style={isAuto ? undefined : getAspectGlyphStyle(value)}
    />
  );
}

function formatProviderLabel(providerId: string | undefined): string {
  if (!providerId) return 'Model';
  const catalogEntry = getCatalogEntry('cloud', providerId);
  if (catalogEntry) return catalogEntry.name.replace(' (Kie.ai)', '');
  return providerId
    .replace(/^cloud-/, '')
    .split(/[-/]/)
    .filter(Boolean)
    .map((part) => part.length <= 2 ? part.toUpperCase() : `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function buildGenerationPills(
  composer: FlashBoardComposerState,
  selectedEntry: CatalogEntry | undefined,
): GenerationPill[] {
  const pills: GenerationPill[] = [
    { id: 'model', label: 'Model' },
    { id: 'prompt-book', label: 'Prompt Book' },
  ];
  if (selectedEntry?.aspectRatios.length) {
    pills.push({ id: 'aspect', label: composer.aspectRatio ?? selectedEntry.aspectRatios[0] ?? 'Auto' });
  }
  if (selectedEntry?.imageSizes?.length) {
    pills.push({ id: 'imageSize', label: composer.imageSize ?? selectedEntry.imageSizes[0] ?? '1K' });
  }
  if (selectedEntry?.durations.length) {
    pills.push({ id: 'duration', label: `${composer.duration ?? selectedEntry.durations[0] ?? 5}s` });
  }
  if (selectedEntry?.modes.length) {
    const mode = composer.mode ?? selectedEntry.modes[0] ?? '';
    pills.push({ id: 'mode', label: selectedEntry.modeLabels?.[mode] ?? mode.toUpperCase() });
  }
  if (selectedEntry?.supportsGenerateAudio) {
    pills.push({ id: 'sound', label: 'Sound', active: composer.generateAudio });
  }
  if (selectedEntry?.supportsMultiShot) {
    pills.push({ id: 'multi-shot', label: 'Multi-shot', active: composer.multiShots });
  }
  return pills;
}

export function AIStudioGenerationBar() {
  const composer = useFlashBoardStore((state) => state.composer);
  const promptHistory = useFlashBoardStore((state) => state.promptHistory);
  const generationRecords = useFlashBoardStore((state) => state.activeGenerationRecords);
  const chatMessages = useFlashBoardStore((state) => state.chatMessages);
  const updateComposer = useFlashBoardStore((state) => state.updateComposer);
  const mediaFiles = useMediaStore((state) => state.files);
  const [activePopover, setActivePopover] = useState<GenerationPopover | null>(null);
  const [modelCategory, setModelCategory] = useState<ModelCategory>('all');
  const [promptBookOpen, setPromptBookOpen] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [copiedPromptBookEntryId, setCopiedPromptBookEntryId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({ arrowLeft: 28, left: 0 });
  const copiedResetRef = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptValueRef = useRef('');
  const pillButtonRefs = useRef<Partial<Record<GenerationPopover, HTMLButtonElement | null>>>({});
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const {
    canUseHostedPromptRefiner,
    hasHostedSession,
    hostedAIEnabled,
    openAuthDialog,
    openPricingDialog,
  } = useFlashBoardComposerAccessState();
  const catalogEntries = useMemo(() => getCatalogEntries().filter((entry) => entry.service === 'cloud'), []);
  const selectedEntry = useMemo(
    () => getCatalogEntry(composer.service ?? 'cloud', composer.providerId ?? ''),
    [composer.providerId, composer.service],
  );
  useEffect(() => {
    if (!selectedEntry) return;
    const patch = buildAIStudioModelPatch(selectedEntry, composer);
    if (Object.keys(patch).length > 0) updateComposer(patch);
  }, [composer, selectedEntry, updateComposer]);
  promptValueRef.current = composer.draftPrompt ?? '';
  const mediaFilesById = useMemo(
    () => new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile])),
    [mediaFiles],
  );
  const referenceBadges = useMemo(() => buildFlashBoardReferenceBadges({
    endMediaFileId: composer.endMediaFileId,
    isReferenceableMediaType,
    mediaFilesById,
    referenceMediaFileIds: composer.referenceMediaFileIds ?? [],
    startMediaFileId: composer.startMediaFileId,
  }), [
    composer.endMediaFileId,
    composer.referenceMediaFileIds,
    composer.startMediaFileId,
    mediaFilesById,
  ]);
  const setComposerPrompt = useCallback((next: SetStateAction<string>) => {
    const current = composer.draftPrompt ?? '';
    updateComposer({ draftPrompt: resolveStateUpdate(next, current) });
  }, [composer.draftPrompt, updateComposer]);
  const setSunoCustomMode = useCallback((next: SetStateAction<boolean>) => {
    const current = composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE;
    updateComposer({ sunoCustomMode: resolveStateUpdate(next, current) });
  }, [composer.sunoCustomMode, updateComposer]);
  const setSunoNegativeTags = useCallback((next: SetStateAction<string>) => {
    const current = composer.sunoNegativeTags ?? '';
    updateComposer({ sunoNegativeTags: resolveStateUpdate(next, current) });
  }, [composer.sunoNegativeTags, updateComposer]);
  const setSunoStyle = useCallback((next: SetStateAction<string>) => {
    const current = composer.sunoStyle ?? '';
    updateComposer({ sunoStyle: resolveStateUpdate(next, current) });
  }, [composer.sunoStyle, updateComposer]);
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID
    || composer.providerId === SUNO_PROVIDER_ID;
  const {
    clearPromptRefineError,
    handleRefinePrompt,
    isRefiningPrompt,
    promptRefineError,
    promptRefineTitle,
  } = useFlashBoardPromptRefineController({
    aspectRatio: composer.aspectRatio ?? selectedEntry?.aspectRatios[0] ?? '16:9',
    canUseHostedPromptRefiner,
    closePopover: () => setActivePopover(null),
    duration: composer.duration ?? selectedEntry?.durations[0] ?? 5,
    effectiveGenerateAudio: Boolean(composer.generateAudio),
    getMediaFile: (mediaFileId) => {
      const mediaFile = mediaFilesById.get(mediaFileId);
      if (!mediaFile || !isReferenceableMediaType(mediaFile.type)) return undefined;
      return { file: mediaFile.file, type: mediaFile.type, url: mediaFile.url };
    },
    hasHostedSession,
    hostedAIEnabled,
    imageSize: composer.imageSize ?? selectedEntry?.imageSizes?.[0] ?? '1K',
    isAudioMode: selectedEntry?.outputType === 'audio',
    isSunoMode,
    mode: composer.mode ?? selectedEntry?.modes[0] ?? 'std',
    multiShots: composer.multiShots,
    openAuthDialog,
    openPricingDialog,
    prompt: isSunoMode && (composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL)
      ? ''
      : composer.draftPrompt ?? '',
    providerId: composer.providerId ?? '',
    referenceBadges,
    selectedEntry,
    service: selectedEntry?.service ?? composer.service ?? 'cloud',
    setPrompt: setComposerPrompt,
    setSunoCustomMode,
    setSunoNegativeTags,
    setSunoStyle,
    sunoAudioWeight: composer.sunoAudioWeight ?? DEFAULT_SUNO_AUDIO_WEIGHT,
    sunoCustomMode: composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE,
    sunoInstrumental: composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL,
    sunoNegativeTags: composer.sunoNegativeTags ?? '',
    sunoStyle: composer.sunoStyle ?? '',
    sunoStyleWeight: composer.sunoStyleWeight ?? DEFAULT_SUNO_STYLE_WEIGHT,
    sunoVocalGender: composer.sunoVocalGender ?? '',
    sunoWeirdnessConstraint: composer.sunoWeirdnessConstraint ?? DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
    version: composer.version ?? selectedEntry?.versions[0] ?? 'latest',
  });
  const pills = buildGenerationPills(composer, selectedEntry);

  const resizeChatInput = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = '0px';
    const contentHeight = Math.max(18, element.scrollHeight);
    element.style.height = `${Math.min(96, contentHeight)}px`;
    element.style.overflowY = contentHeight > 96 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizeChatInput(chatInputRef.current);
  }, [composer.draftPrompt, resizeChatInput]);

  useEffect(() => {
    if (!activePopover) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setActivePopover(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [activePopover]);

  useEffect(() => () => {
    if (copiedResetRef.current !== null) window.clearTimeout(copiedResetRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!activePopover) return undefined;
    const bar = barRef.current;
    const trigger = pillButtonRefs.current[activePopover];
    const popover = popoverRef.current;
    if (!bar || !trigger || !popover) return undefined;

    const updatePosition = () => {
      const barRect = bar.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      const popoverWidth = popover.offsetWidth;
      const triggerCenter = triggerRect.left - barRect.left + triggerRect.width / 2;
      const maximumLeft = Math.max(0, barRect.width - popoverWidth);
      const left = Math.max(0, Math.min(maximumLeft, triggerCenter - popoverWidth / 2));
      const arrowLeft = Math.max(18, Math.min(popoverWidth - 18, triggerCenter - left));
      setPopoverPosition((current) => (
        Math.abs(current.left - left) < 0.5 && Math.abs(current.arrowLeft - arrowLeft) < 0.5
          ? current
          : { arrowLeft, left }
      ));
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(bar);
    observer.observe(popover);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [activePopover]);

  const selectModel = (entry: CatalogEntry) => {
    updateComposer(buildAIStudioModelPatch(entry, composer));
    setActivePopover(null);
  };

  const getPopoverOptions = (): PopoverOption[] => {
    if (activePopover === 'model') {
      const visibleEntries = modelCategory === 'all'
        ? catalogEntries
        : catalogEntries.filter((entry) => entry.outputType === modelCategory);
      return visibleEntries.map((entry) => ({
        id: `${entry.service}:${entry.providerId}`,
        label: entry.name.replace(' (Kie.ai)', ''),
        meta: entry.outputType ?? undefined,
        category: entry.outputType,
        active: entry.providerId === composer.providerId && entry.service === composer.service,
        onSelect: () => selectModel(entry),
      }));
    }
    if (!selectedEntry) return [];
    if (activePopover === 'aspect') {
      return selectedEntry.aspectRatios.map((value) => ({
        id: value, label: value, aspectRatio: value, active: value === composer.aspectRatio,
        onSelect: () => { updateComposer({ aspectRatio: value }); setActivePopover(null); },
      }));
    }
    if (activePopover === 'imageSize') {
      return (selectedEntry.imageSizes ?? []).map((value) => ({
        id: value, label: value, active: value === composer.imageSize,
        onSelect: () => { updateComposer({ imageSize: value }); setActivePopover(null); },
      }));
    }
    if (activePopover === 'duration') {
      return selectedEntry.durations.map((value) => ({
        id: String(value), label: `${value}s`, active: value === composer.duration,
        onSelect: () => { updateComposer({ duration: value }); setActivePopover(null); },
      }));
    }
    if (activePopover === 'mode') {
      return selectedEntry.modes.map((value) => ({
        id: value,
        label: selectedEntry.modeLabels?.[value] ?? value,
        active: value === composer.mode,
        onSelect: () => { updateComposer({ mode: value }); setActivePopover(null); },
      }));
    }
    return [];
  };

  const handlePillClick = (pill: GenerationPill) => {
    if (pill.id === 'prompt-book') {
      setPromptBookOpen(true);
      setActivePopover(null);
      return;
    }
    if (pill.id === 'sound') {
      updateComposer({ generateAudio: !composer.generateAudio });
      return;
    }
    if (pill.id === 'multi-shot') {
      updateComposer({ multiShots: !composer.multiShots });
      return;
    }
    const popoverId = pill.id as GenerationPopover;
    setActivePopover((current) => current === popoverId ? null : popoverId);
  };

  const handlePromptBookCopy = (prompt: string, pageId: string) => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedPromptBookEntryId(pageId);
      if (copiedResetRef.current !== null) window.clearTimeout(copiedResetRef.current);
      copiedResetRef.current = window.setTimeout(() => setCopiedPromptBookEntryId(null), 1200);
    }).catch(() => setCopiedPromptBookEntryId(null));
  };

  const handleGenerate = () => {
    setActivePopover(null);
    const plan = buildAIStudioGenerationRequest(composer, selectedEntry);
    if (!plan.request) {
      setGenerationError(plan.error ?? 'Generation could not be started.');
      chatInputRef.current?.focus();
      return;
    }

    try {
      const record = submitFlashBoardActiveGenerationRequest(plan.request);
      setGenerationError(record ? null : 'Generation could not be queued.');
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Generation could not be started.');
    }
  };

  const appendDictation = useCallback((transcript: string) => {
    const nextPrompt = appendPromptDictationText(promptValueRef.current, transcript);
    promptValueRef.current = nextPrompt;
    updateComposer({ draftPrompt: nextPrompt });
    setGenerationError(null);
    clearPromptRefineError();
    chatInputRef.current?.focus();
  }, [clearPromptRefineError, updateComposer]);

  const popoverOptions = getPopoverOptions();
  return (
    <>
      <AIStudioComposerBar contentRef={barRef}>
        <AIStudioPillRow>
          {pills.map((pill) => (
            <AIStudioPill
              aria-expanded={['model', 'aspect', 'imageSize', 'duration', 'mode'].includes(pill.id)
                ? activePopover === pill.id
                : undefined}
              className={pill.active || activePopover === pill.id ? 'active' : ''}
              data-ai-studio-control
              key={pill.id}
              buttonRef={(element) => {
                if (pill.id === 'model' || pill.id === 'aspect' || pill.id === 'imageSize'
                  || pill.id === 'duration' || pill.id === 'mode') {
                  pillButtonRefs.current[pill.id] = element;
                }
              }}
              title={pill.id === 'model' ? formatProviderLabel(composer.providerId) : pill.label}
              type="button"
              onClick={() => handlePillClick(pill)}
            >
              {pill.id === 'aspect' && <AspectRatioGlyph value={pill.label} />}
              {pill.label}
            </AIStudioPill>
          ))}
        </AIStudioPillRow>
        <AIStudioPromptCapsule data-ai-studio-control>
          <button
            aria-label="Refine prompt"
            className={`ai-studio-chat-orb ${isRefiningPrompt ? 'is-loading' : ''}`}
            disabled={isRefiningPrompt}
            onClick={() => void handleRefinePrompt()}
            title={isRefiningPrompt ? 'Refining prompt…' : promptRefineTitle}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
              <path d="M5.5 12.5 13 5" />
              <path d="m10.8 3.2 2 2" />
              <path d="M2.8 1.6 3.3 3l1.5.5-1.5.5-.5 1.4L2.3 4 1 3.5 2.3 3l.5-1.4Z" />
              <path d="m11.8 9.7.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4-1.1Z" />
            </svg>
          </button>
          <textarea
            aria-label="AI chat prompt"
            onChange={(event) => {
              promptValueRef.current = event.currentTarget.value;
              updateComposer({ draftPrompt: event.currentTarget.value });
              resizeChatInput(event.currentTarget);
              if (generationError) setGenerationError(null);
              if (promptRefineError) clearPromptRefineError();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                handleGenerate();
              }
            }}
            placeholder="Ask AI anything…"
            ref={chatInputRef}
            rows={1}
            value={composer.draftPrompt ?? ''}
          />
          <PromptDictationButton onTranscript={appendDictation} />
        </AIStudioPromptCapsule>
        <span className="ai-studio-model-name">{formatProviderLabel(composer.providerId)}</span>
        <AIStudioSplitButton data-ai-studio-control>
          <button type="button">Auto <span aria-hidden="true">⌄</span></button>
          <button onClick={handleGenerate} title="Generate (Ctrl+Enter)" type="button">
            <span aria-hidden="true">✦</span> Gen
          </button>
        </AIStudioSplitButton>
        {(generationError || promptRefineError) && (
          <div className="ai-studio-generate-error" role="status">
            {generationError || promptRefineError}
          </div>
        )}
        {activePopover && (
          <div
            className={`ai-studio-control-popover ${activePopover === 'model' ? 'is-model-list' : ''} ${activePopover === 'aspect' ? 'is-aspect-list' : ''}`}
            data-ai-studio-control
            ref={popoverRef}
            style={{
              '--ai-studio-popover-arrow-left': `${popoverPosition.arrowLeft}px`,
              left: popoverPosition.left,
            } as CSSProperties}
          >
            <div className="ai-studio-control-popover-title">
              {activePopover === 'imageSize' ? 'Image size' : activePopover}
            </div>
            {activePopover === 'model' && (
              <div className="ai-studio-model-categories" role="tablist" aria-label="Model categories">
                {MODEL_CATEGORIES.map((category) => (
                  <button
                    aria-selected={modelCategory === category.id}
                    className={`category-${category.id} ${modelCategory === category.id ? 'active' : ''}`}
                    key={category.id}
                    onClick={() => setModelCategory(category.id)}
                    role="tab"
                    type="button"
                  >
                    <span aria-hidden="true" />
                    {category.label}
                  </button>
                ))}
              </div>
            )}
            <div className="ai-studio-control-popover-options">
              {popoverOptions.map((option) => (
                <button
                  className={option.active ? 'active' : ''}
                  key={option.id}
                  onClick={option.onSelect}
                  type="button"
                >
                  {option.aspectRatio && <AspectRatioGlyph value={option.aspectRatio} />}
                  <span>{option.label}</span>
                  {option.meta && <small className={option.category ? `category-${option.category}` : undefined}>{option.meta}</small>}
                </button>
              ))}
            </div>
          </div>
        )}
      </AIStudioComposerBar>
      {promptBookOpen && (
        <FlashBoardPromptBook
          chatMessages={chatMessages}
          copiedEntryId={copiedPromptBookEntryId}
          entries={promptHistory}
          generationRecords={generationRecords}
          initialKind="generation"
          mediaFiles={mediaFiles}
          onClose={() => setPromptBookOpen(false)}
          onCopy={handlePromptBookCopy}
        />
      )}
    </>
  );
}
