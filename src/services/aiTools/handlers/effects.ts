import { useTimelineStore } from '../../../stores/timeline';
import { getAllEffects, getDefaultParams, getEffect, hasEffect, getCategoriesWithEffects, resolveEffectTypeId, effectRateTravelParams, withoutRuntimeTravelParams } from '../../../effects';
import { paramRangeNotes } from '../../../effects/paramRangeNotes';
import type { ToolResult } from '../types';
import type { TimelineClip } from '../../../types/timeline';
import { selectClipAndOpenTab } from '../aiFeedback';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';
import type { JsonObject } from '../../motionDesign/adjustment/contracts';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../../motionDesign/adjustment/supportedEffectContractAdapter';
import { adjustmentEffectAdmission } from '../../motionDesign/adjustment/supportedEffects';
import { effectDefinitionNotes, effectParamDefinitions, graphBoundParameters, unusedParamWarnings } from '../../operators/effectParamVisibility';
import { earlierStylizeRecipeNote, previousStylizeRecipeNote } from '../../operators/stylizeRecipes';
import { chromaKeyScreen } from '../../../effects/keying/chroma-key/keyerContract';
import { chromaKeyScreenProbeMessage, probeChromaKeyScreen } from '../../../effects/keying/chroma-key/screenProbe';
import { blurBudgetNotes } from '../../../effects/blur/blurSampling';
import { effectExperimentalNote } from '../../../effects/types';
import { useMediaStore } from '../../../stores/mediaStore';
import type { Effect } from '../../../types/effects';
import type { EffectParam } from '../../../effects/types';
import { finiteEffectNumber, isUnusableEffectNumber } from '../../../effects/_shared/effectNumberParam';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

/**
 * Accepted parameters that do nothing on this instance (retired, or not read by its edited graph),
 * numbers outside a parameter's rendered range, blur limits at the active composition size and
 * the effect's own notes on values it clamps or cannot show: tools say so instead of failing
 * silently. The effect's own notes describe its current recipe; an instance that runs an earlier
 * saved stylize recipe gets one note naming that version instead.
 */
export function effectParamWarnings(effect: Effect | undefined, names: readonly string[]): string[] {
  if (!effect) return [];
  const composition = useMediaStore.getState().getActiveComposition();
  const definitions = getEffect(effect.type)?.params ?? {};
  // Number parameters that are not a finite number render at their default (effectOperatorParams).
  const unusable = names.flatMap(name => definitions[name]?.type === 'number' && isUnusableEffectNumber(effect.params[name])
    ? [`${name}: ${typeof effect.params[name] === 'string' ? JSON.stringify(effect.params[name]) : String(effect.params[name])} is not a finite number, so the default ${renderedFallback(definitions[name], effect.params[name])} is used.`] : []);
  const set = Object.fromEntries(names.map(name => [name, effect.params[name]]));
  const width = composition?.width ?? 1920, height = composition?.height ?? 1080;
  // The effect's own notes are judged on the recipe this instance runs (effectDefinitionNotes).
  const earlier = names.length ? earlierStylizeRecipeNote(effect.type, effect.operatorGraph) : undefined;
  const previous = names.length ? previousStylizeRecipeNote(effect.type, effect.operatorGraph) : undefined;
  return [...unusable, ...unusedParamWarnings(effect, names), ...(previous ? [previous] : []),
    ...paramRangeNotes(definitions, set, effect.operatorGraph).map(note => `${note.param}: ${note.message}`),
    ...blurBudgetNotes(effect.type, effect.params, width, height),
    ...(earlier ? [earlier] : names.length ? effectDefinitionNotes(effect, width, height) : [])];
}

/** Renderers drop null like an unset parameter, which renders at its legacy value (effects/types.ts). */
const renderedFallback = (definition: EffectParam, value: unknown) => value === null ? definition.legacyDefault ?? definition.default : definition.default;

/** An automatic Chroma Key on a clip without that screen colour keys nothing: say so (checked on the clip's
 * thumbnails, at most a second). Not for a picked colour or an edited old Rec.601 key graph. */
async function chromaKeyScreenWarnings(clipId: string, effect: Effect | undefined): Promise<string[]> {
  if (effect?.type !== 'chroma-key') return [];
  const screen = chromaKeyScreen(effect.params.keyColor);
  if (screen === 'custom' || graphBoundParameters(effect)?.has('tolerance')) return [];
  const clip = useTimelineStore.getState().clips.find(item => item.id === clipId);
  const mediaId = clip?.source?.mediaFileId ?? clip?.mediaFileId;
  const mediaThumbnail = useMediaStore.getState().files.find(file => file.id === mediaId)?.thumbnailUrl;
  const urls = clip?.thumbnails?.length ? clip.thumbnails : mediaThumbnail ? [mediaThumbnail] : [];
  const probe = probeChromaKeyScreen(urls, screen);
  const found = await Promise.race([probe, new Promise<undefined>(resolve => {
    const timer = setTimeout(resolve, 1000); void probe.finally(() => clearTimeout(timer));
  })]);
  const message = chromaKeyScreenProbeMessage(found, screen);
  return message ? [message] : [];
}

