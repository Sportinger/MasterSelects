import { pointwiseOperation } from '../../../services/operators/fields/pointwiseOperations';
import type { GeometryField } from '../../../services/operators/geometry/geometryProgram';

/**
 * Per-point curve fields compiled to WGSL for the GPU bind (CPU reference: curveFieldColumns.ts).
 * Constants are read from `fieldConstants`, so an animated value keeps the generated code and its
 * pipeline; only the structure of the fields selects the code.
 */
export interface StrandFieldCode { code: string; constants: number[] }

/** Curve context of a point, as curveFieldColumns.ts defines it. */
const CONTEXT: Record<string, string> = {
  'position': 'ctx.position', 'curve-u': 'ctx.curveU', 'point-index': 'ctx.point', 'strand-index': 'ctx.strand',
  'point-count': 'ctx.points', 'strand-count': 'ctx.strands',
};

function fieldFunction(name: string, field: GeometryField, constants: number[]): string {
  const lines = field.instructions.map((instruction, index) => {
    const context = CONTEXT[instruction.operation];
    if (context) return `  let r${index} = ${context};`;
    if (instruction.operation === 'constant') {
      constants.push(instruction.value ?? 0);
      return `  let r${index} = fieldConstants[${constants.length - 1}u];`;
    }
    const operation = pointwiseOperation(instruction.operation);
    if (!operation) throw new Error(`No GPU curve field operation: ${instruction.operation}`);
    return `  let r${index} = ${operation.wgsl(instruction.inputs.map(input => `r${input}`), instruction.value)};`;
  });
  return `fn ${name}(ctx: FieldContext) -> f32 {\n${lines.join('\n')}\n  return f32(r${field.output});\n}`;
}

/**
 * `strandRadiusScale(ctx)`: the product of the Yarn Profile radius fields, each clamped at 0 as in
 * geometryEvaluation.ts. Throws for an operation without a WGSL form.
 */
export function strandRadiusFieldCode(fields: readonly GeometryField[]): StrandFieldCode {
  const constants: number[] = [];
  const functions = fields.map((field, index) => fieldFunction(`radiusField${index}`, field, constants));
  const product = fields.map((_, index) => `max(0.0, radiusField${index}(ctx))`).join(' * ') || '1.0';
  return { code: `${functions.join('\n\n')}\n\nfn strandRadiusScale(ctx: FieldContext) -> f32 {\n  return ${product};\n}`, constants };
}
