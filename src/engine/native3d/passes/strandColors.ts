import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';
import type { GeometryField } from '../../../services/operators/geometry/geometryProgram';
import { evaluateFieldColumn } from '../../../services/operators/geometry/curveFieldColumns';

/** Material coordinates survive GPU deformation; spatial fields need the final CPU positions. */
export function strandColorNeedsPositions(field: GeometryField | undefined): boolean {
  return !!field?.instructions.some(instruction => instruction.operation === 'position');
}

/** RGB per centerline point, shared by every ply, fiber and flyaway of that yarn. */
export function packStrandColors(curves: CurveSet, field: GeometryField): Float32Array {
  const evaluate = evaluateFieldColumn(field, curves);
  const colors = new Float32Array(curves.positions.length / 3 * 4);
  for (let point = 0; point < colors.length / 4; point++) {
    const value = evaluate(point) as number[];
    for (let channel = 0; channel < 3; channel++) {
      const component = value[channel];
      colors[point * 4 + channel] = Number.isFinite(component) ? Math.max(0, Math.min(1, component)) : 0;
    }
    colors[point * 4 + 3] = 1;
  }
  return colors;
}
