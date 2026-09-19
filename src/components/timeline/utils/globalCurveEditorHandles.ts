import type {
  CurveGraphKeyframe,
  CurveGraphSeries,
} from './curveGraphModel';
import { curveStorageDeltaToAuthoring } from './curveGraphModel';
import { resolveBezierSegmentHandles } from '../../../utils/keyframeInterpolation';

interface RenderedHandle {
  handle: 'in' | 'out';
  x: number;
  y: number;
}

/** Projects stored Bezier handles into the global graph's authoring space. */
export function buildRenderedCurveHandles(
  series: CurveGraphSeries,
  point: CurveGraphKeyframe,
  previous: CurveGraphKeyframe | undefined,
  next: CurveGraphKeyframe | undefined,
  valueToY: (value: number) => number,
  timeToPixel: (time: number) => number,
): RenderedHandle[] {
  const handles: RenderedHandle[] = [];
  if (previous) {
    const storagePosition = resolveBezierSegmentHandles(previous.keyframe, point.keyframe).handleIn;
    handles.push({
      handle: 'in',
      x: timeToPixel(point.compositionTime + storagePosition.x),
      y: valueToY(
        point.authoringValue + curveStorageDeltaToAuthoring(
          series.descriptor,
          storagePosition.y,
          series.authoringContext,
        ),
      ),
    });
  }
  if (next) {
    const storagePosition = resolveBezierSegmentHandles(point.keyframe, next.keyframe).handleOut;
    handles.push({
      handle: 'out',
      x: timeToPixel(point.compositionTime + storagePosition.x),
      y: valueToY(
        point.authoringValue + curveStorageDeltaToAuthoring(
          series.descriptor,
          storagePosition.y,
          series.authoringContext,
        ),
      ),
    });
  }
  return handles;
}
