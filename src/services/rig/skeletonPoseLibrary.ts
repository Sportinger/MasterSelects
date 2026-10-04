import { SKELETON_ANGLE_KEYS, type SkeletonAngleKey, type SkeletonPosePreset } from './skeletonRig';

const STORAGE_KEY = 'masterselects.skeletonPoses';
export const SKELETON_POSE_LIBRARY_CAP = 100;

export interface SavedSkeletonPose extends SkeletonPosePreset { createdAt: number }

function isPose(value: unknown): value is SavedSkeletonPose {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SavedSkeletonPose>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.createdAt === 'number'
    && !!candidate.pose && SKELETON_ANGLE_KEYS.every(key => Number.isFinite(candidate.pose![key]));
}

/** User-local library like the appearance presets; project-embedded poses are a later stage. */
export function listSkeletonPoses(): SavedSkeletonPose[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isPose) : [];
  } catch {
    return [];
  }
}

function persist(poses: SavedSkeletonPose[]): SavedSkeletonPose[] {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(poses)); } catch { /* storage full or unavailable */ }
  return poses;
}

export function saveSkeletonPose(name: string, pose: Record<SkeletonAngleKey, number>): SavedSkeletonPose[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Pose name must not be empty.');
  const entry: SavedSkeletonPose = {
    id: `pose-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed, createdAt: Date.now(),
    pose: Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, Math.round(pose[key] * 100) / 100])) as Record<SkeletonAngleKey, number>,
  };
  // Saving under an existing name replaces that pose; the oldest poses are evicted beyond the cap.
  return persist([...listSkeletonPoses().filter(item => item.name !== trimmed), entry].slice(-SKELETON_POSE_LIBRARY_CAP));
}

export function deleteSkeletonPose(id: string): SavedSkeletonPose[] {
  return persist(listSkeletonPoses().filter(item => item.id !== id));
}
