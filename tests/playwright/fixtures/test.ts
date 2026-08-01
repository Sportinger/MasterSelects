import { test as base, expect } from '@playwright/test'
import { BridgeClient } from './bridgeClient'
import { EditorPage, createEditorTabId } from './editorPage'
import { FailureEvidenceCollector } from './failureEvidence'
import { IsolatedProjectFixture } from './isolatedProject'
import { ReferenceProjectFixture } from './referenceProject'
import {
  createReferenceMediaFixture,
  createTrackedMediaFixture,
  type ReferenceMediaFixture,
  type TrackedMediaFixture,
} from './mediaFixture'

export interface MasterSelectsFixtures {
  bridge: BridgeClient
  editorPage: EditorPage
  failureEvidence: FailureEvidenceCollector
  isolatedProject: IsolatedProjectFixture
  referenceMedia: ReferenceMediaFixture
  referenceProject: ReferenceProjectFixture
  trackedMedia: TrackedMediaFixture
}

export const test = base.extend<MasterSelectsFixtures>({
  failureEvidence: async ({ page }, provide, testInfo) => {
    const collector = new FailureEvidenceCollector(page, testInfo)
    await provide(collector)
    await collector.finish()
  },

  editorPage: [async ({ page, baseURL, failureEvidence }, provide, testInfo) => {
    if (!baseURL) {
      throw new Error('Playwright baseURL must be configured for the MasterSelects editor fixture')
    }
    const tabId = createEditorTabId(testInfo)
    // Register the exact client before navigation so bootstrap failures can
    // still attempt bridge-side failure evidence for this tab only.
    failureEvidence.setBridge(new BridgeClient({ baseURL, targetTabId: tabId }))
    const editor = await EditorPage.bootstrap(page, {
      baseURL,
      tabId,
    })
    failureEvidence.setBridge(editor.bridge)
    await provide(editor)
  }, { auto: true }],

  bridge: async ({ editorPage }, provide) => {
    await provide(editorPage.bridge)
  },

  trackedMedia: async ({ browserName: _browserName }, provide) => {
    await provide(await createTrackedMediaFixture())
  },

  referenceMedia: async ({ browserName: _browserName }, provide) => {
    await provide(await createReferenceMediaFixture())
  },

  referenceProject: async ({ bridge, referenceMedia }, provide, testInfo) => {
    await provide(new ReferenceProjectFixture(bridge, referenceMedia, testInfo))
  },

  isolatedProject: async ({ bridge, trackedMedia }, provide, testInfo) => {
    await provide(new IsolatedProjectFixture(bridge, trackedMedia, testInfo))
  },
})

export { expect }
export type { BridgeToolResult } from './bridgeClient'
export type { StressFixtureOptions, StressTestProjectData } from './isolatedProject'
export type { MaskReferenceProjectData, NestedSuperProjectData } from './referenceProject'
export type { ReferenceMediaFixture, TrackedMediaFixture } from './mediaFixture'
