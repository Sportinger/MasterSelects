// Three.js 3D Scene Renderer — renders 3D-enabled layers to an OffscreenCanvas
// The output is imported into the existing WebGPU compositor as a texture.

import { Logger } from '../../services/logger';
import type { Layer3DData, CameraConfig } from './types';
import { DEFAULT_CAMERA_CONFIG } from './types';

const log = Logger.create('ThreeSceneRenderer');

// Lazy-loaded Three.js module reference
type THREE = typeof import('three');

/** Managed mesh for a single 3D layer */
interface ManagedMesh {
  mesh: import('three').Mesh | import('three').Group;
  texture: import('three').Texture | import('three').VideoTexture;
  layerId: string;
  lastSourceType: 'video' | 'image' | 'canvas' | 'model' | null;
  planeW: number;  // Current geometry width in world units
  planeH: number;  // Current geometry height in world units
  isModel?: boolean;
  modelUrl?: string;  // Track which URL was loaded
}

/** Cache for loaded 3D models (don't reload every frame) */
const modelCache = new Map<string, import('three').Group>();
/** Track URLs currently being loaded to prevent duplicate loads */
const modelLoading = new Set<string>();

export class ThreeSceneRenderer {
  private THREE: THREE | null = null;
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private canvas: OffscreenCanvas | null = null;
  private meshes: Map<string, ManagedMesh> = new Map();
  private width = 0;
  private height = 0;
  private initialized = false;

