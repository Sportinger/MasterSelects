import { pointwiseOperation } from '../../../services/operators/fields/pointwiseOperations';
import type { GeometryField, GeometryStage } from '../../../services/operators/geometry/geometryProgram';

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

function fieldFunction(name: string, field: GeometryField, constants: number[], type = 'f32'): string {
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
  return `fn ${name}(ctx: FieldContext) -> ${type} {\n${lines.join('\n')}\n  return ${type}(r${field.output});\n}`;
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

/** Ordered position and radius modifiers after a rod solve, without a CPU readback.
 * Both inputs of Set Position read the same incoming point, matching geometryEvaluation.
 * This is a render deformation; rod contacts still run in the unmodified simulation space.
 */
export function strandRodFieldCode(stages: readonly GeometryStage[]): StrandFieldCode {
  const constants: number[] = [], functions: string[] = [], body: string[] = [];
  const read = (field: GeometryField, type: string) => {
    const name = `rodField${functions.length}`;
    functions.push(fieldFunction(name, field, constants, type));
    return `${name}(ctx)`;
  };
  stages.forEach(stage => {
    if (stage.kind === 'yarn-profile') {
      if (stage.radius) body.push(`  radius *= max(0.0, ${read(stage.radius, 'f32')});`);
    } else if (stage.kind === 'set-position') {
      const target = stage.position ? read(stage.position, 'vec3f') : 'ctx.position';
      const offset = stage.offset ? read(stage.offset, 'vec3f') : 'vec3f(0.0)';
      body.push(`  ctx.position = ${target} + ${offset};`);
    } else throw new Error('Unsupported GPU rod output modifier.');
  });
  return { code: `${functions.join('\n\n')}\n\nfn strandRodPoint(input: FieldContext, scale: f32) -> vec4f {\n  var ctx = input;\n  var radius = scale;\n${body.join('\n')}\n  return vec4f(ctx.position, radius);\n}`, constants };
}
