import { useTimelineStore } from '../../../stores/timeline';
import { getAllEffects, getDefaultParams, hasEffect, getCategoriesWithEffects } from '../../../effects';
import type { ToolResult } from '../types';
import { selectClipAndOpenTab } from '../aiFeedback';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';
import type { JsonObject } from '../../motionDesign/adjustment/contracts';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../../motionDesign/adjustment/supportedEffectContractAdapter';
import { isSupportedAdjustmentEffectType } from '../../motionDesign/adjustment/supportedEffects';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleListEffects(): Promise<ToolResult> {
  const categories = getCategoriesWithEffects();
  const data = categories.map(({ category, effects }) => ({
    category,
    effects: effects.map(e => ({
      id: e.id,
      name: e.name,
      params: Object.entries(e.params).map(([key, param]) => ({
        name: key,
        type: param.type,
        default: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        description: param.label || key,
      })),
    })),
  }));

  return {
    success: true,
    data: { totalEffects: getAllEffects().length, categories: data },
  };
}

export async function handleAddEffect(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const effectType = args.effectType as string;
  const customParams = args.params as Record<string, unknown> | undefined;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  if (!hasEffect(effectType)) {
    const available = getAllEffects().map(e => e.id).join(', ');
    return { success: false, error: `Unknown effect type: ${effectType}. Available: ${available}` };
  }
  if (clip.source?.type === 'motion-adjustment') {
    const adjustmentFailure = validateGenericAdjustmentEffect(
      clip.id,
      effectType,
      { ...getDefaultParams(effectType), ...customParams },
    );
    if (adjustmentFailure) return adjustmentFailure;
  }

  const mutationSnapshot = captureMutationEntitySnapshot('effect', clip.effects);
  const { addClipEffect, updateClipEffect, invalidateCache } = useTimelineStore.getState();
  addClipEffect(clipId, effectType);

  // Visual feedback: select clip and open effects tab
  selectClipAndOpenTab(clipId, 'effects');

  // Find the newly added effect (last one on the clip)
  const updatedClip = useTimelineStore.getState().clips.find(c => c.id === clipId);
  const newEffect = updatedClip?.effects[updatedClip.effects.length - 1];

  // Apply custom params if provided
  if (newEffect && customParams) {
    updateClipEffect(clipId, newEffect.id, customParams as Partial<Record<string, string | number | boolean>>);
  }

  invalidateCache();

  return {
    success: true,
    data: {
      clipId,
      effectId: newEffect?.id,
      effectType,
      params: newEffect ? { ...getDefaultParams(effectType), ...customParams } : getDefaultParams(effectType),
      ...describeMutationEntities(
        mutationSnapshot,
        getClipEffects(clipId),
      ),
    },
  };
}

export async function handleRemoveEffect(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const effectId = args.effectId as string;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) return { success: false, error: `Effect not found: ${effectId}` };

  const mutationSnapshot = captureMutationEntitySnapshot('effect', clip.effects);
  const { removeClipEffect, invalidateCache } = useTimelineStore.getState();
  removeClipEffect(clipId, effectId);
  invalidateCache();

  // Visual feedback: select clip and open effects tab
  selectClipAndOpenTab(clipId, 'effects');

  return {
    success: true,
    data: {
      clipId,
      removedEffectId: effectId,
      removedEffectType: effect.type,
      ...describeMutationEntities(
        mutationSnapshot,
        getClipEffects(clipId),
      ),
    },
  };
}

export async function handleUpdateEffect(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const effectId = args.effectId as string;
  const params = args.params as Record<string, unknown>;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) return { success: false, error: `Effect not found: ${effectId}` };

  if (clip.source?.type === 'motion-adjustment') {
    const adjustmentFailure = validateGenericAdjustmentEffect(
      clip.id,
      effect.type,
      { ...effect.params, ...params },
      effect.id,
      effect.enabled,
    );
    if (adjustmentFailure) return adjustmentFailure;
  }

  const mutationSnapshot = captureMutationEntitySnapshot('effect', clip.effects);
  const { updateClipEffect, invalidateCache } = useTimelineStore.getState();
  updateClipEffect(clipId, effectId, params as Partial<Record<string, string | number | boolean>>);
  invalidateCache();

  // Visual feedback: select clip and open effects tab
  selectClipAndOpenTab(clipId, 'effects');

  return {
    success: true,
    data: {
      clipId,
      effectId,
      updatedParams: Object.keys(params),
      ...describeMutationEntities(
        mutationSnapshot,
        getClipEffects(clipId),
      ),
    },
  };
}

function getClipEffects(clipId: string) {
  return useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.effects ?? [];
}

function validateGenericAdjustmentEffect(
  clipId: string,
  effectType: string,
  params: Record<string, unknown>,
  effectId = 'effect:ai-preflight',
  enabled = true,
): ToolResult | null {
  if (!isSupportedAdjustmentEffectType(effectType)) {
    return {
      success: false,
      error: `Unsupported Adjustment 1.0 effect: ${effectType}`,
      data: {
        code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT',
        clipId,
        effectType,
      },
    };
  }
  try {
    adaptTimelineEffectsToMotionAdjustmentContracts({
      layerId: clipId,
      effects: [{
        id: effectId,
        name: effectType,
        type: effectType,
        enabled,
        params: params as JsonObject,
      }],
    });
    return null;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: {
        code: 'MD7_ADJUSTMENT_INVALID_EFFECT',
        clipId,
        effectId,
        effectType,
      },
    };
  }
}
