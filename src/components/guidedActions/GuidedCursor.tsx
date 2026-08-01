import type { GuidedInputGesture, GuidedPoint } from '../../services/guidedActions';
import type { TimelineToolId } from '../../stores/timeline/types';
import { getTimelineToolCursorIcon } from '../timeline/tools/pointer/timelineToolPointerDispatcher';
import type { CSSProperties } from 'react';

interface GuidedCursorProps {
  clicking: boolean;
  dragging?: boolean;
  inputGesture: GuidedInputGesture | null;
  position: GuidedPoint | null;
  toolId?: TimelineToolId | null;
  transitionMs?: number;
  visible: boolean;
}

export function GuidedCursor({ clicking, dragging = false, inputGesture, position, toolId, transitionMs, visible }: GuidedCursorProps) {
  if (!visible || !position) {
    return null;
  }

  const cursorIcon = toolId && toolId !== 'select' ? getTimelineToolCursorIcon(toolId) : null;
  const cursorX = cursorIcon ? position.x - cursorIcon.hotspotX : position.x;
  const cursorY = cursorIcon ? position.y - cursorIcon.hotspotY : position.y;
  const style = {
    transform: `translate3d(${cursorX}px, ${cursorY}px, 0)`,
    transitionDuration: `${Math.max(0, transitionMs ?? 420)}ms`,
    ...(cursorIcon ? {
      '--guided-cursor-hotspot-x': `${cursorIcon.hotspotX}px`,
      '--guided-cursor-hotspot-y': `${cursorIcon.hotspotY}px`,
    } : {}),
  } as CSSProperties;

  return (
    <div
      className={[
        'guided-cursor',
        clicking ? 'guided-cursor--clicking' : '',
        dragging ? 'guided-cursor--dragging' : '',
        cursorIcon ? 'guided-cursor--tool' : '',
        toolId ? `guided-cursor--tool-${toolId}` : '',
      ].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      {cursorIcon ? (
        <svg className="guided-cursor-tool-shape" viewBox="0 0 32 32" focusable="false">
          <g transform="translate(4 4)" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <g
              stroke="white"
              strokeWidth="5"
              dangerouslySetInnerHTML={{ __html: cursorIcon.paths.join('') }}
            />
            <g
              stroke="#111827"
              strokeWidth="2.35"
              dangerouslySetInnerHTML={{ __html: cursorIcon.paths.join('') }}
            />
          </g>
        </svg>
      ) : (
        <svg className="guided-cursor-shape" viewBox="0 0 32 32" focusable="false">
          <path d="M6 3l18 17-8 1.2 4.5 7.2-3.7 2.2-4.4-7.1-5.2 6.2L6 3z" />
        </svg>
      )}
      {clicking && <span className="guided-click-ripple" />}
      {dragging && <span className="guided-drag-hold-ring" />}
      {inputGesture && (
        <span className={`guided-cursor-gesture guided-cursor-gesture--${inputGesture.kind}`}>
          <span className="guided-cursor-gesture-label">{inputGesture.label}</span>
          {inputGesture.detail && <span className="guided-cursor-gesture-detail">{inputGesture.detail}</span>}
        </span>
      )}
    </div>
  );
}
