// Fullscreen WebGL metaball renderer for the dock drag overlay.
//
// One canvas + context pair is created lazily on the first drag and reused
// for the rest of the session (iOS Safari caps live WebGL contexts, so
// per-drag create/destroy would thrash the cap). The pair survives HMR via
// import.meta.hot.data. While no drag runs, the canvas is detached from the
// DOM and nothing renders.

export interface GooBlob {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  radius: number;
  /**
   * Velocity squash/stretch in CSS space: the blob is scaled by `along` in
   * direction (dirX, dirY) and by `perp` sideways. Omit for no deformation.
   */
  stretch?: { dirX: number; dirY: number; along: number; perp: number };
}

export interface GooTheme {
  fill: [number, number, number];
  border: [number, number, number];
  mergeBorder: [number, number, number];
}

export interface GooFrame {
  blobs: GooBlob[];
  mergeRadius: number;
  mergeTint: number;
  alpha: number;
  theme: GooTheme;
  /**
   * 'flat' (default) is the opaque dock drag chip; 'droplet' is the glassy
   * convex touch-feedback look (falls back to flat without derivatives).
   */
  style?: 'flat' | 'droplet';
  /** Dome shading falloff in CSS px for the droplet style. */
  shadeRadius?: number;
}

export interface GooRenderer {
  canvas: HTMLCanvasElement;
  resize: () => void;
  render: (frame: GooFrame) => void;
}

// 10 touch pointers plus the dock drag pair.
export const MAX_GOO_BLOBS = 12;

// Bump when the shader or instance layout changes: an instance parked across
// HMR with the old program must be discarded, not reused with new uniforms.
const GOO_RENDERER_VERSION = 2;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// highp where available: distances are in physical pixels and overflow
// mediump (fp16 on mobile GPUs) on large screens.
// The `#extension`/HAS_DERIVS prefix is prepended in createInstance when
// OES_standard_derivatives is available (droplet shading needs it).
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec4 uRect[${MAX_GOO_BLOBS}];
uniform float uRad[${MAX_GOO_BLOBS}];
uniform vec4 uStretch[${MAX_GOO_BLOBS}];
uniform float uCount;
uniform float uK;
uniform float uMerge;
uniform float uAlpha;
uniform float uStyle;
uniform float uShadeRadius;
uniform vec3 uFill;
uniform vec3 uBorder;
uniform vec3 uMergeBorder;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  float d = 20000.0;
  for (int i = 0; i < ${MAX_GOO_BLOBS}; i++) {
    if (float(i) >= uCount) break;
    vec4 s = uStretch[i];
    vec2 q = p - uRect[i].xy;
    q = vec2(dot(q, s.xy), dot(q, vec2(-s.y, s.x)));
    q = vec2(q.x / s.z, q.y / s.w);
    float di = sdRoundBox(q, uRect[i].zw, uRad[i]) * min(s.z, s.w);
    if (uK > 0.5) { d = smin(d, di, uK); } else { d = min(d, di); }
  }

  if (uStyle < 0.5) {
    float fill = smoothstep(0.75, -0.75, d) * 0.72;
    float border = smoothstep(1.8, 0.2, abs(d)) * 0.9;
    float shadow = d > 0.0 ? 0.26 * exp(-d / 28.0) : 0.0;
    vec3 borderC = mix(uBorder, uMergeBorder, uMerge * 0.8);
    float aShape = max(fill, border);
    float alpha = (aShape + shadow * (1.0 - aShape)) * uAlpha;
    vec3 rgb = (uFill * fill * (1.0 - border) + borderC * border) * uAlpha;
    gl_FragColor = vec4(rgb, alpha);
    return;
  }

  // Droplet: a glassy convex bump. The dome height comes from the merged
  // SDF, the surface normal from its screen-space gradient, lit from the
  // top-left with a caustic rim on the far side.
  float fill = smoothstep(0.75, -0.75, d);
  float t = clamp(-d / uShadeRadius, 0.0, 1.0);
  float u = 1.0 - t;
  vec3 n = vec3(0.0, 0.0, 1.0);
  float away = 0.5;
