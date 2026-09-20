import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { SceneOperatorGraph } from '../../types/operatorGraph';
import { isStabilizationKeyBypassed } from '../landmarkTracking/stabilizationProvenance';
import { compileSceneGraph } from '../operators/sceneGraph';

const transformBypass = new WeakMap<SceneOperatorGraph, boolean>();
/** The curve remains editable even when its transform is omitted from playback. */
export function isClipKeyframeBypassed(clip: TimelineClip | undefined, key: Pick<Keyframe, 'id' | 'property'>): boolean {
  if (isStabilizationKeyBypassed(clip, key)) return true;
  const scene = clip?.is3D ? clip.nodeGraph?.scene : undefined;
  if (!scene || !/^(position|rotation|scale|anchor)\./.test(key.property)) return false;
  if (!transformBypass.has(scene)) {
    try { transformBypass.set(scene, !compileSceneGraph(scene).applyClipTransform); }
    catch { transformBypass.set(scene, false); }
  }
  return transformBypass.get(scene)!;
}
