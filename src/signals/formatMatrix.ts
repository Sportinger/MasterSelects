import type { SignalKind } from './types';

export type SignalFormatFamilyId =
  | 'model-3d'
  | 'document-pdf-svg'
  | 'cad-technical'
  | 'data-json-csv'
  | 'binary-unknown'
  | 'point-cloud';

export type SignalFormatRoute =
  | 'signal-provider'
  | 'binary-fallback'
  | 'legacy-media-bridge';

export type SignalFormatImplementationStatus =
  | 'covered-by-builtin'
  | 'contract-only'
  | 'needs-provider';

export type SignalMaterializationSurface =
  | 'timeline-signal-ref'
  | 'preview-renderer-adapter'
  | 'export-renderer-adapter'
  | 'diagnostic-binary-surface'
  | 'legacy-media-import';

export type SignalFixtureStatus = 'existing' | 'planned';

export interface SignalFormatFixtureTarget {
  path: string;
  status: SignalFixtureStatus;
  purpose: string;
}

export interface SignalFormatMaterializationContract {
  timeline: SignalMaterializationSurface;
  preview: SignalMaterializationSurface;
  export: SignalMaterializationSurface;
  fallback: SignalMaterializationSurface;
}

export interface SignalFormatFallbackContract {
  unsupportedPolicy: 'never-unsupported';
  binaryFallbackAllowed: boolean;
  binaryFallbackIsFinalRendererSupport: boolean;
  note: string;
}

export interface SignalFormatFamilyContract {
  id: SignalFormatFamilyId;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  targetRoute: SignalFormatRoute;
  implementationStatus: SignalFormatImplementationStatus;
  signalKinds: readonly SignalKind[];
  materialization: SignalFormatMaterializationContract;
  fallback: SignalFormatFallbackContract;
  fixtureTargets: readonly SignalFormatFixtureTarget[];
}

const rendererAdapterMaterialization: SignalFormatMaterializationContract = {
  timeline: 'timeline-signal-ref',
  preview: 'preview-renderer-adapter',
  export: 'export-renderer-adapter',
  fallback: 'diagnostic-binary-surface',
};

export const SIGNAL_FORMAT_FAMILY_MATRIX = [
  {
    id: 'model-3d',
    label: '3D model and scene files',
    extensions: ['obj', 'fbx', 'gltf', 'glb'],
    mimeTypes: ['model/gltf+json', 'model/gltf-binary'],
    targetRoute: 'signal-provider',
    implementationStatus: 'needs-provider',
    signalKinds: ['mesh', 'geometry', 'scene', 'metadata'],
    materialization: rendererAdapterMaterialization,
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'Binary fallback may preserve the file, but renderer support needs a 3D materialization adapter.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/model3dSignalImport.test.ts',
        status: 'planned',
        purpose: 'OBJ/FBX/glTF/GLB route fixtures',
      },
    ],
  },
  {
    id: 'document-pdf-svg',
    label: 'PDF and SVG documents',
    extensions: ['pdf', 'svg'],
    mimeTypes: ['application/pdf', 'image/svg+xml'],
    targetRoute: 'signal-provider',
    implementationStatus: 'needs-provider',
    signalKinds: ['document', 'vector', 'texture', 'metadata'],
    materialization: rendererAdapterMaterialization,
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'Fallback preserves the document bytes; preview/export need document or vector adapters.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/documentSignalImport.test.ts',
        status: 'planned',
        purpose: 'PDF/SVG route fixtures',
      },
    ],
  },
  {
    id: 'cad-technical',
    label: 'CAD and technical geometry',
    extensions: ['dxf', 'step', 'stp'],
    mimeTypes: ['image/vnd.dxf', 'model/step', 'application/step'],
    targetRoute: 'signal-provider',
    implementationStatus: 'needs-provider',
    signalKinds: ['geometry', 'mesh', 'metadata', 'binary'],
    materialization: rendererAdapterMaterialization,
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'Fallback is import safety only; CAD inspection needs a technical geometry adapter.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/cadSignalImport.test.ts',
        status: 'planned',
        purpose: 'DXF/STEP route fixtures',
      },
    ],
  },
  {
    id: 'data-json-csv',
    label: 'Structured data',
    extensions: ['json', 'csv'],
    mimeTypes: ['application/json', 'text/csv'],
    targetRoute: 'signal-provider',
    implementationStatus: 'covered-by-builtin',
    signalKinds: ['table', 'metadata', 'binary'],
    materialization: {
      timeline: 'timeline-signal-ref',
      preview: 'preview-renderer-adapter',
      export: 'export-renderer-adapter',
      fallback: 'diagnostic-binary-surface',
    },
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'CSV has a built-in table importer; JSON uses the same signal route contract until a parser is added.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/universalImportOrchestrator.test.ts',
        status: 'existing',
        purpose: 'CSV table import fixture',
      },
      {
        path: 'tests/unit/importers/jsonSignalImport.test.ts',
        status: 'planned',
        purpose: 'JSON route fixture',
      },
    ],
  },
  {
    id: 'binary-unknown',
    label: 'Binary and unknown files',
    extensions: ['*'],
    mimeTypes: ['application/octet-stream'],
    targetRoute: 'binary-fallback',
    implementationStatus: 'covered-by-builtin',
    signalKinds: ['binary', 'metadata'],
    materialization: {
      timeline: 'timeline-signal-ref',
      preview: 'diagnostic-binary-surface',
      export: 'diagnostic-binary-surface',
      fallback: 'diagnostic-binary-surface',
    },
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'Unknown files become binary SignalAssets; this is preservation, not final domain rendering.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/universalImportOrchestrator.test.ts',
        status: 'existing',
        purpose: 'unknown-file binary fallback fixture',
      },
    ],
  },
  {
    id: 'point-cloud',
    label: 'Point clouds and splats',
    extensions: ['ply', 'pcd', 'las', 'laz', 'splat'],
    mimeTypes: ['application/vnd.las', 'application/octet-stream'],
    targetRoute: 'signal-provider',
    implementationStatus: 'needs-provider',
    signalKinds: ['point-cloud', 'geometry', 'metadata', 'binary'],
    materialization: rendererAdapterMaterialization,
    fallback: {
      unsupportedPolicy: 'never-unsupported',
      binaryFallbackAllowed: true,
      binaryFallbackIsFinalRendererSupport: false,
      note: 'Fallback preserves bytes; point-cloud preview/export needs a splat or point renderer adapter.',
    },
    fixtureTargets: [
      {
        path: 'tests/unit/importers/pointCloudSignalImport.test.ts',
        status: 'planned',
        purpose: 'point-cloud route fixtures',
      },
    ],
  },
] as const satisfies readonly SignalFormatFamilyContract[];

export const SIGNAL_FORMAT_FAMILY_IDS = SIGNAL_FORMAT_FAMILY_MATRIX.map(
  (family) => family.id,
);

export function normalizeSignalFormatExtension(fileNameOrExtension: string): string {
  const trimmed = fileNameOrExtension.trim().toLowerCase();
  const extension = trimmed.match(/\.([^.]+)$/)?.[1] ?? trimmed.replace(/^\./, '');
  return extension;
}

export function findSignalFormatFamilyByExtension(
  fileNameOrExtension: string,
): SignalFormatFamilyContract {
  const extension = normalizeSignalFormatExtension(fileNameOrExtension);
  return (
    SIGNAL_FORMAT_FAMILY_MATRIX.find((family) => (
      (family.extensions as readonly string[]).includes(extension)
    )) ??
    SIGNAL_FORMAT_FAMILY_MATRIX.find((family) => family.id === 'binary-unknown')!
  );
}
