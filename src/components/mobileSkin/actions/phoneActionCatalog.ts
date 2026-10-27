// One catalog drives the root toolbar, the clip toolbar and every "not yet" explanation.
// Actions of later milestones stay visible and resolve to an unavailable state with a reason.
import {
  isMilestoneShipped,
  type PhoneActionAvailability,
  type PhoneActionContext,
  type PhoneActionDefinition,
  type PhoneIconName,
  type PhoneActionResult,
  type PhoneMilestone,
  type PhoneSheetId,
  type PhoneToolbarScope,
} from '../contracts';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { splitSelectedAtPlayhead } from './phoneCutActions';
import {
  deleteSelectedClips,
  duplicateSelectedClips,
  rippleDeleteSelectedClips,
} from './phoneClipEditActions';

const FULL_EDITOR_HINT = 'Use the full editor at /editor meanwhile.';

function pending(label: string, milestone: PhoneMilestone): string {
  return `${label} arrives with milestone ${milestone} of the phone editor. ${FULL_EDITOR_HINT}`;
}

interface ClipSpan {
  id: string;
  startTime: number;
  duration: number;
}

/** Epsilon in seconds: the playhead must be clearly inside the clip, not on an edge. */
const SPLIT_EDGE_EPSILON = 1e-4;

/** Pure rule behind the Split button; exported for tests. */
export function resolveSplitAvailability(
  context: PhoneActionContext,
  clips: readonly ClipSpan[],
): PhoneActionAvailability {
  if (!context.projectOpen) return { kind: 'unavailable', reason: 'Open a project before splitting.' };
  if (!context.engineReady) return { kind: 'unavailable', reason: 'The preview engine is still starting.' };
  if (context.selectedClipIds.length === 0) {
    return { kind: 'unavailable', reason: 'Select a clip first, then split it at the playhead.' };
  }
  const selected = new Set(context.selectedClipIds);
  const t = context.playheadTime;
  const inside = clips.some(
    (clip) =>
      selected.has(clip.id) &&
      t > clip.startTime + SPLIT_EDGE_EPSILON &&
      t < clip.startTime + clip.duration - SPLIT_EDGE_EPSILON,
  );
  if (!inside) {
    return { kind: 'unavailable', reason: 'Move the playhead inside the selected clip to split it.' };
  }
  return { kind: 'available' };
}

function openPhoneSheet(sheetId: PhoneSheetId): PhoneActionResult {
  usePhoneUiStore.getState().openSheet(sheetId);
  return { ok: true };
}

function def(
  id: string,
  label: string,
  icon: PhoneIconName,
  scope: PhoneToolbarScope,
  milestone: PhoneMilestone,
  extra: Partial<PhoneActionDefinition> = {},
): PhoneActionDefinition {
  return { id, label, icon, scope, milestone, pendingReason: pending(label, milestone), ...extra };
}

export const PHONE_ACTIONS: readonly PhoneActionDefinition[] = [
  // Root scope: nothing selected.
  def('edit', 'Edit', 'trim', 'root', 'M1', {
    run: () => ({ ok: true, message: 'Tap a clip to edit it' }),
  }),
  def('audio', 'Audio', 'audio', 'root', 'M2'),
  def('text', 'Text', 'text', 'root', 'M1', {
    run: () => openPhoneSheet('title'),
  }),
  def('effects-root', 'Effects', 'effects', 'root', 'M2'),
  def('overlay', 'Overlay', 'overlay', 'root', 'M2'),
  def('captions', 'Captions', 'captions', 'root', 'M3'),
  def('filters-root', 'Filters', 'filters', 'root', 'M2'),
  def('adjust-root', 'Adjust', 'adjust', 'root', 'M2'),
  def('format', 'Format', 'format', 'root', 'M2'),
  def('assistant', 'Assistant', 'assistant', 'root', 'M5'),
  def('media', 'Media', 'media', 'root', 'M1', {
    run: () => openPhoneSheet('media'),
  }),

  // Clip scope: at least one clip selected.
  def('split', 'Split', 'split', 'clip', 'M0', {
    availability: (context) => resolveSplitAvailability(context, useTimelineStore.getState().clips),
    run: () => splitSelectedAtPlayhead(),
  }),
  def('delete', 'Delete', 'delete', 'clip', 'M1', { run: () => deleteSelectedClips() }),
  def('ripple-delete', 'Delete & close gap', 'delete', 'clip', 'M1', { run: () => rippleDeleteSelectedClips() }),
  def('duplicate', 'Duplicate', 'duplicate', 'clip', 'M1', { run: () => duplicateSelectedClips() }),
  def('speed', 'Speed', 'speed', 'clip', 'M2'),
  def('volume', 'Volume', 'volume', 'clip', 'M2'),
  def('animation', 'Animation', 'animation', 'clip', 'M2'),
  def('effects', 'Effects', 'effects', 'clip', 'M2'),
  def('filters', 'Filters', 'filters', 'clip', 'M2'),
  def('adjust', 'Adjust', 'adjust', 'clip', 'M2'),
  def('mask', 'Mask', 'mask', 'clip', 'M2'),
  def('crop', 'Crop', 'crop', 'clip', 'M2'),
  def('transition', 'Transition', 'transition', 'clip', 'M2'),
  def('keyframe', 'Keyframe', 'keyframe', 'clip', 'M2'),
  def('replace', 'Replace', 'replace', 'clip', 'M3'),
  def('reorder', 'Reorder', 'reorder', 'clip', 'M1', {
    run: () => ({ ok: true, message: 'Long-press a clip and drag it' }),
  }),
];

export function getPhoneActionsForScope(scope: PhoneToolbarScope): readonly PhoneActionDefinition[] {
  return PHONE_ACTIONS.filter((action) => action.scope === scope);
}

export function resolvePhoneActionState(
  action: PhoneActionDefinition,
  context: PhoneActionContext,
  shipped?: PhoneMilestone,
): PhoneActionAvailability {
  if (!isMilestoneShipped(action.milestone, shipped)) {
    return {
      kind: 'unavailable',
      reason: action.pendingReason ?? pending(action.label, action.milestone),
    };
  }
  return action.availability ? action.availability(context) : { kind: 'available' };
}
