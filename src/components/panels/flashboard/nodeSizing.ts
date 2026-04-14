import type { FlashBoardNode } from '../../../stores/flashboardStore/types';
import type { MediaFile } from '../../../stores/mediaStore';

export const DEFAULT_NODE_ASPECT_RATIO = 16 / 9;
export const MIN_NODE_WIDTH = 120;
export const MAX_NODE_WIDTH = 1400;

export function parseAspectRatio(value?: string): number | null {
  if (!value) return null;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return width / height;
}

export function clampNodeWidth(width: number): number {
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, width));
}

export function resolveFlashBoardNodeAspectRatio(node: FlashBoardNode, mediaFile?: MediaFile): number {
  const mediaAspectRatio =
    mediaFile?.width && mediaFile?.height && mediaFile.width > 0 && mediaFile.height > 0
      ? mediaFile.width / mediaFile.height
      : null;
  const resultAspectRatio =
    node.result?.width && node.result?.height && node.result.width > 0 && node.result.height > 0
      ? node.result.width / node.result.height
      : null;
  const requestAspectRatio = parseAspectRatio(node.request?.aspectRatio) ?? parseAspectRatio(node.request?.imageSize);
  const currentAspectRatio =
    node.size.width > 0 && node.size.height > 0
      ? node.size.width / node.size.height
      : null;

  return (
    mediaAspectRatio ??
    resultAspectRatio ??
    requestAspectRatio ??
    currentAspectRatio ??
    DEFAULT_NODE_ASPECT_RATIO
  );
}

export function resolveFlashBoardNodeDisplaySize(node: FlashBoardNode, mediaFile?: MediaFile): {
  aspectRatio: number;
  width: number;
  height: number;
} {
  const aspectRatio = resolveFlashBoardNodeAspectRatio(node, mediaFile);
  const width = clampNodeWidth(node.size.width);

  return {
    aspectRatio,
    width,
    height: width / aspectRatio,
  };
}
