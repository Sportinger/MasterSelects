// Styling several titles at once (the 'textMulti' sheet). The sheet keeps one draft (a size change
// plus shared values: colour, bold, italic, alignment, outline, shadow) and writes it to every picked
// title as ABSOLUTE values from the state captured when the sheet opened, so re-applying is safe and
// unpicking a title puts it back. The size is a RELATIVE change like the desktop Text inspector's
// selection editing: each title keeps its own size plus the same step, sampled at its own local
// time (sampleTextNumber), and an animated size gets a key at the playhead (setPropertyValue).
// Titles on locked tracks and node-driven sizes are listed with the reason, never changed silently.

import { sampleTextNumber, type EditableTextClip } from '../../panels/properties/textSelectionEditing';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import { normalizeTextValue } from '../../../services/text/textAnimation';
import { useTimelineStore } from '../../../stores/timeline';
import type { TextClipProperties } from '../../../types/text';
import type { TimelineClip } from '../../../types/timeline';
import { toggledBoldWeight } from './phoneTextStyle';

type TimelineState = ReturnType<typeof useTimelineStore.getState>;

export interface PhoneTextMultiDraft {
  /** Pixels added to every title's own size (0 = unchanged). */
  sizeDelta: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: TextClipProperties['textAlign'];
  strokeEnabled?: boolean;
  shadowEnabled?: boolean;
}

export const EMPTY_PHONE_TEXT_MULTI_DRAFT: PhoneTextMultiDraft = { sizeDelta: 0 };

/** What a title looked like when the sheet opened (restored when it is unpicked). */
export interface PhoneTextOriginal {
  clipId: string;
  fontSize: number;
  fontSizeAnimated: boolean;
  properties: Pick<TextClipProperties, 'color' | 'fontWeight' | 'fontStyle' | 'fontFamily' | 'textAlign' | 'strokeEnabled' | 'shadowEnabled'>;
}

export interface PhoneTextCandidate {
  clip: TimelineClip;
  reason: string | null;
}

function isTitle(clip: TimelineClip): clip is EditableTextClip {
  return Boolean(clip.textProperties) && clip.source?.type === 'text';
}

/** Every title of the open composition in timeline order; locked ones carry the reason. */
export function listPhoneTextCandidates(state: Pick<TimelineState, 'clips' | 'tracks'> = useTimelineStore.getState()): PhoneTextCandidate[] {
  const locked = new Set(state.tracks.filter((track) => track.locked).map((track) => track.id));
  return state.clips
    .filter(isTitle)
    .toSorted((a, b) => a.startTime - b.startTime)
    .map((clip) => ({ clip, reason: locked.has(clip.trackId) ? 'On a locked track: unlock the track to style this title.' : null }));
}

export function capturePhoneTextOriginal(state: TimelineState, clip: EditableTextClip): PhoneTextOriginal {
  const p = clip.textProperties;
  return {
    clipId: clip.id,
    fontSize: sampleTextNumber(state, clip, 'fontSize', !clip.captionProperties && !clip.captionLayerBinding),
    fontSizeAnimated: state.hasKeyframes(clip.id, 'text.fontSize'),
    properties: {
      color: p.color, fontWeight: p.fontWeight, fontStyle: p.fontStyle, fontFamily: p.fontFamily,
      textAlign: p.textAlign, strokeEnabled: p.strokeEnabled, shadowEnabled: p.shadowEnabled,
    },
  };
}

/** The patch (non-size values) the draft gives one title. */
export function phoneTextMultiPatch(original: PhoneTextOriginal, draft: PhoneTextMultiDraft): Partial<TextClipProperties> {
  const patch: Partial<TextClipProperties> = {};
  if (draft.color !== undefined) patch.color = draft.color;
  if (draft.bold !== undefined) {
    const family = original.properties.fontFamily;
    const weight = original.properties.fontWeight ?? 400;
    patch.fontWeight = draft.bold === (weight >= 600) ? weight : toggledBoldWeight(family, weight);
  }
  if (draft.italic !== undefined) patch.fontStyle = draft.italic ? 'italic' : 'normal';
  if (draft.textAlign !== undefined) patch.textAlign = draft.textAlign;
  if (draft.strokeEnabled !== undefined) patch.strokeEnabled = draft.strokeEnabled;
  if (draft.shadowEnabled !== undefined) patch.shadowEnabled = draft.shadowEnabled;
  return patch;
}

/** The size the draft gives a title: its own size at open plus the shared step, inside the editor's limits. */
export function phoneTextMultiSize(original: Pick<PhoneTextOriginal, 'fontSize'>, draft: Pick<PhoneTextMultiDraft, 'sizeDelta'>): number {
  return normalizeTextValue('fontSize', original.fontSize + draft.sizeDelta);
}

function writeSize(state: TimelineState, clip: EditableTextClip, value: number) {
  const current = sampleTextNumber(state, clip, 'fontSize', !clip.captionProperties && !clip.captionLayerBinding);
  if (Math.abs(current - value) < 1e-6) return;
  if (!clip.captionProperties && !clip.captionLayerBinding) state.setPropertyValue(clip.id, 'text.fontSize', value);
  else state.updateTextProperties(clip.id, { fontSize: value });
}

export interface PhoneTextMultiReport {
  styled: number;
  /** Titles whose size a node drives: their size stays, the other values apply. */
  nodeDrivenSize: string[];
}

/**
 * Writes the draft to the picked titles and the originals back to touched titles that are no
 * longer picked. Absolute values only; runs inside the sheet's edit session.
 */
export function applyPhoneTextMulti(
  originals: ReadonlyMap<string, PhoneTextOriginal>,
  picked: ReadonlySet<string>,
  draft: PhoneTextMultiDraft,
): PhoneTextMultiReport {
  const report: PhoneTextMultiReport = { styled: 0, nodeDrivenSize: [] };
  for (const original of originals.values()) {
    const state = useTimelineStore.getState();
    const clip = state.clips.find((candidate) => candidate.id === original.clipId);
    if (!clip || !isTitle(clip)) continue;
    if (state.tracks.find((track) => track.id === clip.trackId)?.locked) continue;
    const on = picked.has(clip.id);
    const patch = on ? phoneTextMultiPatch(original, draft) : { ...original.properties };
    const changed = Object.entries(patch).some(([key, value]) => clip.textProperties[key as keyof TextClipProperties] !== value);
    if (changed) state.updateTextProperties(clip.id, patch);
    const size = on ? phoneTextMultiSize(original, draft) : original.fontSize;
    if (isParameterNodeDriven(clip, 'text.fontSize')) {
      if (on && draft.sizeDelta !== 0) report.nodeDrivenSize.push(clip.name);
    } else {
      const fresh = useTimelineStore.getState().clips.find((candidate) => candidate.id === clip.id);
      if (fresh && isTitle(fresh)) writeSize(useTimelineStore.getState(), fresh, size);
    }
    if (on) report.styled += 1;
  }
  return report;
}

/** The value a shared control shows: the common value of the picked titles, or undefined when they differ. */
export function commonPhoneTextValue<K extends keyof PhoneTextOriginal['properties']>(
  originals: ReadonlyMap<string, PhoneTextOriginal>, picked: ReadonlySet<string>, key: K,
): PhoneTextOriginal['properties'][K] | undefined {
  const values = [...picked].map((id) => originals.get(id)?.properties[key]);
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined;
}
