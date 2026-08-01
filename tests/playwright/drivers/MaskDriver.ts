import { expect, type Locator, type Page } from '@playwright/test'

export class MaskDriver {
  readonly region: Locator
  readonly toolbar: Locator
  private readonly page: Page

  constructor(page: Page) {
    this.page = page
    this.region = page.getByRole('region', { name: 'Masks' })
    this.toolbar = this.region.getByRole('toolbar', { name: 'Mask tools' })
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: /^Masks\b/ }).click()
    await expect(this.region).toBeVisible()
    await expect(this.toolbar).toBeVisible()
  }

  async addRectangle(): Promise<void> {
    await this.toolbar.getByRole('button', { name: 'Add rectangle mask' }).click()
    await expect(this.region.getByRole('button', { name: /^Rectangle Mask\b/ })).toBeVisible()
  }

  async expectRectangleOverlay(): Promise<void> {
    const overlay = this.page.locator('svg.mask-overlay-svg')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('[data-guided-mask-vertex-index]')).toHaveCount(8)
    await expect(overlay.locator('rect.mask-vertex-point')).toHaveCount(4)
  }

  async addPathKeyframe(): Promise<void> {
    const toggle = this.region.locator('button[title^="Add Mask Path keyframe"]')
    await toggle.click()
    await expect(toggle).toHaveClass(/recording/)
    await expect(toggle).toHaveClass(/has-keyframes/)
  }

  async addFeatherKeyframe(): Promise<void> {
    const row = this.region.locator('.control-row').filter({ hasText: /^Feather/ }).first()
    const toggle = row.locator('button.keyframe-toggle')
    await expect(row).toBeVisible()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveClass(/recording/)
    await expect(toggle).toHaveClass(/has-keyframes/)
  }

  async dragActiveMaskBy(deltaX: number, deltaY: number): Promise<void> {
    const body = this.activeMaskBody()
    await expect(body).toBeVisible()
    const box = await body.boundingBox()
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error('Active mask body has no draggable bounding box.')
    }
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await this.page.mouse.move(startX, startY)
    await this.page.mouse.down()
    await this.page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 })
    await this.page.mouse.up()
  }

  async activeMaskBodyBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const body = this.activeMaskBody()
    await expect(body).toBeVisible()
    const box = await body.boundingBox()
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error('Active mask body has no visible bounding box.')
    }
    return box
  }

  async disableActiveMaskRender(maskName: string): Promise<void> {
    await this.activeCard(maskName).getByRole('button', { name: 'Disable render' }).click()
    await expect(
      this.activeCard(maskName).getByRole('button', { name: 'Enable render' }),
    ).toBeVisible()
  }

  async enableActiveMaskRender(maskName: string): Promise<void> {
    await this.activeCard(maskName).getByRole('button', { name: 'Enable render' }).click()
    await expect(
      this.activeCard(maskName).getByRole('button', { name: 'Disable render' }),
    ).toBeVisible()
  }

  async setFeather(maskName: string, value: number): Promise<void> {
    const label = `${maskName} feather`
    const display = this.region.locator(`[aria-label="${label}"]`).filter({ visible: true })
    await display.dblclick()
    const input = this.region.getByRole('textbox', { name: label })
    await expect(input).toBeVisible()
    await input.fill(String(value))
    await input.press('Enter')
  }

  async expectFeatherValue(maskName: string, value: number): Promise<void> {
    const display = this.region
      .locator(`[aria-label="${maskName} feather"]`)
      .filter({ visible: true })
    await expect(display).toContainText(String(value))
  }

  async toggleInvert(maskName: string): Promise<void> {
    await this.activeCard(maskName).getByRole('button', { name: /^Invert \(/ }).click()
  }

  private activeCard(maskName: string): Locator {
    return this.region.getByRole('group', { name: `Active mask ${maskName}` })
  }

  private activeMaskBody(): Locator {
    return this.page.locator('path[data-guided-mask-body]').filter({ visible: true })
  }
}
