import { useTimelineStore } from '../../../stores/timeline';
import { getAllEffects, getDefaultParams, getEffect, hasEffect, getCategoriesWithEffects, resolveEffectTypeId } from '../../../effects';
import type { ToolResult } from '../types';
import { selectClipAndOpenTab } from '../aiFeedback';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';
import type { JsonObject } from '../../motionDesign/adjustment/contracts';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../../motionDesign/adjustment/supportedEffectContractAdapter';
import { isSupportedAdjustmentEffectType } from '../../motionDesign/adjustment/supportedEffects';
import { effectParamDefinitions, unusedParamWarnings } from '../../operators/effectParamVisibility';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';
import { effectExperimentalNote } from '../../../effects/types';
import { useMediaStore } from '../../../stores/mediaStore';
import type { Effect } from '../../../types/effects';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

/**
 * Accepted parameters that do nothing on this instance (retired, or not read by its edited graph)
 * and blur limits at the active composition size: tools say so instead of failing silently.
 */
function effectParamWarnings(effect: Effect | undefined, names: readonly string[]): string[] {
  if (!effect) return [];
  const composition = useMediaStore.getState().getActiveComposition();
  return [...unusedParamWarnings(effect, names),
    ...blurBudgetNotes(effect.type, effect.params, composition?.width ?? 1920, composition?.height ?? 1080),
    ...(names.length ? definitionParamWarnings(effect.type, effect.params, composition?.width ?? 1920, composition?.height ?? 1080) : [])];
}

/** Values the effect itself clamps or cannot show (its `paramWarnings`), judged on the resulting parameters. */
function definitionParamWarnings(effectType: string, params: Record<string, unknown>, width: number, height: number): string[] {
  const definition = getEffect(effectType);
  if (!definition || !('paramWarnings' in definition) || !definition.paramWarnings) return [];
  try {
    return definition.paramWarnings(params as Record<string, number | boolean | string>, width, height);
  } catch { return []; }
}

export async function handleListEffects(): Promise<ToolResult> {
  const categories = getCategoriesWithEffects();
  const data = categories.map(({ category, effects }) => ({
    category,
    effects: effects.map(e => ({
      id: e.id,
      name: e.name,
      ...(effectExperimentalNote(e) ? { experimental: effectExperimentalNote(e) } : {}),
      // Retired parameters (accepted, but they do nothing) are not offered; other hidden ones stay listed.
      params: Object.entries(e.params).filter(([, param]) => !param.deprecated).map(([key, param]) => ({
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
  const effectType = resolveEffectTypeId(String(args.effectType ?? ''));
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
  const added = useTimelineStore.getState().clips.find(c => c.id === clipId)?.effects.find(e => e.id === newEffect?.id);
  const experimental = effectExperimentalNote(getEffect(effectType));
  const warnings = [...(experimental ? [`${getEffect(effectType)!.name} is experimental: ${experimental}`] : []),
    ...effectParamWarnings(added, Object.keys(customParams ?? {}))];

  return {
    success: true,
    data: {
      clipId,
      effectId: newEffect?.id,
      effectType,
      ...(warnings.length ? { warnings } : {}),
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
  if (!params || typeof params !== 'object') return { success: false, error: 'params must be an object.' };

  // A misspelled parameter used to be stored silently and do nothing; reject it with the valid names.
  // Retired parameters stay accepted (saved projects carry them) but are not offered while they do nothing.
  const known = new Set([...Object.keys(getEffect(effect.type)?.params ?? {}), ...Object.keys(effect.params)]);
  const unknown = Object.keys(params).filter(name => !known.has(name));
  if (unknown.length) {
    const definitions = effectParamDefinitions(effect);
    const valid = [...known].filter(name => !(definitions[name]?.deprecated && definitions[name].hidden));
    return { success: false, error: `Unknown parameter${unknown.length > 1 ? 's' : ''} for ${effect.type}: ${unknown.join(', ')}. Valid: ${valid.toSorted().join(', ')}` };
  }

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

  const updated = getClipEffects(clipId).find(item => item.id === effectId);
  const warnings = effectParamWarnings(updated, Object.keys(params));
  return {
    success: true,
    data: {
      clipId,
      effectId,
      updatedParams: Object.keys(params),
      ...(warnings.length ? { warnings } : {}),
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
