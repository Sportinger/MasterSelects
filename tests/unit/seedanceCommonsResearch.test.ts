import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  importSelectedCommonsAsset,
  searchCommonsForRequirement,
} from '../../src/services/seedancePreproduction/commonsClient';
import {
  buildCommonsQueryVariants,
  isCommonsResultRelevant,
} from '../../src/services/seedancePreproduction/commonsSearchPlanning';

const mediaImportMocks = vi.hoisted(() => ({ importFile: vi.fn() }));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ importFile: mediaImportMocks.importFile }) },
}));

afterEach(() => {
  mediaImportMocks.importFile.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function commonsAsset() {
  return {
    creator: 'Bundesverfassungsgericht',
    credit: 'Wikimedia Commons',
    description: 'Bundesverfassungsgericht in Karlsruhe',
    height: 900,
    importToken: 'signed-token',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    mimeType: 'image/jpeg',
    originalUrl: 'https://upload.wikimedia.org/example.jpg',
    pageId: 42,
    retrievedAt: 1,
    revisionId: 7,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    thumbnailUrl: 'https://upload.wikimedia.org/example-thumb.jpg',
    title: 'Bundesverfassungsgericht Karlsruhe.jpg',
    width: 1600,
  };
}

describe('Seedance Commons research', () => {
  it('removes the Commons brand and creates bounded entity fallbacks', () => {
    expect(buildCommonsQueryVariants(
      'Wikimedia Commons Edgar Faure Pierre Mendès France René Coty 1954 portraits',
    )).toEqual([
      'Edgar Faure Pierre Mendès France René Coty 1954 portraits',
      'Edgar Faure Pierre Mendès France René Coty',
      'Edgar Faure',
      'Pierre Mendès France',
      'René Coty',
    ]);
  });

  it('retries an over-specific query with a simpler relevant variant', async () => {
    const requestedQueries: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      requestedQueries.push(body.query);
      return Response.json({
        results: body.query === 'Bundesverfassungsgericht Karlsruhe' ? [commonsAsset()] : [],
      });
    }));

    const result = await searchCommonsForRequirement({
      id: 'research-1',
      sceneId: 'scene-1',
      query: 'Wikimedia Commons Bundesverfassungsgericht Karlsruhe Gebäude 1960er 1966',
      purpose: 'Ground the location.',
    });

    expect(requestedQueries).toEqual([
      'Bundesverfassungsgericht Karlsruhe Gebäude 1960er 1966',
      'Bundesverfassungsgericht Karlsruhe',
    ]);
    expect(result.assets).toHaveLength(1);
    expect(result.diagnostic).toMatchObject({ status: 'matched', resultCount: 1 });
  });

  it('tries explicit asset-plan query alternatives before generated fallbacks', async () => {
    const requestedQueries: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      requestedQueries.push(body.query);
      return Response.json({
        results: body.query === 'Kassenzettel Mehrwertsteuer 2020' ? [{
          ...commonsAsset(),
          description: 'Kassenzettel mit ausgewiesener Mehrwertsteuer aus dem Jahr 2020',
          title: 'Kassenzettel Mehrwertsteuer 2020.jpg',
        }] : [],
      });
    }));

    const result = await searchCommonsForRequirement({
      id: 'asset-plan-001',
      assetNeedId: 'need-receipt',
      sceneId: 'scene-1',
      query: 'VAT receipt 2020',
      alternativeQueries: ['Kassenzettel Mehrwertsteuer 2020'],
      purpose: 'Show a contemporary VAT receipt.',
    });

    expect(requestedQueries).toEqual(['VAT receipt 2020', 'Kassenzettel Mehrwertsteuer 2020']);
    expect(result.assets).toHaveLength(1);
  });

  it('does not confuse separated first and last names with a portrait subject', () => {
    expect(isCommonsResultRelevant({
      creator: '',
      credit: '',
      description: 'A book by Maurice des Ombiaux',
      title: 'Portrait de Laure de Neuville.jpg',
    }, 'Wikimedia Commons Maurice LaurÃ© portrait', 'Maurice LaurÃ© portrait')).toBe(false);
  });

  it('does not retain a street named after a requested portrait subject', () => {
    expect(isCommonsResultRelevant({
      creator: '',
      credit: '',
      description: 'Street in Paris named after Edgar Faure',
      title: 'Rue Edgar Faure - Paris.jpg',
    }, 'Wikimedia Commons Edgar Faure portrait', 'Edgar Faure')).toBe(false);
  });

  it('retains failed request details instead of treating them as empty results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      Response.json({ error: 'Wikimedia unavailable.' }, { status: 502 })
    )));

    const result = await searchCommonsForRequirement({
      id: 'research-2',
      sceneId: 'scene-2',
      query: 'Wikimedia Commons Saturn',
      purpose: 'Ground the planet.',
    });

    expect(result.assets).toEqual([]);
    expect(result.diagnostic.status).toBe('failed');
    expect(result.diagnostic.attempts[0]).toMatchObject({
      query: 'Saturn',
      status: 'failed',
      error: 'Wikimedia unavailable.',
    });
  });

  it('retries one rate-limited request and keeps the recovered result', async () => {
    let requestCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Response.json({
          error: 'Wikimedia Commons is rate limiting searches.',
          retryAfterMs: 1,
        }, { status: 429 });
      }
      return Response.json({ results: [commonsAsset()] });
    }));

    const result = await searchCommonsForRequirement({
      id: 'research-rate-limit',
      sceneId: 'scene-rate-limit',
      query: 'Wikimedia Commons Bundesverfassungsgericht Karlsruhe',
      purpose: 'Ground the location.',
    });

    expect(requestCount).toBe(2);
    expect(result.assets).toHaveLength(1);
    expect(result.diagnostic.status).toBe('matched');
  });

  it('refreshes old import tokens and retries transient Commons gateway failures', async () => {
    const responses = [
      Response.json({ error: 'Temporary upstream failure.' }, { status: 502 }),
      Response.json({ importToken: 'fresh-token' }),
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? Response.error());
    vi.stubGlobal('fetch', fetchMock);
    mediaImportMocks.importFile.mockResolvedValue({ id: 'media-1' });

    const imported = await importSelectedCommonsAsset({
      ...commonsAsset(),
      id: 'commons-research-1-42',
      requirementId: 'research-1',
      sceneIds: ['scene-1'],
      selected: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/media/commons/refresh',
      '/api/media/commons/refresh',
      '/api/media/commons/download',
    ]);
    expect(imported).toMatchObject({ importToken: 'fresh-token', mediaFileId: 'media-1' });
  });
});
