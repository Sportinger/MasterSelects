import { parseSolvedCameraPath, type SolvedCameraPath } from './cameraSolvePoses';

/** Text COLMAP cameras retain the training viewpoint instead of reframing on every update. */
export async function readBrushPreviewCameras(files: File[]): Promise<SolvedCameraPath | null> {
  const cameras = files.find(file => /(^|\/)cameras\.txt$/.test(file.name));
  const images = files.find(file => /(^|\/)images\.txt$/.test(file.name));
  if (!cameras || !images) return null;
  try {
    return parseSolvedCameraPath({ id: 'preview', createdAt: 0, files: [], source: null,
      model: { datasetName: 'preview', registeredSourceIndices: [], pointsText: '',
        camerasText: await cameras.text(), imagesText: await images.text() } });
  } catch { return null; } // Binary/external camera models use stable scene framing.
}
