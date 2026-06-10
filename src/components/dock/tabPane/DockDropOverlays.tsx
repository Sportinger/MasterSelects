import type { DockDragState, DropPosition } from '../../../types/dock';

interface DockDropOverlaysProps {
  isDropTarget: boolean;
  dropPosition: DropPosition | undefined;
  showCenterDropOverlay: boolean;
  showTabSlotOverlay: boolean;
  panelCount: number;
  dragState: DockDragState;
}

export function DockDropOverlays({
  isDropTarget,
  dropPosition,
  showCenterDropOverlay,
  showTabSlotOverlay,
  panelCount,
  dragState,
}: DockDropOverlaysProps) {
  return (
    <>
      {isDropTarget && dropPosition && dropPosition !== 'center' && (
        <div className={`dock-drop-overlay ${dropPosition}`} />
      )}

      {showCenterDropOverlay && (
        <div className="dock-drop-overlay center" />
      )}

      {showTabSlotOverlay && (
        <div className="dock-tab-slots-overlay" aria-hidden="true">
          {Array.from({ length: panelCount + 1 }, (_, index) => (
            <div
              key={`slot-${index}`}
              className={`dock-tab-slot ${dragState.dropTarget?.tabInsertIndex === index ? 'active' : ''}`}
            />
          ))}
        </div>
      )}
    </>
  );
}
