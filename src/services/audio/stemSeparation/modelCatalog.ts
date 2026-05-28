import type { StemModelCatalogEntry } from './types';

export const DEFAULT_STEM_MODEL_ID = 'demucs-htdemucs-web';

export const STEM_MODEL_CATALOG: readonly StemModelCatalogEntry[] = [
  {
    id: DEFAULT_STEM_MODEL_ID,
    label: 'Demucs HTDemucs Web',
    modelVersion: 'timcsy-demucs-web-onnx-htdemucs-embedded-2024-02',
    description: 'Browser-proven HTDemucs ONNX model for four-stem separation.',
    stems: ['drums', 'bass', 'other', 'vocals'],
    inputSampleRate: 44_100,
    outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
    files: [{
      name: 'htdemucs_embedded.onnx',
      sizeBytes: 180_534_758,
      url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    }],
    supportedBackends: ['webgpu', 'wasm'],
    testedBrowserRuntime: true,
    productionDropdown: true,
    license: 'See upstream Hugging Face repository',
    attribution: 'timcsy/demucs-web-onnx',
  },
  {
    id: 'htdemucs-onnx-fp16weights',
    label: 'HTDemucs ONNX FP16 Weights',
    modelVersion: 'stemsplitio-htdemucs-onnx-fp16weights-evaluation',
    description: 'Evaluation candidate with documented browser ONNX usage and four-stem output.',
    stems: ['drums', 'bass', 'other', 'vocals'],
    inputSampleRate: 44_100,
    outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
    files: [{
      name: 'htdemucs_fp16.onnx',
      sizeBytes: 166_000_000,
      url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16.onnx',
    }],
    supportedBackends: ['webgpu', 'wasm'],
    testedBrowserRuntime: false,
    productionDropdown: false,
    license: 'See upstream Hugging Face repository',
    attribution: 'StemSplitio/htdemucs-onnx',
  },
  {
    id: 'bs-polarformer-webgpu-fp16',
    label: 'BS PolarFormer FP16',
    modelVersion: 'bgkb-bs-polarformer-fp16-evaluation',
    description: 'Smaller WebGPU voice-isolation candidate for vocals/instrumental workflows.',
    stems: ['vocals', 'instrumental'],
    inputSampleRate: 44_100,
    outputStemOrder: ['vocals', 'instrumental'],
    files: [{
      name: 'bs_polarformer_fp16.onnx',
      sizeBytes: 108_000_000,
      url: 'https://huggingface.co/bgkb/bs_polarformer/resolve/main/bs_polarformer_fp16.onnx',
    }],
    supportedBackends: ['webgpu'],
    testedBrowserRuntime: false,
    productionDropdown: false,
    license: 'See upstream Hugging Face repository',
    attribution: 'bgkb/bs_polarformer',
  },
  {
    id: 'scnet-xl-ihf-onnx-experimental',
    label: 'SCNet XL IHF Experimental',
    modelVersion: 'zfturbo-scnet-xl-ihf-onnx-spike',
    description: 'Hidden technical spike until ONNX export and browser runtime behavior are proven.',
    stems: ['drums', 'bass', 'other', 'vocals'],
    inputSampleRate: 44_100,
    outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
    files: [],
    supportedBackends: ['webgpu'],
    testedBrowserRuntime: false,
    productionDropdown: false,
    license: 'See upstream repository',
    attribution: 'ZFTurbo/Music-Source-Separation-Training',
  },
];

export function getStemModelCatalog(): readonly StemModelCatalogEntry[] {
  return STEM_MODEL_CATALOG;
}

export function getStemModelById(modelId: string): StemModelCatalogEntry | undefined {
  return STEM_MODEL_CATALOG.find((model) => model.id === modelId);
}

export function requireStemModel(modelId: string): StemModelCatalogEntry {
  const model = getStemModelById(modelId);
  if (!model) {
    throw new Error(`Unknown stem separation model: ${modelId}`);
  }
  return model;
}

export function getProductionStemModels(): readonly StemModelCatalogEntry[] {
  return STEM_MODEL_CATALOG.filter((model) => model.productionDropdown && model.testedBrowserRuntime);
}

export function getStemModelTotalBytes(model: StemModelCatalogEntry): number {
  return model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

