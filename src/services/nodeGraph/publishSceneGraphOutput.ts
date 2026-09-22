import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { renderHostPort } from '../render/renderHostPort';
import type { SceneGraphOutput } from '../../types/sharedSceneGraph';
import { projectSceneGraphClip } from './sceneGraphOutputs';

export function publishSceneGraphOutput(clipId: string, target: Omit<SceneGraphOutput, 'graphId'>): string {
  assertExclusiveTimelineMutationAllowed();
  const state = useTimelineStore.getState();
  const original = state.clips.find(c => c.id === clipId);
  if (!original || state.isExporting || state.tracks.find(t => t.id === original.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  const clip = projectSceneGraphClip(original, state.sharedSceneGraphs);
  const effect = clip.effects.findLast(e => e.type === 'splat-exploration');
  if (!effect || !target.nodeIds?.length) throw new Error('Select a Gaussian surface or mesh output group.');
  const graphId = clip.sceneGraphOutput?.graphId ?? `scene-graph-${crypto.randomUUID()}`;
  const existing = state.clips.find(c => c.sceneGraphOutput?.graphId === graphId && c.sceneGraphOutput.nodeIds?.some(id => target.nodeIds!.includes(id)));
  if (existing) { state.selectClip(existing.id); return existing.id; }
  const batch = startBatch('Show node output in timeline');
  try {
    const trackId = state.addTrack('video');
    state.renameTrack(trackId, target.label);
    const id = `scene-output-${crypto.randomUUID()}`;
    const existingDocument = state.sharedSceneGraphs?.[graphId];
    const document = { ...(existingDocument ?? {
      id: graphId, name: clip.name, effect, transform: original.transform, sourceClipId: clip.id, startTime: clip.startTime,
      keyframes: (state.clipKeyframes.get(clip.id) ?? []).filter(k => k.property.startsWith(`effect.${effect.id}.`)),
    }), transform: existingDocument?.transform ?? original.transform, outputs: { ...existingDocument?.outputs, [id]: target.nodeIds } };
    useTimelineStore.setState(current => ({
      sharedSceneGraphs: { ...current.sharedSceneGraphs, [graphId]: document },
      clips: [...current.clips.map(c => c.id === clip.id ? { ...c,
        effects: c.effects.filter(e => e.id !== effect.id),
        sceneGraphOutput: c.sceneGraphOutput ?? { graphId, label: 'Original output' },
      } : c), {
        ...original, id, name: target.label, trackId, transform: structuredClone(DEFAULT_TRANSFORM),
        effects: [], nodeGraph: { version: 1, nodes: [], groups: {
          ...original.nodeGraph?.groups, [`effect:${effect.id}`]: { collapsed: false },
        } }, linkedClipId: undefined, linkedGroupId: undefined,
        parentClipId: undefined, sceneGraphOutput: { ...target, graphId },
      }],
    }));
    state.selectClip(id); state.updateDuration(); state.invalidateCache(); renderHostPort.requestRender();
    return id;
  } finally { if (batch.opened) endBatch(); }
}
