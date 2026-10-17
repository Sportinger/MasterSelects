import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { moveCompositionGuide, removeCompositionGuide } from '../../services/compositionGuides';
import type { CompositionGuide } from '../../types/compositionGuides';
import { guideScreenOffset, type GuideViewport } from './previewGuideMath';
import type { PreviewGuideDrag } from './usePreviewGuideDrag';

interface PreviewGuidesProps {
  compositionId: string;
  guides: readonly CompositionGuide[];
  drag: PreviewGuideDrag | null;
  viewport: GuideViewport;
  onStartMove: (event: ReactPointerEvent<Element>, guide: CompositionGuide) => void;
}

function axisLabel(orientation: CompositionGuide['orientation']): string {
  return orientation === 'vertical' ? 'X' : 'Y';
}

/** Ruler guides across the preview; drag to move, arrow keys nudge, Delete removes. */
export function PreviewGuides({ compositionId, guides, drag, viewport, onStartMove }: PreviewGuidesProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, guide: CompositionGuide) => {
    const step = event.shiftKey ? 10 : 1;
    const back = guide.orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const forward = guide.orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back || event.key === forward) {
      moveCompositionGuide(compositionId, guide.id, guide.position + (event.key === back ? -step : step));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      removeCompositionGuide(compositionId, guide.id);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const shown = guides.map((guide) => (
    drag?.guideId === guide.id ? { ...guide, position: drag.position } : guide
  ));
  const pending = drag && drag.guideId === null
    ? { id: '__pending-guide__', orientation: drag.orientation, position: drag.position }
    : null;

  return (
    <>
      {[...shown, ...(pending ? [pending] : [])].map((guide) => {
        const offset = guideScreenOffset(guide.orientation, guide.position, viewport);
        const vertical = guide.orientation === 'vertical';
        const active = drag !== null && (drag.guideId === guide.id || guide === pending);
        return (
          <div
            aria-label={`${vertical ? 'Vertical' : 'Horizontal'} guide`}
            aria-orientation={vertical ? 'horizontal' : 'vertical'}
            aria-valuenow={guide.position}
            aria-valuetext={`${axisLabel(guide.orientation)} ${guide.position} px`}
            className={[
              'preview-guide',
              vertical ? 'preview-guide-vertical' : 'preview-guide-horizontal',
              active ? 'dragging' : '',
              active && drag.removing ? 'removing' : '',
            ].filter(Boolean).join(' ')}
            key={guide.id}
            onKeyDown={guide === pending ? undefined : (event) => handleKeyDown(event, guide)}
            onPointerDown={guide === pending ? undefined : (event) => onStartMove(event, guide)}
            role="slider"
            style={vertical ? { left: offset } : { top: offset }}
            tabIndex={guide === pending ? -1 : 0}
            title={`${axisLabel(guide.orientation)} ${guide.position} px — drag onto the ruler to remove`}
          />
        );
      })}
      {drag && (
        <div className="preview-guide-readout" style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }}>
          {drag.removing ? 'Remove guide' : `${axisLabel(drag.orientation)} ${drag.position} px`}
        </div>
      )}
    </>
  );
}
