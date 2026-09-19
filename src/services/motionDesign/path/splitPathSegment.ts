import type { MotionPathVertex, MotionVector2, PathShapeDefinition } from '../../../types/motionDesign';

const midpoint = (a: MotionVector2, b: MotionVector2): MotionVector2 => ({ x: (a.x+b.x)/2, y: (a.y+b.y)/2 });
const relative = (a: MotionVector2, origin: MotionVector2): MotionVector2 => ({ x: a.x-origin.x, y: a.y-origin.y });

/** Insert a point without changing the original cubic curve (de Casteljau). */
export function splitPathSegment(path: PathShapeDefinition, index: number): MotionPathVertex[] {
  const vertices = path.vertices;
  if (vertices.length >= 128 || index < 0 || index >= vertices.length || (!path.closed && index === vertices.length-1)) return vertices;
  const next = (index+1) % vertices.length;
  const start = vertices[index], end = vertices[next];
  const c1 = { x:start.x+start.handleOut.x, y:start.y+start.handleOut.y };
  const c2 = { x:end.x+end.handleIn.x, y:end.y+end.handleIn.y };
  const a=midpoint(start,c1), b=midpoint(c1,c2), c=midpoint(c2,end);
  const d=midpoint(a,b), e=midpoint(b,c), point=midpoint(d,e);
  const result=vertices.map((vertex,i) => i===index ? { ...vertex, handleOut:relative(a,start) }
    : i===next ? { ...vertex, handleIn:relative(c,end) } : vertex);
  result.splice(index+1,0,{ ...point, handleIn:relative(d,point), handleOut:relative(e,point) });
  return result;
}
