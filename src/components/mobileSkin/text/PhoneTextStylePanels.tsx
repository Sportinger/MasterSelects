// The working style tabs of the phone title sheet: Font (family, size, bold/italic, spacing),
// Color, Outline, Shadow and Align. Each panel edits a PhoneTextStyle draft and hands the complete
// next style to onChange; the title session writes it live and Done commits it as one undo step.

import { useEffect, useState } from 'react';

import { googleFontsService } from '../../../services/googleFontsService';
import { PhoneChip, PhoneColorRow, PhoneSliderRow, PhoneSwitchRow, normalizePhoneHex } from './phoneControls';
import {
  DEFAULT_PHONE_TEXT_STYLE, PHONE_TEXT_RANGES, getPhoneTextFonts, nearestFontWeight, toggledBoldWeight,
  type PhoneTextNumber, type PhoneTextStyle,
} from './phoneTextStyle';
import { PHONE_TEXT_TEST_IDS as IDS } from './phoneTextTestIds';

export interface PhoneTextPanelProps {
  style: PhoneTextStyle;
  onChange: (next: PhoneTextStyle) => void;
}

function NumberRow({ style, onChange, field, label, testId, unit = '' }: PhoneTextPanelProps & {
  field: PhoneTextNumber; label: string; testId: string; unit?: string;
}) {
  const range = PHONE_TEXT_RANGES[field];
  return (
    <PhoneSliderRow
      label={label}
      value={style[field]}
      min={range.min}
      max={range.max}
      step={range.step}
      defaultValue={DEFAULT_PHONE_TEXT_STYLE[field]}
      format={(value) => `${Number(value.toFixed(2))}${unit}`}
      testId={testId}
      onChange={(value) => onChange({ ...style, [field]: value })}
    />
  );
}

/** Loads a web font after it was chosen and says so when it could not load (no silent fallback). */
function useFontLoadNote(family: string, weight: number): string | null {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFailed(null);
    if (!googleFontsService.isManagedFont(family)) return undefined;
    void googleFontsService.loadFont(family, weight).then(() => {
      if (alive && !googleFontsService.isFontLoaded(family, weight)) setFailed(family);
    });
    return () => { alive = false; };
  }, [family, weight]);
  return failed ? `${failed} could not be loaded (offline?). The title shows a fallback font until it loads.` : null;
}

