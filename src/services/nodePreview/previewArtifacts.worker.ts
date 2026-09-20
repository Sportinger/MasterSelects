import { samplePreviewArtifact } from './samplePreviewArtifact';
import type { ArtifactSampleRequest, ArtifactSampleResult } from './previewArtifactProtocol';

const artifacts = new Map<string, string>();
self.onmessage = (event: MessageEvent<ArtifactSampleRequest>) => {
  const request = event.data;
  if (request.data !== undefined) {
    if (!artifacts.has(request.artifact) && artifacts.size >= 2) artifacts.delete(artifacts.keys().next().value!);
    artifacts.set(request.artifact, request.data);
  }
  let result: ArtifactSampleResult;
  try { result = samplePreviewArtifact(request, artifacts.get(request.artifact) ?? ''); }
  catch { result = { id: request.id, label: 'Bake unavailable' }; }
  self.postMessage({ ...result, retained: [...artifacts.keys()] });
};
