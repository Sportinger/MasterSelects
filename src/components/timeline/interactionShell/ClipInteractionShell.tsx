import type { CSSProperties } from 'react';
import { ClipFadeHandles } from './ClipFadeHandles';
import { ClipTrimHandles } from './ClipTrimHandles';
import {
  CLIP_INTERACTION_SHELL_MODULE_SLOTS,
  getClipInteractionShellActiveSlots,
  type ClipInteractionShellCommandContext,
  type ClipInteractionShellModuleSlot,
  type ClipInteractionShellProps,
} from './types';

function buildShellStyle(props: ClipInteractionShellProps): CSSProperties {
  const { geometry, style } = props;

  return {
    position: 'absolute',
    left: geometry.clip.x,
    top: geometry.clip.y,
    width: geometry.clip.width,
    height: geometry.clip.height,
    pointerEvents: 'auto',
    ...style,
  };
}

function defaultRenderModule(slot: ClipInteractionShellModuleSlot) {
  return (
    <div
      key={slot}
      aria-hidden="true"
      data-clip-interaction-slot={slot}
      hidden
    />
  );
}

function renderBuiltInModule(
  slot: ClipInteractionShellModuleSlot,
  context: ClipInteractionShellCommandContext,
  commands: ClipInteractionShellProps['commands'],
) {
  if (slot === 'trim') {
    return <ClipTrimHandles key={slot} context={context} commands={commands} />;
  }

  if (slot === 'fade') {
    return <ClipFadeHandles key={slot} context={context} commands={commands} />;
  }

  return defaultRenderModule(slot);
}

export function ClipInteractionShell(props: ClipInteractionShellProps) {
  const { clip, track, geometry, mountState, activeModules, commands, className, renderModule } = props;

  if (!mountState.shouldMount) {
    return null;
  }

  const context: ClipInteractionShellCommandContext = {
    clip,
    track,
    geometry,
    mountState,
    activeModules,
  };
  const activeSlots = getClipInteractionShellActiveSlots(activeModules);
  const slotRenderer = renderModule ?? ((slot, slotContext) => renderBuiltInModule(slot, slotContext, commands));

  return (
    <div
      className={['clip-interaction-shell', className].filter(Boolean).join(' ')}
      data-clip-id={clip.id}
      data-track-id={track.id}
      data-mount-reasons={mountState.reasons.join(' ')}
      data-active-slots={activeSlots.join(' ')}
      data-shell-slot-contract={CLIP_INTERACTION_SHELL_MODULE_SLOTS.join(' ')}
      style={buildShellStyle(props)}
      tabIndex={-1}
      onPointerDown={(event) => commands?.onRootPointerDown?.(event, context)}
      onMouseDown={(event) => commands?.onRootMouseDown?.(event, context)}
      onContextMenu={(event) => commands?.onRootContextMenu?.(event, context)}
      onKeyDown={(event) => commands?.onRootKeyDown?.(event, context)}
    >
      {activeSlots.map((slot) => slotRenderer(slot, context))}
    </div>
  );
}
