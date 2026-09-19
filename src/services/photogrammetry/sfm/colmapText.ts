import type { CameraPose, FrameFeatures, SparsePoint, SparseReconstruction } from './types';

interface RegisteredFrame {
  frame: FrameFeatures;
  pose: CameraPose;
  imageId: number;
}

function rotationQuaternion(rotation: CameraPose['rotation']): [number, number, number, number] {
  const trace = rotation[0] + rotation[4] + rotation[8];
  let qw: number;
  let qx: number;
  let qy: number;
  let qz: number;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    qw = scale * 0.25;
    qx = (rotation[7] - rotation[5]) / scale;
    qy = (rotation[2] - rotation[6]) / scale;
    qz = (rotation[3] - rotation[1]) / scale;
  } else if (rotation[0] > rotation[4] && rotation[0] > rotation[8]) {
    const scale = Math.sqrt(1 + rotation[0] - rotation[4] - rotation[8]) * 2;
    qw = (rotation[7] - rotation[5]) / scale;
    qx = scale * 0.25;
    qy = (rotation[1] + rotation[3]) / scale;
    qz = (rotation[2] + rotation[6]) / scale;
  } else if (rotation[4] > rotation[8]) {
    const scale = Math.sqrt(1 + rotation[4] - rotation[0] - rotation[8]) * 2;
    qw = (rotation[2] - rotation[6]) / scale;
    qx = (rotation[1] + rotation[3]) / scale;
    qy = scale * 0.25;
    qz = (rotation[5] + rotation[7]) / scale;
  } else {
    const scale = Math.sqrt(1 + rotation[8] - rotation[0] - rotation[4]) * 2;
    qw = (rotation[3] - rotation[1]) / scale;
    qx = (rotation[2] + rotation[6]) / scale;
    qy = (rotation[5] + rotation[7]) / scale;
    qz = scale * 0.25;
  }
  const length = Math.hypot(qw, qx, qy, qz) || 1;
  return [qw / length, qx / length, qy / length, qz / length];
}

function registeredFrames(reconstruction: SparseReconstruction): RegisteredFrame[] {
  return reconstruction.frames
    .filter((frame) => reconstruction.poses.has(frame.sourceIndex))
    .toSorted((a, b) => a.sourceIndex - b.sourceIndex)
    .map((frame, index) => ({
      frame,
      pose: reconstruction.poses.get(frame.sourceIndex)!,
      imageId: index + 1,
    }));
}

function validPointObservations(point: SparsePoint, registered: Map<number, RegisteredFrame>) {
  return point.observations.filter((observation) => registered.has(observation.frameIndex));
}

export function createColmapTextModel(reconstruction: SparseReconstruction): {
  registeredSourceIndices: number[];
  camerasText: string;
  imagesText: string;
  pointsText: string;
} {
  const frames = registeredFrames(reconstruction);
  const registered = new Map(frames.map((frame) => [frame.frame.sourceIndex, frame]));
  const first = frames[0].frame;
  const scaleX = first.width / first.solveWidth;
  const scaleY = first.height / first.solveHeight;
  const focal = reconstruction.focalLength * scaleX;
  const principalX = reconstruction.principalPoint.x * scaleX;
  const principalY = reconstruction.principalPoint.y * scaleY;
  const camerasText = [
    '# Camera list with one line of data per camera:',
    '#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]',
    `# Number of cameras: 1`,
    `1 SIMPLE_PINHOLE ${first.width} ${first.height} ${focal} ${principalX} ${principalY}`,
    '',
  ].join('\n');

  const pointByObservation = new Map<string, number>();
  reconstruction.points.forEach((point) => {
    validPointObservations(point, registered).forEach((observation) => {
      pointByObservation.set(`${observation.frameIndex}:${observation.featureIndex}`, point.id);
    });
  });
  const observationIndices = new Map<string, number>();
  const imageLines = [
    '# Image list with two lines of data per image:',
    '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
    '#   POINTS2D[] as (X, Y, POINT3D_ID)',
    `# Number of images: ${frames.length}`,
  ];
  for (const entry of frames) {
    const [qw, qx, qy, qz] = rotationQuaternion(entry.pose.rotation);
    imageLines.push([
      entry.imageId,
      qw, qx, qy, qz,
      entry.pose.translation.x,
      entry.pose.translation.y,
      entry.pose.translation.z,
      1,
      entry.frame.name,
    ].join(' '));
    const observations = Array.from(pointByObservation.entries())
      .filter(([key]) => key.startsWith(`${entry.frame.sourceIndex}:`))
      .map(([key, pointId]) => ({ featureIndex: Number(key.split(':')[1]), pointId }))
      .toSorted((a, b) => a.featureIndex - b.featureIndex);
    const pointLine: Array<string | number> = [];
    observations.forEach((observation, pointIndex) => {
      observationIndices.set(`${entry.frame.sourceIndex}:${observation.featureIndex}`, pointIndex);
      const x = entry.frame.points[observation.featureIndex * 2] * (entry.frame.width / entry.frame.solveWidth);
      const y = entry.frame.points[observation.featureIndex * 2 + 1] * (entry.frame.height / entry.frame.solveHeight);
      pointLine.push(x, y, observation.pointId);
    });
    imageLines.push(pointLine.join(' '));
  }
  imageLines.push('');

  const validPoints = reconstruction.points.filter((point) => validPointObservations(point, registered).length >= 2);
  const pointLines = [
    '# 3D point list with one line of data per point:',
    '#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)',
    `# Number of points: ${validPoints.length}`,
  ];
  for (const point of validPoints) {
    const track: number[] = [];
    for (const observation of validPointObservations(point, registered)) {
      const frame = registered.get(observation.frameIndex);
      const pointIndex = observationIndices.get(`${observation.frameIndex}:${observation.featureIndex}`);
      if (frame && pointIndex !== undefined) track.push(frame.imageId, pointIndex);
    }
    pointLines.push([
      point.id,
      point.position.x,
      point.position.y,
      point.position.z,
      ...point.color,
      point.error,
      ...track,
    ].join(' '));
  }
  pointLines.push('');
  return {
    registeredSourceIndices: frames.map((entry) => entry.frame.sourceIndex),
    camerasText,
    imagesText: imageLines.join('\n'),
    pointsText: pointLines.join('\n'),
  };
}
