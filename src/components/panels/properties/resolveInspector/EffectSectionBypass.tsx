import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { effectOperatorGraph, hasEffectOperatorGraph } from '../../../../services/operators/effectGraphOwner';
import { findClipOperatorEffect } from '../../../../services/operators/clipOperatorGraphOwner';
import { operatorGroupBypassRoutes, operatorGroupRenderer } from '../../../../services/operators/operatorGroupBypass';
import { operatorEnabled } from '../../../../services/operators/effectGraph';
import { setEffectGroupEnabled } from '../../../../services/operators/effectGroupBypassEditing';

type SectionBypass = { enabled: boolean; onEnabledChange?: (enabled: boolean) => void };
const Context = createContext<ReadonlyMap<string, SectionBypass>>(new Map());
const key = (title: string) => title.trim().toLowerCase();
export const useEffectSectionBypass = (title: string) => useContext(Context).get(key(title));

/** The form reads the same durable group/renderer state as the node canvas. */
export function EffectSectionBypass({ clipId, effectId, children }: { clipId?: string; effectId: string; children: ReactNode }) {
  const clips = useTimelineStore(state => state.clips);
  const exporting = useTimelineStore(state => state.isExporting);
  const tracks = useTimelineStore(state => state.tracks);
  const [error, setError] = useState('');
  const clip = clips.find(clip => clip.id === clipId);
  const effect = clip && findClipOperatorEffect(clip, effectId, clips);
  const bindings = useMemo(() => {
    const entries = new Map<string, SectionBypass>();
    if (!clip || !effect || !hasEffectOperatorGraph(effect.type)) return entries;
    const locked = exporting || tracks.find(track => track.id === clip.trackId)?.locked;
    try {
      const graph = effectOperatorGraph(effect);
      for (const group of graph.groups ?? []) {
        const renderer = operatorGroupRenderer(graph, group.id);
        if (!renderer && !operatorGroupBypassRoutes(graph, group)) continue;
        const binding: SectionBypass = {
          enabled: renderer ? operatorEnabled(renderer, effect.params) : !group.bypassed,
          onEnabledChange: locked ? undefined : enabled => {
            try { setEffectGroupEnabled(clip.id, effect.id, group.id, enabled); setError(''); }
            catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          },
        };
        // Explicit group IDs remain usable when labels are duplicated or renamed.
        if (graph.groups!.filter(candidate => key(candidate.label) === key(group.label)).length === 1) entries.set(key(group.label), binding);
        entries.set(key(`group:${group.id}`), binding);
      }
    } catch { /* Invalid graphs retain their existing inspector diagnostics. */ }
    return entries;
  }, [clip, effect, exporting, tracks]);
  return <Context.Provider value={bindings}>{children}{error && <p role="alert">{error}</p>}</Context.Provider>;
}
