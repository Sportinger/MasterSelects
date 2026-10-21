import type { EffectParam } from './types';
import type { EffectOperatorGraph } from '../types/operatorGraph';
import { effectParamDisplay } from './paramDisplay';

export interface ParamRangeNote {
  param: string;
  label: string;
  value: number;
  rendered: number;
  message: string;
}

const formatNumber = (value: number) => Number(value.toPrecision(4)).toString();

/**
 * Numbers outside a parameter's declared render range (keyframe overshoot, tool calls, node
 * drivers) are clamped by the effect graph's `<param>-clamped` node. This names every such value,
 * so the inspector and tool results can say what actually renders instead of failing silently.
 * With the instance's saved graph, only parameters that graph still clamps are reported (graphs
 * saved before the clamp existed, or edited without it, render the raw value).
 * Messages use stored units (tool results); with `display`, the inspector's units instead (value ×
 * displayScale with its unit, as the row next to the note shows it: "Horizon 150% ... 98%").
 */
export function paramRangeNotes(definitions: Record<string, EffectParam>, values: Record<string, unknown>,
  graph?: Pick<EffectOperatorGraph, 'nodes'>, options: { display?: boolean } = {}): ParamRangeNote[] {
  return Object.entries(definitions).flatMap(([param, definition]) => {
    const value = values[param];
    if (definition.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value)) return [];
    if (graph && !graph.nodes.some(node => node.id === `${param}-clamped`)) return [];
    const { renderMin, renderMax } = definition;
    const rendered = renderMin !== undefined && value < renderMin ? renderMin : renderMax !== undefined && value > renderMax ? renderMax : value;
    if (rendered === value) return [];
    const shown = options.display ? effectParamDisplay(definition) : undefined;
    const format = (number: number) => shown ? `${formatNumber(number * shown.scale)}${shown.suffix ?? ''}` : formatNumber(number);
    const side = value < rendered ? 'below' : 'above';
    // A one-sided range names its only limit ("the rendered minimum (0)"), not an infinite end.
    const range = renderMin !== undefined && renderMax !== undefined ? `the rendered range (${format(renderMin)} to ${format(renderMax)})`
      : `the rendered ${side === 'below' ? 'minimum' : 'maximum'} (${format(rendered)})`;
    return [{ param, label: definition.label, value, rendered,
      message: `${definition.label} ${format(value)} is ${side} ${range} and renders as ${format(rendered)}${side === 'below' && definition.renderMinLook ? ` (${definition.renderMinLook})` : ''}.` }];
  });
}
