import type { TimelineClip } from '../../../types/timeline';
import { getEffect } from '../../../effects';
import { admitAdjustmentEffectsForRender, type BypassedAdjustmentEffect } from './adjustmentEffectRenderAdmission';
import {
  inspectAdjustmentLayerProperties,
  type AdjustmentLayerPropertyCode,
  type SkippedAdjustmentLayerProperty,
} from './adjustmentLayerRenderAdmission';

const SHORT_LABELS: Readonly<Record<AdjustmentLayerPropertyCode, string>> = {
  transform: 'its transform',
  opacity: 'its opacity outside 0-100 % (clamped)',
  'blend-mode': 'its blend mode (Normal instead)',
  '3d': '3D',
  'source-rect': 'its crop rectangle',
  transition: 'its transition',
  'scene-graph': 'its 3D scene graph',
  'custom-nodes': 'its custom nodes',
};

type ReportedClip = Pick<TimelineClip, 'id' | 'name' | 'source' | 'startTime' | 'duration' | 'effects' | 'transform'
  | 'is3D' | 'sourceRect' | 'transitionRender' | 'nodeGraph' | 'sceneGraphOutput'>;

export interface AdjustmentLayerRenderReport {
  /** Layer properties the layer renders without, each with its reason. */
  readonly skippedProperties: readonly SkippedAdjustmentLayerProperty[];
  /** Effects the layer renders without, each with its reason. */
  readonly bypassedEffects: readonly BypassedAdjustmentEffect[];
}

/** What an adjustment layer renders without, for tool results (getClipDetails, addEffect, editMotionAdjustment). */
export function adjustmentLayerRenderReport(clip: Omit<ReportedClip, 'name' | 'source' | 'startTime' | 'duration'>): AdjustmentLayerRenderReport {
  return {
    skippedProperties: inspectAdjustmentLayerProperties(clip),
    bypassedEffects: admitAdjustmentEffectsForRender(clip.id, clip.effects ?? []).bypassed,
  };
}

/** One warning line per skipped layer property, for tool results. */
export function adjustmentLayerSkipWarnings(clip: Omit<ReportedClip, 'name' | 'source' | 'startTime' | 'duration'>): string[] {
  return inspectAdjustmentLayerProperties(clip).map((item) => `Adjustment layer renders without a property: ${item.reason}`);
}

export interface AdjustmentLayerExportNote {
  readonly clipId: string;
  readonly startTime: number;
  readonly duration: number;
  /** One sentence for the export sheet or panel. */
  readonly note: string;
}

/**
 * What the export renders without on each adjustment layer: skipped layer properties and bypassed
 * effects (the same admission the renderer applies), one note per affected layer. Layers that render
 * completely give no note.
 */
export function adjustmentLayerExportNotes(clips: readonly ReportedClip[]): AdjustmentLayerExportNote[] {
  const notes: AdjustmentLayerExportNote[] = [];
  for (const clip of clips) {
    if (clip.source?.type !== 'motion-adjustment') continue;
    const report = adjustmentLayerRenderReport(clip);
    const skipped = report.skippedProperties.map((item) => SHORT_LABELS[item.code]);
    const bypassed = report.bypassedEffects.map((item) => `${getEffect(item.effectType)?.name ?? item.effectType} (bypassed)`);
    const parts = [...skipped, ...bypassed];
    if (parts.length === 0) continue;
    notes.push({
      clipId: clip.id,
      startTime: clip.startTime,
      duration: clip.duration,
      note: `Adjustment layer "${clip.name}" exports without ${parts.join(', ')}; select it to see why.`,
    });
  }
  return notes;
}
