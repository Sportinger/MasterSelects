import type { MouseEvent as ReactMouseEvent } from 'react';
import { getTrimHandleArrowDirections } from '../utils/trimHandleDirections';
import type {
  ClipInteractionShellCommandContext,
  ClipInteractionShellCommands,
  ClipInteractionShellEdge,
  ClipInteractionShellRect,
} from './types';

const TRIM_EDGES = ['left', 'right'] as const satisfies readonly ClipInteractionShellEdge[];

interface ClipTrimHandlesProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

function TrimHandleArrows({ directions }: { directions: readonly ClipInteractionShellEdge[] }) {
  return (
    <span className="trim-handle-arrows" aria-hidden="true">
      {directions.includes('left') && <span className="trim-handle-arrow left" />}
      {directions.includes('right') && <span className="trim-handle-arrow right" />}
    </span>
  );
}

export function ClipTrimHandles({ context, commands }: ClipTrimHandlesProps) {
  const trim = context.activeModules.trim;
  if (!trim?.enabled) return null;

  return (
    <>
      {TRIM_EDGES.map((edge) => {
        const rect = context.geometry.trimHandles[edge];
        if (!rect) return null;

        const directions = getTrimHandleArrowDirections(context.clip, edge);
        const isActiveEdge = trim.activeEdges.includes(edge);

        return (
          <div
            key={edge}
            className={[
              'trim-handle',
              'shell-trim-handle',
              edge,
              `arrows-${directions.length}`,
              isActiveEdge ? 'active' : '',
            ].filter(Boolean).join(' ')}
            data-shell-trim-edge={edge}
            style={toShellHandleStyle(rect, context.geometry.clip)}
            onMouseDown={(event: ReactMouseEvent<HTMLElement>) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              commands?.onTrimStart?.(event, context, edge);
            }}
          >
            <TrimHandleArrows directions={directions} />
          </div>
        );
      })}
    </>
  );
}

function toShellHandleStyle(
  rect: ClipInteractionShellRect,
  clipRect: ClipInteractionShellRect,
) {
  return {
    left: rect.x - clipRect.x,
    top: rect.y - clipRect.y,
    right: 'auto',
    bottom: 'auto',
    width: rect.width,
    height: rect.height,
  };
}
