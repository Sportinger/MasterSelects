// Body-level overlays for ruler annotations: the "choose a clip" tooltip that
// follows the pointer while linking, and the expanded annotation reader.

import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SourceAnnotation } from '../../../types/sourceAnnotation';
import type { ExpandedRulerAnnotation, PendingAnnotationClipLink } from '../hooks/useRulerAnnotations';

interface RulerAnnotationPortalsProps {
  clipLinkTooltipRef: RefObject<HTMLDivElement | null>;
  expandedAnnotation: ExpandedRulerAnnotation | null;
  expandedAnnotationData: SourceAnnotation | null;
  expandedAnnotationRef: RefObject<HTMLDivElement | null>;
  formatTime: (time: number) => string;
  onCloseExpanded: () => void;
  pendingClipLink: PendingAnnotationClipLink | null;
}

export function RulerAnnotationPortals({
  clipLinkTooltipRef,
  expandedAnnotation,
  expandedAnnotationData,
  expandedAnnotationRef,
  formatTime,
  onCloseExpanded,
  pendingClipLink,
}: RulerAnnotationPortalsProps) {
  if (typeof document === 'undefined') return null;
  return (
    <>
      {pendingClipLink && createPortal(
        <div
          ref={clipLinkTooltipRef}
          className="annotation-clip-link-tooltip"
          style={{
            transform: `translate3d(${pendingClipLink.initialX + 18}px, ${pendingClipLink.initialY + 18}px, 0)`,
          }}
        >
          <strong>Choose a clip for this annotation</strong>
          <span>
            {pendingClipLink.candidateClipIds.length} clips overlap at {formatTime(pendingClipLink.time)}.
            Click the clip that should carry the annotation.
          </span>
          <kbd>Esc to cancel</kbd>
        </div>,
        document.body,
      )}
      {expandedAnnotation && expandedAnnotationData && createPortal(
        <div
          ref={expandedAnnotationRef}
          className={`ruler-annotation-reader scope-${expandedAnnotation.scope}`}
          role="dialog"
          aria-label="Annotation"
          style={{
            bottom: expandedAnnotation.bottom,
            left: expandedAnnotation.left,
            maxHeight: expandedAnnotation.maxHeight,
            width: expandedAnnotation.width,
          }}
        >
          <div className="ruler-annotation-reader-header">
            <span className="ruler-annotation-reader-meta">
              {expandedAnnotation.scope === 'clip' ? 'Clip annotation' : 'Composition annotation'} ·{' '}
              {formatTime(expandedAnnotation.displayStartTime)} - {formatTime(expandedAnnotation.displayEndTime)}
            </span>
            <button
              type="button"
              className="ruler-annotation-reader-close"
              aria-label="Close annotation"
              onClick={onCloseExpanded}
              onPointerUp={(event) => window.setTimeout(() => event.currentTarget.blur(), 0)}
            >
              x
            </button>
          </div>
          <div className="ruler-annotation-reader-body">{expandedAnnotationData.text}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
