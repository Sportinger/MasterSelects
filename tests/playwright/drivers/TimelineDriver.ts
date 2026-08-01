import { expect, type Locator, type Page } from '@playwright/test';

export interface TimelineSnapshot {
  playheadPosition: number;
  duration: number;
}

export type ReadTimelineSnapshot = () => Promise<TimelineSnapshot>;

export class TimelineDriver {
  readonly ruler: Locator;
  readonly playhead: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.ruler = page.locator('[data-ai-id="timeline-ruler"]');
    this.playhead = page.locator('[data-ai-id="timeline-playhead"]');
  }

  async play(): Promise<void> {
    await this.page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  }

  async pause(): Promise<void> {
    await this.page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  }

  async stop(): Promise<void> {
    await this.page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  }

  async scrubToFraction(fraction: number, startFraction = 0.2): Promise<void> {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new Error(`Timeline scrub fraction must be between 0 and 1; received ${fraction}.`);
    }
    if (!Number.isFinite(startFraction) || startFraction < 0 || startFraction > 1) {
      throw new Error(
        `Timeline scrub start fraction must be between 0 and 1; received ${startFraction}.`,
      );
    }

    await expect(this.ruler).toBeVisible();
    const box = await this.ruler.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error('Timeline ruler has no interactive bounding box.');
    }

    const startX = box.x + Math.min(box.width - 1, Math.max(1, box.width * startFraction));
    const targetX = box.x + Math.min(box.width - 1, Math.max(1, box.width * fraction));
    const y = box.y + box.height / 2;
    await this.page.mouse.move(startX, y);
    await this.page.mouse.down();
    await this.page.mouse.move(targetX, y, { steps: 8 });
    await this.page.mouse.up();
  }

  async expectPlayheadAfter(
    readTimeline: ReadTimelineSnapshot,
    position: number,
    timeout = 10_000,
  ): Promise<void> {
    await expect.poll(
      async () => (await readTimeline()).playheadPosition,
      { timeout, message: `Expected playhead to advance beyond ${position.toFixed(3)}s.` },
    ).toBeGreaterThan(position);
  }

  async expectPlayheadNear(
    readTimeline: ReadTimelineSnapshot,
    position: number,
    tolerance = 0.08,
  ): Promise<void> {
    await expect.poll(
      async () => Math.abs((await readTimeline()).playheadPosition - position),
      { message: `Expected playhead near ${position.toFixed(3)}s.` },
    ).toBeLessThanOrEqual(tolerance);
  }

  async expectPausedPositionStable(
    readTimeline: ReadTimelineSnapshot,
    sampleWindowMs = 350,
    tolerance = 0.06,
  ): Promise<void> {
    const before = await readTimeline();
    await new Promise((resolve) => setTimeout(resolve, sampleWindowMs));
    const after = await readTimeline();
    expect(
      Math.abs(after.playheadPosition - before.playheadPosition),
      'Paused playhead moved during the stability sample window.',
    ).toBeLessThanOrEqual(tolerance);
  }

  async expandTrackPropertyWithKeyframes(
    trackId: string,
    property: string,
    expectedKeyframeCount: number,
  ): Promise<void> {
    const header = this.page.locator(`.track-header[data-track-reorder-id="${trackId}"]`);
    await expect(header).toBeVisible();
    const expand = header.locator('.track-expand-arrow');
    await expect(expand).toBeVisible();
    if (await expand.getAttribute('title') === 'Expand properties') {
      await expand.click();
    }

    const propertyRow = this.page.locator(
      `.keyframe-track-row[data-track-id="${trackId}"][data-keyframe-property="${property}"]`,
    );
    await expect(propertyRow).toBeVisible();
    await expect(propertyRow.locator('.keyframe-diamond')).toHaveCount(expectedKeyframeCount);
  }
}
