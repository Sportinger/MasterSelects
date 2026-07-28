import { useEffect } from 'react';

import { claimShortcut } from '../../../../services/shortcutFocusPolicy';
import type { ShortcutActionId } from '../../../../services/shortcutTypes';
import type { ClipMask } from "../../../../types/masks";
import { isTypingTarget } from './maskTabTypes';

interface MaskShortcutRegistry {
  matches: (command: ShortcutActionId, event: KeyboardEvent) => boolean;
}

interface UseMaskKeybindingsOptions {
  activeMask: ClipMask | null;
  canPasteMask: boolean;
  clipId: string;
  cycleSelectedHandles: () => void;
  maskEditMode: 'none' | 'drawing' | 'editing' | 'drawingRect' | 'drawingEllipse' | 'drawingPen';
  registry: MaskShortcutRegistry;
  selectedVertexCount: number;
  closeMask: (clipId: string, maskId: string) => void;
  copyClipMask: (clipId: string, maskId: string) => void;
  pasteClipMask: (targetClipIds?: string[]) => void;
  selectVertices: (vertexIds: string[]) => void;
  setActiveMask: (clipId: string | null, maskId: string | null) => void;
  setMaskEditMode: (mode: 'drawingRect' | 'drawingEllipse' | 'drawingPen' | 'editing') => void;
  updateMask: (clipId: string, maskId: string, updates: Partial<ClipMask>) => void;
}

export function useMaskKeybindings({
  activeMask,
  canPasteMask,
  clipId,
  closeMask,
  copyClipMask,
  cycleSelectedHandles,
  maskEditMode,
  pasteClipMask,
  registry,
  selectedVertexCount,
  selectVertices,
  setActiveMask,
  setMaskEditMode,
  updateMask,
}: UseMaskKeybindingsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (activeMask && registry.matches('edit.copy', event)) {
        if (!claimShortcut(event, 'edit.copy')) return;
        copyClipMask(clipId, activeMask.id);
        return;
      }
      if (canPasteMask && registry.matches('edit.paste', event)) {
        if (!claimShortcut(event, 'edit.paste')) return;
        pasteClipMask([clipId]);
        return;
      }

      if (maskEditMode !== 'none') return;

      if (registry.matches('mask.pen', event)) {
        if (!claimShortcut(event, 'mask.pen')) return;
        setMaskEditMode('drawingPen');
        return;
      }
      if (registry.matches('mask.rectangle', event)) {
        if (!claimShortcut(event, 'mask.rectangle')) return;
        setMaskEditMode('drawingRect');
        return;
      }
      if (registry.matches('mask.ellipse', event)) {
        if (!claimShortcut(event, 'mask.ellipse')) return;
        setMaskEditMode('drawingEllipse');
        return;
      }
      if (activeMask && registry.matches('mask.edit', event)) {
        if (!claimShortcut(event, 'mask.edit')) return;
        setActiveMask(clipId, activeMask.id);
        setMaskEditMode('editing');
        return;
      }
      if (activeMask && registry.matches('mask.closePath', event)) {
        if (!claimShortcut(event, 'mask.closePath')) return;
        if (!activeMask.closed && activeMask.vertices.length >= 3) {
          closeMask(clipId, activeMask.id);
          setMaskEditMode('editing');
        }
        return;
      }
      if (activeMask && registry.matches('mask.invert', event)) {
        if (!claimShortcut(event, 'mask.invert')) return;
        updateMask(clipId, activeMask.id, { inverted: !activeMask.inverted });
        return;
      }
      if (activeMask && registry.matches('mask.toggleOutline', event)) {
        if (!claimShortcut(event, 'mask.toggleOutline')) return;
        updateMask(clipId, activeMask.id, { visible: !activeMask.visible });
        return;
      }
      if (activeMask && registry.matches('mask.selectAllVertices', event)) {
        if (!claimShortcut(event, 'mask.selectAllVertices')) return;
        setActiveMask(clipId, activeMask.id);
        selectVertices(activeMask.vertices.map(vertex => vertex.id));
        return;
      }
      if (activeMask && selectedVertexCount > 0 && registry.matches('mask.toggleVertexHandles', event)) {
        if (!claimShortcut(event, 'mask.toggleVertexHandles')) return;
        cycleSelectedHandles();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeMask,
    canPasteMask,
    clipId,
    closeMask,
    copyClipMask,
    cycleSelectedHandles,
    maskEditMode,
    pasteClipMask,
    registry,
    selectVertices,
    selectedVertexCount,
    setActiveMask,
    setMaskEditMode,
    updateMask,
  ]);
}
