import type { BoundOperatorNode, OperatorEdge } from '../../types/operatorGraph';
import type { ImageOperatorCompileContext } from './imageOperatorChoice';

/**
 * Time × Rate. A Multiply node whose operands are the timeline Time and a value bound to a rate
 * parameter that integrates (EffectParam.integratedAs, e.g. the Speed of the two-tone-pattern looks)
 * lowers to the distance that rate has travelled: the travel value the keyframe evaluation writes for
 * a keyframed rate (the area under its curve), otherwise rate × time. A Speed ramp therefore moves the
 * pattern smoothly instead of jumping, in every saved and new graph, while the graph still reads
 * "Time × Speed". The plan holds two uniform slots, so a key added or removed only rebinds values:
 * result = travel + rateWithoutTravel × time (travel 0 without keys; rateWithoutTravel 0 with keys).
 */
export interface RateTravelOperands { rate: string; travel: string; fallback: number }

export function rateTravelOperands(node: BoundOperatorNode, incoming: ReadonlyMap<string, readonly OperatorEdge[]>,
  nodes: ReadonlyMap<string, BoundOperatorNode>, context: ImageOperatorCompileContext): RateTravelOperands | undefined {
  if (node.operator !== 'math.multiply.scalar' || node.bypassed || !context.parameterSchema) return undefined;
  const operand = (input: string) => {
    const edge = incoming.get(`${node.id}:${input}`)?.[0];
    return edge ? nodes.get(edge.from) : undefined;
  };
  const a = operand('a'), b = operand('b');
  const rateNode = a?.operator === 'image.timeline-time' ? b : b?.operator === 'image.timeline-time' ? a : undefined;
  const rate = rateNode?.operator === 'values.number' && typeof rateNode.bindings.value === 'string' ? rateNode.bindings.value : undefined;
  const travel = rate ? context.parameterSchema[rate]?.integratedAs : undefined;
  if (!rate || !travel) return undefined;
  const literal = rateNode?.constants?.value;
  return { rate, travel, fallback: typeof literal === 'number' ? literal : 1 };
}

/** Values of the two slots: [travelled distance or 0, rate when no travel is given or 0]. */
export function rateTravelValues(operands: Pick<RateTravelOperands, 'rate' | 'travel' | 'fallback'>, params: Record<string, unknown>): [number, number] {
  const travel = params[operands.travel], rate = params[operands.rate];
  const values: [number, number] = typeof travel === 'number' ? [travel, 0] : [0, typeof rate === 'number' ? rate : operands.fallback];
  if (!values.every(Number.isFinite)) throw new Error(`Image parameter ${typeof travel === 'number' ? operands.travel : operands.rate} must be finite.`);
  return values;
}
