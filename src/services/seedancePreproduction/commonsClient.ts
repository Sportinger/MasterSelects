import { useMediaStore } from '../../stores/mediaStore';
import type {
  CommonsSourceAsset,
  SeedanceResearchDiagnostic,
  SeedanceResearchRequirement,
} from './contracts';
import {
  buildCommonsQueryVariants,
  isCommonsResultRelevant,
} from './commonsSearchPlanning';

type CommonsSearchResult = Omit<
  CommonsSourceAsset,
  'id' | 'requirementId' | 'sceneIds' | 'selected' | 'mediaFileId'
>;

interface CommonsSearchPayload {
  error?: string;
  results?: CommonsSearchResult[];
  retryAfterMs?: number;
}

const COMMONS_IMPORT_TOKEN_REFRESH_AGE_MS = 25 * 60 * 1_000;
const TRANSIENT_COMMONS_STATUSES = new Set([429, 502, 503, 504]);

export interface CommonsRequirementSearchResult {
  assets: CommonsSourceAsset[];
  diagnostic: SeedanceResearchDiagnostic;
}

function searchError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Wikimedia Commons search failed.')
    .slice(0, 300);
}

function waitForNextCommonsRequest(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(signal?.reason ?? new DOMException('Commons research stopped.', 'AbortError'));
    };
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

async function requestCommonsWithRetry(
  request: () => Promise<Response>,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    try {
      const response = await request();
      if (!TRANSIENT_COMMONS_STATUSES.has(response.status) || attempt === 2) return response;
    } catch (error) {
      if (signal?.aborted || attempt === 2) throw error;
    }
    await waitForNextCommonsRequest(250 * (2 ** attempt), signal);
  }
  throw new Error('Wikimedia Commons request failed.');
}

async function searchCommons(
  query: string,
  signal?: AbortSignal,
): Promise<CommonsSearchResult[]> {
  for (let requestAttempt = 0; requestAttempt < 2; requestAttempt += 1) {
    const response = await fetch('/api/media/commons/search', {
      body: JSON.stringify({ query, limit: 4 }),
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
    const payload = await response.json().catch(() => null) as CommonsSearchPayload | null;
    if (response.ok) return payload?.results ?? [];
    if (response.status === 429 && requestAttempt === 0) {
      const retryAfterMs = typeof payload?.retryAfterMs === 'number'
        ? Math.max(250, Math.min(5_000, payload.retryAfterMs))
        : 1_000;
      await waitForNextCommonsRequest(retryAfterMs, signal);
      continue;
    }
    throw new Error(payload?.error ?? 'Wikimedia Commons search failed.');
  }
  return [];
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/svg+xml') return '.svg';
  return '.jpg';
}

export async function searchCommonsForRequirement(
  requirement: SeedanceResearchRequirement,
  signal?: AbortSignal,
): Promise<CommonsRequirementSearchResult> {
  const attempts: SeedanceResearchDiagnostic['attempts'] = [];
  const assetsByPage = new Map<number, CommonsSourceAsset>();
  const primaryVariants = buildCommonsQueryVariants(requirement.query);
  const variants = [
    primaryVariants[0] ?? requirement.query,
    ...(requirement.alternativeQueries ?? []),
    ...primaryVariants.slice(1),
  ].filter((query, index, all) => (
    all.findIndex((candidate) => candidate.toLocaleLowerCase() === query.toLocaleLowerCase()) === index
  )).slice(0, 5);
  for (const query of variants) {
    signal?.throwIfAborted();
    try {
      const relevanceQuery = requirement.alternativeQueries?.includes(query)
        ? query
        : requirement.query;
      const results = (await searchCommons(query, signal)).filter((result) => (
        isCommonsResultRelevant(result, relevanceQuery, query)
      ));
      attempts.push({ query, status: 'succeeded', resultCount: results.length });
      for (const result of results) {
        if (assetsByPage.has(result.pageId)) continue;
        assetsByPage.set(result.pageId, {
          ...result,
          id: `commons-${requirement.id}-${result.pageId}`,
          requirementId: requirement.id,
          sceneIds: [requirement.sceneId],
          selected: true,
        });
      }
      if (assetsByPage.size > 0) break;
    } catch (error) {
      if (signal?.aborted) throw error;
      attempts.push({ query, status: 'failed', resultCount: 0, error: searchError(error) });
    }
    if (query !== variants.at(-1)) await waitForNextCommonsRequest(500, signal);
  }
  const assets = [...assetsByPage.values()];
  const allFailed = attempts.length > 0 && attempts.every((attempt) => attempt.status === 'failed');
  return {
    assets,
    diagnostic: {
      requirementId: requirement.id,
      sceneId: requirement.sceneId,
      requestedQuery: requirement.query,
      status: assets.length > 0 ? 'matched' : allFailed ? 'failed' : 'empty',
      resultCount: assets.length,
      attempts,
    },
  };
}

export async function importSelectedCommonsAsset(
  asset: CommonsSourceAsset,
  signal?: AbortSignal,
): Promise<CommonsSourceAsset> {
  if (asset.mediaFileId) return asset;
  const download = (token: string) => requestCommonsWithRetry(() => (
    fetch('/api/media/commons/download', {
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      headers: { Accept: 'image/*', 'Content-Type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  ), signal);
  const refreshImportToken = async () => {
    const refresh = await requestCommonsWithRetry(() => (
      fetch('/api/media/commons/refresh', {
        body: JSON.stringify({ pageId: asset.pageId }),
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
      })
    ), signal);
    const refreshed = await refresh.json().catch(() => null) as { error?: string; importToken?: string } | null;
    if (!refresh.ok || !refreshed?.importToken) {
      throw new Error(refreshed?.error ?? 'Commons import authorization could not be refreshed.');
    }
    return refreshed.importToken;
  };
  let importToken = asset.importToken;
  const tokenIsOld = Date.now() - asset.retrievedAt >= COMMONS_IMPORT_TOKEN_REFRESH_AGE_MS;
  if (tokenIsOld) importToken = await refreshImportToken();
  let response = await download(importToken);
  if (response.status === 400) {
    importToken = await refreshImportToken();
    response = await download(importToken);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Commons import failed with HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  const fileName = asset.title.includes('.')
    ? asset.title
    : `${asset.title}${extensionForMime(asset.mimeType)}`;
  const imported = await useMediaStore.getState().importFile(new File([blob], fileName, {
    lastModified: asset.retrievedAt,
    type: asset.mimeType,
  }), null);
  return { ...asset, importToken, mediaFileId: imported.id };
}
