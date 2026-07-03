import { useEffect } from 'react';

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
        event.preventDefault();
        copyClipMask(clipId, activeMask.id);
        return;
      }
      if (canPasteMask && registry.matches('edit.paste', event)) {
        event.preventDefault();
        pasteClipMask([clipId]);
        return;
      }

      if (maskEditMode !== 'none') return;

      if (registry.matches('mask.pen', event)) {
        event.preventDefault();
        setMaskEditMode('drawingPen');
        return;
      }
      if (registry.matches('mask.rectangle', event)) {
        event.preventDefault();
        setMaskEditMode('drawingRect');
        return;
      }
      if (registry.matches('mask.ellipse', event)) {
        event.preventDefault();
        setMaskEditMode('drawingEllipse');
        return;
      }
      if (activeMask && registry.matches('mask.edit', event)) {
        event.preventDefault();
        setActiveMask(clipId, activeMask.id);
        setMaskEditMode('editing');
        return;
      }
      if (activeMask && registry.matches('mask.closePath', event)) {
        event.preventDefault();
        if (!activeMask.closed && activeMask.vertices.length >= 3) {
          closeMask(clipId, activeMask.id);
          setMaskEditMode('editing');
        }
        return;
      }
      if (activeMask && registry.matches('mask.invert', event)) {
        event.preventDefault();
        updateMask(clipId, activeMask.id, { inverted: !activeMask.inverted });
        return;
      }
      if (activeMask && registry.matches('mask.toggleOutline', event)) {
        event.preventDefault();
        updateMask(clipId, activeMask.id, { visible: !activeMask.visible });
        return;
      }
      if (activeMask && registry.matches('mask.selectAllVertices', event)) {
        event.preventDefault();
        setActiveMask(clipId, activeMask.id);
        selectVertices(activeMask.vertices.map(vertex => vertex.id));
        return;
      }
      if (activeMask && selectedVertexCount > 0 && registry.matches('mask.toggleVertexHandles', event)) {
        event.preventDefault();
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
