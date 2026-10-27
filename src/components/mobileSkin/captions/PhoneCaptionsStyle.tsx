// Style and Timing sections of the Captions sheet. Style: presets first, then size, colour, capitals,
// outline, background, word highlight (mode, look, colour) and height in the frame; every other
// typography setting is one tap away in the desktop Captions tab ("All style settings"). Timing:
// words per caption, pause that starts a new caption, hold after the last word, lines, and the
// transcript source (automatic or one clip). Every change sets absolute values.

import type { TimelineClip } from '../../../types/timeline';
import { getCaptionSourceCandidates } from '../../../services/captions/captionRuntime';
import { useTimelineStore } from '../../../stores/timeline';
import { blurAfterPointer, PhoneSliderRow, PhoneToggleButton } from '../audio/PhoneAudioControls';
import {
  highlightColorKey, matchPhoneCaptionPreset, PHONE_CAPTION_COLORS, PHONE_CAPTION_PRESETS, PHONE_HIGHLIGHT_MODES, PHONE_HIGHLIGHT_STYLES,
  readPhoneCaptionStyle, type PhoneCaptionUpdate,
} from './phoneCaptionStyles';
import { PHONE_CAPTIONS_TEST_IDS as IDS } from './phoneCaptionsTestIds';
import { PhoneChipRow } from '../transition/phoneSheetPrimitives';

type Apply = (update: PhoneCaptionUpdate) => void;

