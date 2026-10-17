import { Logger } from './logger';
import { useMediaStore } from '../stores/mediaStore';
import type { CompositionGuide } from '../types/compositionGuides';
import type { AxisSnapPoints } from '../components/preview/editModeSnapping';

const log = Logger.create('CompositionGuides');

/** Guides far outside any canvas are dropped instead of stored. */
const MAX_GUIDE_POSITION = 100_000;
const MAX_GUIDES_PER_COMPOSITION = 500;

function isGuide(value: unknown): value is CompositionGuide {
  if (!value || typeof value !== 'object') return false;
  const guide = value as Partial<CompositionGuide>;
  return typeof guide.id === 'string'
    && guide.id.length > 0
    && (guide.orientation === 'horizontal' || guide.orientation === 'vertical')
    && typeof guide.position === 'number'
    && Number.isFinite(guide.position)
    && Math.abs(guide.position) <= MAX_GUIDE_POSITION;
}

/** Validate stored guides; invalid entries are dropped with a warning. */
export function normalizeCompositionGuides(value: unknown, compositionId?: string): CompositionGuide[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    log.warn('Ignored composition guides that are not a list', { compositionId });
    return undefined;
  }
  const seen = new Set<string>();
  const guides = value.filter((guide): guide is CompositionGuide => {
    if (!isGuide(guide) || seen.has(guide.id)) return false;
    seen.add(guide.id);
    return true;
  }).slice(0, MAX_GUIDES_PER_COMPOSITION).map(({ id, orientation, position }) => ({ id, orientation, position }));
  if (guides.length !== value.length) {
    log.warn('Dropped invalid composition guides', { compositionId, dropped: value.length - guides.length });
  }
  return guides.length > 0 ? guides : undefined;
}

/** Guide positions as snap targets: vertical guides snap x, horizontal guides snap y. */
export function getGuideSnapPoints(guides: readonly CompositionGuide[] | undefined): AxisSnapPoints {
  const x: number[] = [];
  const y: number[] = [];
  for (const guide of guides ?? []) {
    (guide.orientation === 'vertical' ? x : y).push(guide.position);
  }
  return { x, y };
}

export function createGuideId(): string {
  return `guide_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function writeGuides(compositionId: string, guides: CompositionGuide[]): void {
  const media = useMediaStore.getState();
  if (!media.compositions.some((composition) => composition.id === compositionId)) {
    log.warn('Cannot change guides of a missing composition', { compositionId });
    return;
  }
  media.updateComposition(compositionId, { guides: guides.length > 0 ? guides : undefined });
}

function readGuides(compositionId: string): CompositionGuide[] {
  return useMediaStore.getState().compositions.find((composition) => composition.id === compositionId)?.guides ?? [];
}

export function addCompositionGuide(
  compositionId: string,
  orientation: CompositionGuide['orientation'],
  position: number,
): string | null {
  const guides = readGuides(compositionId);
  if (guides.length >= MAX_GUIDES_PER_COMPOSITION) {
    log.warn('Guide limit reached; no guide added', { compositionId, limit: MAX_GUIDES_PER_COMPOSITION });
    return null;
  }
  const guide: CompositionGuide = { id: createGuideId(), orientation, position: clampGuidePosition(position) };
  writeGuides(compositionId, [...guides, guide]);
  return guide.id;
}

export function moveCompositionGuide(compositionId: string, guideId: string, position: number): void {
  const guides = readGuides(compositionId);
  const next = clampGuidePosition(position);
  if (!guides.some((guide) => guide.id === guideId && guide.position !== next)) return;
  writeGuides(compositionId, guides.map((guide) => (guide.id === guideId ? { ...guide, position: next } : guide)));
}

export function removeCompositionGuide(compositionId: string, guideId: string): void {
  const guides = readGuides(compositionId);
  if (!guides.some((guide) => guide.id === guideId)) return;
  writeGuides(compositionId, guides.filter((guide) => guide.id !== guideId));
}

export function clearCompositionGuides(compositionId: string): void {
  if (readGuides(compositionId).length > 0) writeGuides(compositionId, []);
}

function clampGuidePosition(position: number): number {
  return Math.max(-MAX_GUIDE_POSITION, Math.min(MAX_GUIDE_POSITION, Math.round(position)));
}
