import { describe, expect, it } from 'vitest';

import { getToolRegistrySnapshot } from '../../src/services/aiTools/registrySnapshot';

// Intentional non-chat surfaces and aliases. Keep every list sorted; exact
// comparisons below ensure newly introduced registry drift fails the gate.
const KNOWN_ALLOWED_REGISTRY_ASYMMETRIES = {
  handlerOnly: [
    'createStressTestProjectFixture',
    'debugExport',
    'getDockLayoutDebugState',
    'reloadApp',
    'runMotionDesignMd0Evidence',
    'runTimelineCanvasBladeToolSmoke',
    'runTimelineCanvasExportPreviewParitySmoke',
    'runTimelineCanvasLargeProjectSmoke',
    'runTimelineCanvasMarqueeSmoke',
    'runTimelineCanvasPlayheadSmoothnessSmoke',
    'runTimelineCanvasRamPreviewSmoke',
    'runTimelineCanvasSpectralPlaybackSmoke',
    'runTimelineCanvasThumbnailReloadSmoke',
    'searchYouTube',
    'switchDockLayout',
  ],
  modifyingWithoutDefinition: [
    'createStressTestProjectFixture',
  ],
  policyOnly: [
    'createStressTestProjectFixture',
    'debugExport',
    'executeKernelEditorTool',
    'getDockLayoutDebugState',
    'reloadApp',
    'runMotionDesignMd0Evidence',
    'runTimelineCanvasBladeToolSmoke',
    'runTimelineCanvasExportPreviewParitySmoke',
    'runTimelineCanvasLargeProjectSmoke',
    'runTimelineCanvasMarqueeSmoke',
    'runTimelineCanvasPlayheadSmoothnessSmoke',
    'runTimelineCanvasRamPreviewSmoke',
    'runTimelineCanvasSpectralPlaybackSmoke',
    'runTimelineCanvasThumbnailReloadSmoke',
    'searchYouTube',
    'switchDockLayout',
  ],
} as const;

const snapshot = getToolRegistrySnapshot();
const definitionNameSet = new Set(snapshot.definitionNames);
const policyNameSet = new Set(snapshot.policyNames);
const handlerNameSet = new Set(snapshot.handlerNames);

const missingPolicyNames = snapshot.definitionNames.filter((name) => !policyNameSet.has(name));
const missingHandlerNames = snapshot.definitionNames.filter((name) => !handlerNameSet.has(name));
const modifyingWithoutDefinition = snapshot.modifyingToolNames.filter(
  (name) => !definitionNameSet.has(name),
);
const policyOnly = snapshot.policyNames.filter((name) => !definitionNameSet.has(name));
const handlerOnly = snapshot.handlerNames.filter((name) => !definitionNameSet.has(name));

describe(
  `AI tool registry parity (definitions=${snapshot.definitionNames.length}, policies=${snapshot.policyNames.length}, handlers=${snapshot.handlerNames.length}, modifying=${snapshot.modifyingToolNames.length})`,
  () => {
    it('fails closed when a chat definition lacks policy or handler coverage', () => {
      expect(
        missingPolicyNames,
        `Definitions missing policy entries: ${missingPolicyNames.join(', ') || '(none)'}`,
      ).toEqual([]);
      expect(
        missingHandlerNames,
        `Definitions missing handlers: ${missingHandlerNames.join(', ') || '(none)'}`,
      ).toEqual([]);
    });

    it('keeps modifying-tool and non-chat asymmetries explicit', () => {
      expect(modifyingWithoutDefinition).toEqual([
        ...KNOWN_ALLOWED_REGISTRY_ASYMMETRIES.modifyingWithoutDefinition,
      ]);
      expect(policyOnly).toEqual([...KNOWN_ALLOWED_REGISTRY_ASYMMETRIES.policyOnly]);
      expect(handlerOnly).toEqual([...KNOWN_ALLOWED_REGISTRY_ASYMMETRIES.handlerOnly]);
    });

    it('returns sorted registry surfaces and keeps the allowlist sorted', () => {
      for (const names of Object.values(snapshot)) {
        expect(names).toEqual(names.toSorted());
      }
      for (const names of Object.values(KNOWN_ALLOWED_REGISTRY_ASYMMETRIES)) {
        expect(names).toEqual(names.toSorted());
      }
    });
  },
);
