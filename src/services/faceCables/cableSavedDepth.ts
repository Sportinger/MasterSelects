import type { OperatorParameters } from '../operators/effectGraph';
import { decodeCableScene, type CableSceneBake } from './cableSceneData';

/** A connected saved-depth source selects reuse; it never silently starts inference. */
export function cableSavedDepth(params: OperatorParameters, graphRequestsReuse: boolean, reuseRequested: boolean): { saved: CableSceneBake | null; params: OperatorParameters } {
  const reuse = graphRequestsReuse || reuseRequested;
  const saved = reuse ? decodeCableScene(params.sceneData) : null;
  if (reuse && (!params.scene3D || !params.sceneDepth || !saved?.depthGrid)) throw new Error('Saved scene depth is unavailable. Enable Native 3D and bake scene depth first.');
  if (!graphRequestsReuse || !saved?.depthBinding) return { saved, params };
  // Cached depth is already calibrated. Its calibration travels with the artifact, not the disconnected node.
  const binding = JSON.parse(saved.depthBinding);
  if (!Number.isFinite(binding.strength) || binding.strength < 0.1 || binding.strength > 2) throw new Error('Saved depth calibration is invalid.');
  return { saved, params: { ...params, sceneDepthStrength: binding.strength, depthReferenceFace: binding.referenceFace ?? true } };
}
