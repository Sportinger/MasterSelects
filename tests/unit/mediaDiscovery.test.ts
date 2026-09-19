import { describe, expect, it, vi } from 'vitest';
import { PANEL_CONFIGS } from '../../src/types/dock';
import { convertMediaFiles } from '../../src/services/project/projectMediaSerialization';
import { downloadDiscoveredAsset } from '../../src/services/mediaDiscovery/download';
import { parseImgflipTemplates } from '../../src/services/mediaDiscovery/imgflip';
import { parseMemegenTemplates } from '../../src/services/mediaDiscovery/memegen';
import { parseOpenverseResults, searchOpenverse } from '../../src/services/mediaDiscovery/openverse';
import { plainExternalText } from '../../src/services/mediaDiscovery/text';
import {
  parseYouTubeDiscoveryResults,
  searchYouTubeVideos,
} from '../../src/services/mediaDiscovery/youtubeSearch';
import {
  parseWikimediaCommonsPages,
  searchWikimediaCommons,
} from '../../src/services/mediaDiscovery/wikimediaCommons';
import type { MediaDiscoveryAsset } from '../../src/services/mediaDiscovery/types';
import { externalOriginForDownload } from '../../src/stores/mediaDownloadStore';
import {
  downloadFormatQueueLabel,
  recommendedFormatsForKind,
} from '../../src/services/mediaDiscovery/downloadFormats';

