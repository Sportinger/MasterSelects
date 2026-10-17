/**
 * A ruler guide of a composition. A vertical guide marks an x position, a
 * horizontal guide a y position, both in composition pixels.
 */
export interface CompositionGuide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
}