function Swatches({ target, value, onPick }: { target: 'text' | 'highlight' | 'background'; value: string; onPick: (color: string) => void }) {
  return (
    <div className="phone-captions__swatches" role="radiogroup" aria-label={`${target} colour`}>
      {PHONE_CAPTION_COLORS.map((color) => (
        <button key={color} type="button" role="radio" className="phone-captions__swatch" style={{ background: color }}
          aria-checked={value.toLowerCase() === color} aria-label={color} data-testid={IDS.swatch} data-target={target} data-color={color}
          onPointerUp={blurAfterPointer} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}

export function PhoneCaptionsStyle({ clip, apply, onAllStyle }: { clip: TimelineClip; apply: Apply; onAllStyle: () => void }) {
  const style = readPhoneCaptionStyle(clip);
  if (!style) return null;
  const preset = matchPhoneCaptionPreset(clip);
  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Caption style">
      <div className="phone-captions__presets" role="radiogroup" aria-label="Presets">
        {PHONE_CAPTION_PRESETS.map((entry) => (
          <button key={entry.id} type="button" role="radio" className="phone-captions__preset" aria-checked={preset === entry.id}
            aria-pressed={preset === entry.id} data-testid={IDS.preset} data-preset={entry.id}
            onPointerUp={blurAfterPointer} onClick={() => apply(entry.update)}>
            {entry.label}
          </button>
        ))}
      </div>

      <PhoneSliderRow
        id="phone-captions-font-size" label="Size"
        sliderValue={style.fontSize} sliderMin={24} sliderMax={200} sliderStep={1}
        onSlide={(value) => apply({ textStyle: { fontSize: Math.round(value) } })}
        fieldValue={style.fontSize} fieldDecimals={0} fieldMin={8} fieldMax={500} fieldStep={1} fieldSuffix="px"
        onField={(value) => apply({ textStyle: { fontSize: Math.min(500, Math.max(8, Math.round(value))) } })}
        onReset={() => apply({ textStyle: { fontSize: 64 } })}
        sliderTestId={IDS.fontSizeSlider} fieldTestId={IDS.fontSize}
      />
      <span className="phone-captions__label">Text colour</span>
      <Swatches target="text" value={style.color} onPick={(color) => apply({ textStyle: { color } })} />
      <div className="phone-captions__row">
        <PhoneToggleButton pressed={style.uppercase} testId={IDS.uppercase} onToggle={() => apply({ textTransform: style.uppercase ? 'none' : 'uppercase' })}>
          CAPITALS
        </PhoneToggleButton>
        <PhoneToggleButton pressed={style.outline} testId={IDS.outline} onToggle={() => apply({ textStyle: { strokeEnabled: !style.outline } })}>
          Outline
        </PhoneToggleButton>
        <PhoneToggleButton pressed={style.background} testId={IDS.background} onToggle={() => apply({ background: { enabled: !style.background } })}>
          Box behind
        </PhoneToggleButton>
      </div>
      {style.background ? <Swatches target="background" value={style.backgroundColor} onPick={(color) => apply({ background: { color } })} /> : null}

      <PhoneToggleButton pressed={style.highlight} testId={IDS.highlight} onToggle={() => apply({ highlight: { enabled: !style.highlight } })}>
        {style.highlight ? 'Word highlight: on' : 'Word highlight: off'}
      </PhoneToggleButton>
      {style.highlight ? (
        <>
          <PhoneChipRow role="radiogroup" label="Highlight what">
            {PHONE_HIGHLIGHT_MODES.map((mode) => (
              <button key={mode.value} type="button" role="radio" className="phone-captions__chip" aria-checked={style.highlightMode === mode.value}
                aria-pressed={style.highlightMode === mode.value} data-testid={IDS.highlightMode} data-value={mode.value}
                onPointerUp={blurAfterPointer} onClick={() => apply({ highlight: { mode: mode.value } })}>
                {mode.label}
              </button>
            ))}
          </PhoneChipRow>
          <PhoneChipRow role="radiogroup" label="Highlight look">
            {PHONE_HIGHLIGHT_STYLES.map((entry) => (
              <button key={entry.value} type="button" role="radio" className="phone-captions__chip" aria-checked={style.highlightStyle === entry.value}
                aria-pressed={style.highlightStyle === entry.value} data-testid={IDS.highlightStyle} data-value={entry.value}
                onPointerUp={blurAfterPointer} onClick={() => apply({ highlight: { style: entry.value } })}>
                {entry.label}
              </button>
            ))}
          </PhoneChipRow>
          <Swatches target="highlight" value={style.highlightColor}
            onPick={(color) => apply({ highlight: { [highlightColorKey(style.highlightStyle)]: color } })} />
        </>
      ) : null}

      <PhoneSliderRow
        id="phone-captions-position-y" label="Height"
        sliderValue={100 - style.positionY} sliderMin={0} sliderMax={100} sliderStep={1}
        onSlide={(value) => apply({ positionY: Math.round(100 - value) })}
        fieldValue={style.positionY} fieldDecimals={0} fieldMin={0} fieldMax={100} fieldStep={1} fieldSuffix="% from top"
        onField={(value) => apply({ positionY: Math.min(100, Math.max(0, Math.round(value))) })}
        onReset={() => apply({ positionY: 84 })}
        sliderTestId={IDS.positionYSlider} fieldTestId={IDS.positionY}
      />
      <button type="button" className="phone-audio-toggle" data-testid={IDS.allStyle} onPointerUp={blurAfterPointer} onClick={onAllStyle}>
        All style settings (font, shadow, spacing)…
      </button>
    </div>
  );
}

export function PhoneCaptionsTiming({ clip, apply }: { clip: TimelineClip; apply: Apply }) {
  const clips = useTimelineStore((state) => state.clips);
  const style = readPhoneCaptionStyle(clip);
  if (!style) return null;
  const sources = getCaptionSourceCandidates(clips, clip.id);
  const sourceIds = new Set(sources.map((source) => source.clip.id));
  const current = style.sourceClipId && sourceIds.has(style.sourceClipId) ? style.sourceClipId : 'auto';
  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Caption timing">
      <PhoneSliderRow
        id="phone-captions-words" label="Words"
        sliderValue={style.wordsPerCaption} sliderMin={1} sliderMax={20} sliderStep={1}
        onSlide={(value) => apply({ wordsPerCaption: Math.round(value) })}
        fieldValue={style.wordsPerCaption} fieldDecimals={0} fieldMin={1} fieldMax={20} fieldStep={1} fieldSuffix="per caption"
        onField={(value) => apply({ wordsPerCaption: Math.min(20, Math.max(1, Math.round(value))) })}
        onReset={() => apply({ wordsPerCaption: 5 })}
        sliderTestId={IDS.wordsPerCaptionSlider} fieldTestId={IDS.wordsPerCaption}
      />
      <PhoneSliderRow
        id="phone-captions-gap" label="New after"
        sliderValue={style.gapThreshold} sliderMin={0} sliderMax={5} sliderStep={0.05}
        onSlide={(value) => apply({ gapThreshold: Math.round(value * 100) / 100 })}
        fieldValue={style.gapThreshold} fieldDecimals={2} fieldMin={0} fieldMax={5} fieldStep={0.05} fieldSuffix="s pause"
        onField={(value) => apply({ gapThreshold: Math.min(5, Math.max(0, value)) })}
        onReset={() => apply({ gapThreshold: 0.8 })}
        sliderTestId={IDS.gapSlider} fieldTestId={IDS.gap}
      />
      <PhoneSliderRow
        id="phone-captions-hold" label="Hold"
        sliderValue={style.holdAfter} sliderMin={0} sliderMax={3} sliderStep={0.05}
        onSlide={(value) => apply({ holdAfter: Math.round(value * 100) / 100 })}
        fieldValue={style.holdAfter} fieldDecimals={2} fieldMin={0} fieldMax={3} fieldStep={0.05} fieldSuffix="s"
        onField={(value) => apply({ holdAfter: Math.min(3, Math.max(0, value)) })}
        onReset={() => apply({ holdAfter: 0.2 })}
        sliderTestId={IDS.holdSlider} fieldTestId={IDS.hold}
      />
      <PhoneSliderRow
        id="phone-captions-lines" label="Lines"
        sliderValue={style.maxLines} sliderMin={1} sliderMax={10} sliderStep={1}
        onSlide={(value) => apply({ maxLines: Math.round(value) })}
        fieldValue={style.maxLines} fieldDecimals={0} fieldMin={1} fieldMax={10} fieldStep={1} fieldSuffix="max"
        onField={(value) => apply({ maxLines: Math.min(10, Math.max(1, Math.round(value))) })}
        onReset={() => apply({ maxLines: 2 })}
        sliderTestId={IDS.linesSlider} fieldTestId={IDS.lines}
      />
      <span className="phone-captions__label">Words come from</span>
      <PhoneChipRow role="radiogroup" label="Transcript source">
        {[{ id: 'auto', name: 'Automatic' }, ...sources.map((source) => ({ id: source.clip.id, name: source.clip.name }))].map((entry) => (
          <button key={entry.id} type="button" role="radio" className="phone-captions__chip" aria-checked={current === entry.id}
            aria-pressed={current === entry.id} data-testid={IDS.sourceChoice} data-source={entry.id}
            onPointerUp={blurAfterPointer} onClick={() => apply({ sourceClipId: entry.id === 'auto' ? null : entry.id })}>
            {entry.name}
          </button>
        ))}
      </PhoneChipRow>
      <p className="phone-audio-sheet__hint">Automatic follows whichever spoken clip plays at each moment. Trim or move the caption clip on the timeline to change where captions start and end.</p>
    </div>
  );
}
