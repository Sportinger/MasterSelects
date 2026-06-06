import type { MouseEvent as ReactMouseEvent } from 'react';
import type {
  ClipInteractionShellCommandContext,
  ClipInteractionShellCommands,
  ClipInteractionShellEdge,
  ClipInteractionShellRect,
} from './types';
import { FadeCurve } from '../components/FadeCurve';

const FADE_EDGES = ['left', 'right'] as const satisfies readonly ClipInteractionShellEdge[];

interface ClipFadeHandlesProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

export function ClipFadeHandles({ context, commands }: ClipFadeHandlesProps) {
  const fade = context.activeModules.fade;
  if (!fade?.enabled) return null;

  return (
    <>
      {fade.curveKeyframes.length >= 2 && (
        <div
          className={`fade-curve-container ${fade.isAudioClip ? 'audio-automation-curve-container' : ''}`}
          data-shell-fade-curve="true"
          data-audio-automation-curve={fade.isAudioClip ? 'volume' : undefined}
        >
          <FadeCurve
            key={fade.curveKey}
            keyframes={fade.curveKeyframes}
            clipDuration={fade.clipDuration}
            width={context.geometry.clip.width}
            height={context.geometry.clip.height}
          />
        </div>
      )}
      {FADE_EDGES.map((edge) => {
        const rect = context.geometry.fadeHandles[edge];
        if (!rect) return null;

        const isActiveEdge = fade.activeEdges.includes(edge);

        return (
          <div
            key={edge}
            className={[
              'fade-handle',
              'shell-fade-handle',
              edge,
              isActiveEdge ? 'active' : '',
            ].filter(Boolean).join(' ')}
            data-shell-fade-edge={edge}
            style={toShellHandleStyle(rect, context.geometry.clip, edge)}
            onMouseDown={(event: ReactMouseEvent<HTMLElement>) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              commands?.onFadeStart?.(event, context, edge);
            }}
          />
        );
      })}
    </>
  );
}

function toShellHandleStyle(
  rect: ClipInteractionShellRect,
  clipRect: ClipInteractionShellRect,
  edge: ClipInteractionShellEdge,
) {
  const left = edge === 'right' ? 'auto' : rect.x - clipRect.x;
  const right = edge === 'right' ? clipRect.x + clipRect.width - (rect.x + rect.width) : 'auto';

  return {
    left,
    top: rect.y - clipRect.y,
    right,
    bottom: 'auto',
    width: rect.width,
    height: rect.height,
  };
}
