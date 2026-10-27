// The 'Advanced' part of the export sheet: format, size, frame rate, quality, range, sound and the
// project export presets. Everything the editor exports appears; what this browser cannot do is
// greyed and explains itself on tap. "All options" opens the full desktop export panel.
import { useState } from 'react';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  MAX_EXPORT_SIDE,
  MIN_EXPORT_SIDE,
  PHONE_EXPORT_FRAME_RATES,
  PHONE_EXPORT_IMAGE_FORMATS,
  PHONE_EXPORT_PRORES_PROFILES,
  PHONE_EXPORT_QUALITIES,
  PHONE_EXPORT_SHORT_SIDES,
} from './phoneExportAdvancedPlan';
import {
  getPhoneExportFormat,
  hasBitrate,
  PHONE_EXPORT_FORMAT_GROUPS,
  PHONE_EXPORT_FORMATS,
  rendersPictures,
  resolvePhoneFormatAvailability,
} from './phoneExportFormats';
import { PhoneExportChip, PhoneExportGroup, PhoneExportNumberField, releasePointerFocus } from './PhoneExportControls';
import { PHONE_EXPORT_TEST_IDS, phoneExportFormatTestId, phoneExportOptionTestId } from './phoneExportTestIds';
import type { PhoneAdvancedExport } from './usePhoneAdvancedExport';

const QUALITY_LABELS: Record<(typeof PHONE_EXPORT_QUALITIES)[number], string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };
const PRORES_LABELS: Record<(typeof PHONE_EXPORT_PRORES_PROFILES)[number], string> = {
  proxy: 'Proxy', lt: 'LT', standard: '422', hq: 'HQ', '4444': '4444',
};

