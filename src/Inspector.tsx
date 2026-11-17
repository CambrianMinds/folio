import { useId, cloneElement } from 'react';
import { type Config, unitFactor } from './config';
interface Props {
  config: Config;
  onChange: (patch: Partial<Config>) => void;
  fonts: string[];
  presets: string[];
  onPreset: (name: string) => void;
  onManage: (action: 'save' | 'rename' | 'delete') => void;
  custom: boolean;
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
export default function Inspector({
  config: c,
  onChange,
  fonts,
  presets,
  onPreset,
  onManage,
  custom,
}: Props) {
  const factor = unitFactor[c.units];
  const number = (
    key: keyof Config,
    label: string,
    min: number,
    max: number,
    step = 0.1,
    geometry = false,
  ) => (
    <Field label={label}>
      <input
        type="number"
        min={geometry ? min / factor : min}
        max={geometry ? max / factor : max}
        step={geometry ? (c.units === 'pt' ? 1 : c.units === 'mm' ? 0.5 : 0.01) : step}
        value={Number(((c[key] as number) / (geometry ? factor : 1)).toFixed(3))}
        onChange={(e) => {
          if (!e.target.value || !Number.isFinite(e.target.valueAsNumber)) return;
          const value = e.target.valueAsNumber * (geometry ? factor : 1);
          onChange(
            key.startsWith('margin') && c.linkedMargins
              ? { marginTop: value, marginBottom: value, marginLeft: value, marginRight: value }
              : { [key]: value },
          );
        }}
      />
    </Field>
  );
  const toggle = (key: keyof Config, label: string) => (
    <label className="check">
      <input
        type="checkbox"
        checked={!!c[key]}
        onChange={(e) => onChange({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const text = (key: keyof Config, label: string) => (
    <Field label={label}>
      <input
        type="text"
        maxLength={2048}
        value={String(c[key])}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </Field>
  );
  const color = (key: keyof Config, label: string) => (
    <Field label={label}>
      <input
        type="color"
        value={String(c[key])}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <aside className="inspector" aria-label="Formatting inspector">
      <div className="pane-heading">
        <h2>Composition</h2>
        <span>Document layout</span>
      </div>
      <div className="inspector-scroll">
        <div className="preset-section">
          <Field label="Starting point">
            <select value={c.preset} onChange={(e) => onPreset(e.target.value)}>
              {!presets.includes(c.preset) && <option>{c.preset}</option>}
              {presets.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <div className="preset-actions">
            <button onClick={() => onManage('save')}>Save preset…</button>
            {custom && (
              <>
                <button onClick={() => onManage('rename')}>Rename</button>
                <button onClick={() => onManage('delete')}>Delete</button>
              </>
            )}
            <button onClick={() => onPreset(c.preset)}>Reset</button>
          </div>
        </div>
        <details open>
          <summary>Page</summary>
          <div className="group">
            <div className="two-fields">
              <Field label="Paper">
                <select
                  value={c.paper}
                  onChange={(e) => {
                    const sizes: Record<string, [number, number]> = {
                      Letter: [612, 792],
                      A4: [595.276, 841.89],
                      Legal: [612, 1008],
                      A5: [419.528, 595.276],
                    };
                    const size = sizes[e.target.value];
                    onChange({
                      paper: e.target.value as Config['paper'],
                      ...(size ? { width: size[0], height: size[1] } : {}),
                    });
                  }}
                >
                  {['Letter', 'A4', 'Legal', 'A5', 'Custom'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Units">
                <select
                  value={c.units}
                  onChange={(e) => onChange({ units: e.target.value as Config['units'] })}
                >
                  {['in', 'mm', 'pt'].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            {c.paper === 'Custom' && (
              <div className="two-fields">
                {number('width', 'Width', 144, 2880, 1, true)}
                {number('height', 'Height', 144, 2880, 1, true)}
              </div>
            )}
            <div className="segmented" role="group" aria-label="Orientation">
              <button aria-pressed={!c.landscape} onClick={() => onChange({ landscape: false })}>
                Portrait
              </button>
              <button aria-pressed={c.landscape} onClick={() => onChange({ landscape: true })}>
                Landscape
              </button>
            </div>
            <div className="sub-label">Margins · {c.units}</div>
            <div className="two-fields">
              {number('marginTop', 'Top', 12, 720, 1, true)}
              {number('marginBottom', 'Bottom', 12, 720, 1, true)}
              {number('marginLeft', c.mirrored ? 'Inside' : 'Left', 12, 720, 1, true)}
              {number('marginRight', c.mirrored ? 'Outside' : 'Right', 12, 720, 1, true)}
            </div>
            {toggle('linkedMargins', 'Link margins')}
            {toggle('mirrored', 'Mirror facing margins')}
            {color('background', 'Paper color')}
          </div>
        </details>
        <details open className="column-section">
          <summary>Columns</summary>
          <div className="group">
            <div className="segmented columns" role="group" aria-label="Column count">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  aria-label={`${n} column${n > 1 ? 's' : ''}`}
                  aria-pressed={c.columns === n}
                  onClick={() => onChange({ columns: n })}
                >
                  <span className="column-glyph" aria-hidden="true">
                    {Array.from({ length: n }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  {n}
                </button>
              ))}
            </div>
            {number('gutter', `Gutter · ${c.units}`, 0, 144, 1, true)}
            {toggle('rule', 'Vertical rule')}
            {c.rule && (
              <>
                <div className="two-fields">
                  {number('ruleWidth', 'Weight · pt', 0.1, 6, 0.1)}
                  {color('ruleColor', 'Rule color')}
                </div>
                <div className="two-fields">
                  {number('ruleInsetTop', `Top inset · ${c.units}`, 0, 720, 1, true)}
                  {number('ruleInsetBottom', `Bottom inset · ${c.units}`, 0, 720, 1, true)}
                </div>
              </>
            )}
          </div>
        </details>
        <details open>
          <summary>Typography</summary>
          <div className="group">
            <Field label="Body typeface">
              <select value={c.bodyFont} onChange={(e) => onChange({ bodyFont: e.target.value })}>
                {[...new Set([c.bodyFont, ...fonts])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <div className="two-fields">
              {number('fontSize', 'Size · pt', 6, 48, 0.5)}
              {number('leading', 'Line spacing · em', 0.1, 2, 0.05)}
            </div>
            <div className="two-fields">
          {number('paragraphSpacing', 'Paragraph extra · pt', 0, 72, 0.5)}
              {number('indent', 'First indent · pt', 0, 72, 0.5)}
            </div>
            <div className="segmented" role="group" aria-label="Text alignment">
              <button aria-pressed={!c.justify} onClick={() => onChange({ justify: false })}>
                Align left
              </button>
              <button aria-pressed={c.justify} onClick={() => onChange({ justify: true })}>
                Justify
              </button>
            </div>
            <Field label="Heading typeface">
              <select
                value={c.headingFont}
                onChange={(e) => onChange({ headingFont: e.target.value })}
              >
                {[...new Set([c.headingFont, ...fonts])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            {number('headingScale', 'Heading scale', 1, 2, 0.05)}
            <div className="two-fields">
              {color('textColor', 'Body ink')}
              {color('headingColor', 'Heading ink')}
            </div>
          </div>
        </details>
        <details>
          <summary>Document</summary>
          <div className="group">
            {text('title', 'Title override')}
            {text('author', 'Author override')}
            {toggle('fullWidthTitle', 'Full-width title')}
            {toggle('toc', 'Table of contents')}
            {toggle('pageNumbers', 'Page numbers')}
            {text('header', 'Running header')}
            {text('footer', 'Running footer')}
          </div>
        </details>
        <details>
          <summary>Elements</summary>
          <div className="group">
            {number('codeSize', 'Code size · pt', 5, 24, 0.5)}
            {number('figureSpacing', 'Figure gap · pt', 0, 72, 1)}
            {color('linkColor', 'Link ink')}
          </div>
        </details>
      </div>
      <div className="inspector-foot">
        {c.paper} · {c.columns} column{c.columns > 1 ? 's' : ''} · {c.fontSize} pt
      </div>
    </aside>
  );
}