describe('media discovery', () => {
  it('registers Discover as a stable dock panel', () => {
    expect(PANEL_CONFIGS.discover).toMatchObject({
      type: 'discover',
      title: 'Discover',
      closable: false,
    });
  });

  it('turns Commons metadata into safe, attributable video results', () => {
    const results = parseWikimediaCommonsPages([{
      pageid: 42,
      title: 'File:Example.ogv',
      imageinfo: [{
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.ogv',
        url: 'https://upload.wikimedia.org/example.ogv',
        thumburl: 'https://upload.wikimedia.org/example.jpg',
        mime: 'application/ogg',
        size: 1234,
        extmetadata: {
          Artist: { value: '<a href="https://example.test">Ada &amp; Co.</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        },
      }],
    }], 'video');

    expect(results).toEqual([expect.objectContaining({
      creator: 'Ada & Co.',
      kind: 'video',
      licenseName: 'CC BY-SA 4.0',
      mimeType: 'video/ogg',
      provider: 'wikimedia-commons',
    })]);
  });

  it('keeps Openverse to the allowed licenses and rejects insecure asset links', () => {
    const results = parseOpenverseResults([
      {
        id: 'safe',
        title: 'Bell',
        creator: 'Sam',
        url: 'https://cdn.example.test/bell.mp3',
        foreign_landing_url: 'https://example.test/bell',
        license: 'by',
        license_version: '4.0',
        license_url: 'https://creativecommons.org/licenses/by/4.0/',
        filetype: 'mp3',
      },
      {
        id: 'insecure',
        title: 'Blocked',
        url: 'http://example.test/file.mp3',
        foreign_landing_url: 'https://example.test/blocked',
        license: 'cc0',
      },
    ], 'audio');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ licenseName: 'CC BY 4.0', mimeType: 'audio/mpeg' });
  });

  it('downloads directly and fixes generic Ogg MIME types before import', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sound', {
      headers: { 'Content-Type': 'application/ogg' },
    })));
    const asset: MediaDiscoveryAsset = {
      id: 'sound',
      provider: 'wikimedia-commons',
      providerLabel: 'Wikimedia Commons',
      kind: 'audio',
      title: 'Crowd reaction.oga',
      downloadUrl: 'https://upload.wikimedia.org/sound.oga',
      sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Sound.oga',
      licenseName: 'CC0',
      rightsStatus: 'open-license',
    };

    const file = await downloadDiscoveredAsset(asset);

    expect(file.name).toBe('Crowd reaction.ogg');
    expect(file.type).toBe('audio/ogg');
    vi.unstubAllGlobals();
  });

  it('strips remote HTML without trusting malformed numeric entities', () => {
    expect(plainExternalText('<b>Hello</b> &amp; goodbye &#99999999;')).toBe(
      'Hello & goodbye &#99999999;',
    );
  });

  it('finds Memegen templates and keeps Know Your Meme as a context link only', () => {
    const results = parseMemegenTemplates([{
      id: 'drake',
      name: 'Drake Hotline Bling',
      blank: 'https://api.memegen.link/images/drake.jpg',
      source: 'https://knowyourmeme.com/memes/drake-hotline-bling',
      keywords: ['drakeposting'],
      _self: 'https://api.memegen.link/templates/drake',
    }], 'drake');

    expect(results).toEqual([expect.objectContaining({
      contextUrl: 'https://knowyourmeme.com/memes/drake-hotline-bling',
      mimeType: 'image/jpeg',
      provider: 'memegen',
      rightsStatus: 'rights-unverified',
      sourcePageUrl: 'https://api.memegen.link/templates/drake',
    })]);
  });

  it('turns matching Imgflip catalog entries into clearly unverified templates', () => {
    const results = parseImgflipTemplates([{
      id: '181913649',
      name: 'Drake Hotline Bling',
      url: 'https://i.imgflip.com/30b1gx.jpg',
      width: 1200,
      height: 1200,
    }], 'drake');

    expect(results).toEqual([expect.objectContaining({
      provider: 'imgflip',
      rightsStatus: 'rights-unverified',
      sourcePageUrl: 'https://imgflip.com/memetemplate/181913649',
    })]);
  });

  it('sends an exact GIF filter to both open-license providers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      query: { pages: [] },
      results: [],
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await searchWikimediaCommons('reaction', 'image', undefined, 'gifs');
    await searchOpenverse('reaction', 'image', undefined, 'gifs');

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('filemime%3Aimage%2Fgif');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('extension=gif');
    vi.unstubAllGlobals();
  });

  it('persists source and license attribution with project media', () => {
    const externalOrigin = {
      provider: 'openverse' as const,
      providerLabel: 'Openverse',
      assetId: 'asset-1',
      sourcePageUrl: 'https://example.test/source',
      originalUrl: 'https://cdn.example.test/image.jpg',
      creator: 'Ada',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      rightsStatus: 'open-license' as const,
      retrievedAt: '2026-08-19T18:00:00.000Z',
    };

    const [projectMedia] = convertMediaFiles([{
      id: 'media-1',
      name: 'image.jpg',
      type: 'image',
      parentId: null,
      createdAt: 1,
      url: 'blob:local',
      externalOrigin,
    }]);

    expect(projectMedia.externalOrigin).toEqual(externalOrigin);
    expect(projectMedia.externalOrigin).not.toBe(externalOrigin);
  });

  it('maps YouTube search results into selectable Native Helper URLs', () => {
    const results = parseYouTubeDiscoveryResults([{
      id: { videoId: 'abcdefghijk' },
      snippet: {
        title: 'Reaction &amp; applause',
        channelTitle: 'Example Channel',
        publishedAt: '2026-08-19T12:00:00Z',
        thumbnails: { medium: { url: 'https://i.ytimg.com/example.jpg' } },
      },
    }], [{
      id: 'abcdefghijk',
      contentDetails: { duration: 'PT1M23S' },
      statistics: { viewCount: '1250000' },
    }]);

    expect(results).toEqual([expect.objectContaining({
      title: 'Reaction & applause',
      duration: '1:23',
      viewCount: '1.3M views',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    })]);
  });

  it('searches YouTube directly from the browser without a MasterSelects download server', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: { videoId: 'abcdefghijk' },
          snippet: { title: 'Result', channelTitle: 'Channel', thumbnails: {} },
        }],
      }), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: 'abcdefghijk', contentDetails: { duration: 'PT5S' } }],
      }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchYouTubeVideos('reaction', 'user-api-key');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('googleapis.com/youtube/v3/search');
    expect(results[0]?.url).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    vi.unstubAllGlobals();
  });

  it('retains the selected social URL as unverified provenance after local import', () => {
    const origin = externalOriginForDownload({
      url: 'https://www.tiktok.com/@example/video/123',
      downloadKey: 'url-123',
      title: 'Reaction',
      thumbnail: '',
      channel: '@example',
      platform: 'tiktok',
      durationSeconds: 4,
    });

    expect(origin).toMatchObject({
      provider: 'tiktok',
      providerLabel: 'TikTok',
      sourcePageUrl: 'https://www.tiktok.com/@example/video/123',
      rightsStatus: 'rights-unverified',
    });
  });

  it('shows resolution tiles for video and audio-only choices for audio', () => {
    const formats = [{
      id: '137',
      label: '1080p H.264',
      resolution: '1080p',
      vcodec: 'avc1.640028',
      acodec: null,
      needsMerge: true,
    }, {
      id: '__masterselects_audio_mp3',
      label: 'MP3 audio',
      resolution: 'Audio',
      vcodec: null,
      acodec: 'MP3',
      needsMerge: false,
    }];

    expect(recommendedFormatsForKind(formats, 'video').map((format) => format.id)).toEqual(['137']);
    expect(recommendedFormatsForKind(formats, 'audio').map((format) => format.id)).toEqual([
      '__masterselects_audio_mp3',
    ]);
    expect(downloadFormatQueueLabel(formats[0]!)).toBe('1080p / H.264 / M4A audio');
  });
});
