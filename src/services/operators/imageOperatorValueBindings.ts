import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { colorToRgba } from '../../effects/_shared/catalogColor';
import { imageDegreesToRadians } from './imageAngleSemantics';
import { resolveImageOperatorChoice, type ImageOperatorCompileContext } from './imageOperatorChoice';
import type { ImageOperatorPlan } from './imageOperatorPlanTypes';

/** Uniform sources recorded during lowering; these never specialize shader code. */
export interface ImageOperatorValueBinding {
  slot: number;
  binding: string;
  kind: 'number' | 'boolean' | 'choice' | 'color' | 'degrees-radians';
  fallback?: number | string;
}

export function validateImageOperatorValues(graph: EffectOperatorGraph, params: Record<string, unknown>, context: ImageOperatorCompileContext): void {
  for (const node of graph.nodes) {
    const binding = node.bindings.value;
    const value = typeof binding === 'string' ? params[binding] : node.constants?.value;
    if ((node.operator === 'values.number' || node.operator === 'values.integer')
      && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`Image scalar ${node.id} must be finite.`);
    }
    if (node.operator === 'values.boolean' && value !== undefined && typeof value !== 'boolean') {
      throw new Error(`Image Boolean ${node.id} must be Boolean.`);
    }
    if (node.operator === 'values.choice') resolveImageOperatorChoice(binding, params, context);
  }
}

/** Keeps immutable plans from older frames valid, including every materialized pass. */
export function bindImageOperatorValues(plan: ImageOperatorPlan, params: Record<string, unknown>, context: ImageOperatorCompileContext): ImageOperatorPlan {
  const values = [...plan.values];
  for (const source of plan.valueBindings ?? []) {
    const raw = params[source.binding];
    if (source.kind === 'color') {
      const color = Array.isArray(raw) && raw.length === 4 && raw.every(value => typeof value === 'number' && Number.isFinite(value))
        ? raw as number[] : colorToRgba(typeof raw === 'string' ? raw : undefined, source.fallback as string);
      values.splice(source.slot, 4, ...color);
    } else if (source.kind === 'choice') values[source.slot] = resolveImageOperatorChoice(source.binding, params, context);
    else if (source.kind === 'boolean') values[source.slot] = raw === true ? 1 : 0;
    else {
      const value = typeof raw === 'number' ? raw : source.fallback as number;
      values[source.slot] = source.kind === 'degrees-radians' ? imageDegreesToRadians(value) : value;
      if (!Number.isFinite(values[source.slot])) throw new Error(`Image parameter ${source.binding} must be finite.`);
    }
  }
  return { ...plan, values, ...(plan.passes ? { passes: plan.passes.map(pass => ({ ...pass,
    program: bindImageOperatorValues(pass.program, params, context) })) } : {}) };
}
