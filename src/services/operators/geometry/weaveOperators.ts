import type { OperatorDefinition } from '../../../types/operatorGraph';

/** Weave drafts: which thread lies on top at warp `i`, weft `j` (true = warp over weft). */
export const WEAVE_PATTERNS = ['plain', 'twill-2-2', 'twill-2-1', 'satin-5', 'basket-2'] as const;
export type WeavePattern = typeof WEAVE_PATTERNS[number];
export function warpOver(pattern: number, i: number, j: number): boolean {
  if (pattern === 1) return (i + j) % 4 < 2;
  if (pattern === 2) return (i + j) % 3 < 2;
  if (pattern === 3) return (i * 2 + j) % 5 === 0;
  if (pattern === 4) return (Math.floor(i / 2) + Math.floor(j / 2)) % 2 === 0;
  return (i + j) % 2 === 0;
}

const number = (id: string, label: string, value: number, min: number, max: number, step = 0.001, animatable = true) =>
  ({ id, label, type: 'number' as const, default: value, min, max, step, animatable });

/** The only weave-specific node: a woven grid of warp and weft curves with analytic crimp. */
export const WEAVE_OPERATORS: readonly OperatorDefinition[] = [{
  id: 'weave.pattern', version: 1, label: 'Weave Pattern',
  description: 'Creates interlaced warp (vertical) and weft (horizontal) curves; the draft decides which thread lies on top at each crossing and Crimp lifts it.',
  inputs: [], outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: ['strand-curves'] } }],
  parameters: [
    { id: 'pattern', label: 'Pattern', type: 'select', default: 'plain', options: [
      { value: 'plain', label: 'Plain' }, { value: 'twill-2-2', label: 'Twill 2/2' }, { value: 'twill-2-1', label: 'Twill 2/1' },
      { value: 'satin-5', label: 'Satin 5' }, { value: 'basket-2', label: 'Basket 2/2' }] },
    number('warps', 'Warp Threads', 24, 1, 1024, 1, false), number('wefts', 'Weft Threads', 16, 1, 1024, 1, false),
    number('width', 'Width', 2.4, 0, 100), number('height', 'Height', 1.6, 0, 100),
    number('crimp', 'Crimp', 0.03, 0, 10), number('resolution', 'Points per Crossing', 16, 2, 64, 1, false),
  ],
  invalidates: 'appearance', runtime: 'builtin', state: 'stateless', addable: true, implementation: 'local', consumers: ['Weave'],
}];
