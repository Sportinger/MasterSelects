export interface GlyphAtlasOptions {
  fontFamily: string;
  charset: string;
  cellSize: number;
  fontWeight?: number;
}

export interface GlyphAtlasPlan {
  glyphs: string[];
  columns: number;
  rows: number;
  cellSize: number;
  width: number;
  height: number;
}

export interface GlyphAtlasTexture extends GlyphAtlasPlan {
  texture: GPUTexture;
  view: GPUTextureView;
}

export function planGlyphAtlas(options: GlyphAtlasOptions): GlyphAtlasPlan {
  const glyphs = Array.from(options.charset || ' ');
  const cellSize = Math.max(8, Math.min(128, Math.round(options.cellSize)));
  const columns = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
  const rows = Math.max(1, Math.ceil(glyphs.length / columns));
  return { glyphs, columns, rows, cellSize, width: columns * cellSize, height: rows * cellSize };
}

function cacheKey(options: GlyphAtlasOptions): string {
  return JSON.stringify([
    options.fontFamily,
    options.fontWeight ?? 600,
    options.charset,
    Math.max(8, Math.min(128, Math.round(options.cellSize))),
  ]);
}

class GlyphAtlasRuntime {
  private atlases = new Map<GPUDevice, Map<string, GlyphAtlasTexture>>();

  get(device: GPUDevice, options: GlyphAtlasOptions): GlyphAtlasTexture {
    let deviceAtlases = this.atlases.get(device);
    if (!deviceAtlases) {
      deviceAtlases = new Map();
      this.atlases.set(device, deviceAtlases);
    }
    const key = cacheKey(options);
    const cached = deviceAtlases.get(key);
    if (cached) return cached;

    const plan = planGlyphAtlas(options);
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas is unavailable for glyph atlas generation');
    context.clearRect(0, 0, plan.width, plan.height);
    context.fillStyle = '#ffffff';
    context.font = `${options.fontWeight ?? 600} ${Math.floor(plan.cellSize * 0.76)}px ${options.fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (let index = 0; index < plan.glyphs.length; index++) {
      const glyph = plan.glyphs[index];
      const column = index % plan.columns;
      const row = Math.floor(index / plan.columns);
      const centerX = column * plan.cellSize + plan.cellSize / 2;
      const centerY = row * plan.cellSize + plan.cellSize / 2;
      const measured = Math.max(1, context.measureText(glyph).width);
      const scaleX = Math.min(1, plan.cellSize * 0.82 / measured);
      context.save();
      context.translate(centerX, centerY);
      context.scale(scaleX, 1);
      context.fillText(glyph, 0, 0);
      context.restore();
    }

    const texture = device.createTexture({
      label: `glyph-atlas-${key.slice(0, 48)}`,
      size: [plan.width, plan.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [plan.width, plan.height]);
    const atlas: GlyphAtlasTexture = { ...plan, texture, view: texture.createView() };
    deviceAtlases.set(key, atlas);
    return atlas;
  }

  releaseDevice(device: GPUDevice): void {
    const deviceAtlases = this.atlases.get(device);
    if (!deviceAtlases) return;
    for (const atlas of deviceAtlases.values()) atlas.texture.destroy();
    this.atlases.delete(device);
  }
}

interface GlyphAtlasHotData { runtime?: GlyphAtlasRuntime }
const hotData = import.meta.hot?.data as GlyphAtlasHotData | undefined;
const runtime = hotData?.runtime ?? new GlyphAtlasRuntime();

export function getGlyphAtlas(device: GPUDevice, options: GlyphAtlasOptions): GlyphAtlasTexture {
  return runtime.get(device, options);
}

export function releaseGlyphAtlasesForDevice(device: GPUDevice | null): void {
  if (device) runtime.releaseDevice(device);
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: GlyphAtlasHotData) => { data.runtime = runtime; });
}
