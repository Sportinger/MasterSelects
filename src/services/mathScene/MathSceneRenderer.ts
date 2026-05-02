import type {
  EasingType,
  MathFunctionObject,
  MathObject,
  MathParameter,
  MathSceneDefinition,
  TimelineClip,
} from '../../types';
import { Logger } from '../logger';
import { compileExpression, type CompiledExpression } from './expressionEvaluator';

const log = Logger.create('MathSceneRenderer');

type Point = { x: number; y: number };

const DEFAULT_CANVAS_WIDTH = 1920;
const DEFAULT_CANVAS_HEIGHT = 1080;
const DISCONTINUITY_PX = 260;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number, easing: EasingType): number {
  const t = clamp01(value);
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'bezier':
    case 'linear':
    default:
      return t;
  }
}

export class MathSceneRenderer {
  private expressionCache = new Map<string, CompiledExpression>();

  createCanvas(width = DEFAULT_CANVAS_WIDTH, height = DEFAULT_CANVAS_HEIGHT): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  renderClip(clip: TimelineClip, clipLocalTime: number): void {
    if (clip.source?.type !== 'math-scene' || !clip.source.textCanvas || !clip.mathScene) {
      return;
    }

    this.render(clip.mathScene, clip.source.textCanvas, clipLocalTime, clip.duration);
  }

