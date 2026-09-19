const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const sourceRoot = path.resolve(process.env.MASTERSELECTS_TEST_SOURCE_ROOT || root);
function evaluate(file, requireMock) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(result.diagnostics.length, 0);
  const exports = {};
  vm.runInNewContext(result.outputText, { exports, require: requireMock }, { filename: file });
  return exports;
}
function loader(project, initialName = 'Untitled Project') {
  let state = { currentProjectName: initialName, files: [], compositions: [], openCompositionIds: [], slotAssignments: {}, slotClipSettings: {} };
  const noop = () => {};
  const identity = value => value;
  const stubs = {
    Logger: { create: () => ({ info: noop, warn: noop }) },
    useMediaStore: { getState: () => state, setState: patch => { state = { ...state, ...patch }; } },
    useTimelineStore: { getState: () => ({ clips: [] }) },
    useSeedancePreproductionStore: { getState: () => ({ hydrate: noop }) },
    withProjectStoreSyncGuard: callback => callback(),
    readProjectDataForLoad: () => project ? { projectData: project, hydrateFiles: false } : null,
    hydrateStoryboardProjectState: noop, readStoryboardProjectState: () => ({ state: {} }),
    parseSeedancePreproductionProjectState: identity,
    collectLegacyMediaArtifactSeeds: () => [], persistLegacyMediaArtifactSeeds: noop,
    applyLegacyMediaArtifactSeeds: identity,
    setProjectLoadProgress: noop, completeProjectLoadProgress: noop, failProjectLoadProgress: noop,
    liveInputRuntime: { clear: noop, setReconnectRequiredIds: noop },
    revokeMediaFileObjectUrls: noop, revokeAllMediaObjectUrls: noop,
    convertProjectMediaToStore: identity, normalizeFolderParents: identity,
    convertProjectFolderToStore: identity, normalizeItemFolderParents: identity,
    convertProjectCompositionToStore: identity, clearProjectTimelineForLoad: () => ({}),
    createGeneratedMediaItemsForLoad: () => ({}), createSignalHydrationStateForLoad: () => ({}),
    normalizeLoadedTransitionCompositions: noop, isUserVisibleComposition: () => true,
    hydrateActiveCompositionTimeline: noop, reconcileStoryboardTimelineClips: noop,
    hydrateDockFlashboardAndWorkspaceFromProject: noop, collectUsedLiveInputIds: () => [],
    runPostLoadRestoration: noop,
  };
  const module = evaluate(path.join(sourceRoot, 'src/services/project/projectLoad.ts'), () => stubs);
  return { run: module.loadProjectToStores, state: () => state };
}
const savedProjectName = 'Saved project';
function project(name = savedProjectName) {
  return { name, settings: { width: 1920, height: 1080, frameRate: 30 }, media: [{ id: 'media-preserved', name: 'fixture.mp4' }], folders: [], compositions: [{ id: 'comp-1' }], activeCompositionId: 'comp-1' };
}
test('reload restores the saved name from the initial Untitled Project store', async () => {
  const p = project(); const loaded = loader(p);
  await loaded.run();
  assert.equal(loaded.state().currentProjectName, p.name);
  assert.equal(loaded.state().files[0].id, 'media-preserved');
  assert.equal(loaded.state().activeCompositionId, 'comp-1');
});
test('opening another project replaces the previous store name', async () => {
  const loaded = loader(project('Second project'), 'First project');
  await loaded.run();
  assert.equal(loaded.state().currentProjectName, 'Second project');
});
test('missing project data leaves the current name unchanged', async () => {
  const loaded = loader(null, 'Keep this project');
  await loaded.run();
  assert.equal(loaded.state().currentProjectName, 'Keep this project');
});
