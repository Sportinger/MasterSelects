import type { Locator } from '@playwright/test'

import { PHONE_ASSISTANT_TASKS } from '../../../src/components/mobileSkin/assistant/phoneAssistantTasks'
import { PHONE_ASSISTANT_TEST_IDS as ASSISTANT } from '../../../src/components/mobileSkin/assistant/phoneAssistantTestIds'
import { PHONE_CATALOG_COVERAGE_BY_AREA } from '../../../src/components/mobileSkin/catalog/phoneCatalogCoverage'
import { PHONE_CATALOG_ITEMS } from '../../../src/components/mobileSkin/catalog/phoneCatalogIds.generated'
import type { PhoneCatalogTarget } from '../../../src/components/mobileSkin/catalog/phoneCatalogTargets'
import { phoneActionTestId, type PhoneSheetId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_PANELS_TEST_IDS as PANELS } from '../../../src/components/mobileSkin/panels/phonePanelsTestIds'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { expect, IDS, tapAction, tapOn, test, type M1Session } from './m1Fixture'
import { entry, openAllTools, openPanelFromAllTools } from './m3PanelsFixture'

/**
 * M6 "Vollständigkeit", catalog coverage (PLAN.md section 5): the checked-in coverage table
 * (src/components/mobileSkin/catalog) says where every catalog id lives on the phone. This journey
 * samples one entry per kind of place and proves the place exists on a phone with real touch: the
 * toolbar action, the control inside its sheet, the desktop panel with content, the landscape editor,
 * the shell control, the assistant task (prompt typed in, not sent) and a greyed exception that
 * shows its reason on tap. Each case reads its target from the table, so a stale table fails here.
 */
test.describe.configure({ timeout: 180_000 })

function targetOf(id: string): PhoneCatalogTarget {
  const item = PHONE_CATALOG_ITEMS.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`${id} is not in the catalog`)
  const target = PHONE_CATALOG_COVERAGE_BY_AREA[item.area][id]
  if (!target) throw new Error(`${id} has no target in the coverage table`)
  return target
}

function byTestId(m1: M1Session, testId: string, select?: string): Locator {
  return m1.page.locator(`[data-testid="${testId}"]${select ?? ''}`).first()
}

/** Opens a sheet the way a person does: through its All tools entry. */
async function openSheetFromAllTools(m1: M1Session, sheetId: PhoneSheetId): Promise<void> {
  await openAllTools(m1)
  const row = entry(m1, `sheet:${sheetId}`)
  await expect(row, `All tools lists the ${sheetId} sheet`).toHaveCount(1)
  await tapOn(m1, row)
  await expect(m1.page.getByTestId(PANELS.allToolsSearch), 'All tools stayed open').toBeHidden()
  await expect(m1.sheet, `the ${sheetId} sheet did not open`).toBeVisible()
}

async function closeSheet(m1: M1Session): Promise<void> {
  const cancel = m1.page.getByTestId(IDS.sheetCancel)
  if (await cancel.isVisible()) await tapOn(m1, cancel)
  await expect(m1.sheet).toBeHidden()
}

test('coverage-action: INV-1/place-media opens from its root toolbar action @phone', async ({ m1 }) => {
  const target = targetOf('INV-1/place-media')
  expect(target.kind).toBe('action')
  if (target.kind !== 'action') return
  const button = m1.page.getByTestId(phoneActionTestId(target.id))
  await expect(button, 'the action is on the root toolbar').toBeVisible()
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  await tapAction(m1, phoneActionTestId(target.id))
  await expect(m1.page.getByTestId('phone-media-pick-visual'), 'the Media sheet shows its device picker').toBeVisible()
  await closeSheet(m1)
})

