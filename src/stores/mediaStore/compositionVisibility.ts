import type { Composition } from './types';

export function isUserVisibleComposition(composition: Pick<Composition, 'transitionComp'>): boolean {
  return composition.transitionComp?.kind !== 'transition-comp';
}