  async initialize(width: number, height: number): Promise<boolean> {
    if (this.initialized && this.width === width && this.height === height) {
      return true;
    }

    try {
      // Dynamic import — code-split, only loaded on first 3D layer
      if (!this.THREE) {
        log.info('Loading Three.js...');
        this.THREE = await import('three');
        log.info('Three.js loaded', { version: this.THREE.REVISION });
      }

      const T = this.THREE;
      this.width = width;
      this.height = height;

      if (!this.canvas) {
        this.canvas = new OffscreenCanvas(width, height);
      } else {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      // Use WebGL renderer with OffscreenCanvas
      // WebGPURenderer in Three.js is still experimental and has device sharing issues.
      // WebGL on OffscreenCanvas → copyExternalImageToTexture works reliably.
      if (!this.renderer) {
        this.renderer = new T.WebGLRenderer({
          canvas: this.canvas as unknown as HTMLCanvasElement,
          alpha: true,
          antialias: true,
          premultipliedAlpha: false, // Straight alpha — compositor expects non-premultiplied
        });
        this.renderer.setClearColor(0x000000, 0); // transparent background
      }
      this.renderer.setSize(width, height, false);

      if (!this.scene) {
        this.scene = new T.Scene();
        // Add lighting for 3D models (doesn't affect MeshBasicMaterial planes)
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

  /**
   * Calculate the camera Z distance so that a plane of height `planeH`
   * exactly fills the viewport vertically at the given FOV.
   *   visibleHeight = 2 * z * tan(fov/2)  →  z = planeH / (2 * tan(fov/2))
   */
  private getCameraZForFill(fovDeg: number, planeH: number): number {
    return planeH / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
  }

  /**
   * Render all 3D layers and return the OffscreenCanvas.
   * The caller imports this canvas into the WebGPU compositor via copyExternalImageToTexture.
   */
  renderScene(
    layers: Layer3DData[],
    cameraConfig: CameraConfig,
    width: number,
    height: number,
  ): OffscreenCanvas | null {
    if (!this.initialized || !this.THREE || !this.renderer || !this.scene || !this.camera) {
      return null;
    }

    const T = this.THREE;
    const outputAspect = width / Math.max(height, 1);

    // Resize if needed
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      if (this.canvas) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.renderer.setSize(width, height, false);
    }

    // Camera setup:
    // We define the "world" so that the output viewport spans exactly 2 units tall
    // (from -1 to +1 in Y). This matches MasterSelects' normalized coordinate system
    // where position 1.0 = half the composition height.
    const worldHeight = 2.0; // viewport is -1..+1 in Y
    const fov = cameraConfig.fov;
    const defaultCameraZ = this.getCameraZForFill(fov, worldHeight);

    this.camera.fov = fov;
    this.camera.aspect = outputAspect;
    this.camera.near = cameraConfig.near;
    this.camera.far = cameraConfig.far;
    this.camera.position.set(
      cameraConfig.position.x,
      cameraConfig.position.y,
      cameraConfig.position.z + defaultCameraZ,
    );
    this.camera.lookAt(
      cameraConfig.target.x,
      cameraConfig.target.y,
      cameraConfig.target.z,
    );
    this.camera.updateProjectionMatrix();

    // Track which layers are still active (to remove stale meshes)
    const activeLayerIds = new Set<string>();

    // Sync layers → Three.js meshes
    for (const layer of layers) {
      activeLayerIds.add(layer.layerId);
      let managed = this.meshes.get(layer.layerId);

      // Calculate plane dimensions in world units.
      // A plane at default scale should fill the viewport exactly, matching 2D behavior.
      // The viewport is worldHeight (2.0) tall and worldHeight*outputAspect wide.
      const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
      let planeW: number, planeH: number;
      if (sourceAspect >= outputAspect) {
        // Source is wider → fit to width, letterbox top/bottom
        planeW = worldHeight * outputAspect;
        planeH = planeW / sourceAspect;
      } else {
        // Source is taller → fit to height, pillarbox sides
        planeH = worldHeight;
        planeW = planeH * sourceAspect;
      }

      // === Primitive mesh layers (cube, sphere, etc.) ===
      if (layer.meshType && !layer.modelUrl) {
        const meshKey = `primitive:${layer.meshType}`;
        if (!managed || managed.modelUrl !== meshKey) {
          if (managed) this.scene.remove(managed.mesh);
          const geometry = this.createPrimitiveGeometry(T, layer.meshType);
          const material = new T.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.3,
            roughness: 0.6,
          });
          const mesh = new T.Mesh(geometry, material);
          managed = {
            mesh,
            texture: new T.Texture(),
            layerId: layer.layerId,
            lastSourceType: 'model',
            planeW: 1,
            planeH: 1,
            isModel: true,
            modelUrl: meshKey,
          };
          this.meshes.set(layer.layerId, managed);
          this.scene.add(mesh);
        }

        // Apply wireframe mode
        const mat = (managed.mesh as import('three').Mesh).material as import('three').MeshStandardMaterial;
        if (layer.wireframe) {
          mat.wireframe = true;
          mat.color.setHex(0x4488ff);
          mat.emissive.setHex(0x2244aa);
        } else {
          mat.wireframe = false;
          mat.color.setHex(0xaaaaaa);
          mat.emissive.setHex(0x000000);
        }
      }
      // === 3D Model layers (file-based) ===
      else if (layer.modelUrl) {
        // Register filename so loader knows the format (blob URLs have no extension)
        if (layer.modelFileName) {
          this.setModelFileName(layer.modelUrl, layer.modelFileName);
        }

        if (!managed || managed.modelUrl !== layer.modelUrl) {
          // Load or use cached model
          this.loadModel(T, layer.layerId, layer.modelUrl);
          const cachedGroup = modelCache.get(layer.modelUrl);
          if (cachedGroup) {
            if (managed) this.scene.remove(managed.mesh);
            const group = cachedGroup.clone();
            managed = {
              mesh: group,
              texture: new T.Texture(),
              layerId: layer.layerId,
              lastSourceType: 'model',
              planeW: 1,
              planeH: 1,
              isModel: true,
              modelUrl: layer.modelUrl,
            };
            this.meshes.set(layer.layerId, managed);
            this.scene.add(group);
          } else {
            // Still loading — skip this frame
            continue;
          }
        }

        // Apply wireframe mode
        if (managed?.isModel) {
          (managed.mesh as import('three').Group).traverse((child) => {
            const mesh = child as import('three').Mesh;
            if (mesh.isMesh) {
              const mat = mesh.material as import('three').MeshStandardMaterial;
              if (layer.wireframe) {
                mat.wireframe = true;
                mat.color.setHex(0x4488ff);
                mat.emissive.setHex(0x2244aa);
              } else {
                mat.wireframe = false;
              }
            }
          });
        }
      }
      // === Textured plane layers (video/image/text) ===
      else {
        if (!managed || managed.isModel) {
          if (managed) this.scene.remove(managed.mesh);
          managed = this.createMeshForLayer(T, layer, planeW, planeH);
          this.meshes.set(layer.layerId, managed);
          this.scene.add(managed.mesh);
        } else if (managed.planeW !== planeW || managed.planeH !== planeH) {
          // Source aspect changed → recreate geometry
          (managed.mesh as import('three').Mesh).geometry.dispose();
          (managed.mesh as import('three').Mesh).geometry = new T.PlaneGeometry(planeW, planeH);
          managed.planeW = planeW;
          managed.planeH = planeH;
        }

        // Update texture source if changed
        this.updateTextureSource(T, managed, layer);
      }

      // Sync transforms — MasterSelects normalized coords → Three.js world coords
      const halfWorldW = (worldHeight * outputAspect) / 2;
      const halfWorldH = worldHeight / 2;
      managed.mesh.position.set(
        layer.position.x * halfWorldW,
        -layer.position.y * halfWorldH,
        layer.position.z,
      );

      // Rotation: values are ALREADY in radians (TransformCache converts deg→rad)
      managed.mesh.rotation.order = 'ZYX';
      managed.mesh.rotation.set(
        -layer.rotation.x,
        layer.rotation.y,
        layer.rotation.z,
      );

      // Scale
      managed.mesh.scale.set(
        layer.scale.x,
        layer.scale.y,
        layer.scale.z,
      );

      // Opacity — for models, traverse all child materials
      if (managed.isModel) {
        (managed.mesh as import('three').Group).traverse((child) => {
          if ((child as import('three').Mesh).isMesh) {
            const mat = (child as import('three').Mesh).material as import('three').MeshStandardMaterial;
            mat.opacity = layer.opacity;
            mat.transparent = layer.opacity < 1;
          }
        });
        managed.mesh.visible = layer.opacity > 0;
      } else {
        const mat = (managed.mesh as import('three').Mesh).material as import('three').MeshBasicMaterial;
        mat.opacity = layer.opacity;
        mat.transparent = layer.opacity < 1;
        mat.visible = layer.opacity > 0;
      }
    }

    // Remove meshes for layers no longer present
    for (const [layerId, managed] of this.meshes) {
      if (!activeLayerIds.has(layerId)) {
        this.scene.remove(managed.mesh);
        if (managed.isModel) {
          // Model groups don't need individual disposal (cached)
        } else {
          managed.texture.dispose();
          ((managed.mesh as import('three').Mesh).material as import('three').MeshBasicMaterial).dispose();
          (managed.mesh as import('three').Mesh).geometry.dispose();
        }
        this.meshes.delete(layerId);
      }
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    return this.canvas;
  }

  /** Create a Three.js geometry for a primitive mesh type */
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
      default:
        return new T.BoxGeometry(0.6, 0.6, 0.6);
    }
  }