export function PhoneExportAdvanced({ advanced }: { advanced: PhoneAdvancedExport }) {
  const { settings, update, capabilities, size } = advanced;
  const showToast = usePhoneUiStore((store) => store.showToast);
  const openPanelSheet = usePhoneUiStore((store) => store.openPanelSheet);
  const [presetName, setPresetName] = useState('');
  const format = getPhoneExportFormat(settings.formatId);
  const pictures = rendersPictures(format);
  const bitrate = hasBitrate(format);
  const noPicture = 'Sound-only formats have no picture.';
  const noBitrate = 'This format has no bitrate setting.';
  const noRange = 'A still frame is taken at the playhead.';
  const selectedPreset = advanced.presets.find((preset) => preset.id === advanced.selectedPresetId) ?? null;
  const customFps = typeof settings.fps === 'number' && !(PHONE_EXPORT_FRAME_RATES as readonly number[]).includes(settings.fps);

  return (
    <div className="phone-export-advanced" data-testid={PHONE_EXPORT_TEST_IDS.advanced}>
      {PHONE_EXPORT_FORMAT_GROUPS.map((group) => (
        <PhoneExportGroup key={group} label={group}>
          {PHONE_EXPORT_FORMATS.filter((entry) => entry.group === group).map((entry) => {
            const availability = resolvePhoneFormatAvailability(entry, capabilities, size);
            return (
              <PhoneExportChip
                key={entry.id}
                testId={phoneExportFormatTestId(entry.id)}
                pressed={settings.formatId === entry.id}
                disabledReason={availability.available ? null : availability.reason}
                onSelect={() => update({ formatId: entry.id })}
              >
                {entry.label}
              </PhoneExportChip>
            );
          })}
        </PhoneExportGroup>
      ))}

      <PhoneExportGroup label="Resolution" note={pictures ? `${size.width} × ${size.height}` : null}>
        <PhoneExportChip testId={phoneExportOptionTestId('resolution', 'composition')} pressed={settings.resolution === 'composition'}
          disabledReason={pictures ? null : noPicture} onSelect={() => update({ resolution: 'composition' })}>Project</PhoneExportChip>
        {PHONE_EXPORT_SHORT_SIDES.map((side) => (
          <PhoneExportChip key={side} testId={phoneExportOptionTestId('resolution', side)} pressed={settings.resolution === side}
            disabledReason={pictures ? null : noPicture} onSelect={() => update({ resolution: side })}>{side === 2160 ? '4K' : `${side}p`}</PhoneExportChip>
        ))}
        <PhoneExportChip testId={phoneExportOptionTestId('resolution', 'custom')} pressed={settings.resolution === 'custom'}
          disabledReason={pictures ? null : noPicture} onSelect={() => update({ resolution: 'custom' })}>Custom</PhoneExportChip>
      </PhoneExportGroup>
      {pictures && settings.resolution === 'custom' ? (
        <div className="phone-export-row">
          <PhoneExportNumberField testId={PHONE_EXPORT_TEST_IDS.resolutionCustomWidth} label="Width" value={settings.customWidth}
            min={MIN_EXPORT_SIDE} max={MAX_EXPORT_SIDE} step={2} onCommit={(customWidth) => update({ customWidth })} />
          <PhoneExportNumberField testId={PHONE_EXPORT_TEST_IDS.resolutionCustomHeight} label="Height" value={settings.customHeight}
            min={MIN_EXPORT_SIDE} max={MAX_EXPORT_SIDE} step={2} onCommit={(customHeight) => update({ customHeight })} />
        </div>
      ) : null}

      <PhoneExportGroup label="Frame rate">
        <PhoneExportChip testId={phoneExportOptionTestId('fps', 'composition')} pressed={settings.fps === 'composition'}
          disabledReason={pictures ? null : noPicture} onSelect={() => update({ fps: 'composition' })}>Project</PhoneExportChip>
        {PHONE_EXPORT_FRAME_RATES.map((rate) => (
          <PhoneExportChip key={rate} testId={phoneExportOptionTestId('fps', rate)} pressed={settings.fps === rate}
            disabledReason={pictures ? null : noPicture} onSelect={() => update({ fps: rate })}>{rate}</PhoneExportChip>
        ))}
        <PhoneExportChip testId={phoneExportOptionTestId('fps', 'custom')} pressed={customFps}
          disabledReason={pictures ? null : noPicture} onSelect={() => update({ fps: 29.97 })}>Custom</PhoneExportChip>
      </PhoneExportGroup>
      {pictures && customFps && typeof settings.fps === 'number' ? (
        <PhoneExportNumberField testId={PHONE_EXPORT_TEST_IDS.fpsCustom} label="Custom fps" value={settings.fps} min={1} max={120}
          step={0.001} onCommit={(fps) => update({ fps })} />
      ) : null}

      <PhoneExportGroup label="Quality">
        {PHONE_EXPORT_QUALITIES.map((quality) => (
          <PhoneExportChip key={quality} testId={phoneExportOptionTestId('quality', quality)} pressed={settings.quality === quality}
            disabledReason={bitrate ? null : noBitrate} onSelect={() => update({ quality })}>{QUALITY_LABELS[quality]}</PhoneExportChip>
        ))}
        <PhoneExportChip testId={phoneExportOptionTestId('quality', 'custom')} pressed={settings.quality === 'custom'}
          disabledReason={bitrate ? null : noBitrate} onSelect={() => update({ quality: 'custom' })}>Custom</PhoneExportChip>
        <PhoneExportChip testId={phoneExportOptionTestId('rate', 'vbr')} pressed={settings.rateControl === 'vbr'}
          disabledReason={bitrate ? null : noBitrate} onSelect={() => update({ rateControl: 'vbr' })}>VBR</PhoneExportChip>
        <PhoneExportChip testId={phoneExportOptionTestId('rate', 'cbr')} pressed={settings.rateControl === 'cbr'}
          disabledReason={bitrate ? null : noBitrate} onSelect={() => update({ rateControl: 'cbr' })}>CBR</PhoneExportChip>
      </PhoneExportGroup>
      {bitrate && settings.quality === 'custom' ? (
        <PhoneExportNumberField testId={PHONE_EXPORT_TEST_IDS.bitrateCustom} label="Bitrate" value={Math.round(settings.customBitrate / 100_000) / 10}
          min={0.5} max={100} step={0.5} suffix="Mbit/s" onCommit={(mbps) => update({ customBitrate: mbps * 1_000_000 })} />
      ) : null}

      <PhoneExportGroup label="Range">
        <PhoneExportChip testId={phoneExportOptionTestId('range', 'content')} pressed={settings.range === 'content'}
          disabledReason={format.kind === 'still' ? noRange : null} onSelect={() => update({ range: 'content' })}>Whole edit</PhoneExportChip>
        <PhoneExportChip testId={phoneExportOptionTestId('range', 'in-out')} pressed={settings.range === 'in-out'}
          disabledReason={format.kind === 'still' ? noRange : advanced.inOutAvailable ? null : 'Set an in or out point on the timeline first.'}
          onSelect={() => update({ range: 'in-out' })}>In to out</PhoneExportChip>
        <PhoneExportChip testId={phoneExportOptionTestId('range', 'selection')} pressed={settings.range === 'selection'}
          disabledReason={format.kind === 'still' ? noRange : advanced.selectionAvailable ? null : 'Select one or more clips first.'}
          onSelect={() => update({ range: 'selection' })}>Selected clips</PhoneExportChip>
      </PhoneExportGroup>

      {format.kind === 'still' || format.kind === 'sequence' ? (
        <PhoneExportGroup label="Image format">
          {PHONE_EXPORT_IMAGE_FORMATS.map((image) => (
            <PhoneExportChip key={image} testId={phoneExportOptionTestId('image', image)} pressed={settings.imageFormat === image}
              onSelect={() => update({ imageFormat: image })}>{image.toUpperCase()}</PhoneExportChip>
          ))}
        </PhoneExportGroup>
      ) : null}
      {format.id === 'mov-prores' ? (
        <PhoneExportGroup label="ProRes profile">
          {PHONE_EXPORT_PRORES_PROFILES.map((profile) => (
            <PhoneExportChip key={profile} testId={phoneExportOptionTestId('prores', profile)} pressed={settings.proresProfile === profile}
              onSelect={() => update({ proresProfile: profile })}>{PRORES_LABELS[profile]}</PhoneExportChip>
          ))}
        </PhoneExportGroup>
      ) : null}

      <PhoneExportGroup label="Sound">
        <PhoneExportChip testId={PHONE_EXPORT_TEST_IDS.audioToggle} pressed={settings.includeAudio || format.kind === 'audio'}
          disabledReason={format.kind === 'webcodecs' || format.kind === 'ffmpeg' ? null
            : format.kind === 'audio' ? 'Sound-only formats always include the sound.' : 'This format has no sound.'}
          onSelect={() => update({ includeAudio: !settings.includeAudio })}>Include sound</PhoneExportChip>
      </PhoneExportGroup>

      <PhoneExportGroup label="Presets" note={advanced.presets.length === 0 ? 'No presets in this project yet.' : null}>
        {advanced.presets.map((preset) => (
          <PhoneExportChip key={preset.id} testId={phoneExportOptionTestId('preset', preset.id)} pressed={advanced.selectedPresetId === preset.id}
            onSelect={() => showToast(advanced.loadPreset(preset.id), 'info')}>{preset.name}</PhoneExportChip>
        ))}
      </PhoneExportGroup>
      <div className="phone-export-row">
        <input
          className="phone-export-text"
          type="text"
          placeholder="Preset name"
          aria-label="Preset name"
          value={presetName}
          maxLength={60}
          data-testid={PHONE_EXPORT_TEST_IDS.presetName}
          onChange={(event) => setPresetName(event.target.value)}
        />
        <button
          type="button"
          className="phone-export__button"
          data-testid={PHONE_EXPORT_TEST_IDS.presetSave}
          onPointerUp={releasePointerFocus}
          onClick={() => {
            const message = advanced.savePreset(presetName);
            showToast(message, message.startsWith('Saved') || message.startsWith('Updated') ? 'info' : 'error');
            if (message.startsWith('Saved') || message.startsWith('Updated')) setPresetName('');
          }}
        >
          Save preset
        </button>
      </div>

      {selectedPreset ? (
        <button
          type="button"
          className="phone-export__button phone-export__button--danger"
          data-testid={PHONE_EXPORT_TEST_IDS.presetDelete}
          onPointerUp={releasePointerFocus}
          onClick={() => showToast(advanced.deletePreset(selectedPreset.id), 'info')}
        >
          Delete preset "{selectedPreset.name}"
        </button>
      ) : null}

      <button
        type="button"
        className="phone-export__link"
        data-testid={PHONE_EXPORT_TEST_IDS.allOptions}
        onPointerUp={releasePointerFocus}
        onClick={() => openPanelSheet('export', 'Export (all options)')}
      >
        All options (desktop export panel)
      </button>
    </div>
  );
}
