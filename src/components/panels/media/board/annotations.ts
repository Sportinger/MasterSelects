export type MediaBoardAnnotationColor = string | 'transparent';

export interface MediaBoardAnnotation {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  backgroundColor: MediaBoardAnnotationColor;
  textColor: MediaBoardAnnotationColor;
  editing: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MediaBoardAnnotationVisibleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type MediaBoardAnnotationResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface MediaBoardAnnotationResizeStart {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaBoardAnnotationPosition {
  x: number;
  y: number;
}

export const MEDIA_BOARD_ANNOTATIONS_STORAGE_KEY = 'media-panel-board-annotations';
export const DEFAULT_MEDIA_BOARD_ANNOTATION_FONT_SIZE = 18;
export const MEDIA_BOARD_ANNOTATION_FONT_SIZE_MIN = 12;
export const MEDIA_BOARD_ANNOTATION_FONT_SIZE_MAX = 64;
export const DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE = { width: 300, height: 190 };
export const MEDIA_BOARD_ANNOTATION_MIN_SIZE = { width: 120, height: 74 };
export const MEDIA_BOARD_ANNOTATION_MAX_SIZE = { width: 1100, height: 760 };
export const DEFAULT_MEDIA_BOARD_ANNOTATION_BACKGROUND: MediaBoardAnnotationColor = '#f1dfa1';
export const DEFAULT_MEDIA_BOARD_ANNOTATION_TEXT: MediaBoardAnnotationColor = '#2f2612';
export const MEDIA_BOARD_ANNOTATION_COLOR_OPTIONS: Array<{
  label: string;
  value: MediaBoardAnnotationColor;
}> = [
  { label: 'Yellow', value: '#f1dfa1' },
  { label: 'White', value: '#f6f6f2' },
  { label: 'Black', value: '#151515' },
  { label: 'Blue', value: '#4f7bea' },
  { label: 'Red', value: '#e15353' },
  { label: 'Green', value: '#53b86f' },
  { label: 'Transparent', value: 'transparent' },
];

export function clampMediaBoardAnnotationFontSize(value: unknown): number {
  const size = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_MEDIA_BOARD_ANNOTATION_FONT_SIZE;
  return Math.min(
    MEDIA_BOARD_ANNOTATION_FONT_SIZE_MAX,
    Math.max(MEDIA_BOARD_ANNOTATION_FONT_SIZE_MIN, size),
  );
}

export function normalizeMediaBoardAnnotationColor(
  value: unknown,
  fallback: MediaBoardAnnotationColor,
): MediaBoardAnnotationColor {
  if (value === 'transparent') return 'transparent';
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

export function loadMediaBoardAnnotations(): MediaBoardAnnotation[] {
  try {
    const stored = localStorage.getItem(MEDIA_BOARD_ANNOTATIONS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Array<Partial<MediaBoardAnnotation>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((annotation): MediaBoardAnnotation | null => {
        if (!annotation || typeof annotation !== 'object' || typeof annotation.id !== 'string') {
          return null;
        }
        const x = Number(annotation.x);
        const y = Number(annotation.y);
        const width = Number(annotation.width);
        const height = Number(annotation.height);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          id: annotation.id,
          x,
          y,
          width: Number.isFinite(width)
            ? Math.max(MEDIA_BOARD_ANNOTATION_MIN_SIZE.width, Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.width, width))
            : DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE.width,
          height: Number.isFinite(height)
            ? Math.max(MEDIA_BOARD_ANNOTATION_MIN_SIZE.height, Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.height, height))
            : DEFAULT_MEDIA_BOARD_ANNOTATION_SIZE.height,
          text: typeof annotation.text === 'string' ? annotation.text : '',
          fontSize: clampMediaBoardAnnotationFontSize(annotation.fontSize),
          backgroundColor: normalizeMediaBoardAnnotationColor(
            annotation.backgroundColor,
            DEFAULT_MEDIA_BOARD_ANNOTATION_BACKGROUND,
          ),
          textColor: normalizeMediaBoardAnnotationColor(annotation.textColor, DEFAULT_MEDIA_BOARD_ANNOTATION_TEXT),
          editing: Boolean(annotation.editing),
          createdAt: typeof annotation.createdAt === 'number' ? annotation.createdAt : Date.now(),
          updatedAt: typeof annotation.updatedAt === 'number' ? annotation.updatedAt : Date.now(),
        };
      })
      .filter((annotation): annotation is MediaBoardAnnotation => annotation !== null);
  } catch {
    return [];
  }
}

export function saveMediaBoardAnnotations(annotations: MediaBoardAnnotation[]): void {
  localStorage.setItem(MEDIA_BOARD_ANNOTATIONS_STORAGE_KEY, JSON.stringify(annotations));
}

export function getVisibleMediaBoardAnnotations(
  annotations: readonly MediaBoardAnnotation[],
  visibleRect: MediaBoardAnnotationVisibleRect,
  selectedAnnotationId: string | null,
): MediaBoardAnnotation[] {
  return annotations.filter((annotation) => (
    selectedAnnotationId === annotation.id
    || (
      annotation.x + annotation.width > visibleRect.left
      && annotation.x < visibleRect.right
      && annotation.y + annotation.height > visibleRect.top
      && annotation.y < visibleRect.bottom
    )
  ));
}

export function getResizedMediaBoardAnnotationRect(
  start: MediaBoardAnnotationResizeStart,
  corner: MediaBoardAnnotationResizeCorner,
  deltaX: number,
  deltaY: number,
): MediaBoardAnnotationResizeStart {
  const fromLeft = corner.includes('w');
  const fromTop = corner.includes('n');
  const requestedWidth = fromLeft ? start.width - deltaX : start.width + deltaX;
  const requestedHeight = fromTop ? start.height - deltaY : start.height + deltaY;
  const width = Math.max(
    MEDIA_BOARD_ANNOTATION_MIN_SIZE.width,
    Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.width, requestedWidth),
  );
  const height = Math.max(
    MEDIA_BOARD_ANNOTATION_MIN_SIZE.height,
    Math.min(MEDIA_BOARD_ANNOTATION_MAX_SIZE.height, requestedHeight),
  );

  return {
    width,
    height,
    x: fromLeft ? start.x + (start.width - width) : start.x,
    y: fromTop ? start.y + (start.height - height) : start.y,
  };
}

export function getDraggedMediaBoardAnnotationPosition(
  start: MediaBoardAnnotationPosition,
  deltaX: number,
  deltaY: number,
): MediaBoardAnnotationPosition {
  return {
    x: start.x + deltaX,
    y: start.y + deltaY,
  };
}
