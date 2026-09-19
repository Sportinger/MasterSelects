import type { StemModelCatalogEntry } from './types';

export const DEFAULT_STEM_MODEL_ID = 'demucs-htdemucs-web';

// Model weights are pinned to an upstream commit SHA (`resolve/<sha>/`), never
// `resolve/main`: a force-push or account takeover upstream must not be able
// to swap the bytes we execute. `checksumSha256` is the upstream LFS object
// hash (Hugging Face `X-Linked-ETag`) of the pinned file.
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
      url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx',
      checksumSha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
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
      name: 'htdemucs_fp16weights.onnx',
      sizeBytes: 165_612_636,
      url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx',
      checksumSha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',
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
      sizeBytes: 108_325_429,
      url: 'https://huggingface.co/bgkb/bs_polarformer/resolve/9158719ee2173edd480a735764627526506fe4af/bs_polarformer_fp16.onnx',
      checksumSha256: '76424289ea586bae4bbdb289383b0269b099416471e2b05068d02aa0b0c01467',
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

