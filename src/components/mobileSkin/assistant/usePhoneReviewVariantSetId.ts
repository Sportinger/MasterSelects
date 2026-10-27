// The timeline variant set the assistant shows: the latest one in review (or still building) with
// options, chosen exactly like the desktop comparison tray does.
import { useMemo } from 'react';
import { useStoryboardStore } from '../../../stores/storyboardStore';

/** The variant set the desktop tray would show (latest one in review or still building, with options). */
export function usePhoneReviewVariantSetId(): string | null {
  const variantSets = useStoryboardStore((state) => state.variantSets);
  return useMemo(() => Object.values(variantSets)
    .filter((set) => (set.status === 'review' || set.status === 'building') && set.optionIds.length > 0)
    .toSorted((left, right) => right.createdAt - left.createdAt)[0]?.id ?? null, [variantSets]);
}
