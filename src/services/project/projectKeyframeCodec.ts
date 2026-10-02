/** Clip membership owns this runtime association; every authored curve field survives. */
export function canonicalProjectKeyframe<T extends object>(keyframe: T): Omit<T, 'clipId'> {
  const { clipId: _runtimeOwner, ...authored } = keyframe as T & { clipId?: unknown };
  return authored as Omit<T, 'clipId'>;
}
