// The Adjust sheet's colour controls, mapped onto the editor's colour grade (clip.colorCorrection,
// the Primaries node the desktop Color tab edits). Ranges and defaults come from the editor's
// PRIMARY_COLOR_PARAM_DEFS; values are written with setPropertyValue on `color.<version>.<node>.<param>`,
// exactly like the desktop colour editor, so keyframed values get a key at the playhead.

import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import {
  createColorProperty, ensureColorCorrectionState, getActiveColorVersion, getEditableColorNodes,
  PRIMARY_COLOR_PARAM_DEFS, type ColorParamDefinition, type RuntimePrimaryColorParams,
} from '../../../types/colorCorrection';
import type { TimelineClip } from '../../../types/timeline';

export interface PhoneAdjustControl {
  key: keyof RuntimePrimaryColorParams;
  /** Phone label (Brightness is the grade's Offset: it lifts every channel by the same amount). */
  label: string;
  def: ColorParamDefinition;
}

/** Phone order: the everyday controls first, then the levels. Every primary grade parameter is here. */
const PHONE_ORDER: ReadonlyArray<[keyof RuntimePrimaryColorParams, string]> = [
  ['offset', 'Brightness'], ['exposure', 'Exposure'], ['contrast', 'Contrast'], ['saturation', 'Saturation'],
  ['temperature', 'Temperature'], ['tint', 'Tint'], ['highlights', 'Highlights'], ['shadows', 'Shadows'],
  ['vibrance', 'Vibrance'], ['hue', 'Hue'], ['lift', 'Lift'], ['gamma', 'Gamma'], ['gain', 'Gain'],
  ['blackPoint', 'Black point'], ['whitePoint', 'White point'], ['pivot', 'Contrast pivot'],
];

export const PHONE_ADJUST_CONTROLS: readonly PhoneAdjustControl[] = PHONE_ORDER.flatMap(([key, label]) => {
  const def = PRIMARY_COLOR_PARAM_DEFS.find((candidate) => candidate.key === key);
  return def ? [{ key, label, def }] : [];
});

export function formatPhoneAdjustValue(control: PhoneAdjustControl, value: number): string {
  const decimals = Math.min(control.def.decimals, 2);
  return value.toFixed(decimals);
}

/** The grade node the phone edits on a clip: the node selected in the colour editor, else the first grade node. */
export function phoneAdjustNode(clip: Pick<TimelineClip, 'colorCorrection'>): { versionId: string; nodeId: string } | null {
  if (!clip.colorCorrection) return null;
  const state = ensureColorCorrectionState(clip.colorCorrection);
  const version = getActiveColorVersion(state);
  const nodes = getEditableColorNodes(state);
  const node = nodes.find((candidate) => candidate.id === state.ui.selectedNodeId) ?? nodes[0];
  return version && node ? { versionId: version.id, nodeId: node.id } : null;
}

/** The animatable property of `key` on `clip`'s edited grade node, or null when the clip has no grade yet. */
export function phoneAdjustProperty(clip: Pick<TimelineClip, 'colorCorrection'>, key: string): AnimatableProperty | null {
  const node = phoneAdjustNode(clip);
  return node ? createColorProperty(node.versionId, node.nodeId, key) as AnimatableProperty : null;
}

/**
 * Sets `values` on every clip (absolute; a clip without a grade gets the editor's default grade first).
 * Runs inside the caller's transaction.
 */
export function setPhoneAdjustValues(clipIds: readonly string[], values: Partial<Record<keyof RuntimePrimaryColorParams, number>>): void {
  for (const clipId of clipIds) {
    useTimelineStore.getState().ensureColorCorrection(clipId);
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;
    for (const [key, value] of Object.entries(values)) {
      const property = phoneAdjustProperty(clip, key);
      if (property && typeof value === 'number') useTimelineStore.getState().setPropertyValue(clipId, property, value);
    }
  }
}
