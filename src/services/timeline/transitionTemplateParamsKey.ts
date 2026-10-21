import type { TimelineClip } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';

/**
 * Revision of how the recipe and Light Leak templates materialize generated
 * keyframes, shared by every transition type. It is part of the template key,
 * so a stored composition built by an older materializer gets a targeted
 * upgrade of its generated content once (see transitionCompositionReuse).
 * 1: recipe opacity keyframes scale the clip's own opacity (1 for a clip at
 *    static opacity 0, see getTransitionOpacityReference).
 */
export const TRANSITION_MATERIALIZER_REVISION = 1;

interface ParsedTemplateParamsKey {
  params: string;
  revision: string;
}

type ParamEntry = [string, unknown];

/**
 * Parameters that only change the sound (Include audio, Audio curve) are not
 * part of the key: changing them must not rebuild the composition and discard
 * what the user made inside it.
 */
function getPictureParamEntries(entries: readonly ParamEntry[], transitionType: string | undefined): ParamEntry[] {
  const definitions = transitionType ? getRuntimeTransition(transitionType)?.params : undefined;
  return entries
    .filter(([key]) => definitions?.[key]?.affectsPicture !== false)
    .toSorted(([a], [b]) => a.localeCompare(b));
}

export function getTransitionTemplateParamsKey(
  transition: TimelineTransition,
  _outgoingClip: TimelineClip,
  _incomingClip: TimelineClip,
): string {
  const recipeRevision = getRuntimeTransition(transition.type)?.recipeRevision ?? 0;
  return JSON.stringify({
    params: getPictureParamEntries(Object.entries(transition.params ?? {}), transition.type),
    revision: [TRANSITION_MATERIALIZER_REVISION, recipeRevision],
  });
}

function isParamEntry(value: unknown): value is ParamEntry {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';
}

function parseTemplateParamsKey(key: string | undefined, transitionType: string | undefined): ParsedTemplateParamsKey | null {
  if (typeof key !== 'string') return null;
  try {
    const parsed = JSON.parse(key) as { params?: unknown; revision?: unknown; recipeRevision?: unknown };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.params)) return null;
    // Keys written before the shared revision carried only `recipeRevision` (or nothing).
    const revision = parsed.revision ?? [0, parsed.recipeRevision ?? 0];
    // Older keys also carried the sound-only parameters; compare without them.
    const params = getPictureParamEntries(parsed.params.filter(isParamEntry), transitionType);
    return { params: JSON.stringify(params), revision: JSON.stringify(revision) };
  } catch {
    return null;
  }
}

/**
 * 'same' keeps a stored composition, 'revision' means only the template
 * revision moved on (the user's parameters are unchanged, so the stored
 * composition is upgraded in place), 'params' means a parameter that changes
 * the picture differs and the composition is rebuilt from the template.
 */
export function compareTransitionTemplateParamsKeys(
  storedKey: string | undefined,
  generatedKey: string | undefined,
  transitionType?: string,
): 'same' | 'revision' | 'params' {
  if (storedKey === generatedKey) return 'same';
  const stored = parseTemplateParamsKey(storedKey, transitionType);
  const generated = parseTemplateParamsKey(generatedKey, transitionType);
  if (!stored || !generated || stored.params !== generated.params) return 'params';
  return stored.revision === generated.revision ? 'same' : 'revision';
}
