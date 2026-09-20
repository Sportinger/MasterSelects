import type { TimelineClip } from '../../types/timeline';
import type { NodeGraphPort } from '../../types/nodeGraph';
import { decodeCableScene } from '../faceCables/cableSceneData';
import { getEffectOperator } from '../operators/operatorRegistry';
import { sourceArtifactOperator } from '../operators/sourceArtifactOperators';
import { projectOperatorPort } from './effectGraphProjection';

export const sourceArtifactPortId = (kind: 'face-landmarks' | 'scene-depth', effectId?: string) => kind === 'face-landmarks' ? 'face-landmarks' : `scene-depth:${effectId}`;

export function sourceArtifactPorts(clip: TimelineClip, faceTrackingAvailable = false): NodeGraphPort[] {
  if (!['video', 'image'].includes(clip.source?.type ?? '')) return [];
  const face = projectOperatorPort(getEffectOperator(sourceArtifactOperator('face-landmarks'))!.outputs[0], 'output');
  const ports: NodeGraphPort[] = [{ ...face, id: sourceArtifactPortId('face-landmarks'), label: 'Face landmarks',
    metadata: { ...face.metadata, available: faceTrackingAvailable, targetClipId: clip.id, sourceArtifact: { kind: 'face-landmarks' } } }];
  const effects = clip.effects.filter(e => e.type === 'face-cables');
  for (const effect of effects) {
    const saved = decodeCableScene(effect.params.sceneData);
    let stale = false;
    if (saved?.depthBinding) {
      try {
        const binding = JSON.parse(saved.depthBinding);
        stale = binding.sourceId !== (clip.source?.mediaFileId ?? clip.mediaFileId ?? clip.id)
          || binding.inPoint !== clip.inPoint || binding.outPoint !== clip.outPoint || binding.duration !== clip.duration
          || binding.speed !== clip.speed || binding.reversed !== clip.reversed || JSON.stringify(binding.transform) !== JSON.stringify(clip.transform);
      } catch { stale = true; }
    }
    const depth = projectOperatorPort(getEffectOperator(sourceArtifactOperator('scene-depth'))!.outputs[0], 'output');
    ports.push({ ...depth, id: sourceArtifactPortId('scene-depth', effect.id), label: effects.length > 1 ? `Depth · ${effect.name}` : 'Saved scene depth',
      metadata: { ...depth.metadata, available: Boolean(saved?.depthGrid), stale, targetClipId: clip.id, sourceArtifact: { kind: 'scene-depth', effectId: effect.id } } });
  }
  return ports;
}
