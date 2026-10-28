import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { shallow } from 'zustand/shallow';
import { useTimelineStore } from '../../../../stores/timeline';
import { effectOperatorGraph, hasEffectOperatorGraph } from '../../../../services/operators/effectGraphOwner';
import { findClipOperatorEffect } from '../../../../services/operators/clipOperatorGraphOwner';
import { operatorGroupBypassRoutes, operatorGroupRenderer } from '../../../../services/operators/operatorGroupBypass';
import { operatorEnabled } from '../../../../services/operators/effectGraph';
import { setEffectGroupEnabled } from '../../../../services/operators/effectGroupBypassEditing';
import type { EffectOperatorGraph } from '../../../../types/operatorGraph';
import type { Effect } from '../../../../types/effects';

type SectionBypass = { enabled: boolean; onEnabledChange?: (enabled: boolean) => void };
const Context = createContext<ReadonlyMap<string, SectionBypass>>(new Map());
const key = (title: string) => title.trim().toLowerCase();
export const useEffectSectionBypass = (title: string) => useContext(Context).get(key(title));

/** Audio Math owners are rebuilt per lookup, so an equal effect keeps the previous snapshot. */
const sameEffect = (a: Effect | undefined, b: Effect | undefined) => a === b || (!!a && !!b && a.id === b.id && a.type === b.type
  && a.name === b.name && a.enabled === b.enabled && a.operatorGraph === b.operatorGraph && (a.params === b.params || shallow(a.params, b.params)));

/** Selects only this effect: edits to other clips or effects do not re-render the section form. */
function useOperatorEffect(clipId: string | undefined, effectId: string): Effect | undefined {
  const previous = useRef<Effect | undefined>(undefined);
  return useTimelineStore(state => {
    const clip = clipId === undefined ? undefined : state.clips.find(candidate => candidate.id === clipId);
    const next = clip && findClipOperatorEffect(clip, effectId, state.clips);
    if (sameEffect(previous.current, next)) return previous.current;
    previous.current = next;
    return next;
  });
}

/** Read-only structure for the bypass bindings; the owner caches it per graph, independent of parameter values. */
function inspectedGraph(effect: Effect | undefined): EffectOperatorGraph | undefined {
  if (!effect || !hasEffectOperatorGraph(effect.type)) return undefined;
  try { return effectOperatorGraph(effect, { inspectionOnly: true }); } catch { return undefined; } // Invalid graphs retain their existing inspector diagnostics.
}

/** The form reads the same durable group/renderer state as the node canvas. */
export function EffectSectionBypass({ clipId, effectId, children }: { clipId?: string; effectId: string; children: ReactNode }) {
  const effect = useOperatorEffect(clipId, effectId);
  const locked = useTimelineStore(state => {
    if (state.isExporting) return true;
    const clip = clipId === undefined ? undefined : state.clips.find(candidate => candidate.id === clipId);
    return Boolean(clip && state.tracks.find(track => track.id === clip.trackId)?.locked);
  });
  const [error, setError] = useState('');
  const graph = useMemo(() => inspectedGraph(effect), [effect]);
  const groups = useMemo(() => {
    if (!graph) return [];
    try {
      return (graph.groups ?? []).flatMap(group => {
        const renderer = operatorGroupRenderer(graph, group.id);
        return renderer || operatorGroupBypassRoutes(graph, group) ? [{ group, renderer }] : [];
      });
    } catch { return []; }
  }, [graph]);
  // Renderer switches live in the parameters; the bindings only change when one of them flips.
  const enabledKey = groups.map(({ group, renderer }) => renderer && effect ? operatorEnabled(renderer, effect.params) : !group.bypassed).join();
  const bindings = useMemo(() => {
    const entries = new Map<string, SectionBypass>();
    if (!graph || !clipId) return entries;
    const enabled = enabledKey.split(',');
    groups.forEach(({ group }, index) => {
      const binding: SectionBypass = {
        enabled: enabled[index] === 'true',
        onEnabledChange: locked ? undefined : value => {
          try { setEffectGroupEnabled(clipId, effectId, group.id, value); setError(''); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        },
      };
      // Explicit group IDs remain usable when labels are duplicated or renamed.
      if (graph.groups!.filter(candidate => key(candidate.label) === key(group.label)).length === 1) entries.set(key(group.label), binding);
      entries.set(key(`group:${group.id}`), binding);
    });
    return entries;
  }, [graph, groups, enabledKey, locked, clipId, effectId]);
  return <Context.Provider value={bindings}>{children}{error && <p role="alert">{error}</p>}</Context.Provider>;
}