export function PhoneTextFontPanel({ style, onChange }: PhoneTextPanelProps) {
  const note = useFontLoadNote(style.fontFamily, style.fontWeight);
  const bold = style.fontWeight >= 600;
  const weights = googleFontsService.getAvailableWeights(style.fontFamily);
  const canBold = !googleFontsService.isManagedFont(style.fontFamily) || weights.some((weight) => weight >= 600);
  return (
    <div className="phone-design-section">
      <div className="phone-design-chips phone-design-chips--scroll" role="group" aria-label="Font">
        {getPhoneTextFonts().map((font) => (
          <PhoneChip
            key={font.family}
            label={font.family}
            selected={style.fontFamily === font.family}
            testId={`${IDS.fontCard}-${font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            style={{ fontFamily: `"${font.family}", ${font.category === 'system' ? 'sans-serif' : font.category}` }}
            onSelect={() => onChange({ ...style, fontFamily: font.family, fontWeight: nearestFontWeight(font.family, style.fontWeight) })}
          />
        ))}
      </div>
      {note && <p className="phone-design-note phone-design-note--warn" data-testid={IDS.fontNote}>{note}</p>}
      <div className="phone-design-chips" role="group" aria-label="Font style">
        <PhoneChip
          label={<b>B</b>}
          ariaLabel="Bold"
          selected={bold}
          testId={IDS.bold}
          unavailableReason={canBold ? undefined : `${style.fontFamily} has no bold weight. Pick another font for bold text.`}
          onSelect={() => onChange({ ...style, fontWeight: toggledBoldWeight(style.fontFamily, style.fontWeight) })}
        />
        <PhoneChip
          label={<i>I</i>}
          ariaLabel="Italic"
          selected={style.fontStyle === 'italic'}
          testId={IDS.italic}
          onSelect={() => onChange({ ...style, fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
        />
      </div>
      <NumberRow style={style} onChange={onChange} field="fontSize" label="Size" testId={IDS.fontSize} unit=" px" />
      <NumberRow style={style} onChange={onChange} field="letterSpacing" label="Spacing" testId={IDS.letterSpacing} unit=" px" />
      <NumberRow style={style} onChange={onChange} field="lineHeight" label="Line height" testId={IDS.lineHeight} />
    </div>
  );
}

export function PhoneTextColorPanel({ style, onChange }: PhoneTextPanelProps) {
  return (
    <div className="phone-design-section">
      <PhoneColorRow label="Text colour" value={style.color} testId={IDS.color} onChange={(color) => onChange({ ...style, color })} />
    </div>
  );
}

export function PhoneTextOutlinePanel({ style, onChange }: PhoneTextPanelProps) {
  // Picking a colour or width turns the outline on: changing an invisible outline would be a silent no-op.
  return (
    <div className="phone-design-section">
      <PhoneSwitchRow label="Outline" checked={style.strokeEnabled} testId={IDS.strokeToggle} onChange={(strokeEnabled) => onChange({ ...style, strokeEnabled })} />
      <PhoneColorRow label="Outline colour" value={style.strokeColor} testId={IDS.strokeColor} onChange={(strokeColor) => onChange({ ...style, strokeColor, strokeEnabled: true })} />
      <NumberRow style={style} onChange={(next) => onChange({ ...next, strokeEnabled: true })} field="strokeWidth" label="Width" testId={IDS.strokeWidth} unit=" px" />
    </div>
  );
}

export function PhoneTextShadowPanel({ style, onChange }: PhoneTextPanelProps) {
  const on = (next: PhoneTextStyle) => onChange({ ...next, shadowEnabled: true });
  return (
    <div className="phone-design-section">
      <PhoneSwitchRow label="Shadow" checked={style.shadowEnabled} testId={IDS.shadowToggle} onChange={(shadowEnabled) => onChange({ ...style, shadowEnabled })} />
      <PhoneColorRow
        label="Shadow colour"
        value={normalizePhoneHex(style.shadowColor) ?? style.shadowColor}
        testId={IDS.shadowColor}
        onChange={(shadowColor) => on({ ...style, shadowColor })}
      />
      <NumberRow style={style} onChange={on} field="shadowOffsetX" label="Offset X" testId={IDS.shadowX} unit=" px" />
      <NumberRow style={style} onChange={on} field="shadowOffsetY" label="Offset Y" testId={IDS.shadowY} unit=" px" />
      <NumberRow style={style} onChange={on} field="shadowBlur" label="Blur" testId={IDS.shadowBlur} unit=" px" />
    </div>
  );
}

const H_ALIGN: readonly { value: PhoneTextStyle['textAlign']; label: string }[] = [
  { value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' },
];
const V_ALIGN: readonly { value: PhoneTextStyle['verticalAlign']; label: string }[] = [
  { value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' },
];

export function PhoneTextAlignPanel({ style, onChange }: PhoneTextPanelProps) {
  return (
    <div className="phone-design-section">
      <p className="phone-design-section__title">Horizontal</p>
      <div className="phone-design-chips" role="group" aria-label="Horizontal alignment">
        {H_ALIGN.map((option) => (
          <PhoneChip key={option.value} label={option.label} selected={style.textAlign === option.value}
            testId={`${IDS.alignH}-${option.value}`} onSelect={() => onChange({ ...style, textAlign: option.value })} />
        ))}
      </div>
      <p className="phone-design-section__title">Vertical</p>
      <div className="phone-design-chips" role="group" aria-label="Vertical alignment">
        {V_ALIGN.map((option) => (
          <PhoneChip key={option.value} label={option.label} selected={style.verticalAlign === option.value}
            testId={`${IDS.alignV}-${option.value}`} onSelect={() => onChange({ ...style, verticalAlign: option.value })} />
        ))}
      </div>
      <p className="phone-design-note">Aligns the text inside the title area (the whole picture for a new title).</p>
    </div>
  );
}
