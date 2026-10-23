import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test';
import { ExportDriver } from '../drivers/ExportDriver';
import { inspectMediaArtifact } from '../assertions/mediaArtifactAssertions';

// A 48-minute stereo m4a at 44.1 kHz, cut into five pieces in the first two minutes, exported
// through the Export panel: the In/Out range as WAV and MP3, and the full timeline as WAV. The
// full export holds the decoded source next to its 48 kHz pieces (~2.1 GB of PCM), which the
// export memory budget once refused ("Export audio processed-buffer denied by runtime admission
// ... budget-exceeded").
// The source is generated with ffmpeg; MASTERSELECTS_LONG_AUDIO_FIXTURE uses a real file instead.
const SOURCE_SECONDS = 2861.35;
const CUTS = [20, 45, 70, 100];
const OUT_POINT = 124.35;

function longAudioFixture(): string {
  const own = process.env.MASTERSELECTS_LONG_AUDIO_FIXTURE?.trim();
  if (own) return path.resolve(own);
  const file = path.resolve('test-results/playwright/fixtures/long-source-48min-44k.m4a');
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${SOURCE_SECONDS}`,
      '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:duration=${SOURCE_SECONDS}`,
      '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', '-c:a', 'aac', '-b:a', '96k', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ffmpeg could not make the long audio fixture: ${result.stderr || result.error?.message}`);
  }
  return file;
}

interface TimelineState {
  duration: number;
  audioTracks: Array<{ id: string; clips: Array<{ id: string; startTime: number }> }>;
}

test.describe.configure({ timeout: 360_000 });

const CASES = [
  { container: '.wav', range: 'in-out' },
  { container: '.mp3', range: 'in-out' },
  { container: '.wav', range: 'full' },
] as const;

for (const { container, range } of CASES) {
  test(`exports ${container} of the ${range === 'full' ? 'full timeline' : 'In/Out range'} from a 48-minute audio source @module:audio @module:export`, async ({ page, bridge }, testInfo) => {
    const source = longAudioFixture();
    await mkdir(testInfo.outputDir, { recursive: true });

    await test.step('import the long source onto the timeline and cut five pieces', async () => {
      await bridge.toolData('importLocalFiles', { paths: [source.replaceAll('\\', '/')], addToTimeline: true, startTime: 0 }, { timeoutMs: 120_000 });
      const audioClipId = async () => {
        const state = await bridge.toolData<TimelineState>('getTimelineState');
        return state.audioTracks.flatMap(track => track.clips).find(clip => clip.startTime === 0)?.id;
      };
      await expect.poll(audioClipId, { timeout: 60_000 }).toBeTruthy();
      await bridge.toolData('splitClipAtTimes', { clipId: await audioClipId(), times: [...CUTS, OUT_POINT] });
      await bridge.toolData('setInOutPoints', { inPoint: 0, outPoint: OUT_POINT });
    });

    const exporter = new ExportDriver(page);
    const destination = path.join(testInfo.outputDir, `long-source${container}`);
    await test.step(`export ${container} through the Export panel`, async () => {
      await exporter.open();
      await exporter.selectContainer(container);
      if (range === 'full') await exporter.useFullTimeline();
      else await exporter.useInOutMarkers();
      await exporter.exportTo(destination, 300_000);
    });

    await test.step('the file holds the exported range as stereo audio', async () => {
      const seconds = range === 'full' ? (await bridge.toolData<TimelineState>('getTimelineState')).duration : OUT_POINT;
      const artifact = await inspectMediaArtifact(destination);
      expect(artifact.audioTracks.length).toBe(1);
      expect(artifact.audioTracks[0].channels).toBe(2);
      expect(artifact.durationSeconds).toBeGreaterThan(seconds - 0.2);
      expect(artifact.durationSeconds).toBeLessThan(seconds + 0.2);
      if (container === '.wav') expect(artifact.sizeBytes).toBeGreaterThan(seconds * 48_000 * 2 * 2 * 0.99);
    });
  });
}
