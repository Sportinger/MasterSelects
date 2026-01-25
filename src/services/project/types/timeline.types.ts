// Timeline-related types (keyframes, markers, effects, masks, transforms)

export interface ProjectTransform {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  rotationX: number;
  rotationY: number;
  anchorX: number;
  anchorY: number;
  opacity: number;
  blendMode: string;
}

export interface ProjectEffect {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
}

export interface ProjectMaskVertex {
  x: number;
  y: number;
  inTangent: { x: number; y: number };
  outTangent: { x: number; y: number };
}

export interface ProjectMask {
  id: string;
  name: string;
  mode: 'add' | 'subtract' | 'intersect';
  inverted: boolean;
  opacity: number;
  feather: number;
  featherQuality: number;
  visible: boolean;
  closed: boolean;
  vertices: ProjectMaskVertex[];
  position: { x: number; y: number };
}

export interface ProjectKeyframe {
  id: string;
  property: string;
  time: number;
  value: number;
  easing: string;
  bezierHandles?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface ProjectMarker {
  id: string;
  time: number;
  name: string;
  color: string;
  duration: number;
}
