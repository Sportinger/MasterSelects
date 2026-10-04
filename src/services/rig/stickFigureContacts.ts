import type { Effect } from '../../types/effects';
import { useTimelineStore } from '../../stores/timeline';
import { getSimpleSynthPreset } from '../../engine/audio/synth/simpleSynthPresets';
import { parseSkeletonActions, SKELETON_ACTIONS, skeletonActionContact, type SkeletonActionId } from './skeletonActions';
import { parseStickFigureRef, STICK_FIGURE_EFFECT } from './stickFigureJointRuntime';

export interface StickFigureContact {
  /** Timeline seconds. */
  time: number;
  action: SkeletonActionId;
  label: string;
  instanceId: string;
}

/** Contact moments (impacts, releases, landings) of a figure's action lane, in timeline seconds. */
export function stickFigureContacts(clip: { startTime: number }, effect: Pick<Effect, 'params'>): StickFigureContact[] {
  return parseSkeletonActions(effect.params.actions).flatMap(instance => {
    const contact = skeletonActionContact(instance);
    return contact === undefined ? [] : [{
      time: clip.startTime + contact, action: instance.action, label: SKELETON_ACTIONS[instance.action].label, instanceId: instance.id,
    }];
  }).sort((a, b) => a.time - b.time);
}

/** Contacts of the figure a reference names (`clipId|effectId`); empty = first figure on `ownerClipId`. */
export function contactsForFigure(ref: string, ownerClipId?: string): StickFigureContact[] {
  const { clips } = useTimelineStore.getState();
  const parsed = ref ? parseStickFigureRef(ref) : null;
  const clip = clips.find(item => item.id === (parsed?.clipId ?? ownerClipId));
  const effect = clip?.effects.find(item => item.type === STICK_FIGURE_EFFECT && (!parsed || item.id === parsed.effectId));
  return clip && effect ? stickFigureContacts(clip, effect) : [];
}

function figureOf(clipId: string, effectId: string) {
  const clip = useTimelineStore.getState().clips.find(item => item.id === clipId);
  const effect = clip?.effects.find(item => item.id === effectId && item.type === STICK_FIGURE_EFFECT);
  if (!clip || !effect) throw new Error('Stick figure not found.');
  return { clip, effect };
}

const CONTACT_MARKER_COLOR = '#ff7a2f';

/**
 * Replace this figure's contact markers with one marker per contact, labelled with the action.
 * Marker Trigger nodes (shake, flash) and sound placement can then follow the choreography.
 * The marker ids are kept on the effect, so re-syncing never touches other markers.
 */
export function syncStickFigureContactMarkers(clipId: string, effectId: string): string[] {
  const { clip, effect } = figureOf(clipId, effectId);
  const state = useTimelineStore.getState();
  let previous: string[] = [];
  try { previous = JSON.parse(String(effect.params.contactMarkers ?? '[]')) as string[]; } catch { previous = []; }
  for (const id of previous) if (state.markers.some(marker => marker.id === id)) state.removeMarker(id);
  const ids = stickFigureContacts(clip, effect).map(contact => state.addMarker(contact.time, contact.label, CONTACT_MARKER_COLOR));
  state.updateClipEffect(clipId, effectId, { contactMarkers: JSON.stringify(ids) });
  return ids;
}

const SFX_PITCH: Partial<Record<SkeletonActionId, number>> = {
  punch: 52, kick: 45, 'hit-react': 48, land: 40, fall: 36, jump: 43, throw: 60, grab: 55,
};

/**
 * Add a MIDI track playing a Simple Synth SFX preset with one short note per contact of the
 * figure. Returns the new track and clip ids.
 */
export function addStickFigureContactSfx(clipId: string, effectId: string, presetId = 'sfx-hit'): { trackId: string; midiClipId: string } {
  const { clip, effect } = figureOf(clipId, effectId);
  const contacts = stickFigureContacts(clip, effect);
  if (!contacts.length) throw new Error('This figure has no contact moments yet. Add actions such as Punch, Kick or Land.');
  const preset = getSimpleSynthPreset(presetId);
  if (!preset) throw new Error(`Unknown sound preset: ${presetId}`);
  const state = useTimelineStore.getState();
  const trackId = state.addTrack('midi');
  state.setTrackMidiInstrument(trackId, structuredClone(preset.instrument));
  const midiClipId = state.addMidiClip(trackId, clip.startTime, Math.max(0.5, clip.duration));
  if (!midiClipId) throw new Error('Could not create the sound clip.');
  state.addMidiNotes(midiClipId, contacts.map(contact => ({
    pitch: SFX_PITCH[contact.action] ?? 48, start: Math.max(0, contact.time - clip.startTime), duration: 0.15, velocity: 0.9,
  })));
  return { trackId, midiClipId };
}