#ifdef HAS_DERIVS
  vec2 g = vec2(dFdx(d), dFdy(d));
  vec2 gn = g / max(length(g), 1e-4);
  float slope = min(u / sqrt(max(1.0 - u * u, 0.06)), 2.6);
  n = normalize(vec3(gn * slope, 1.0));
  away = 0.5 + 0.5 * dot(gn, normalize(vec2(0.42, -0.62)));
#endif
  vec3 L = normalize(vec3(-0.42, 0.62, 0.66));
  float diffuse = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 48.0);
  float rim = smoothstep(2.4, 0.2, abs(d));
  float edgeGather = fill * pow(u, 3.0);
  float interior = fill * 0.06;
  float shadow = d > 0.0 ? 0.10 * exp(-d / 16.0) : 0.0;

  vec3 tint = mix(uFill, uBorder, 0.45);
  float aShape = interior + edgeGather * 0.22 + rim * (0.28 + 0.34 * away) + spec * 0.55;
  float alpha = clamp(aShape + shadow * (1.0 - aShape), 0.0, 1.0) * uAlpha;
  vec3 rgb = (tint * (interior + edgeGather * 0.20)
    + uBorder * rim * (0.24 + 0.34 * away)
    + vec3(1.0) * spec * 0.55
    + tint * diffuse * fill * 0.05) * uAlpha;
  gl_FragColor = vec4(rgb, alpha);
}
`;

const FALLBACK_FILL: [number, number, number] = [0.13, 0.13, 0.15];
const FALLBACK_BORDER: [number, number, number] = [45 / 255, 140 / 255, 235 / 255];

const lighten = (
  color: [number, number, number],
  amount: number,
): [number, number, number] => [
  color[0] + (1 - color[0]) * amount,
  color[1] + (1 - color[1]) * amount,
  color[2] + (1 - color[2]) * amount,
];

const parseCssColor = (raw: string): [number, number, number] | null => {
  const value = raw.trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const rgbMatch = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  }
  return null;
};

export const readGooTheme = (): GooTheme => {
  const style = getComputedStyle(document.documentElement);
  const border = parseCssColor(style.getPropertyValue('--accent')) ?? FALLBACK_BORDER;
  return {
    fill: parseCssColor(style.getPropertyValue('--bg-tertiary')) ?? FALLBACK_FILL,
    border,
    // Latching onto a zone brightens the blue outline instead of shifting hue.
    mergeBorder: lighten(border, 0.45),
  };
};

interface GooRendererInstance {
  version: number;
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  hasDerivatives: boolean;
  locations: {
    rect: WebGLUniformLocation | null;
    rad: WebGLUniformLocation | null;
    stretch: WebGLUniformLocation | null;
    count: WebGLUniformLocation | null;
    k: WebGLUniformLocation | null;
    merge: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    style: WebGLUniformLocation | null;
    shadeRadius: WebGLUniformLocation | null;
    fill: WebGLUniformLocation | null;
    border: WebGLUniformLocation | null;
    mergeBorder: WebGLUniformLocation | null;
  };
  dpr: number;
  rectArray: Float32Array;
  radArray: Float32Array;
  stretchArray: Float32Array;
}

let instance: GooRendererInstance | null = null;
let creationFailed = false;

if (import.meta.hot) {
  const parked = import.meta.hot.data.gooRenderer as GooRendererInstance | undefined;
  if (parked && parked.version === GOO_RENDERER_VERSION) {
    instance = parked;
  } else if (parked) {
    // Shader/layout changed under HMR: the parked program lacks the new
    // uniforms, so drop it and let the next drag build a fresh one.
    parked.canvas.remove();
  }
  import.meta.hot.dispose((data) => {
    data.gooRenderer = instance;
  });
}

const compileShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return null;
  }
  return shader;
};

const createInstance = (): GooRendererInstance | null => {
  const canvas = document.createElement('canvas');
  canvas.className = 'dock-goo-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', {
    antialias: false,
    premultipliedAlpha: true,
    alpha: true,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const hasDerivatives = gl.getExtension('OES_standard_derivatives') !== null;
  const fragSource = hasDerivatives
    ? `#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIVS 1\n${FRAG}`
    : FRAG;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERT);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    instance = null;
  });

  return {
    version: GOO_RENDERER_VERSION,
    canvas,
    gl,
    program,
    hasDerivatives,
    locations: {
      rect: gl.getUniformLocation(program, 'uRect'),
      rad: gl.getUniformLocation(program, 'uRad'),
      stretch: gl.getUniformLocation(program, 'uStretch'),
      count: gl.getUniformLocation(program, 'uCount'),
      k: gl.getUniformLocation(program, 'uK'),
      merge: gl.getUniformLocation(program, 'uMerge'),
      alpha: gl.getUniformLocation(program, 'uAlpha'),
      style: gl.getUniformLocation(program, 'uStyle'),
      shadeRadius: gl.getUniformLocation(program, 'uShadeRadius'),
      fill: gl.getUniformLocation(program, 'uFill'),
      border: gl.getUniformLocation(program, 'uBorder'),
      mergeBorder: gl.getUniformLocation(program, 'uMergeBorder'),
    },
    dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    rectArray: new Float32Array(MAX_GOO_BLOBS * 4),
    radArray: new Float32Array(MAX_GOO_BLOBS),
    stretchArray: new Float32Array(MAX_GOO_BLOBS * 4),
  };
};

