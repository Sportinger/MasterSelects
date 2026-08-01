import { expect, type Locator, type Page } from '@playwright/test';

export class PreviewDriver {
  readonly region: Locator;
  readonly canvas: Locator;

  constructor(page: Page) {
    this.region = page.getByRole('region', { name: 'Preview' });
    this.canvas = this.region.getByTestId('preview-canvas');
  }

  async expectReady(): Promise<void> {
    await expect(this.region).toBeVisible();
    await expect(this.canvas).toBeVisible();
    await expect.poll(async () => {
      const size = await this.canvas.evaluate((canvas: HTMLCanvasElement) => ({
        width: canvas.width,
        height: canvas.height,
      }));
      return size.width > 0 && size.height > 0;
    }, { message: 'Expected the composition preview canvas to have a render size.' }).toBe(true);
  }
}