/** Number parameters given as numeric text ("0.5") are stored as numbers, so every reader (graph, owner,
 * inspector, worker plans) sees the same value; other unusable values stay and are reported. */
function normalizeNumberParams(effectType: string, params: Record<string, unknown>): Record<string, unknown> {
  const definitions = getEffect(effectType)?.params ?? {};
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name,
    definitions[name]?.type === 'number' && typeof value === 'string' && !isUnusableEffectNumber(value) ? finiteEffectNumber(value, 0) : value]));
}

/** Travel parameters (speedTravel, spinTravel) are computed while rendering from a keyframed rate
 * (EffectParam.integratedAs). A stored value would freeze the pattern, so tools never store one. */
function withoutRuntimeParams(effectType: string, params: Record<string, unknown>): { params: Record<string, unknown>; warnings: string[] } {
  const runtime = effectRateTravelParams(effectType).filter(([, travel]) => travel in params);
  return { params: withoutRuntimeTravelParams(effectType, params), warnings: runtime.map(([rate, name]) =>
    `${name}: computed while rendering from the keyframed ${rate}, so it was not stored; set or keyframe ${rate} instead.`) };
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
        ...(param.renderMin !== undefined || param.renderMax !== undefined ? { renderRange: [param.renderMin ?? null, param.renderMax ?? null] } : {}),
        // Cyclic: min/max are one turn of the slider, any value is accepted and goes round again.
        ...(param.wraps ? { wraps: true } : {}),
        description: param.label || key,
      })),
    })),
  }));

  return {
    success: true,
    data: { totalEffects: getAllEffects().length, categories: data },
  };
}

/** The Volume tab's own effects of an audio clip; their parameters are keyframeable as effect.<id>.<param>. */
const CLIP_AUDIO_EFFECT_TYPES = new Set(['audio-volume', 'audio-eq']);

/** Like the Volume tab: a sound keeps one Volume and one EQ effect, created on first use. */
function addClipAudioEffect(clip: TimelineClip, effectType: string, params: unknown): ToolResult {
  if (clip.source?.type !== 'audio') return { success: false, error: `${effectType} belongs to an audio clip; ${clip.id} is a ${clip.source?.type ?? 'clip'} clip` };
  const { addClipEffect, updateClipEffect } = useTimelineStore.getState();
  const existing = clip.effects.find(effect => effect.type === effectType);
  const effectId = existing?.id ?? addClipEffect(clip.id, effectType);
  if (params && typeof params === 'object') updateClipEffect(clip.id, effectId, params as Partial<Record<string, string | number | boolean>>);
  const effect = useTimelineStore.getState().clips.find(candidate => candidate.id === clip.id)?.effects.find(item => item.id === effectId);
  return { success: true, data: { clipId: clip.id, effectId, effectType, reused: Boolean(existing), params: effect?.params ?? {} } };
}

export async function handleAddEffect(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const effectType = resolveEffectTypeId(String(args.effectType ?? ''));
  const runtimeChecked = args.params && typeof args.params === 'object'
    ? withoutRuntimeParams(effectType, normalizeNumberParams(effectType, args.params as Record<string, unknown>)) : undefined;
  const customParams = runtimeChecked?.params;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  if (CLIP_AUDIO_EFFECT_TYPES.has(effectType)) return addClipAudioEffect(clip, effectType, args.params);
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
  const warnings = [...(experimental ? [`${getEffect(effectType)!.name} is experimental: ${experimental}`] : []), ...runtimeChecked?.warnings ?? [],
    ...effectParamWarnings(added, Object.keys(customParams ?? {})), ...await chromaKeyScreenWarnings(clipId, added)];

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

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) return { success: false, error: `Effect not found: ${effectId}` };
  if (!args.params || typeof args.params !== 'object') return { success: false, error: 'params must be an object.' };
  const { params, warnings: runtimeWarnings } = withoutRuntimeParams(effect.type, normalizeNumberParams(effect.type, args.params as Record<string, unknown>));

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
  const warnings = [...runtimeWarnings, ...effectParamWarnings(updated, Object.keys(params)),
    ...'keyColor' in params ? await chromaKeyScreenWarnings(clipId, updated) : []];
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
  const admission = adjustmentEffectAdmission(effectType);
  if (!admission.admitted) {
    return {
      success: false,
      error: `Unsupported adjustment effect: ${effectType}. ${admission.reason ?? ''}`.trim(),
      data: {
        code: 'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT',
        clipId,
        effectType,
        ...(admission.reason ? { reason: admission.reason } : {}),
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
