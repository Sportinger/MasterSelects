// Three.js 3D Scene Renderer - renders 3D-enabled layers to an OffscreenCanvas.
// The output is imported into the existing WebGPU compositor as a texture.

import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import helvetikerRegular from 'three/examples/fonts/helvetiker_regular.typeface.json';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import optimerRegular from 'three/examples/fonts/optimer_regular.typeface.json';
import optimerBold from 'three/examples/fonts/optimer_bold.typeface.json';
import gentilisRegular from 'three/examples/fonts/gentilis_regular.typeface.json';
import gentilisBold from 'three/examples/fonts/gentilis_bold.typeface.json';
import { Logger } from '../../services/logger';
import type { Layer3DData, CameraConfig, SplatEffectorRuntimeData } from './types';
import { DEFAULT_CAMERA_CONFIG } from './types';
import { resolveSplatSortPolicy } from './splatSortPolicy';
import { applyThreeDEffectorsToObjectTransform } from '../../utils/threeDEffectors';
import {
  DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS,
  getPreparedSplatRuntimeSync,
  prewarmGaussianSplatRuntime,
  resolvePreparedSplatRuntime,
  waitForTargetPreparedSplatRuntime,
  type PreparedSplatRuntime,
} from './splatRuntimeCache';

const log = Logger.create('ThreeSceneRenderer');

type THREE = typeof import('three');
type ParsedText3DFont = ReturnType<FontLoader['parse']>;
type Vector2Like = import('three').Vector2;
type Vector4Like = import('three').Vector4;
type SplatShaderMaterial = import('three').ShaderMaterial & {
  uniforms: {
    uOpacity: { value: number };
    uSplatScale: { value: number };
    uViewportSize: { value: Vector2Like };
    uCenterOpacityTex: { value: import('three').DataTexture };
    uColorTex: { value: import('three').DataTexture };
    uAxisXTex: { value: import('three').DataTexture };
    uAxisYTex: { value: import('three').DataTexture };
    uAxisZTex: { value: import('three').DataTexture };
    uOrderTexture: { value: import('three').DataTexture };
    uEffectorCount: { value: number };
    uEffectorPosRadius: { value: Vector4Like[] };
    uEffectorAxisStrength: { value: Vector4Like[] };
    uEffectorParamsA: { value: Vector4Like[] };
    uEffectorParamsB: { value: Vector4Like[] };
  };
};

interface ManagedMesh {
  mesh: import('three').Mesh | import('three').Group;
  kind: 'plane' | 'primitive' | 'text3d' | 'model';
  texture?: import('three').Texture | import('three').VideoTexture;
  layerId: string;
  lastSourceType?: 'video' | 'video-canvas' | 'image' | 'canvas' | 'model' | null;
  planeW: number;
  planeH: number;
  resourceKey?: string;
  videoCanvas?: HTMLCanvasElement | null;
}

interface ManagedSplat {
  layerId: string;
  mesh: import('three').Mesh;
  geometry: import('three').InstancedBufferGeometry;
  material: SplatShaderMaterial;
  splatUrl?: string;
  sourceCacheKey?: string;
  loadPromise: Promise<void> | null;
  splatCount: number;
  centers: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  sizes: Float32Array;
  axisX: Float32Array;
  axisY: Float32Array;
  axisZ: Float32Array;
  sortIndices: number[];
  sortDepths: Float32Array;
  lastSortCameraPosition: [number, number, number] | null;
  lastSortCameraDirection: [number, number, number] | null;
  sortFrame: number;
  sortFrequency: number;
  lastSortTimeMs: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  normalizationScale: number;
  rendererRevision: number;
  didLogVisibilityProbe: boolean;
  requestedMaxSplats: number;
  centerOpacityTexture: import('three').DataTexture;
  colorTexture: import('three').DataTexture;
  axisXTexture: import('three').DataTexture;
  axisYTexture: import('three').DataTexture;
  axisZTexture: import('three').DataTexture;
  orderTexture: import('three').DataTexture;
  centerOpacityTextureData: Float32Array;
  colorTextureData: Float32Array;
  axisXTextureData: Float32Array;
  axisYTextureData: Float32Array;
  axisZTextureData: Float32Array;
  orderTextureData: Float32Array;
  appliedRuntimeKey?: string;
  stagedTargetRuntime: PreparedSplatRuntime | null;
  stagedLastStepMs: number;
}

const modelCache = new Map<string, import('three').Group>();
const modelLoading = new Set<string>();
const text3DFontLoader = new FontLoader();
const text3DFontCache = new Map<string, ParsedText3DFont>();
const THREE_SPLAT_SEQUENCE_SAFE_MAX_SPLATS = 16384;
const THREE_SPLAT_SEQUENCE_MIN_SORT_FREQUENCY = 4;
const TEXT_3D_FONT_DATA: Record<'helvetiker' | 'optimer' | 'gentilis', Record<'regular' | 'bold', object>> = {
  helvetiker: {
    regular: helvetikerRegular as object,
    bold: helvetikerBold as object,
  },
  optimer: {
    regular: optimerRegular as object,
    bold: optimerBold as object,
  },
  gentilis: {
    regular: gentilisRegular as object,
    bold: gentilisBold as object,
  },
};
const MAX_EXACT_CPU_SORT_SPLATS = 100000;
const THREE_SPLAT_RENDERER_REVISION = 11;
const MAX_SPLAT_EFFECTORS = 8;

export class ThreeSceneRenderer {
  private THREE: THREE | null = null;
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private meshes = new Map<string, ManagedMesh>();
  private splatObjects = new Map<string, ManagedSplat>();
  private width = 0;
  private height = 0;
  private initialized = false;
  private modelFileNames = new Map<string, string>();

  private getZeroEffectorVector4s(T: THREE): import('three').Vector4[] {
    return Array.from({ length: MAX_SPLAT_EFFECTORS }, () => new T.Vector4(0, 0, 0, 0));
  }

  private getFiniteNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private getGaussianSplatOrientationOffset(layer: Layer3DData): { x: number; y: number; z: number } {
    switch (layer.gaussianSplatSettings?.render?.orientationPreset) {
      case 'flip-x-180':
        return { x: Math.PI, y: 0, z: 0 };
      default:
        return { x: 0, y: 0, z: 0 };
    }
  }