export function acquireGooRenderer(): GooRenderer | null {
  if (!instance) {
    if (creationFailed) return null;
    instance = createInstance();
    if (!instance) {
      creationFailed = true;
      return null;
    }
  }

  const active = instance;
  return {
    canvas: active.canvas,
    resize: () => {
      const width = Math.round(window.innerWidth * active.dpr);
      const height = Math.round(window.innerHeight * active.dpr);
      if (active.canvas.width !== width || active.canvas.height !== height) {
        active.canvas.width = width;
        active.canvas.height = height;
        active.gl.viewport(0, 0, width, height);
      }
    },
    render: (frame: GooFrame) => {
      const { gl, locations, dpr, rectArray, radArray, stretchArray, canvas } = active;
      const count = Math.min(frame.blobs.length, MAX_GOO_BLOBS);
      for (let i = 0; i < count; i++) {
        const blob = frame.blobs[i];
        rectArray[i * 4] = blob.cx * dpr;
        rectArray[i * 4 + 1] = canvas.height - blob.cy * dpr;
        rectArray[i * 4 + 2] = blob.hw * dpr;
        rectArray[i * 4 + 3] = blob.hh * dpr;
        radArray[i] = blob.radius * dpr;
        const stretch = blob.stretch;
        // dirY flips with the gl_FragCoord y-axis.
        stretchArray[i * 4] = stretch ? stretch.dirX : 1;
        stretchArray[i * 4 + 1] = stretch ? -stretch.dirY : 0;
        stretchArray[i * 4 + 2] = stretch ? Math.max(stretch.along, 0.05) : 1;
        stretchArray[i * 4 + 3] = stretch ? Math.max(stretch.perp, 0.05) : 1;
      }

      gl.useProgram(active.program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform4fv(locations.rect, rectArray);
      gl.uniform1fv(locations.rad, radArray);
      gl.uniform4fv(locations.stretch, stretchArray);
      gl.uniform1f(locations.count, count);
      gl.uniform1f(locations.k, frame.mergeRadius * dpr);
      gl.uniform1f(locations.merge, frame.mergeTint);
      gl.uniform1f(locations.alpha, frame.alpha);
      gl.uniform1f(locations.style, frame.style === 'droplet' && active.hasDerivatives ? 1 : 0);
      gl.uniform1f(locations.shadeRadius, (frame.shadeRadius ?? 26) * dpr);
      gl.uniform3fv(locations.fill, frame.theme.fill);
      gl.uniform3fv(locations.border, frame.theme.border);
      gl.uniform3fv(locations.mergeBorder, frame.theme.mergeBorder);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
