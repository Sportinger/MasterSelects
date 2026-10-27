import { expect, IDS, tapOn, test } from './m1Fixture'

/**
 * Assistant beta on the phone: the top bar opens the editor's own chat in a tall sheet while the
 * preview stays visible. A real chat run needs a signed-in session with credits and the kernel; it is
 * checked in the running editor (AGENTS.md section 5), not in this headless journey.
 */
test('the assistant beta opens the chat composer in a sheet and closes again @phone', async ({ m1 }) => {
  const { page } = m1
  await tapOn(m1, page.getByTestId('phone-topbar-assistant'))
  await expect(m1.sheet, 'the assistant sheet did not open').toBeVisible()
  const assistant = page.getByTestId('phone-assistant')
  await expect(assistant).toBeVisible()
  await expect(assistant.locator('textarea').first(), 'the chat composer has no prompt field').toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(IDS.previewRegion), 'the preview must stay visible above the sheet').toBeVisible()
  await tapOn(m1, page.getByTestId(IDS.sheetCancel))
  await expect(m1.sheet, 'Close did not close the assistant sheet').toBeHidden()
})
