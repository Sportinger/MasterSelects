/**
 * GPU-accelerated scope renderer.
 * Delegates to specialized scope classes for each mode.
 */

import { WaveformScope } from './WaveformScope';
import { HistogramScope } from './HistogramScope';
import { VectorscopeScope } from './VectorscopeScope';
import type { ScopeQuality } from '../../stores/settingsStore';

/** Waveform & vectorscope buffer dimensions per quality tier */
const QUALITY_SIZES: Record<ScopeQuality, { wfW: number; wfH: number; vsSize: number }> = {
  low:    { wfW: 1024, wfH: 512,  vsSize: 512 },
  medium: { wfW: 1536, wfH: 768,  vsSize: 768 },
  high:   { wfW: 2048, wfH: 1024, vsSize: 1024 },
};

export class ScopeRenderer {
  private waveform: WaveformScope;
  private histogram: HistogramScope;
  private vectorscope: VectorscopeScope;

  constructor(device: GPUDevice, format: GPUTextureFormat, quality: ScopeQuality = 'low') {
    const sizes = QUALITY_SIZES[quality];
    this.waveform = new WaveformScope(device, format, sizes.wfW, sizes.wfH);
    this.histogram = new HistogramScope(device, format);
    this.vectorscope = new VectorscopeScope(device, format, sizes.vsSize);
  }

  renderWaveform(sourceTexture: GPUTexture, ctx: GPUCanvasContext, mode: number = 0) {
    this.waveform.render(sourceTexture, ctx, mode);
  }

  renderHistogram(sourceTexture: GPUTexture, ctx: GPUCanvasContext, mode: number = 0) {
    this.histogram.render(sourceTexture, ctx, mode);
  }

  renderVectorscope(sourceTexture: GPUTexture, ctx: GPUCanvasContext) {
    this.vectorscope.render(sourceTexture, ctx);
  }

  destroy() {
    this.waveform.destroy();
    this.histogram.destroy();
    this.vectorscope.destroy();
  }
}
