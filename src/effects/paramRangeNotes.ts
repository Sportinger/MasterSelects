import type { EffectParam } from './types';
import type { EffectOperatorGraph } from '../types/operatorGraph';

export interface ParamRangeNote {
  param: string;
  label: string;
  value: number;
  rendered: number;
  message: string;
}

const format = (value: number) => Number(value.toPrecision(4)).toString();

/**
 * Numbers outside a parameter's declared render range (keyframe overshoot, tool calls, node
 * drivers) are clamped by the effect graph's `<param>-clamped` node. This names every such value,
 * so the inspector and tool results can say what actually renders instead of failing silently.
 * With the instance's saved graph, only parameters that graph still clamps are reported (graphs
 * saved before the clamp existed, or edited without it, render the raw value).
 */
export function paramRangeNotes(definitions: Record<string, EffectParam>, values: Record<string, unknown>,
  graph?: Pick<EffectOperatorGraph, 'nodes'>): ParamRangeNote[] {
  return Object.entries(definitions).flatMap(([param, definition]) => {
    const value = values[param];
    if (definition.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) return [];
    if (graph && !graph.nodes.some(node => node.id === `${param}-clamped`)) return [];
    const { renderMin, renderMax } = definition;
    const rendered = renderMin !== undefined && value < renderMin ? renderMin : renderMax !== undefined && value > renderMax ? renderMax : value;
    if (rendered === value) return [];
    const side = value < rendered ? 'below' : 'above';
    return [{ param, label: definition.label, value, rendered,
      message: `${definition.label} ${format(value)} is ${side} the rendered range (${format(renderMin ?? -Infinity)} to ${format(renderMax ?? Infinity)}) and renders as ${format(rendered)}.` }];
  });
}
