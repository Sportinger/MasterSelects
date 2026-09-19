// Annotation bars drawn on top of the ruler lanes. Pointer drag moves or trims
// the bar; the bar and its trim handles are keyboard-reachable (arrow keys
// nudge by one frame, Shift for ten; Enter/Space opens the reader).

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnnotationDragMode, ProjectedRulerAnnotation } from '../hooks/useRulerAnnotations';

const MIN_BAR_WIDTH_PX = 6;

interface RulerAnnotationBarsProps {
  annotations: ProjectedRulerAnnotation[];
  draggingAnnotationId: string | null;
  formatTime: (time: number) => string;
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, projected: ProjectedRulerAnnotation, mode: AnnotationDragMode) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, projected: ProjectedRulerAnnotation) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onNudge: (event: ReactKeyboardEvent<HTMLElement>, projected: ProjectedRulerAnnotation, mode: AnnotationDragMode) => void;
  onOpen: (anchor: HTMLElement, clientX: number, projected: ProjectedRulerAnnotation) => void;
  timeToPixel: (time: number) => number;
}

export function RulerAnnotationBars({
  annotations,
  draggingAnnotationId,
  formatTime,
  onBeginDrag,
  onContextMenu,
  onDragEnd,
  onDragMove,
  onNudge,
  onOpen,
  timeToPixel,
}: RulerAnnotationBarsProps) {
  return (
    <>
      {annotations.map((projected) => {
        const scopeLabel = projected.scope === 'clip' ? 'Clip' : 'Composition';
        const rangeLabel = `${formatTime(projected.displayStartTime)} - ${formatTime(projected.displayEndTime)}`;
        return (
          <div
            key={projected.annotation.id}
            className={`timeline-ruler-annotation scope-${projected.scope}${draggingAnnotationId === projected.annotation.id ? ' dragging' : ''}`}
            data-annotation-id={projected.annotation.id}
            role="button"
            tabIndex={0}
            aria-label={`${scopeLabel} annotation: ${projected.annotation.text} (${rangeLabel})`}
            style={{
              left: timeToPixel(projected.displayStartTime),
              width: Math.max(MIN_BAR_WIDTH_PX, timeToPixel(projected.displayEndTime - projected.displayStartTime)),
            }}
            title={`${scopeLabel}: ${projected.annotation.text} (${rangeLabel})`}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => onBeginDrag(event, projected, 'move')}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpen(event.currentTarget, event.clientX, projected);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpen(event.currentTarget, rect.left + rect.width / 2, projected);
                return;
              }
              onNudge(event, projected, 'move');
            }}
            onContextMenu={(event) => onContextMenu(event, projected)}
          >
            <button
              type="button"
              className="timeline-ruler-annotation-handle start"
              aria-label={`Trim start of annotation: ${projected.annotation.text}`}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => onBeginDrag(event, projected, 'trim-start')}
              onKeyDown={(event) => onNudge(event, projected, 'trim-start')}
            />
            <span className="timeline-ruler-annotation-label">{projected.annotation.text}</span>
            <button
              type="button"
              className="timeline-ruler-annotation-handle end"
              aria-label={`Trim end of annotation: ${projected.annotation.text}`}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => onBeginDrag(event, projected, 'trim-end')}
              onKeyDown={(event) => onNudge(event, projected, 'trim-end')}
            />
          </div>
        );
      })}
    </>
  );
}
