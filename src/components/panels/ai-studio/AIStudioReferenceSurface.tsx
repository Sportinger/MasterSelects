import { useMemo, type ReactNode } from 'react';
import { getCatalogEntry } from '../../../services/flashboard/FlashBoardModelCatalog';
import type { CatalogEntry, CatalogReferenceInputKind } from '../../../services/flashboard/types';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type { FlashBoardAIWorkspaceKind } from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';
import { FlashBoardReferenceStrip } from '../flashboard/FlashBoardReferenceStrip';
import { useFlashBoardReferenceController } from '../flashboard/useFlashBoardReferenceController';
import { AIStudioReferenceDockContext } from './AIStudioReferenceDockContext';
import './AIStudioReferenceSurface.css';

interface AIStudioReferenceSurfaceProps {
  children: ReactNode;
  workspaceKind: FlashBoardAIWorkspaceKind;
}

function enableImplicitAIStudioReferenceInputs(entry: CatalogEntry | undefined): CatalogEntry | undefined {
  if (
    !entry
    || (entry.referenceInputKinds?.length ?? 0) > 0
    || entry.supportsImageToVideo
    || entry.requiredReferenceMediaType === 'video'
  ) {
    return entry;
  }

  const referenceInputKinds: CatalogReferenceInputKind[] = [];
  if ((entry.maxReferenceImages ?? 0) > 0) referenceInputKinds.push('image-reference');
  if ((entry.maxReferenceVideos ?? 0) > 0) referenceInputKinds.push('video-reference');
  if ((entry.maxReferenceAudio ?? 0) > 0) referenceInputKinds.push('audio-reference');
  if (referenceInputKinds.length === 0 && (entry.maxReferenceMedia ?? 0) > 0) {
    if (entry.outputType === 'audio') referenceInputKinds.push('audio-reference');
    else if (entry.outputType === 'video') referenceInputKinds.push('video-reference');
    else referenceInputKinds.push('image-reference');
  }

  return referenceInputKinds.length > 0 ? { ...entry, referenceInputKinds } : entry;
}

export function AIStudioReferenceSurface({
  children,
  workspaceKind,
}: AIStudioReferenceSurfaceProps) {
  const composer = useFlashBoardStore((state) => state.composer);
  const updateComposer = useFlashBoardStore((state) => state.updateComposer);
  const setHoveredComposerReference = useFlashBoardStore((state) => state.setHoveredComposerReference);
  const mediaFiles = useMediaStore((state) => state.files);
  const isGenerationWorkspace = workspaceKind === 'generation';
  const selectedEntry = useMemo(() => (
    isGenerationWorkspace
      ? enableImplicitAIStudioReferenceInputs(
          getCatalogEntry(composer.service ?? 'cloud', composer.providerId ?? ''),
        )
      : undefined
  ), [composer.providerId, composer.service, isGenerationWorkspace]);
  const referenceController = useFlashBoardReferenceController({
    chatPanelOpen: !isGenerationWorkspace,
    composer,
    isAudioMode: selectedEntry?.outputType === 'audio',
    mediaFiles,
    multiShots: Boolean(composer.multiShots),
    onPromptChange: (draftPrompt) => updateComposer({ draftPrompt }),
    prompt: composer.draftPrompt ?? '',
    providerId: isGenerationWorkspace ? composer.providerId ?? '' : '',
    selectedEntry,
    setHoveredComposerReference,
    updateComposer,
  });
  const hasReferenceItems = referenceController.showComposerReferences;
  const dockLabel = isGenerationWorkspace ? 'Generation inputs' : 'Chat context';
  const emptyHint = referenceController.isReferenceDragOver
    ? 'Drop to attach as reference'
    : 'Drop media from Media';
  const referenceDock = hasReferenceItems || referenceController.isReferenceDragOver ? (
    <aside
      className={`ai-studio-reference-dock ${hasReferenceItems ? 'has-items' : 'is-empty'} ${referenceController.isReferenceDragOver ? 'is-active' : ''}`}
      aria-label={dockLabel}
    >
      {hasReferenceItems ? (
        <FlashBoardReferenceStrip
          activeSlotKey={referenceController.activeReferenceSlotKey}
          badges={referenceController.composerReferenceBadges}
          slots={referenceController.composerReferenceSlots}
          referenceStripRef={referenceController.referenceStripRef}
          supportsEndFrameReference={referenceController.supportsEndFrameReference}
          supportsTimelineReferenceRoles={referenceController.supportsTimelineReferenceRoles}
          onHoverReference={setHoveredComposerReference}
          onPointerLeave={referenceController.handleReferenceStripPointerLeave}
          onPointerMove={referenceController.updateReferenceCardFocus}
          onReferenceRoleChange={referenceController.handleComposerReferenceRoleChange}
          onReorderReference={referenceController.handleReorderComposerReference}
          onRemoveReference={referenceController.handleRemoveComposerReference}
          onSlotDragOver={referenceController.handleReferenceSlotDragOver}
          onSlotDrop={referenceController.handleReferenceSlotDrop}
        />
      ) : (
        <div className="ai-studio-reference-empty" aria-live="polite">
          <span aria-hidden="true">+</span>
          {emptyHint}
        </div>
      )}
    </aside>
  ) : null;

  return (
    <div
      className={`ai-studio-reference-surface ${referenceController.isReferenceDragOver ? 'is-reference-drag-over' : ''}`}
      data-testid="ai-studio-reference-surface"
      onDragLeave={referenceController.handleReferenceDragLeave}
      onDragLeaveCapture={referenceController.handleReferenceRootDragLeaveCapture}
      onDragOver={referenceController.handleReferenceDragOver}
      onDragOverCapture={referenceController.handleReferenceRootDragOverCapture}
      onDrop={referenceController.handleReferenceDrop}
      onDropCapture={referenceController.handleReferenceRootDropCapture}
    >
      <AIStudioReferenceDockContext.Provider value={referenceDock}>
        {children}
      </AIStudioReferenceDockContext.Provider>
    </div>
  );
}
