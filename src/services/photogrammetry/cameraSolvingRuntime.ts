import type {
  CameraSolvingController,
  CameraSolveDataset,
  CameraSolveSourceContext,
  CameraSolvingSnapshot,
  CameraSolvingWorkerRequest,
  CameraSolvingWorkerResponse,
  SolvedCameraModel,
} from './cameraSolvingContract';

function datasetFile(blob: BlobPart, name: string, path: string, type: string): File {
  const file = new File([blob], name, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

function materializeDataset(sourceFiles: File[], model: SolvedCameraModel): File[] {
  const root = model.datasetName.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'browser-scan';
  const images = model.registeredSourceIndices.map((sourceIndex) => {
    const source = sourceFiles[sourceIndex];
    return datasetFile(source, source.name, `${root}/images/${source.name}`, source.type || 'image/jpeg');
  });
  return [
    ...images,
    datasetFile(model.camerasText, 'cameras.txt', `${root}/sparse/0/cameras.txt`, 'text/plain'),
    datasetFile(model.imagesText, 'images.txt', `${root}/sparse/0/images.txt`, 'text/plain'),
    datasetFile(model.pointsText, 'points3D.txt', `${root}/sparse/0/points3D.txt`, 'text/plain'),
  ];
}

export function solveScanCameras(
  sourceFiles: File[],
  datasetName: string,
  maxImageSide: number,
  onUpdate: (snapshot: CameraSolvingSnapshot) => void,
  source: CameraSolveSourceContext | null = null,
): CameraSolvingController {
  const worker = new Worker(new URL('./cameraSolving.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  const result = new Promise<CameraSolveDataset>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<CameraSolvingWorkerResponse>) => {
      const response = event.data;
      if (response.type === 'snapshot') {
        onUpdate(response.snapshot);
        return;
      }
      if (settled) return;
      settled = true;
      worker.terminate();
      if (response.type === 'completed') {
        resolve({
          id: typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `camera-solve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          files: materializeDataset(sourceFiles, response.model),
          model: response.model,
          source,
        });
      }
      else if (response.type === 'cancelled') reject(new DOMException('Camera solving cancelled.', 'AbortError'));
      else reject(new Error(response.message));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(event.message || 'Camera-solving worker crashed.'));
    };
  });
  const request: CameraSolvingWorkerRequest = { type: 'start', files: sourceFiles, datasetName, maxImageSide };
  worker.postMessage(request);
  return {
    result,
    cancel: () => {
      if (settled) return;
      worker.postMessage({ type: 'cancel' } satisfies CameraSolvingWorkerRequest);
    },
  };
}
