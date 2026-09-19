import type { TextBoundsPath } from './masks';

// Text clip typography properties
export interface TextClipProperties {
  // Content
  text: string;

  // Typography
  fontFamily: string;           // e.g., 'Roboto', 'Open Sans'
  fontSize: number;             // in pixels
  fontWeight: number;           // 100-900
  fontStyle: 'normal' | 'italic';

  // Color
  color: string;                // hex or rgba

  // Alignment
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';

  // Spacing
  lineHeight: number;           // multiplier (1.2 = 120%)
  letterSpacing: number;        // pixels

  // Area text box (paragraph text)
  boxEnabled?: boolean;          // When true, wraps and clips text inside the box
  boxX?: number;                 // Box origin in text canvas pixels
  boxY?: number;
  boxWidth?: number;
  boxHeight?: number;
  wrapMode?: 'word' | 'none';    // Area text: word-wrap by default; none preserves only explicit line breaks
  textBounds?: TextBoundsPath;    // AE-style editable paragraph bounds/path

  // Stroke (outline)
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;          // pixels

  // Shadow
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOffsetX: number;        // pixels
  shadowOffsetY: number;
  shadowBlur: number;           // pixels

  // Text on Path (bezier curve)
  pathEnabled: boolean;
  pathPoints: { x: number; y: number; handleIn: { x: number; y: number }; handleOut: { x: number; y: number } }[];
}

export interface Text3DProperties {
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
