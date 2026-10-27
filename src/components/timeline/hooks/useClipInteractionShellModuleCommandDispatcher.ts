import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { cutAudioRegionOfClip, splitAudioRegionOfClip } from '../utils/audioRegionClipCommands';
import type {
  ClipInteractionShellCommandContext,
  ClipInteractionShellModuleCommand,
  ClipInteractionShellModuleSlot,
} from '../interactionShell';

export function useClipInteractionShellModuleCommandDispatcher() {
  return useCallback((
    slot: ClipInteractionShellModuleSlot,
    command: ClipInteractionShellModuleCommand,
    context: ClipInteractionShellCommandContext,
  ) => {
    const timelineState = useTimelineStore.getState();
    if (slot === 'audio-region') {
      const resolveActiveSelection = () => {
        const commandSelection = (
          (command.type === 'audio-region:split-selection' || command.type === 'audio-region:cut-selection') &&
          command.selection?.clipId === context.clip.id
        )
          ? command.selection
          : null;
        return commandSelection ??
          (timelineState.audioRegionSelection?.clipId === context.clip.id
            ? timelineState.audioRegionSelection
            : context.activeModules.audioRegion?.selection ?? null);
      };
      const splitAudioRegion = () => {
        splitAudioRegionOfClip(context.clip.id, resolveActiveSelection(), context.clip);
      };
      const cutAudioRegion = () => {
        cutAudioRegionOfClip(context.clip.id, resolveActiveSelection(), context.clip);
      };

      if (command.type === 'audio-region:set-selection') {
        timelineState.setAudioRegionSelection(command.selection);
        return;
      }
      if (command.type === 'audio-region:clear-selection') {
        timelineState.clearAudioRegionSelection();
        return;
      }
      if (command.type === 'audio-region:commit-operation-range') {
        if (command.operationIds.length > 0) {
          timelineState.setClipAudioEditOperationRange(context.clip.id, [...command.operationIds], command.selection, {
            captureHistory: true,
            historyLabel: command.historyLabel,
          });
        }
        return;
      }
      if (command.type === 'audio-region:set-gain-preview') {
        timelineState.setAudioRegionGainPreview(command.preview);
        return;
      }
      if (command.type === 'audio-region:clear-gain-preview') {
        if (timelineState.audioRegionGainPreview?.clipId === context.clip.id) {
          timelineState.clearAudioRegionGainPreview();
        }
        return;
      }
      if (command.type === 'audio-region:set-gain-edit') {
        timelineState.setAudioRegionGainEdit(command.options);
        return;
      }
      if (command.type === 'audio-region:apply-edit') {
        timelineState.applyAudioRegionEdit(command.editType, command.options);
        return;
      }
      if (command.type === 'audio-region:copy-selection') {
        timelineState.copySelectedAudioRegion();
        return;
      }
      if (command.type === 'audio-region:paste-selection') {
        timelineState.pasteAudioRegionToSelection();
        return;
      }
      if (command.type === 'audio-region:split-selection') {
        splitAudioRegion();
        return;
      }
      if (command.type === 'audio-region:cut-selection') {
        cutAudioRegion();
        return;
      }
      if (command.type === 'audio-region:toggle-operation') {
        timelineState.setClipAudioEditOperationEnabled(context.clip.id, command.operationId, command.disabled);
        return;
      }
      if (command.type === 'audio-region:remove-operation') {
        timelineState.removeClipAudioEditOperation(context.clip.id, command.operationId);
        return;
      }
      if (command.type === 'audio-region:clear-stack') {
        timelineState.clearClipAudioEditStack(context.clip.id);
        return;
      }
      if (command.type === 'audio-region:bake-stack') {
        return timelineState.bakeClipAudioEditStack(context.clip.id).then(() => undefined);
      }
      if (command.type === 'audio-region:unbake-stack') {
        timelineState.unbakeClipAudioEditStack(context.clip.id);
      }
      return;
    }
    if (slot === 'spectral-region') {
      if (command.type === 'spectral-region:set-selection') {
        timelineState.setAudioSpectralRegionSelection(command.selection);
        return;
      }
      if (command.type === 'spectral-region:clear-selection') {
        timelineState.clearAudioSpectralRegionSelection();
        return;
      }
      if (command.type === 'spectral-region:apply-edit') {
        timelineState.applySpectralRegionEdit(command.editType);
        return;
      }
      if (command.type === 'spectral-region:add-image-layer') {
        timelineState.addClipSpectralImageLayer(context.clip.id, command.layer);
      }
      return;
    }
    if (slot === 'stem') {
      if (command.type === 'stem:prewarm-source-media-files') {
        timelineState.prewarmStemSourceMediaFiles([...command.mediaFileIds]);
        return;
      }
      if (command.type === 'stem:set-clip-source') {
        timelineState.setClipSourceToStem(context.clip.id, command.stemMediaFileId);
      }
      return;
    }
    if (slot !== 'video-bake') return;
    if (command.type === 'video-bake:bake-region') {
      void timelineState.bakeClipVideoBakeRegion(context.clip.id, command.regionId);
      return;
    }
    if (command.type === 'video-bake:unbake-region') {
      timelineState.unbakeClipVideoBakeRegion(context.clip.id, command.regionId);
      return;
    }
    if (command.type === 'video-bake:remove-region') {
      timelineState.removeClipVideoBakeRegion(context.clip.id, command.regionId);
    }
  }, []);
}
