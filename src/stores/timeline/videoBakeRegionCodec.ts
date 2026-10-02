import type { VideoBakeRegion } from '../../types';

/** Durable bake markers exclude progress and status from the current runtime job. */
export function serializeVideoBakeRegion(region: VideoBakeRegion): VideoBakeRegion {
  const { bakedAt: _bakedAt, error: _error, progress: _progress, ...rest } = region;
  return { ...rest, status: 'marked' };
}
