import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAccountStore } from '../../../stores/accountStore';
import { AIStudioGenerationCanvas } from './AIStudioGenerationCanvas';
import { AIStudioGenerationBar } from './AIStudioGenerationBar';

const ISLAND_COUNT = 2;
const EDGE_PADDING = 18;
const EDGE_DOCK_DISTANCE = 48;
const DOCK_DISTANCE = 54;
const DOCK_GAP = 12;
const DEFAULT_TILE_SIZE = 260;
const MIN_TILE_SIZE = 150;
const MAX_TILE_SIZE = 460;

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 uResolution;
uniform vec4 uRect[2];
uniform float uRadius[2];
uniform float uTone[2];
uniform float uBlend;
uniform vec3 uSolidColor;
uniform vec3 uGlassColor;
uniform vec3 uBorderColor;
uniform vec3 uAccentColor;

float roundedBox(vec2 point, vec2 bounds, float radius) {
  vec2 offset = abs(point) - bounds + radius;
  return length(max(offset, 0.0)) + min(max(offset.x, offset.y), 0.0) - radius;
}

float smoothMinimum(float left, float right, float blend) {
  float amount = clamp(0.5 + 0.5 * (right - left) / blend, 0.0, 1.0);
  return mix(right, left, amount) - blend * amount * (1.0 - amount);
}

