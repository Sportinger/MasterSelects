import type { TimelineClip } from '../../../types';

// Source types whose clips are an unbounded canvas: both trim edges enlarge
// freely (there is no fixed source media length to run out of). Kept in ONE
// place because the trim commit (useClipTrim), the handle affordances
// (trimHandleDirections) and the live on-timeline resize preview (TimelineClip)
// must all agree — if they drift, a clip can resize on commit but not visibly
// grow during the drag (or vice versa).
export function isInfiniteTrimSource(clip: Pick<TimelineClip, 'source'>): boolean {
  const sourceType = clip.source?.type;
  return sourceType === 'text' ||
    sourceType === 'image' ||
    sourceType === 'solid' ||
    sourceType === 'camera' ||
    sourceType === 'splat-effector' ||
    sourceType === 'math-scene' ||
    // MIDI clips are an unbounded note canvas — both edges enlarge freely (#232).
    sourceType === 'midi';
}
