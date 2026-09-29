import { pointwiseOperation, type PointwiseValue } from '../fields/pointwiseOperations';
import type { GeometryField, GeometryProgram } from './geometryProgram';

/** Polylines as flat XYZ positions; strand `i` owns points `starts[i]` … `starts[i] + counts[i] - 1`. */
export interface CurveSet { positions: Float32Array; starts: Uint32Array; counts: Uint32Array }
interface CurvePointContext { position: [number, number, number]; u: number; point: number; strand: number; points: number; strands: number }

/** Evaluates one field for one point. This is the CPU reference of the GPU curve kernels. */
export function evaluateGeometryField(field: GeometryField, context: CurvePointContext): PointwiseValue {
  const values: PointwiseValue[] = [];
  for (const item of field.instructions) {
    const args = item.inputs.map(input => values[input]);
    switch (item.operation) {
      case 'constant': values.push(item.value ?? 0); break;
      case 'position': values.push(context.position); break;
      case 'curve-u': values.push(context.u); break;
      case 'point-index': values.push(context.point); break;
      case 'strand-index': values.push(context.strand); break;
      case 'point-count': values.push(context.points); break;
      case 'strand-count': values.push(context.strands); break;
      default: {
        const operation = pointwiseOperation(item.operation);
        if (!operation) throw new Error(`Unsupported curve field operation: ${item.operation}`);
        values.push(operation.evaluate(args, item.value));
      }
    }
  }
  return values[field.output];
}

/** Runs the curve stages on the CPU. Set Position reads Position and Offset on the incoming points. */
export function evaluateGeometryProgram(program: GeometryProgram): CurveSet {
  let positions = new Float32Array(0), starts = new Uint32Array(0), counts = new Uint32Array(0);
  for (const stage of program.stages) {
    if (stage.kind === 'curve-line') {
      positions = new Float32Array(stage.points * 3);
      for (let index = 0; index < stage.points; index++) positions[index * 3 + stage.axis] = (index / (stage.points - 1) - 0.5) * stage.length;
      starts = Uint32Array.of(0); counts = Uint32Array.of(stage.points);
    } else if (stage.kind === 'strand-array') {
      const pointTotal = positions.length / 3, strandTotal = counts.length;
      const nextPositions = new Float32Array(positions.length * stage.count);
      const nextStarts = new Uint32Array(strandTotal * stage.count), nextCounts = new Uint32Array(strandTotal * stage.count);
      for (let copy = 0; copy < stage.count; copy++) {
        const shift = (copy - (stage.count - 1) / 2) * stage.spacing;
        nextPositions.set(positions, copy * positions.length);
        for (let point = 0; point < pointTotal; point++) nextPositions[(copy * pointTotal + point) * 3 + stage.axis] += shift;
        for (let strand = 0; strand < strandTotal; strand++) {
          nextStarts[copy * strandTotal + strand] = copy * pointTotal + starts[strand];
          nextCounts[copy * strandTotal + strand] = counts[strand];
        }
      }
      positions = nextPositions; starts = nextStarts; counts = nextCounts;
    } else {
      const next = new Float32Array(positions.length);
      for (let strand = 0; strand < counts.length; strand++) {
        const points = counts[strand];
        for (let point = 0; point < points; point++) {
          const index = starts[strand] + point, base = index * 3;
          const context: CurvePointContext = { position: [positions[base], positions[base + 1], positions[base + 2]],
            u: points > 1 ? point / (points - 1) : 0, point, strand, points, strands: counts.length };
          const target = stage.position ? evaluateGeometryField(stage.position, context) as number[] : context.position;
          const offset = stage.offset ? evaluateGeometryField(stage.offset, context) as number[] : undefined;
          for (let component = 0; component < 3; component++) next[base + component] = target[component] + (offset?.[component] ?? 0);
        }
      }
      positions = next;
    }
  }
  return { positions, starts, counts };
}
