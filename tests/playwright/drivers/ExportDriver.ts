import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { isExistingPage } from '../beta/existingPlayer';
import { observeExistingExportAlert } from '../beta/existingExportAlert';

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
    await this.selectMethod('WebCodecs Fast');
  }

  async selectPreciseHtmlVideo(): Promise<void> {
    await this.selectMethod('HTMLVideo Precise');
  }

  async useCompositionSettings(): Promise<void> {
    await this.ensureOpen();
    const syncCheckbox = this.panel.getByRole('checkbox', {
      name: 'Same as composition',
      exact: true,
    });
    await expect(syncCheckbox).toBeVisible();
    if (!await syncCheckbox.isChecked()) {
      await syncCheckbox.check();
    }
    await expect(syncCheckbox).toBeChecked();
  }

  async setFilename(filename: string): Promise<void> {
    await this.ensureOpen();
    const input = this.panel.getByRole('textbox', { name: 'Output name', exact: true });
    await expect(input).toBeVisible();
    await input.fill(filename);
    await expect(input).toHaveValue(filename);
  }

  async useInOutMarkers(): Promise<void> {
    await this.ensureOpen();
    const section = this.panel.getByRole('button', { name: 'Range & Summary', exact: true });
    await expect(section).toBeVisible();
    if (await section.getAttribute('aria-expanded') !== 'true') {
      await section.click();
    }
    const range = this.panel.getByRole('combobox', { name: 'Export range', exact: true });
    await expect(range).toBeVisible();
    await range.click();
    await this.page.getByRole('option', { name: 'In / Out markers', exact: true }).click();
    await expect(range).toContainText('In / Out markers');
  }

  async exportTo(destination: string, timeout = 120_000): Promise<Download> {
    await this.ensureOpen();
    await mkdir(dirname(destination), { recursive: true });
    const exportButton = this.panel.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeEnabled();

    const downloadPromise = this.page.waitForEvent('download', { timeout })
      .then((download) => ({ kind: 'download' as const, download }));
    const productError = this.panel.getByRole('alert');
    const retainedObserver = isExistingPage(this.page) ? observeExistingExportAlert(this.page, productError, timeout) : undefined;
    const productErrorPromise = retainedObserver?.promise ?? productError.waitFor({ state: 'visible', timeout })
      .then(async () => ({
        kind: 'product-error' as const,
        message: (await productError.innerText()).trim() || 'Unknown export error',
      }))
      // A successful export leaves this waiter behind. Convert its eventual
      // timeout into a forever-pending promise so it cannot become unhandled.
      .catch(() => new Promise<never>(() => {}));
    let download: Download;
    try {
      await exportButton.click();
      const result = await Promise.race([downloadPromise, productErrorPromise]);
      if (result.kind === 'product-error') {
        throw new Error(`Product export failed before download: ${result.message}`);
      }
      download = result.download;
      await download.saveAs(destination);

      const failure = await download.failure();
      if (failure) {
        throw new Error(`Browser download failed: ${failure}`);
      }
      await expect(this.panel).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 });
    } catch (error) {
      // Preserve the export failure if releasing the observer also fails.
      try { await retainedObserver?.stop(); }
      catch (cleanupError) { console.error('Export observer cleanup failed:', cleanupError); }
      throw error;
    }
    // Cleanup failure after a successful export must still fail the journey.
    await retainedObserver?.stop();
    return download;
  }

  private async ensureOpen(): Promise<void> {
    if (await this.panel.isVisible()) return;

    const tab = this.page.getByRole('tab', { name: 'Export', exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(this.panel).toBeVisible();
  }

  private async selectMethod(name: 'WebCodecs Fast' | 'HTMLVideo Precise'): Promise<void> {
    await this.ensureOpen();
    const method = this.panel.getByRole('combobox', { name: 'Export method', exact: true });
    await method.click();
    await this.page.getByRole('option', { name, exact: true }).click();
    await expect(method).toContainText(name);
  }
}