  private createFloatDataTexture(
    T: THREE,
    data: Float32Array,
    width: number,
    height: number,
  ): import('three').DataTexture {
    const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.FloatType);
    texture.magFilter = T.NearestFilter;
    texture.minFilter = T.NearestFilter;
    texture.wrapS = T.ClampToEdgeWrapping;
    texture.wrapT = T.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }

  private createZeroFloatDataTexture(T: THREE): import('three').DataTexture {
    return this.createFloatDataTexture(T, new Float32Array(4), 1, 1);
  }

  private replaceFloatDataTexture(
    T: THREE,
    existing: import('three').DataTexture,
    data: Float32Array,
    width: number,
    height: number,
  ): import('three').DataTexture {
    const image = existing.image as { width?: number; height?: number; data?: ArrayLike<number> } | undefined;
    if (image?.width === width && image?.height === height) {
      image.data = data;
      existing.needsUpdate = true;
      return existing;
    }

    existing.dispose();
    return this.createFloatDataTexture(T, data, width, height);
  }

  private getLayerPosition(layer: Layer3DData): { x: number; y: number; z: number } {
    return {
      x: this.getFiniteNumber(layer.position.x, 0),
      y: this.getFiniteNumber(layer.position.y, 0),
      z: this.getFiniteNumber(layer.position.z, 0),
    };
  }

  private getLayerScale(layer: Layer3DData): { x: number; y: number; z: number } {
    return {
      x: this.getFiniteNumber(layer.scale.x, 1),
      y: this.getFiniteNumber(layer.scale.y, 1),
      z: this.getFiniteNumber(layer.scale.z, 1),
    };
  }

  private getLayerRotationRadians(layer: Layer3DData): { x: number; y: number; z: number } {
    const degToRad = Math.PI / 180;
    return {
      x: this.getFiniteNumber(layer.rotation.x, 0) * degToRad,
      y: this.getFiniteNumber(layer.rotation.y, 0) * degToRad,
      z: this.getFiniteNumber(layer.rotation.z, 0) * degToRad,
    };
  }

  async initialize(width: number, height: number): Promise<boolean> {
    if (this.initialized && this.width === width && this.height === height) {
      return true;
    }

    try {
      if (!this.THREE) {
        log.info('Loading Three.js...');
        this.THREE = await import('three');
        log.info('Three.js loaded', { version: this.THREE.REVISION });
      }

      const T = this.THREE;
      this.width = width;
      this.height = height;

      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
      }
      this.canvas.width = width;
      this.canvas.height = height;

      if (!this.renderer) {
        this.renderer = new T.WebGLRenderer({
          canvas: this.canvas as HTMLCanvasElement,
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.debug.checkShaderErrors = true;
        const rendererDebug = this.renderer.debug as typeof this.renderer.debug & {
          onShaderError?: (
            gl: WebGLRenderingContext | WebGL2RenderingContext,
            program: WebGLProgram,
            glVertexShader: WebGLShader,
            glFragmentShader: WebGLShader,
          ) => void;
        };
        rendererDebug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
          log.error('Three.js shader compile failed', {
            programLog: gl.getProgramInfoLog(program),
            vertexLog: gl.getShaderInfoLog(glVertexShader),
            fragmentLog: gl.getShaderInfoLog(glFragmentShader),
          });
        };
      }
      this.renderer.setSize(width, height, false);

      if (!this.scene) {
        this.scene = new T.Scene();
        const ambient = new T.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const directional = new T.DirectionalLight(0xffffff, 0.8);
        directional.position.set(1, 2, 3);
        this.scene.add(directional);
      }

      if (!this.camera) {
        this.camera = new T.PerspectiveCamera(
          DEFAULT_CAMERA_CONFIG.fov,
          width / height,
          DEFAULT_CAMERA_CONFIG.near,
          DEFAULT_CAMERA_CONFIG.far,
        );
        this.camera.position.set(
          DEFAULT_CAMERA_CONFIG.position.x,
          DEFAULT_CAMERA_CONFIG.position.y,
          DEFAULT_CAMERA_CONFIG.position.z,
        );
        this.camera.up.set(
          DEFAULT_CAMERA_CONFIG.up?.x ?? 0,
          DEFAULT_CAMERA_CONFIG.up?.y ?? 1,
          DEFAULT_CAMERA_CONFIG.up?.z ?? 0,
        );
        this.camera.lookAt(
          DEFAULT_CAMERA_CONFIG.target.x,
          DEFAULT_CAMERA_CONFIG.target.y,
          DEFAULT_CAMERA_CONFIG.target.z,
        );
      }

      this.initialized = true;
      log.info('ThreeSceneRenderer initialized', { width, height });
      return true;
    } catch (err) {
      log.error('Failed to initialize ThreeSceneRenderer', err);
      return false;
    }
  }

  private getCameraZForFill(fovDeg: number, planeH: number): number {
    return planeH / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
  }

  private createSplatMaterial(T: THREE): SplatShaderMaterial {
    const zeroVec4s = this.getZeroEffectorVector4s(T);
    const zeroTexture = this.createZeroFloatDataTexture(T);
    return new T.ShaderMaterial({
      glslVersion: T.GLSL3,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
      uniforms: {
        uOpacity: { value: 1 },
        uSplatScale: { value: 1 },
        uViewportSize: { value: new T.Vector2(Math.max(this.width, 1), Math.max(this.height, 1)) },
        uCenterOpacityTex: { value: zeroTexture },
        uColorTex: { value: zeroTexture },
        uAxisXTex: { value: zeroTexture },
        uAxisYTex: { value: zeroTexture },
        uAxisZTex: { value: zeroTexture },
        uOrderTexture: { value: zeroTexture },
        uEffectorCount: { value: 0 },
        uEffectorPosRadius: { value: zeroVec4s.map((v) => v.clone()) },
        uEffectorAxisStrength: { value: zeroVec4s.map((v) => v.clone()) },
        uEffectorParamsA: { value: zeroVec4s.map((v) => v.clone()) },
        uEffectorParamsB: { value: zeroVec4s.map((v) => v.clone()) },
      },
      vertexShader: `
        precision highp float;
        precision highp int;

        #define MAX_SPLAT_EFFECTORS ${MAX_SPLAT_EFFECTORS}

        out vec3 vColor;
        out float vOpacity;
        out vec3 vConic;
        out vec2 vOffsetPx;

        uniform float uOpacity;
        uniform float uSplatScale;
        uniform vec2 uViewportSize;
        uniform sampler2D uCenterOpacityTex;
        uniform sampler2D uColorTex;
        uniform sampler2D uAxisXTex;
        uniform sampler2D uAxisYTex;
        uniform sampler2D uAxisZTex;
        uniform sampler2D uOrderTexture;
        uniform int uEffectorCount;
        uniform vec4 uEffectorPosRadius[MAX_SPLAT_EFFECTORS];
        uniform vec4 uEffectorAxisStrength[MAX_SPLAT_EFFECTORS];
        uniform vec4 uEffectorParamsA[MAX_SPLAT_EFFECTORS];
        uniform vec4 uEffectorParamsB[MAX_SPLAT_EFFECTORS];

        ivec2 getTextureTexelCoord(int index, ivec2 size) {
          int x = index % size.x;
          int y = index / size.x;
          return ivec2(x, y);
        }

        int getSortedSourceIndex() {
          ivec2 orderSize = textureSize(uOrderTexture, 0);
          return int(round(texelFetch(uOrderTexture, getTextureTexelCoord(gl_InstanceID, orderSize), 0).x));
        }

        vec3 hash33(vec3 p) {
          p = vec3(
            dot(p, vec3(127.1, 311.7, 74.7)),
            dot(p, vec3(269.5, 183.3, 246.1)),
            dot(p, vec3(113.5, 271.9, 124.6))
          );
          return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
        }

        vec3 applySplatEffectors(vec3 center) {
          vec3 displaced = center;

          for (int i = 0; i < MAX_SPLAT_EFFECTORS; i++) {
            if (i >= uEffectorCount) {
              break;
            }

            vec3 effectorPos = uEffectorPosRadius[i].xyz;
            float radius = max(uEffectorPosRadius[i].w, 0.0001);
            vec3 axis = uEffectorAxisStrength[i].xyz;
            float axisLen = length(axis);
            if (axisLen > 0.0001) {
              axis /= axisLen;
            } else {
              axis = vec3(0.0, 1.0, 0.0);
            }
            float strength = uEffectorAxisStrength[i].w;
            float falloff = max(uEffectorParamsA[i].x, 0.001);
            float speed = uEffectorParamsA[i].y;
            float seed = uEffectorParamsA[i].z;
            float mode = uEffectorParamsA[i].w;
            float localTime = uEffectorParamsB[i].x;

            vec3 fromEffector = displaced - effectorPos;
            float dist = length(fromEffector);
            if (dist > radius) {
              continue;
            }

            float normDist = clamp(dist / radius, 0.0, 1.0);
            float weight = pow(1.0 - normDist, falloff);
            vec3 radialDir = dist > 0.0001 ? (fromEffector / dist) : axis;
            vec3 delta = vec3(0.0);

            if (mode < 0.5) {
              delta = radialDir * strength * weight;
            } else if (mode < 1.5) {
              delta = -radialDir * strength * weight;
            } else if (mode < 2.5) {
              vec3 tangent = cross(axis, radialDir);
              float tangentLen = length(tangent);
              if (tangentLen > 0.0001) {
                tangent /= tangentLen;
              }
              float pulse = 0.6 + 0.4 * sin(localTime * speed + dist * 6.0 + seed);
              delta = tangent * strength * weight * pulse;
            } else {
              vec3 noiseVector = hash33(displaced * (3.0 + falloff) + vec3(seed + localTime * speed));
              float noiseLen = length(noiseVector);
              if (noiseLen > 0.0001) {
                noiseVector /= noiseLen;
              }
              float pulse = 0.5 + 0.5 * sin(localTime * speed + seed + dist * 5.0);
              delta = noiseVector * strength * weight * pulse;
            }

            displaced += delta;
          }

          return displaced;
        }

        vec2 projectAxisToPixels(vec3 centerView, vec3 axisView, vec2 focal) {
          float depth = max(-centerView.z, 0.0001);
          float invDepth2 = 1.0 / (depth * depth);
          return vec2(
            focal.x * (axisView.x * depth + centerView.x * axisView.z) * invDepth2,
            focal.y * (axisView.y * depth + centerView.y * axisView.z) * invDepth2
          );
        }

        void main() {
          int sourceIndex = getSortedSourceIndex();
          ivec2 splatSize = textureSize(uCenterOpacityTex, 0);
          vec4 centerOpacity = texelFetch(uCenterOpacityTex, getTextureTexelCoord(sourceIndex, splatSize), 0);
          vec4 colorTexel = texelFetch(uColorTex, getTextureTexelCoord(sourceIndex, splatSize), 0);
          vec3 baseCenter = centerOpacity.xyz;
          vec3 baseColor = colorTexel.xyz;
          float baseOpacity = centerOpacity.w;
          vec3 axisX = texelFetch(uAxisXTex, getTextureTexelCoord(sourceIndex, splatSize), 0).xyz;
          vec3 axisY = texelFetch(uAxisYTex, getTextureTexelCoord(sourceIndex, splatSize), 0).xyz;
          vec3 axisZ = texelFetch(uAxisZTex, getTextureTexelCoord(sourceIndex, splatSize), 0).xyz;

          float composedOpacity = clamp(baseOpacity * uOpacity, 0.0, 1.0);
          vColor = max(baseColor, vec3(0.0));
          vOpacity = composedOpacity;
          vConic = vec3(0.0);
          vOffsetPx = vec2(0.0);

          vec3 displacedCenter = applySplatEffectors(baseCenter);
          vec4 centerView4 = modelViewMatrix * vec4(displacedCenter, 1.0);
          vec3 centerView = centerView4.xyz;
          float viewDepth = -centerView.z;
          if (composedOpacity <= 0.0 || viewDepth <= 0.0001) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          mat3 modelViewLinear = mat3(
            modelViewMatrix[0].xyz,
            modelViewMatrix[1].xyz,
            modelViewMatrix[2].xyz
          );
          vec3 axisViewX = modelViewLinear * axisX;
          vec3 axisViewY = modelViewLinear * axisY;
          vec3 axisViewZ = modelViewLinear * axisZ;

          vec2 focal = vec2(
            abs(projectionMatrix[0][0]) * uViewportSize.x * 0.5,
            abs(projectionMatrix[1][1]) * uViewportSize.y * 0.5
          );
          float splatScale = max(uSplatScale, 0.001);
          vec2 axisPxX = projectAxisToPixels(centerView, axisViewX, focal) * splatScale;
          vec2 axisPxY = projectAxisToPixels(centerView, axisViewY, focal) * splatScale;
          vec2 axisPxZ = projectAxisToPixels(centerView, axisViewZ, focal) * splatScale;

          float covXX = dot(vec3(axisPxX.x, axisPxY.x, axisPxZ.x), vec3(axisPxX.x, axisPxY.x, axisPxZ.x)) + 0.3;
          float covXY = axisPxX.x * axisPxX.y + axisPxY.x * axisPxY.y + axisPxZ.x * axisPxZ.y;
          float covYY = dot(vec3(axisPxX.y, axisPxY.y, axisPxZ.y), vec3(axisPxX.y, axisPxY.y, axisPxZ.y)) + 0.3;

          float det = covXX * covYY - covXY * covXY;
          if (det <= 0.0001) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          float invDet = 1.0 / det;
          vConic = vec3(covYY * invDet, -covXY * invDet, covXX * invDet);

          float mid = 0.5 * (covXX + covYY);
          float radiusTerm = sqrt(max(0.0, 0.25 * (covXX - covYY) * (covXX - covYY) + covXY * covXY));
          float lambdaMax = max(mid + radiusTerm, mid - radiusTerm);
          float radiusPx = clamp(ceil(3.0 * sqrt(max(lambdaMax, 0.0))), 1.0, 2048.0);

          vec2 quadCorner = position.xy;
          vOffsetPx = quadCorner * radiusPx;

          vec4 centerClip = projectionMatrix * centerView4;
          vec2 ndcOffset = (vOffsetPx / uViewportSize) * 2.0;
          gl_Position = centerClip + vec4(ndcOffset * centerClip.w, 0.0, 0.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        precision highp int;

        in vec3 vColor;
        in float vOpacity;
        in vec3 vConic;
        in vec2 vOffsetPx;

        out vec4 fragColor;

        void main() {
          float power = -0.5 * (
            vConic.x * vOffsetPx.x * vOffsetPx.x +
            2.0 * vConic.y * vOffsetPx.x * vOffsetPx.y +
            vConic.z * vOffsetPx.y * vOffsetPx.y
          );
          if (power > 0.0) discard;

          float alpha = min(0.99, vOpacity * exp(power));
          if (alpha < (1.0 / 255.0)) discard;

          fragColor = vec4(vColor * alpha, alpha);
        }
      `,
    }) as SplatShaderMaterial;
  }

  private createManagedSplat(T: THREE, layerId: string): ManagedSplat {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array([
      -1, -1, 0,
       1, -1, 0,
      -1,  1, 0,
       1,  1, 0,
    ]), 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = 0;

    const material = this.createSplatMaterial(T);
    const mesh = new T.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;

    return {
      layerId,
      mesh,
      geometry,
      material,
      loadPromise: null,
      sourceCacheKey: undefined,
      splatCount: 0,
      centers: new Float32Array(),
      colors: new Float32Array(),
      opacities: new Float32Array(),
      sizes: new Float32Array(),
      axisX: new Float32Array(),
      axisY: new Float32Array(),
      axisZ: new Float32Array(),
      sortIndices: [],
      sortDepths: new Float32Array(),
      lastSortCameraPosition: null,
      lastSortCameraDirection: null,
      sortFrame: 0,
      sortFrequency: 1,
      lastSortTimeMs: 0,
      bounds: null,
      normalizationScale: 1,
      rendererRevision: THREE_SPLAT_RENDERER_REVISION,
      didLogVisibilityProbe: false,
      requestedMaxSplats: 0,
      centerOpacityTexture: material.uniforms.uCenterOpacityTex.value,
      colorTexture: material.uniforms.uColorTex.value,
      axisXTexture: material.uniforms.uAxisXTex.value,
      axisYTexture: material.uniforms.uAxisYTex.value,
      axisZTexture: material.uniforms.uAxisZTex.value,
      orderTexture: material.uniforms.uOrderTexture.value,
      centerOpacityTextureData: new Float32Array(4),
      colorTextureData: new Float32Array(4),
      axisXTextureData: new Float32Array(4),
      axisYTextureData: new Float32Array(4),
      axisZTextureData: new Float32Array(4),
      orderTextureData: new Float32Array(4),
      appliedRuntimeKey: undefined,
      stagedTargetRuntime: null,
      stagedLastStepMs: 0,
    };
  }

  private getSplatRuntimeSourceOptions(layer: Layer3DData): {
    cacheKey: string;
    fileHash?: string;
    file?: File;
    url?: string;
    fileName?: string;
    gaussianSplatSequence?: Layer3DData['gaussianSplatSequence'];
    requestedMaxSplats: number;
  } {
    const requestedMaxSplats = this.getEffectiveSplatRequestedMaxSplats(layer);
    const cacheKey =
      layer.gaussianSplatRuntimeKey ??
      layer.gaussianSplatFileHash ??
      layer.gaussianSplatMediaFileId ??
      `${layer.gaussianSplatFileName || layer.gaussianSplatUrl || layer.clipId}|${layer.gaussianSplatUrl || layer.clipId}`;

    return {
      cacheKey,
      fileHash: layer.gaussianSplatFileHash,
      file: layer.gaussianSplatFile,
      url: layer.gaussianSplatUrl,
      fileName: layer.gaussianSplatFileName,
      gaussianSplatSequence: layer.gaussianSplatSequence,
      requestedMaxSplats,
    };
  }

  private isSequenceSplatLayer(layer: Layer3DData): boolean {
    return layer.gaussianSplatIsSequence === true;
  }

  private getEffectiveSplatRequestedMaxSplats(layer: Layer3DData): number {
    const requestedMaxSplats = layer.gaussianSplatSettings?.render.maxSplats ?? 0;
    if (!this.isSequenceSplatLayer(layer)) {
      return requestedMaxSplats;
    }
    if (requestedMaxSplats <= 0) {
      return THREE_SPLAT_SEQUENCE_SAFE_MAX_SPLATS;
    }
    return Math.min(requestedMaxSplats, THREE_SPLAT_SEQUENCE_SAFE_MAX_SPLATS);
  }

  private applyPreparedSplatRuntime(
    T: THREE,
    managed: ManagedSplat,
    layer: Layer3DData,
    runtime: PreparedSplatRuntime,
  ): void {
    if (managed.appliedRuntimeKey === runtime.runtimeKey) {
      return;
    }

    managed.centers = runtime.centers;
    managed.colors = new Float32Array();
    managed.opacities = new Float32Array();
    managed.sizes = new Float32Array();
    managed.axisX = new Float32Array();
    managed.axisY = new Float32Array();
    managed.axisZ = new Float32Array();
    managed.splatCount = runtime.splatCount;
    managed.sortIndices = Array.from({ length: runtime.splatCount }, (_, index) => index);
    managed.sortDepths = new Float32Array(runtime.splatCount);
    managed.lastSortCameraPosition = null;
    managed.lastSortCameraDirection = null;
    managed.sortFrame = 0;
    managed.lastSortTimeMs = 0;
    managed.bounds = runtime.normalizedBounds;
    managed.normalizationScale = runtime.normalizationScale;
    managed.requestedMaxSplats = this.getEffectiveSplatRequestedMaxSplats(layer);
    managed.appliedRuntimeKey = runtime.runtimeKey;
    managed.stagedTargetRuntime = null;
    managed.stagedLastStepMs = 0;
    managed.centerOpacityTextureData = runtime.centerOpacityTextureData;
    managed.colorTextureData = runtime.colorTextureData;
    managed.axisXTextureData = runtime.axisXTextureData;
    managed.axisYTextureData = runtime.axisYTextureData;
    managed.axisZTextureData = runtime.axisZTextureData;
    managed.orderTextureData = new Float32Array(runtime.orderTemplateData);

    managed.centerOpacityTexture = this.replaceFloatDataTexture(
      T,
      managed.centerOpacityTexture,
      runtime.centerOpacityTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );
    managed.colorTexture = this.replaceFloatDataTexture(
      T,
      managed.colorTexture,
      runtime.colorTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );
    managed.axisXTexture = this.replaceFloatDataTexture(
      T,
      managed.axisXTexture,
      runtime.axisXTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );
    managed.axisYTexture = this.replaceFloatDataTexture(
      T,
      managed.axisYTexture,
      runtime.axisYTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );
    managed.axisZTexture = this.replaceFloatDataTexture(
      T,
      managed.axisZTexture,
      runtime.axisZTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );
    managed.orderTexture = this.replaceFloatDataTexture(
      T,
      managed.orderTexture,
      managed.orderTextureData,
      runtime.textureWidth,
      runtime.textureHeight,
    );

    managed.material.uniforms.uCenterOpacityTex.value = managed.centerOpacityTexture;
    managed.material.uniforms.uColorTex.value = managed.colorTexture;
    managed.material.uniforms.uAxisXTex.value = managed.axisXTexture;
    managed.material.uniforms.uAxisYTex.value = managed.axisYTexture;
    managed.material.uniforms.uAxisZTex.value = managed.axisZTexture;
    managed.material.uniforms.uOrderTexture.value = managed.orderTexture;

    managed.geometry.instanceCount = runtime.splatCount;
    managed.geometry.boundingSphere = new T.Sphere(
      new T.Vector3(0, 0, 0),
      Math.max(
        0.5,
        Math.hypot(
          runtime.normalizedBounds.max[0] - runtime.normalizedBounds.min[0],
          runtime.normalizedBounds.max[1] - runtime.normalizedBounds.min[1],
          runtime.normalizedBounds.max[2] - runtime.normalizedBounds.min[2],
        ) * 0.75,
      ),
    );

    this.updateSplatSort(managed, true);

    log.warn('Three.js splat runtime applied', {
      layerId: layer.layerId,
      clipId: layer.clipId,
      fileName: layer.gaussianSplatFileName,
      variant: runtime.variant,
      totalSplats: runtime.totalSplats,
      requestedMaxSplats: runtime.requestedMaxSplats,
      renderedSplats: runtime.splatCount,
      stride: runtime.stride,
    });
  }

  private beginStagedSplatUpgrade(
    T: THREE,
    managed: ManagedSplat,
    layer: Layer3DData,
    targetRuntime: PreparedSplatRuntime,
  ): void {
    if (targetRuntime.splatCount <= managed.splatCount) {
      managed.appliedRuntimeKey = targetRuntime.runtimeKey;
      managed.stagedTargetRuntime = null;
      return;
    }

    const currentCount = managed.splatCount;
    const currentTexelFloatCount = currentCount * 4;

    managed.centerOpacityTextureData = new Float32Array(targetRuntime.centerOpacityTextureData.length);
    managed.colorTextureData = new Float32Array(targetRuntime.colorTextureData.length);
    managed.axisXTextureData = new Float32Array(targetRuntime.axisXTextureData.length);
    managed.axisYTextureData = new Float32Array(targetRuntime.axisYTextureData.length);
    managed.axisZTextureData = new Float32Array(targetRuntime.axisZTextureData.length);
    managed.orderTextureData = new Float32Array(targetRuntime.orderTemplateData.length);

    managed.centerOpacityTextureData.set(
      targetRuntime.centerOpacityTextureData.subarray(0, currentTexelFloatCount),
      0,
    );
    managed.colorTextureData.set(
      targetRuntime.colorTextureData.subarray(0, currentTexelFloatCount),
      0,
    );
    managed.axisXTextureData.set(
      targetRuntime.axisXTextureData.subarray(0, currentTexelFloatCount),
      0,
    );
    managed.axisYTextureData.set(
      targetRuntime.axisYTextureData.subarray(0, currentTexelFloatCount),
      0,
    );
    managed.axisZTextureData.set(
      targetRuntime.axisZTextureData.subarray(0, currentTexelFloatCount),
      0,
    );
    managed.orderTextureData.set(
      targetRuntime.orderTemplateData.subarray(0, currentTexelFloatCount),
      0,
    );

    managed.centerOpacityTexture = this.replaceFloatDataTexture(
      T,
      managed.centerOpacityTexture,
      managed.centerOpacityTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );
    managed.colorTexture = this.replaceFloatDataTexture(
      T,
      managed.colorTexture,
      managed.colorTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );
    managed.axisXTexture = this.replaceFloatDataTexture(
      T,
      managed.axisXTexture,
      managed.axisXTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );
    managed.axisYTexture = this.replaceFloatDataTexture(
      T,
      managed.axisYTexture,
      managed.axisYTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );
    managed.axisZTexture = this.replaceFloatDataTexture(
      T,
      managed.axisZTexture,
      managed.axisZTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );
    managed.orderTexture = this.replaceFloatDataTexture(
      T,
      managed.orderTexture,
      managed.orderTextureData,
      targetRuntime.textureWidth,
      targetRuntime.textureHeight,
    );

    managed.material.uniforms.uCenterOpacityTex.value = managed.centerOpacityTexture;
    managed.material.uniforms.uColorTex.value = managed.colorTexture;
    managed.material.uniforms.uAxisXTex.value = managed.axisXTexture;
    managed.material.uniforms.uAxisYTex.value = managed.axisYTexture;
    managed.material.uniforms.uAxisZTex.value = managed.axisZTexture;
    managed.material.uniforms.uOrderTexture.value = managed.orderTexture;

    managed.centers = targetRuntime.centers;
    managed.sortIndices = Array.from({ length: targetRuntime.splatCount }, (_, index) => index);
    managed.sortDepths = new Float32Array(targetRuntime.splatCount);
    managed.bounds = targetRuntime.normalizedBounds;
    managed.normalizationScale = targetRuntime.normalizationScale;
    managed.geometry.instanceCount = currentCount;
    managed.splatCount = currentCount;
    managed.lastSortCameraPosition = null;
    managed.lastSortCameraDirection = null;
    managed.lastSortTimeMs = 0;
    managed.stagedTargetRuntime = targetRuntime;
    managed.stagedLastStepMs = 0;

    log.warn('Three.js splat runtime staged upgrade started', {
      layerId: layer.layerId,
      clipId: layer.clipId,
      fileName: layer.gaussianSplatFileName,
      currentSplats: currentCount,
      targetSplats: targetRuntime.splatCount,
    });
  }

  private advanceStagedSplatUpgrade(managed: ManagedSplat, realtimePlayback: boolean): void {
    const targetRuntime = managed.stagedTargetRuntime;
    if (!targetRuntime) {
      return;
    }

    const now = performance.now();
    const minIntervalMs = realtimePlayback ? 20 : 0;
    if (managed.stagedLastStepMs > 0 && now - managed.stagedLastStepMs < minIntervalMs) {
      return;
    }

    const chunkSplats = realtimePlayback ? 12288 : targetRuntime.splatCount;
    const nextCount = Math.min(targetRuntime.splatCount, managed.splatCount + chunkSplats);
    if (nextCount <= managed.splatCount) {
      return;
    }

    const fromFloat = managed.splatCount * 4;
    const toFloat = nextCount * 4;

    managed.centerOpacityTextureData.set(
      targetRuntime.centerOpacityTextureData.subarray(fromFloat, toFloat),
      fromFloat,
    );
    managed.colorTextureData.set(
      targetRuntime.colorTextureData.subarray(fromFloat, toFloat),
      fromFloat,
    );
    managed.axisXTextureData.set(
      targetRuntime.axisXTextureData.subarray(fromFloat, toFloat),
      fromFloat,
    );
    managed.axisYTextureData.set(
      targetRuntime.axisYTextureData.subarray(fromFloat, toFloat),
      fromFloat,
    );
    managed.axisZTextureData.set(
      targetRuntime.axisZTextureData.subarray(fromFloat, toFloat),
      fromFloat,
    );
    managed.orderTextureData.set(
      targetRuntime.orderTemplateData.subarray(fromFloat, toFloat),
      fromFloat,
    );

    managed.centerOpacityTexture.needsUpdate = true;
    managed.colorTexture.needsUpdate = true;
    managed.axisXTexture.needsUpdate = true;
    managed.axisYTexture.needsUpdate = true;
    managed.axisZTexture.needsUpdate = true;
    managed.orderTexture.needsUpdate = true;

    managed.splatCount = nextCount;
    managed.geometry.instanceCount = nextCount;
    managed.lastSortCameraPosition = null;
    managed.lastSortCameraDirection = null;
    managed.lastSortTimeMs = 0;
    managed.stagedLastStepMs = now;

    if (nextCount >= targetRuntime.splatCount) {
      managed.appliedRuntimeKey = targetRuntime.runtimeKey;
      managed.stagedTargetRuntime = null;
      managed.stagedLastStepMs = 0;
    }
  }

  private queueSplatRuntimeUpgrade(
    T: THREE,
    managed: ManagedSplat,
    layer: Layer3DData,
  ): void {
    if (this.isSequenceSplatLayer(layer)) {
      return;
    }
    const sourceOptions = this.getSplatRuntimeSourceOptions(layer);
    void waitForTargetPreparedSplatRuntime(sourceOptions)
      .then((runtime) => {
        const current = this.splatObjects.get(layer.layerId);
        if (
          !current ||
          current !== managed ||
          current.splatUrl !== layer.gaussianSplatUrl ||
          current.requestedMaxSplats !== sourceOptions.requestedMaxSplats
        ) {
          return;
        }

        this.beginStagedSplatUpgrade(T, current, layer, runtime);
      })
      .catch((error) => {
        log.warn('Failed to upgrade Three.js splat runtime', {
          layerId: layer.layerId,
          clipId: layer.clipId,
          fileName: layer.gaussianSplatFileName,
          error,
        });
      });
  }

  private async populateSplatGeometry(
    T: THREE,
    managed: ManagedSplat,
    layer: Layer3DData,
  ): Promise<void> {
    const sourceOptions = this.getSplatRuntimeSourceOptions(layer);
    const expectedSourceCacheKey = sourceOptions.cacheKey;
    if (!this.isSequenceSplatLayer(layer)) {
      prewarmGaussianSplatRuntime(sourceOptions);
    }

    const { runtime, usingBase } = await resolvePreparedSplatRuntime(sourceOptions);
    if (managed.sourceCacheKey !== expectedSourceCacheKey) {
      return;
    }
    this.applyPreparedSplatRuntime(T, managed, layer, runtime);

    if (
      !this.isSequenceSplatLayer(layer) &&
      usingBase &&
      runtime.splatCount < runtime.totalSplats &&
      (sourceOptions.requestedMaxSplats === 0 || sourceOptions.requestedMaxSplats > DEFAULT_SPLAT_BASE_LOD_MAX_SPLATS)
    ) {
      this.queueSplatRuntimeUpgrade(T, managed, layer);
    }
  }

  private applySplatOrder(managed: ManagedSplat): void {
    if (!managed.orderTexture || managed.orderTextureData.length === 0) {
      return;
    }

    for (let outIndex = 0; outIndex < managed.splatCount; outIndex += 1) {
      managed.orderTextureData[outIndex * 4] = managed.sortIndices[outIndex];
    }

    managed.orderTexture.needsUpdate = true;
  }

  private applyApproximateSplatOrder(
    managed: ManagedSplat,
    minDepth: number,
    maxDepth: number,
  ): void {
    const depthRange = maxDepth - minDepth;
    if (!Number.isFinite(depthRange) || depthRange <= 0.000001) {
      for (let i = 0; i < managed.splatCount; i += 1) {
        managed.sortIndices[i] = i;
      }
      return;
    }

    const bucketCount = managed.splatCount <= 300000
      ? 4096
      : managed.splatCount <= 800000
        ? 2048
        : 1024;
    const bucketCounts = new Uint32Array(bucketCount);
    const bucketOffsets = new Uint32Array(bucketCount);
    const bucketScale = (bucketCount - 1) / depthRange;

    for (let i = 0; i < managed.splatCount; i += 1) {
      const bucketIndex = Math.max(
        0,
        Math.min(
          bucketCount - 1,
          Math.floor((managed.sortDepths[i] - minDepth) * bucketScale),
        ),
      );
      bucketCounts[bucketIndex] += 1;
    }

    let offset = 0;
    for (let bucketIndex = bucketCount - 1; bucketIndex >= 0; bucketIndex -= 1) {
      bucketOffsets[bucketIndex] = offset;
      offset += bucketCounts[bucketIndex];
    }

    for (let i = 0; i < managed.splatCount; i += 1) {
      const bucketIndex = Math.max(
        0,
        Math.min(
          bucketCount - 1,
          Math.floor((managed.sortDepths[i] - minDepth) * bucketScale),
        ),
      );
      const outIndex = bucketOffsets[bucketIndex];
      managed.sortIndices[outIndex] = i;
      bucketOffsets[bucketIndex] = outIndex + 1;
    }
  }

  private updateSplatSort(
    managed: ManagedSplat,
    force = false,
    realtimePlayback = false,
    preciseSorting = false,
  ): void {
    if (!this.camera || managed.splatCount === 0) {
      return;
    }

    managed.sortFrame += 1;
    const canExactCpuSort = preciseSorting || managed.splatCount <= MAX_EXACT_CPU_SORT_SPLATS;
    const useApproximateSort = !canExactCpuSort;
    const policy = resolveSplatSortPolicy(
      managed.splatCount,
      Math.max(0, managed.sortFrequency || 0),
      useApproximateSort,
      realtimePlayback,
    );

    const cameraPosition = new this.THREE!.Vector3();
    const cameraDirection = new this.THREE!.Vector3();
    let minDepth = Number.POSITIVE_INFINITY;
    let maxDepth = Number.NEGATIVE_INFINITY;
    let inFrontCount = 0;

    this.camera.getWorldPosition(cameraPosition);
    this.camera.getWorldDirection(cameraDirection);

    const posTuple: [number, number, number] = [cameraPosition.x, cameraPosition.y, cameraPosition.z];
    const dirTuple: [number, number, number] = [cameraDirection.x, cameraDirection.y, cameraDirection.z];

    const movedEnough = !managed.lastSortCameraPosition ||
      ((managed.lastSortCameraPosition[0] - posTuple[0]) ** 2 +
       (managed.lastSortCameraPosition[1] - posTuple[1]) ** 2 +
       (managed.lastSortCameraPosition[2] - posTuple[2]) ** 2) > policy.positionEpsilonSq;
    const rotatedEnough = !managed.lastSortCameraDirection ||
      (managed.lastSortCameraDirection[0] * dirTuple[0] +
       managed.lastSortCameraDirection[1] * dirTuple[1] +
       managed.lastSortCameraDirection[2] * dirTuple[2]) < policy.directionDotThreshold;

    if (!force) {
      if (!movedEnough && !rotatedEnough) {
        return;
      }
      if (!policy.allowDynamicResort) {
        return;
      }
      if (policy.useFrameModulo && policy.intervalFrames > 1 && (managed.sortFrame % policy.intervalFrames !== 0)) {
        return;
      }
      if (
        policy.minElapsedMs > 0 &&
        managed.lastSortTimeMs > 0 &&
        performance.now() - managed.lastSortTimeMs < policy.minElapsedMs
      ) {
        return;
      }
    }

    managed.mesh.updateMatrixWorld(true);
    const matrixElements = managed.mesh.matrixWorld.elements;
    const depthCoeffX =
      matrixElements[0] * dirTuple[0] +
      matrixElements[1] * dirTuple[1] +
      matrixElements[2] * dirTuple[2];
    const depthCoeffY =
      matrixElements[4] * dirTuple[0] +
      matrixElements[5] * dirTuple[1] +
      matrixElements[6] * dirTuple[2];
    const depthCoeffZ =
      matrixElements[8] * dirTuple[0] +
      matrixElements[9] * dirTuple[1] +
      matrixElements[10] * dirTuple[2];
    const depthBias =
      (matrixElements[12] - posTuple[0]) * dirTuple[0] +
      (matrixElements[13] - posTuple[1]) * dirTuple[1] +
      (matrixElements[14] - posTuple[2]) * dirTuple[2];

    for (let i = 0; i < managed.splatCount; i += 1) {
      const base = i * 3;
      managed.sortDepths[i] =
        managed.centers[base + 0] * depthCoeffX +
        managed.centers[base + 1] * depthCoeffY +
        managed.centers[base + 2] * depthCoeffZ +
        depthBias;
      minDepth = Math.min(minDepth, managed.sortDepths[i]);
      maxDepth = Math.max(maxDepth, managed.sortDepths[i]);
      if (managed.sortDepths[i] > 0) {
        inFrontCount += 1;
      }
    }

    if (canExactCpuSort) {
      for (let i = 0; i < managed.splatCount; i += 1) {
        managed.sortIndices[i] = i;
      }
      managed.sortIndices.sort((a, b) => managed.sortDepths[b] - managed.sortDepths[a]);
    } else {
      this.applyApproximateSplatOrder(managed, minDepth, maxDepth);
    }
    managed.lastSortCameraPosition = posTuple;
    managed.lastSortCameraDirection = dirTuple;
    managed.lastSortTimeMs = performance.now();
    if (!managed.didLogVisibilityProbe) {
      const centerProbe = new this.THREE!.Vector3(0, 0, 0)
        .applyMatrix4(managed.mesh.matrixWorld)
        .project(this.camera);
      log.warn('Three.js splat visibility probe', {
        layerId: managed.layerId,
        splatCount: managed.splatCount,
        inFrontCount,
        minDepth,
        maxDepth,
        ndcCenter: [centerProbe.x, centerProbe.y, centerProbe.z],
        cameraPosition: posTuple,
        cameraDirection: dirTuple,
      });
      managed.didLogVisibilityProbe = true;
    }

    this.applySplatOrder(managed);
  }

  renderScene(
    layers: Layer3DData[],
    cameraConfig: CameraConfig,
    width: number,
    height: number,
    effectors: SplatEffectorRuntimeData[] = [],
    realtimePlayback = false,
  ): HTMLCanvasElement | OffscreenCanvas | null {
    if (!this.initialized || !this.THREE || !this.renderer || !this.scene || !this.camera) {
      return null;
    }

    const T = this.THREE;
    const outputAspect = width / Math.max(height, 1);

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      if (this.canvas) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.renderer.setSize(width, height, false);
    }

    const worldHeight = 2.0;
    const fov = cameraConfig.fov;
    const defaultCameraZ = this.getCameraZForFill(fov, worldHeight);
    const applyDefaultDistance = cameraConfig.applyDefaultDistance !== false;
    const cameraPosition = {
      x: this.getFiniteNumber(cameraConfig.position.x, DEFAULT_CAMERA_CONFIG.position.x),
      y: this.getFiniteNumber(cameraConfig.position.y, DEFAULT_CAMERA_CONFIG.position.y),
      z: this.getFiniteNumber(cameraConfig.position.z, DEFAULT_CAMERA_CONFIG.position.z),
    };
    const cameraTarget = {
      x: this.getFiniteNumber(cameraConfig.target.x, DEFAULT_CAMERA_CONFIG.target.x),
      y: this.getFiniteNumber(cameraConfig.target.y, DEFAULT_CAMERA_CONFIG.target.y),
      z: this.getFiniteNumber(cameraConfig.target.z, DEFAULT_CAMERA_CONFIG.target.z),
    };

    this.camera.fov = fov;
    this.camera.aspect = outputAspect;
    this.camera.near = cameraConfig.near;
    this.camera.far = cameraConfig.far;
    this.camera.up.set(
      cameraConfig.up?.x ?? DEFAULT_CAMERA_CONFIG.up?.x ?? 0,
      cameraConfig.up?.y ?? DEFAULT_CAMERA_CONFIG.up?.y ?? 1,
      cameraConfig.up?.z ?? DEFAULT_CAMERA_CONFIG.up?.z ?? 0,
    );
    this.camera.position.set(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z + (applyDefaultDistance ? defaultCameraZ : 0),
    );
    this.camera.lookAt(
      cameraTarget.x,
      cameraTarget.y,
      cameraTarget.z,
    );
    this.camera.updateProjectionMatrix();

    const activeLayerIds = new Set<string>();

    for (const layer of layers) {
      activeLayerIds.add(layer.layerId);
      const layerEffectors = layer.threeDEffectorsEnabled === false ? [] : effectors;

      if (layer.gaussianSplatUrl) {
        this.disposeManagedMeshById(layer.layerId);
        this.syncSplatLayer(layer, outputAspect, worldHeight, layerEffectors, realtimePlayback);
        continue;
      }

      this.disposeManagedSplatById(layer.layerId);

      let managed = this.meshes.get(layer.layerId);
      const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
      let planeW: number;
      let planeH: number;
      if (sourceAspect >= outputAspect) {
        planeW = worldHeight * outputAspect;
        planeH = planeW / sourceAspect;
      } else {
        planeH = worldHeight;
        planeW = planeH * sourceAspect;
      }

      if (layer.meshType === 'text3d' && layer.text3DProperties) {
        const geometryKey = this.getText3DGeometryKey(layer);
        if (!managed || managed.kind !== 'text3d' || managed.resourceKey !== geometryKey) {
          if (managed) this.disposeManagedMesh(managed);
          const geometry = this.createText3DGeometry(T, layer);
          const material = new T.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.2,
            roughness: 0.45,
          });
          const mesh = new T.Mesh(geometry, material);
          managed = {
            mesh,
            kind: 'text3d',
            layerId: layer.layerId,
            planeW: 1,
            planeH: 1,
            resourceKey: geometryKey,
          };
          this.meshes.set(layer.layerId, managed);
          this.scene.add(mesh);
        }

        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshStandardMaterial;
        if (layer.wireframe) {
          material.wireframe = true;
          material.color.setHex(0x4488ff);
          material.emissive.setHex(0x2244aa);
        } else {
          material.wireframe = false;
          material.emissive.setHex(0x000000);
          this.setStandardMaterialColor(material, layer.text3DProperties.color, 0xffffff);
        }
      } else if (layer.meshType && !layer.modelUrl) {
        const meshKey = `primitive:${layer.meshType}`;
        if (!managed || managed.kind !== 'primitive' || managed.resourceKey !== meshKey) {
          if (managed) this.disposeManagedMesh(managed);
          const geometry = this.createPrimitiveGeometry(T, layer.meshType);
          const material = new T.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.3,
            roughness: 0.6,
          });
          const mesh = new T.Mesh(geometry, material);
          managed = {
            mesh,
            kind: 'primitive',
            layerId: layer.layerId,
            planeW: 1,
            planeH: 1,
            resourceKey: meshKey,
          };
          this.meshes.set(layer.layerId, managed);
          this.scene.add(mesh);
        }

        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshStandardMaterial;
        if (layer.wireframe) {
          material.wireframe = true;
          material.color.setHex(0x4488ff);
          material.emissive.setHex(0x2244aa);
        } else {
          material.wireframe = false;
          material.color.setHex(0xaaaaaa);
          material.emissive.setHex(0x000000);
        }
      } else if (layer.modelUrl) {
        if (layer.modelFileName) {
          this.setModelFileName(layer.modelUrl, layer.modelFileName);
        }

        if (!managed || managed.kind !== 'model' || managed.resourceKey !== layer.modelUrl) {
          this.loadModel(T, layer.layerId, layer.modelUrl);
          const cachedGroup = modelCache.get(layer.modelUrl);
          if (cachedGroup) {
            if (managed) this.disposeManagedMesh(managed);
            const group = cachedGroup.clone();
            managed = {
              mesh: group,
              kind: 'model',
              layerId: layer.layerId,
              planeW: 1,
              planeH: 1,
              resourceKey: layer.modelUrl,
            };
            this.meshes.set(layer.layerId, managed);
            this.scene.add(group);
          } else {
            continue;
          }
        }

        if (managed?.kind === 'model') {
          (managed.mesh as import('three').Group).traverse((child) => {
            const mesh = child as import('three').Mesh;
            if (!mesh.isMesh) return;
            const material = mesh.material as import('three').MeshStandardMaterial;
            if (layer.wireframe) {
              material.wireframe = true;
              material.color.setHex(0x4488ff);
              material.emissive.setHex(0x2244aa);
            } else {
              material.wireframe = false;
            }
          });
        }
      } else {
        if (!managed || managed.kind !== 'plane') {
          if (managed) this.disposeManagedMesh(managed);
          managed = this.createMeshForLayer(T, layer, planeW, planeH);
          this.meshes.set(layer.layerId, managed);
          this.scene.add(managed.mesh);
        } else if (managed.planeW !== planeW || managed.planeH !== planeH) {
          (managed.mesh as import('three').Mesh).geometry.dispose();
          (managed.mesh as import('three').Mesh).geometry = new T.PlaneGeometry(planeW, planeH);
          managed.planeW = planeW;
          managed.planeH = planeH;
        }

        this.updateTextureSource(T, managed, layer);
      }

      if (!managed) continue;

      const halfWorldW = (worldHeight * outputAspect) / 2;
      const halfWorldH = worldHeight / 2;
      const position = this.getLayerPosition(layer);
      const scale = this.getLayerScale(layer);
      const rotation = this.getLayerRotationRadians(layer);
      managed.mesh.position.set(
        position.x * halfWorldW,
        -position.y * halfWorldH,
        position.z,
      );

      managed.mesh.rotation.order = 'ZYX';
      managed.mesh.rotation.set(
        -rotation.x,
        rotation.y,
        rotation.z,
      );

      managed.mesh.scale.set(
        scale.x,
        scale.y,
        scale.z,
      );

      if (managed.kind !== 'plane' && layerEffectors.length > 0) {
        const effectedTransform = applyThreeDEffectorsToObjectTransform({
          position: {
            x: managed.mesh.position.x,
            y: managed.mesh.position.y,
            z: managed.mesh.position.z,
          },
          rotation: {
            x: managed.mesh.rotation.x,
            y: managed.mesh.rotation.y,
            z: managed.mesh.rotation.z,
          },
          scale: {
            x: managed.mesh.scale.x,
            y: managed.mesh.scale.y,
            z: managed.mesh.scale.z,
          },
        }, layerEffectors, layer.layerId);

        managed.mesh.position.set(
          effectedTransform.position.x,
          effectedTransform.position.y,
          effectedTransform.position.z,
        );
        managed.mesh.rotation.set(
          effectedTransform.rotation.x,
          effectedTransform.rotation.y,
          effectedTransform.rotation.z,
        );
        managed.mesh.scale.set(
          effectedTransform.scale.x,
          effectedTransform.scale.y,
          effectedTransform.scale.z,
        );
      }

      if (managed.kind === 'model') {
        (managed.mesh as import('three').Group).traverse((child) => {
          if (!(child as import('three').Mesh).isMesh) return;
          const material = (child as import('three').Mesh).material as import('three').MeshStandardMaterial;
          material.opacity = layer.opacity;
          material.transparent = layer.opacity < 1;
        });
        managed.mesh.visible = layer.opacity > 0;
      } else if (managed.kind === 'plane') {
        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshBasicMaterial;
        material.opacity = layer.opacity;
        // Text and image planes can carry their own alpha even at opacity 1.
        // Turning transparency off here makes the plane render as an opaque black quad.
        material.transparent = true;
        material.visible = layer.opacity > 0;
      } else {
        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshStandardMaterial;
        material.opacity = layer.opacity;
        material.transparent = layer.opacity < 1 || material.wireframe;
        material.visible = layer.opacity > 0;
      }
    }

    for (const [layerId, managed] of this.meshes) {
      if (!activeLayerIds.has(layerId)) {
        this.disposeManagedMesh(managed);
        this.meshes.delete(layerId);
      }
    }

    for (const [layerId, managed] of this.splatObjects) {
      if (!activeLayerIds.has(layerId)) {
        this.disposeManagedSplat(managed);
        this.splatObjects.delete(layerId);
      }
    }

    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  getSplatBounds(layerId: string): { min: [number, number, number]; max: [number, number, number] } | undefined {
    return this.splatObjects.get(layerId)?.bounds ?? undefined;
  }

  private getEffectorModeId(mode: SplatEffectorRuntimeData['mode']): number {
    switch (mode) {
      case 'attract':
        return 1;
      case 'swirl':
        return 2;
      case 'noise':
        return 3;
      case 'repel':
      default:
        return 0;
    }
  }

  private applySplatEffectors(managed: ManagedSplat, effectors: SplatEffectorRuntimeData[]): void {
    if (!this.THREE) return;

    const count = Math.min(effectors.length, MAX_SPLAT_EFFECTORS);
    const { uEffectorCount, uEffectorPosRadius, uEffectorAxisStrength, uEffectorParamsA, uEffectorParamsB } =
      managed.material.uniforms;

    uEffectorCount.value = count;

    const meshWorldScale = new this.THREE.Vector3();
    const meshWorldQuaternion = new this.THREE.Quaternion();
    const inverseMeshWorldQuaternion = new this.THREE.Quaternion();
    const worldPosition = new this.THREE.Vector3();
    const localPosition = new this.THREE.Vector3();
    const effectorAxis = new this.THREE.Vector3(0, 0, 1);
    const localAxis = new this.THREE.Vector3();
    const effectorEuler = new this.THREE.Euler();
    const effectorQuaternion = new this.THREE.Quaternion();

    managed.mesh.updateMatrixWorld(true);
    managed.mesh.getWorldScale(meshWorldScale);
    managed.mesh.getWorldQuaternion(meshWorldQuaternion);
    inverseMeshWorldQuaternion.copy(meshWorldQuaternion).invert();

    const meshScaleNormalizer = Math.max(
      Math.abs(meshWorldScale.x),
      Math.abs(meshWorldScale.y),
      Math.abs(meshWorldScale.z),
      0.0001,
    );

    for (let i = 0; i < MAX_SPLAT_EFFECTORS; i += 1) {
      const posRadius = uEffectorPosRadius.value[i];
      const axisStrength = uEffectorAxisStrength.value[i];
      const paramsA = uEffectorParamsA.value[i];
      const paramsB = uEffectorParamsB.value[i];

      if (i >= count) {
        posRadius.set(0, 0, 0, 0);
        axisStrength.set(0, 0, 0, 0);
        paramsA.set(0, 0, 0, 0);
        paramsB.set(0, 0, 0, 0);
        continue;
      }

      const effector = effectors[i];
      worldPosition.set(effector.position.x, effector.position.y, effector.position.z);
      localPosition.copy(worldPosition);
      managed.mesh.worldToLocal(localPosition);

      effectorEuler.set(
        (-effector.rotation.x * Math.PI) / 180,
        (effector.rotation.y * Math.PI) / 180,
        (effector.rotation.z * Math.PI) / 180,
        'ZYX',
      );
      effectorQuaternion.setFromEuler(effectorEuler);
      localAxis.copy(effectorAxis)
        .applyQuaternion(effectorQuaternion)
        .applyQuaternion(inverseMeshWorldQuaternion)
        .normalize();

      const localRadius = Math.max(Math.abs(effector.radius) / meshScaleNormalizer, 0.0001);
      const localStrength = (effector.strength * 0.01) / meshScaleNormalizer;

      posRadius.set(localPosition.x, localPosition.y, localPosition.z, localRadius);
      axisStrength.set(localAxis.x, localAxis.y, localAxis.z, localStrength);
      paramsA.set(
        Math.max(0.001, effector.falloff),
        Math.max(0, effector.speed),
        effector.seed,
        this.getEffectorModeId(effector.mode),
      );
      paramsB.set(effector.time, 0, 0, 0);
    }
  }

  private syncSplatLayer(
    layer: Layer3DData,
    outputAspect: number,
    worldHeight: number,
    effectors: SplatEffectorRuntimeData[],
    realtimePlayback: boolean,
  ): void {
    if (!this.scene || !this.THREE) return;

    let managed = this.splatObjects.get(layer.layerId);
    const isSequence = this.isSequenceSplatLayer(layer);
    const requestedMaxSplats = this.getEffectiveSplatRequestedMaxSplats(layer);
    const sourceOptions = this.getSplatRuntimeSourceOptions(layer);
    const cachedTargetRuntime = !isSequence && !realtimePlayback
      ? getPreparedSplatRuntimeSync({ ...sourceOptions, variant: 'target' })
      : null;
    const cachedBaseRuntime = getPreparedSplatRuntimeSync({ ...sourceOptions, variant: 'base' });
    const needsManagedRebuild =
      !managed ||
      managed.rendererRevision !== THREE_SPLAT_RENDERER_REVISION ||
      managed.requestedMaxSplats !== requestedMaxSplats ||
      (!isSequence && managed.splatUrl !== layer.gaussianSplatUrl);
    if (needsManagedRebuild) {
      if (managed) {
        this.disposeManagedSplat(managed);
      }

      managed = this.createManagedSplat(this.THREE, layer.layerId);
      const managedRef = managed;
      managed.splatUrl = layer.gaussianSplatUrl;
      managed.sourceCacheKey = sourceOptions.cacheKey;
      this.splatObjects.set(layer.layerId, managed);
      this.scene.add(managed.mesh);

      if (layer.gaussianSplatUrl) {
        if (cachedTargetRuntime) {
          this.applyPreparedSplatRuntime(this.THREE, managedRef, layer, cachedTargetRuntime);
        } else if (cachedBaseRuntime) {
          this.applyPreparedSplatRuntime(this.THREE, managedRef, layer, cachedBaseRuntime);
        } else {
          managed.loadPromise = this.populateSplatGeometry(this.THREE, managedRef, layer)
            .catch((error) => {
              log.error('Failed to build Three.js gaussian splat mesh', {
                layerId: layer.layerId,
                fileName: layer.gaussianSplatFileName,
                error,
              });
            })
            .finally(() => {
              managedRef.loadPromise = null;
            });
        }
      }
    } else if (managed && isSequence && managed.sourceCacheKey !== sourceOptions.cacheKey) {
      managed.splatUrl = layer.gaussianSplatUrl;
      managed.sourceCacheKey = sourceOptions.cacheKey;
      if (!managed.loadPromise && layer.gaussianSplatUrl) {
        if (cachedBaseRuntime) {
          this.applyPreparedSplatRuntime(this.THREE, managed, layer, cachedBaseRuntime);
        } else {
          const managedRef = managed;
          managed.loadPromise = this.populateSplatGeometry(this.THREE, managedRef, layer)
            .catch((error) => {
              log.error('Failed to swap Three.js gaussian splat sequence frame', {
                layerId: layer.layerId,
                fileName: layer.gaussianSplatFileName,
                error,
              });
            })
            .finally(() => {
              managedRef.loadPromise = null;
            });
        }
      }
    }

    if (managed && layer.gaussianSplatUrl && managed.splatCount === 0 && !managed.loadPromise) {
      const managedRef = managed;
      log.warn('Retrying empty Three.js splat mesh build', {
        layerId: layer.layerId,
        clipId: layer.clipId,
        fileName: layer.gaussianSplatFileName,
      });
      if (cachedTargetRuntime) {
        this.applyPreparedSplatRuntime(this.THREE, managedRef, layer, cachedTargetRuntime);
      } else {
        managed.loadPromise = this.populateSplatGeometry(this.THREE, managedRef, layer)
          .catch((error) => {
            log.error('Failed to rebuild Three.js gaussian splat mesh', {
              layerId: layer.layerId,
              fileName: layer.gaussianSplatFileName,
              error,
            });
          })
          .finally(() => {
            managedRef.loadPromise = null;
          });
      }
    }

    if (!managed) {
      return;
    }

    const halfWorldW = (worldHeight * outputAspect) / 2;
    const halfWorldH = worldHeight / 2;
    const position = this.getLayerPosition(layer);
    const scale = this.getLayerScale(layer);
    const rotation = this.getLayerRotationRadians(layer);
    const orientationOffset = this.getGaussianSplatOrientationOffset(layer);
    managed.mesh.position.set(
      position.x * halfWorldW,
      -position.y * halfWorldH,
      position.z,
    );
    managed.mesh.rotation.order = 'ZYX';
    managed.mesh.rotation.set(
      -rotation.x + orientationOffset.x,
      rotation.y + orientationOffset.y,
      rotation.z + orientationOffset.z,
    );
    managed.mesh.scale.set(
      scale.x,
      scale.y,
      scale.z,
    );
    managed.mesh.visible = layer.opacity > 0;
    managed.material.uniforms.uOpacity.value = layer.opacity;
    managed.material.uniforms.uViewportSize.value.set(Math.max(this.width, 1), Math.max(this.height, 1));
    managed.material.uniforms.uSplatScale.value = layer.gaussianSplatSettings?.render?.splatScale ?? 1;
    this.applySplatEffectors(managed, effectors);
    const preciseSorting = layer.preciseSplatSorting === true;
    managed.sortFrequency = preciseSorting
      ? 1
      : Math.max(
          0,
          isSequence && realtimePlayback
            ? Math.max(
                layer.gaussianSplatSettings?.render?.sortFrequency ?? 1,
                THREE_SPLAT_SEQUENCE_MIN_SORT_FREQUENCY,
              )
            : (layer.gaussianSplatSettings?.render?.sortFrequency ?? 1),
        );
    if (managed.splatCount > 0) {
      this.advanceStagedSplatUpgrade(managed, realtimePlayback);
      this.updateSplatSort(managed, preciseSorting, realtimePlayback, preciseSorting);
    }
  }

  private getText3DFont(
    fontFamily: 'helvetiker' | 'optimer' | 'gentilis',
    fontWeight: 'regular' | 'bold',
  ): ParsedText3DFont {
    const cacheKey = `${fontFamily}:${fontWeight}`;
    const cached = text3DFontCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const font = text3DFontLoader.parse(TEXT_3D_FONT_DATA[fontFamily][fontWeight] as any);
    text3DFontCache.set(cacheKey, font);
    return font;
  }

  private getText3DGeometryKey(layer: Layer3DData): string {
    const props = layer.text3DProperties;
    if (!props) {
      return 'text3d:missing';
    }

    return JSON.stringify({
      text: props.text,
      fontFamily: props.fontFamily,
      fontWeight: props.fontWeight,
      size: props.size,
      depth: props.depth,
      letterSpacing: props.letterSpacing,
      lineHeight: props.lineHeight,
      textAlign: props.textAlign,
      curveSegments: props.curveSegments,
      bevelEnabled: props.bevelEnabled,
      bevelThickness: props.bevelThickness,
      bevelSize: props.bevelSize,
      bevelSegments: props.bevelSegments,
    });
  }

  private createText3DGeometry(T: THREE, layer: Layer3DData): import('three').BufferGeometry {
    const props = layer.text3DProperties;
    if (!props) {
      return new T.BoxGeometry(0.001, 0.001, 0.001);
    }

    const font = this.getText3DFont(props.fontFamily, props.fontWeight);
    const lines = (props.text || '3D Text').split(/\r?\n/);
    const textOptions = {
      font,
      size: props.size,
      depth: props.depth,
      curveSegments: Math.max(1, Math.round(props.curveSegments)),
      bevelEnabled: props.bevelEnabled,
      bevelThickness: props.bevelThickness,
      bevelSize: props.bevelSize,
      bevelSegments: Math.max(1, Math.round(props.bevelSegments)),
    };
    const lineAdvance = props.size * props.lineHeight;
    const letterSpacing = props.letterSpacing;
    const spaceAdvance = props.size * 0.35 + letterSpacing;
    const lineGeometries: import('three').BufferGeometry[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? '';
      const characterGeometries: import('three').BufferGeometry[] = [];
      let cursorX = 0;

      for (const character of line) {
        if (character === ' ') {
          cursorX += spaceAdvance;
          continue;
        }

        const charGeometry = new TextGeometry(character, textOptions);
        charGeometry.computeBoundingBox();
        const bbox = charGeometry.boundingBox;
        const width = bbox ? bbox.max.x - bbox.min.x : props.size * 0.4;
        const minX = bbox?.min.x ?? 0;

        charGeometry.translate(cursorX - minX, 0, 0);
        characterGeometries.push(charGeometry);
        cursorX += width + letterSpacing;
      }

      const trimmedLineWidth = cursorX > 0 ? cursorX - letterSpacing : 0;
      const mergedLineGeometry = characterGeometries.length > 0
        ? mergeGeometries(characterGeometries, false)
        : new T.BoxGeometry(0.001, 0.001, 0.001);

      if (!mergedLineGeometry) {
        continue;
      }

      const alignOffsetX = props.textAlign === 'left'
        ? 0
        : props.textAlign === 'right'
          ? -trimmedLineWidth
          : -trimmedLineWidth / 2;

      mergedLineGeometry.translate(alignOffsetX, -lineIndex * lineAdvance, 0);
      lineGeometries.push(mergedLineGeometry);
    }

    const mergedGeometry = lineGeometries.length > 0
      ? mergeGeometries(lineGeometries, false)
      : null;

    if (!mergedGeometry) {
      return new T.BoxGeometry(0.001, 0.001, 0.001);
    }

    mergedGeometry.computeBoundingBox();
    const bbox = mergedGeometry.boundingBox;
    if (bbox) {
      mergedGeometry.translate(
        -(bbox.min.x + bbox.max.x) / 2,
        -(bbox.min.y + bbox.max.y) / 2,
        -(bbox.min.z + bbox.max.z) / 2,
      );
    }

    return mergedGeometry;
  }

  private setStandardMaterialColor(
    material: import('three').MeshStandardMaterial,
    color: string | undefined,
    fallbackHex = 0xaaaaaa,
  ): void {
    try {
      material.color.set(color || '#ffffff');
    } catch {
      material.color.setHex(fallbackHex);
    }
  }

  private createPrimitiveGeometry(T: THREE, meshType: string): import('three').BufferGeometry {
    switch (meshType) {
      case 'cube':
        return new T.BoxGeometry(0.6, 0.6, 0.6);
      case 'sphere':
        return new T.SphereGeometry(0.35, 32, 24);
      case 'plane':
        return new T.PlaneGeometry(0.8, 0.8);
      case 'cylinder':
        return new T.CylinderGeometry(0.25, 0.25, 0.6, 32);
      case 'torus':
        return new T.TorusGeometry(0.3, 0.1, 16, 48);
      case 'cone':
        return new T.ConeGeometry(0.3, 0.6, 32);
      case 'text3d':
        return new T.BoxGeometry(0.001, 0.001, 0.001);
      default:
        return new T.BoxGeometry(0.6, 0.6, 0.6);
    }
  }

  setModelFileName(url: string, fileName: string): void {
    this.modelFileNames.set(url, fileName);
  }

  async preloadModel(url: string, fileName?: string): Promise<boolean> {
    if (!url) return false;
    if (fileName) {
      this.setModelFileName(url, fileName);
    }

    if (!this.THREE) {
      const initialized = await this.initialize(Math.max(this.width, 1), Math.max(this.height, 1));
      if (!initialized || !this.THREE) {
        return false;
      }
    }

    await this.loadModel(this.THREE, '__preload__', url);
    return modelCache.has(url);
  }

  private async loadModel(T: THREE, _layerId: string, url: string): Promise<void> {
    if (modelCache.has(url) || modelLoading.has(url)) return;
    modelLoading.add(url);

    try {
      const fileName = this.modelFileNames.get(url) || url;
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      let group: import('three').Group;

      if (ext === 'obj') {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        group = await loader.loadAsync(url);
      } else {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        group = gltf.scene;
      }

      const box = new T.Box3().setFromObject(group);
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      group.position.sub(center);
      group.scale.multiplyScalar(1 / maxDim);

      const defaultMaterial = new T.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.5,
        metalness: 0.3,
      });
      group.traverse((child) => {
        const mesh = child as import('three').Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as import('three').MeshStandardMaterial;
        if (!material.map && (!material.color || material.color.getHex() === 0xffffff)) {
          mesh.material = defaultMaterial.clone();
        }
      });

      modelCache.set(url, group);
      modelLoading.delete(url);
      log.info('3D model loaded', {
        url: url.substring(0, 50),
        ext,
        vertices: this.countVertices(group),
      });
    } catch (err) {
      log.error('Failed to load 3D model', err);
      modelLoading.delete(url);
    }
  }

  private countVertices(obj: import('three').Object3D): number {
    let count = 0;
    obj.traverse((child) => {
      const mesh = child as import('three').Mesh;
      if (mesh.isMesh && mesh.geometry) {
        count += mesh.geometry.attributes.position?.count ?? 0;
      }
    });
    return count;
  }

  private createMeshForLayer(T: THREE, layer: Layer3DData, planeW: number, planeH: number): ManagedMesh {
    const geometry = new T.PlaneGeometry(planeW, planeH);
    const material = new T.MeshBasicMaterial({
      side: T.DoubleSide,
      transparent: true,
      opacity: layer.opacity,
    });
    const mesh = new T.Mesh(geometry, material);
    const texture = new T.Texture();

    return {
      mesh,
      texture,
      kind: 'plane',
      layerId: layer.layerId,
      lastSourceType: null,
      planeW,
      planeH,
    };
  }

  private updateTextureSource(T: THREE, managed: ManagedMesh, layer: Layer3DData): void {
    const mesh = managed.mesh as import('three').Mesh;
    const material = mesh.material as import('three').MeshBasicMaterial;
    if (!managed.texture) {
      managed.texture = new T.Texture();
    }

    if (layer.videoElement) {
      const useCanvasSampling = layer.preciseVideoSampling === true;
      if (useCanvasSampling) {
        const targetWidth = Math.max(
          1,
          Math.floor(layer.videoElement.videoWidth || layer.sourceWidth || 1),
        );
        const targetHeight = Math.max(
          1,
          Math.floor(layer.videoElement.videoHeight || layer.sourceHeight || 1),
        );

        if (
          !managed.videoCanvas ||
          managed.videoCanvas.width !== targetWidth ||
          managed.videoCanvas.height !== targetHeight
        ) {
          managed.videoCanvas = document.createElement('canvas');
          managed.videoCanvas.width = targetWidth;
          managed.videoCanvas.height = targetHeight;
        }

        if (
          managed.lastSourceType !== 'video-canvas' ||
          (managed.texture as { image?: unknown }).image !== managed.videoCanvas
        ) {
          managed.texture.dispose();
          managed.texture = new T.CanvasTexture(managed.videoCanvas);
          managed.texture.colorSpace = T.SRGBColorSpace;
          material.map = managed.texture;
          material.needsUpdate = true;
          managed.lastSourceType = 'video-canvas';
        }

        const ctx = managed.videoCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false,
        });
        if (ctx && layer.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            ctx.clearRect(0, 0, managed.videoCanvas.width, managed.videoCanvas.height);
            ctx.drawImage(layer.videoElement, 0, 0, managed.videoCanvas.width, managed.videoCanvas.height);
            managed.texture.needsUpdate = true;
          } catch (error) {
            log.warn('Failed to draw precise video frame for 3D layer', {
              layerId: layer.layerId,
              error,
            });
          }
        }
      } else {
        if (managed.lastSourceType !== 'video' || (managed.texture as { image?: unknown }).image !== layer.videoElement) {
          managed.texture.dispose();
          managed.texture = new T.VideoTexture(layer.videoElement);
          managed.texture.colorSpace = T.SRGBColorSpace;
          material.map = managed.texture;
          material.needsUpdate = true;
          managed.lastSourceType = 'video';
        }
        managed.texture.needsUpdate = true;
      }
    } else if (layer.imageElement) {
      if (managed.lastSourceType !== 'image' || (managed.texture as { image?: unknown }).image !== layer.imageElement) {
        managed.texture.dispose();
        managed.texture = new T.Texture(layer.imageElement);
        managed.texture.colorSpace = T.SRGBColorSpace;
        managed.texture.needsUpdate = true;
        material.map = managed.texture;
        material.needsUpdate = true;
        managed.lastSourceType = 'image';
      }
    } else if (layer.canvas) {
      if (managed.lastSourceType !== 'canvas' || (managed.texture as { image?: unknown }).image !== layer.canvas) {
        managed.texture.dispose();
        managed.texture = new T.CanvasTexture(layer.canvas);
        managed.texture.colorSpace = T.SRGBColorSpace;
        material.map = managed.texture;
        material.needsUpdate = true;
        managed.lastSourceType = 'canvas';
      } else {
        managed.texture.needsUpdate = true;
      }
    }
  }

  private disposeManagedMeshById(layerId: string): void {
    const managed = this.meshes.get(layerId);
    if (!managed) return;
    this.disposeManagedMesh(managed);
    this.meshes.delete(layerId);
  }

  private disposeManagedMesh(managed: ManagedMesh): void {
    this.scene?.remove(managed.mesh);
    if (managed.kind === 'model') {
      return;
    }

    managed.texture?.dispose();
    const mesh = managed.mesh as import('three').Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material.dispose());
    } else {
      mesh.material.dispose();
    }
    mesh.geometry.dispose();
  }

  private disposeManagedSplatById(layerId: string): void {
    const managed = this.splatObjects.get(layerId);
    if (!managed) return;
    this.disposeManagedSplat(managed);
    this.splatObjects.delete(layerId);
  }

  private disposeManagedSplat(managed: ManagedSplat): void {
    this.scene?.remove(managed.mesh);
    managed.centerOpacityTexture.dispose();
    managed.colorTexture.dispose();
    managed.axisXTexture.dispose();
    managed.axisYTexture.dispose();
    managed.axisZTexture.dispose();
    managed.orderTexture.dispose();
    managed.material.dispose();
    managed.geometry.dispose();
  }

  clearScene(): void {
    if (!this.scene) return;

    for (const [, managed] of this.meshes) {
      this.disposeManagedMesh(managed);
    }
    this.meshes.clear();

    for (const [, managed] of this.splatObjects) {
      this.disposeManagedSplat(managed);
    }
    this.splatObjects.clear();
  }

  dispose(): void {
    this.clearScene();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.initialized = false;
    log.info('ThreeSceneRenderer disposed');
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

let instance: ThreeSceneRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    instance?.dispose();
    instance = null;
  });
}

export function getThreeSceneRenderer(): ThreeSceneRenderer {
  if (!instance) {
    instance = new ThreeSceneRenderer();
  }
  return instance;
}
