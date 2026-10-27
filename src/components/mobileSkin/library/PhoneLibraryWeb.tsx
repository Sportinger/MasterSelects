// Library > Web sources: search a platform (in the app for YouTube when a YouTube key is saved under
// Settings > Integrations, otherwise in the platform's own page), keep a picked link, and bring the
// video in by importing the downloaded file. Downloading itself needs the desktop native helper and
// stays visible, greyed, with that reason.
import { useRef, useState, type ChangeEvent } from 'react';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { importPhoneFilesInOrder } from '../media/usePhoneMediaImport';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from './phoneListUi';
import {
  PHONE_WEB_LIMITS, PHONE_WEB_PLATFORMS, parsePhoneWebUrl, phonePlatformSearchUrl, searchPhoneYouTube, type PhoneWebPlatform,
  type PhoneYouTubeResult,
} from './phoneWebSearch';
import { PHONE_LIBRARY_WEB_TEST_IDS as IDS } from './phoneLibraryTestIds';

export function PhoneLibraryWeb({ onBack, initialLink = '' }: { onBack: () => void; initialLink?: string }) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const apiKey = useSettingsStore((state) => state.youtubeApiKey);
  const [platform, setPlatform] = useState<PhoneWebPlatform>('youtube');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhoneYouTubeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [link, setLink] = useState(initialLink);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const { status, report } = usePhoneStatus();
  const inApp = platform === 'youtube' && apiKey.length > 0;
  const url = parsePhoneWebUrl(link);

  const search = async () => {
    const text = query.trim();
    if (!text) { report({ ok: false, message: 'Type what you are looking for first.' }); return; }
    if (!inApp) {
      const label = PHONE_WEB_PLATFORMS.find((entry) => entry.id === platform)!.label;
      // noopener: the platform page gets no handle on the editor (window.open then returns null by design).
      window.open(phonePlatformSearchUrl(platform, text), '_blank', 'noopener,noreferrer');
      report({ ok: true, message: `${label} search opened in a new tab (if nothing opened, allow pop-ups for this site). Copy a video link there and paste it below; your project stays open here.` });
      return;
    }
    setSearching(true);
    try {
      const found = await searchPhoneYouTube(text, apiKey);
      setResults(found);
      report({ ok: true, message: found.length ? `${found.length} YouTube results.` : 'No matching YouTube videos.' });
    } catch (error) {
      setResults(null);
      report({ ok: false, message: `YouTube search failed: ${error instanceof Error ? error.message : String(error)}. Check the key under Settings > Integrations.` });
    } finally {
      setSearching(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      report({ ok: true, message: 'Link copied.' });
    } catch {
      report({ ok: false, message: 'Copying is not allowed here. Long-press the field and copy.' });
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { report({ ok: false, message: 'The clipboard is empty.' }); return; }
      setLink(text.trim());
    } catch {
      report({ ok: false, message: 'Pasting is not allowed here. Long-press the field and paste.' });
    }
  };

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setImporting(true);
    const outcome = await importPhoneFilesInOrder(files);
    setImporting(false);
    const failed = outcome.failures.map((failure) => failure.message).join(' ');
    report(outcome.imported.length > 0
      ? { ok: true, message: `Imported ${outcome.imported.length} file${outcome.imported.length === 1 ? '' : 's'} into the Library.${failed ? ` ${failed}` : ''}` }
      : { ok: false, message: failed || 'Nothing was imported.' });
  };

  return (
    <PhoneSheet title="Web sources" height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-lib" data-testid={IDS.root} onPointerUpCapture={blurTappedControl}>
        <div className="phone-lib__bar" role="radiogroup" aria-label="Platform">
          {PHONE_WEB_PLATFORMS.map((entry) => (
            <button key={entry.id} type="button" role="radio" className="phone-lib__chip" data-testid={IDS.platform} data-platform={entry.id}
              aria-checked={platform === entry.id} aria-pressed={platform === entry.id} onClick={() => { setPlatform(entry.id); setResults(null); }}>
              {entry.label}
            </button>
          ))}
        </div>
        <form className="phone-lib__inline" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <input className="phone-lib__input" type="search" enterKeyHint="search" aria-label="Search the web source" data-testid={IDS.query}
            value={query} placeholder="Search…" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.search} data-mode={inApp ? 'in-app' : 'handoff'}
            aria-disabled={searching}>
            {searching ? 'Searching…' : inApp ? 'Search' : 'Open search'}
          </button>
        </form>
        <p className="phone-lib__note" data-testid={IDS.searchMode}>
          {inApp
            ? 'Searching YouTube in the app with your key.'
            : platform === 'youtube'
              ? 'Opens YouTube in a new tab. Save a YouTube key under Settings > Integrations to search here instead.'
              : 'Opens the platform in a new tab; it has no search the app may use.'}
        </p>
        {results && results.length > 0 && (
          <ul className="phone-lib__list" aria-label="YouTube results">
            {results.map((result) => (
              <li key={result.id}>
                <button type="button" className="phone-lib__button phone-lib__button--wide phone-lib__web-result" data-testid={IDS.result}
                  aria-pressed={link === result.url} onClick={() => { setLink(result.url); report({ ok: true, message: `Picked “${result.title}”.` }); }}>
                  <strong>{result.title}</strong>
                  <small>{result.channel}</small>
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="phone-lib__section">Link</h3>
        <div className="phone-lib__inline">
          <input className="phone-lib__input" type="url" inputMode="url" aria-label="Video link" data-testid={IDS.link} value={link}
            placeholder="https://…" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setLink(event.target.value)} />
          <button type="button" className="phone-lib__button" data-testid={IDS.paste} onClick={() => void paste()}>Paste</button>
        </div>
        <div className="phone-lib__bar">
          <a className="phone-lib__button" data-testid={IDS.open} aria-disabled={!url} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            href={url ?? undefined} target="_blank" rel="noopener noreferrer"
            onClick={(event) => { if (!url) { event.preventDefault(); report({ ok: false, message: 'Paste or pick a link first.' }); } }}>
            Open
          </a>
          <button type="button" className="phone-lib__button" data-testid={IDS.copy} aria-disabled={!url}
            onClick={() => (url ? void copy() : report({ ok: false, message: 'Paste or pick a link first.' }))}>Copy link</button>
          <button type="button" className="phone-lib__button" data-testid={IDS.download} aria-disabled="true"
            onClick={() => showUnavailable({ actionId: 'library-url-download', label: 'Download from link', reason: PHONE_WEB_LIMITS.download })}>
            Download
          </button>
        </div>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.importFile} aria-disabled={importing}
          onClick={() => { if (!importing) importInput.current?.click(); }}>
          {importing ? 'Importing…' : 'Import a downloaded file'}
        </button>
        <input ref={importInput} className="phone-lib__hidden-input" type="file" multiple accept="video/*,audio/*,image/*"
          data-testid={IDS.importInput} onChange={(event) => void onImport(event)} />
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.helperDownloads} aria-disabled="true"
          onClick={() => showUnavailable({ actionId: 'library-helper-downloads', label: 'Download queue', reason: PHONE_WEB_LIMITS.helperDownloads })}>
          Download queue (native helper)
        </button>
        <PhoneStatusLine status={status} testId={IDS.status} />
      </div>
    </PhoneSheet>
  );
}
