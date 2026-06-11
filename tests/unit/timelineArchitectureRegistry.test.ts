import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  timelineAdapterDebtLedger,
  timelineArchitectureGates,
  timelineExitCriteriaCoverage,
  timelineHighConflictOwnership,
  timelineHighConflictTargets,
  timelineRefactorLanes,
  timelineRetiredPathLedger,
  timelineTestMigrationLedger,
} from '../../src/timeline/architecture';

const repoRoot = process.cwd();
const srcTimelineRoot = path.join(repoRoot, 'src', 'timeline');
const srcTimelineStoreRoot = path.join(repoRoot, 'src', 'stores', 'timeline');

const allowedTestClassifications = new Set(['port', 'replace', 'split', 'delete', 'keep']);
const allowedRetiredPathClassifications = new Set(['delete now', 'delete at gate', 'move to importer', 'keep']);
const allowedGateStatuses = new Set(['active', 'satisfied', 'retired']);

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((entry) => {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkFiles(fullPath);
    return [fullPath];
  });
}

function sourceFilesUnder(root: string): string[] {
  return walkFiles(root).filter((filePath) => /\.(ts|tsx)$/.test(filePath));
}

function readRepoFile(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

function stripTypeOnlyImportPrefix(statement: string): string {
  return statement.replace(/^import\s+type\s+/, 'import ');
}

function importedSpecifiers(source: string): string[] {
  const imports = [...source.matchAll(/import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  const exports = [...source.matchAll(/export\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  return [...imports, ...exports];
}

function resolveRelativeImport(fromFile: string, specifier: string): string {
  const normalized = path.normalize(path.join(path.dirname(fromFile), specifier));
  return toRepoPath(normalized);
}

function gateIds(): Set<string> {
  return new Set(timelineArchitectureGates.map((gate) => gate.id));
}

function laneIds(): Set<string> {
  return new Set(timelineRefactorLanes.map((lane) => lane.id));
}

function expectGateRefsToResolve(label: string, refs: readonly string[] | undefined, ids: Set<string>): void {
  for (const ref of refs ?? []) {
    expect(ids.has(ref), `${label} references unknown gate ${ref}`).toBe(true);
  }
}

describe('timeline architecture registry', () => {
  it('keeps the gate registry coherent', () => {
    const ids = timelineArchitectureGates.map((gate) => gate.id);
    expect(new Set(ids).size).toBe(ids.length);

    const idSet = gateIds();
    for (const gate of timelineArchitectureGates) {
      expect(allowedGateStatuses.has(gate.status), `${gate.id} has invalid status`).toBe(true);
      expectGateRefsToResolve(`${gate.id}.dependsOn`, gate.dependsOn, idSet);
      if (gate.status === 'retired') {
        expect(gate.retiredByGate, `${gate.id} is retired without retiredByGate`).toBeTruthy();
        expect(idSet.has(gate.retiredByGate ?? ''), `${gate.id}.retiredByGate is unknown`).toBe(true);
      }
    }

    const coverageIds = timelineExitCriteriaCoverage.map((entry) => entry.gateId);
    expect(new Set(coverageIds).size).toBe(coverageIds.length);
    expect(new Set(coverageIds)).toEqual(idSet);
    for (const entry of timelineExitCriteriaCoverage) {
      expect(entry.criteria.length, `${entry.gateId} has no criteria`).toBeGreaterThan(0);
      expect(entry.evidence.length, `${entry.gateId} has no evidence`).toBeGreaterThan(0);
    }

    const coverageById = new Map(timelineExitCriteriaCoverage.map((entry) => [entry.gateId, entry]));
    for (const gate of timelineArchitectureGates) {
      if (gate.status !== 'satisfied') continue;
      const coverage = coverageById.get(gate.id);
      expect(coverage, `${gate.id} is satisfied without exit coverage`).toBeTruthy();
      for (const evidence of coverage?.evidence ?? []) {
        expect(evidence.note.toLowerCase(), `${gate.id} has placeholder evidence`).not.toContain('planned');
      }
    }
  });

  it('keeps lanes, high-conflict owners, and debt references coherent', () => {
    const ids = gateIds();
    const lanes = laneIds();
    const gateStatusById = new Map(timelineArchitectureGates.map((gate) => [gate.id, gate.status]));

    for (const lane of timelineRefactorLanes) {
      expect(lane.writeSet.length, `${lane.id} has no write set`).toBeGreaterThan(0);
      expect(lane.exitGates.length, `${lane.id} has no exit gates`).toBeGreaterThan(0);
      expectGateRefsToResolve(`${lane.id}.exitGates`, lane.exitGates, ids);
      expectGateRefsToResolve(`${lane.id}.activeUntilGate`, lane.activeUntilGate ? [lane.activeUntilGate] : [], ids);
    }

    const ownershipCounts = new Map<string, number>();
    for (const ownership of timelineHighConflictOwnership) {
      expect(lanes.has(ownership.laneId), `${ownership.path} owner lane is unknown`).toBe(true);
      ownershipCounts.set(ownership.path, (ownershipCounts.get(ownership.path) ?? 0) + 1);
    }
    for (const target of timelineHighConflictTargets) {
      expect(ownershipCounts.get(target), `${target} does not have exactly one owner`).toBe(1);
    }
    expect(timelineHighConflictOwnership).toHaveLength(timelineHighConflictTargets.length);

    for (const debt of timelineAdapterDebtLedger) {
      expect(lanes.has(debt.ownerLane), `${debt.id} owner lane is unknown`).toBe(true);
      expect(debt.writeSet.length, `${debt.id} has no write set`).toBeGreaterThan(0);
      expect(ids.has(debt.deleteBy), `${debt.id}.deleteBy is unknown`).toBe(true);
      expect(gateStatusById.get(debt.deleteBy), `${debt.id} remains active after ${debt.deleteBy}`).not.toBe('satisfied');
      expectGateRefsToResolve(`${debt.id}.activeUntilGate`, debt.activeUntilGate ? [debt.activeUntilGate] : [], ids);
      expectGateRefsToResolve(`${debt.id}.acceptanceTests`, debt.acceptanceTests, ids);
    }
  });

  it('classifies retired paths and affected old tests', () => {
    const ids = gateIds();
    const lanes = laneIds();
    const gateStatusById = new Map(timelineArchitectureGates.map((gate) => [gate.id, gate.status]));
    const testMigrationGateSatisfied = gateStatusById.get('P5_TEST_MIGRATION_COMPLETE') === 'satisfied';
    const retiredPathGateSatisfied = gateStatusById.get('P5_RETIRED_PATHS_DELETED') === 'satisfied';

    for (const entry of timelineRetiredPathLedger) {
      expect(allowedRetiredPathClassifications.has(entry.classification), `${entry.id} has invalid classification`).toBe(true);
      expect(lanes.has(entry.ownerLane), `${entry.id} owner lane is unknown`).toBe(true);
      expect(
        Boolean(entry.deleteBy || entry.importerOwner || entry.keepReason),
        `${entry.id} needs deleteBy, importerOwner, or keepReason`,
      ).toBe(true);
      expectGateRefsToResolve(`${entry.id}.deleteBy`, entry.deleteBy ? [entry.deleteBy] : [], ids);
      expectGateRefsToResolve(`${entry.id}.replacementGate`, entry.replacementGate ? [entry.replacementGate] : [], ids);
      if (entry.classification === 'delete at gate') {
        expect(gateStatusById.get(entry.deleteBy ?? ''), `${entry.id} still waits on satisfied ${entry.deleteBy}`).not.toBe('satisfied');
        expect(retiredPathGateSatisfied, `${entry.id} remains unresolved after P5 retired-path cleanup`).toBe(false);
      }
      if (entry.importerOwner) {
        expect(lanes.has(entry.importerOwner), `${entry.id} importer owner is unknown`).toBe(true);
      }
    }

    for (const entry of timelineTestMigrationLedger) {
      expect(allowedTestClassifications.has(entry.classification), `${entry.path} has invalid classification`).toBe(true);
      expect(lanes.has(entry.ownerLane), `${entry.path} owner lane is unknown`).toBe(true);
      expect(ids.has(entry.replacementGate), `${entry.path} replacement gate is unknown`).toBe(true);
      expect(existsSync(path.join(repoRoot, entry.path)), `${entry.path} does not exist`).toBe(true);
      if (testMigrationGateSatisfied) {
        expect(entry.classification, `${entry.path} remains unresolved after P5 test migration`).toBe('keep');
      }
    }
  });

  it('enforces the kernel import boundary', () => {
    const badSpecifiers = [
      'react',
      'react-dom',
      '@/components/',
      '@/stores/',
      '@/services/',
      '@/workers/',
      '@/engine/',
      '@/hooks/',
      '@/utils/',
    ];
    const badRelativeSegments = [
      '/src/components/',
      '/src/stores/',
      '/src/services/',
      '/src/workers/',
      '/src/engine/',
      '/src/hooks/',
      '/src/utils/',
    ];

    for (const filePath of sourceFilesUnder(srcTimelineRoot)) {
      const source = readFileSync(filePath, 'utf8');
      for (const specifier of importedSpecifiers(source)) {
        const normalizedStatement = stripTypeOnlyImportPrefix(specifier);
        for (const bad of badSpecifiers) {
          expect(
            normalizedStatement === bad || normalizedStatement.startsWith(bad),
            `${toRepoPath(filePath)} imports forbidden ${specifier}`,
          ).toBe(false);
        }
        if (specifier.startsWith('.')) {
          const resolved = `/${resolveRelativeImport(filePath, specifier)}`;
          for (const segment of badRelativeSegments) {
            expect(resolved.includes(segment), `${toRepoPath(filePath)} escapes to ${segment}`).toBe(false);
          }
        }
      }
    }
  });

  it('enforces P1 LOC budgets and forbidden god-object names in the kernel', () => {
    const budgets = [
      { pattern: /\/architecture\//, maxLines: 300 },
      { pattern: /\/contracts\//, maxLines: 250 },
      { pattern: /\/projection\//, maxLines: 250 },
      { pattern: /\/geometry\//, maxLines: 250 },
      { pattern: /\/paint\//, maxLines: 200 },
      { pattern: /\/resources\//, maxLines: 250 },
      { pattern: /\/commands\//, maxLines: 250 },
    ];
    const forbiddenPatterns = [
      /viewModel/i,
      /timelineCommandBus/i,
      /buildTimelineRenderModel/i,
      /timelineHelpers/i,
      /(^|\/)(helpers|utils)\.ts$/i,
    ];

    for (const filePath of sourceFilesUnder(srcTimelineRoot)) {
      const repoPath = toRepoPath(filePath);
      for (const forbidden of forbiddenPatterns) {
        expect(forbidden.test(repoPath), `${repoPath} uses forbidden god-object naming`).toBe(false);
      }

      const normalized = `/${repoPath}`;
      const budget = budgets.find((entry) => entry.pattern.test(normalized));
      if (budget) {
        expect(lineCount(readFileSync(filePath, 'utf8')), `${repoPath} exceeds P1 LOC budget`).toBeLessThanOrEqual(budget.maxLines);
      }
    }
  });

  it('keeps the first Timeline host split out of the root shell', () => {
    const timelineSource = readRepoFile('src/components/timeline/Timeline.tsx');
    const splitModules = [
      'src/components/timeline/hooks/useTimelineDurationEditor.ts',
      'src/components/timeline/hooks/useTimelineHeaderWidthResize.ts',
      'src/components/timeline/hooks/useTimelineKeyframeDiamondsRenderer.tsx',
      'src/components/timeline/hooks/useTimelinePlaybackAutoScroll.ts',
      'src/components/timeline/hooks/useTimelinePlayheadDisplay.ts',
      'src/components/timeline/hooks/useTimelineCompositionVideoBakeRulerDrag.ts',
      'src/components/timeline/hooks/useTimelineAuxiliaryInteractionController.ts',
      'src/components/timeline/hooks/useTimelineAuxiliaryMenuState.ts',
      'src/components/timeline/hooks/useTimelineAuxiliaryLayerProps.ts',
      'src/components/timeline/hooks/useTimelineAIMarkerFeedback.ts',
      'src/components/timeline/hooks/useTimelineClipMediaLookup.ts',
      'src/components/timeline/hooks/useTimelineLineOpacity.ts',
      'src/components/timeline/hooks/useTimelineControlsProps.ts',
      'src/components/timeline/hooks/useTimelineToolbarChromeController.ts',
      'src/components/timeline/hooks/useTimelineSurfaceController.ts',
      'src/components/timeline/hooks/useTimelineBodySurfaceController.ts',
      'src/components/timeline/hooks/useTimelineBodySurfaceProps.ts',
      'src/components/timeline/hooks/useTimelineTrackSectionRenderers.tsx',
      'src/components/timeline/hooks/useTimelineTrackSectionSurfaceController.ts',
      'src/components/timeline/hooks/useTimelinePlaybackSideEffectsController.ts',
      'src/components/timeline/hooks/useTimelineTrackStackController.ts',
      'src/components/timeline/hooks/useTimelineProxyBatchStatus.ts',
      'src/components/timeline/hooks/useTimelineTrackHeightWheel.ts',
      'src/components/timeline/hooks/useTimelineRulerCacheRanges.ts',
      'src/components/timeline/hooks/useTimelineRamPreviewFeatureGate.ts',
      'src/components/timeline/hooks/useTimelineActionController.ts',
      'src/components/timeline/hooks/useTimelineCompositionSwitchState.ts',
      'src/components/timeline/hooks/useTimelineTrackVisibilityState.ts',
      'src/components/timeline/hooks/useTimelineCombinedDragHandlers.ts',
      'src/components/timeline/hooks/useTimelineExternalDropController.ts',
      'src/components/timeline/hooks/useTimelineRootStoreState.ts',
      'src/components/timeline/hooks/useTimelineRenderedTrackMetrics.ts',
      'src/components/timeline/hooks/useTimelineInteractionController.ts',
      'src/components/timeline/hooks/useTimelineClipInteractionController.ts',
      'src/components/timeline/hooks/useTimelineInputController.ts',
      'src/components/timeline/hooks/useTimelinePlayheadMarkerController.ts',
      'src/components/timeline/hooks/useTimelineRightDragScrub.ts',
      'src/components/timeline/hooks/useTimelineSectionController.ts',
      'src/components/timeline/hooks/useTimelineSectionLayout.ts',
      'src/components/timeline/hooks/useTimelineSectionReveal.ts',
      'src/components/timeline/hooks/useTimelineSectionScroll.ts',
      'src/components/timeline/hooks/useTimelineSectionScrollPinning.ts',
      'src/components/timeline/hooks/useTimelineSourceMonitorDismiss.ts',
      'src/components/timeline/hooks/useTimelineStableActionBindings.ts',
      'src/components/timeline/hooks/useTimelineHostRefs.ts',
      'src/components/timeline/hooks/useTimelineRootChromeController.ts',
      'src/components/timeline/hooks/useTimelinePlaybackController.ts',
      'src/components/timeline/hooks/useTimelineSplitDividerDrag.ts',
      'src/components/timeline/hooks/useTimelineSurfacePointer.ts',
      'src/components/timeline/hooks/useTimelineTrackFocusStep.ts',
      'src/components/timeline/hooks/useTimelineTrackResize.ts',
      'src/components/timeline/components/TimelineAuxiliaryLayer.tsx',
      'src/components/timeline/components/TimelineBodySurface.tsx',
      'src/components/timeline/components/TimelineCompositionExitOverlay.tsx',
      'src/components/timeline/components/TimelineCompositionSectionOverlays.tsx',
      'src/components/timeline/components/TimelineCompositionVideoBakeRegions.tsx',
      'src/components/timeline/components/TimelineGlobalOverlayLayers.tsx',
      'src/components/timeline/components/TimelineInteractionOverlays.tsx',
      'src/components/timeline/components/TimelineMarkerOverlays.tsx',
      'src/components/timeline/components/TimelineNavigatorChrome.tsx',
      'src/components/timeline/components/TimelineNewTrackLaneOverlays.tsx',
      'src/components/timeline/components/TimelineNewTrackPreviews.tsx',
      'src/components/timeline/components/TimelinePlayheadOverlay.tsx',
      'src/components/timeline/components/TimelineRootShell.tsx',
      'src/components/timeline/components/TimelineRulerHeaderChrome.tsx',
      'src/components/timeline/components/TimelineSectionHeaders.tsx',
      'src/components/timeline/components/TimelineSectionOverlayGroups.tsx',
      'src/components/timeline/components/TimelineSectionTrackRows.tsx',
      'src/components/timeline/components/TimelineSlotGridChrome.tsx',
      'src/components/timeline/components/TimelineSplitDivider.tsx',
      'src/components/timeline/components/TimelineToolbarChrome.tsx',
      'src/components/timeline/components/TimelineTrackSectionHeaderStack.tsx',
      'src/components/timeline/components/TimelineTrackSectionLaneStack.tsx',
      'src/components/timeline/components/TimelineTrackSectionFrame.tsx',
      'src/components/timeline/components/TimelineTrackSectionRenderer.tsx',
      'src/components/timeline/utils/timelineCompositionSwitchTracks.ts',
      'src/components/timeline/utils/timelineHostConstants.ts',
      'src/components/timeline/utils/timelineHostLayout.ts',
      'src/components/timeline/utils/timelineHostTypes.ts',
      'src/components/timeline/utils/timelineTrackSectionRenderState.ts',
    ];

    const bodySurfaceSource = readRepoFile('src/components/timeline/components/TimelineBodySurface.tsx');
    const compositionSectionSource = readRepoFile('src/components/timeline/components/TimelineCompositionSectionOverlays.tsx');
    const newTrackLaneOverlaysSource = readRepoFile('src/components/timeline/components/TimelineNewTrackLaneOverlays.tsx');
    const rootShellSource = readRepoFile('src/components/timeline/components/TimelineRootShell.tsx');
    const trackSectionHeaderStackSource = readRepoFile('src/components/timeline/components/TimelineTrackSectionHeaderStack.tsx');
    const trackSectionLaneStackSource = readRepoFile('src/components/timeline/components/TimelineTrackSectionLaneStack.tsx');
    const trackSectionFrameSource = readRepoFile('src/components/timeline/components/TimelineTrackSectionFrame.tsx');
    const trackSectionRendererSource = readRepoFile('src/components/timeline/components/TimelineTrackSectionRenderer.tsx');
    const trackSectionRenderersHookSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackSectionRenderers.tsx');
    const trackSectionSurfaceControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackSectionSurfaceController.ts');
    const playbackSideEffectsControllerSource = readRepoFile('src/components/timeline/hooks/useTimelinePlaybackSideEffectsController.ts');
    const trackStackControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackStackController.ts');
    const trackSectionRenderStateSource = readRepoFile('src/components/timeline/utils/timelineTrackSectionRenderState.ts');
    const compositionVideoBakeRulerDragSource = readRepoFile('src/components/timeline/hooks/useTimelineCompositionVideoBakeRulerDrag.ts');
    const auxiliaryInteractionControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineAuxiliaryInteractionController.ts');
    const auxiliaryMenuStateSource = readRepoFile('src/components/timeline/hooks/useTimelineAuxiliaryMenuState.ts');
    const auxiliaryLayerPropsSource = readRepoFile('src/components/timeline/hooks/useTimelineAuxiliaryLayerProps.ts');
    const aiMarkerFeedbackSource = readRepoFile('src/components/timeline/hooks/useTimelineAIMarkerFeedback.ts');
    const clipMediaLookupSource = readRepoFile('src/components/timeline/hooks/useTimelineClipMediaLookup.ts');
    const lineOpacitySource = readRepoFile('src/components/timeline/hooks/useTimelineLineOpacity.ts');
    const timelineControlsPropsSource = readRepoFile('src/components/timeline/hooks/useTimelineControlsProps.ts');
    const toolbarChromeControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineToolbarChromeController.ts');
    const surfaceControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineSurfaceController.ts');
    const bodySurfaceControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineBodySurfaceController.ts');
    const bodySurfacePropsSource = readRepoFile('src/components/timeline/hooks/useTimelineBodySurfaceProps.ts');
    const proxyBatchStatusSource = readRepoFile('src/components/timeline/hooks/useTimelineProxyBatchStatus.ts');
    const rulerCacheRangesSource = readRepoFile('src/components/timeline/hooks/useTimelineRulerCacheRanges.ts');
    const ramPreviewFeatureGateSource = readRepoFile('src/components/timeline/hooks/useTimelineRamPreviewFeatureGate.ts');
    const actionControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineActionController.ts');
    const compositionSwitchStateSource = readRepoFile('src/components/timeline/hooks/useTimelineCompositionSwitchState.ts');
    const trackVisibilityStateSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackVisibilityState.ts');
    const combinedDragHandlersSource = readRepoFile('src/components/timeline/hooks/useTimelineCombinedDragHandlers.ts');
    const externalDropControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineExternalDropController.ts');
    const rootStoreStateSource = readRepoFile('src/components/timeline/hooks/useTimelineRootStoreState.ts');
    const renderedTrackMetricsSource = readRepoFile('src/components/timeline/hooks/useTimelineRenderedTrackMetrics.ts');
    const interactionControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineInteractionController.ts');
    const clipInteractionControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineClipInteractionController.ts');
    const inputControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineInputController.ts');
    const playheadMarkerControllerSource = readRepoFile('src/components/timeline/hooks/useTimelinePlayheadMarkerController.ts');
    // Evidence location updated 2026-06-10: packet 186 moved the timeline
    // switch bridge out of compositionSlice.ts; assertions unchanged.
    const compositionSliceSource = readRepoFile('src/stores/mediaStore/slices/composition/timelineSwitchBridge.ts');
    const trackHeightWheelSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackHeightWheel.ts');
    const sectionControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineSectionController.ts');
    const sectionScrollPinningSource = readRepoFile('src/components/timeline/hooks/useTimelineSectionScrollPinning.ts');
    const sourceMonitorDismissSource = readRepoFile('src/components/timeline/hooks/useTimelineSourceMonitorDismiss.ts');
    const stableActionBindingsSource = readRepoFile('src/components/timeline/hooks/useTimelineStableActionBindings.ts');
    const hostRefsSource = readRepoFile('src/components/timeline/hooks/useTimelineHostRefs.ts');
    const rootChromeControllerSource = readRepoFile('src/components/timeline/hooks/useTimelineRootChromeController.ts');
    const playbackControllerSource = readRepoFile('src/components/timeline/hooks/useTimelinePlaybackController.ts');
    const trackFocusStepSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackFocusStep.ts');

    expect(timelineSource).not.toContain("from './hooks/useTimelineDurationEditor'");
    expect(timelineSource).toContain("from './hooks/useTimelineHeaderWidthResize'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineKeyframeDiamondsRenderer'");
    expect(timelineSource).not.toContain("from './hooks/useTimelinePlaybackAutoScroll'");
    expect(timelineSource).not.toContain("from './hooks/useTimelinePlayheadDisplay'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineCompositionVideoBakeRulerDrag'");
    expect(timelineSource).toContain("from './hooks/useTimelineAuxiliaryInteractionController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineAuxiliaryMenuState'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineAuxiliaryLayerProps'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineAIMarkerFeedback'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineClipMediaLookup'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineLineOpacity'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineControlsProps'");
    expect(timelineSource).toContain("from './hooks/useTimelineToolbarChromeController'");
    expect(timelineSource).toContain("from './hooks/useTimelineSurfaceController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineBodySurfaceController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineBodySurfaceProps'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineProxyBatchStatus'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineRulerCacheRanges'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineRamPreviewFeatureGate'");
    expect(timelineSource).toContain("from './hooks/useTimelineActionController'");
    expect(timelineSource).toContain("from './hooks/useTimelineCompositionSwitchState'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineCombinedDragHandlers'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineExternalDropController'");
    expect(timelineSource).toContain("from './hooks/useTimelineRootStoreState'");
    expect(timelineSource).toContain("from './hooks/useTimelineRenderedTrackMetrics'");
    expect(timelineSource).toContain("from './hooks/useTimelineInteractionController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineClipInteractionController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineInputController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelinePlayheadMarkerController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineRightDragScrub'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSectionLayout'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSectionReveal'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSectionScroll'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSectionScrollPinning'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSourceMonitorDismiss'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineStableActionBindings'");
    expect(timelineSource).toContain("from './hooks/useTimelineHostRefs'");
    expect(timelineSource).toContain("from './hooks/useTimelineRootChromeController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelinePlaybackSideEffectsController'");
    expect(timelineSource).toContain("from './hooks/useTimelinePlaybackController'");
    expect(timelineSource).toContain("from './hooks/useTimelineTrackStackController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSplitDividerDrag'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSurfacePointer'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackFocusStep'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackResize'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackVisibilityState'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackHeightWheel'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineSectionController'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineKeyboard'");
    expect(timelineSource).not.toContain("from './hooks/useAutoFeatures'");
    expect(timelineSource).not.toContain("from './hooks/useLayerSync'");
    expect(timelineSource).not.toContain("from './hooks/usePlaybackLoop'");
    expect(timelineSource).not.toContain("from './hooks/usePlayheadSnap'");
    expect(timelineSource).toContain("from './components/TimelineAuxiliaryLayer'");
    expect(timelineSource).toContain("from './components/TimelineBodySurface'");
    expect(timelineSource).toContain("from './components/TimelineNavigatorChrome'");
    expect(timelineSource).toContain("from './components/TimelineRootShell'");
    expect(timelineSource).toContain("from './components/TimelineSlotGridChrome'");
    expect(timelineSource).toContain("from './components/TimelineToolbarChrome'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackSectionRenderers'");
    expect(timelineSource).not.toContain("from './hooks/useTimelineTrackSectionSurfaceController'");
    expect(timelineSource).not.toContain("from './components/TimelineTrackSectionRenderer'");
    expect(timelineSource).not.toContain("from './components/TimelineTrackSectionHeaderStack'");
    expect(timelineSource).not.toContain("from './components/TimelineTrackSectionLaneStack'");
    expect(timelineSource).not.toContain("from './components/TimelineTrackSectionFrame'");
    expect(bodySurfaceSource).toContain("from './TimelineGlobalOverlayLayers'");
    expect(bodySurfaceSource).toContain("from './TimelineInteractionOverlays'");
    expect(bodySurfaceSource).toContain("from './TimelineMarkerOverlays'");
    expect(bodySurfaceSource).toContain("from './TimelinePlayheadOverlay'");
    expect(bodySurfaceSource).toContain("from './TimelineRulerHeaderChrome'");
    expect(bodySurfaceSource).toContain("from './TimelineSplitDivider'");
    expect(compositionSectionSource).toContain("from './TimelineCompositionExitOverlay'");
    expect(compositionSectionSource).toContain("from './TimelineCompositionVideoBakeRegions'");
    expect(newTrackLaneOverlaysSource).toContain("from './TimelineNewTrackPreviews'");
    expect(trackSectionHeaderStackSource).toContain("from './TimelineSectionHeaders'");
    expect(trackSectionHeaderStackSource).toContain('sectionState.sectionTracks');
    expect(trackSectionLaneStackSource).toContain("from './TimelineCompositionSectionOverlays'");
    expect(trackSectionLaneStackSource).toContain("from './TimelineNewTrackLaneOverlays'");
    expect(trackSectionLaneStackSource).toContain("from './TimelineSectionOverlayGroups'");
    expect(trackSectionLaneStackSource).toContain("from './TimelineSectionTrackRows'");
    expect(trackSectionFrameSource).toContain('timeline-track-section');
    expect(trackSectionFrameSource).toContain('track-lanes-scroll');
    expect(trackSectionRendererSource).toContain("from '../utils/timelineTrackSectionRenderState'");
    expect(trackSectionRendererSource).toContain("from './TimelineTrackSectionFrame'");
    expect(trackSectionRendererSource).toContain("from './TimelineTrackSectionHeaderStack'");
    expect(trackSectionRendererSource).toContain("from './TimelineTrackSectionLaneStack'");
    expect(trackSectionRendererSource).toContain('<TimelineTrackSectionFrame');
    expect(trackSectionRendererSource).toContain('<TimelineTrackSectionHeaderStack');
    expect(trackSectionRendererSource).toContain('<TimelineTrackSectionLaneStack');
    expect(trackSectionRenderersHookSource).toContain("from '../components/TimelineTrackSectionRenderer'");
    expect(trackSectionRenderersHookSource).toContain('const renderTrackSection =');
    expect(trackSectionRenderersHookSource).toContain('frameProps={{');
    expect(trackSectionRenderersHookSource).toContain('headerProps={{');
    expect(trackSectionRenderersHookSource).toContain('laneProps={{');
    expect(trackSectionRenderersHookSource).toContain('renderStateProps={{');
    expect(timelineSource).not.toContain("from './utils/timelineHostConstants'");
    expect(sectionControllerSource).toContain("from '../utils/timelineHostConstants'");
    expect(trackSectionRenderersHookSource).toContain("from '../utils/timelineHostTypes'");
    expect(timelineSource).not.toContain("from './utils/timelineHostTypes'");
    expect(timelineSource).not.toContain("from './utils/timelineTrackSectionRenderState'");
    expect(timelineSource).not.toContain('buildTimelineTrackSectionRenderState');
    expect(timelineSource).not.toContain('function clipDragAffectsTrack');
    expect(timelineSource).not.toContain('function buildSectionScrollSnapPositions');
    expect(timelineSource).not.toContain('function buildCompositionSwitchTracks');
    expect(timelineSource).not.toContain('function getTrackFocusModeForSplitPosition');
    expect(timelineSource).not.toContain('function buildSectionMetrics');
    expect(timelineSource).not.toContain('updateViewportHeights');
    expect(timelineSource).not.toContain('keyframeAreaRevealSnapshotRef');
    expect(timelineSource).not.toContain('selectedKeyframeAreaRevealSnapshot');
    expect(timelineSource).not.toContain('TIMELINE_RIGHT_DRAG_SCRUB_THRESHOLD_PX');
    expect(timelineSource).not.toContain('sectionScrollGestureRef');
    expect(timelineSource).not.toContain('cancelSectionScrollAnimation');
    expect(timelineSource).not.toContain('getLiveSectionScrollY');
    expect(timelineSource).not.toContain('rightDragScrubStateRef');
    expect(timelineSource).not.toContain('videoBakeRulerDrag');
    expect(timelineSource).not.toContain('setVideoBakeRulerDrag');
    expect(timelineSource).not.toContain('getRulerTimeFromClientX');
    expect(timelineSource).not.toContain('MIN_VIDEO_BAKE_DRAG_PX');
    expect(timelineSource).not.toContain('isVideoBakeModifierPressed');
    expect(timelineSource).not.toContain("from './useClipContextMenu'");
    expect(timelineSource).not.toContain('setClipContextMenu');
    expect(timelineSource).not.toContain('useState<ContextMenuState');
    expect(timelineSource).not.toContain('useState<TimelineEmptyContextMenuState');
    expect(timelineSource).not.toContain('useState<TrackContextMenuState');
    expect(timelineSource).not.toContain('useState<MarkerContextMenuState');
    expect(timelineSource).not.toContain('useState<InOutContextMenuState');
    expect(timelineSource).not.toContain('const [multicamDialogOpen');
    expect(timelineSource).not.toContain('const closeTimelineContextMenus = useCallback');
    expect(timelineSource).not.toContain("from '../../services/timelineSubcomposition'");
    expect(timelineSource).not.toContain('createSubcompositionFromSelection: (clipId)');
    expect(timelineSource).not.toContain('onEraseGap: (time, trackId)');
    expect(timelineSource).not.toContain('onEraseLayerGaps: (time, trackId)');
    expect(timelineSource).not.toContain('onEraseAllGaps: ()');
    expect(timelineSource).not.toContain('onClose: () => setEmptyContextMenu(null)');
    expect(timelineSource).not.toContain('onClose: () => setTrackContextMenu(null)');
    expect(timelineSource).not.toContain('onClose: () => setMarkerContextMenu(null)');
    expect(timelineSource).not.toContain('onClose: () => setInOutContextMenu(null)');
    expect(timelineSource).not.toContain('onClose: () => setMulticamDialogOpen(false)');
    expect(timelineSource).not.toContain('setAiAnimatedMarkers');
    expect(timelineSource).not.toContain("addEventListener('ai-marker-feedback'");
    expect(timelineSource).not.toContain("removeEventListener('ai-marker-feedback'");
    expect(timelineSource).not.toContain('clip.mediaFileId');
    expect(timelineSource).not.toContain("clip.name.replace(' (Audio)', '')");
    expect(timelineSource).not.toContain('const fullOpacityDistance = 8');
    expect(timelineSource).not.toContain('const hiddenDistance = 72');
    expect(timelineSource).not.toContain('scrubCacheRevision');
    expect(timelineSource).not.toContain("masterselects:scrub-cache-updated");
    expect(timelineSource).not.toContain('getScrubCachedRangesForRuler');
    expect(timelineSource).not.toContain("type: 'proxy' as const");
    expect(timelineSource).not.toContain("type: 'cache' as const");
    expect(timelineSource).not.toContain('mediaFilesWithProxy:');
    expect(timelineSource).not.toContain('mediaFilesProxyTotal:');
    expect(timelineSource).not.toContain('generatingProxyIndex:');
    expect(timelineSource).not.toContain('showTranscriptMarkers = useTimelineStore');
    expect(timelineSource).not.toContain('toggleTranscriptMarkers = useTimelineStore');
    expect(timelineSource).not.toContain('toggleProxyEnabled = useMediaStore');
    expect(timelineSource).not.toContain('RAM_PREVIEW_FEATURE_ENABLED');
    expect(timelineSource).not.toContain('hasActiveVideoBakeCache');
    expect(timelineSource).not.toContain('isActiveBakeRegion');
    expect(timelineSource).not.toContain('compositionSwitchSourceTracksRef');
    expect(timelineSource).not.toContain('compositionSwitchTargetTracks');
    expect(timelineSource).not.toContain('buildCompositionSwitchTracks(');
    expect(timelineSource).not.toContain('clipAnimationPhase = useTimelineStore');
    expect(timelineSource).not.toContain('compositionSwitchDirection = useTimelineStore');
    expect(timelineSource).not.toContain('timeline-switch-exit-left');
    expect(timelineSource).not.toContain('timeline-switch-enter-right');
    expect(timelineSource).not.toContain('isAudioSectionTrackType');
    expect(timelineSource).not.toContain('anyVideoSolo');
    expect(timelineSource).not.toContain('anyAudioSolo');
    expect(timelineSource).not.toContain('tracks.filter(t => t.type');
    expect(timelineSource).not.toContain('dropEffect = \'none\'');
    expect(timelineSource).not.toContain('handleTransitionDragOver(e, trackId');
    expect(timelineSource).not.toContain('handleTransitionDrop(e, trackId');
    expect(timelineSource).not.toContain('isProxyFrameCountComplete');
    expect(timelineSource).not.toContain('proxyableFiles');
    expect(timelineSource).not.toContain('scaleTracksOfType');
    expect(timelineSource).not.toContain('setTrackHeight(trackId');
    expect(timelineSource).not.toContain('wheelDelta');
    expect(timelineSource).not.toContain('splitDragFrameRef');
    expect(timelineSource).not.toContain('splitDragAnchorVideoBottomRef');
    expect(timelineSource).not.toContain('trackResizeDragRef');
    expect(timelineSource).not.toContain('setVideoScrollY((current) =>');
    expect(timelineSource).not.toContain('setAudioScrollY((current) =>');
    expect(timelineSource).not.toContain('setForceVideoBottomScroll(false)');
    expect(timelineSource).not.toContain('const focusOrder: TimelineTrackFocusMode[]');
    expect(timelineSource).not.toContain("['audio', 'balanced', 'video']");
    expect(timelineSource).not.toContain('timelineSurfaceDragRef');
    expect(timelineSource).not.toContain('trackHeaderWidthDragRef');
    expect(timelineSource).not.toContain('setHoveredKeyframeRow');
    expect(timelineSource).not.toContain('<TimelineKeyframes');
    expect(timelineSource).not.toContain('END_PADDING');
    expect(timelineSource).not.toContain('renderClipDragNewTrackPreview');
    expect(timelineSource).not.toContain('renderCompositionVideoBakeRegion');
    expect(timelineSource).not.toContain('setTrackSolo(track.id');
    expect(timelineSource).not.toContain('clipDragAffectsTrack(clipDrag');
    expect(timelineSource).not.toContain('clipDragPreviewAffectsTrack(clipDragPreview');
    expect(timelineSource).not.toContain('composition-exit-clips-overlay');
    expect(timelineSource).not.toContain('<TransitionOverlays');
    expect(timelineSource).not.toContain('<AIActionOverlays');
    expect(timelineSource).not.toContain('<TimelineToolOverlayLayer');
    expect(timelineSource).not.toContain('<ParentChildLinksOverlay');
    expect(timelineSource).not.toContain('timeline-split-divider-controls');
    expect(timelineSource).not.toContain('<TimelineOverlays');
    expect(timelineSource).not.toContain('timeline-global-overlays');
    expect(timelineSource).not.toContain('timeline-range-marker-overlays');
    expect(timelineSource).not.toContain('range-selection-drag');
    expect(timelineSource).not.toContain('midi-draw-ghost');
    expect(timelineSource).not.toContain('timeline-range-selection-overlay');
    expect(timelineSource).not.toContain('timeline-marker-head');
    expect(timelineSource).not.toContain('timeline-marker ghost');
    expect(timelineSource).not.toContain('ai-marker-added');
    expect(timelineSource).not.toContain('timeline-body-content');
    expect(timelineSource).not.toContain('data-ai-id="timeline-tracks"');
    expect(timelineSource).not.toContain('timeline-track-section');
    expect(timelineSource).not.toContain('track-lanes-scroll');
    expect(timelineSource).not.toContain('timeline-video-bake-region-layer');
    expect(timelineSource).not.toContain('composition-exit-clips-overlay');
    expect(timelineSource).not.toMatch(/<TimelineSectionHeaders\b/);
    expect(timelineSource).not.toMatch(/<TimelineClipDragNewTrackPreview\b/);
    expect(timelineSource).not.toMatch(/<TimelineExternalNewTrackPreview\b/);
    expect(timelineSource).not.toMatch(/<TimelineNewTrackDropZone\b/);
    expect(timelineSource).not.toMatch(/<TimelineNewTrackLaneOverlays\b/);
    expect(timelineSource).not.toMatch(/<TimelineSectionTrackRows\b/);
    expect(timelineSource).not.toMatch(/<TimelineCompositionSectionOverlays\b/);
    expect(timelineSource).not.toMatch(/<TimelineSectionOverlayGroups\b/);
    expect(timelineSource).not.toMatch(/<TimelineTrackSectionFrame\b/);
    expect(timelineSource).not.toMatch(/<TimelineTrackSectionHeaderStack\b/);
    expect(timelineSource).not.toMatch(/<TimelineTrackSectionLaneStack\b/);
    expect(timelineSource).not.toMatch(/<TimelineCompositionExitOverlay\b/);
    expect(timelineSource).not.toMatch(/<TimelineCompositionVideoBakeRegions\b/);
    expect(timelineSource).not.toMatch(/<TimelineGlobalOverlayLayers\b/);
    expect(timelineSource).not.toMatch(/<TimelineInteractionOverlays\b/);
    expect(timelineSource).not.toMatch(/<TimelineMarkerOverlays\b/);
    expect(timelineSource).not.toMatch(/<TimelinePlayheadOverlay\b/);
    expect(timelineSource).not.toMatch(/<TimelineRulerHeaderChrome\b/);
    expect(timelineSource).not.toMatch(/<TimelineSplitDivider\b/);
    expect(timelineSource).not.toContain('slot-grid-toolbar-title');
    expect(timelineSource).not.toContain('<SlotGrid');
    expect(timelineSource).not.toContain('data-ai-id="timeline-playhead"');
    expect(timelineSource).not.toContain('playhead-head');
    expect(timelineSource).not.toContain("from './TimelineNavigator'");
    expect(timelineSource).not.toContain('timeline-ruler-timecode');
    expect(timelineSource).not.toContain('timeline-ruler-duration-input');
    expect(timelineSource).not.toContain('variant="transport"');
    expect(timelineSource).not.toContain('variant="utility"');
    expect(timelineSource).not.toContain('variant="zoom"');
    expect(timelineSource).not.toContain('timeline-header-row');
    expect(timelineSource).not.toContain('timeline-ruler-control-strip');
    expect(timelineSource).not.toContain('timeline-layer-divider-resize-handle');
    expect(timelineSource).not.toContain('variant="main"');
    expect(timelineSource).not.toContain('timeline-empty-message');
    expect(timelineSource).not.toContain('timeline-container timeline-empty');
    expect(timelineSource).not.toContain('globalOverlayProps={{');
    expect(timelineSource).not.toContain('interactionOverlayProps={{');
    expect(timelineSource).not.toContain('markerOverlayProps={{');
    expect(timelineSource).not.toContain('playheadOverlayProps={{');
    expect(timelineSource).not.toContain('rulerHeaderProps={{');
    expect(timelineSource).not.toContain('splitDividerProps={{');
    expect(timelineSource).not.toContain('const renderTrackSection =');
    expect(timelineSource).not.toContain('frameProps={{');
    expect(timelineSource).not.toContain('headerProps={{');
    expect(timelineSource).not.toContain('laneProps={{');
    expect(timelineSource).not.toContain('renderStateProps={{');
    expect(timelineSource).not.toContain('const sectionTracks = isVideoSection');
    expect(timelineSource).not.toContain('const sectionScrollY = isVideoSection');
    expect(timelineSource).not.toContain('const getSectionTrackHeightById =');
    expect(rootShellSource).toContain('timeline-empty-message');
    expect(rootShellSource).toContain('timeline-container timeline-empty');
    expect(trackSectionRenderStateSource).toContain('buildTimelineTrackSectionRenderState');
    expect(trackSectionRenderStateSource).toContain('const sectionTracks = isVideoSection');
    expect(trackSectionRenderStateSource).toContain('const getSectionTrackHeightById =');
    expect(compositionVideoBakeRulerDragSource).toContain('MIN_VIDEO_BAKE_DRAG_PX');
    expect(compositionVideoBakeRulerDragSource).toContain('isVideoBakeModifierPressed');
    expect(compositionVideoBakeRulerDragSource).toContain('setVideoBakeRegionSelection');
    expect(compositionVideoBakeRulerDragSource).toContain('addCompositionVideoBakeRegion');
    expect(auxiliaryInteractionControllerSource).toContain("from './useTimelineAuxiliaryMenuState'");
    expect(auxiliaryInteractionControllerSource).toContain("from './useTimelineRightDragScrub'");
    expect(auxiliaryInteractionControllerSource).toContain("from './usePickWhipDrag'");
    expect(auxiliaryInteractionControllerSource).toContain("from './useTimelineAuxiliaryLayerProps'");
    expect(auxiliaryInteractionControllerSource).toContain('useTimelineAuxiliaryMenuState({');
    expect(auxiliaryInteractionControllerSource).toContain('useTimelineRightDragScrub({');
    expect(auxiliaryInteractionControllerSource).toContain('usePickWhipDrag({');
    expect(auxiliaryInteractionControllerSource).toContain('useTimelineAuxiliaryLayerProps({');
    expect(auxiliaryInteractionControllerSource).toContain('pickWhipProps: { pickWhipDrag, trackPickWhipDrag }');
    expect(timelineSource).not.toContain("from './hooks/useTimelineRightDragScrub'");
    expect(timelineSource).not.toContain("from './hooks/usePickWhipDrag'");
    expect(timelineSource).not.toContain('useTimelineRightDragScrub({');
    expect(timelineSource).not.toContain('usePickWhipDrag({');
    expect(timelineSource).not.toContain('openClipContextMenu');
    expect(timelineSource).not.toContain('closeTimelineContextMenus');
    expect(timelineSource).not.toContain('pickWhipDrag');
    expect(timelineSource).not.toContain('trackPickWhipDrag');
    expect(timelineSource).not.toContain('emptyContextMenu');
    expect(timelineSource).not.toContain('trackContextMenu');
    expect(timelineSource).not.toContain('markerContextMenu');
    expect(timelineSource).not.toContain('inOutContextMenu');
    expect(timelineSource).not.toContain('multicamDialogOpen');
    expect(timelineSource).not.toContain('setMulticamDialogOpen');
    expect(timelineSource).not.toContain('handleDeleteInOutPoint');
    expect(auxiliaryMenuStateSource).toContain("from '../useClipContextMenu'");
    expect(auxiliaryMenuStateSource).toContain('setClipContextMenu');
    expect(auxiliaryMenuStateSource).toContain('closeTimelineContextMenus');
    expect(auxiliaryMenuStateSource).toContain('handleDeleteInOutPoint');
    expect(auxiliaryLayerPropsSource).toContain("from '../../../services/timelineSubcomposition'");
    expect(auxiliaryLayerPropsSource).toContain('createSubcompositionFromSelection(clipId)');
    expect(auxiliaryLayerPropsSource).toContain('deleteGapAtTime(time, [trackId])');
    expect(auxiliaryLayerPropsSource).toContain('deleteAllGaps([trackId], time)');
    expect(auxiliaryLayerPropsSource).toContain('deleteAllGaps()');
    expect(auxiliaryLayerPropsSource).toContain('setEmptyContextMenu(null)');
    expect(auxiliaryLayerPropsSource).toContain('setMulticamDialogOpen(false)');
    expect(aiMarkerFeedbackSource).toContain("addEventListener('ai-marker-feedback'");
    expect(aiMarkerFeedbackSource).toContain("removeEventListener('ai-marker-feedback'");
    expect(aiMarkerFeedbackSource).toContain('setAiAnimatedMarkers');
    expect(clipMediaLookupSource).toContain('clip.mediaFileId');
    expect(clipMediaLookupSource).toContain("clip.name.replace(' (Audio)', '')");
    expect(trackSectionSurfaceControllerSource).toContain("from './useTimelineKeyframeDiamondsRenderer'");
    expect(trackSectionSurfaceControllerSource).toContain("from './useTimelineClipMediaLookup'");
    expect(trackSectionSurfaceControllerSource).toContain("from './useTimelineTrackSectionRenderers'");
    expect(trackSectionSurfaceControllerSource).toContain('useTimelineKeyframeDiamondsRenderer({');
    expect(trackSectionSurfaceControllerSource).toContain('useTimelineClipMediaLookup(mediaFiles)');
    expect(trackSectionSurfaceControllerSource).toContain('useTimelineTrackSectionRenderers({');
    expect(trackSectionSurfaceControllerSource).toContain('clipDragActive: Boolean(clipDrag)');
    expect(trackSectionSurfaceControllerSource).toContain('marqueeActive: Boolean(marquee)');
    expect(trackSectionSurfaceControllerSource).toContain('gridMode: gridPlan.mode');
    expect(trackSectionSurfaceControllerSource).toContain('renderKeyframeDiamonds');
    expect(playbackSideEffectsControllerSource).toContain("from './useTimelineKeyboard'");
    expect(playbackSideEffectsControllerSource).toContain("from './useAutoFeatures'");
    expect(playbackSideEffectsControllerSource).toContain("from './useLayerSync'");
    expect(playbackSideEffectsControllerSource).toContain("from './usePlaybackLoop'");
    expect(playbackSideEffectsControllerSource).toContain("from './usePlayheadSnap'");
    expect(playbackSideEffectsControllerSource).toContain('useTimelineKeyboard({');
    expect(playbackSideEffectsControllerSource).toContain('useAutoFeatures({');
    expect(playbackSideEffectsControllerSource).toContain('useLayerSync({');
    expect(playbackSideEffectsControllerSource).toContain('usePlaybackLoop({ isPlaying })');
    expect(playbackSideEffectsControllerSource).toContain('usePlayheadSnap({');
    expect(playbackControllerSource).toContain("from './useTimelinePlaybackSideEffectsController'");
    expect(playbackControllerSource).toContain("from './useTimelineActionController'");
    expect(playbackControllerSource).toContain('useTimelinePlaybackSideEffectsController({');
    expect(playbackControllerSource).toContain('addMarker: timelineActions.addMarker');
    expect(playbackControllerSource).toContain('play: timelineActions.play');
    expect(playbackControllerSource).toContain('setPlayheadPosition: timelineActions.setPlayheadPosition');
    expect(playbackControllerSource).toContain('toggleLoopPlayback: timelineActions.toggleLoopPlayback');
    expect(hostRefsSource).toContain("from 'react'");
    expect(hostRefsSource).toContain('useRef<HTMLDivElement>(null)');
    expect(hostRefsSource).toContain('timelineRef');
    expect(hostRefsSource).toContain('timelineBodyRef');
    expect(hostRefsSource).toContain('trackLanesRef');
    expect(hostRefsSource).toContain('playheadRef');
    expect(hostRefsSource).toContain('scrollWrapperRef');
    expect(timelineSource).not.toContain("from 'react'");
    expect(timelineSource).not.toContain('useTimelinePlaybackSideEffectsController({');
    expect(timelineSource).not.toContain('useRef<HTMLDivElement>(null)');
    expect(inputControllerSource).toContain("from './useTimelinePlayheadMarkerController'");
    expect(inputControllerSource).toContain("from './useMarqueeSelection'");
    expect(inputControllerSource).toContain("from './useMidiClipDraw'");
    expect(inputControllerSource).toContain('useTimelinePlayheadMarkerController(params)');
    expect(inputControllerSource).toContain('useMarqueeSelection({');
    expect(inputControllerSource).toContain('markerDrag: markerController.markerDrag');
    expect(inputControllerSource).toContain('useMidiClipDraw(params)');
    expect(inputControllerSource).toContain('handleMidiDrawMouseDown(event)');
    expect(inputControllerSource).toContain('handleMarqueeMouseDown(event)');
    expect(interactionControllerSource).toContain("from './useTimelineClipInteractionController'");
    expect(interactionControllerSource).toContain("from './useTimelineExternalDropController'");
    expect(interactionControllerSource).toContain("from './useTimelineInputController'");
    expect(interactionControllerSource).toContain("from './useTimelineAIMarkerFeedback'");
    expect(interactionControllerSource).toContain('useTimelineClipInteractionController(params)');
    expect(interactionControllerSource).toContain('useTimelineExternalDropController(params)');
    expect(interactionControllerSource).toContain('useTimelineAIMarkerFeedback()');
    expect(interactionControllerSource).toContain('useTimelineInputController({');
    expect(interactionControllerSource).toContain('clipDrag: clipInteraction.clipDrag');
    expect(interactionControllerSource).toContain('clipTrim: clipInteraction.clipTrim');
    expect(timelineSource).not.toContain('useTimelineClipInteractionController({');
    expect(timelineSource).not.toContain('useTimelineExternalDropController({');
    expect(timelineSource).not.toContain('useTimelineInputController({');
    expect(timelineSource).not.toContain('useTimelineAIMarkerFeedback()');
    expect(timelineSource).not.toContain('useTimelinePlayheadMarkerController({');
    expect(timelineSource).not.toContain('useMarqueeSelection({');
    expect(timelineSource).not.toContain('useMidiClipDraw({');
    expect(timelineSource).not.toContain('handleMarqueeMouseDown');
    expect(timelineSource).not.toContain('handleMidiDrawMouseDown');
    expect(trackStackControllerSource).toContain("from './useTimelineTrackVisibilityState'");
    expect(trackStackControllerSource).toContain("from './useTimelineSectionController'");
    expect(trackStackControllerSource).toContain("from './useTimelineTrackHeightWheel'");
    expect(trackStackControllerSource).toContain('useTimelineTrackVisibilityState({');
    expect(trackStackControllerSource).toContain('useTimelineSectionController(params)');
    expect(trackStackControllerSource).toContain('useTimelineTrackHeightWheel({');
    expect(timelineSource).not.toContain('useTimelineTrackVisibilityState({');
    expect(timelineSource).not.toContain('useTimelineSectionController({');
    expect(timelineSource).not.toContain('useTimelineTrackHeightWheel({');
    expect(timelineSource).not.toContain('useTimelineKeyboard({');
    expect(timelineSource).not.toContain('useAutoFeatures({');
    expect(timelineSource).not.toContain('useLayerSync({');
    expect(timelineSource).not.toContain('usePlaybackLoop({');
    expect(timelineSource).not.toContain('usePlayheadSnap({');
    expect(timelineSource).not.toContain('renderKeyframeDiamonds');
    expect(timelineSource).not.toContain('hoveredKeyframeRow');
    expect(timelineSource).not.toContain('handleKeyframeRowHover');
    expect(timelineSource).not.toContain('getMediaFileForClip');
    expect(timelineSource).not.toContain('clipDragActive: Boolean(clipDrag)');
    expect(timelineSource).not.toContain('marqueeActive: Boolean(marquee)');
    expect(lineOpacitySource).toContain('const fullOpacityDistance = 8');
    expect(lineOpacitySource).toContain('const hiddenDistance = 72');
    expect(lineOpacitySource).toContain('timelinePointerX === null');
    expect(timelineControlsPropsSource).toContain("from './useTimelineProxyBatchStatus'");
    expect(timelineControlsPropsSource).toContain('mediaFilesWithProxy: proxyBatchStatus.readyCount');
    expect(timelineControlsPropsSource).toContain('showTranscriptMarkers = useTimelineStore');
    expect(timelineControlsPropsSource).toContain('toggleProxyEnabled = useMediaStore');
    expect(toolbarChromeControllerSource).toContain("from './useTimelineDurationEditor'");
    expect(toolbarChromeControllerSource).toContain("from './useTimelineControlsProps'");
    expect(toolbarChromeControllerSource).toContain('timelineToolbarProps');
    expect(toolbarChromeControllerSource).toContain('timelineControlsProps');
    expect(toolbarChromeControllerSource).toContain('useTimelineDurationEditor({');
    expect(toolbarChromeControllerSource).toContain('useTimelineControlsProps({');
    expect(timelineSource).toContain('<TimelineToolbarChrome {...timelineToolbarProps} />');
    expect(timelineSource).not.toContain('timelineDurationInputValue');
    expect(timelineSource).not.toContain('handleTimelineDurationClick');
    expect(surfaceControllerSource).toContain("from './useTimelineTrackSectionSurfaceController'");
    expect(surfaceControllerSource).toContain("from './useTimelineBodySurfaceController'");
    expect(surfaceControllerSource).toContain('useTimelineTrackSectionSurfaceController(params)');
    expect(surfaceControllerSource).toContain('useTimelineBodySurfaceController({');
    expect(surfaceControllerSource).toContain('renderAudioSection');
    expect(surfaceControllerSource).toContain('renderVideoSection');
    expect(timelineSource).not.toContain('useTimelineTrackSectionSurfaceController({');
    expect(timelineSource).not.toContain('useTimelineBodySurfaceController({');
    expect(timelineSource).not.toContain('renderAudioSection');
    expect(timelineSource).not.toContain('renderVideoSection');
    expect(bodySurfaceControllerSource).toContain("from './useTimelinePlayheadDisplay'");
    expect(bodySurfaceControllerSource).toContain("from './useTimelineSurfacePointer'");
    expect(bodySurfaceControllerSource).toContain("from './useTimelineLineOpacity'");
    expect(bodySurfaceControllerSource).toContain("from './useTimelinePlaybackAutoScroll'");
    expect(bodySurfaceControllerSource).toContain("from './useTimelineRulerCacheRanges'");
    expect(bodySurfaceControllerSource).toContain("from './useTimelineBodySurfaceProps'");
    expect(bodySurfaceControllerSource).toContain('useTimelinePlayheadDisplay({');
    expect(bodySurfaceControllerSource).toContain('useTimelineSurfacePointer({');
    expect(bodySurfaceControllerSource).toContain('useTimelineLineOpacity({');
    expect(bodySurfaceControllerSource).toContain('useTimelinePlaybackAutoScroll({');
    expect(bodySurfaceControllerSource).toContain('useTimelineRulerCacheRanges({');
    expect(bodySurfaceControllerSource).toContain('useTimelineBodySurfaceProps({');
    expect(timelineSource).not.toContain('timelinePointerX');
    expect(timelineSource).not.toContain('timelineSurfaceCursor');
    expect(timelineSource).not.toContain('getTimelineLineOpacity');
    expect(timelineSource).not.toContain('timelineRulerCacheRanges');
    expect(timelineSource).not.toContain('playheadInlineStyle');
    expect(timelineSource).not.toContain('showPlayhead');
    expect(timelineSource).not.toContain('useTimelinePlaybackAutoScroll({');
    expect(bodySurfacePropsSource).toContain('globalOverlayProps: {');
    expect(bodySurfacePropsSource).toContain('interactionOverlayProps: {');
    expect(bodySurfacePropsSource).toContain('markerOverlayProps: {');
    expect(bodySurfacePropsSource).toContain('playheadOverlayProps: {');
    expect(bodySurfacePropsSource).toContain('rulerHeaderProps: {');
    expect(bodySurfacePropsSource).toContain('splitDividerProps: {');
    expect(rulerCacheRangesSource).toContain('scrubCacheRevision');
    expect(rulerCacheRangesSource).toContain("masterselects:scrub-cache-updated");
    expect(rulerCacheRangesSource).toContain("type: 'proxy' as const");
    expect(rulerCacheRangesSource).toContain("type: 'cache' as const");
    expect(ramPreviewFeatureGateSource).toContain('RAM_PREVIEW_FEATURE_ENABLED');
    expect(ramPreviewFeatureGateSource).toContain('hasActiveVideoBakeCache');
    expect(ramPreviewFeatureGateSource).toContain('isActiveBakeRegion');
    expect(ramPreviewFeatureGateSource).toContain('cancelRamPreview()');
    expect(actionControllerSource).toContain("from './useTimelineStableActionBindings'");
    expect(actionControllerSource).toContain("from './useTimelineRamPreviewFeatureGate'");
    expect(actionControllerSource).toContain('useTimelineStableActionBindings()');
    expect(actionControllerSource).toContain('useTimelineRamPreviewFeatureGate({');
    expect(actionControllerSource).toContain('toggleRamPreviewEnabled: actions.toggleRamPreviewEnabled');
    expect(actionControllerSource).toContain('cancelRamPreview: actions.cancelRamPreview');
    expect(actionControllerSource).toContain('clearRamPreview: actions.clearRamPreview');
    expect(timelineSource).not.toContain('useTimelineStableActionBindings()');
    expect(timelineSource).not.toContain('useTimelineRamPreviewFeatureGate({');
    expect(compositionSwitchStateSource).toContain("from '../utils/timelineCompositionSwitchTracks'");
    expect(compositionSwitchStateSource).toContain('compositionSwitchSourceTracks');
    expect(compositionSwitchStateSource).toContain('compositionSwitchTargetTracks');
    expect(compositionSwitchStateSource).toContain('buildCompositionSwitchTracks(');
    expect(compositionSwitchStateSource).toContain("clipAnimationPhase !== 'idle'");
    expect(compositionSwitchStateSource).toContain('timeline-switch-exit-left');
    expect(compositionSwitchStateSource).toContain('timeline-switch-enter-right');
    expect(compositionSliceSource).toContain('setCompositionSwitchSourceTracks(timelineStore.tracks)');
    expect(compositionSliceSource).toContain('setCompositionSwitchSourceTracks(null)');
    expect(trackVisibilityStateSource).toContain("from '../utils/trackSection'");
    expect(trackVisibilityStateSource).toContain('isAudioSectionTrackType');
    expect(trackVisibilityStateSource).toContain('anyVideoSolo');
    expect(trackVisibilityStateSource).toContain('anyAudioSolo');
    expect(trackVisibilityStateSource).toContain('isVideoTrackVisible');
    expect(trackVisibilityStateSource).toContain('isAudioTrackMuted');
    expect(combinedDragHandlersSource).toContain("dropEffect = 'none'");
    expect(combinedDragHandlersSource).toContain('isTransitionDrag(event)');
    expect(combinedDragHandlersSource).toContain('onTransitionDragOver(event, trackId, mouseTime)');
    expect(combinedDragHandlersSource).toContain('onTransitionDrop(event, trackId, mouseTime)');
    expect(combinedDragHandlersSource).toContain('onTrackDragOver(event, trackId)');
    expect(combinedDragHandlersSource).toContain('void onTrackDrop(event, trackId)');
    expect(externalDropControllerSource).toContain("from './useExternalDrop'");
    expect(externalDropControllerSource).toContain("from './useTransitionDrop'");
    expect(externalDropControllerSource).toContain("from './useTimelineCombinedDragHandlers'");
    expect(externalDropControllerSource).toContain('useExternalDrop({');
    expect(externalDropControllerSource).toContain('useTransitionDrop()');
    expect(externalDropControllerSource).toContain('useTimelineCombinedDragHandlers({');
    expect(externalDropControllerSource).toContain('onTransitionDragOver: handleTransitionDragOver');
    expect(externalDropControllerSource).toContain('onTrackDrop: handleTrackDrop');
    expect(externalDropControllerSource).toContain('const handleNewTrackDragEnter = useCallback');
    expect(externalDropControllerSource).toContain('dragCounterRef.current++');
    expect(timelineSource).not.toContain("from './hooks/useExternalDrop'");
    expect(timelineSource).not.toContain("from './hooks/useTransitionDrop'");
    expect(timelineSource).not.toContain('dragCounterRef');
    expect(rootStoreStateSource).toContain("from '../../../stores/timeline'");
    expect(rootStoreStateSource).toContain("from '../../../stores/timeline/selectors'");
    expect(rootStoreStateSource).toContain("from '../../../stores/mediaStore'");
    expect(rootStoreStateSource).toContain("from '../tools/pointer/timelineToolPointerDispatcher'");
    expect(rootStoreStateSource).toContain('useTimelineStore(useShallow(selectCoreData))');
    expect(rootStoreStateSource).toContain('useMediaStore(state => state.getActiveComposition)');
    expect(timelineSource).not.toContain('useTimelineStore(');
    expect(timelineSource).not.toContain('useMediaStore(');
    expect(timelineSource).not.toContain('useShallow(');
    expect(timelineSource).not.toContain('selectCoreData');
    expect(timelineSource).not.toContain('getTimelineToolCursor(');
    expect(renderedTrackMetricsSource).toContain("from '../utils/timelineAudioLayout'");
    expect(renderedTrackMetricsSource).toContain('new Map(clips.map');
    expect(renderedTrackMetricsSource).toContain('new Map(tracks.map');
    expect(renderedTrackMetricsSource).toContain('new Map(timelineViewTracks.map');
    expect(renderedTrackMetricsSource).toContain('getTimelineTrackBaseHeight(track, audioDisplayMode, audioFocusMode)');
    expect(renderedTrackMetricsSource).toContain('getExpandedTrackHeight(trackId, baseHeight)');
    expect(timelineSource).not.toContain('new Map(clips.map');
    expect(timelineSource).not.toContain('new Map(tracks.map');
    expect(timelineSource).not.toContain('new Map(timelineViewTracks.map');
    expect(timelineSource).not.toContain('getTimelineTrackBaseHeight');
    expect(timelineSource).not.toContain('void keyframeLayoutInputs');
    expect(clipInteractionControllerSource).toContain("from './useClipDrag'");
    expect(clipInteractionControllerSource).toContain("from './useClipTrim'");
    expect(clipInteractionControllerSource).toContain("from './useClipFade'");
    expect(clipInteractionControllerSource).toContain('useClipDrag({');
    expect(clipInteractionControllerSource).toContain('useClipTrim({');
    expect(clipInteractionControllerSource).toContain('useClipFade({');
    expect(timelineSource).not.toContain("from './hooks/useClipDrag'");
    expect(timelineSource).not.toContain("from './hooks/useClipTrim'");
    expect(timelineSource).not.toContain("from './hooks/useClipFade'");
    expect(playheadMarkerControllerSource).toContain("from './usePlayheadDrag'");
    expect(playheadMarkerControllerSource).toContain("from './useMarkerDrag'");
    expect(playheadMarkerControllerSource).toContain("from './useTimelineCompositionVideoBakeRulerDrag'");
    expect(playheadMarkerControllerSource).toContain('usePlayheadDrag({');
    expect(playheadMarkerControllerSource).toContain('useMarkerDrag({');
    expect(playheadMarkerControllerSource).toContain('useTimelineCompositionVideoBakeRulerDrag({');
    expect(playheadMarkerControllerSource).toContain("activeTimelineToolId === 'select'");
    expect(timelineSource).not.toContain("from './hooks/usePlayheadDrag'");
    expect(timelineSource).not.toContain("from './hooks/useMarkerDrag'");
    expect(timelineSource).not.toContain('const canMarkCompositionVideoBakeRegion');
    expect(proxyBatchStatusSource).toContain('isProxyFrameCountComplete');
    expect(proxyBatchStatusSource).toContain('proxyableFiles');
    expect(trackHeightWheelSource).toContain('scaleTracksOfType');
    expect(trackHeightWheelSource).toContain('setTrackHeight(trackId');
    expect(trackHeightWheelSource).toContain('wheelDelta');
    expect(sectionControllerSource).toContain("from './useTimelineSectionLayout'");
    expect(sectionControllerSource).toContain("from './useTimelineSectionReveal'");
    expect(sectionControllerSource).toContain("from './useTimelineSectionScroll'");
    expect(sectionControllerSource).toContain("from './useTimelineSectionScrollPinning'");
    expect(sectionControllerSource).toContain("from './useTimelineSplitDividerDrag'");
    expect(sectionControllerSource).toContain("from './useTimelineTrackFocusStep'");
    expect(sectionControllerSource).toContain("from './useTimelineTrackResize'");
    expect(sectionControllerSource).toContain('TIMELINE_VIEWPORT_FALLBACK_PX');
    expect(sectionControllerSource).toContain('const isVideoBottomVisible = useCallback');
    expect(sectionControllerSource).toContain('useTimelineSectionReveal({');
    expect(sectionControllerSource).toContain('useTimelineSectionScrollPinning({');
    expect(sectionScrollPinningSource).toContain('setVideoScrollY((current) =>');
    expect(sectionScrollPinningSource).toContain('setAudioScrollY((current) =>');
    expect(sectionScrollPinningSource).toContain('setForceVideoBottomScroll(false)');
    expect(sectionScrollPinningSource).toContain('clampScrollY');
    expect(sourceMonitorDismissSource).toContain('useMediaStore.getState()');
    expect(sourceMonitorDismissSource).toContain('setSourceMonitorFile(null)');
    expect(timelineSource).not.toContain('useMediaStore.getState()');
    expect(stableActionBindingsSource).toContain('useTimelineStore.getState()');
    expect(stableActionBindingsSource).toContain('applyTimelineEditOperation: store.applyTimelineEditOperation');
    expect(rootChromeControllerSource).toContain("from './useTimelineSourceMonitorDismiss'");
    expect(rootChromeControllerSource).toContain("from '../slotGridAnimation'");
    expect(rootChromeControllerSource).toContain("from '../../../stores/timeline/constants'");
    expect(rootChromeControllerSource).toContain('const rootShellProps');
    expect(rootChromeControllerSource).toContain('const slotGridChromeProps');
    expect(rootChromeControllerSource).toContain('const navigatorChromeProps');
    expect(rootChromeControllerSource).toContain('animateSlotGrid(slotGridProgress < 0.5 ? 1 : 0)');
    expect(timelineSource).not.toContain('animateSlotGrid');
    expect(timelineSource).not.toContain('MIN_ZOOM');
    expect(timelineSource).not.toContain('MAX_ZOOM');
    expect(timelineSource).not.toContain('useTimelineStore.getState()');
    expect(timelineSource).not.toContain('const store = useTimelineStore');
    expect(trackFocusStepSource).toContain('const focusOrder: TimelineTrackFocusMode[]');
    expect(trackFocusStepSource).toContain("['audio', 'balanced', 'video']");
    expect(trackFocusStepSource).toContain('setTrackFocusMode(focusOrder[nextIndex])');
    expect(timelineSource).not.toContain("from './TimelineRuler'");
    expect(timelineSource).not.toContain("from './TimelineControls'");
    expect(timelineSource).not.toContain("from './components/TimelineSectionHeaders'");
    expect(timelineSource).not.toMatch(/<PickWhipCables\s/);
    expect(timelineSource).not.toMatch(/<TimelineContextMenu\s/);
    expect(timelineSource).not.toMatch(/<TimelineEmptyContextMenu\s/);
    expect(timelineSource).not.toMatch(/<TrackContextMenu\s/);
    expect(timelineSource).not.toMatch(/<MarkerContextMenu\s/);
    expect(timelineSource).not.toMatch(/<InOutContextMenu\s/);
    expect(timelineSource).not.toMatch(/<MulticamDialog\s/);
    expect(timelineSource).not.toContain('useTimelineAuxiliaryLayerProps({');
    expect(timelineSource).toContain('<TimelineAuxiliaryLayer {...auxiliaryLayerProps} />');
    expect(lineCount(timelineSource)).toBeLessThanOrEqual(699);
    for (const modulePath of splitModules) {
      expect(lineCount(readRepoFile(modulePath)), `${modulePath} exceeds host split budget`).toBeLessThanOrEqual(300);
    }
  });

  it('keeps nested composition layer building out of the layer sync hook', () => {
    const layerSyncSource = readRepoFile('src/components/timeline/hooks/useLayerSync.ts');
    const audioPlaybackSource = readRepoFile('src/components/timeline/utils/layerSyncAudioPlayback.ts');
    const nestedLayerBuilderSource = readRepoFile('src/components/timeline/utils/layerSyncNestedLayers.ts');
    const proxyFrameSource = readRepoFile('src/components/timeline/utils/layerSyncProxyFrames.ts');

    expect(layerSyncSource).toContain("from '../utils/layerSyncAudioPlayback'");
    expect(layerSyncSource).toContain("from '../utils/layerSyncNestedLayers'");
    expect(layerSyncSource).toContain("from '../utils/layerSyncProxyFrames'");
    expect(layerSyncSource).toContain('syncLayerAudioPlayback({');
    expect(layerSyncSource).toContain('buildLayerSyncNestedLayers({');
    expect(layerSyncSource).toContain('syncLayerProxyFrame({');
    expect(layerSyncSource).not.toContain("from '../../../services/audioManager'");
    expect(layerSyncSource).not.toContain("from '../../../services/logger'");
    expect(layerSyncSource).not.toContain("from '../../../services/proxyFrameCache'");
    expect(layerSyncSource).not.toContain('audioStatusTracker.updateStatus');
    expect(layerSyncSource).not.toContain('audio.play().catch');
    expect(layerSyncSource).not.toContain('proxyFrameCache.getCachedFrame');
    expect(layerSyncSource).not.toContain('proxy-image-frame-nearest');
    expect(layerSyncSource).not.toContain('getInterpolatedClipTransform');
    expect(layerSyncSource).not.toContain('DEFAULT_TRANSFORM');
    expect(layerSyncSource).not.toContain('const nestedVideoTracks');
    expect(layerSyncSource).not.toContain('function buildNestedBaseTransform');
    expect(audioPlaybackSource).toContain("from '../../../services/audioManager'");
    expect(audioPlaybackSource).toContain('syncLayerAudioPlayback');
    expect(audioPlaybackSource).toContain('audioStatusTracker.updateStatus');
    expect(audioPlaybackSource).toContain('pauseInactiveAudioClips');
    expect(proxyFrameSource).toContain("from '../../../services/proxyFrameCache'");
    expect(proxyFrameSource).toContain('syncLayerProxyFrame');
    expect(proxyFrameSource).toContain('getNearestCachedFrameEntry');
    expect(proxyFrameSource).toContain('previewPath: \'proxy-image-frame-hold\'');
    expect(nestedLayerBuilderSource).toContain('buildLayerSyncNestedLayers');
    expect(nestedLayerBuilderSource).toContain('getInterpolatedClipTransform');
    expect(nestedLayerBuilderSource).toContain('clipKeyframes.get(nestedClip.id)');
    expect(nestedLayerBuilderSource).toContain('getLazyImageElementForClip');
    expect(lineCount(layerSyncSource)).toBeLessThanOrEqual(596);
    expect(lineCount(audioPlaybackSource)).toBeLessThanOrEqual(190);
    expect(lineCount(nestedLayerBuilderSource)).toBeLessThanOrEqual(220);
    expect(lineCount(proxyFrameSource)).toBeLessThanOrEqual(280);
  });

  it('keeps TimelineTrack property rows and curve transactions out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const propertyRowsSource = readRepoFile('src/components/timeline/components/TrackPropertyTracks.tsx');
    const curveTransactionsSource = readRepoFile('src/components/timeline/hooks/useTrackPropertyCurveEditTransactions.ts');
    const propertyRowsUtilSource = readRepoFile('src/components/timeline/utils/timelineTrackPropertyRows.ts');

    expect(trackSource).toContain("from './components/TrackPropertyTracks'");
    expect(trackSource).toContain('<TrackPropertyTracks');
    expect(trackSource).not.toContain("from './CurveEditor'");
    expect(trackSource).not.toContain('function TrackPropertyTracks');
    expect(trackSource).not.toContain('buildTimelineKeyframeRowGeometries');
    expect(trackSource).not.toContain('curveKeyframeTransactionRef');
    expect(trackSource).not.toContain('curveBezierTransactionRef');
    expect(trackSource).not.toContain('parseVectorAnimationInputProperty');
    expect(propertyRowsSource).toContain("from '../CurveEditor'");
    expect(propertyRowsSource).toContain('buildTimelineKeyframeRowGeometries');
    expect(propertyRowsSource).toContain('useTrackPropertyCurveEditTransactions');
    expect(propertyRowsSource).toContain('resolveTimelineTrackPenKeyframeValue');
    expect(curveTransactionsSource).toContain('keyframe-transaction-begin');
    expect(curveTransactionsSource).toContain('keyframe-update-bezier-handle');
    expect(curveTransactionsSource).toContain("Logger.create('TrackPropertyCurveEditTransactions')");
    expect(propertyRowsUtilSource).toContain('sortTimelineTrackPropertyRows');
    expect(propertyRowsUtilSource).toContain('parseVectorAnimationInputProperty');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(1800);
    expect(lineCount(propertyRowsSource)).toBeLessThanOrEqual(240);
    expect(lineCount(curveTransactionsSource)).toBeLessThanOrEqual(340);
    expect(lineCount(propertyRowsUtilSource)).toBeLessThanOrEqual(120);
  });

  it('keeps TimelineHeader audio and MIDI mixer controls out of the header host', () => {
    const headerSource = readRepoFile('src/components/timeline/TimelineHeader.tsx');
    const audioControlsSource = readRepoFile('src/components/timeline/components/TimelineHeaderAudioControls.tsx');
    const audioSendsSource = readRepoFile('src/components/timeline/components/TimelineHeaderAudioSends.tsx');
    const trackIconsSource = readRepoFile('src/components/timeline/components/TimelineHeaderTrackIcons.tsx');
    const popoverStateSource = readRepoFile('src/components/timeline/hooks/useTimelineHeaderAudioPopoverState.ts');

    expect(headerSource).toContain("from './components/TimelineHeaderAudioControls'");
    expect(headerSource).toContain("from './components/TimelineHeaderTrackIcons'");
    expect(headerSource).toContain("from './hooks/useTimelineHeaderAudioPopoverState'");
    expect(headerSource).toContain('<TimelineHeaderMixerMainControls');
    expect(headerSource).toContain('<TimelineHeaderMixerControls');
    expect(headerSource).toContain('<TimelineHeaderAudioSummaryMeter');
    expect(headerSource).not.toContain("from '@tabler/icons-react'");
    expect(headerSource).not.toContain('AudioEffectStackControl');
    expect(headerSource).not.toContain('AudioLevelMeter');
    expect(headerSource).not.toContain('MIDI_INSTRUMENT_OPTIONS');
    expect(headerSource).not.toContain('setTrackAudioVolumeDb');
    expect(headerSource).not.toContain('setTrackAudioPan');
    expect(headerSource).not.toContain('setTrackMidiInstrument');
    expect(headerSource).not.toContain('audioFxPopoverRef');
    expect(headerSource).not.toContain('audioSendsPopoverRef');
    expect(headerSource).not.toContain('setAudioFxOpen');
    expect(headerSource).not.toContain('setAudioSendsOpen');
    expect(headerSource).not.toContain('audio-send-stack');
    expect(headerSource).not.toContain('midi-instrument-select');
    expect(audioControlsSource).toContain('AudioEffectStackControl');
    expect(audioControlsSource).toContain('AudioLevelMeter');
    expect(audioControlsSource).toContain('MIDI_INSTRUMENT_OPTIONS');
    expect(audioControlsSource).toContain('setTrackAudioVolumeDb');
    expect(audioControlsSource).toContain('setTrackAudioPan');
    expect(audioControlsSource).toContain('setTrackMidiInstrument');
    expect(audioControlsSource).toContain('TimelineHeaderAudioSends');
    expect(audioSendsSource).toContain('addTrackAudioSend');
    expect(audioSendsSource).toContain('updateTrackAudioSend');
    expect(audioSendsSource).toContain('removeTrackAudioSend');
    expect(trackIconsSource).toContain("from '@tabler/icons-react'");
    expect(trackIconsSource).toContain('IconVolume2');
    expect(popoverStateSource).toContain('audioFxPopoverRef');
    expect(popoverStateSource).toContain('audioSendsPopoverRef');
    expect(popoverStateSource).toContain("document.addEventListener('pointerdown'");
    expect(lineCount(headerSource)).toBeLessThanOrEqual(338);
    expect(lineCount(audioControlsSource)).toBeLessThanOrEqual(400);
    expect(lineCount(audioSendsSource)).toBeLessThanOrEqual(120);
    expect(lineCount(trackIconsSource)).toBeLessThanOrEqual(100);
    expect(lineCount(popoverStateSource)).toBeLessThanOrEqual(80);
  });

  it('keeps TimelineHeader property labels, values, and keyframe rows out of the header host', () => {
    const headerSource = readRepoFile('src/components/timeline/TimelineHeader.tsx');
    const propertyLabelsHostSource = readRepoFile('src/components/timeline/components/TimelineHeaderPropertyLabels.tsx');
    const propertyRowSource = readRepoFile('src/components/timeline/components/TimelineHeaderPropertyRow.tsx');
    const propertyModelSource = readRepoFile('src/components/timeline/utils/timelineHeaderPropertyModel.ts');
    const propertyLabelsModelSource = readRepoFile('src/components/timeline/utils/timelineHeaderPropertyLabels.ts');
    const propertyTypesSource = readRepoFile('src/components/timeline/utils/timelineHeaderPropertyTypes.ts');
    const colorPropertyModelSource = readRepoFile('src/components/timeline/utils/timelineHeaderColorPropertyModel.ts');
    const vectorPropertyModelSource = readRepoFile('src/components/timeline/utils/timelineHeaderVectorPropertyModel.ts');
    const audioEqPropertyModelSource = readRepoFile('src/components/timeline/utils/timelineHeaderAudioEqPropertyModel.ts');

    expect(headerSource).toContain("from './components/TimelineHeaderPropertyLabels'");
    expect(headerSource).toContain('<TimelineHeaderPropertyLabels');
    expect(headerSource).not.toContain('function PropertyRow');
    expect(headerSource).not.toContain('function TrackPropertyLabels');
    expect(headerSource).not.toContain('CurveEditorHeader');
    expect(headerSource).not.toContain('propertyKeyframeDragSession');
    expect(headerSource).not.toContain('parseVectorAnimationInputProperty');
    expect(headerSource).not.toContain('parseMaskProperty');
    expect(headerSource).not.toContain('getMaskPathValue');
    expect(headerSource).not.toContain('getValueFromEffects');
    expect(headerSource).not.toContain('getAudioEqPropertyMeta');
    expect(headerSource).not.toContain('resolveCameraLookAtFixedEyeUpdates');
    expect(headerSource).not.toContain('createEffectProperty');

    expect(propertyLabelsHostSource).toContain('TimelineHeaderPropertyRow');
    expect(propertyLabelsHostSource).toContain('sortTimelineHeaderProperties');
    expect(propertyLabelsHostSource).toContain('createEffectProperty');
    expect(propertyRowSource).toContain('CurveEditorHeader');
    expect(propertyRowSource).toContain('getHeaderPropertyCurrentValue');
    expect(propertyRowSource).toContain('getHeaderPropertySensitivity');
    expect(propertyRowSource).toContain('getHeaderPropertyDefaultValue');
    expect(propertyRowSource).toContain('resolveCameraLookAtFixedEyeUpdates');
    expect(propertyRowSource).toContain('propertyKeyframeDragSession');
    expect(propertyModelSource).toContain("from './timelineHeaderPropertyLabels'");
    expect(propertyModelSource).toContain("from './timelineHeaderColorPropertyModel'");
    expect(propertyModelSource).toContain("from './timelineHeaderVectorPropertyModel'");
    expect(propertyModelSource).toContain('getHeaderPropertyCurrentValue');
    expect(propertyModelSource).toContain('formatHeaderPropertyValue');
    expect(propertyModelSource).not.toContain('PRIMARY_COLOR_PARAM_DEFS');
    expect(propertyModelSource).not.toContain('mergeVectorAnimationSettings');
    expect(propertyModelSource).not.toContain('getVectorAnimationInputBaseValue');
    expect(propertyModelSource).not.toContain('getTimelineHeaderTransformPropertyOrder');
    expect(propertyLabelsModelSource).toContain('getHeaderPropertyLabel');
    expect(propertyLabelsModelSource).toContain('sortTimelineHeaderProperties');
    expect(propertyLabelsModelSource).toContain('getTimelineHeaderColorPropertyMeta');
    expect(propertyTypesSource).toContain('export type KeyframeTrackClip');
    expect(propertyTypesSource).toContain('shouldHide3DOnlyProperties');
    expect(colorPropertyModelSource).toContain('PRIMARY_COLOR_PARAM_DEFS');
    expect(colorPropertyModelSource).toContain('getColorNodeParamValue');
    expect(colorPropertyModelSource).toContain('getTimelineHeaderColorPropertyValue');
    expect(vectorPropertyModelSource).toContain('mergeVectorAnimationSettings');
    expect(vectorPropertyModelSource).toContain('getVectorAnimationInputBaseValue');
    expect(vectorPropertyModelSource).toContain('getTimelineHeaderVectorAnimationPropertyValue');
    expect(audioEqPropertyModelSource).toContain('getAudioEqPropertyMeta');
    expect(audioEqPropertyModelSource).toContain('getValueFromEffects');
    expect(audioEqPropertyModelSource).toContain('normalizeAudioEqParams');

    expect(lineCount(headerSource)).toBeLessThanOrEqual(338);
    expect(lineCount(propertyLabelsHostSource)).toBeLessThanOrEqual(140);
    expect(lineCount(propertyRowSource)).toBeLessThanOrEqual(330);
    expect(lineCount(propertyModelSource)).toBeLessThanOrEqual(250);
    expect(lineCount(propertyLabelsModelSource)).toBeLessThanOrEqual(170);
    expect(lineCount(propertyTypesSource)).toBeLessThanOrEqual(60);
    expect(lineCount(colorPropertyModelSource)).toBeLessThanOrEqual(80);
    expect(lineCount(vectorPropertyModelSource)).toBeLessThanOrEqual(100);
    expect(lineCount(audioEqPropertyModelSource)).toBeLessThanOrEqual(180);
  });

  it('keeps interaction-shell module command dispatch out of the TimelineTrack host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const dispatcherSource = readRepoFile('src/components/timeline/hooks/useClipInteractionShellModuleCommandDispatcher.ts');

    expect(trackSource).toContain("from './hooks/useClipInteractionShellModuleCommandDispatcher'");
    expect(trackSource).toContain('useClipInteractionShellModuleCommandDispatcher()');
    expect(trackSource).not.toContain('type ClipInteractionShellModuleCommand');
    expect(trackSource).not.toContain('resolveAudioRegionTimelineRangeForClip');
    expect(trackSource).not.toContain('AUDIO_REGION_TIMELINE_EPSILON');
    expect(trackSource).not.toContain('setAudioRegionSelection(command.selection)');
    expect(trackSource).not.toContain('copySelectedAudioRegion()');
    expect(trackSource).not.toContain('prewarmStemSourceMediaFiles');
    expect(trackSource).not.toContain('bakeClipVideoBakeRegion');
    expect(dispatcherSource).toContain('ClipInteractionShellModuleCommand');
    expect(dispatcherSource).toContain('resolveAudioRegionTimelineRangeForClip');
    expect(dispatcherSource).toContain('setAudioRegionSelection(command.selection)');
    expect(dispatcherSource).toContain('copySelectedAudioRegion()');
    expect(dispatcherSource).toContain('prewarmStemSourceMediaFiles');
    expect(dispatcherSource).toContain('bakeClipVideoBakeRegion');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(1567);
    expect(lineCount(dispatcherSource)).toBeLessThanOrEqual(280);
  });

  it('keeps interaction-shell keyframe group move transactions out of the TimelineTrack host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const keyframeMoveSource = readRepoFile('src/components/timeline/hooks/useClipInteractionShellKeyframeGroupMove.ts');

    expect(trackSource).toContain("from './hooks/useClipInteractionShellKeyframeGroupMove'");
    expect(trackSource).toContain('useClipInteractionShellKeyframeGroupMove({');
    expect(trackSource).toContain('onMoveKeyframeGroup: handleShellKeyframeGroupMove');
    expect(trackSource).not.toContain('keyframeTickTransactionRef');
    expect(trackSource).not.toContain('keyframeTickTransactionCounterRef');
    expect(trackSource).not.toContain('type KeyframeTickMovePhase');
    expect(trackSource).not.toContain('keyframe-tick:${context.clip.id}');
    expect(trackSource).not.toContain("intent: 'drag-diamond'");
    expect(keyframeMoveSource).toContain('keyframeTickTransactionRef');
    expect(keyframeMoveSource).toContain('keyframe-transaction-begin');
    expect(keyframeMoveSource).toContain("intent: 'drag-diamond'");
    expect(keyframeMoveSource).toContain("Logger.create('ClipInteractionShellKeyframeGroupMove')");
    expect(lineCount(trackSource)).toBeLessThanOrEqual(1423);
    expect(lineCount(keyframeMoveSource)).toBeLessThanOrEqual(200);
  });

  it('keeps TimelineTrack projection and shell geometry adapters out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const geometryAdapterSource = readRepoFile('src/components/timeline/utils/timelineTrackGeometryAdapter.ts');
    const pointerToolsSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackPointerTools.ts');
    const marqueeSelectionSource = readRepoFile('src/components/timeline/hooks/useMarqueeSelection.ts');

    expect(trackSource).toContain("from './utils/timelineTrackGeometryAdapter'");
    expect(trackSource).toContain('buildTimelineTrackHostGeometrySnapshot({');
    expect(trackSource).toContain('buildTimelineTrackClipShellGeometry({');
    expect(trackSource).toContain('buildTimelineTrackRangeShellRect({');
    expect(trackSource).not.toContain('function mapTrackProjectionKind');
    expect(trackSource).not.toContain('mapClipProjectionSourceKind');
    expect(trackSource).not.toContain('buildTimelineTrackHostProjection');
    expect(trackSource).not.toContain('timelineClipBodyToShellRect');
    expect(trackSource).not.toContain('function createShellRect');
    expect(trackSource).not.toContain('timelineTimeRangeToRect');
    expect(trackSource).not.toContain('buildTimelineGeometrySnapshot');
    expect(geometryAdapterSource).toContain('buildTimelineTrackHostProjection');
    expect(geometryAdapterSource).toContain('buildTimelineGeometrySnapshot');
    expect(geometryAdapterSource).toContain('timelineTimeRangeToRect');
    expect(geometryAdapterSource).toContain('buildTimelineTrackClipShellGeometry');
    expect(pointerToolsSource).toContain('timelineClipGeometryById.get(clip.id)');
    expect(pointerToolsSource).toContain('clipGeometry.bodyRect.width');
    expect(pointerToolsSource).not.toContain('timeToPixel(');
    expect(pointerToolsSource).not.toContain('pixelToTime(contentX)');
    expect(marqueeSelectionSource).toContain('buildTimelineTrackHostGeometrySnapshot');
    expect(marqueeSelectionSource).toContain('buildTimelineTrackClipGeometryMap');
    expect(marqueeSelectionSource).not.toContain('timeToPixel(clip.startTime)');
    expect(marqueeSelectionSource).not.toContain('timeToPixel(clip.startTime + clip.duration)');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(1250);
    expect(lineCount(geometryAdapterSource)).toBeLessThanOrEqual(300);
  });

  it('keeps TimelineTrack interaction shell state out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const shellStateHookSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackInteractionShellState.ts');
    const shellStateSource = readRepoFile('src/components/timeline/utils/timelineTrackInteractionShellState.ts');
    const activeModulesSource = readRepoFile('src/components/timeline/utils/timelineTrackShellActiveModules.ts');

    expect(trackSource).toContain("from './hooks/useTimelineTrackInteractionShellState'");
    expect(trackSource).toContain('useTimelineTrackInteractionShellState({');
    expect(trackSource).not.toContain('useMediaStore');
    expect(trackSource).not.toContain('ClipInteractionShellActiveModules');
    expect(trackSource).not.toContain('ClipInteractionShellMountReason');
    expect(trackSource).not.toContain('ClipInteractionShellMountState');
    expect(trackSource).not.toContain('ClipInteractionShellSpectralImageMediaRef');
    expect(trackSource).not.toContain('SPECTRAL_AUDIO_EXTENSIONS');
    expect(trackSource).not.toContain('isTimelineTrackShellAudioClip');
    expect(trackSource).not.toContain('getClipShellKeyframeGroups');
    expect(trackSource).not.toContain('clipShellKeyframeStateByClipId');
    expect(trackSource).not.toContain('clipShellSpecialStateByClipId');
    expect(trackSource).not.toContain('domControlClipIds');
    expect(shellStateHookSource).toContain("from '../utils/timelineTrackInteractionShellState'");
    expect(shellStateHookSource).toContain("from '../utils/timelineTrackShellActiveModules'");
    expect(shellStateHookSource).toContain('useMediaStore');
    expect(shellStateHookSource).toContain('buildTimelineTrackShellKeyframeStateByClipId');
    expect(shellStateHookSource).toContain('buildTimelineTrackShellDomControlClipIds');
    expect(shellStateSource).toContain('getClipShellKeyframeGroups');
    expect(shellStateSource).toContain('buildTimelineTrackClipShellMountState');
    expect(activeModulesSource).toContain('buildTimelineTrackClipShellActiveModules');
    expect(activeModulesSource).toContain('SPECTRAL_AUDIO_EXTENSIONS');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(920);
    expect(lineCount(shellStateHookSource)).toBeLessThanOrEqual(240);
    expect(lineCount(shellStateSource)).toBeLessThanOrEqual(260);
    expect(lineCount(activeModulesSource)).toBeLessThanOrEqual(180);
  });

  it('keeps TimelineTrack pointer tool dispatch out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const pointerToolsSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackPointerTools.ts');

    expect(trackSource).toContain("from './hooks/useTimelineTrackPointerTools'");
    expect(trackSource).toContain('useTimelineTrackPointerTools({');
    expect(trackSource).not.toContain("from './tools/pointer/timelineToolPointerDispatcher'");
    expect(trackSource).not.toContain('dispatchTimelineClipPointerMove');
    expect(trackSource).not.toContain('dispatchTimelineClipPointerClick');
    expect(trackSource).not.toContain('isTimelinePointerTool');
    expect(trackSource).not.toContain('buildClipPointerContext');
    expect(trackSource).not.toContain('setTimelineToolPreview');
    expect(pointerToolsSource).toContain("from '../tools/pointer/timelineToolPointerDispatcher'");
    expect(pointerToolsSource).toContain('dispatchTimelineClipPointerMove');
    expect(pointerToolsSource).toContain('dispatchTimelineClipPointerClick');
    expect(pointerToolsSource).toContain('buildClipPointerContext');
    expect(pointerToolsSource).toContain('setTimelineToolPreview');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(825);
    expect(lineCount(pointerToolsSource)).toBeLessThanOrEqual(160);
  });

  it('keeps TimelineTrack external drop preview rendering out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const previewsSource = readRepoFile('src/components/timeline/components/TimelineTrackExternalDropPreviews.tsx');

    expect(trackSource).toContain("from './components/TimelineTrackExternalDropPreviews'");
    expect(trackSource).toContain('<TimelineTrackExternalDropPreviews');
    expect(trackSource).not.toContain('const renderExternalPreview');
    expect(trackSource).not.toContain('timeline-clip-preview-thumbnail');
    expect(trackSource).not.toContain('Audio (linked)');
    expect(trackSource).not.toContain('externalDrag.audioTrackId === track.id');
    expect(trackSource).not.toContain('externalDrag.videoTrackId === track.id');
    expect(previewsSource).toContain('timeline-clip-preview-thumbnail');
    expect(previewsSource).toContain('Audio (linked)');
    expect(previewsSource).toContain('externalDrag.audioTrackId === trackId');
    expect(previewsSource).toContain('externalDrag.videoTrackId === trackId');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(775);
    expect(lineCount(previewsSource)).toBeLessThanOrEqual(120);
  });

  it('keeps TimelineTrack row interactions and small overlay controls out of the track host', () => {
    const trackSource = readRepoFile('src/components/timeline/TimelineTrack.tsx');
    const rowEventsSource = readRepoFile('src/components/timeline/hooks/useTimelineTrackClipRowEvents.ts');
    const renameInputSource = readRepoFile('src/components/timeline/components/TimelineCanvasClipRenameInput.tsx');
    const resizeHandleSource = readRepoFile('src/components/timeline/components/TimelineTrackResizeHandle.tsx');

    expect(trackSource).toContain("from './hooks/useTimelineTrackClipRowEvents'");
    expect(trackSource).toContain("from './components/TimelineCanvasClipRenameInput'");
    expect(trackSource).toContain("from './components/TimelineTrackResizeHandle'");
    expect(trackSource).toContain('useTimelineTrackClipRowEvents({');
    expect(trackSource).toContain('{...clipRowEvents}');
    expect(trackSource).toContain('<TimelineCanvasClipRenameInput');
    expect(trackSource).toContain('<TimelineTrackResizeHandle');
    expect(trackSource).not.toContain('isTimelineActiveTarget');
    expect(trackSource).not.toContain('timeline-canvas-clip-name-input');
    expect(trackSource).not.toContain('renameMidiClip');
    expect(trackSource).not.toContain('setClipRenameId(null)');
    expect(trackSource).not.toContain('cancelledRef');
    expect(trackSource).not.toContain('inputRef');
    expect(trackSource).not.toContain('track-resize-handle track-resize-handle-lane');
    expect(trackSource).not.toContain('Drag to resize track height');
    expect(rowEventsSource).toContain('isTimelineActiveTarget');
    expect(rowEventsSource).toContain('handleTimelineToolPointerClick');
    expect(rowEventsSource).toContain('onEmptyMouseDown(event, trackId, time)');
    expect(rowEventsSource).toContain('onEmptyContextMenu(event, trackId, time)');
    expect(renameInputSource).toContain('timeline-canvas-clip-name-input');
    expect(renameInputSource).toContain('renameMidiClip');
    expect(renameInputSource).toContain('setClipRenameId(null)');
    expect(resizeHandleSource).toContain('track-resize-handle track-resize-handle-lane');
    expect(resizeHandleSource).toContain('Drag to resize track height');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(700);
    expect(lineCount(rowEventsSource)).toBeLessThanOrEqual(140);
    expect(lineCount(renameInputSource)).toBeLessThanOrEqual(100);
    expect(lineCount(resizeHandleSource)).toBeLessThanOrEqual(40);
  });

  it('keeps the TimelineClipCanvas waveform painter out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const painterSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasWaveformPainter.ts');
    const envelopeSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasWaveformEnvelopePath.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasWaveformPainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasAudioWaveform(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasWaveformPainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasAudioWaveform(');
    expect(canvasSource).not.toContain('function drawAudioWaveform');
    expect(canvasSource).not.toContain('function drawDetailedCanvasWaveform');
    expect(canvasSource).not.toContain('function drawCompactCanvasWaveform');
    expect(canvasSource).not.toContain('function buildCanvasSignedEnvelopePath');
    expect(canvasSource).not.toContain('function buildCanvasSmoothEnvelopePath');
    expect(canvasSource).not.toContain('buildWaveformLod');
    expect(canvasSource).not.toContain('normalizeWaveformColumnsForDisplay');
    expect(canvasSource).not.toContain('resolveWaveformDisplayReferencePeak');
    expect(canvasSource).not.toContain('smoothWaveformColumns');
    expect(painterSource).toContain('export function drawTimelineClipCanvasAudioWaveform');
    expect(painterSource).toContain('buildWaveformLod');
    expect(painterSource).toContain("from './timelineClipCanvasWaveformEnvelopePath'");
    expect(envelopeSource).toContain('export function buildCanvasSignedEnvelopePath');
    expect(envelopeSource).toContain('export function buildCanvasSmoothEnvelopePath');
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(435);
    expect(lineCount(painterSource)).toBeLessThanOrEqual(200);
    expect(lineCount(envelopeSource)).toBeLessThanOrEqual(120);
  });

  it('keeps the TimelineClipCanvas composition painter out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const compositionSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasCompositionPainter.ts');
    const segmentsSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasCompositionSegmentsPainter.ts');
    const coverSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasCoverDraw.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasCompositionPainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasCompositionDecorations(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasCompositionPainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasCompositionDecorations(');
    expect(canvasSource).not.toContain('function drawCanvasCompositionOutline');
    expect(canvasSource).not.toContain('function drawCanvasNestedBoundaries');
    expect(canvasSource).not.toContain('function drawCanvasSegmentThumbnails');
    expect(canvasSource).not.toContain('function drawCanvasMixdownWaveform');
    expect(canvasSource).not.toContain('function drawCanvasCompositionDecorations');
    expect(canvasSource).not.toContain('function drawCover');
    expect(compositionSource).toContain('export function drawTimelineClipCanvasCompositionDecorations');
    expect(compositionSource).toContain("from './timelineClipCanvasCompositionSegmentsPainter'");
    expect(compositionSource).toContain("from './timelineClipCanvasWaveformPainter'");
    expect(segmentsSource).toContain('export function drawTimelineClipCanvasCompositionSegmentThumbnails');
    expect(segmentsSource).toContain("from './timelineClipCanvasCoverDraw'");
    expect(coverSource).toContain('export function drawTimelineClipCanvasCover');
    expect(lineCount(compositionSource)).toBeLessThanOrEqual(200);
    expect(lineCount(segmentsSource)).toBeLessThanOrEqual(120);
    expect(lineCount(coverSource)).toBeLessThanOrEqual(40);
  });

  it('keeps the TimelineClipCanvas source-extension ghost painter out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const ghostSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasSourceExtensionGhostPainter.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasSourceExtensionGhostPainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasSourceExtensionGhosts(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasSourceExtensionGhostPainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasSourceExtensionGhosts(');
    expect(canvasSource).not.toContain('function drawSourceExtensionGhost');
    expect(canvasSource).not.toContain('function drawSourceExtensionGhosts');
    expect(ghostSource).toContain('export function drawTimelineClipCanvasSourceExtensionGhosts');
    expect(ghostSource).toContain('TimelineClipCanvasTrimGeometry');
    expect(lineCount(ghostSource)).toBeLessThanOrEqual(160);
  });

  it('keeps the TimelineClipCanvas MIDI and fade painters out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const midiSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMidiPreviewPainter.ts');
    const fadeSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasFadeCurvePainter.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasMidiPreviewPainter'");
    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasFadeCurvePainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasMidiPreviewResource(');
    expect(canvasSource).not.toContain('drawTimelineClipCanvasFadeCurve(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasMidiPreviewPainter'");
    expect(mainDrawSource).toContain("from './timelineClipCanvasFadeCurvePainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasMidiPreviewResource(');
    expect(mainDrawSource).toContain('drawTimelineClipCanvasFadeCurve(');
    expect(canvasSource).not.toContain('function drawCanvasMidiPreviewResource');
    expect(canvasSource).not.toContain('function drawCanvasFadeCurve');
    expect(canvasSource).not.toContain('buildFadeCurvePath');
    expect(midiSource).toContain('export function drawTimelineClipCanvasMidiPreviewResource');
    expect(midiSource).toContain('TimelineClipCanvasWorkerMidiPreviewResource');
    expect(fadeSource).toContain('export function drawTimelineClipCanvasFadeCurve');
    expect(fadeSource).toContain('buildFadeCurvePath');
    expect(lineCount(midiSource)).toBeLessThanOrEqual(80);
    expect(lineCount(fadeSource)).toBeLessThanOrEqual(80);
  });

  it('keeps the TimelineClipCanvas passive decoration painters out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const decorationSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasPassiveDecorationsPainter.ts');
    const badgeSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasPassiveBadgePainter.ts');
    const analysisSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasPassiveAnalysisPainter.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasPassiveDecorationsPainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasPassiveDecorations(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasPassiveDecorationsPainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasPassiveDecorations(');
    expect(canvasSource).not.toContain('function drawCanvasClipBadges');
    expect(canvasSource).not.toContain('function drawCanvasClipProgressBars');
    expect(canvasSource).not.toContain('function drawCanvasTranscriptMarkers');
    expect(canvasSource).not.toContain('function drawCanvasAnalysisOverlay');
    expect(canvasSource).not.toContain('function drawCanvasPassiveDecorations');
    expect(decorationSource).toContain('export function drawTimelineClipCanvasPassiveDecorations');
    expect(decorationSource).toContain('drawTimelineClipCanvasPassiveAnalysisOverlay');
    expect(decorationSource).toContain('drawTimelineClipCanvasPassiveProgressBars');
    expect(decorationSource).toContain('drawTimelineClipCanvasPassiveBadges');
    expect(badgeSource).toContain('export function drawTimelineClipCanvasPassiveBadges');
    expect(badgeSource).toContain('export function drawTimelineClipCanvasPassiveProgressBars');
    expect(analysisSource).toContain('export function drawTimelineClipCanvasPassiveAnalysisOverlay');
    expect(lineCount(decorationSource)).toBeLessThanOrEqual(100);
    expect(lineCount(badgeSource)).toBeLessThanOrEqual(100);
    expect(lineCount(analysisSource)).toBeLessThanOrEqual(120);
  });

  it('keeps the TimelineClipCanvas worker thumbnail preparation out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const preparationSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasThumbnailPreparation.ts');

    expect(canvasSource).toContain("from './utils/timelineClipCanvasThumbnailPreparation'");
    expect(canvasSource).toContain('collectTimelineClipCanvasWorkerThumbnailPreparation(');
    expect(canvasSource).not.toContain('getTimelineClipCanvasThumbnailMediaFileId(');
    expect(canvasSource).not.toContain('function clipShowsThumbnails');
    expect(canvasSource).not.toContain('function collectWorkerThumbnailPreparation');
    expect(canvasSource).not.toContain('interface WorkerThumbnailPreparation');
    expect(canvasSource).not.toContain('TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH');
    expect(canvasSource).not.toContain('TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT');
    expect(canvasSource).not.toContain('hasThumbnailBitmap');
    expect(preparationSource).toContain('export function collectTimelineClipCanvasWorkerThumbnailPreparation');
    expect(preparationSource).toContain('export function getTimelineClipCanvasThumbnailMediaFileId');
    expect(preparationSource).toContain('hasThumbnailBitmap');
    expect(preparationSource).toContain('TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH');
    expect(lineCount(preparationSource)).toBeLessThanOrEqual(180);
  });

  it('keeps the TimelineClipCanvas visible artifact collection out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const collectionSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasVisibleArtifactCollection.ts');
    const thumbnailWarmupsSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasThumbnailWarmups.ts');

    expect(canvasSource).toContain("from './utils/timelineClipCanvasVisibleArtifactCollection'");
    expect(canvasSource).toContain('collectTimelineClipCanvasVisibleAudioArtifactClipIds(');
    expect(canvasSource).not.toContain('collectTimelineClipCanvasVisibleThumbnailSecondRanges(');
    expect(canvasSource).not.toContain('timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges(');
    expect(canvasSource).not.toContain('function addVisibleThumbnailSecondRange');
    expect(canvasSource).not.toContain('function collectVisibleThumbnailSecondRanges');
    expect(canvasSource).not.toContain('function collectVisibleAudioArtifactClipIds');
    expect(canvasSource).not.toContain('function getThumbnailCacheEventSeconds');
    expect(canvasSource).not.toContain('function thumbnailCacheEventIntersectsVisibleRanges');
    expect(canvasSource).not.toContain('interface VisibleThumbnailSecondRange');
    expect(collectionSource).toContain('export function collectTimelineClipCanvasVisibleThumbnailSecondRanges');
    expect(collectionSource).toContain('export function collectTimelineClipCanvasVisibleAudioArtifactClipIds');
    expect(collectionSource).toContain('export function timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges');
    expect(collectionSource).toContain('ThumbnailCacheEvent');
    expect(collectionSource).toContain('getTimelineClipCanvasThumbnailMediaFileId');
    expect(thumbnailWarmupsSource).toContain('collectTimelineClipCanvasVisibleThumbnailSecondRanges(');
    expect(thumbnailWarmupsSource).toContain('timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges(');
    expect(lineCount(collectionSource)).toBeLessThanOrEqual(160);
  });

  it('keeps TimelineClipCanvas thumbnail painting and worker draw resource helpers out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const mainDrawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');
    const thumbnailPainterSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasThumbnailPainter.ts');
    const workerResourceSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasWorkerDrawResources.ts');
    const workerRuntimeSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime.ts');

    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasThumbnailPainter'");
    expect(canvasSource).not.toContain('drawTimelineClipCanvasThumbnails(');
    expect(mainDrawSource).toContain("from './timelineClipCanvasThumbnailPainter'");
    expect(mainDrawSource).toContain('drawTimelineClipCanvasThumbnails(');
    expect(canvasSource).not.toContain("from './utils/timelineClipCanvasWorkerDrawResources'");
    expect(canvasSource).not.toContain('mergeTimelineClipCanvasWorkerPreparedResourcesByClipId(');
    expect(canvasSource).not.toContain('getTimelineClipCanvasWorkerDrawThumbnailCounts(');
    expect(canvasSource).not.toContain('closeUnpostedTimelineClipCanvasWorkerDrawResources(');
    expect(canvasSource).not.toContain('function drawThumbnails');
    expect(canvasSource).not.toContain('function mergeWorkerPreparedResourcesByClipId');
    expect(canvasSource).not.toContain('function getWorkerDrawThumbnailCounts');
    expect(canvasSource).not.toContain('function closeUnpostedWorkerDrawResources');
    expect(canvasSource).not.toContain('getThumbnailBitmap');
    expect(canvasSource).not.toContain('drawTimelineClipCanvasCover');
    expect(thumbnailPainterSource).toContain('export function drawTimelineClipCanvasThumbnails');
    expect(thumbnailPainterSource).toContain('getThumbnailBitmap');
    expect(thumbnailPainterSource).toContain('drawTimelineClipCanvasCover');
    expect(workerResourceSource).toContain('export interface PendingTimelineClipCanvasWorkerDraw');
    expect(workerResourceSource).toContain('export function mergeTimelineClipCanvasWorkerPreparedResourcesByClipId');
    expect(workerResourceSource).toContain('export function getTimelineClipCanvasWorkerDrawThumbnailCounts');
    expect(workerResourceSource).toContain('export function closeUnpostedTimelineClipCanvasWorkerDrawResources');
    expect(workerRuntimeSource).toContain('mergeTimelineClipCanvasWorkerPreparedResourcesByClipId(');
    expect(workerRuntimeSource).toContain('getTimelineClipCanvasWorkerDrawThumbnailCounts(');
    expect(workerRuntimeSource).toContain('closeUnpostedTimelineClipCanvasWorkerDrawResources(');
    expect(lineCount(thumbnailPainterSource)).toBeLessThanOrEqual(80);
    expect(lineCount(workerResourceSource)).toBeLessThanOrEqual(100);
  });

  it('keeps TimelineClipCanvas audio warmup orchestration out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const hookSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasAudioWarmups.ts');

    expect(canvasSource).toContain("from './hooks/useTimelineClipCanvasAudioWarmups'");
    expect(canvasSource).toContain('useTimelineClipCanvasAudioWarmups({');
    expect(canvasSource).not.toContain('warmTimelineWaveformArtifacts');
    expect(canvasSource).not.toContain('warmTimelineSpectrogramArtifacts');
    expect(canvasSource).not.toContain('warmTimelineAudioAnalysisArtifacts');
    expect(canvasSource).not.toContain('scheduleVisibleTimelineSourceWaveformGeneration');
    expect(canvasSource).not.toContain('scheduleTimelineProcessedWaveformDerivation');
    expect(canvasSource).not.toContain('scheduleTimelineSpectrogramTileGeneration');
    expect(canvasSource).not.toContain('WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM');
    expect(canvasSource).not.toContain('SPECTROGRAM_ARTIFACT_RETRY_MS');
    expect(hookSource).toContain('export function useTimelineClipCanvasAudioWarmups');
    expect(hookSource).toContain('warmTimelineWaveformArtifacts');
    expect(hookSource).toContain('warmTimelineSpectrogramArtifacts');
    expect(hookSource).toContain('warmTimelineAudioAnalysisArtifacts');
    expect(hookSource).toContain('scheduleVisibleTimelineSourceWaveformGeneration');
    expect(hookSource).toContain('scheduleTimelineProcessedWaveformDerivation');
    expect(hookSource).toContain('scheduleTimelineSpectrogramTileGeneration');
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(435);
    expect(lineCount(hookSource)).toBeLessThanOrEqual(300);
  });

  it('keeps TimelineClipCanvas thumbnail warmups out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const hookSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasThumbnailWarmups.ts');

    expect(canvasSource).toContain("from './hooks/useTimelineClipCanvasThumbnailWarmups'");
    expect(canvasSource).toContain('useTimelineClipCanvasThumbnailWarmups({');
    expect(canvasSource).not.toContain('thumbnailCacheService.subscribe');
    expect(canvasSource).not.toContain('scheduleVisibleTimelineThumbnailDbWarmup');
    expect(canvasSource).not.toContain('scheduleVisibleTimelineThumbnailGeneration');
    expect(canvasSource).not.toContain('ensureThumbnailBitmap');
    expect(canvasSource).not.toContain('visibleThumbnailSecondRangesRef');
    expect(canvasSource).not.toContain('thumbnailRedrawRafRef');
    expect(hookSource).toContain('export function useTimelineClipCanvasThumbnailWarmups');
    expect(hookSource).toContain('thumbnailCacheService.subscribe');
    expect(hookSource).toContain('scheduleVisibleTimelineThumbnailDbWarmup');
    expect(hookSource).toContain('scheduleVisibleTimelineThumbnailGeneration');
    expect(hookSource).toContain('ensureThumbnailBitmap');
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(435);
    expect(lineCount(hookSource)).toBeLessThanOrEqual(160);
  });

  it('keeps TimelineClipCanvas main-thread draw orchestration out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const hookSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasMainThreadDraw.ts');
    const drawSource = readRepoFile('src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts');

    expect(canvasSource).toContain("from './hooks/useTimelineClipCanvasMainThreadDraw'");
    expect(canvasSource).toContain('useTimelineClipCanvasMainThreadDraw({');
    expect(canvasSource).not.toContain('function drawClips');
    expect(canvasSource).not.toContain('requestAnimationFrame(() =>');
    expect(canvasSource).not.toContain('reportTimelineCanvasDrawDiagnostics');
    expect(canvasSource).not.toContain('unregisterTimelineCanvasDrawDiagnostics');
    expect(hookSource).toContain('export function useTimelineClipCanvasMainThreadDraw');
    expect(hookSource).toContain('requestAnimationFrame(() =>');
    expect(hookSource).toContain('reportTimelineCanvasDrawDiagnostics');
    expect(hookSource).toContain('unregisterTimelineCanvasDrawDiagnostics');
    expect(hookSource).toContain('drawTimelineClipCanvasMainThread({');
    expect(drawSource).toContain('export function drawTimelineClipCanvasMainThread');
    expect(drawSource).toContain('for (const clip of clips)');
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(435);
    expect(lineCount(hookSource)).toBeLessThanOrEqual(220);
    expect(lineCount(drawSource)).toBeLessThanOrEqual(340);
  });

  it('keeps TimelineClipCanvas worker runtime orchestration out of the canvas host', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const hookSource = readRepoFile('src/components/timeline/hooks/useTimelineClipCanvasWorkerRuntime.ts');

    expect(canvasSource).toContain("from './hooks/useTimelineClipCanvasWorkerRuntime'");
    expect(canvasSource).toContain('useTimelineClipCanvasWorkerRuntime({');
    expect(canvasSource).not.toContain('new Worker(');
    expect(canvasSource).not.toContain('transferControlToOffscreen');
    expect(canvasSource).not.toContain('postPendingWorkerDraw');
    expect(canvasSource).not.toContain('pendingWorkerDrawRef');
    expect(canvasSource).not.toContain('workerReadyRef');
    expect(canvasSource).not.toContain('buildTimelineClipCanvasWorkerDrawMessage');
    expect(canvasSource).not.toContain('createTimelineClipCanvasWorkerThumbnailResourcesByClipId');
    expect(canvasSource).not.toContain('mergeTimelineClipCanvasWorkerPreparedResourcesByClipId');
    expect(canvasSource).not.toContain('closeUnpostedTimelineClipCanvasWorkerDrawResources');
    expect(hookSource).toContain('export function useTimelineClipCanvasWorkerRuntime');
    expect(hookSource).toContain('new Worker(');
    expect(hookSource).toContain('transferControlToOffscreen');
    expect(hookSource).toContain('postPendingWorkerDraw');
    expect(hookSource).toContain('buildTimelineClipCanvasWorkerDrawMessage');
    expect(hookSource).toContain('closeUnpostedTimelineClipCanvasWorkerDrawResources');
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(435);
    expect(lineCount(hookSource)).toBeLessThanOrEqual(360);
  });

  it('keeps TimelineClipCanvas worker audio resources responsive to warmup redraws', () => {
    const canvasSource = readRepoFile('src/components/timeline/TimelineClipCanvas.tsx');
    const preparedResourceBlock = canvasSource.match(
      /const workerPreparedResourcesByClipId = useMemo\([\s\S]*?const workerDrawableClips = useMemo/,
    )?.[0] ?? '';

    expect(preparedResourceBlock).toContain('createTimelineClipCanvasWorkerPreparedResourcesByClipId');
    expect(preparedResourceBlock).toContain('redrawNonce');
    expect(preparedResourceBlock.indexOf('redrawNonce')).toBeGreaterThan(
      preparedResourceBlock.indexOf('mediaFileStatusById'),
    );
  });

  it('keeps the timeline schema contract runtime-free', () => {
    const schemaFiles = sourceFilesUnder(path.join(srcTimelineRoot, 'contracts', 'schema'));
    expect(schemaFiles.length).toBeGreaterThan(0);

    const bannedRuntimeTokens = [
      /\bFile\b/,
      /\bBlob\b/,
      /\bHTML(?:Video|Audio|Image|Canvas)Element\b/,
      /\bVideoFrame\b/,
      /\bAudioBuffer\b/,
      /\bImageBitmap\b/,
      /\bGPU(?:Texture|Buffer|Device)\b/,
      /\bMediaStream\b/,
      /\bOffscreenCanvas\b/,
      /\bURL\b/,
      /\bobjectURL\b/i,
      /\bblobUrl\b/i,
      /\bruntime(?:SourceId|SessionKey|Handle|Id)\b/,
      /=>/,
    ];

    for (const filePath of schemaFiles) {
      const source = readFileSync(filePath, 'utf8');
      for (const token of bannedRuntimeTokens) {
        expect(token.test(source), `${toRepoPath(filePath)} contains runtime token ${token}`).toBe(false);
      }
    }
  });

  it('keeps kernel resource demand contracts runtime-handle-free', () => {
    const resourceFiles = sourceFilesUnder(path.join(srcTimelineRoot, 'resources'));
    expect(resourceFiles.length).toBeGreaterThan(0);

    const bannedRuntimeTokens = [
      /\bFile\b/,
      /\bBlob\b/,
      /\bHTML(?:Video|Audio|Image|Canvas)Element\b/,
      /\bVideoFrame\b/,
      /\bAudioBuffer\b/,
      /\bImageBitmap\b/,
      /\bGPU(?:Texture|Buffer|Device)\b/,
      /\bMediaStream\b/,
      /\bOffscreenCanvas\b/,
      /\bObjectURL\b/i,
      /\bblobUrl\b/i,
    ];

    for (const filePath of resourceFiles) {
      const source = readFileSync(filePath, 'utf8');
      for (const token of bannedRuntimeTokens) {
        expect(token.test(source), `${toRepoPath(filePath)} contains runtime handle token ${token}`).toBe(false);
      }
    }
  });

  it('keeps VideoSyncManager source media reads behind the video sync resolver', () => {
    const managerSource = readRepoFile('src/services/layerBuilder/VideoSyncManager.ts');
    const resolverSource = readRepoFile('src/services/layerBuilder/videoSyncMediaResolver.ts');
    const forceDecodeSource = readRepoFile('src/services/layerBuilder/videoSyncForceDecodeManager.ts');
    const handoffSource = readRepoFile('src/services/layerBuilder/videoSyncHandoffs.ts');
    const htmlSeekStateSource = readRepoFile('src/services/layerBuilder/videoSyncHtmlSeekState.ts');
    const nativeDecoderSyncSource = readRepoFile('src/services/layerBuilder/videoSyncNativeDecoderSync.ts');
    const timelineQuerySource = readRepoFile('src/services/layerBuilder/videoSyncTimelineQueries.ts');
    const warmupStateSource = readRepoFile('src/services/layerBuilder/videoSyncWarmupState.ts');
    const fullWebCodecsCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncFullWebCodecsCoordinator.ts');
    const htmlClipCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncHtmlClipCoordinator.ts');
    const htmlSeekCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncHtmlSeekCoordinator.ts');
    const nestedCompositionCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncNestedCompositionCoordinator.ts');
    const recoveryCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncRecoveryCoordinator.ts');
    const warmupCoordinatorSource = readRepoFile('src/services/layerBuilder/videoSyncWarmupCoordinator.ts');
    const webCodecsPolicySource = readRepoFile('src/services/layerBuilder/videoSyncWebCodecsPolicy.ts');
    const webCodecsSeekStateSource = readRepoFile('src/services/layerBuilder/videoSyncWebCodecsSeekState.ts');

    expect(managerSource).toContain('resolveVideoSyncMedia');
    expect(managerSource).toContain("from './videoSyncForceDecodeManager'");
    expect(managerSource).toContain("from './videoSyncHandoffs'");
    expect(managerSource).toContain("from './videoSyncHtmlSeekState'");
    expect(managerSource).toContain("from './videoSyncNativeDecoderSync'");
    expect(managerSource).toContain("from './videoSyncTimelineQueries'");
    expect(managerSource).toContain("from './videoSyncWarmupState'");
    expect(managerSource).toContain("from './videoSyncFullWebCodecsCoordinator'");
    expect(managerSource).toContain("from './videoSyncHtmlClipCoordinator'");
    expect(managerSource).toContain("from './videoSyncHtmlSeekCoordinator'");
    expect(managerSource).toContain("from './videoSyncNestedCompositionCoordinator'");
    expect(managerSource).toContain("from './videoSyncRecoveryCoordinator'");
    expect(managerSource).toContain("from './videoSyncWarmupCoordinator'");
    expect(managerSource).toContain("from './videoSyncWebCodecsSeekState'");
    expect(managerSource).not.toContain('webCodecsPlayer');
    expect(managerSource).toContain('hydrateTimelineMediaWindow');
    expect(resolverSource).toContain('peekRuntimeFrameProvider');
    expect(resolverSource).toContain('getNativeDecoderForTimelineClip');
    expect(resolverSource).toContain('getLazyTimelineVideoElementForClip');
    expect(resolverSource).toContain('hasRuntimeNativeDecoder');
    expect(resolverSource).not.toContain('source?.videoElement');
    expect(resolverSource).not.toContain('source.videoElement');
    expect(resolverSource).not.toContain('source!.videoElement');
    expect(managerSource).not.toContain('clip.source?.nativeDecoder');
    expect(managerSource).not.toContain('clip.source!.nativeDecoder');
    expect(managerSource).not.toContain('.source?.videoElement');
    expect(managerSource).not.toContain('.source.videoElement');
    expect(managerSource).not.toContain('.source!.videoElement');
    expect(managerSource).not.toContain('private lastTrackState');
    expect(managerSource).not.toContain('private activeHandoffs');
    expect(managerSource).not.toContain('private handoffElements');
    expect(managerSource).not.toContain('private previewContinuationElements');
    expect(managerSource).not.toContain('private isVisibleVideoTrackClip');
    expect(managerSource).not.toContain('private getVisibleVideoTrackClipsAtTime');
    expect(managerSource).not.toContain('private getClipStartTime');
    expect(managerSource).not.toContain('private getWarmupClipTime');
    expect(managerSource).not.toContain('private getClipSampleTimeNearPlayhead');
    expect(managerSource).not.toContain('private getActiveClipsAtTime');
    expect(managerSource).not.toContain('private warmingUpVideos');
    expect(managerSource).not.toContain('private warmupRetryCooldown');
    expect(managerSource).not.toContain('private warmupAttemptIds');
    expect(managerSource).not.toContain('private warmupWatchdogs');
    expect(managerSource).not.toContain('private warmupClipIds');
    expect(managerSource).not.toContain('private warmupTargetTimes');
    expect(managerSource).not.toContain('private upcomingPreplayVideos');
    expect(managerSource).not.toContain('private gpuWarmedUp');
    expect(managerSource).not.toContain('private lastSeekRef');
    expect(managerSource).not.toContain('private rvfcHandles');
    expect(managerSource).not.toContain('private preciseSeekTimers');
    expect(managerSource).not.toContain('private latestSeekTargets');
    expect(managerSource).not.toContain('private pendingSeekTargets');
    expect(managerSource).not.toContain('private pendingSeekStartedAt');
    expect(managerSource).not.toContain('private queuedSeekTargets');
    expect(managerSource).not.toContain('private seekedFlushArmed');
    expect(managerSource).not.toContain('private wcPreciseSeekTimers');
    expect(managerSource).not.toContain('private latestWcPreciseSeekTargets');
    expect(managerSource).not.toContain('private lastWcFastSeekTarget');
    expect(managerSource).not.toContain('private lastWcFastSeekAt');
    expect(managerSource).not.toContain('private lastWcPreciseSeekAt');
    expect(managerSource).not.toContain('private nativeDecoderState');
    expect(managerSource).not.toContain('private syncNativeDecoder');
    expect(managerSource).not.toContain('private forceDecodeInProgress');
    expect(managerSource).not.toContain('private forceVideoFrameDecode');
    expect(managerSource).not.toContain('private forceDecodeColdScrubFrame');
    expect(managerSource).not.toContain('private lastDisplayedDriftRecoveryAt');
    expect(managerSource).not.toContain('private lastPendingSeekRecoveryAt');
    expect(managerSource).not.toContain('private maybeRecoverScrubSettle');
    expect(managerSource).not.toContain('private maybeRecoverDraggingPendingSeek');
    expect(managerSource).not.toContain('private maybeRecoverDraggingDisplayedDrift');
    expect(managerSource).not.toContain('const freshFrameTolerance');
    expect(managerSource).not.toContain('const providerDistance');
    expect(managerSource).not.toContain('const staleBusySeek');
    expect(forceDecodeSource).toContain('class VideoSyncForceDecodeManager');
    expect(forceDecodeSource).toContain('private inProgress');
    expect(forceDecodeSource).toContain('forceVideoFrameDecode');
    expect(forceDecodeSource).toContain('preCacheVideoFrame');
    expect(handoffSource).toContain('class VideoSyncHandoffManager');
    expect(handoffSource).toContain('setHandoff');
    expect(handoffSource).toContain('getPreviewContinuationVideoElement');
    expect(htmlSeekStateSource).toContain('class VideoSyncHtmlSeekState');
    expect(htmlSeekStateSource).toContain('setPendingTarget');
    expect(htmlSeekStateSource).toContain('replacePreciseSeekTimer');
    expect(htmlSeekStateSource).toContain('setRvfcHandle');
    expect(nativeDecoderSyncSource).toContain('class VideoSyncNativeDecoderSync');
    expect(nativeDecoderSyncSource).toContain('private decoderState');
    expect(nativeDecoderSyncSource).toContain('seekToFrame');
    expect(timelineQuerySource).toContain('isVisibleVideoTrackClip');
    expect(timelineQuerySource).toContain('getVisibleVideoTrackClipsAtTime');
    expect(timelineQuerySource).toContain('getClipStartTime');
    expect(timelineQuerySource).toContain('getWarmupClipTime');
    expect(timelineQuerySource).toContain('getClipSampleTimeNearPlayhead');
    expect(timelineQuerySource).toContain('getActiveClipsAtTime');
    expect(warmupStateSource).toContain('class VideoSyncWarmupState');
    expect(warmupStateSource).toContain('beginAttempt');
    expect(warmupStateSource).toContain('listUpcomingPreplays');
    expect(fullWebCodecsCoordinatorSource).toContain('class VideoSyncFullWebCodecsCoordinator');
    expect(fullWebCodecsCoordinatorSource).toContain('syncFullWebCodecs');
    expect(fullWebCodecsCoordinatorSource).toContain('syncPausedWebCodecsProvider');
    expect(fullWebCodecsCoordinatorSource).toContain("from './videoSyncWebCodecsPolicy'");
    expect(htmlClipCoordinatorSource).toContain('class VideoSyncHtmlClipCoordinator');
    expect(htmlClipCoordinatorSource).toContain('syncHtmlClipVideo');
    expect(htmlClipCoordinatorSource).toContain('syncReverseOrNonstandardPlayback');
    expect(htmlSeekCoordinatorSource).toContain('class VideoSyncHtmlSeekCoordinator');
    expect(htmlSeekCoordinatorSource).toContain('beginOrQueueSettleSeek');
    expect(htmlSeekCoordinatorSource).toContain('throttledSeek');
    expect(htmlSeekCoordinatorSource).toContain('flushQueuedSeekTarget');
    expect(nestedCompositionCoordinatorSource).toContain('class VideoSyncNestedCompositionCoordinator');
    expect(nestedCompositionCoordinatorSource).toContain('syncNestedCompVideos');
    expect(nestedCompositionCoordinatorSource).toContain('syncNestedFullWebCodecs');
    expect(recoveryCoordinatorSource).toContain('class VideoSyncRecoveryCoordinator');
    expect(recoveryCoordinatorSource).toContain('maybeRecoverScrubSettle');
    expect(recoveryCoordinatorSource).toContain('maybeRecoverDraggingPendingSeek');
    expect(recoveryCoordinatorSource).toContain('maybeRecoverDraggingDisplayedDrift');
    expect(warmupCoordinatorSource).toContain('class VideoSyncWarmupCoordinator');
    expect(warmupCoordinatorSource).toContain('preloadPausedJumpNeighborhood');
    expect(warmupCoordinatorSource).toContain('startTargetedWarmup');
    expect(warmupCoordinatorSource).toContain('preBufferUpcomingNestedCompVideos');
    expect(webCodecsPolicySource).toContain('selectPausedWebCodecsProvider');
    expect(webCodecsPolicySource).toContain('shouldSeekPausedWebCodecsProviderPolicy');
    expect(webCodecsPolicySource).toContain('shouldHoldScrubReleaseIntoPlaybackPolicy');
    expect(webCodecsSeekStateSource).toContain('class VideoSyncWebCodecsSeekState');
    expect(webCodecsSeekStateSource).toContain('setFastSeek');
    expect(webCodecsSeekStateSource).toContain('replacePreciseSeekTimer');
    expect(webCodecsSeekStateSource).toContain('setLastPreciseSeekAt');
    expect(lineCount(managerSource)).toBeLessThanOrEqual(700);
    expect(lineCount(forceDecodeSource)).toBeLessThanOrEqual(80);
    expect(lineCount(handoffSource)).toBeLessThanOrEqual(300);
    expect(lineCount(htmlSeekStateSource)).toBeLessThanOrEqual(160);
    expect(lineCount(nativeDecoderSyncSource)).toBeLessThanOrEqual(80);
    expect(lineCount(timelineQuerySource)).toBeLessThanOrEqual(90);
    expect(lineCount(warmupStateSource)).toBeLessThanOrEqual(150);
    expect(lineCount(fullWebCodecsCoordinatorSource)).toBeLessThanOrEqual(520);
    expect(lineCount(htmlClipCoordinatorSource)).toBeLessThanOrEqual(470);
    expect(lineCount(htmlSeekCoordinatorSource)).toBeLessThanOrEqual(520);
    expect(lineCount(nestedCompositionCoordinatorSource)).toBeLessThanOrEqual(320);
    expect(lineCount(recoveryCoordinatorSource)).toBeLessThanOrEqual(220);
    expect(lineCount(warmupCoordinatorSource)).toBeLessThanOrEqual(650);
    expect(lineCount(webCodecsPolicySource)).toBeLessThanOrEqual(300);
    expect(lineCount(webCodecsSeekStateSource)).toBeLessThanOrEqual(100);
  });

  it('keeps LayerBuilderService video visual source resolution in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const videoSource = readRepoFile('src/services/layerBuilder/layerBuilderVideoSources.ts');
    const webCodecsPolicySource = readRepoFile('src/services/layerBuilder/videoSyncWebCodecsPolicy.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderVideoSources'");
    expect(layerBuilderSource).not.toContain('resolveLayerBuilderVideoSource');
    expect(layerBuilderSource).toContain('pauseLayerBuilderVideoSource');
    expect(layerBuilderSource).toContain('getLayerBuilderVideoSourceDebugInfo');
    expect(layerBuilderSource).not.toContain('source?.videoElement');
    expect(layerBuilderSource).not.toContain('source.videoElement');
    expect(layerBuilderSource).not.toContain('source!.videoElement');
    expect(layerBuilderSource).not.toContain('source?.webCodecsPlayer');
    expect(layerBuilderSource).not.toContain('source.webCodecsPlayer');
    expect(layerBuilderSource).not.toContain('source!.webCodecsPlayer');
    expect(videoSource).toContain("from './videoSyncWebCodecsPolicy'");
    expect(videoSource).toContain('selectPausedWebCodecsProvider');
    expect(videoSource).toContain('getLazyTimelineVideoElementForClip');
    expect(videoSource).toContain('resolveLayerBuilderVideoSource');
    expect(videoSource).toContain('pauseLayerBuilderVideoSource');
    expect(layerBuilderSource).not.toContain('const freshFrameTolerance');
    expect(layerBuilderSource).not.toContain('const providerDistance');
    expect(layerBuilderSource).not.toContain('const runtimeDistance = providerDistance');
    expect(layerBuilderSource).not.toContain('const clipDistance = providerDistance');
    expect(webCodecsPolicySource).toContain('const providerDistance');
    expect(webCodecsPolicySource).toContain('FRESH_RUNTIME_FRAME_TOLERANCE');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(videoSource)).toBeLessThanOrEqual(160);
    expect(lineCount(webCodecsPolicySource)).toBeLessThanOrEqual(300);
  });

  it('keeps LayerBuilderService video layer construction in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const videoLayerSource = readRepoFile('src/services/layerBuilder/layerBuilderVideoLayers.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderVideoLayers'");
    expect(layerBuilderSource).toContain('buildLayerBuilderNativeDecoderLayer');
    expect(layerBuilderSource).toContain('buildLayerBuilderVideoLayer');
    expect(layerBuilderSource).not.toContain('private buildNativeDecoderLayer');
    expect(layerBuilderSource).not.toContain('private buildVideoLayer');
    expect(layerBuilderSource).not.toContain('getLayerSourceMetadata');
    expect(layerBuilderSource).not.toContain('getPositiveDimension');
    expect(layerBuilderSource).not.toContain('canUseSharedPreviewRuntimeSession');
    expect(layerBuilderSource).not.toContain('buildLayerBuilderProxyImageLayer');
    expect(videoLayerSource).toContain('buildLayerBuilderNativeDecoderLayer');
    expect(videoLayerSource).toContain('buildLayerBuilderVideoLayer');
    expect(videoLayerSource).toContain('getLayerSourceMetadata');
    expect(videoLayerSource).toContain('canUseSharedPreviewRuntimeSession');
    expect(videoLayerSource).toContain('buildLayerBuilderProxyImageLayer');
    expect(videoLayerSource).toContain('resolveLayerBuilderVideoSource');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(700);
    expect(lineCount(videoLayerSource)).toBeLessThanOrEqual(190);
  });

  it('keeps LayerBuilderService 3D source resolution in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const threeDSource = readRepoFile('src/services/layerBuilder/layerBuilder3dSources.ts');
    const threeDLayerSource = readRepoFile('src/services/layerBuilder/layerBuilder3dLayers.ts');
    const nestedBuilderSource = readRepoFile('src/services/layerBuilder/layerBuilderNestedLayerBuilder.ts');

    expect(layerBuilderSource).toContain("from './layerBuilder3dSources'");
    expect(layerBuilderSource).toContain("from './layerBuilder3dLayers'");
    expect(layerBuilderSource).toContain('buildLayerBuilderModelLayer');
    expect(layerBuilderSource).toContain('buildLayerBuilderGaussianSplatLayer');
    expect(layerBuilderSource).not.toContain('buildNestedLayerBuilder3dSourceLayer');
    expect(layerBuilderSource).not.toContain('resolveModelSequenceData');
    expect(layerBuilderSource).not.toContain('getModelSequenceFrameUrl');
    expect(layerBuilderSource).not.toContain('getReusableModelUrl');
    expect(layerBuilderSource).not.toContain('getGaussianSplatSequenceFrameRuntimeKey');
    expect(layerBuilderSource).not.toContain('resolveSharedSplatUseNativeRenderer');
    expect(layerBuilderSource).not.toContain('prewarmGaussianSplatRuntime');
    expect(layerBuilderSource).not.toContain('DEFAULT_TEXT_3D_PROPERTIES');
    expect(layerBuilderSource).not.toContain('resolveSceneEffectorsEnabled');
    expect(layerBuilderSource).not.toContain('private getClipModelSequence');
    expect(layerBuilderSource).not.toContain('private buildGaussianSplatSourcePayload');
    expect(layerBuilderSource).not.toContain('private buildModelLayer');
    expect(layerBuilderSource).not.toContain('private buildGaussianSplatLayer');
    expect(layerBuilderSource).not.toContain('private buildGaussianAvatarLayer');
    expect(threeDSource).toContain('getClipModelSequence');
    expect(threeDSource).toContain('buildGaussianSplatSourcePayload');
    expect(threeDSource).toContain('prewarmGaussianSplatClips');
    expect(threeDLayerSource).toContain('buildLayerBuilderModelLayer');
    expect(threeDLayerSource).toContain('buildLayerBuilderGaussianSplatLayer');
    expect(threeDLayerSource).toContain('buildNestedLayerBuilder3dSourceLayer');
    expect(threeDLayerSource).toContain('DEFAULT_TEXT_3D_PROPERTIES');
    expect(threeDLayerSource).toContain('resolveSceneEffectorsEnabled');
    expect(threeDLayerSource).toContain('buildGaussianSplatSourcePayload');
    expect(nestedBuilderSource).toContain('buildNestedLayerBuilder3dSourceLayer');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(threeDSource)).toBeLessThanOrEqual(180);
    expect(lineCount(threeDLayerSource)).toBeLessThanOrEqual(190);
    expect(lineCount(nestedBuilderSource)).toBeLessThanOrEqual(240);
  });

  it('keeps LayerBuilderService proxy frame ownership in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const proxyFrameSource = readRepoFile('src/services/layerBuilder/layerBuilderProxyFrames.ts');
    const videoLayerSource = readRepoFile('src/services/layerBuilder/layerBuilderVideoLayers.ts');
    const nestedBuilderSource = readRepoFile('src/services/layerBuilder/layerBuilderNestedLayerBuilder.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderProxyFrames'");
    expect(layerBuilderSource).toContain('new LayerBuilderProxyFrames');
    expect(layerBuilderSource).toContain('prewarmUpcomingNestedCompFrames');
    expect(layerBuilderSource).not.toContain('selectProxyFrame');
    expect(layerBuilderSource).not.toContain("from '../proxyFrameCache'");
    expect(layerBuilderSource).not.toContain('getExpectedProxyFrameCount');
    expect(layerBuilderSource).not.toContain('proxyFramesRef');
    expect(layerBuilderSource).not.toContain('proxyLoadingFrames');
    expect(layerBuilderSource).not.toContain('private canUseProxyFrame');
    expect(layerBuilderSource).not.toContain('private ensureProxyImageFrameLoaded');
    expect(layerBuilderSource).not.toContain('getNearestCachedFrameEntry');
    expect(proxyFrameSource).toContain('class LayerBuilderProxyFrames');
    expect(proxyFrameSource).toContain('selectProxyFrame');
    expect(proxyFrameSource).toContain('canUseHeldLayerBuilderProxyFrame');
    expect(proxyFrameSource).toContain('prewarmUpcomingNestedCompFrames');
    expect(proxyFrameSource).toContain("from '../proxyFrameCache'");
    expect(proxyFrameSource).toContain('getExpectedProxyFrameCount');
    expect(proxyFrameSource).toContain('getNearestCachedFrameEntry');
    expect(videoLayerSource).toContain('selectProxyFrame');
    expect(nestedBuilderSource).toContain('selectProxyFrame');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(proxyFrameSource)).toBeLessThanOrEqual(270);
    expect(lineCount(videoLayerSource)).toBeLessThanOrEqual(190);
    expect(lineCount(nestedBuilderSource)).toBeLessThanOrEqual(240);
  });

  it('keeps LayerBuilderService 2D image and text source layers in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const twoDSource = readRepoFile('src/services/layerBuilder/layerBuilder2dSources.ts');

    expect(layerBuilderSource).toContain("from './layerBuilder2dSources'");
    expect(layerBuilderSource).toContain('buildLayerBuilderImageLayer');
    expect(layerBuilderSource).not.toContain('buildLayerBuilderProxyImageLayer');
    expect(layerBuilderSource).not.toContain('buildLayerBuilderTextLayer');
    expect(layerBuilderSource).not.toContain("from '../textRenderer'");
    expect(layerBuilderSource).not.toContain('getLazyImageElementForClip');
    expect(layerBuilderSource).not.toContain('private getRenderableImageElement');
    expect(layerBuilderSource).not.toContain('private buildImageLayer');
    expect(layerBuilderSource).not.toContain('private buildImageLayerFromProxy');
    expect(layerBuilderSource).not.toContain('private buildTextLayer');
    expect(twoDSource).toContain('getLayerBuilderRenderableImageElement');
    expect(twoDSource).toContain('buildLayerBuilderImageLayer');
    expect(twoDSource).toContain('buildLayerBuilderProxyImageLayer');
    expect(twoDSource).toContain('buildLayerBuilderTextLayer');
    expect(twoDSource).toContain('buildNestedProxyImageSourceLayer');
    expect(twoDSource).toContain("from '../timeline/lazyImageElements'");
    expect(twoDSource).toContain("from '../textRenderer'");
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(1400);
    expect(lineCount(twoDSource)).toBeLessThanOrEqual(180);
  });

  it('keeps LayerBuilderService canvas-backed source rendering in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const canvasSource = readRepoFile('src/services/layerBuilder/layerBuilderCanvasSources.ts');
    const nestedBuilderSource = readRepoFile('src/services/layerBuilder/layerBuilderNestedLayerBuilder.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderCanvasSources'");
    expect(layerBuilderSource).toContain('syncLayerBuilderCanvasRuntimeSources');
    expect(layerBuilderSource).toContain('buildLayerBuilderCanvasBackedLayer');
    expect(layerBuilderSource).not.toContain('buildNestedLayerBuilderCanvasBackedSourceLayer');
    expect(layerBuilderSource).not.toContain('vectorAnimationRuntimeManager');
    expect(layerBuilderSource).not.toContain('mathSceneRenderer');
    expect(layerBuilderSource).not.toContain('isVectorAnimationSourceType');
    expect(layerBuilderSource).not.toContain('source?.textCanvas');
    expect(layerBuilderSource).not.toContain('source.textCanvas');
    expect(canvasSource).toContain('vectorAnimationRuntimeManager');
    expect(canvasSource).toContain('mathSceneRenderer');
    expect(canvasSource).toContain('isVectorAnimationSourceType');
    expect(canvasSource).toContain('buildLayerBuilderTextLayer');
    expect(canvasSource).toContain('buildNestedTextSourceLayer');
    expect(canvasSource).toContain('collectKnownClipIds');
    expect(nestedBuilderSource).toContain('buildNestedLayerBuilderCanvasBackedSourceLayer');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(canvasSource)).toBeLessThanOrEqual(130);
    expect(lineCount(nestedBuilderSource)).toBeLessThanOrEqual(240);
  });

  it('keeps LayerBuilderService AI-node and mask post-processing in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const postProcessingSource = readRepoFile('src/services/layerBuilder/layerBuilderLayerPostProcessing.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderLayerPostProcessing'");
    expect(layerBuilderSource).toContain('applyLayerBuilderAINodesToLayer');
    expect(layerBuilderSource).toContain('withLayerBuilderMaskProperties');
    expect(layerBuilderSource).not.toContain('addLayerBuilderMaskProperties');
    expect(layerBuilderSource).not.toContain("from '../nodeGraph'");
    expect(layerBuilderSource).not.toContain('renderClipAINodesToCanvas');
    expect(layerBuilderSource).not.toContain('private applyAINodesToLayer');
    expect(layerBuilderSource).not.toContain('private findLinkedClip');
    expect(layerBuilderSource).not.toContain('private addMaskProperties');
    expect(layerBuilderSource).not.toContain('private withMaskProperties');
    expect(postProcessingSource).toContain('renderClipAINodesToCanvas');
    expect(postProcessingSource).toContain('findLinkedClip');
    expect(postProcessingSource).toContain('addLayerBuilderMaskProperties');
    expect(postProcessingSource).toContain('withLayerBuilderMaskProperties');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(postProcessingSource)).toBeLessThanOrEqual(90);
  });

  it('keeps LayerBuilderService motion layer construction in a focused helper', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const motionLayerSource = readRepoFile('src/services/layerBuilder/layerBuilderMotionLayers.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderMotionLayers'");
    expect(layerBuilderSource).toContain('buildLayerBuilderMotionShapeLayer');
    expect(layerBuilderSource).not.toContain('getInterpolatedMotionLayer');
    expect(layerBuilderSource).not.toContain('private buildMotionShapeLayer');
    expect(layerBuilderSource).not.toContain('clipKeyframes.get(clip.id)');
    expect(motionLayerSource).toContain('getInterpolatedMotionLayer');
    expect(motionLayerSource).toContain('clipKeyframes.get(clip.id)');
    expect(motionLayerSource).toContain('addLayerBuilderMaskProperties');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(850);
    expect(lineCount(motionLayerSource)).toBeLessThanOrEqual(70);
  });

  it('keeps LayerBuilderService nested layer assembly in focused helpers', () => {
    const layerBuilderSource = readRepoFile('src/services/layerBuilder/LayerBuilderService.ts');
    const nestedBaseSource = readRepoFile('src/services/layerBuilder/layerBuilderNestedLayers.ts');
    const nestedBuilderSource = readRepoFile('src/services/layerBuilder/layerBuilderNestedLayerBuilder.ts');

    expect(layerBuilderSource).toContain("from './layerBuilderNestedLayerBuilder'");
    expect(layerBuilderSource).toContain('buildLayerBuilderNestedCompLayer');
    expect(layerBuilderSource).not.toContain("from './layerBuilderNestedLayers'");
    expect(layerBuilderSource).not.toContain('buildNestedLayerBase');
    expect(layerBuilderSource).not.toContain('buildNestedCompositionSourceLayer');
    expect(layerBuilderSource).not.toContain('getNestedClipSourceTime');
    expect(layerBuilderSource).not.toContain('getInterpolatedClipTransform');
    expect(layerBuilderSource).not.toContain('getEffectiveScale');
    expect(layerBuilderSource).not.toContain('compileRuntimeColorGrade');
    expect(layerBuilderSource).not.toContain('ClipTransform');
    expect(layerBuilderSource).not.toContain('clipKeyframes.get(nestedClip.id)');
    expect(layerBuilderSource).not.toContain('private buildNestedCompLayer');
    expect(layerBuilderSource).not.toContain('private buildNestedLayers');
    expect(layerBuilderSource).not.toContain('private buildNestedClipLayer');
    expect(layerBuilderSource).not.toContain('private getNestedClipSourceTime');
    expect(layerBuilderSource).not.toContain('MAX_NESTING_DEPTH');
    expect(layerBuilderSource).not.toContain('NestedCompositionData');
    expect(layerBuilderSource).not.toContain('buildNestedProxyImageSourceLayer');
    expect(layerBuilderSource).not.toContain('buildNestedLayerBuilderCanvasBackedSourceLayer');
    expect(layerBuilderSource).not.toContain('buildNestedLayerBuilder3dSourceLayer');
    expect(layerBuilderSource).not.toContain('const compositions = useMediaStore.getState().compositions');
    expect(nestedBuilderSource).toContain('buildLayerBuilderNestedCompLayer');
    expect(nestedBuilderSource).toContain('buildLayerBuilderNestedLayers');
    expect(nestedBuilderSource).toContain('buildNestedClipLayer');
    expect(nestedBuilderSource).toContain('MAX_NESTING_DEPTH');
    expect(nestedBuilderSource).toContain('buildNestedLayerBase');
    expect(nestedBuilderSource).toContain('buildNestedCompositionSourceLayer');
    expect(nestedBuilderSource).toContain('getNestedClipSourceTime');
    expect(nestedBuilderSource).toContain('buildNestedProxyImageSourceLayer');
    expect(nestedBuilderSource).toContain('buildNestedLayerBuilderCanvasBackedSourceLayer');
    expect(nestedBuilderSource).toContain('buildNestedLayerBuilder3dSourceLayer');
    expect(nestedBuilderSource).toContain('resolveLayerBuilderVideoSource');
    expect(nestedBaseSource).toContain('buildNestedLayerBase');
    expect(nestedBaseSource).toContain('getInterpolatedClipTransform');
    expect(nestedBaseSource).toContain('getEffectiveScale');
    expect(nestedBaseSource).toContain('compileRuntimeColorGrade');
    expect(nestedBaseSource).toContain('useTimelineStore.getState().clipKeyframes');
    expect(nestedBaseSource).toContain('buildNestedCompositionSourceLayer');
    expect(nestedBaseSource).toContain('buildNestedMotionSourceLayer');
    expect(lineCount(layerBuilderSource)).toBeLessThanOrEqual(540);
    expect(lineCount(nestedBuilderSource)).toBeLessThanOrEqual(240);
    expect(lineCount(nestedBaseSource)).toBeLessThanOrEqual(190);
  });

  it('keeps AudioTrackSyncManager source media reads behind the audio sync resolver', () => {
    const managerSource = readRepoFile('src/services/layerBuilder/AudioTrackSyncManager.ts');
    const resolverSource = readRepoFile('src/services/layerBuilder/audioSyncMediaResolver.ts');
    const handoffSource = readRepoFile('src/services/layerBuilder/audioTrackHandoffs.ts');
    const stemSyncModelSource = readRepoFile('src/services/layerBuilder/audioTrackStemSyncModel.ts');
    const elementUtilsSource = readRepoFile('src/services/layerBuilder/audioTrackElementUtils.ts');
    const runtimeResourcesSource = readRepoFile('src/services/layerBuilder/audioTrackRuntimeResources.ts');
    const runtimeElementsSource = readRepoFile('src/services/layerBuilder/audioTrackRuntimeElements.ts');
    const stemLayerBuffersSource = readRepoFile('src/services/layerBuilder/audioTrackStemLayerBuffers.ts');
    const stemPreviewElementsSource = readRepoFile('src/services/layerBuilder/audioTrackStemPreviewElements.ts');
    const stemBufferMixersSource = readRepoFile('src/services/layerBuilder/audioTrackStemBufferMixers.ts');
    const stemBufferMixerSessionsSource = readRepoFile('src/services/layerBuilder/audioTrackStemBufferMixerSessions.ts');
    const prebufferingSource = readRepoFile('src/services/layerBuilder/audioTrackPrebuffering.ts');
    const compositionPlaybackMixdownsSource = readRepoFile('src/services/layerBuilder/audioTrackCompositionPlaybackMixdowns.ts');

    expect(managerSource).toContain('resolveAudioSyncMedia');
    expect(managerSource).toContain("from './audioTrackCompositionPlaybackMixdowns'");
    expect(managerSource).toContain("from './audioTrackHandoffs'");
    expect(managerSource).toContain("from './audioTrackRuntimeElements'");
    expect(managerSource).toContain("from './audioTrackStemBufferMixers'");
    expect(managerSource).toContain("from './audioTrackStemLayerBuffers'");
    expect(managerSource).toContain("from './audioTrackStemPreviewElements'");
    expect(managerSource).toContain("from './audioTrackPrebuffering'");
    expect(managerSource).toContain("from './audioTrackStemSyncModel'");
    expect(managerSource).toContain("from './audioTrackElementUtils'");
    expect(resolverSource).toContain('getLazyTimelineAudioElementForClip');
    expect(resolverSource).toContain('getLazyTimelineVideoElementForClip');
    expect(resolverSource).not.toContain('source?.audioElement');
    expect(resolverSource).not.toContain('source.audioElement');
    expect(resolverSource).not.toContain('source!.audioElement');
    expect(resolverSource).not.toContain('source?.videoElement');
    expect(resolverSource).not.toContain('source.videoElement');
    expect(resolverSource).not.toContain('source!.videoElement');
    expect(managerSource).not.toContain('.source?.audioElement');
    expect(managerSource).not.toContain('.source.audioElement');
    expect(managerSource).not.toContain('.source!.audioElement');
    expect(managerSource).not.toContain('.source?.videoElement');
    expect(managerSource).not.toContain('.source.videoElement');
    expect(managerSource).not.toContain('.source!.videoElement');
    expect(managerSource).not.toContain('interface StemBufferMixerSession');
    expect(managerSource).not.toContain('function createStemLayerSetKey');
    expect(managerSource).not.toContain('function audioBufferToWavBlob');
    expect(managerSource).not.toContain('const STEM_MIXER_START_DELAY_SECONDS');
    expect(managerSource).not.toContain('STEM_MIXER_RESTART_DRIFT_SECONDS');
    expect(managerSource).not.toContain('STEM_MIXER_METER_INTERVAL_MS');
    expect(managerSource).not.toContain('calculateAudioMeterSnapshot');
    expect(managerSource).not.toContain('vfPipelineMonitor');
    expect(managerSource).not.toContain('setMasterAudioClock');
    expect(managerSource).not.toContain('createRenderResourceDescriptorFromDemand');
    expect(managerSource).not.toContain('RuntimeProviderDemand');
    expect(managerSource).not.toContain('private lastAudioTrackState');
    expect(managerSource).not.toContain('private audioHandoffElements');
    expect(managerSource).not.toContain('private computeAudioHandoffs');
    expect(managerSource).not.toContain('private updateLastAudioTrackState');
    expect(managerSource).not.toContain('private activeAudioProxies');
    expect(managerSource).not.toContain('private activeAudioTrackProxies');
    expect(managerSource).not.toContain('private retainedAudioElementResourceIds');
    expect(managerSource).not.toContain('private getAudioProxyInstanceForClip');
    expect(managerSource).not.toContain('private removeActiveAudioProxy');
    expect(managerSource).not.toContain('createActiveAudioProxyResource');
    expect(managerSource).not.toContain('private stemLayerBufferCache');
    expect(managerSource).not.toContain('private stemLayerBufferLoading');
    expect(managerSource).not.toContain('private stemLayerBufferGeneration');
    expect(managerSource).not.toContain('private cacheStemLayerBuffer');
    expect(managerSource).not.toContain('private clearStemLayerBufferCache');
    expect(managerSource).not.toContain('private enforceStemLayerBufferCacheLimit');
    expect(managerSource).not.toContain('private canRetainStemLayerBuffer');
    expect(managerSource).not.toContain('private releaseStemLayerBufferResource');
    expect(managerSource).not.toContain('STEM_LAYER_BUFFER_CACHE');
    expect(managerSource).not.toContain('estimateAudioBufferBytes');
    expect(managerSource).not.toContain('private stemAudioElements');
    expect(managerSource).not.toContain('private getStemAudioElements');
    expect(managerSource).not.toContain('private loadStemAudioElement');
    expect(managerSource).not.toContain('private disposeStemAudioElementEntry');
    expect(managerSource).not.toContain('createStemAudioElementResource');
    expect(managerSource).not.toContain('createAudioElementFromBuffer');
    expect(managerSource).not.toContain('createAudioElementFromUrl');
    expect(managerSource).not.toContain('createAudioProxyInstance');
    expect(managerSource).not.toContain('StemAudioSourceResolver');
    expect(managerSource).not.toContain('createCurrentAudioArtifactStore');
    expect(managerSource).not.toContain('private pendingCompositionPlaybackMixdowns');
    expect(managerSource).not.toContain('private ensureCompositionAudioPlaybackElement');
    expect(managerSource).not.toContain('createCompositionMixdownAudioElement');
    expect(managerSource).not.toContain('requestCompositionAudioMixdown');
    expect(managerSource).not.toContain('applyCompositionAudioMixdownToTimelineClip');
    expect(managerSource).not.toContain('private createActiveAudioProxyResource');
    expect(managerSource).not.toContain('private createStemAudioElementResource');
    expect(managerSource).not.toContain('private createStemLayerBufferResource');
    expect(managerSource).not.toContain('private stemBufferMixerContext');
    expect(managerSource).not.toContain('private syncStemBufferMixer');
    expect(managerSource).not.toContain('private stopStemBufferMixer');
    expect(managerSource).not.toContain('private stopAllStemBufferMixers');
    expect(managerSource).not.toContain('private setStemBufferMixerMasterClock');
    expect(managerSource).not.toContain('private updateStemBufferMixerGains');
    expect(managerSource).not.toContain('private publishStemBufferMixerMeter');
    expect(managerSource).not.toContain('private getStemBufferMixerContext');
    expect(managerSource).not.toContain('private static readonly AUDIO_LOOKAHEAD_TIME');
    expect(managerSource).not.toContain('private preBufferedAudio');
    expect(managerSource).not.toContain('private preBufferUpcomingAudio');
    expect(handoffSource).toContain('class AudioTrackHandoffManager');
    expect(handoffSource).toContain('private lastTrackState');
    expect(handoffSource).toContain('getHandoffAudioElement');
    expect(handoffSource).toContain('updateLastTrackState');
    expect(stemSyncModelSource).toContain('interface StemBufferMixerSession');
    expect(stemSyncModelSource).toContain('createStemLayerSetKey');
    expect(stemSyncModelSource).toContain('canUseStemBufferMixer');
    expect(elementUtilsSource).toContain('audioBufferToWavBlob');
    expect(elementUtilsSource).toContain('createAudioElementFromBuffer');
    expect(elementUtilsSource).toContain('pauseAudioElement');
    expect(runtimeResourcesSource).toContain('createRenderResourceDescriptorFromDemand');
    expect(runtimeResourcesSource).toContain('createActiveAudioProxyResource');
    expect(runtimeResourcesSource).toContain('createStemAudioElementResource');
    expect(runtimeResourcesSource).toContain('createStemLayerBufferResource');
    expect(runtimeElementsSource).toContain('class AudioTrackRuntimeElementManager');
    expect(runtimeElementsSource).toContain('private activeAudioTrackProxies');
    expect(runtimeElementsSource).toContain('private retainedAudioElementResourceIds');
    expect(runtimeElementsSource).toContain('getVideoAudioProxyForClip');
    expect(runtimeElementsSource).toContain('createActiveAudioProxyResource');
    expect(stemLayerBuffersSource).toContain('class AudioTrackStemLayerBufferCache');
    expect(stemLayerBuffersSource).toContain('private stemLayerBufferCache');
    expect(stemLayerBuffersSource).toContain('private stemLayerBufferLoading');
    expect(stemLayerBuffersSource).toContain('cacheStemLayerBuffer');
    expect(stemLayerBuffersSource).toContain('createStemLayerBufferResource');
    expect(stemPreviewElementsSource).toContain('class AudioTrackStemPreviewElementManager');
    expect(stemPreviewElementsSource).toContain('private stemAudioElements');
    expect(stemPreviewElementsSource).toContain('loadStemAudioElement');
    expect(stemPreviewElementsSource).toContain('createStemAudioElementResource');
    expect(stemPreviewElementsSource).toContain('StemAudioSourceResolver');
    expect(stemBufferMixersSource).toContain('class AudioTrackStemBufferMixerManager');
    expect(stemBufferMixersSource).toContain('private stemBufferMixerContext');
    expect(stemBufferMixersSource).toContain('sync(options: StemBufferMixerSyncOptions)');
    expect(stemBufferMixersSource).toContain('stopInactiveMixers');
    expect(stemBufferMixersSource).toContain('releaseIdleRuntime');
    expect(stemBufferMixerSessionsSource).toContain('createStemBufferMixerSession');
    expect(stemBufferMixerSessionsSource).toContain('stopStemBufferMixerSession');
    expect(stemBufferMixerSessionsSource).toContain('updateStemBufferMixerGains');
    expect(stemBufferMixerSessionsSource).toContain('publishStemBufferMixerMeter');
    expect(stemBufferMixerSessionsSource).toContain('setStemBufferMixerMasterClock');
    expect(stemBufferMixerSessionsSource).toContain('recordStemBufferMixerLifecycle');
    expect(prebufferingSource).toContain('class AudioTrackPrebufferManager');
    expect(prebufferingSource).toContain('private preBufferedAudio');
    expect(prebufferingSource).toContain('preBufferUpcomingAudio(ctx: FrameContext)');
    expect(compositionPlaybackMixdownsSource).toContain('class AudioTrackCompositionPlaybackMixdownManager');
    expect(compositionPlaybackMixdownsSource).toContain('private pendingCompositionPlaybackMixdowns');
    expect(compositionPlaybackMixdownsSource).toContain('requestCompositionAudioMixdown');
    expect(compositionPlaybackMixdownsSource).toContain('applyCompositionAudioMixdownToTimelineClip');
    expect(lineCount(managerSource)).toBeLessThanOrEqual(700);
    expect(lineCount(handoffSource)).toBeLessThanOrEqual(160);
    expect(lineCount(stemSyncModelSource)).toBeLessThanOrEqual(180);
    expect(lineCount(elementUtilsSource)).toBeLessThanOrEqual(110);
    expect(lineCount(runtimeResourcesSource)).toBeLessThanOrEqual(170);
    expect(lineCount(runtimeElementsSource)).toBeLessThanOrEqual(230);
    expect(lineCount(stemLayerBuffersSource)).toBeLessThanOrEqual(170);
    expect(lineCount(stemPreviewElementsSource)).toBeLessThanOrEqual(300);
    expect(lineCount(stemBufferMixersSource)).toBeLessThanOrEqual(300);
    expect(lineCount(stemBufferMixerSessionsSource)).toBeLessThanOrEqual(180);
    expect(lineCount(prebufferingSource)).toBeLessThanOrEqual(100);
    expect(lineCount(compositionPlaybackMixdownsSource)).toBeLessThanOrEqual(100);
  });

  it('routes timeline store source persistence through the runtime sanitizer', () => {
    // Evidence location updated 2026-06-10: the type-barrel split (packet
    // 159) moved the timeline source contracts to src/types/timeline.ts;
    // index.ts re-exports them. Assertion strength unchanged.
    const typesSource = readRepoFile('src/types/timeline.ts');
    const sanitizerSource = readRepoFile('src/stores/timeline/sourceRuntimeSanitizer.ts');
    const serializationSource = readRepoFile('src/stores/timeline/serializationUtils.ts');
    const clipboardSource = readRepoFile('src/stores/timeline/clipboardSlice.ts');
    const splitSource = readRepoFile('src/stores/timeline/editOperations/splitBatchOperations.ts');
    const serializableStateSource = readRepoFile('src/stores/timeline/serialization/serializableTimelineState.ts');
    const stemSharingSource = readRepoFile('src/stores/timeline/helpers/stemSharingHelpers.ts');
    const stemSeparationSource = readRepoFile('src/stores/timeline/stemSeparationSlice.ts');
    const proxyCacheSource = readRepoFile('src/stores/timeline/proxyCacheSlice.ts');
    const playbackSource = readRepoFile('src/stores/timeline/playbackSlice.ts');
    const nestedCompositionSource = readRepoFile('src/stores/timeline/nestedCompositionLoader.ts');
    const nestedSegmentsSource = readRepoFile('src/stores/timeline/nestedComposition/nestedCompositionSegments.ts');
    const nestedThumbnailsSource = readRepoFile('src/stores/timeline/nestedComposition/nestedCompositionThumbnails.ts');
    const audioClipResolutionSource = readRepoFile('src/services/audio/audioClipResolution.ts');
    const stemSourceRuntimeSource = readRepoFile('src/services/timeline/timelineStemSourceRuntime.ts');
    const proxyCacheRuntimeSource = readRepoFile('src/services/timeline/timelineProxyCacheRuntime.ts');
    const playbackWarmupRuntimeSource = readRepoFile('src/services/timeline/timelinePlaybackWarmupRuntime.ts');
    const nestedCompositionThumbnailRuntimeSource = readRepoFile('src/services/timeline/timelineNestedCompositionThumbnailRuntime.ts');
    const dataSourceContract = typesSource.match(/export interface TimelineClipDataSource \{[\s\S]*?\n\}/)?.[0] ?? '';
    const runtimeSourceContract = typesSource.match(/export interface TimelineClipSourceRuntimeHandles \{[\s\S]*?\n\}/)?.[0] ?? '';
    const storeRuntimeHandleReadPattern =
      /source[?!]?\.(?:videoElement|audioElement|imageElement|textCanvas|webCodecsPlayer|nativeDecoder|runtimeSourceId|runtimeSessionKey|file)\b/g;

    expect(typesSource).toContain('export interface TimelineClipDataSource');
    expect(typesSource).toContain('export interface TimelineClipSourceRuntimeHandles');
    expect(typesSource).toContain('export type TimelineClipSource = TimelineClipDataSource & TimelineClipSourceRuntimeHandles');
    expect(typesSource).toContain('source: TimelineClipSource | null;');
    expect(sanitizerSource).toContain('TimelineClipDataSource');
    expect(dataSourceContract).toContain('filePath?: string;');
    expect(runtimeSourceContract).not.toContain('filePath?:');

    for (const key of [
      'videoElement',
      'audioElement',
      'imageElement',
      'textCanvas',
      'webCodecsPlayer',
      'nativeDecoder',
      'runtimeSourceId',
      'runtimeSessionKey',
      'file',
    ]) {
      const optionalPropertyPattern = new RegExp(`\\b${key}\\?:`);
      expect(optionalPropertyPattern.test(dataSourceContract), `TimelineClipDataSource contains runtime source key ${key}`).toBe(false);
      expect(optionalPropertyPattern.test(runtimeSourceContract), `TimelineClipSourceRuntimeHandles misses ${key}`).toBe(true);
      expect(sanitizerSource).toContain(key);
    }

    const storeRuntimeHandleReads = sourceFilesUnder(srcTimelineStoreRoot)
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        return [...source.matchAll(storeRuntimeHandleReadPattern)]
          .map((match) => `${toRepoPath(filePath)}:${match[0]}`);
      });
    expect(storeRuntimeHandleReads).toEqual([]);

    expect(serializationSource).toContain('createSerializableTimelineState');
    expect(serializableStateSource).toContain('getDataOnlyTimelineSource');
    expect(clipboardSource).toContain('getDataOnlyTimelineSource');
    expect(splitSource).toContain('stripTimelineSourceRuntimeHandles');
    expect(audioClipResolutionSource).toContain('getTimelineClipAudioSourceFileKey');
    expect(stemSharingSource).toContain('getTimelineClipAudioSourceFileKey');
    expect(stemSharingSource).not.toContain('source?.file');
    expect(stemSharingSource).not.toContain('source.file');
    expect(proxyCacheRuntimeSource).toContain('collectTimelineProxyWarmupVideos');
    expect(proxyCacheRuntimeSource).toContain('getTimelineClipScrubCacheVideoSrc');
    expect(proxyCacheSource).toContain('collectTimelineProxyWarmupVideos');
    expect(proxyCacheSource).toContain('getTimelineClipScrubCacheVideoSrc');
    expect(proxyCacheSource).not.toContain('source?.videoElement');
    expect(proxyCacheSource).not.toContain('source.videoElement');
    expect(playbackWarmupRuntimeSource).toContain('getTimelinePlaybackWarmupVideo');
    expect(playbackWarmupRuntimeSource).toContain('getRuntimeFrameProvider');
    expect(playbackSource).toContain('getTimelinePlaybackWarmupVideo');
    expect(playbackSource).not.toContain('source?.videoElement');
    expect(playbackSource).not.toContain('source.videoElement');
    expect(playbackSource).not.toContain('source?.webCodecsPlayer');
    expect(playbackSource).not.toContain('source.webCodecsPlayer');
    expect(playbackSource).not.toContain('getRuntimeFrameProvider');
    expect(nestedCompositionThumbnailRuntimeSource).toContain('generateTimelineNestedClipSegmentThumbnails');
    expect(nestedCompositionThumbnailRuntimeSource).toContain('generateTimelineNestedCompositionFallbackVideoThumbnails');
    expect(nestedSegmentsSource).toContain('generateTimelineNestedClipSegmentThumbnails');
    expect(nestedThumbnailsSource).toContain('generateTimelineNestedCompositionFallbackVideoThumbnails');
    expect(nestedCompositionSource).toContain("from './nestedComposition/nestedCompositionSegments'");
    expect(nestedCompositionSource).toContain("from './nestedComposition/nestedCompositionThumbnails'");
    expect(nestedCompositionSource).not.toContain('source?.videoElement');
    expect(nestedCompositionSource).not.toContain('source.videoElement');
    expect(nestedCompositionSource).not.toContain('source?.imageElement');
    expect(nestedCompositionSource).not.toContain('source.imageElement');
    expect(nestedCompositionSource).not.toContain('source?.textCanvas');
    expect(nestedCompositionSource).not.toContain('source.textCanvas');
    expect(stemSourceRuntimeSource).toContain('getTimelineStemSourceAudioElement');
    expect(stemSourceRuntimeSource).toContain('disposeTimelineStemSourceAudioElement');
    expect(stemSeparationSource).toContain('getTimelineStemSourceAudioElement');
    expect(stemSeparationSource).toContain('disposeTimelineStemSourceAudioElement');
    expect(stemSeparationSource).not.toContain('audioClip.source?.audioElement');
  });

  it('delegates store legacy source runtime cleanup to the timeline cleanup service', () => {
    const cleanupSource = readRepoFile('src/services/timeline/timelineClipSourceRuntimeCleanup.ts');
    const serializationSource = readRepoFile('src/stores/timeline/serializationUtils.ts');
    const deletedClipResourceSource = readRepoFile('src/stores/timeline/deletedClipResources.ts');

    expect(cleanupSource).toContain('releaseLegacyTimelineClipSourceRuntime');
    expect(cleanupSource).toContain('detachLegacyTimelineMediaElement');
    expect(serializationSource).toContain('releaseLegacyTimelineClipSourceRuntimes');
    expect(deletedClipResourceSource).toContain('releaseLegacyTimelineClipSourceRuntime');

    for (const source of [serializationSource, deletedClipResourceSource]) {
      expect(source).not.toContain('.source?.videoElement');
      expect(source).not.toContain('.source.videoElement');
      expect(source).not.toContain('.source!.videoElement');
      expect(source).not.toContain('.source?.audioElement');
      expect(source).not.toContain('.source.audioElement');
      expect(source).not.toContain('.source!.audioElement');
      expect(source).not.toContain('.source?.webCodecsPlayer');
      expect(source).not.toContain('.source.webCodecsPlayer');
      expect(source).not.toContain('.source!.webCodecsPlayer');
    }
  });

  it('delegates generated text solid and math canvas runtime creation and updates to a timeline service', () => {
    const canvasRuntimeSource = readRepoFile('src/services/timeline/timelineGeneratedCanvasRuntime.ts');
    const serializationSource = readRepoFile('src/stores/timeline/serializationUtils.ts');
    const generatedRestoreSource = readRepoFile('src/stores/timeline/serialization/loadStateGeneratedClipRestore.ts');
    const clipboardSource = readRepoFile('src/stores/timeline/clipboardSlice.ts');
    const clipboardPastePlannerSource = readRepoFile('src/stores/timeline/clipboard/clipboardClipPastePlanner.ts');
    const textClipSource = readRepoFile('src/stores/timeline/textClipSlice.ts');
    const solidClipSource = readRepoFile('src/stores/timeline/solidClipSlice.ts');
    const mathSceneClipSource = readRepoFile('src/stores/timeline/mathSceneClipSlice.ts');
    const keyframeSource = readRepoFile('src/stores/timeline/keyframeSlice.ts');
    const pathKeyframeValueSource = readRepoFile('src/stores/timeline/keyframes/pathKeyframeValues.ts');

    expect(canvasRuntimeSource).toContain('createTimelineMathSceneCanvasRuntime');
    expect(canvasRuntimeSource).toContain('createTimelineTextCanvasRuntime');
    expect(canvasRuntimeSource).toContain('createTimelineSolidCanvasRuntime');
    expect(canvasRuntimeSource).toContain('getTimelineGeneratedCanvasRuntime');
    expect(canvasRuntimeSource).toContain('renderTimelineTextCanvasRuntime');
    expect(canvasRuntimeSource).toContain('renderTimelineSolidCanvasRuntime');
    expect(canvasRuntimeSource).toContain('renderTimelineMathSceneCanvasRuntime');
    expect(generatedRestoreSource).toContain('createTimelineMathSceneCanvasRuntime');
    expect(generatedRestoreSource).toContain('createTimelineTextCanvasRuntime');
    expect(generatedRestoreSource).toContain('createTimelineSolidCanvasRuntime');
    expect(serializationSource).toContain('createLoadStateGeneratedClip');
    expect(clipboardPastePlannerSource).toContain('createTimelineMathSceneCanvasRuntime');
    expect(clipboardSource).toContain('createTimelineTextCanvasRuntime');
    expect(clipboardSource).toContain('createTimelineSolidCanvasRuntime');
    expect(textClipSource).toContain('renderTimelineTextCanvasRuntime');
    expect(textClipSource).toContain('getTimelineGeneratedCanvasRuntime');
    expect(solidClipSource).toContain('renderTimelineSolidCanvasRuntime');
    expect(solidClipSource).toContain('getTimelineGeneratedCanvasRuntime');
    expect(mathSceneClipSource).toContain('renderTimelineMathSceneCanvasRuntime');
    expect(mathSceneClipSource).toContain('getTimelineGeneratedCanvasRuntime');
    expect(keyframeSource).toContain('getClipTextBounds');
    expect(pathKeyframeValueSource).toContain('getTimelineGeneratedCanvasRuntimeDimensions');

    for (const source of [serializationSource, generatedRestoreSource, clipboardSource, clipboardPastePlannerSource]) {
      expect(source).not.toContain('mathSceneRenderer');
      expect(source).not.toContain('googleFontsService');
      expect(source).not.toContain('textRenderer');
      expect(source).not.toContain('markDynamicCanvasUpdated');
      expect(source).not.toContain("document.createElement('canvas')");
    }

    for (const source of [textClipSource, solidClipSource, mathSceneClipSource, keyframeSource, pathKeyframeValueSource]) {
      expect(source).not.toContain('.source?.textCanvas');
      expect(source).not.toContain('.source.textCanvas');
      expect(source).not.toContain('mathSceneRenderer');
      expect(source).not.toContain('textRenderer');
      expect(source).not.toContain('markDynamicCanvasUpdated');
    }
  });

  it('keeps keyframe path interpolation split out of the keyframe slice', () => {
    const keyframeSource = readRepoFile('src/stores/timeline/keyframeSlice.ts');
    const pathValueSource = readRepoFile('src/stores/timeline/keyframes/pathKeyframeValues.ts');
    const topologySource = readRepoFile('src/stores/timeline/keyframes/maskPathTopology.ts');
    const audioEffectSource = readRepoFile('src/stores/timeline/keyframes/audioEffectKeyframeValues.ts');
    const vectorSource = readRepoFile('src/stores/timeline/keyframes/vectorAnimationKeyframeValues.ts');
    const nodeCameraSource = readRepoFile('src/stores/timeline/keyframes/nodeCameraKeyframeValues.ts');
    const basicActionsSource = readRepoFile('src/stores/timeline/keyframes/keyframeBasicActions.ts');
    const pathActionsSource = readRepoFile('src/stores/timeline/keyframes/keyframePathActions.ts');
    const viewStateSource = readRepoFile('src/stores/timeline/keyframes/keyframeViewStateActions.ts');
    const transformInterpolationSource = readRepoFile('src/stores/timeline/keyframes/keyframeTransformInterpolationActions.ts');
    const effectInterpolationSource = readRepoFile('src/stores/timeline/keyframes/keyframeEffectInterpolationActions.ts');
    const assetInterpolationSource = readRepoFile('src/stores/timeline/keyframes/keyframeAssetInterpolationActions.ts');
    const clipLookupSource = readRepoFile('src/stores/timeline/keyframes/keyframeClipLookup.ts');

    expect(keyframeSource).toContain("from './keyframes/pathKeyframeValues'");
    expect(keyframeSource).toContain("from './keyframes/audioEffectKeyframeValues'");
    expect(keyframeSource).toContain("from './keyframes/vectorAnimationKeyframeValues'");
    expect(keyframeSource).toContain("from './keyframes/nodeCameraKeyframeValues'");
    expect(keyframeSource).toContain("from './keyframes/keyframeBasicActions'");
    expect(keyframeSource).toContain("from './keyframes/keyframePathActions'");
    expect(keyframeSource).toContain("from './keyframes/keyframeViewStateActions'");
    expect(keyframeSource).toContain("from './keyframes/keyframeTransformInterpolationActions'");
    expect(keyframeSource).toContain("from './keyframes/keyframeEffectInterpolationActions'");
    expect(keyframeSource).toContain("from './keyframes/keyframeAssetInterpolationActions'");
    expect(keyframeSource).not.toContain('function buildMorphableMaskPaths');
    expect(keyframeSource).not.toContain('function applySplitSourceSegment');
    expect(keyframeSource).not.toContain('function keyframePropertyInvalidatesProcessedAudio');
    expect(keyframeSource).not.toContain('AUDIO_EQ_DEFAULT_BAND_DYNAMICS');
    expect(keyframeSource).not.toContain('function getVectorAnimationInputBaseValue');
    expect(keyframeSource).not.toContain('function getCustomNodeParamDefaults');
    expect(keyframeSource).not.toContain('function buildCameraSettingsPatch');
    expect(keyframeSource).not.toContain('getInterpolatedClipTransform');
    expect(keyframeSource).not.toContain('createPathKeyframeTransactionId');
    expect(pathValueSource).toContain('getInterpolatedMaskPathValue');
    expect(pathValueSource).toContain('getClipTextBounds');
    expect(topologySource).toContain('buildMorphableMaskPaths');
    expect(topologySource).toContain('maskPathsHaveMatchingTopology');
    expect(audioEffectSource).toContain('clearProcessedAudioAnalysisRefsForKeyframeTargets');
    expect(audioEffectSource).toContain('getLegacyEffectKeyframeBaseValue');
    expect(vectorSource).toContain('getVectorAnimationInputBaseValue');
    expect(vectorSource).toContain('normalizeVectorAnimationStateKeyframeValue');
    expect(nodeCameraSource).toContain('getCustomNodeParamDefaults');
    expect(nodeCameraSource).toContain('buildCameraSettingsPatch');
    expect(basicActionsSource).toContain('addKeyframe');
    expect(pathActionsSource).toContain('addMaskPathKeyframe');
    expect(viewStateSource).toContain('getExpandedTrackHeight');
    expect(transformInterpolationSource).toContain('getInterpolatedTransform');
    expect(effectInterpolationSource).toContain('getInterpolatedEffects');
    expect(assetInterpolationSource).toContain('getInterpolatedVectorAnimationSettings');
    expect(clipLookupSource).toContain('isClipOnLockedTrack');
    expect(lineCount(keyframeSource)).toBeLessThanOrEqual(700);
    expect(lineCount(pathValueSource)).toBeLessThanOrEqual(250);
    expect(lineCount(topologySource)).toBeLessThanOrEqual(250);
    expect(lineCount(audioEffectSource)).toBeLessThanOrEqual(250);
    expect(lineCount(vectorSource)).toBeLessThanOrEqual(250);
    expect(lineCount(nodeCameraSource)).toBeLessThanOrEqual(250);
    expect(lineCount(basicActionsSource)).toBeLessThanOrEqual(300);
    expect(lineCount(pathActionsSource)).toBeLessThanOrEqual(300);
    expect(lineCount(viewStateSource)).toBeLessThanOrEqual(300);
    expect(lineCount(transformInterpolationSource)).toBeLessThanOrEqual(300);
    expect(lineCount(effectInterpolationSource)).toBeLessThanOrEqual(300);
    expect(lineCount(assetInterpolationSource)).toBeLessThanOrEqual(300);
    expect(lineCount(clipLookupSource)).toBeLessThanOrEqual(100);
  });

  it('keeps track audio state helpers split out of the track slice', () => {
    const trackSource = readRepoFile('src/stores/timeline/trackSlice.ts');
    const audioStateSource = readRepoFile('src/stores/timeline/tracks/trackAudioState.ts');

    expect(trackSource).toContain("from './tracks/trackAudioState'");
    expect(trackSource).not.toContain('function ensureTrackAudioState');
    expect(trackSource).not.toContain('function ensureMasterAudioState');
    expect(trackSource).not.toContain('function createAudioEffectInstance');
    expect(trackSource).not.toContain('RUNTIME_AUDIO_METER_STORE_MIRROR_INTERVAL_MS');
    expect(trackSource).not.toContain('AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT');
    expect(trackSource).not.toContain('getAudioEffectDefaultParams');
    expect(audioStateSource).toContain('ensureTrackAudioState');
    expect(audioStateSource).toContain('scheduleRuntimeAudioMeterMirrorFlush');
    expect(audioStateSource).toContain('withAudioExportPreflightMeasurementHistory');
    expect(lineCount(trackSource)).toBeLessThanOrEqual(700);
    expect(lineCount(audioStateSource)).toBeLessThanOrEqual(300);
  });

  it('keeps move lead resolution and track compatibility split out of the move resolver', () => {
    const moveSource = readRepoFile('src/stores/timeline/editOperations/moveResolution.ts');
    const leadSource = readRepoFile('src/stores/timeline/editOperations/moveLeadResolution.ts');
    const compatibilitySource = readRepoFile('src/stores/timeline/editOperations/moveTrackCompatibility.ts');

    expect(moveSource).toContain("from './moveLeadResolution'");
    expect(moveSource).toContain("from './moveTrackCompatibility'");
    expect(moveSource).toContain('resolveLeadMove');
    expect(moveSource).not.toContain('const VISUAL_SOURCE_TYPES');
    expect(moveSource).not.toContain('function resolveSnap');
    expect(moveSource).not.toContain('function findAlternativeTrack');
    expect(moveSource).not.toContain('function resolveLeadMove');
    expect(moveSource).not.toContain('function isTrackCompatible');
    expect(leadSource).toContain("from './moveTrackCompatibility'");
    expect(leadSource).toContain('function resolveSnap');
    expect(leadSource).toContain('function resolveLeadMove');
    expect(leadSource).not.toContain('const VISUAL_SOURCE_TYPES');
    expect(leadSource).not.toContain('function isTrackCompatible');
    expect(compatibilitySource).toContain('const VISUAL_SOURCE_TYPES');
    expect(compatibilitySource).toContain('function isTrackCompatible');
    expect(compatibilitySource).toContain('function isNewTrackTypeCompatible');
    expect(lineCount(moveSource)).toBeLessThanOrEqual(700);
    expect(lineCount(leadSource)).toBeLessThanOrEqual(300);
    expect(lineCount(compatibilitySource)).toBeLessThanOrEqual(100);
  });

  it('keeps transaction handlers split out of the edit operation applier', () => {
    const applySource = readRepoFile('src/stores/timeline/editOperations/applyTimelineEditOperation.ts');
    const editResultSource = readRepoFile('src/stores/timeline/editOperations/editOperationResults.ts');
    const fadePlanSource = readRepoFile('src/stores/timeline/editOperations/fadeKeyframePlan.ts');
    const fadeTransactionSource = readRepoFile('src/stores/timeline/editOperations/fadeTransactionOperations.ts');
    const keyframeHelperSource = readRepoFile('src/stores/timeline/editOperations/keyframeTransactionHelpers.ts');
    const keyframeTransactionSource = readRepoFile('src/stores/timeline/editOperations/keyframeTransactionOperations.ts');
    const keyboardSource = readRepoFile('src/stores/timeline/editOperations/keyboardEditCommandOperations.ts');
    const resolvedMoveSource = readRepoFile('src/stores/timeline/editOperations/resolvedMoveApplyOperation.ts');

    expect(applySource).toContain("from './editOperationResults'");
    expect(applySource).toContain("from './fadeTransactionOperations'");
    expect(applySource).toContain("from './keyframeTransactionOperations'");
    expect(applySource).toContain("from './keyboardEditCommandOperations'");
    expect(applySource).toContain("from './resolvedMoveApplyOperation'");
    expect(applySource).not.toContain('function applyFadeKeyframePlan');
    expect(applySource).not.toContain('function findKeyframeOwner');
    expect(applySource).not.toContain('keyboard-cycle-blend-mode-command');
    expect(applySource).not.toContain('materializeResolvedClipMoveFallbackTracks');
    expect(editResultSource).toContain('function blockedByExport');
    expect(fadePlanSource).toContain('function applyFadeKeyframePlan');
    expect(fadeTransactionSource).toContain('function applyFadeTransactionOperation');
    expect(keyframeHelperSource).toContain('function findKeyframeOwner');
    expect(keyframeTransactionSource).toContain('function applyKeyframeTransactionOperation');
    expect(keyboardSource).toContain('function applyKeyboardEditCommandOperation');
    expect(resolvedMoveSource).toContain('function applyResolvedMoveClipsOperation');
    expect(lineCount(applySource)).toBeLessThanOrEqual(700);
    for (const source of [
      editResultSource,
      fadePlanSource,
      fadeTransactionSource,
      keyframeHelperSource,
      keyframeTransactionSource,
      keyboardSource,
      resolvedMoveSource,
    ]) {
      expect(lineCount(source)).toBeLessThanOrEqual(300);
    }
  });

  it('keeps stem relink choice discovery split out of the stem separation slice', () => {
    const stemSource = readRepoFile('src/stores/timeline/stemSeparationSlice.ts');
    const relinkSource = readRepoFile('src/stores/timeline/stems/stemRelinkChoices.ts');

    expect(stemSource).toContain("from './stems/stemRelinkChoices'");
    expect(stemSource).toContain('collectRelinkedStemChoicesForClip');
    expect(stemSource).not.toContain('STEM_MEDIA_ROOT_FOLDER_NAME');
    expect(stemSource).not.toContain('STEM_LABEL_TO_KIND');
    expect(stemSource).not.toContain('function inferLegacyStemChoice');
    expect(stemSource).not.toContain('function stemFolderNameCandidates');
    expect(relinkSource).toContain('STEM_MEDIA_ROOT_FOLDER_NAME');
    expect(relinkSource).toContain('STEM_LABEL_TO_KIND');
    expect(relinkSource).toContain('function inferLegacyStemChoice');
    expect(relinkSource).toContain('function stemFolderNameCandidates');
    expect(lineCount(stemSource)).toBeLessThanOrEqual(700);
    expect(lineCount(relinkSource)).toBeLessThanOrEqual(250);
  });

  it('keeps clipboard paste planning split out of the clipboard slice', () => {
    const clipboardSource = readRepoFile('src/stores/timeline/clipboardSlice.ts');
    const pastePlannerSource = readRepoFile('src/stores/timeline/clipboard/clipboardClipPastePlanner.ts');
    const effectKeyframesSource = readRepoFile('src/stores/timeline/clipboard/clipboardEffectKeyframes.ts');

    expect(clipboardSource).toContain("from './clipboard/clipboardClipPastePlanner'");
    expect(clipboardSource).toContain("from './clipboard/clipboardEffectKeyframes'");
    expect(clipboardSource).not.toContain('function createPastedClipSource');
    expect(clipboardSource).not.toContain('function resolveTargetTrackId');
    expect(clipboardSource).not.toContain('function parseEffectKeyframeProperty');
    expect(pastePlannerSource).toContain('createPastedClipboardClipsPlan');
    expect(pastePlannerSource).toContain('function createPastedClipSource');
    expect(pastePlannerSource).toContain('function resolveTargetTrackId');
    expect(effectKeyframesSource).toContain('parseClipboardEffectKeyframeProperty');
    expect(lineCount(clipboardSource)).toBeLessThanOrEqual(700);
    expect(lineCount(pastePlannerSource)).toBeLessThanOrEqual(250);
    expect(lineCount(effectKeyframesSource)).toBeLessThanOrEqual(100);
  });

  it('keeps nested composition keyframes, segments, and thumbnails split out of the loader', () => {
    const loaderSource = readRepoFile('src/stores/timeline/nestedCompositionLoader.ts');
    const keyframesSource = readRepoFile('src/stores/timeline/nestedComposition/nestedCompositionKeyframes.ts');
    const segmentsSource = readRepoFile('src/stores/timeline/nestedComposition/nestedCompositionSegments.ts');
    const thumbnailsSource = readRepoFile('src/stores/timeline/nestedComposition/nestedCompositionThumbnails.ts');

    expect(loaderSource).toContain("from './nestedComposition/nestedCompositionKeyframes'");
    expect(loaderSource).toContain("from './nestedComposition/nestedCompositionSegments'");
    expect(loaderSource).toContain("from './nestedComposition/nestedCompositionThumbnails'");
    expect(loaderSource).not.toContain('function calculateNestedClipBoundaries');
    expect(loaderSource).not.toContain('function collectNestedClipKeyframes');
    expect(loaderSource).not.toContain('function buildClipSegments');
    expect(loaderSource).not.toContain('function generateCompThumbnails');
    expect(keyframesSource).toContain('collectNestedClipKeyframes');
    expect(keyframesSource).toContain('mergeNestedClipKeyframes');
    expect(segmentsSource).toContain('calculateNestedClipBoundaries');
    expect(segmentsSource).toContain('buildAndApplyNestedClipSegments');
    expect(thumbnailsSource).toContain('generateCompThumbnails');
    expect(lineCount(loaderSource)).toBeLessThanOrEqual(700);
    expect(lineCount(keyframesSource)).toBeLessThanOrEqual(150);
    expect(lineCount(segmentsSource)).toBeLessThanOrEqual(250);
    expect(lineCount(thumbnailsSource)).toBeLessThanOrEqual(150);
  });

  it('keeps serialization state and load-state clip restore helpers split out of serialization utils', () => {
    const serializationSource = readRepoFile('src/stores/timeline/serializationUtils.ts');
    const serializableStateSource = readRepoFile('src/stores/timeline/serialization/serializableTimelineState.ts');
    const generatedRestoreSource = readRepoFile('src/stores/timeline/serialization/loadStateGeneratedClipRestore.ts');
    const compositionRestoreSource = readRepoFile('src/stores/timeline/serialization/loadStateCompositionClipRestore.ts');
    const mediaRestoreSource = readRepoFile('src/stores/timeline/serialization/loadStateMediaClipRestore.ts');

    expect(serializationSource).toContain("from './serialization/serializableTimelineState'");
    expect(serializationSource).toContain("from './serialization/loadStateGeneratedClipRestore'");
    expect(serializationSource).toContain("from './serialization/loadStateCompositionClipRestore'");
    expect(serializationSource).toContain("from './serialization/loadStateMediaClipRestore'");
    expect(serializationSource).not.toContain('function createSerializableClip');
    expect(serializationSource).not.toContain('function createCompositionVideoClip');
    expect(serializationSource).not.toContain('function createInitialRestoredMediaSource');
    expect(serializationSource).not.toContain('function startLoadStateTopLevelRuntimeRestore');
    expect(serializationSource).not.toContain('resolveLoadStateMediaRuntimeReference');
    expect(serializationSource).not.toContain('projectFileService.getAnalysis');
    expect(serializationSource).not.toContain('createTimelineMathSceneCanvasRuntime');
    expect(serializationSource).not.toContain('DEFAULT_SCENE_CAMERA_SETTINGS');
    expect(serializableStateSource).toContain('createSerializableTimelineState');
    expect(serializableStateSource).toContain('getDataOnlyTimelineSource');
    expect(generatedRestoreSource).toContain('createLoadStateGeneratedClip');
    expect(compositionRestoreSource).toContain('restoreLoadStateCompositionClip');
    expect(mediaRestoreSource).toContain('restoreLoadStateMediaClip');
    expect(mediaRestoreSource).toContain('resolveLoadStateMediaRuntimeReference');
    expect(mediaRestoreSource).toContain('startLoadStateVectorRuntimeRestore');
    expect(lineCount(serializationSource)).toBeLessThanOrEqual(320);
    expect(lineCount(serializableStateSource)).toBeLessThanOrEqual(200);
    expect(lineCount(generatedRestoreSource)).toBeLessThanOrEqual(300);
    expect(lineCount(compositionRestoreSource)).toBeLessThanOrEqual(300);
    expect(lineCount(mediaRestoreSource)).toBeLessThanOrEqual(380);
  });

  it('keeps clip add composition and audio analysis actions split out of the clip slice', () => {
    const clipSource = readRepoFile('src/stores/timeline/clipSlice.ts');
    const clipModules = [
      'addAudioClip',
      'addClipAction',
      'addClipMediaSource',
      'addClipOptions',
      'addCompClip',
      'addGaussianAvatarClip',
      'addGaussianSplatClip',
      'addImageClip',
      'addLottieClip',
      'addModelClip',
      'addRiveClip',
      'addVideoClip',
      'clipActionContext',
      'clipAudioAnalysisShared',
      'clipPreparedAudioAnalysisActions',
      'clipPreparedAudioAnalysisCore',
      'clipProcessedWaveformAnalysisActions',
      'clipRhythmFrequencyAnalysisActions',
      'clipWaveformAnalysisActions',
      'completeDownload',
      'compositionClipActions',
      'upgradeToNativeDecoder',
      'videoCachedAnalysisLoader',
      'videoLinkedAudioLoader',
      'videoThumbnailLoader',
    ];

    expect(clipSource).toContain("from './clip/addClipAction'");
    expect(clipSource).toContain("from './clip/compositionClipActions'");
    expect(clipSource).toContain("from './clip/clipWaveformAnalysisActions'");
    expect(clipSource).toContain("from './clip/clipPreparedAudioAnalysisActions'");
    expect(clipSource).toContain("from './clip/clipProcessedWaveformAnalysisActions'");
    expect(clipSource).toContain("from './clip/clipRhythmFrequencyAnalysisActions'");
    expect(clipSource).not.toContain('generateTimelineWaveformAnalysisForFile');
    expect(clipSource).not.toContain('prepareClipAudioAnalysisInput');
    expect(clipSource).not.toContain('createNestedContentHash');
    expect(clipSource).not.toContain('createVideoClipPlaceholder');
    expect(readRepoFile('src/stores/timeline/clip/addClipAction.ts')).toContain('applyAddClipAction');
    expect(readRepoFile('src/stores/timeline/clip/compositionClipActions.ts')).toContain('refreshCompClipNestedDataAction');
    expect(readRepoFile('src/stores/timeline/clip/clipProcessedWaveformAnalysisActions.ts')).toContain('generateProcessedWaveformForClipAction');
    expect(readRepoFile('src/stores/timeline/clip/clipRhythmFrequencyAnalysisActions.ts')).toContain('generateFrequencyPhaseForClipAction');
    expect(readRepoFile('src/stores/timeline/clip/videoLinkedAudioLoader.ts')).toContain('loadLinkedAudio');
    expect(lineCount(clipSource)).toBeLessThanOrEqual(700);
    for (const moduleName of clipModules) {
      expect(lineCount(readRepoFile(`src/stores/timeline/clip/${moduleName}.ts`))).toBeLessThanOrEqual(300);
    }
  });

  it('keeps audio edit detection bake and spectral actions split out of the audio edit slice', () => {
    const audioEditSource = readRepoFile('src/stores/timeline/audioEditSlice.ts');
    const helperSource = readRepoFile('src/stores/timeline/audioEdit/audioEditHelpers.ts');
    const detectionSource = readRepoFile('src/stores/timeline/audioEdit/audioDetectionActions.ts');
    const transientSource = readRepoFile('src/stores/timeline/audioEdit/audioTransientActions.ts');
    const bakeSource = readRepoFile('src/stores/timeline/audioEdit/audioBakeActions.ts');
    const spectralSource = readRepoFile('src/stores/timeline/audioEdit/spectralAudioActions.ts');
    const spectralHelperSource = readRepoFile('src/stores/timeline/audioEdit/spectralLayerHelpers.ts');

    expect(audioEditSource).toContain("from './audioEdit/audioEditHelpers'");
    expect(audioEditSource).toContain("from './audioEdit/audioDetectionActions'");
    expect(audioEditSource).toContain("from './audioEdit/audioTransientActions'");
    expect(audioEditSource).toContain("from './audioEdit/audioBakeActions'");
    expect(audioEditSource).toContain("from './audioEdit/spectralAudioActions'");
    expect(audioEditSource).not.toContain('function normalizeDetectedSilenceRanges');
    expect(audioEditSource).not.toContain('function renderClipEditStackOnly');
    expect(audioEditSource).not.toContain('function normalizeSpectralLayer');
    expect(helperSource).toContain('isAudioClip');
    expect(detectionSource).toContain('applyDetectedSilenceRemoval');
    expect(detectionSource).toContain('applyRoomToneFill');
    expect(transientSource).toContain('applyDetectedTransientSoftening');
    expect(bakeSource).toContain('bakeClipAudioEditStack');
    expect(bakeSource).toContain('unbakeClipAudioEditStack');
    expect(spectralSource).toContain('applySpectralRegionEdit');
    expect(spectralHelperSource).toContain('normalizeSpectralLayer');
    expect(lineCount(audioEditSource)).toBeLessThanOrEqual(700);
    for (const source of [helperSource, detectionSource, transientSource, bakeSource, spectralSource, spectralHelperSource]) {
      expect(lineCount(source)).toBeLessThanOrEqual(300);
    }
  });

  it('keeps timeline store type contracts split out of the public type facade', () => {
    const typesSource = readRepoFile('src/stores/timeline/types.ts');
    const storeTypeModules = [
      'audioActionTypes',
      'clipboardTypes',
      'clipActionTypes',
      'feedbackTypes',
      'maskActionTypes',
      'playbackActionTypes',
      'regionTypes',
      'stemJobTypes',
      'timelineStateTypes',
      'timelineStoreTypes',
      'toolTypes',
      'trackActionTypes',
      'utilityActionTypes',
    ];

    for (const moduleName of storeTypeModules) {
      expect(typesSource).toContain(`from './storeTypes/${moduleName}'`);
      expect(lineCount(readRepoFile(`src/stores/timeline/storeTypes/${moduleName}.ts`))).toBeLessThanOrEqual(300);
    }

    expect(typesSource).not.toContain('export interface TimelineState');
    expect(typesSource).not.toContain('export interface TimelineStore');
    expect(typesSource).not.toContain('export interface TrackActions');
    expect(typesSource).not.toContain('export interface CoreClipActions');
    expect(typesSource).not.toContain('export interface AudioEditActions');
    expect(lineCount(typesSource)).toBeLessThanOrEqual(100);
  });

  it('delegates clipboard media reload source patches to a timeline service', () => {
    const mediaRuntimeRestoreSource = readRepoFile('src/services/timeline/timelineMediaSourceRuntimeRestore.ts');
    const clipboardSource = readRepoFile('src/stores/timeline/clipboardSlice.ts');

    expect(mediaRuntimeRestoreSource).toContain('createClipboardMediaReloadPatch');
    expect(mediaRuntimeRestoreSource).toContain('createPrimaryMediaObjectUrl');
    expect(mediaRuntimeRestoreSource).toContain("sourceType === 'video' || sourceType === 'audio'");
    expect(mediaRuntimeRestoreSource).toContain("sourceType === 'image'");
    expect(mediaRuntimeRestoreSource).toContain("sourceType === 'model'");
    expect(clipboardSource).toContain('createClipboardMediaReloadPatch');
    expect(clipboardSource).not.toContain('createPrimaryMediaObjectUrl');
    expect(clipboardSource).not.toContain('const sourceType = newClip.source?.type');
    expect(clipboardSource).not.toContain('file: mediaFile.file!');
    expect(clipboardSource).not.toContain('modelUrl: fileUrl');
    expect(clipboardSource).not.toContain('imageUrl: fileUrl');
  });

  it('delegates load-state media reference rehydration to a timeline service', () => {
    const mediaRuntimeRestoreSource = readRepoFile('src/services/timeline/timelineMediaSourceRuntimeRestore.ts');
    const serializationSource = readRepoFile('src/stores/timeline/serializationUtils.ts');
    const mediaClipRestoreSource = readRepoFile('src/stores/timeline/serialization/loadStateMediaClipRestore.ts');

    expect(mediaRuntimeRestoreSource).toContain('resolveLoadStateMediaRuntimeReference');
    expect(mediaRuntimeRestoreSource).toContain('createLoadStateImageRestorePatch');
    expect(mediaRuntimeRestoreSource).toContain('createLoadStateNativeVideoPathRestorePatch');
    expect(mediaRuntimeRestoreSource).toContain('createLoadStateDeferredMediaRestorePatch');
    expect(mediaRuntimeRestoreSource).toContain('startLoadStateVectorRuntimeRestore');
    expect(mediaRuntimeRestoreSource).toContain('createLoadStateSpatialRestorePatch');
    expect(mediaRuntimeRestoreSource).toContain('NativeHelperClient');
    expect(mediaRuntimeRestoreSource).toContain('URL.createObjectURL');
    expect(mediaRuntimeRestoreSource).toContain('createPrimaryMediaObjectUrl');
    expect(serializationSource).toContain('restoreLoadStateMediaClip');
    expect(mediaClipRestoreSource).toContain('resolveLoadStateMediaRuntimeReference');
    expect(mediaClipRestoreSource).toContain('createLoadStateImageRestorePatch');
    expect(mediaClipRestoreSource).toContain('createLoadStateNativeVideoPathRestorePatch');
    expect(mediaClipRestoreSource).toContain('createLoadStateDeferredMediaRestorePatch');
    expect(mediaClipRestoreSource).toContain('startLoadStateVectorRuntimeRestore');
    expect(mediaClipRestoreSource).toContain('createLoadStateSpatialRestorePatch');
    expect(serializationSource).not.toContain('NativeHelperClient');
    expect(serializationSource).not.toContain('createPrimaryMediaObjectUrl');
    expect(serializationSource).not.toContain('URL.createObjectURL');
    expect(serializationSource).not.toContain('deferObjectUrlRestore');
    expect(serializationSource).not.toContain('parseFileReferenceUrl');
    expect(serializationSource).not.toContain('getReferencedFile');
    expect(serializationSource).not.toContain('function getLoadStateImageRuntimeUrl');
    expect(serializationSource).not.toContain('mediaObjectUrlManager');
    expect(serializationSource).not.toContain('getPrimaryMediaObjectUrlKey');
    expect(serializationSource).not.toContain('const runtimeClip: TimelineClip');
    expect(serializationSource).not.toContain('createReadyPatch: (source)');
    expect(serializationSource).not.toContain('applyManagedRestoredSpatialSource(\n      clip,');
  });

  it('routes external timeline drops through command planning', () => {
    const commandPlannerSource = readRepoFile('src/timeline/commands/TimelineExternalDropCommand.ts');
    const commandExecutorSource = readRepoFile('src/services/timeline/timelineExternalDropCommandExecutor.ts');
    const filePlacementSource = readRepoFile('src/services/timeline/timelineExternalDropFilePlacement.ts');
    const mediaResolverSource = readRepoFile('src/services/timeline/timelineExternalDropMediaResolver.ts');
    const hookSource = readRepoFile('src/components/timeline/hooks/useExternalDrop.ts');
    const bridgeRoutingSource = readRepoFile('src/components/timeline/hooks/useExternalDragBridgeRouting.ts');
    const immediatePreviewSource = readRepoFile('src/components/timeline/hooks/externalDropImmediatePreview.ts');
    const previewDragTypesSource = readRepoFile('src/components/timeline/hooks/externalDropPreviewDragTypes.ts');
    const trackDragEnterSource = readRepoFile('src/components/timeline/hooks/useExternalDropTrackDragEnter.ts');
    const trackDragOverSource = readRepoFile('src/components/timeline/hooks/useExternalDropTrackDragOver.ts');
    const newTrackDragOverSource = readRepoFile('src/components/timeline/hooks/useExternalDropNewTrackDragOver.ts');
    const trackDragLeaveSource = readRepoFile('src/components/timeline/hooks/useExternalDropTrackDragLeave.ts');

    expect(commandPlannerSource).toContain('planTimelineExternalDropCommand');
    expect(commandPlannerSource).toContain('canRouteTimelineExternalDropCommandToTrack');
    expect(commandPlannerSource).toContain('TIMELINE_EXTERNAL_DROP_MIME_TYPES');
    expect(hookSource).toContain('planExternalDropCommand');
    expect(hookSource).toContain('planTimelineExternalDropCommand');
    expect(hookSource).toContain('canRouteTimelineExternalDropCommandToTrack');
    expect(commandExecutorSource).toContain('executeTimelineExternalDropCommand');
    expect(commandExecutorSource).toContain('resolveMediaFileForTimelineDrop');
    expect(commandExecutorSource).toContain('createSignalTimelineAdapterPlan');
    expect(filePlacementSource).toContain('placeTimelineExternalDropFiles');
    expect(filePlacementSource).toContain('resolveTimelineDropMediaFile');
    expect(filePlacementSource).toContain('classifyMediaType');
    expect(hookSource).toContain('executeTimelineExternalDropCommand');
    expect(hookSource).toContain('placeTimelineExternalDropFiles');
    expect(hookSource).toContain('useExternalDragBridgeRouting');
    expect(hookSource).toContain('resolveExternalDropImmediatePreview');
    expect(hookSource).toContain('useExternalDropTrackDragEnter');
    expect(hookSource).toContain('useExternalDropTrackDragOver');
    expect(hookSource).toContain('useExternalDropNewTrackDragOver');
    expect(hookSource).toContain('useExternalDropTrackDragLeave');
    expect(mediaResolverSource).toContain('resolveTimelineDropMediaFile');
    expect(mediaResolverSource).toContain('resolveMediaFileForTimelineDrop');
    expect(mediaResolverSource).toContain('NativeHelperClient');
    expect(mediaResolverSource).toContain('createPrimaryMediaObjectUrl');
    expect(hookSource).not.toContain('resolveTimelineDropMediaFile');
    expect(hookSource).not.toContain('resolveMediaFileForTimelineDrop');
    expect(hookSource).not.toContain('classifyMediaType');
    expect(hookSource).not.toContain('setTimelineDroppedFilePath');
    expect(hookSource).not.toContain('getTimelineDropMediaTypeOverride');
    expect(hookSource).not.toContain('async function resolveTimelineDropMediaFile');
    expect(hookSource).not.toContain('async function resolveMediaFileForTimeline');
    expect(hookSource).not.toContain('NativeHelperClient');
    expect(hookSource).not.toContain('createPrimaryMediaObjectUrl');
    expect(hookSource).not.toContain('EXTERNAL_DRAG_BRIDGE_EVENT');
    expect(hookSource).not.toContain('function createPayloadDragEvent');
    expect(hookSource).not.toContain('resolveExternalDragBridgeTarget');
    expect(hookSource).not.toContain('VISUAL_DEFAULT_PREVIEW');
    expect(hookSource).not.toContain('function visualPreview');
    expect(hookSource).not.toContain('isMediaFile');
    expect(hookSource).not.toContain('isModelFile');
    expect(hookSource).not.toContain('isVideoFile');
    expect(hookSource).not.toContain('isGaussianSplatFile');
    expect(hookSource).not.toContain('createSignalTimelineAdapterPlan');
    expect(hookSource).not.toContain("const compDuration = dragPayload?.kind === 'composition'");
    expect(hookSource).not.toContain("const meshItemId = dragPayload?.kind === 'mesh'");
    expect(hookSource).not.toContain("const signalAssetId = dragPayload?.kind === 'signal'");
    expect(hookSource).not.toContain('const isCompDrag =');
    expect(hookSource).not.toContain('const isMediaPanelDrag =');
    expect(hookSource).not.toContain('videoHasAudio');
    expect(hookSource).not.toContain('Hovering video track');
    expect(hookSource).not.toContain('const showVideoNewTrackZone = trackType');
    expect(hookSource).not.toContain('const handleTrackDragOver = useCallback');
    expect(hookSource).not.toContain('const handleNewTrackDragOver = useCallback');
    expect(hookSource).not.toContain('const handleTrackDragLeave = useCallback');
    expect(hookSource).not.toContain("const textItemId = dropCommand.kind === 'text'");
    expect(hookSource).not.toContain("const solidItemId = dropCommand.kind === 'solid'");
    expect(bridgeRoutingSource).toContain('EXTERNAL_DRAG_BRIDGE_EVENT');
    expect(bridgeRoutingSource).toContain('function createPayloadDragEvent');
    expect(bridgeRoutingSource).toContain('resolveExternalDragBridgeTarget');
    expect(bridgeRoutingSource).toContain('getExternalDragPayload');
    expect(bridgeRoutingSource).toContain('handleTrackDragOver(dragEvent, target.trackId)');
    expect(bridgeRoutingSource).toContain('handleNewTrackDragOver(dragEvent, target.trackType)');
    expect(immediatePreviewSource).toContain('resolveExternalDropImmediatePreview');
    expect(immediatePreviewSource).toContain('VISUAL_DEFAULT_PREVIEW');
    expect(immediatePreviewSource).toContain('function visualPreview');
    expect(immediatePreviewSource).toContain('useMediaStore.getState()');
    expect(immediatePreviewSource).toContain('createSignalTimelineAdapterPlan');
    expect(immediatePreviewSource).toContain('isMediaFile');
    expect(immediatePreviewSource).toContain('isModelFile');
    expect(immediatePreviewSource).toContain('requestVideoMetadata(`media:${dragPayload.id}`, dragPayload.file)');
    expect(previewDragTypesSource).toContain('GENERATED_VISUAL_DROP_TYPES');
    expect(previewDragTypesSource).toContain('TRACK_PREVIEW_DROP_TYPES');
    expect(previewDragTypesSource).toContain('function hasAnyDropType');
    expect(previewDragTypesSource).toContain('hasGeneratedVisualDropType');
    expect(previewDragTypesSource).toContain('hasTrackPreviewDropType');
    expect(trackDragEnterSource).toContain('useExternalDropTrackDragEnter');
    expect(trackDragEnterSource).toContain("from './externalDropPreviewDragTypes'");
    expect(trackDragEnterSource).toContain('hasTrackPreviewDropType(dataTransferTypes)');
    expect(trackDragEnterSource).toContain('hasGeneratedVisualDropType(dataTransferTypes)');
    expect(trackDragEnterSource).toContain('resolveImmediateDragPreview(event)');
    expect(trackDragEnterSource).toContain('applyVideoNewTrackOffer');
    expect(trackDragEnterSource).toContain('buildTrackPreviewState');
    expect(trackDragOverSource).toContain('useExternalDropTrackDragOver');
    expect(trackDragOverSource).toContain("from './externalDropPreviewDragTypes'");
    expect(trackDragOverSource).toContain("event.dataTransfer.dropEffect = 'copy'");
    expect(trackDragOverSource).toContain("event.dataTransfer.dropEffect = 'none'");
    expect(trackDragOverSource).toContain('getPreviewMetadataFallback()');
    expect(trackDragOverSource).toContain('buildTrackPreviewState');
    expect(newTrackDragOverSource).toContain('useExternalDropNewTrackDragOver');
    expect(newTrackDragOverSource).toContain('getVideoNewTrackOffered()');
    expect(newTrackDragOverSource).toContain("trackId: '__new_track__'");
    expect(newTrackDragOverSource).toContain('showVideoNewTrackZone');
    expect(trackDragLeaveSource).toContain('useExternalDropTrackDragLeave');
    expect(trackDragLeaveSource).toContain('dragCounterRef.current--');
    expect(trackDragLeaveSource).toContain("trackId: ''");
    expect(lineCount(hookSource)).toBeLessThanOrEqual(694);
    expect(lineCount(bridgeRoutingSource)).toBeLessThanOrEqual(300);
    expect(lineCount(immediatePreviewSource)).toBeLessThanOrEqual(250);
    expect(lineCount(previewDragTypesSource)).toBeLessThanOrEqual(50);
    expect(lineCount(trackDragEnterSource)).toBeLessThanOrEqual(100);
    expect(lineCount(trackDragOverSource)).toBeLessThanOrEqual(150);
    expect(lineCount(newTrackDragOverSource)).toBeLessThanOrEqual(120);
    expect(lineCount(trackDragLeaveSource)).toBeLessThanOrEqual(50);
  });

  it('keeps runtime resource tests outside the timeline kernel', () => {
    const runtimeResourceGate = 'P4_RUNTIME_RESOURCE_TESTS_KEPT_OUT_OF_KERNEL';
    const runtimeTestPaths = [
      'tests/unit/mediaObjectUrlManager.test.ts',
      'tests/unit/timelineRuntimeCoordinatorContracts.test.ts',
    ];
    const migrationByPath = new Map(timelineTestMigrationLedger.map((entry) => [entry.path, entry]));
    const runtimeCoverage = timelineExitCriteriaCoverage.find((entry) => entry.gateId === runtimeResourceGate);

    expect(runtimeCoverage?.evidence.map((entry) => entry.path).join(';')).toContain(runtimeTestPaths[0]);
    expect(runtimeCoverage?.evidence.map((entry) => entry.path).join(';')).toContain(runtimeTestPaths[1]);
    expect(runtimeCoverage?.evidence.map((entry) => entry.path).join(';')).toContain('tests/unit/timelineArchitectureRegistry.test.ts');

    for (const testPath of runtimeTestPaths) {
      const migration = migrationByPath.get(testPath);
      expect(migration?.classification, `${testPath} must stay kept as service/store runtime coverage`).toBe('keep');
      expect(migration?.replacementGate, `${testPath} must close the runtime-resource gate`).toBe(runtimeResourceGate);
      expect(existsSync(path.join(repoRoot, testPath)), `${testPath} is missing`).toBe(true);
    }

    const mediaObjectUrlTestSource = readRepoFile(runtimeTestPaths[0]);
    const runtimeCoordinatorTestSource = readRepoFile(runtimeTestPaths[1]);
    expect(mediaObjectUrlTestSource).toContain('../../src/services/project/mediaObjectUrlManager');
    expect(mediaObjectUrlTestSource).not.toContain('../../src/timeline');
    expect(runtimeCoordinatorTestSource).toContain('../../src/services/timeline/runtimeProviderDemandBridge');
    expect(runtimeCoordinatorTestSource).toContain('../../src/services/timeline/timelineRuntimeCoordinator');
    expect(runtimeCoordinatorTestSource).toContain('../../src/services/timeline/nativeDecoderRuntimeRegistry');
    expect(runtimeCoordinatorTestSource).toContain('../../src/timeline');

    const forbiddenKernelRuntimeImports = [
      'src/services/project/mediaObjectUrlManager',
      'src/services/timeline/runtimeProviderDemandBridge',
      'src/services/timeline/timelineRuntimeCoordinator',
      'src/services/timeline/nativeDecoderRuntimeRegistry',
      'src/stores/timeline/helpers/blobUrlManager',
    ];
    for (const filePath of sourceFilesUnder(srcTimelineRoot)) {
      for (const specifier of importedSpecifiers(readFileSync(filePath, 'utf8'))) {
        const normalized = specifier.startsWith('.')
          ? resolveRelativeImport(filePath, specifier)
          : specifier.replace(/^@\//, 'src/');
        for (const forbidden of forbiddenKernelRuntimeImports) {
          expect(normalized, `${toRepoPath(filePath)} imports runtime resource implementation ${specifier}`).not.toContain(forbidden);
        }
      }
    }
  });

  it('isolates kernel visual resource demand from the service visual-demand gate', () => {
    const kernelDemandPath = path.join(srcTimelineRoot, 'resources', 'TimelineVisualResourceDemand.ts');
    expect(existsSync(kernelDemandPath)).toBe(true);
    expect(readFileSync(kernelDemandPath, 'utf8')).toContain('TimelineVisualResourceDemand');

    const serviceDemandPath = path.join(repoRoot, 'src', 'services', 'timeline', 'timelineVisualDemand.ts');
    expect(existsSync(serviceDemandPath)).toBe(true);

    for (const filePath of sourceFilesUnder(srcTimelineRoot)) {
      const repoPath = toRepoPath(filePath);
      expect(repoPath.endsWith('timelineVisualDemand.ts'), `${repoPath} collides with service visual-demand naming`).toBe(false);
      expect(readFileSync(filePath, 'utf8')).not.toContain("services/timeline/timelineVisualDemand");
    }
  });

  it('keeps the removed passive DOM clip renderer deleted', () => {
    expect(existsSync(path.join(repoRoot, 'src', 'components', 'timeline', 'TimelineClip.tsx'))).toBe(false);
    expect(readRepoFile('docs/completed/architecture/Timeline-System-Refactor-Plan.md')).toContain('Do not restore `TimelineClip.tsx`');
  });
});