test('coverage-sheet: INV-6/themes-and-custom-colors is a control in the Settings sheet @phone', async ({ m1 }) => {
  const target = targetOf('INV-6/themes-and-custom-colors')
  expect(target.kind).toBe('sheet')
  if (target.kind !== 'sheet' || !target.testId) return
  await openSheetFromAllTools(m1, target.id)
  const control = byTestId(m1, target.testId)
  await control.scrollIntoViewIfNeeded()
  await expect(control, `${target.testId} is inside the ${target.id} sheet`).toBeVisible()
  const light = m1.page.locator(`[data-testid="${target.testId}"][data-theme="light"]`)
  await tapOn(m1, light)
  await expect(light, 'a tapped theme chip becomes the chosen one').toHaveAttribute('aria-pressed', 'true')
  await closeSheet(m1)
})

test('coverage-panel: INV-6/undo-redo-history opens its desktop panel with content @phone', async ({ m1 }) => {
  const target = targetOf('INV-6/undo-redo-history')
  expect(target.kind).toBe('panel')
  if (target.kind !== 'panel') return
  await openAllTools(m1)
  await openPanelFromAllTools(m1, target.type)
  await closeSheet(m1)
})

test('coverage-workspace: INV-1/curve-editors opens its landscape editor @phone', async ({ m1 }) => {
  const target = targetOf('INV-1/curve-editors')
  expect(target.kind).toBe('workspace')
  if (target.kind !== 'workspace') return
  await tapAction(m1, phoneActionTestId('editors'))
  await expect(m1.sheet, 'the editors list did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${WS.editorRow}-${target.id}`))
  const root = m1.page.getByTestId(WS.root)
  await expect(root, 'the landscape editor did not open').toHaveAttribute('data-workspace', target.id)
  await expect(m1.page.getByTestId(WS.main)).toBeVisible()
  await tapOn(m1, m1.page.getByTestId(WS.back))
  await expect(root).toBeHidden()
})

test('coverage-shell: INV-1/composition-tabs-navigation is a shell control @phone', async ({ m1 }) => {
  const target = targetOf('INV-1/composition-tabs-navigation')
  expect(target.kind).toBe('shell')
  if (target.kind !== 'shell') return
  const tabs = byTestId(m1, target.testId)
  await expect(tabs, 'the composition tabs are on screen').toBeVisible()
  await expect(tabs.getByRole('tab').first(), 'the active composition has a tab').toBeVisible()
})

test('coverage-assistant: INV-1/assistant-timeline-editing is an assistant task with its prompt typed in @phone', async ({ m1 }) => {
  const id = 'INV-1/assistant-timeline-editing'
  expect(targetOf(id).kind).toBe('assistant')
  const task = PHONE_ASSISTANT_TASKS.find((candidate) => candidate.catalogId === id)
  expect(task, 'the assistant task list names this id').toBeTruthy()
  if (!task) return
  await openAllTools(m1)
  const row = entry(m1, `assistant:${id}`)
  await expect(row, 'All tools lists the assistant task').toHaveCount(1)
  await tapOn(m1, row)
  await expect(m1.page.getByTestId(ASSISTANT.root), 'the assistant did not open').toBeVisible()
  await expect(m1.page.getByTestId(ASSISTANT.prompt), 'the task is typed in, not sent').toHaveValue(task.prompt)
  await closeSheet(m1)
})

test('coverage-exception: INV-6/keyboard-shortcuts stays visible, greyed, and explains itself @phone', async ({ m1 }) => {
  const target = targetOf('INV-6/keyboard-shortcuts')
  expect(target.kind).toBe('exception')
  if (target.kind !== 'exception' || !target.sheet) return
  await openSheetFromAllTools(m1, target.sheet)
  const control = byTestId(m1, target.testId, target.select)
  await control.scrollIntoViewIfNeeded()
  await expect(control, 'the greyed control is visible in its place').toBeVisible()
  await expect(control).toHaveAttribute('aria-disabled', 'true')
  await tapOn(m1, control)
  const notice = m1.page.getByTestId(IDS.unavailableNotice)
  await expect(notice, 'tapping explains why').toContainText(target.reason)
  await tapOn(m1, notice.getByRole('button', { name: 'OK' }))
  await expect(notice).toBeHidden()
  await closeSheet(m1)
})