  render(scene: MathSceneDefinition, canvas: HTMLCanvasElement, timeSeconds: number, durationSeconds: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width || DEFAULT_CANVAS_WIDTH;
    const height = canvas.height || DEFAULT_CANVAS_HEIGHT;
    const viewport = scene.viewport;
    const vars = this.resolveVariables(scene.parameters, timeSeconds, durationSeconds);

    const toCanvas = (point: Point): Point => ({
      x: ((point.x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width,
      y: height - ((point.y - viewport.yMin) / (viewport.yMax - viewport.yMin)) * height,
    });

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = scene.style.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (viewport.showGrid) {
      this.drawGrid(ctx, scene, toCanvas);
    }
    if (viewport.showAxes) {
      this.drawAxes(ctx, scene, toCanvas);
    }

    const functionObjects = scene.objects.filter((object): object is MathFunctionObject => object.type === 'function');
    const functionById = new Map(functionObjects.map((object) => [object.id, object]));

    for (const object of scene.objects) {
      if (!object.visible || object.opacity <= 0) continue;

      try {
        if (object.type === 'function') {
          this.drawFunction(ctx, scene, object, vars, toCanvas, timeSeconds);
        } else if (object.type === 'point') {
          this.drawPoint(ctx, object, vars, toCanvas);
        } else if (object.type === 'tangent') {
          const fn = functionById.get(object.functionId);
          if (fn) {
            this.drawTangent(ctx, object, fn, vars, toCanvas);
          }
        } else if (object.type === 'label') {
          this.drawLabel(ctx, object, vars, toCanvas);
        }
      } catch (error) {
        log.debug('Skipping math object render after evaluation error', { objectId: object.id, error });
      }
    }

    ctx.restore();
  }

  private resolveVariables(parameters: MathParameter[], timeSeconds: number, durationSeconds: number): Record<string, number> {
    const vars: Record<string, number> = {
      t: timeSeconds,
      duration: durationSeconds,
    };

    for (const parameter of parameters) {
      const animation = parameter.animation;
      if (animation?.enabled) {
        const denominator = Math.max(0.0001, animation.endTime - animation.startTime);
        const progress = ease((timeSeconds - animation.startTime) / denominator, animation.easing);
        vars[parameter.name.toLowerCase()] = animation.from + (animation.to - animation.from) * progress;
      } else {
        vars[parameter.name.toLowerCase()] = parameter.value;
      }
    }

    return vars;
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    scene: MathSceneDefinition,
    toCanvas: (point: Point) => Point,
  ): void {
    const { viewport, style } = scene;
    ctx.save();
    ctx.strokeStyle = style.gridColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;

    const xStart = Math.ceil(viewport.xMin);
    const xEnd = Math.floor(viewport.xMax);
    for (let x = xStart; x <= xEnd; x++) {
      const a = toCanvas({ x, y: viewport.yMin });
      const b = toCanvas({ x, y: viewport.yMax });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const yStart = Math.ceil(viewport.yMin);
    const yEnd = Math.floor(viewport.yMax);
    for (let y = yStart; y <= yEnd; y++) {
      const a = toCanvas({ x: viewport.xMin, y });
      const b = toCanvas({ x: viewport.xMax, y });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawAxes(
    ctx: CanvasRenderingContext2D,
    scene: MathSceneDefinition,
    toCanvas: (point: Point) => Point,
  ): void {
    const { viewport, style } = scene;
    ctx.save();
    ctx.strokeStyle = style.axisColor;
    ctx.lineWidth = 2;

    if (viewport.yMin <= 0 && viewport.yMax >= 0) {
      const a = toCanvas({ x: viewport.xMin, y: 0 });
      const b = toCanvas({ x: viewport.xMax, y: 0 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    if (viewport.xMin <= 0 && viewport.xMax >= 0) {
      const a = toCanvas({ x: 0, y: viewport.yMin });
      const b = toCanvas({ x: 0, y: viewport.yMax });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawFunction(
    ctx: CanvasRenderingContext2D,
    scene: MathSceneDefinition,
    object: MathFunctionObject,
    vars: Record<string, number>,
    toCanvas: (point: Point) => Point,
    timeSeconds: number,
  ): void {
    const compiled = this.getExpression(object.expression);
    const domain = object.domain ?? [scene.viewport.xMin, scene.viewport.xMax];
    const samples = Math.max(8, Math.min(4096, Math.round(object.samples || 360)));
    const reveal = object.animation?.reveal;
    const revealProgress = reveal?.enabled
      ? clamp01((timeSeconds - reveal.startTime) / Math.max(0.0001, reveal.endTime - reveal.startTime))
      : 1;
    const sampleEnd = Math.max(1, Math.floor(samples * revealProgress));
    const segments: Point[][] = [];
    let current: Point[] = [];
    let lastCanvas: Point | null = null;

    for (let i = 0; i <= sampleEnd; i++) {
      const x = domain[0] + ((domain[1] - domain[0]) * i) / samples;
      const y = compiled.evaluate({ ...vars, x });
      if (!Number.isFinite(y)) {
        if (current.length > 1) segments.push(current);
        current = [];
        lastCanvas = null;
        continue;
      }

      const canvasPoint = toCanvas({ x, y });
      if (
        lastCanvas &&
        Math.abs(canvasPoint.y - lastCanvas.y) > DISCONTINUITY_PX &&
        Math.abs(canvasPoint.x - lastCanvas.x) < DISCONTINUITY_PX
      ) {
        if (current.length > 1) segments.push(current);
        current = [];
      }

      current.push(canvasPoint);
      lastCanvas = canvasPoint;
    }

    if (current.length > 1) segments.push(current);

    ctx.save();
    ctx.globalAlpha = object.opacity;
    ctx.strokeStyle = object.stroke;
    ctx.lineWidth = object.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(segment[0].x, segment[0].y);
      for (let i = 1; i < segment.length; i++) {
        ctx.lineTo(segment[i].x, segment[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPoint(
    ctx: CanvasRenderingContext2D,
    object: Extract<MathObject, { type: 'point' }>,
    vars: Record<string, number>,
    toCanvas: (point: Point) => Point,
  ): void {
    const x = this.getExpression(object.xExpression).evaluate(vars);
    const y = this.getExpression(object.yExpression).evaluate(vars);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = toCanvas({ x, y });

    ctx.save();
    ctx.globalAlpha = object.opacity;
    ctx.fillStyle = object.fill;
    ctx.strokeStyle = object.stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, object.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (object.labelVisible) {
      ctx.fillStyle = object.stroke;
      ctx.font = '600 32px system-ui, sans-serif';
      ctx.fillText(object.name, point.x + object.radius + 8, point.y - object.radius - 8);
    }
    ctx.restore();
  }

  private drawTangent(
    ctx: CanvasRenderingContext2D,
    object: Extract<MathObject, { type: 'tangent' }>,
    fn: MathFunctionObject,
    vars: Record<string, number>,
    toCanvas: (point: Point) => Point,
  ): void {
    const compiled = this.getExpression(fn.expression);
    const x = this.getExpression(object.atExpression).evaluate(vars);
    const delta = 0.0005;
    const y = compiled.evaluate({ ...vars, x });
    const y1 = compiled.evaluate({ ...vars, x: x - delta });
    const y2 = compiled.evaluate({ ...vars, x: x + delta });
    const slope = (y2 - y1) / (delta * 2);
    if (![x, y, slope].every(Number.isFinite)) return;

    const half = object.length / 2;
    const aX = x - half;
    const bX = x + half;
    const a = toCanvas({ x: aX, y: y + slope * (aX - x) });
    const b = toCanvas({ x: bX, y: y + slope * (bX - x) });

    ctx.save();
    ctx.globalAlpha = object.opacity;
    ctx.strokeStyle = object.stroke;
    ctx.lineWidth = object.strokeWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    object: Extract<MathObject, { type: 'label' }>,
    vars: Record<string, number>,
    toCanvas: (point: Point) => Point,
  ): void {
    const x = this.getExpression(object.xExpression).evaluate(vars);
    const y = this.getExpression(object.yExpression).evaluate(vars);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = toCanvas({ x, y });

    ctx.save();
    ctx.globalAlpha = object.opacity;
    ctx.fillStyle = object.color;
    ctx.font = `600 ${object.fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(object.text, point.x, point.y);
    ctx.restore();
  }

  private getExpression(expression: string): CompiledExpression {
    let compiled = this.expressionCache.get(expression);
    if (!compiled) {
      compiled = compileExpression(expression);
      this.expressionCache.set(expression, compiled);
    }
    return compiled;
  }
}

export const mathSceneRenderer = new MathSceneRenderer();
