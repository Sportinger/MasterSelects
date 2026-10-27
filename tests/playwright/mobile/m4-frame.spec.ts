import type { Page } from '@playwright/test'
import { phoneActionTestId } from '../../../src/components/mobileSkin/contracts'
import { PHONE_WORKSPACES, type PhoneWorkspaceId } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog'
import { PHONE_WORKSPACE_TEST_IDS as WS } from '../../../src/components/mobileSkin/workspace/phoneWorkspaceTestIds'
import { ensureEditor, expect, tapOn, test, type M1Session } from './m1Fixture'

/**
 * M4 packet R1, the landscape editor frame (PhoneWorkspace): every editor in PHONE_WORKSPACES opens
 * from the Editors sheet and closes again (Back button and the browser's back gesture), side panels
 * open on their own only when there is room, collapse and expand by toggle, rail and edge swipe, and
 * the person's choice survives a reload (owner rule 3). All actions are real touch (CDP); the store is
 * read through the frame's data attributes and the phone UI store state they mirror.
 */
test.describe.configure({ timeout: 180_000 })

const EDITORS_ACTION = phoneActionTestId('editors')

async function landscape(page: Page): Promise<() => Promise<void>> {
  const size = page.viewportSize()
  if (!size) throw new Error('no viewport')
  await page.setViewportSize({ width: Math.max(size.width, size.height), height: Math.min(size.width, size.height) })
  return async () => { await page.setViewportSize(size) }
}

async function openEditor(m1: M1Session, id: PhoneWorkspaceId): Promise<void> {
  await tapOn(m1, m1.page.getByTestId(EDITORS_ACTION))
  await expect(m1.sheet, 'the Editors sheet did not open').toBeVisible()
  await tapOn(m1, m1.page.getByTestId(`${WS.editorRow}-${id}`))
  await expect(m1.page.getByTestId(WS.root), `the ${id} editor did not open`).toHaveAttribute('data-workspace', id)
  await expect(m1.sheet, 'the Editors sheet stays open over the editor').toBeHidden()
}

async function closeIfOpen(m1: M1Session): Promise<void> {
  const root = m1.page.getByTestId(WS.root)
  if (await root.isVisible()) {
    await tapOn(m1, m1.page.getByTestId(WS.back))
    await expect(root).toBeHidden()
  }
}

/** A one-finger swipe across `testId`'s box, from its centre by `dx` CSS pixels. */
async function swipe(m1: M1Session, testId: string, dx: number): Promise<void> {
  const box = await m1.page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`${testId} is not rendered`)
  await m1.touch.pan({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: dx, y: 0 }, { steps: 8 })
}

test('every editor opens from the Editors sheet and closes with Back', async ({ m1 }) => {
  const { page } = m1
  for (const workspace of PHONE_WORKSPACES) {
    await openEditor(m1, workspace.id)
    await expect(page.getByTestId(WS.main), `${workspace.id}: the editor area is empty`).toBeVisible()
    // Portrait has no room for side panels: they start collapsed, each leaving its rail.
    if (workspace.left) await expect(page.getByTestId(WS.railLeft)).toBeVisible()
    if (workspace.right) await expect(page.getByTestId(WS.railRight)).toBeVisible()
    await tapOn(m1, page.getByTestId(WS.back))
    await expect(page.getByTestId(WS.root), `${workspace.id}: Back did not close the editor`).toBeHidden()
    await expect(m1.toolbar, `${workspace.id}: the timeline toolbar did not come back`).toBeVisible()
  }
})

test('the browser back gesture closes the editor and stays on /m', async ({ m1 }) => {
  const { page } = m1
  await openEditor(m1, 'mixer')
  const url = page.url()
  await page.evaluate(() => window.history.back())
  await expect(page.getByTestId(WS.root), 'the back gesture did not close the editor').toBeHidden()
  expect(new URL(page.url()).pathname, 'the back gesture left the phone editor').toBe(new URL(url).pathname)
  await expect(m1.toolbar).toBeVisible()
  // The Back button after a gesture-free open must not leave a stale history entry that re-closes later.
  await openEditor(m1, 'mixer')
  await tapOn(m1, page.getByTestId(WS.back))
  await expect(page.getByTestId(WS.root)).toBeHidden()
  await openEditor(m1, 'curves')
  await page.getByTestId(WS.main).boundingBox()
  await expect(page.getByTestId(WS.root), 'a stale history entry closed the next editor').toHaveAttribute('data-workspace', 'curves')
  await closeIfOpen(m1)
})

test('side panels collapse and expand by toggle, rail and swipe, and keep that after a reload', async ({ m1 }) => {
  const { page } = m1
  await page.evaluate(() => window.localStorage.removeItem('ms.phoneWorkspace.collapsed'))
  const restore = await landscape(page)
  try {
    await openEditor(m1, 'nodes')
    const root = page.getByTestId(WS.root)
    // Landscape on a phone has room: both sides start open, the editor keeps its width.
    await expect(root).toHaveAttribute('data-left', 'open')
    await expect(root).toHaveAttribute('data-right', 'open')
    const mainOpen = (await page.getByTestId(WS.main).boundingBox())!.width
    expect(mainOpen, 'the editor in the middle is too narrow next to both side panels').toBeGreaterThanOrEqual(300)

    // Toggle in the bar hides the left side; the editor grows and a rail is left.
    await tapOn(m1, page.getByTestId(WS.toggleLeft))
    await expect(root).toHaveAttribute('data-left', 'collapsed')
    await expect(page.getByTestId(WS.sideLeft)).toHaveCount(0)
    await expect(page.getByTestId(WS.railLeft)).toBeVisible()
    await expect.poll(async () => (await page.getByTestId(WS.main).boundingBox())!.width, { message: 'the editor did not grow' }).toBeGreaterThan(mainOpen + 100)

    // Swipe inward on the rail opens it again; swipe outward on the grip closes it.
    await swipe(m1, WS.railLeft, 60)
    await expect(root).toHaveAttribute('data-left', 'open')
    await swipe(m1, WS.gripLeft, -60)
    await expect(root).toHaveAttribute('data-left', 'collapsed')
    // A tap on the right grip closes the right side, a tap on its rail would open it.
    await tapOn(m1, page.getByTestId(WS.gripRight))
    await expect(root).toHaveAttribute('data-right', 'collapsed')
    await tapOn(m1, page.getByTestId(WS.railRight))
    await expect(root).toHaveAttribute('data-right', 'open')

    // Left collapsed, right open: reload and reopen the same editor.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await ensureEditor(m1)
    await openEditor(m1, 'nodes')
    await expect(root, 'the collapsed left side opened again after the reload').toHaveAttribute('data-left', 'collapsed')
    await expect(root, 'the open right side closed after the reload').toHaveAttribute('data-right', 'open')

    // The choice is per editor: the mixer was never touched and opens with both sides.
    await tapOn(m1, page.getByTestId(WS.back))
    await openEditor(m1, 'mixer')
    await expect(root).toHaveAttribute('data-left', 'open')
    await expect(root).toHaveAttribute('data-right', 'open')

    // Rotating while open: an untouched editor follows the room, a stored choice stays.
    await restore()
    await expect(root, 'the untouched mixer kept its side panels open in portrait').toHaveAttribute('data-left', 'collapsed')
    await expect(root).toHaveAttribute('data-right', 'collapsed')
    await expect(page.getByTestId(WS.main)).toBeVisible()
    await closeIfOpen(m1)
  } finally {
    await restore()
    await closeIfOpen(m1).catch(() => undefined)
  }
})
