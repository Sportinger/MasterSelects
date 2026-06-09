import type { MouseEvent as ReactMouseEvent } from 'react';

import {
  MEDIA_BOARD_ANNOTATION_FONT_SIZE_MAX,
  MEDIA_BOARD_ANNOTATION_FONT_SIZE_MIN,
  type MediaBoardAnnotation,
} from './annotations';

type MediaBoardAnnotationResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type MediaBoardAnnotationTextPatch = Partial<Pick<MediaBoardAnnotation, 'fontSize' | 'text'>>;

export interface MediaBoardAnnotationLayerProps {
  annotations: readonly MediaBoardAnnotation[];
  selectedAnnotationId: string | null;
  onAnnotationContextMenu: (
    event: ReactMouseEvent,
    annotation: MediaBoardAnnotation,
  ) => void;
  onAnnotationFocus: (annotation: MediaBoardAnnotation) => void;
  onEditToggle: (annotation: MediaBoardAnnotation, editing: boolean) => void;
  onRequestTextFocus: (annotationId: string) => void;
  onStartDrag: (event: ReactMouseEvent, annotation: MediaBoardAnnotation) => void;
  onStartResize: (
    event: ReactMouseEvent,
    annotation: MediaBoardAnnotation,
    corner: MediaBoardAnnotationResizeCorner,
  ) => void;
  onUpdateAnnotation: (id: string, patch: MediaBoardAnnotationTextPatch) => void;
}

const MEDIA_BOARD_ANNOTATION_RESIZE_CORNERS: readonly MediaBoardAnnotationResizeCorner[] = ['nw', 'ne', 'sw', 'se'];

export function MediaBoardAnnotationLayer({
  annotations,
  selectedAnnotationId,
  onAnnotationContextMenu,
  onAnnotationFocus,
  onEditToggle,
  onRequestTextFocus,
  onStartDrag,
  onStartResize,
  onUpdateAnnotation,
}: MediaBoardAnnotationLayerProps) {
  return (
    <>
      {annotations.map((annotation) => {
        const isSelected = selectedAnnotationId === annotation.id;
        const handleEditToggle = () => {
          const editing = !annotation.editing;
          onEditToggle(annotation, editing);
          if (editing) {
            onRequestTextFocus(annotation.id);
          }
        };

        return (
          <div
            key={annotation.id}
            className={`media-board-annotation ${isSelected ? 'selected' : ''} ${annotation.editing ? 'editing' : ''}`}
            style={{
              left: annotation.x,
              top: annotation.y,
              width: annotation.width,
              height: annotation.height,
              background: annotation.backgroundColor,
              color: annotation.textColor,
            }}
            onMouseDown={(event) => onStartDrag(event, annotation)}
            onContextMenu={(event) => onAnnotationContextMenu(event, annotation)}
          >
            <div className="media-board-annotation-controls">
              <input
                className="media-board-annotation-size"
                type="range"
                min={MEDIA_BOARD_ANNOTATION_FONT_SIZE_MIN}
                max={MEDIA_BOARD_ANNOTATION_FONT_SIZE_MAX}
                step={1}
                value={annotation.fontSize}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => onUpdateAnnotation(annotation.id, { fontSize: Number(event.currentTarget.value) })}
                title={`${annotation.fontSize}px`}
                aria-label="Annotation text size"
              />
            </div>
            <textarea
              data-media-board-annotation-text={annotation.id}
              className="media-board-annotation-text"
              value={annotation.text}
              placeholder="Annotation"
              readOnly={!annotation.editing}
              autoFocus={isSelected && annotation.editing && annotation.text.length === 0}
              onMouseDown={(event) => {
                if (annotation.editing) {
                  event.stopPropagation();
                } else {
                  event.preventDefault();
                }
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={() => onAnnotationFocus(annotation)}
              onChange={(event) => onUpdateAnnotation(annotation.id, { text: event.currentTarget.value })}
              style={{
                color: annotation.textColor,
                fontSize: annotation.fontSize,
              }}
              spellCheck
            />
            <button
              type="button"
              className={`media-board-annotation-edit ${annotation.editing ? 'active' : ''}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={handleEditToggle}
              title={annotation.editing ? 'Lock text' : 'Edit text'}
            >
              Edit
            </button>
            {MEDIA_BOARD_ANNOTATION_RESIZE_CORNERS.map((corner) => (
              <div
                key={corner}
                className={`media-board-annotation-resize ${corner}`}
                onMouseDown={(event) => onStartResize(event, annotation, corner)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
