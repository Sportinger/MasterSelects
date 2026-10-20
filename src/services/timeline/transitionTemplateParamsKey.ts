import type { TimelineClip } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';

/**
 * Revision of how the recipe and Light Leak templates materialize generated
 * keyframes, shared by every transition type. It is part of the template key,
 * so a stored composition built by an older materializer gets a targeted
 * upgrade of its generated content once (see transitionCompositionReuse).
 * 1: recipe opacity keyframes scale the clip's own opacity.
 */
export const TRANSITION_MATERIALIZER_REVISION = 1;

interface ParsedTemplateParamsKey {
  params: string;
  revision: string;
}

export function getTransitionTemplateParamsKey(
  transition: TimelineTransition,
  _outgoingClip: TimelineClip,
  _incomingClip: TimelineClip,
): string {
  const recipeRevision = getRuntimeTransition(transition.type)?.recipeRevision ?? 0;
  return JSON.stringify({
    params: Object.entries(transition.params ?? {}).toSorted(([a], [b]) => a.localeCompare(b)),
    revision: [TRANSITION_MATERIALIZER_REVISION, recipeRevision],
  });
}

function parseTemplateParamsKey(key: string | undefined): ParsedTemplateParamsKey | null {
  if (typeof key !== 'string') return null;
  try {
    const parsed = JSON.parse(key) as { params?: unknown; revision?: unknown; recipeRevision?: unknown };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.params)) return null;
    // Keys written before the shared revision carried only `recipeRevision` (or nothing).
    const revision = parsed.revision ?? [0, parsed.recipeRevision ?? 0];
    return { params: JSON.stringify(parsed.params), revision: JSON.stringify(revision) };
  } catch {
    return null;
  }
}

/**
 * 'same' keeps a stored composition, 'revision' means only the template
 * revision moved on (the user's parameters are unchanged, so the stored
 * composition is upgraded in place), 'params' means the parameters differ and
 * the composition is rebuilt from the template.
 */
export function compareTransitionTemplateParamsKeys(
  storedKey: string | undefined,
  generatedKey: string | undefined,
): 'same' | 'revision' | 'params' {
  if (storedKey === generatedKey) return 'same';
  const stored = parseTemplateParamsKey(storedKey);
  const generated = parseTemplateParamsKey(generatedKey);
  if (!stored || !generated || stored.params !== generated.params) return 'params';
  return stored.revision === generated.revision ? 'same' : 'revision';
}
