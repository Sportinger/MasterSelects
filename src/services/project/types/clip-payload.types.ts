export type ProjectEasingType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'bezier';

export interface ProjectTextBoundsVertex {
  id: string;
  x: number;
  y: number;
  handleIn: { x: number; y: number };
  handleOut: { x: number; y: number };
  handleMode?: 'none' | 'mirrored' | 'split';
}

export interface ProjectTextBoundsPath {
  id: string;
  vertices: ProjectTextBoundsVertex[];
  closed: boolean;
  position: { x: number; y: number };
  visible?: boolean;
}

export interface ProjectTextClipProperties {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  boxEnabled?: boolean;
  boxX?: number;
  boxY?: number;
  boxWidth?: number;
  boxHeight?: number;
  textBounds?: ProjectTextBoundsPath;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
  pathEnabled: boolean;
  pathPoints: Array<{
    x: number;
    y: number;
    handleIn: { x: number; y: number };
    handleOut: { x: number; y: number };
  }>;
}

export interface ProjectText3DProperties {
  text: string;
  fontFamily: 'helvetiker' | 'optimer' | 'gentilis';
  fontWeight: 'regular' | 'bold';
  size: number;
  depth: number;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  curveSegments: number;
  bevelEnabled: boolean;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
}

export interface ProjectMathSceneViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  showGrid: boolean;
  showAxes: boolean;
}

export interface ProjectMathSceneStyle {
  backgroundColor: string;
  axisColor: string;
  gridColor: string;
  labelColor: string;
}

export interface ProjectMathParameterAnimation {
  enabled: boolean;
  from: number;
  to: number;
  startTime: number;
  endTime: number;
  easing: ProjectEasingType;
}

export interface ProjectMathParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  animation?: ProjectMathParameterAnimation;
}

export interface ProjectMathObjectAnimation {
  reveal?: {
    enabled: boolean;
    startTime: number;
    endTime: number;
  };
}

export interface ProjectMathBaseObject {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  animation?: ProjectMathObjectAnimation;
}

export interface ProjectMathFunctionObject extends ProjectMathBaseObject {
  type: 'function';
  expression: string;
  domain?: [number, number];
  samples: number;
  stroke: string;
  strokeWidth: number;
}

export interface ProjectMathPointObject extends ProjectMathBaseObject {
  type: 'point';
  xExpression: string;
  yExpression: string;
  radius: number;
  fill: string;
  stroke: string;
  labelVisible: boolean;
}

export interface ProjectMathTangentObject extends ProjectMathBaseObject {
  type: 'tangent';
  functionId: string;
  atExpression: string;
  length: number;
  stroke: string;
  strokeWidth: number;
}

export interface ProjectMathLabelObject extends ProjectMathBaseObject {
  type: 'label';
  text: string;
  xExpression: string;
  yExpression: string;
  fontSize: number;
  color: string;
}

export type ProjectMathObject =
  | ProjectMathFunctionObject
  | ProjectMathPointObject
  | ProjectMathTangentObject
  | ProjectMathLabelObject;

export interface ProjectMathSceneDefinition {
  version: 1;
  viewport: ProjectMathSceneViewport;
  style: ProjectMathSceneStyle;
  parameters: ProjectMathParameter[];
  objects: ProjectMathObject[];
}

export interface ProjectTranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: string;
}

export interface ProjectSceneSegment {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface ProjectFaceAnalysisPoint {
  x: number;
  y: number;
}

export interface ProjectFaceAnalysisBox extends ProjectFaceAnalysisPoint {
  width: number;
  height: number;
}

export interface ProjectFaceFrameDetection {
  id: string;
  personId: string;
  label: string;
  confidence: number;
  box: ProjectFaceAnalysisBox;
  landmarks: ProjectFaceAnalysisPoint[];
}

export interface ProjectFacePersonSummary {
  id: string;
  label: string;
  firstSeen: number;
  lastSeen: number;
  sampleCount: number;
  averageConfidence: number;
  maxConfidence: number;
  appearances: Array<{ start: number; end: number }>;
}

export interface ProjectFaceAnalysisResult {
  schemaVersion: 1;
  modelVersion: string;
  detector: 'YuNet';
  recognizer: 'SFace';
  backend: 'webgpu' | 'wasm' | 'cached';
  observationCount: number;
  people: ProjectFacePersonSummary[];
}

export interface ProjectFrameAnalysisData {
  timestamp: number;
  motion: number;
  globalMotion: number;
  localMotion: number;
  focus: number;
  brightness: number;
  faceCount: number;
  faces?: ProjectFaceFrameDetection[];
  faceModelVersion?: string;
  isSceneCut?: boolean;
}

export interface ProjectClipAnalysis {
  frames: ProjectFrameAnalysisData[];
  sampleInterval: number;
  faceAnalysis?: ProjectFaceAnalysisResult;
}

export type ProjectVideoBakeRegionScope = 'composition' | 'clip';
export type ProjectVideoBakeRegionStatus = 'marked' | 'baking' | 'baked' | 'error';

export interface ProjectVideoBakeRegion {
  id: string;
  scope: ProjectVideoBakeRegionScope;
  startTime: number;
  endTime: number;
  createdAt: number;
  status?: ProjectVideoBakeRegionStatus;
  progress?: number;
  bakedAt?: number;
  error?: string;
  clipId?: string;
  trackId?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
}

export interface ProjectClipVideoState {
  bakeRegions?: ProjectVideoBakeRegion[];
}