void main() {
  vec2 point = gl_FragCoord.xy;
  float distance = 1000000.0;
  float nearestDistance = 1000000.0;
  float tone = 0.0;

  for (int index = 0; index < 2; index++) {
    float islandDistance = roundedBox(
      point - uRect[index].xy,
      uRect[index].zw,
      uRadius[index]
    );
    if (islandDistance < nearestDistance) {
      nearestDistance = islandDistance;
      tone = uTone[index];
    }
    distance = smoothMinimum(distance, islandDistance, uBlend);
  }

  float fill = smoothstep(0.8, -0.8, distance);
  float border = smoothstep(1.8, 0.2, abs(distance)) * 0.82;
  float shadow = distance > 0.0 ? 0.3 * exp(-distance / 24.0) : 0.0;
  vec3 borderColor = mix(uBorderColor, uAccentColor, tone * 0.72);
  vec3 panelColor = mix(uSolidColor, uGlassColor, tone);
  float panelAlpha = mix(0.92, 0.42, tone);
  float shapeAlpha = max(fill * panelAlpha, border);
  float alpha = shapeAlpha + shadow * (1.0 - shapeAlpha);
  vec3 rgb = panelColor * fill * panelAlpha * (1.0 - border) + borderColor * border;
  gl_FragColor = vec4(rgb, alpha);
}
`;

type IslandId = 'credits' | 'controls';
type DockEdge = 'left' | 'right' | 'top' | 'bottom';

interface IslandMotion {
  id: IslandId;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
  scale: number;
  targetScale: number;
  scaleVelocity: number;
  width: number;
  height: number;
  tone: number;
  dragging: boolean;
  hasBeenDragged: boolean;
  dockedEdge: DockEdge | null;
  pointerId: number | null;
  pointerOffsetX: number;
  pointerOffsetY: number;
}

interface StageBounds {
  width: number;
  height: number;
}

interface ThemePalette {
  accent: Float32Array;
  border: Float32Array;
  glass: Float32Array;
  solid: Float32Array;
}

const ISLAND_DEFINITIONS: Array<{ id: IslandId; tone: number }> = [
  { id: 'credits', tone: 0 },
  { id: 'controls', tone: 0 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function readThemeColor(
  stage: HTMLElement,
  variableName: string,
  fallback: [number, number, number],
): Float32Array {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.color = `var(${variableName})`;
  stage.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  const channels = match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : fallback;
  return new Float32Array(channels.map((channel) => clamp(channel / 255, 0, 1)));
}

function readThemePalette(stage: HTMLElement): ThemePalette {
  return {
    solid: readThemeColor(stage, '--bg-elevated', [38, 38, 40]),
    glass: readThemeColor(stage, '--bg-secondary', [25, 25, 27]),
    border: readThemeColor(stage, '--border-color', [57, 57, 61]),
    accent: readThemeColor(stage, '--accent', [61, 157, 245]),
  };
}

function createIslandMotions(): IslandMotion[] {
  return ISLAND_DEFINITIONS.map(({ id, tone }) => ({
    id,
    tone,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    velocityX: 0,
    velocityY: 0,
    scale: 1,
    targetScale: 1,
    scaleVelocity: 0,
    width: 1,
    height: 1,
    dragging: false,
    hasBeenDragged: false,
    dockedEdge: null,
    pointerId: null,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
  }));
}

function islandGap(left: IslandMotion, right: IslandMotion): number {
  const horizontal = Math.max(
    Math.abs((left.x + left.width / 2) - (right.x + right.width / 2))
      - (left.width + right.width) / 2,
    0,
  );
  const vertical = Math.max(
    Math.abs((left.y + left.height / 2) - (right.y + right.height / 2))
      - (left.height + right.height) / 2,
    0,
  );
  return Math.hypot(horizontal, vertical);
}

function clampIslandTarget(island: IslandMotion, bounds: StageBounds): void {
  island.targetX = clamp(
    island.targetX,
    0,
    Math.max(0, bounds.width - island.width),
  );
  island.targetY = clamp(
    island.targetY,
    0,
    Math.max(0, bounds.height - island.height),
  );
}

function dockIslandToEdge(island: IslandMotion, edge: DockEdge, bounds: StageBounds): void {
  island.dockedEdge = edge;
  if (edge === 'left') island.targetX = 0;
  if (edge === 'right') island.targetX = bounds.width - island.width;
  if (edge === 'top') island.targetY = 0;
  if (edge === 'bottom') island.targetY = bounds.height - island.height;
  clampIslandTarget(island, bounds);
}

function snapIsland(index: number, islands: IslandMotion[], bounds: StageBounds): void {
  const island = islands[index];
  const edgeDistances: Array<{ edge: DockEdge; distance: number }> = [
    { edge: 'left', distance: island.targetX },
    { edge: 'right', distance: bounds.width - island.targetX - island.width },
    { edge: 'top', distance: island.targetY },
    { edge: 'bottom', distance: bounds.height - island.targetY - island.height },
  ];
  const nearestEdge = edgeDistances.toSorted((left, right) => left.distance - right.distance)[0];
  if (nearestEdge && nearestEdge.distance <= EDGE_DOCK_DISTANCE) {
    dockIslandToEdge(island, nearestEdge.edge, bounds);
    return;
  }

  let closest: IslandMotion | null = null;
  let closestGap = DOCK_DISTANCE;

  islands.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    const gap = islandGap(island, candidate);
    if (gap < closestGap) {
      closest = candidate;
      closestGap = gap;
    }
  });

  if (!closest) {
    island.dockedEdge = null;
    clampIslandTarget(island, bounds);
    return;
  }

  const target = closest as IslandMotion;
  island.dockedEdge = null;
  const deltaX = (island.x + island.width / 2) - (target.x + target.width / 2);
  const deltaY = (island.y + island.height / 2) - (target.y + target.height / 2);

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    island.targetX = deltaX < 0
      ? target.x - island.width - DOCK_GAP
      : target.x + target.width + DOCK_GAP;
    island.targetY = target.y + (target.height - island.height) / 2;
  } else {
    island.targetX = target.x + (target.width - island.width) / 2;
    island.targetY = deltaY < 0
      ? target.y - island.height - DOCK_GAP
      : target.y + target.height + DOCK_GAP;
  }

  clampIslandTarget(island, bounds);
}

function placeIslandAtAnchor(island: IslandMotion, bounds: StageBounds): void {
  switch (island.id) {
    case 'credits':
      island.targetX = bounds.width - island.width - EDGE_PADDING;
      island.targetY = EDGE_PADDING;
      break;
    case 'controls':
      island.targetX = 0;
      island.targetY = bounds.height - island.height;
      island.dockedEdge = 'bottom';
      break;
  }
  if (island.id !== 'controls') island.dockedEdge = null;
  clampIslandTarget(island, bounds);
}

function placeInitialIslands(islands: IslandMotion[], bounds: StageBounds): void {
  islands.forEach((island) => {
    placeIslandAtAnchor(island, bounds);
    island.x = island.targetX;
    island.y = island.targetY;
  });
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

interface AIStudioMetaballStageProps {
  content?: ReactNode;
  controls?: ReactNode;
  showTileScale?: boolean;
}

export function AIStudioMetaballStage({
  content,
  controls,
  showTileScale = true,
}: AIStudioMetaballStageProps = {}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const islandElementsRef = useRef<Array<HTMLDivElement | null>>([]);
  const islandsRef = useRef<IslandMotion[]>(createIslandMotions());
  const boundsRef = useRef<StageBounds>({ width: 1, height: 1 });
  const initializedRef = useRef(false);
  const zIndexRef = useRef(10);
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );
  const creditBalance = useAccountStore((state) => state.creditBalance);
  const formattedCredits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(creditBalance);
  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    const vertexShader = gl ? compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER) : null;
    const fragmentShader = gl ? compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER) : null;
    const program = gl && vertexShader && fragmentShader ? gl.createProgram() : null;
    const buffer = gl && program ? gl.createBuffer() : null;

    if (gl && program && buffer && vertexShader && fragmentShader) {
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    const uniforms = gl && program ? {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      rect: gl.getUniformLocation(program, 'uRect'),
      radius: gl.getUniformLocation(program, 'uRadius'),
      tone: gl.getUniformLocation(program, 'uTone'),
      blend: gl.getUniformLocation(program, 'uBlend'),
      solidColor: gl.getUniformLocation(program, 'uSolidColor'),
      glassColor: gl.getUniformLocation(program, 'uGlassColor'),
      borderColor: gl.getUniformLocation(program, 'uBorderColor'),
      accentColor: gl.getUniformLocation(program, 'uAccentColor'),
    } : null;
    const rectValues = new Float32Array(ISLAND_COUNT * 4);
    const radiusValues = new Float32Array(ISLAND_COUNT);
    const toneValues = new Float32Array(ISLAND_COUNT);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    let themePalette = readThemePalette(stage);
    const themeObserver = new MutationObserver(() => {
      themePalette = readThemePalette(stage);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const bounds = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      boundsRef.current = bounds;
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);

      islandsRef.current.forEach((island, index) => {
        const element = islandElementsRef.current[index];
        island.width = element?.offsetWidth ?? island.width;
        island.height = element?.offsetHeight ?? island.height;
      });
      if (!initializedRef.current) {
        placeInitialIslands(islandsRef.current, bounds);
        initializedRef.current = true;
        stage.classList.add('is-ready');
      } else {
        islandsRef.current.forEach((island) => {
          if (island.hasBeenDragged && island.dockedEdge) {
            dockIslandToEdge(island, island.dockedEdge, bounds);
          } else if (island.hasBeenDragged) clampIslandTarget(island, bounds);
          else placeIslandAtAnchor(island, bounds);
        });
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    let animationFrame = 0;
    let previousTime = performance.now();
    const render = (time: number) => {
      const deltaTime = clamp((time - previousTime) / 1000, 0, 0.033);
      previousTime = time;
      const bounds = boundsRef.current;

      islandsRef.current.forEach((island, index) => {
        const element = islandElementsRef.current[index];
        if (element) {
          island.width = element.offsetWidth;
          island.height = element.offsetHeight;
        }
        clampIslandTarget(island, bounds);

        if (reducedMotion) {
          island.x = island.targetX;
          island.y = island.targetY;
          island.scale = 1;
        } else {
          island.velocityX += (-260 * (island.x - island.targetX) - 25 * island.velocityX) * deltaTime;
          island.velocityY += (-260 * (island.y - island.targetY) - 25 * island.velocityY) * deltaTime;
          island.x += island.velocityX * deltaTime;
          island.y += island.velocityY * deltaTime;
          island.scaleVelocity += (-330 * (island.scale - island.targetScale) - 25 * island.scaleVelocity) * deltaTime;
          island.scale += island.scaleVelocity * deltaTime;
        }

        if (element) {
          element.style.transform = `translate3d(${island.x}px, ${island.y}px, 0) scale(${island.scale})`;
          if (island.dockedEdge) element.dataset.dockedEdge = island.dockedEdge;
          else delete element.dataset.dockedEdge;
        }
        rectValues[index * 4] = (island.x + island.width / 2) * pixelRatio;
        rectValues[index * 4 + 1] = (bounds.height - (island.y + island.height / 2)) * pixelRatio;
        rectValues[index * 4 + 2] = (island.width / 2) * island.scale * pixelRatio;
        rectValues[index * 4 + 3] = (island.height / 2) * island.scale * pixelRatio;
        radiusValues[index] = 17 * pixelRatio;
        toneValues[index] = island.tone;
      });

      if (gl && program && uniforms && gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform4fv(uniforms.rect, rectValues);
        gl.uniform1fv(uniforms.radius, radiusValues);
        gl.uniform1fv(uniforms.tone, toneValues);
        gl.uniform1f(uniforms.blend, 34 * pixelRatio);
        gl.uniform3fv(uniforms.solidColor, themePalette.solid);
        gl.uniform3fv(uniforms.glassColor, themePalette.glass);
        gl.uniform3fv(uniforms.borderColor, themePalette.border);
        gl.uniform3fv(uniforms.accentColor, themePalette.accent);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      animationFrame = window.requestAnimationFrame(render);
    };
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      themeObserver.disconnect();
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertexShader) gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
      }
    };
  }, [reducedMotion]);

  const handlePointerDown = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-ai-studio-control]')) return;
    const stage = stageRef.current;
    const island = islandsRef.current[index];
    if (!stage || !island) return;
    const stageRect = stage.getBoundingClientRect();
    island.dragging = true;
    island.hasBeenDragged = true;
    island.dockedEdge = null;
    island.pointerId = event.pointerId;
    island.targetScale = 1.025;
    island.pointerOffsetX = event.clientX - stageRect.left - island.x;
    island.pointerOffsetY = event.clientY - stageRect.top - island.y;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.zIndex = String(++zIndexRef.current);
    event.currentTarget.classList.add('dragging');
  };

  const handlePointerMove = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const island = islandsRef.current[index];
    if (!stage || !island?.dragging || island.pointerId !== event.pointerId) return;
    const stageRect = stage.getBoundingClientRect();
    island.targetX = event.clientX - stageRect.left - island.pointerOffsetX;
    island.targetY = event.clientY - stageRect.top - island.pointerOffsetY;
    clampIslandTarget(island, boundsRef.current);
  };

  const handlePointerUp = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const island = islandsRef.current[index];
    if (!island?.dragging || island.pointerId !== event.pointerId) return;
    island.dragging = false;
    island.pointerId = null;
    island.targetScale = 1;
    island.targetX = island.x + island.velocityX * 0.07;
    island.targetY = island.y + island.velocityY * 0.07;
    snapIsland(index, islandsRef.current, boundsRef.current);
    event.currentTarget.classList.remove('dragging');
  };

  const renderIslandContent = (id: IslandId) => {
    if (id === 'credits') {
      return (
        <>
          {showTileScale && (
            <>
              <label className="ai-studio-tile-scale" data-ai-studio-control title={`Tile size: ${tileSize}px`}>
                <span className="ai-studio-tile-scale-glyph small" aria-hidden="true" />
                <input
                  aria-label="Tile size"
                  max={MAX_TILE_SIZE}
                  min={MIN_TILE_SIZE}
                  onChange={(event) => setTileSize(Number(event.currentTarget.value))}
                  type="range"
                  value={tileSize}
                />
                <span className="ai-studio-tile-scale-glyph large" aria-hidden="true" />
              </label>
              <span className="ai-studio-credit-divider" aria-hidden="true" />
            </>
          )}
          <div className="ai-studio-credit-summary">
            <span className="ai-studio-credit-gem" aria-hidden="true">◆</span>
            <strong>{formattedCredits}</strong>
            <span>credits</span>
          </div>
        </>
      );
    }
    return controls ?? <AIStudioGenerationBar />;
  };

  return (
    <div className="ai-studio-stage" ref={stageRef}>
      <canvas className="ai-studio-metaball-canvas" ref={canvasRef} aria-hidden="true" />
      {content ?? <AIStudioGenerationCanvas tileSize={tileSize} />}
      {ISLAND_DEFINITIONS.map((definition, index) => (
        <div
          className={`ai-studio-island ai-studio-island-${definition.id} ${definition.id === 'credits' && !showTileScale ? 'is-compact' : ''}`}
          key={definition.id}
          onPointerCancel={handlePointerUp(index)}
          onPointerDown={handlePointerDown(index)}
          onPointerMove={handlePointerMove(index)}
          onPointerUp={handlePointerUp(index)}
          ref={(element) => {
            islandElementsRef.current[index] = element;
          }}
        >
          {renderIslandContent(definition.id)}
        </div>
      ))}
    </div>
  );
}
