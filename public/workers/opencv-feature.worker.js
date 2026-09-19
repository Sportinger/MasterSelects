/* OpenCV feature extraction and PnP run in this nested classic worker so the
 * large OpenCV runtime never blocks the editor or the SfM orchestrator. */
self.importScripts(new URL('../wasm/opencv/opencv.js', self.location.href).href);

const frames = [];
let runtimePromise = null;

function getRuntime() {
  runtimePromise ??= Promise.resolve(self.cv);
  return runtimePromise;
}

function deleteFrame(frame) {
  frame?.descriptors?.delete?.();
}

async function extractFrame(cv, file, sourceIndex, maxImageSide) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const scale = Math.min(1, maxImageSide / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Camera solving could not create a 2D worker canvas.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const imageData = context.getImageData(0, 0, width, height);
  const rgba = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const orb = new cv.ORB(3_000, 1.2, 8, 24, 0, 2, cv.ORB_HARRIS_SCORE, 31, 12);
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    const points = new Float32Array(keypoints.size() * 2);
    const colors = new Uint8Array(keypoints.size() * 3);
    for (let index = 0; index < keypoints.size(); index += 1) {
      const point = keypoints.get(index).pt;
      points[index * 2] = point.x;
      points[index * 2 + 1] = point.y;
      const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
      const sourceOffset = (y * width + x) * 4;
      colors[index * 3] = imageData.data[sourceOffset];
      colors[index * 3 + 1] = imageData.data[sourceOffset + 1];
      colors[index * 3 + 2] = imageData.data[sourceOffset + 2];
    }
    return {
      sourceIndex,
      name: file.name,
      width: originalWidth,
      height: originalHeight,
      solveWidth: width,
      solveHeight: height,
      points,
      colors,
      descriptors,
    };
  } finally {
    orb.delete();
    keypoints.delete();
    mask.delete();
    gray.delete();
    rgba.delete();
  }
}

async function initialize(message) {
  const cv = await getRuntime();
  frames.splice(0).forEach(deleteFrame);
  const metadata = [];
  for (let index = 0; index < message.files.length; index += 1) {
    const frame = await extractFrame(cv, message.files[index], index, message.maxImageSide);
    if (frame.points.length >= 24) {
      frames[index] = frame;
      metadata.push({
        sourceIndex: frame.sourceIndex,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        solveWidth: frame.solveWidth,
        solveHeight: frame.solveHeight,
        points: frame.points,
        colors: frame.colors,
      });
    } else {
      frame.descriptors.delete();
      frames[index] = null;
      metadata.push(null);
    }
    self.postMessage({ type: 'feature-progress', current: index + 1, total: message.files.length });
  }
  return metadata;
}

async function matchFrames(message) {
  const cv = await getRuntime();
  const first = frames[message.first];
  const second = frames[message.second];
  if (!first || !second) return [];
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, true);
  const matches = new cv.DMatchVector();
  try {
    matcher.match(first.descriptors, second.descriptors, matches);
    const result = [];
    for (let index = 0; index < matches.size(); index += 1) {
      const match = matches.get(index);
      if (match.distance <= (message.maxDistance ?? 64)) {
        result.push({ first: match.queryIdx, second: match.trainIdx, distance: match.distance });
      }
    }
    return result.toSorted((a, b) => a.distance - b.distance).slice(0, message.maxMatches ?? 2_500);
  } finally {
    matches.delete();
    matcher.delete();
  }
}

function matFromTriples(cv, values) {
  return cv.matFromArray(values.length / 3, 1, cv.CV_64FC3, values);
}

function matFromPairs(cv, values) {
  return cv.matFromArray(values.length / 2, 1, cv.CV_64FC2, values);
}

async function solvePnp(message) {
  const cv = await getRuntime();
  const count = message.objectPoints.length / 3;
  if (count < 8) return null;
  const objectPoints = matFromTriples(cv, message.objectPoints);
  const imagePoints = matFromPairs(cv, message.imagePoints);
  const camera = cv.matFromArray(3, 3, cv.CV_64F, [
    message.focal, 0, message.principal.x,
    0, message.focal, message.principal.y,
    0, 0, 1,
  ]);
  const distortion = cv.Mat.zeros(4, 1, cv.CV_64F);
  const rotationVector = new cv.Mat();
  const translation = new cv.Mat();
  const inliers = new cv.Mat();
  const rotation = new cv.Mat();
  try {
    const solved = cv.solvePnPRansac(
      objectPoints,
      imagePoints,
      camera,
      distortion,
      rotationVector,
      translation,
      false,
      2_000,
      3,
      0.999,
      inliers,
      cv.SOLVEPNP_EPNP,
    );
    if (!solved || inliers.rows < 8) return null;
    const inlierIndices = Array.from(inliers.data32S.slice(0, inliers.rows));
    const refinedObjects = [];
    const refinedImages = [];
    for (const index of inlierIndices) {
      refinedObjects.push(...message.objectPoints.slice(index * 3, index * 3 + 3));
      refinedImages.push(...message.imagePoints.slice(index * 2, index * 2 + 2));
    }
    const objectInliers = matFromTriples(cv, refinedObjects);
    const imageInliers = matFromPairs(cv, refinedImages);
    try {
      cv.solvePnPRefineLM(objectInliers, imageInliers, camera, distortion, rotationVector, translation);
    } finally {
      objectInliers.delete();
      imageInliers.delete();
    }
    cv.Rodrigues(rotationVector, rotation);
    return {
      rotation: Array.from(rotation.data64F.slice(0, 9)),
      translation: Array.from(translation.data64F.slice(0, 3)),
      inlierIndices,
    };
  } finally {
    rotation.delete();
    inliers.delete();
    translation.delete();
    rotationVector.delete();
    distortion.delete();
    camera.delete();
    imagePoints.delete();
    objectPoints.delete();
  }
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    let data;
    if (message.type === 'initialize') data = await initialize(message);
    else if (message.type === 'match') data = await matchFrames(message);
    else if (message.type === 'solve-pnp') data = await solvePnp(message);
    else if (message.type === 'dispose') {
      frames.splice(0).forEach(deleteFrame);
      data = true;
    } else {
      throw new Error(`Unknown OpenCV worker request: ${message.type}`);
    }
    self.postMessage({ type: 'result', requestId: message.requestId, data });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
