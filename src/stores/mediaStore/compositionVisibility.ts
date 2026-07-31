import type { Composition } from './types';

export function isUserVisibleComposition(
  composition: Pick<Composition, 'transitionComp' | 'captionComp'>,
): boolean {
  return composition.transitionComp?.kind !== 'transition-comp'
    && composition.captionComp?.kind !== 'caption-comp';
}