  /** Load a 3D model (OBJ/glTF/GLB) and cache it */
  /** Model file name hint — blob URLs have no extension, so we track the original name */
  private modelFileNames: Map<string, string> = new Map();

  /** Register original filename for a blob URL so the loader knows the format */
  setModelFileName(url: string, fileName: string): void {
    this.modelFileNames.set(url, fileName);
  }

  private async loadModel(T: THREE, _layerId: string, url: string): Promise<void> {
    if (modelCache.has(url) || modelLoading.has(url)) return;
    modelLoading.add(url);

    try {
      // Detect format from original filename (blob URLs have no extension)
      const fileName = this.modelFileNames.get(url) || url;
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      let group: import('three').Group;

      if (ext === 'obj') {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        group = await loader.loadAsync(url);
      } else {
        // Default: try glTF/GLB (most common)
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        group = gltf.scene;
      }

      // Center and normalize the model to fit in a unit bounding box
      const box = new T.Box3().setFromObject(group);
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      group.position.sub(center); // center at origin
      group.scale.multiplyScalar(1 / maxDim); // normalize to ~1 unit

      // Apply default material to meshes without proper materials (e.g., OBJ without MTL)
      const defaultMat = new T.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.3 });
      group.traverse((child) => {
        const mesh = child as import('three').Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as import('three').MeshStandardMaterial;
          // Replace default white/blank materials
          if (!mat.map && (!mat.color || mat.color.getHex() === 0xffffff)) {
            mesh.material = defaultMat.clone();
          }
        }
      });

      modelCache.set(url, group);
      modelLoading.delete(url);
      log.info('3D model loaded', { url: url.substring(0, 50), ext, vertices: this.countVertices(group) });
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

    // Create a basic material — will be textured later
    const material = new T.MeshBasicMaterial({
      side: T.DoubleSide,
      transparent: true,
      opacity: layer.opacity,
    });

    const mesh = new T.Mesh(geometry, material);

    // Create placeholder texture
    const texture = new T.Texture();

    return {
      mesh,
      texture,
      layerId: layer.layerId,
      lastSourceType: null,
      planeW,
      planeH,
    };
  }

  private updateTextureSource(T: THREE, managed: ManagedMesh, layer: Layer3DData): void {
    const mesh = managed.mesh as import('three').Mesh;
    const mat = mesh.material as import('three').MeshBasicMaterial;

    if (layer.videoElement) {
      // Use VideoTexture for live video frames
      if (managed.lastSourceType !== 'video' || (managed.texture as any).image !== layer.videoElement) {
        managed.texture.dispose();
        managed.texture = new T.VideoTexture(layer.videoElement);
        managed.texture.colorSpace = T.SRGBColorSpace;
        mat.map = managed.texture;
        mat.needsUpdate = true;
        managed.lastSourceType = 'video';
      }
      // VideoTexture auto-updates, but we need to flag it
      managed.texture.needsUpdate = true;
    } else if (layer.imageElement) {
      if (managed.lastSourceType !== 'image' || (managed.texture as any).image !== layer.imageElement) {
        managed.texture.dispose();
        managed.texture = new T.Texture(layer.imageElement);
        managed.texture.colorSpace = T.SRGBColorSpace;
        managed.texture.needsUpdate = true;
        mat.map = managed.texture;
        mat.needsUpdate = true;
        managed.lastSourceType = 'image';
      }
    } else if (layer.canvas) {
      if (managed.lastSourceType !== 'canvas' || (managed.texture as any).image !== layer.canvas) {
        managed.texture.dispose();
        managed.texture = new T.CanvasTexture(layer.canvas);
        managed.texture.colorSpace = T.SRGBColorSpace;
        mat.map = managed.texture;
        mat.needsUpdate = true;
        managed.lastSourceType = 'canvas';
      } else {
        // Canvas content may have changed
        managed.texture.needsUpdate = true;
      }
    }
  }

  /** Remove all meshes and reset scene */
  clearScene(): void {
    if (!this.scene) return;
    for (const [, managed] of this.meshes) {
      this.scene.remove(managed.mesh);
      if (!managed.isModel) {
        managed.texture.dispose();
        const mesh = managed.mesh as import('three').Mesh;
        (mesh.material as import('three').MeshBasicMaterial).dispose();
        mesh.geometry.dispose();
      }
    }
    this.meshes.clear();
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

// HMR-safe singleton
let instance: ThreeSceneRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.threeSceneRenderer) {
    instance = import.meta.hot.data.threeSceneRenderer;
  }
  import.meta.hot.dispose((data) => {
    data.threeSceneRenderer = instance;
  });
}

/** Get singleton ThreeSceneRenderer (lazy — does not load Three.js until initialize() is called) */
export function getThreeSceneRenderer(): ThreeSceneRenderer {
  if (!instance) {
    instance = new ThreeSceneRenderer();
  }
  return instance;
}
