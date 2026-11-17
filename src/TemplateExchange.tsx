import { useState } from 'react';
import type { Config } from './config';
import {
  parseTemplate,
  applyTemplate,
  exchangePrompt,
  blankTemplate,
  type LayoutTemplate,
} from './templates';
import { call } from './bridge';
interface Props {
  config: Config;
  fonts: string[];
  templates: Record<string, LayoutTemplate>;
  save: (name: string, template: LayoutTemplate | null) => void;
  review: (config: Config, label: string) => void;
}
export default function TemplateExchange(p: Props) {
  const [text, setText] = useState(''),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState('');
  const attempt = async (action: () => void | Promise<void>) => {
    try {
      setMessage('');
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <details className="template-exchange">
      <summary>External model templates</summary>
      <div className="template-panel">
        <div className="template-actions">
          <button
            onClick={() =>
              void attempt(async () => {
                await call('copy_text', { text: exchangePrompt(p.config, p.fonts) });
                setMessage(
                  'Copied LLM instructions, current settings, available fonts, and the JSON example.',
                );
              })
            }
          >
            Copy LLM instructions
          </button>
          <button
            onClick={() =>
              void attempt(async () => {
                await call('export_template', {
                  text: JSON.stringify(blankTemplate, null, 2),
                  name: 'folio-layout-template.json',
                });
              })
            }
          >
            Export starter JSON…
          </button>
          <button
            onClick={() => {
              setText(JSON.stringify(blankTemplate, null, 2));
              setMessage('Starter template loaded. Review it before applying.');
            }}
          >
            Use starter
          </button>
        </div>
        <label htmlFor="external-template-json">Template JSON</label>
        <textarea
          id="external-template-json"
          spellCheck={false}
          value={text}
          maxLength={200000}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />
        <div className="template-actions">
          <button
            onClick={() =>
              void attempt(async () => setText(await call<string>('read_clipboard_text')))
            }
          >
            Paste JSON
          </button>
          <button
            onClick={() =>
              void attempt(async () => {
                const value = await call<string | null>('import_template');
                if (value) setText(value);
              })
            }
          >
            Open JSON…
          </button>
          <button
            disabled={!text.trim()}
            onClick={() =>
              void attempt(() => {
                const template = parseTemplate(text);
                p.review(applyTemplate(template, p.config), `External template: ${template.name}`);
                setMessage('Validated. Review the proposed settings below.');
              })
            }
          >
            Review changes
          </button>
          <button
            disabled={!text.trim()}
            onClick={() =>
              void attempt(() => {
                const template = parseTemplate(text);
                applyTemplate(template, p.config);
                p.save(template.name, template);
                setSelected(template.name);
                setMessage(`Saved template “${template.name}”.`);
              })
            }
          >
            Save template
          </button>
          <button
            disabled={!text.trim()}
            onClick={() =>
              void attempt(async () => {
                const template = parseTemplate(text);
                await call('export_template', {
                  text: JSON.stringify(template, null, 2),
                  name: template.name.replace(/[^\w -]/g, '') + '.json',
                });
              })
            }
          >
            Export JSON…
          </button>
        </div>
        <div className="template-saved">
          <div className="field">
            <label htmlFor="saved-template-choice">Saved templates</label>
            <select
              id="saved-template-choice"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose…</option>
              {Object.keys(p.templates).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
          <button
            disabled={!p.templates[selected]}
            onClick={() => {
              setText(JSON.stringify(p.templates[selected], null, 2));
              setMessage('Saved template loaded into the JSON field.');
            }}
          >
            Load template
          </button>
          <button
            disabled={!p.templates[selected]}
            onClick={() => {
              p.save(selected, null);
              setSelected('');
            }}
          >
            Delete template
          </button>
        </div>
        {message && (
          <p role="status" className="command-message">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
