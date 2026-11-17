import { useEffect, useRef, useState } from 'react';
import type { Config } from './config';
import {
  changesBetween,
  fitCandidates,
  parseCommand,
  resolveStyle,
  type Interpretation,
} from './commands';
import { pageCount, type Analysis } from './pdfAnalysis';
import { call, type Preview } from './bridge';
import TemplateExchange from './TemplateExchange';
import type { LayoutTemplate } from './templates';
type Plan = Extract<Interpretation, { kind: 'layout' }> & { basis: string };
export interface Variation {
  name: string;
  config: Config;
}
interface Props {
  active?: boolean;
  config: Config;
  fonts: string[];
  source: string;
  path: string | null;
  pdf: string | null;
  latest: boolean;
  apply: (c: Config, label: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  variations: Record<string, Config>;
  saveVariation: (name: string, c: Config | null) => void;
  guides: boolean;
  toggleGuides: () => void;
  compare: boolean;
  toggleCompare: () => void;
  capture: () => void;
  hasBaseline: boolean;
  analysis: Analysis | null;
  openPage: (page: number) => void;
  report: (s: string) => void;
  modelPath: string | null;
  onModelPath: (path: string | null) => void;
  templates: Record<string, LayoutTemplate>;
  saveTemplate: (name: string, template: LayoutTemplate | null) => void;
}
const display = (v: unknown) =>
  typeof v === 'boolean'
    ? v
      ? 'on'
      : 'off'
    : typeof v === 'number'
      ? Number(v.toFixed(3)).toString()
      : String(v);
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase();
export default function Workbench(p: Props) {
  const [expanded, setExpanded] = useState(false),
    [input, setInput] = useState(''),
    [plan, setPlan] = useState<Plan | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [name, setName] = useState(''),
    [selected, setSelected] = useState(''),
    [checks, setChecks] = useState(false),
    [target, setTarget] = useState(4),
    [minimum, setMinimum] = useState(Math.min(10, p.config.fontSize)),
    [model, setModel] = useState(false);
  const field = useRef<HTMLInputElement>(null),
    job = useRef(0),
    fitId = useRef(Date.now()),
    latest = useRef(p);
  latest.current = p;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (p.active === false || e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setExpanded(true);
        requestAnimationFrame(() => field.current?.focus());
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        p.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        p.redo();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [p.undo, p.redo, p.active]);
  useEffect(() => {
    job.current++;
    void call('cancel_fit', { id: ++fitId.current }).catch(() => {});
    setBusy(false);
    setProgress('');
  }, [p.source, p.path, p.config]);
  useEffect(
    () => () => {
      job.current++;
      void call('cancel_fit', { id: ++fitId.current }).catch(() => {});
    },
    [],
  );
  async function fit(pages = target, min = minimum) {
    if (
      pages < 1 ||
      pages > 100 ||
      !Number.isInteger(pages) ||
      min < 6 ||
      min > p.config.fontSize
    ) {
      setMessage('Choose 1–100 pages and a minimum type size between 6 pt and the current size.');
      return;
    }
    const serial = ++job.current;
    const basis = JSON.stringify(p.config);
    const candidates = fitCandidates(p.config, min);
    let successful = 0;
    setBusy(true);
    setPlan(null);
    setMessage('');
    try {
      for (let i = 0; i < candidates.length; i++) {
        if (serial !== job.current) return;
        setProgress(`Testing layout ${i + 1} of ${candidates.length}…`);
        const id = ++fitId.current;
        let preview: Preview;
        try {
          preview = await call<Preview>('render_fit', {
            id,
            source: p.source,
            path: p.path,
            config: candidates[i],
          });
        } catch (e) {
          if (serial !== job.current) return;
          if (String(e).includes('superseded')) return;
          continue;
        }
        const count = await pageCount(preview.pdf);
        successful++;
        if (serial !== job.current) return;
        if (count <= pages) {
          setPlan({
            kind: 'layout',
            config: candidates[i],
            changes: changesBetween(p.config, candidates[i]),
            engine: `Tested PDF: ${count} page${count === 1 ? '' : 's'} (target ≤ ${pages})`,
            basis,
          });
          setMessage(count === 0 ? '' : 'Target met. Review the settings before applying.');
          return;
        }
      }
      setMessage(
        successful
          ? `No tested layout reached ${pages} pages while keeping body text at least ${min} pt. Paper, columns, margins, and fonts were preserved.`
          : 'No candidate compiled successfully. Resolve the current publishing errors first.',
      );
    } catch (e) {
      if (serial === job.current) setMessage(String(e));
    } finally {
      if (serial === job.current) {
        setBusy(false);
        setProgress('');
      }
    }
  }
  async function interpret() {
    setMessage('');
    setPlan(null);
    const serial = ++job.current;
    const basis = JSON.stringify(p.config);
    try {
      let result: Interpretation;
      let explicit: Interpretation | undefined;
      let parseError: unknown;
      try {
        explicit = parseCommand(input, p.config, p.fonts);
      } catch (e) {
        parseError = e;
      }
      if (explicit) result = explicit;
      else if (model) {
        if (!p.modelPath) throw Error('Choose a local GGUF model first.');
        setBusy(true);
        const patch = await call<unknown>('interpret_layout', {
          id: ++fitId.current,
          request: input,
          config: p.config,
          fonts: p.fonts,
          modelPath: p.modelPath,
        });
        if (serial !== job.current) return;
        const config = resolveStyle(patch, p.config);
        result = {
          kind: 'layout',
          config,
          changes: changesBetween(p.config, config),
          engine: 'Local CPU style selection - review its settings',
        };
        if (!result.changes.length)
          throw Error(
            'The request did not resolve to a change. Specify the setting and desired value.',
          );
      } else throw parseError;
      if (result.kind === 'fit') {
        setTarget(result.pages);
        setMinimum(result.minimum);
        await fit(result.pages, result.minimum);
      } else {
        setPlan({ ...result, basis });
        if (!result.changes.length) setMessage('These settings already match the request.');
      }
    } catch (e) {
      if (serial === job.current) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (serial === job.current) setBusy(false);
    }
  }
  return (
    <section className="composition-tools" aria-label="Composition tools">
      <div className="composition-strip">
        <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          Describe a change…
        </button>
        <div className="history-actions">
          <button onClick={p.undo} disabled={!p.canUndo} aria-label="Undo layout">
            Undo layout
          </button>
          <button onClick={p.redo} disabled={!p.canRedo} aria-label="Redo layout">
            Redo
          </button>
        </div>
        <button onClick={p.toggleGuides} aria-pressed={p.guides}>
          Guides
        </button>
        <button
          onClick={p.toggleCompare}
          disabled={!p.latest && !p.hasBaseline}
          aria-pressed={p.compare}
        >
          Compare
        </button>
        <button onClick={() => setChecks((v) => !v)} aria-expanded={checks}>
          Checks{p.analysis ? ` · ${p.analysis.findings.length}` : ''}
        </button>
      </div>
      {expanded && (
        <div className="composition-expanded">
          <form
            className="command-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void interpret();
            }}
          >
            <label htmlFor="layout-request">Describe a layout change</label>
            <div className="command-input">
              <input
                ref={field}
                id="layout-request"
                value={input}
                maxLength={2000}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPlan(null);
                  if (busy) {
                    job.current++;
                    void call('cancel_fit', { id: ++fitId.current });
                    setBusy(false);
                    setProgress('');
                  }
                }}
                placeholder="Two columns, half-inch margins, Georgia 11 point, and a thin gray rule"
              />
              <button type="submit" className="primary" disabled={busy || !input.trim()}>
                Interpret
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setPlan(null);
                  if (busy) {
                    job.current++;
                    void call('cancel_fit', { id: ++fitId.current });
                    setBusy(false);
                    setProgress('');
                  }
                }}
              >
                Close
              </button>
            </div>
          </form>
          <div className="composition-options">
            <label className="check">
              <input
                type="checkbox"
                checked={model}
                onChange={(e) => setModel(e.target.checked)}
                disabled={!p.modelPath}
              />
              Interpret style descriptions locally
            </label>
            <button
              onClick={() =>
                void call<string | null>('choose_model')
                  .then((path) => {
                    if (path) {
                      p.onModelPath(path);
                      setModel(true);
                    }
                  })
                  .catch((e) => setMessage(String(e)))
              }
            >
              {p.modelPath ? 'Change model…' : 'Choose local model…'}
            </button>
            {p.modelPath && (
              <button
                onClick={() => {
                  p.onModelPath(null);
                  setModel(false);
                }}
              >
                Disconnect model
              </button>
            )}
          </div>
          <div className="variation-controls">
            <label>
              Variation name
              <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              disabled={!name.trim()}
              onClick={() => {
                p.saveVariation(name.trim(), p.config);
                setSelected(name.trim());
                setName('');
              }}
            >
              Save variation
            </button>
            <label>
              Saved variations
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Choose…</option>
                {Object.keys(p.variations).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              disabled={!p.variations[selected]}
              onClick={() => {
                p.capture();
                p.apply(p.variations[selected], `Variation: ${selected}`);
              }}
            >
              Load
            </button>
            <button
              disabled={!p.variations[selected]}
              onClick={() => {
                p.saveVariation(selected, null);
                setSelected('');
              }}
            >
              Delete
            </button>
          </div>
          <form
            className="fit-controls"
            onSubmit={(e) => {
              e.preventDefault();
              void fit();
            }}
          >
            <label>
              Target pages
              <input
                type="number"
                min={1}
                max={100}
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              />
            </label>
            <label>
              Minimum body · pt
              <input
                type="number"
                min={6}
                max={p.config.fontSize}
                step={0.5}
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <button type="submit" disabled={busy}>
              Find a fit
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => {
                  job.current++;
                  void call('cancel_fit', { id: ++fitId.current });
                  setBusy(false);
                  setProgress('');
                }}
              >
                Cancel
              </button>
            )}
            <span role="status">{progress}</span>
          </form>
          <TemplateExchange
            config={p.config}
            fonts={p.fonts}
            templates={p.templates}
            save={p.saveTemplate}
            review={(config, label) => {
              setPlan({
                kind: 'layout',
                config,
                changes: changesBetween(p.config, config),
                engine: label,
                basis: JSON.stringify(p.config),
              });
              setMessage('');
            }}
          />
          {message && (
            <p className="command-message" role="status">
              {message}
            </p>
          )}
          {plan && (
            <div className="command-plan">
              <strong>{plan.engine}</strong>
              <ul>
                {plan.changes.map((change) => (
                  <li key={change.key}>
                    {label(change.key)}: {display(change.before)} → {display(change.after)}
                  </li>
                ))}
              </ul>
              {plan.changes.length > 0 && (
                <button
                  className="primary"
                  disabled={plan.basis !== JSON.stringify(p.config) || busy}
                  onClick={() => {
                    p.capture();
                    p.apply(plan.config, `Command: ${input || 'fit to target'}`);
                    setPlan(null);
                    setMessage('Applied. Use Undo layout to restore the previous composition.');
                  }}
                >
                  Apply changes
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {p.compare && (
        <div className="comparison-caption">
          <span>Before · captured composition / Current · live composition</span>
          <button disabled={!p.latest} onClick={p.capture}>
            Capture current as before
          </button>
        </div>
      )}
      {checks && (
        <div className="publishing-checks" aria-label="Publishing checks">
          {p.analysis ? (
            <>
              <strong>
                {p.analysis.pages} page{p.analysis.pages === 1 ? '' : 's'} ·{' '}
                {p.analysis.findings.length
                  ? 'Review flagged pages'
                  : 'No issues found by these checks'}
              </strong>
              <span className="check-scope">
                Checks cover text margins, available fonts, heading endings, and sparse final pages.
                Inspect figures and tables visually.
              </span>
              {p.analysis.findings.map((finding, i) => (
                <button key={i} onClick={() => p.openPage(finding.page)}>
                  Page {finding.page} · {finding.message}
                </button>
              ))}
            </>
          ) : (
            <p>Checks appear after the PDF has rendered.</p>
          )}
        </div>
      )}
    </section>
  );
}
