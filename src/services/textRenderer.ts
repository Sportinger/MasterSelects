/**
 * Text Renderer Service - Renders text to Canvas2D for GPU texture upload
 * Supports full typography features: font, stroke, shadow, text on path
 */

import type { TextClipProperties } from '../types';
import { googleFontsService } from './googleFontsService';

class TextRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(width: number = 1920, height: number = 1080) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    })!;
  }

  /**
   * Render text to canvas with full typography support
   */
  render(props: TextClipProperties, targetCanvas?: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = targetCanvas || this.canvas;
    const ctx = targetCanvas ? targetCanvas.getContext('2d')! : this.ctx;

    // Ensure canvas dimensions match
    if (canvas.width !== this.width || canvas.height !== this.height) {
      canvas.width = this.width;
      canvas.height = this.height;
    }

    // Clear canvas with transparent background
    ctx.clearRect(0, 0, this.width, this.height);

    // Set font properties
    const fontStyle = props.fontStyle === 'italic' ? 'italic' : 'normal';
    ctx.font = `${fontStyle} ${props.fontWeight} ${props.fontSize}px "${props.fontFamily}"`;
    ctx.textAlign = props.textAlign;

    // Ensure font is loaded
    if (!googleFontsService.isFontLoaded(props.fontFamily, props.fontWeight)) {
      // Load font in background - re-render will happen on property change
      googleFontsService.loadFont(props.fontFamily, props.fontWeight);
    }

    if (props.pathEnabled && props.pathPoints.length >= 2) {
      this.renderTextOnPath(ctx, props);
    } else {
      this.renderNormalText(ctx, props);
    }

    return canvas;
  }

  /**
   * Render standard text (multi-line support)
   */
  private renderNormalText(ctx: CanvasRenderingContext2D, props: TextClipProperties): void {
    const lines = props.text.split('\n');
    const lineHeightPx = props.fontSize * props.lineHeight;
    const totalHeight = lines.length * lineHeightPx;

    // Calculate starting Y position based on vertical alignment
    let startY: number;
    switch (props.verticalAlign) {
      case 'top':
        startY = props.fontSize;
        break;
      case 'bottom':
        startY = this.height - totalHeight + props.fontSize / 2;
        break;
      default: // middle
        startY = (this.height - totalHeight) / 2 + props.fontSize / 2;
    }

    // Calculate X position based on horizontal alignment
    let x: number;
    switch (props.textAlign) {
      case 'left':
        x = 50; // Left margin
        break;
      case 'right':
        x = this.width - 50; // Right margin
        break;
      default: // center
        x = this.width / 2;
    }

    // Apply letter spacing via character-by-character rendering if needed
    const useCharacterRendering = props.letterSpacing !== 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const y = startY + i * lineHeightPx;

      if (useCharacterRendering) {
        this.renderLineWithLetterSpacing(ctx, line, x, y, props);
      } else {
        this.renderLine(ctx, line, x, y, props);
      }
    }
  }

  /**
   * Render a single line of text with shadow and stroke
   */
  private renderLine(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    props: TextClipProperties
  ): void {
    // Reset shadow state
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Draw shadow first (underneath everything)
    if (props.shadowEnabled) {
      ctx.save();
      ctx.shadowColor = props.shadowColor;
      ctx.shadowBlur = props.shadowBlur;
      ctx.shadowOffsetX = props.shadowOffsetX;
      ctx.shadowOffsetY = props.shadowOffsetY;
      ctx.fillStyle = props.shadowColor;
      ctx.fillText(text, x, y);
      ctx.restore();
    }

    // Draw stroke (outline) - must be drawn before fill for proper overlap
    if (props.strokeEnabled && props.strokeWidth > 0) {
      ctx.strokeStyle = props.strokeColor;
      ctx.lineWidth = props.strokeWidth * 2; // Double for visual match (stroke is centered)
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeText(text, x, y);
    }

    // Draw fill
    ctx.fillStyle = props.color;
    ctx.fillText(text, x, y);
  }

  /**
   * Render line with custom letter spacing (character by character)
   */
  private renderLineWithLetterSpacing(
    ctx: CanvasRenderingContext2D,
    text: string,
    baseX: number,
    y: number,
    props: TextClipProperties
  ): void {
    const chars = text.split('');
    const charWidths = chars.map(c => ctx.measureText(c).width);
    const totalWidth = charWidths.reduce((sum, w) => sum + w, 0) + (chars.length - 1) * props.letterSpacing;

    // Calculate starting X based on alignment
    let currentX: number;
    switch (props.textAlign) {
      case 'left':
        currentX = baseX;
        break;
      case 'right':
        currentX = baseX - totalWidth;
        break;
      default: // center
        currentX = baseX - totalWidth / 2;
    }

    // Save alignment and set to left for character rendering
    const originalAlign = ctx.textAlign;
    ctx.textAlign = 'left';

    for (let i = 0; i < chars.length; i++) {
      this.renderLine(ctx, chars[i], currentX, y, props);
      currentX += charWidths[i] + props.letterSpacing;
    }

    // Restore alignment
    ctx.textAlign = originalAlign;
  }

  /**
   * Render text along a bezier path
   */
  private renderTextOnPath(ctx: CanvasRenderingContext2D, props: TextClipProperties): void {
    if (props.pathPoints.length < 2) return;

    const text = props.text.replace(/\n/g, ' ');
    const chars = text.split('');

    // Build path and calculate total length
    const pathSegments = this.buildPathSegments(props.pathPoints);
    const totalLength = pathSegments.reduce((sum, seg) => sum + seg.length, 0);

    // Calculate total text width
    const charWidths = chars.map(c => ctx.measureText(c).width + props.letterSpacing);
    const totalTextWidth = charWidths.reduce((sum, w) => sum + w, 0) - props.letterSpacing;

    // Calculate starting position based on alignment
    let startOffset: number;
    switch (props.textAlign) {
      case 'left':
        startOffset = 0;
        break;
      case 'right':
        startOffset = totalLength - totalTextWidth;
        break;
      default: // center
        startOffset = (totalLength - totalTextWidth) / 2;
    }

    let currentOffset = startOffset;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const charWidth = charWidths[i];
      const charCenter = currentOffset + charWidth / 2 - props.letterSpacing / 2;

      // Get position and angle on path
      const { point, angle } = this.getPointOnPath(pathSegments, charCenter, totalLength);

      // Draw character rotated along path
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(angle);

      // Temporarily switch to center alignment for rotation
      const originalAlign = ctx.textAlign;
      ctx.textAlign = 'center';
      this.renderLine(ctx, char, 0, 0, props);
      ctx.textAlign = originalAlign;

      ctx.restore();

      currentOffset += charWidth;
    }
  }

  /**
   * Build path segments from bezier control points
   */
  private buildPathSegments(points: TextClipProperties['pathPoints']): { start: { x: number; y: number }; end: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; length: number }[] {
    const segments: { start: { x: number; y: number }; end: { x: number; y: number }; cp1: { x: number; y: number }; cp2: { x: number; y: number }; length: number }[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      // Scale points to canvas coordinates
      const start = { x: p0.x * this.width, y: p0.y * this.height };
      const end = { x: p1.x * this.width, y: p1.y * this.height };
      const cp1 = {
        x: start.x + p0.handleOut.x * this.width,
        y: start.y + p0.handleOut.y * this.height,
      };
      const cp2 = {
        x: end.x + p1.handleIn.x * this.width,
        y: end.y + p1.handleIn.y * this.height,
      };

      // Approximate length using sampling
      const length = this.approximateBezierLength(start, cp1, cp2, end);

      segments.push({ start, end, cp1, cp2, length });
    }

    return segments;
  }

  /**
   * Approximate cubic bezier curve length
   */
  private approximateBezierLength(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    samples: number = 100
  ): number {
    let length = 0;
    let prevPoint = p0;

    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const point = this.cubicBezier(p0, p1, p2, p3, t);
      const dx = point.x - prevPoint.x;
      const dy = point.y - prevPoint.y;
      length += Math.sqrt(dx * dx + dy * dy);
      prevPoint = point;
    }

    return length;
  }

  /**
   * Calculate point on cubic bezier curve
   */
  private cubicBezier(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    t: number
  ): { x: number; y: number } {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    return {
      x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
      y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    };
  }

  /**
   * Get point and tangent angle at a specific offset along the path
   */
  private getPointOnPath(
    segments: ReturnType<typeof this.buildPathSegments>,
    offset: number,
    _totalLength: number
  ): { point: { x: number; y: number }; angle: number } {
    let accumulatedLength = 0;

    for (const seg of segments) {
      if (offset <= accumulatedLength + seg.length) {
        const localOffset = offset - accumulatedLength;
        const t = localOffset / seg.length;

        const point = this.cubicBezier(seg.start, seg.cp1, seg.cp2, seg.end, t);

        // Calculate tangent (derivative) for angle
        const dt = 0.001;
        const t1 = Math.max(0, t - dt);
        const t2 = Math.min(1, t + dt);
        const p1 = this.cubicBezier(seg.start, seg.cp1, seg.cp2, seg.end, t1);
        const p2 = this.cubicBezier(seg.start, seg.cp1, seg.cp2, seg.end, t2);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        return { point, angle };
      }
      accumulatedLength += seg.length;
    }

    // Default to end of last segment
    const lastSeg = segments[segments.length - 1];
    return { point: lastSeg.end, angle: 0 };
  }

  /**
   * Set canvas resolution
   */
  setResolution(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Get current canvas dimensions
   */
  getResolution(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Create a new canvas with specific dimensions (for per-clip rendering)
   */
  createCanvas(width: number = 1920, height: number = 1080): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}

export const textRenderer = new TextRenderer();
