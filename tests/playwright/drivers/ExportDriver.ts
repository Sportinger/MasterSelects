import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type Download, type Locator, type Page } from '@playwright/test';

export class ExportDriver {
  readonly panel: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.getByRole('region', { name: 'Export' });
  }

  async open(): Promise<void> {
    await this.ensureOpen();
  }

  async selectFastWebCodecs(): Promise<void> {
    await this.dismissWhatsNewDialog();
    const method = this.panel.getByRole('button', {
      name: 'Use WebCodecs Fast export',
      exact: true,
    });
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.ensureOpen();
      try {
        await method.click({ timeout: 2_000 });
        await this.ensureOpen();
        await expect(method).toHaveClass(/is-active/);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not select the visible WebCodecs Fast export workflow.');
  }

  async selectPreciseHtmlVideo(): Promise<void> {
    await this.ensureOpen();
    await this.dismissWhatsNewDialog();
    const method = this.panel.getByRole('button', { name: 'HTMLVideo', exact: true });
    await method.click();
    await expect(method).toHaveClass(/is-active/);
  }

  async useCompositionSettings(): Promise<void> {
    await this.ensureOpen();
    await this.dismissWhatsNewDialog();
    const syncButton = this.panel.getByRole('button', {
      name: 'Use composition resolution and frame rate',
      exact: true,
    });
    if (await syncButton.isVisible()) {
      await syncButton.click();
    }
    await expect(this.panel.getByRole('button', {
      name: 'Same as composition',
      exact: true,
    })).toBeVisible();
  }

  async setFilename(filename: string): Promise<void> {
    await this.ensureOpen();
    await this.dismissWhatsNewDialog();
    const input = this.panel.getByRole('textbox', { name: 'Name', exact: true });
    await expect(input).toBeVisible();
    await input.fill(filename);
    await expect(input).toHaveValue(filename);
  }

  async useInOutMarkers(): Promise<void> {
    await this.ensureOpen();
    await this.dismissWhatsNewDialog();
    const button = this.panel.getByRole('button', { name: 'Use In/Out', exact: true });
    await expect(button).toBeVisible();
    if (!await button.getAttribute('class').then((value) => value?.includes('is-active'))) {
      await button.click();
    }
    await expect(button).toHaveClass(/is-active/);
  }

  async exportTo(destination: string, timeout = 120_000): Promise<Download> {
    await this.ensureOpen();
    await this.dismissWhatsNewDialog();
    await mkdir(dirname(destination), { recursive: true });
    const exportButton = this.panel.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeEnabled();

    const downloadPromise = this.page.waitForEvent('download', { timeout })
      .then((download) => ({ kind: 'download' as const, download }));
    const productError = this.panel.getByRole('alert');
    const productErrorPromise = productError.waitFor({ state: 'visible', timeout })
      .then(async () => ({
        kind: 'product-error' as const,
        message: (await productError.innerText()).trim() || 'Unknown export error',
      }))
      // A successful export leaves this waiter behind. Convert its eventual
      // timeout into a forever-pending promise so it cannot become unhandled.
      .catch(() => new Promise<never>(() => {}));
    await exportButton.click();
    const result = await Promise.race([downloadPromise, productErrorPromise]);
    if (result.kind === 'product-error') {
      throw new Error(`Product export failed before download: ${result.message}`);
    }
    const { download } = result;
    await download.saveAs(destination);

    const failure = await download.failure();
    if (failure) {
      throw new Error(`Browser download failed: ${failure}`);
    }
    await expect(this.panel).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
    return download;
  }

  private async ensureOpen(): Promise<void> {
    await this.dismissWhatsNewDialog();
    if (await this.panel.isVisible()) return;

    const tab = this.page.getByRole('tab', { name: 'Export', exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(this.panel).toBeVisible();
  }

  private async dismissWhatsNewDialog(): Promise<void> {
    const dialog = this.page.locator('.changelog-dialog');
    if (!await dialog.isVisible()) return;

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}
