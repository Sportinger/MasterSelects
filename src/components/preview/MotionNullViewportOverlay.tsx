import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useState } from 'react';
import type {
  MotionNullViewportControllerModel,
  MotionNullViewportDiagnostic,
} from '../../services/motionDesign/structure/nullViewportController';

export interface MotionNullViewportOverlayProps {
  readonly width: number;
  readonly height: number;
  readonly controller: MotionNullViewportControllerModel | null;
  readonly diagnostics: readonly MotionNullViewportDiagnostic[];
  readonly onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<SVGGElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<SVGGElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<SVGGElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<SVGGElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => void;
}

export function MotionNullViewportOverlay({
  width,
  height,
  controller,
  diagnostics,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
}: MotionNullViewportOverlayProps) {
  const [focused, setFocused] = useState(false);
  if (!controller?.handle.render) {
    const error = diagnostics[0];
    if (!error || controller) return null;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        data-motion-null-viewport-diagnostic={error.code}
        role="status"
        aria-label={error.message}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width,
          height,
          transform: 'translate(-50%, -50%)',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <title>{error.message}</title>
        <rect x={12} y={12} width={220} height={28} rx={5} fill="rgba(20, 20, 20, 0.9)" />
        <text x={24} y={31} fill="#ffb45c" fontSize={12}>Motion Null handle unavailable</text>
      </svg>
    );
  }

  const geometry = controller.handle.geometry;
  const accessibility = controller.accessibility;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-motion-null-viewport-overlay="true"
      aria-hidden="false"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width,
        height,
        transform: 'translate(-50%, -50%)',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <g
        id={accessibility.id}
        className="preview-motion-null-handle"
        role={accessibility.role}
        tabIndex={accessibility.tabIndex}
        aria-label={accessibility.label}
        aria-description={accessibility.description}
        aria-disabled={accessibility.disabled}
        data-motion-null-clip-id={controller.clipId}
        data-motion-null-interactive={controller.handle.interactive ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          cursor: controller.handle.interactive ? controller.gesture.pointer.cursor : 'not-allowed',
          outline: 'none',
          pointerEvents: controller.handle.interactive ? 'auto' : 'none',
        }}
      >
        <circle
          cx={geometry.center.x}
          cy={geometry.center.y}
          r={controller.handle.hitRadiusScreenPixels}
          fill="transparent"
          stroke="transparent"
          strokeWidth={1}
        />
        <circle
          cx={geometry.center.x}
          cy={geometry.center.y}
          r={4}
          fill="var(--accent-primary, #2ea8ff)"
          stroke="rgba(0, 0, 0, 0.9)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {focused && (
          <circle
            aria-hidden="true"
            cx={geometry.center.x}
            cy={geometry.center.y}
            r={controller.handle.hitRadiusScreenPixels}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        <line
          x1={geometry.xAxis.from.x}
          y1={geometry.xAxis.from.y}
          x2={geometry.xAxis.to.x}
          y2={geometry.xAxis.to.y}
          stroke="var(--accent-primary, #2ea8ff)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={geometry.yAxis.from.x}
          y1={geometry.yAxis.from.y}
          x2={geometry.yAxis.to.x}
          y2={geometry.yAxis.to.y}
          stroke="var(--accent-primary, #2ea8ff)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
