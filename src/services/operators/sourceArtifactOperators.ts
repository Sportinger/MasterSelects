import type { OperatorDefinition } from '../../types/operatorGraph';

/** References resolve against the owning clip/effect, so copies do not retain foreign IDs. */
export const SOURCE_ARTIFACT_OPERATORS: readonly OperatorDefinition[] = [
  { id: 'source.face-landmarks', version: 1, label: 'Saved face landmarks', runtime: 'builtin', invalidates: 'analysis',
    description: 'References this source\'s precise face tracking. Reuses the saved series without running MediaPipe.', inputs: [],
    outputs: [{ id: 'landmarks', label: 'Face landmarks', type: 'landmarks', contract: { formats: ['face-landmarks'] } }], parameters: [] },
  { id: 'source.saved-depth', version: 1, label: 'Saved scene depth', runtime: 'builtin', invalidates: 'simulation',
    description: 'References this effect\'s calibrated scene-depth bake. Source timing, pose and image mapping must still match.', inputs: [],
    outputs: [{ id: 'depth', label: 'Saved depth', type: 'depth', contract: { formats: ['calibrated-depth'], constraints: ['Requires the original source timing, tracked pose and image mapping.'] } }], parameters: [] },
];
export const sourceArtifactOperator = (kind: 'face-landmarks' | 'scene-depth') => kind === 'face-landmarks' ? 'source.face-landmarks' : 'source.saved-depth';
export const sourceArtifactKind = (operator: string) => operator === 'source.face-landmarks' ? 'face-landmarks' : operator === 'source.saved-depth' ? 'scene-depth' : undefined;
