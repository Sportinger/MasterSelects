// Masks Tab - focused clip mask creation and editing controls
import { useCallback, useEffect, useMemo } from 'react';

import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import { useTimelineStore } from '../../../stores/timeline';
import type { ClipMask } from "../../../types/masks";
import { MaskActiveCard } from './masksTab/MaskActiveCard';
import { MaskList } from './masksTab/MaskList';
import { MaskToolbar } from './masksTab/MaskToolbar';
import { EMPTY_KEYFRAMES } from './masksTab/maskTabTypes';
import { useMaskKeybindings } from './masksTab/useMaskKeybindings';
import { useMaskPanelBatch } from './masksTab/useMaskPanelBatch';
import { useMaskVertexHandleInteractions } from './masksTab/useMaskVertexHandleInteractions';

interface MasksTabProps {
  clipId: string;
  masks: ClipMask[] | undefined;
}

export function MasksTab({ clipId, masks }: MasksTabProps) {
  const activeMaskId = useTimelineStore(state => state.activeMaskId);
  const selectedVertexIds = useTimelineStore(state => state.selectedVertexIds);
  const selectedMaskEdgeId = useTimelineStore(state => state.selectedMaskEdgeId);
  const maskEditMode = useTimelineStore(state => state.maskEditMode);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const selectedClip = useTimelineStore(state => state.clips.find(clip => clip.id === clipId));
  const clipKeyframesForMaskList = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES);
  const canPasteMask = useTimelineStore(state => state.clipboardMask !== null);
  const getInterpolatedMasks = useTimelineStore(state => state.getInterpolatedMasks);
  const {
    addRectangleMask,
    addEllipseMask,
    copyClipMask,
    pasteClipMask,
    setActiveMask,
    setMaskEditMode,
    setMaskPanelActive,
    updateMask,
    closeMask,
    selectVertices,
    setVertexHandleMode,
    showMaskFeatherPreview,
    setPropertyValue,
  } = useTimelineStore.getState();
  const registry = getShortcutRegistry();
  const { handleBatchEnd, handleBatchStart } = useMaskPanelBatch();

  const maskList = useMemo(() => {
    const hasMaskKeyframes = clipKeyframesForMaskList.some(keyframe => keyframe.property.startsWith('mask.'));
    if (!selectedClip || !hasMaskKeyframes) return masks || [];
    return getInterpolatedMasks(clipId, playheadPosition - selectedClip.startTime) || masks || [];
  }, [clipId, clipKeyframesForMaskList, getInterpolatedMasks, masks, playheadPosition, selectedClip]);
  const activeMask = useMemo(
    () => maskList.find(mask => mask.id === activeMaskId) || maskList[0] || null,
    [activeMaskId, maskList],
  );
  const {
    cycleSelectedHandles,
    selectedHandleMode,
    selectedVertices,
    setSelectedHandles,
  } = useMaskVertexHandleInteractions({
    activeMask,
    clipId,
    selectedVertexIds,
    setVertexHandleMode,
  });

  useEffect(() => {
    setMaskPanelActive(true);
    return () => {
      setMaskPanelActive(false);
      setMaskEditMode('none');
    };
  }, [setMaskEditMode, setMaskPanelActive]);

  useEffect(() => {
    if (!activeMask) return;
    if (maskEditMode !== 'none') return;
    setActiveMask(clipId, activeMask.id);
  }, [activeMask, clipId, maskEditMode, setActiveMask]);

  const selectMask = useCallback((maskId: string) => {
    setActiveMask(clipId, maskId);
  }, [clipId, setActiveMask]);

  const createRectangle = useCallback(() => {
    const maskId = addRectangleMask(clipId);
    setActiveMask(clipId, maskId);
  }, [addRectangleMask, clipId, setActiveMask]);

  const createEllipse = useCallback(() => {
    const maskId = addEllipseMask(clipId);
    setActiveMask(clipId, maskId);
  }, [addEllipseMask, clipId, setActiveMask]);

  const startDrawMode = useCallback((mode: 'drawingRect' | 'drawingEllipse' | 'drawingPen') => {
    setMaskEditMode(mode);
  }, [setMaskEditMode]);

  const copyActiveMask = useCallback(() => {
    if (!activeMask) return;
    copyClipMask(clipId, activeMask.id);
  }, [activeMask, clipId, copyClipMask]);

  const pasteMask = useCallback(() => {
    pasteClipMask([clipId]);
  }, [clipId, pasteClipMask]);

  useMaskKeybindings({
    activeMask,
    canPasteMask,
    clipId,
    closeMask,
    copyClipMask,
    cycleSelectedHandles,
    maskEditMode,
    pasteClipMask,
    registry,
    selectedVertexCount: selectedVertices.length,
    selectVertices,
    setActiveMask,
    setMaskEditMode,
    updateMask,
  });

  return (
    <div
      className="properties-tab-content masks-tab"
      data-guided-properties-tab="masks"
      data-guided-target="properties-tab:masks"
    >
      <MaskToolbar
        activeMask={activeMask}
        canPasteMask={canPasteMask}
        maskEditMode={maskEditMode}
        registry={registry}
        onCopyActiveMask={copyActiveMask}
        onCreateEllipse={createEllipse}
        onCreateRectangle={createRectangle}
        onExitMaskMode={() => setMaskEditMode('none')}
        onPasteMask={pasteMask}
        onStartDrawMode={startDrawMode}
      />

      {activeMask && (
        <MaskActiveCard
          activeMask={activeMask}
          clipId={clipId}
          closeMask={closeMask}
          onBatchEnd={handleBatchEnd}
          onBatchStart={handleBatchStart}
          onCycleSelectedHandles={cycleSelectedHandles}
          onSetSelectedHandles={setSelectedHandles}
          registry={registry}
          selectedHandleMode={selectedHandleMode}
          selectedMaskEdgeId={selectedMaskEdgeId}
          selectedVertexDisplayCount={selectedVertexIds.size}
          selectedVertexCount={selectedVertices.length}
          showMaskFeatherPreview={showMaskFeatherPreview}
          setPropertyValue={setPropertyValue}
          updateMask={updateMask}
        />
      )}

      <MaskList
        activeMaskId={activeMask?.id ?? null}
        clipId={clipId}
        maskList={maskList}
        onSelectMask={selectMask}
      />
    </div>
  );
}
