import type { TimelineStore } from './types';

/** Keep graph clocks and output references coherent in the same undoable edit. */
export function synchronizeSharedSceneGraphs(state: TimelineStore, patch: Partial<TimelineStore>): Partial<TimelineStore> {
  if (!state.sharedSceneGraphs || 'sharedSceneGraphs' in patch || (!patch.clips && !patch.clipKeyframes)) return patch;
  let clips = patch.clips ?? state.clips;
  let documents = state.sharedSceneGraphs;
  for (const document of Object.values(state.sharedSceneGraphs)) {
    const before = state.clips.find(c => c.id === document.sourceClipId);
    const after = clips.find(c => c.id === document.sourceClipId);
    let next = document;
    if (after && after.transform !== before?.transform) next = { ...next, transform: after.transform };
    if (before && after && after.source?.gaussianSplatSettings !== before.source?.gaussianSplatSettings) {
      clips = clips.map(c => c.id !== after.id && c.sceneGraphOutput?.graphId === document.id && c.source
        ? { ...c, source: { ...c.source, gaussianSplatSettings: after.source?.gaussianSplatSettings } } : c);
    }
    // A trim changes the visibility window; only a move shifts the family clock.
    if (before && after && before.startTime !== after.startTime && before.duration === after.duration
      && before.inPoint === after.inPoint && before.outPoint === after.outPoint) {
      const delta = after.startTime - before.startTime;
      const family = clips.filter(c => c.id !== after.id && c.sceneGraphOutput?.graphId === document.id);
      if (family.some(c => state.tracks.find(t => t.id === c.trackId)?.locked || c.startTime + delta < 0)) {
        throw new Error('Linked outputs cannot move into negative time or on locked tracks.');
      }
      next = { ...next, startTime: document.startTime + delta };
      clips = clips.map(c => c.id !== after.id && c.sceneGraphOutput?.graphId === document.id
        && c.startTime === state.clips.find(old => old.id === c.id)?.startTime ? { ...c, startTime: c.startTime + delta } : c);
    }
    if (patch.clipKeyframes) {
      for (const clip of clips.filter(c => c.sceneGraphOutput?.graphId === document.id)) {
        const old = state.clipKeyframes.get(clip.id), current = patch.clipKeyframes.get(clip.id);
        if (old === current) continue;
        const prefix = `effect.${document.effect.id}.`;
        const changed = [...(old ?? []), ...(current ?? [])].some(k => k.property.startsWith(prefix));
        if (changed) next = { ...next, keyframes: (current ?? []).filter(k => k.property.startsWith(prefix)) };
      }
    }
    if (patch.clips) {
      const outputs = Object.fromEntries(clips.filter(c => c.sceneGraphOutput?.graphId === document.id && c.sceneGraphOutput.nodeIds)
        .map(c => [c.id, c.sceneGraphOutput!.nodeIds!]));
      if (JSON.stringify(outputs) !== JSON.stringify(next.outputs)) next = { ...next, outputs };
    }
    if (next !== document) documents = { ...documents, [document.id]: next };
  }
  return { ...patch, ...(clips !== (patch.clips ?? state.clips) ? { clips } : {}),
    ...(documents !== state.sharedSceneGraphs ? { sharedSceneGraphs: documents } : {}) };
}
