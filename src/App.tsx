import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import CodeMirror, { type ReactCodeMirrorRef, EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel } from '@codemirror/search';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { call, native, type Document, type Preview, type Preferences, type Layout } from './bridge';
import { defaults, presets, validateConfig, type Config } from './config';
import Inspector from './Inspector';
import PdfPreview from './PdfPreview';
import Workbench from './Workbench';
import { useLayoutHistory } from './history';
import type { Analysis } from './pdfAnalysis';
import welcome from '../samples/Welcome.md?raw';

const initialLayout: Layout = {
  editor: true,
  inspector: true,
  editorWidth: 360,
  inspectorWidth: 288,
  lineNumbers: true,
  wrap: true,
  zoom: 'width',
  spread: false,
};
type Question = {
  title: string;
  text?: string;
  value?: string;
  choices: string[];
  resolve: (answer: { choice: string; value: string }) => void;
};
const filename = (p: string | null) => p?.split(/[\\/]/).pop() || 'Untitled.md';
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
export default function App() {
  const [source, setSource] = useState(welcome),
    [path, setPath] = useState<string | null>(null),
    [saved, setSaved] = useState({ source: welcome, config: JSON.stringify(defaults) });
  const [renderTick, setRenderTick] = useState(0);
  const history = useLayoutHistory(defaults),
    config = history.config,
    setConfig = history.set;
  const [guides, setGuides] = useState(false),
    [compare, setCompare] = useState(false),
    [baseline, setBaseline] = useState<{ pdf: string; config: Config; source: string } | null>(
      null,
    ),
    [rendered, setRendered] = useState({ config: defaults, source: welcome }),
    [analysis, setAnalysis] = useState<Analysis | null>(null);
  useEffect(() => {
    setBaseline(null);
    setCompare(false);
    setAnalysis(null);
  }, [source, path]);
  const [layout, setLayout] = useState<Layout>(initialLayout),
    [prefs, setPrefs] = useState<Preferences>({
      recent: [],
      presets: {},
      layout: {},
      exportDirectory: null,
    }),
    [loaded, setLoaded] = useState(false);
  const [fonts, setFonts] = useState([
      'Georgia',
      'Times New Roman',
      'Segoe UI',
      'Arial',
      'Consolas',
    ]),
    [pdf, setPdf] = useState<string | null>(null),
    [previewId, setPreviewId] = useState<number | null>(null),
    [status, setStatus] = useState('Ready'),
    [error, setError] = useState(''),
    [documentWarning, setDocumentWarning] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]),
    [notice, setNotice] = useState('');
  const [question, setQuestion] = useState<Question | null>(null),
    [answer, setAnswer] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    editor = useRef<ReactCodeMirrorRef>(null),
    generation = useRef(Date.now()),
    app = useRef<HTMLDivElement>(null),
    saving = useRef(false),
    closing = useRef(false);
  const current = useRef({ source, path, config, prefs, layout, saved });
  current.current = { source, path, config, prefs, layout, saved };
  const dirty = source !== saved.source || JSON.stringify(config) !== saved.config;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const report = useCallback((e: string) => {
    setError(e);
  }, []);
  const ask = useCallback(
    (title: string, choices: string[], text?: string, value?: string) =>
      new Promise<{ choice: string; value: string }>((resolve) => {
        setAnswer(value ?? '');
        setQuestion({ title, choices, text, value, resolve });
      }),
    [],
  );
  useEffect(() => {
    if (question) dialog.current?.showModal();
    else dialog.current?.close();
  }, [question]);
  const respond = (choice: string) => {
    question?.resolve({ choice, value: answer });
    setQuestion(null);
  };
  const updateLayout = useCallback(
    (patch: Partial<Layout>) =>
      setLayout((old) => ({
        ...old,
        ...(window.innerWidth < 1150
          ? patch.inspector
            ? { editor: false }
            : patch.editor
              ? { inspector: false }
              : {}
          : {}),
        ...patch,
      })),
    [],
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width:1150px)');
    const change = () => {
      if (media.matches) setLayout((l) => ({ ...l, inspector: false }));
    };
    media.addEventListener('change', change);
    if (loaded) change();
    return () => media.removeEventListener('change', change);
  }, [loaded]);
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (saving.current) return false;
      saving.current = true;
      try {
        const snapshot = current.current;
        validateConfig(snapshot.config);
        const p = await call<string | null>('save_document', {
          path: snapshot.path,
          source: snapshot.source,
          config: snapshot.config,
          saveAs,
        });
        if (!p) return false;
        setPath(p);
        setSaved({ source: snapshot.source, config: JSON.stringify(snapshot.config) });
        setNotice('Saved');
        setPrefs((old) => ({
          ...old,
          recent: [p, ...old.recent.filter((x) => x !== p)].slice(0, 12),
        }));
        return true;
      } catch (e) {
        report(errorText(e));
        return false;
      } finally {
        saving.current = false;
      }
    },
    [report],
  );
  const protect = useCallback(async () => {
    if (!dirtyRef.current) return true;
    const a = await ask(
      'Save your changes?',
      ['Save', 'Discard', 'Cancel'],
      'The document or its layout has unsaved changes.',
    );
    if (a.choice === 'Save') return save();
    return a.choice === 'Discard';
  }, [ask, save]);
  const open = useCallback(
    async (requested?: string) => {
      try {
        if (!(await protect())) return;
        const doc = await call<Document | null>('open_document', { path: requested ?? null });
        if (!doc) return;
        setSource(doc.source);
        setPath(doc.path);
        history.reset(doc.config);
        setSaved({ source: doc.source, config: JSON.stringify(doc.config) });
        setError('');
        setDocumentWarning(doc.warning || '');
        setNotice('');
        setPrefs((old) => ({
          ...old,
          recent: [doc.path, ...old.recent.filter((x) => x !== doc.path)].slice(0, 12),
        }));
      } catch (e) {
        report(errorText(e));
      }
    },
    [protect, report, history.reset],
  );
  const refresh = useCallback(() => {
    setRenderTick((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!native) {
      setError('Start the Folio desktop application to typeset and open documents.');
      setLoaded(true);
      return;
    }
    void call<Preferences>('load_preferences')
      .then(async (p) => {
        const next = { ...initialLayout, ...p.layout };
        setPrefs({ ...p, presets: p.presets || {}, recent: p.recent || [] });
        setLayout(next);
        if (next.width && next.height)
          await getCurrentWindow().setSize(
            new LogicalSize(Math.max(900, next.width), Math.max(600, next.height)),
          );
      })
      .catch((e) => report(errorText(e)))
      .finally(() => setLoaded(true));
    void call<string[]>('fonts')
      .then(setFonts)
      .catch(() => {});
  }, [report]);
  useEffect(() => {
    if (!loaded || !native) return;
    const timer = setTimeout(() => {
      void call('save_preferences', { preferences: { ...prefs, layout } }).catch((e) =>
        report(errorText(e)),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [loaded, prefs, layout, report]);
  useEffect(() => {
    if (!native || !loaded) return;
    const id = ++generation.current;
    setStatus('Waiting');
    void call('supersede', { id }).catch(() => {});
    const timer = setTimeout(() => {
      try {
        validateConfig(config);
      } catch (e) {
        setError(errorText(e));
        setStatus('Layout needs attention');
        return;
      }
      setStatus('Typesetting');
      void call<Preview>('render_document', { id, source, path, config })
        .then((result) => {
          if (id !== generation.current) return;
          setPdf(result.pdf);
          setRendered({ config, source });
          setPreviewId(result.id);
          setWarnings(result.warnings);
          setError('');
          setStatus('Updated');
        })
        .catch((e) => {
          if (id === generation.current) {
            setError(errorText(e));
            setStatus('Compilation error');
          }
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      generation.current++;
      void call('supersede', { id: generation.current }).catch(() => {});
    };
  }, [source, path, config, loaded, renderTick]);
  const latest = previewId !== null && previewId === generation.current;
  const captureBaseline = () => {
    if (pdf && latest) setBaseline({ pdf, config: rendered.config, source: rendered.source });
  };
  const publish = useCallback(
    async (kind: 'pdf' | 'typst' | 'print') => {
      if (previewId === null || previewId !== generation.current) {
        setNotice('Wait for a successful current preview before publishing.');
        return;
      }
      try {
        if (kind === 'print') {
          await call('print_document', { id: previewId });
          setNotice('Opened in your PDF application. Use its Print command.');
          return;
        }
        const p = await call<string | null>('export_document', {
          id: previewId,
          kind,
          name: filename(path).replace(/\.(md|markdown)$/i, kind === 'pdf' ? '.pdf' : '.typ'),
          directory: prefs.exportDirectory,
        });
        if (p) {
          setNotice(`Exported ${filename(p)}`);
          setPrefs((old) => ({ ...old, exportDirectory: p.replace(/[\\/][^\\/]*$/, '') }));
        }
      } catch (e) {
        report(errorText(e));
      }
    },
    [previewId, path, prefs.exportDirectory, report],
  );
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${filename(path)} — Folio`;
  }, [path, dirty]);
  const actions = useRef({ open, save, publish, protect });
  actions.current = { open, save, publish, protect };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void actions.current.save(e.shiftKey);
      }
      if (k === 'o') {
        e.preventDefault();
        void actions.current.open();
      }
      if (k === 'p') {
        e.preventDefault();
        void actions.current.publish('print');
      }
      if (k === 'e') {
        e.preventDefault();
        void actions.current.publish('pdf');
      }
    };
    window.addEventListener('keydown', key);
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    if (!native)
      return () => {
        window.removeEventListener('keydown', key);
        window.removeEventListener('beforeunload', before);
      };
    const win = getCurrentWindow();
    const close = win.onCloseRequested(async (e) => {
      e.preventDefault();
      if (closing.current) return;
      closing.current = true;
      try {
        if (await actions.current.protect()) {
          dirtyRef.current = false;
          await call('save_preferences', {
            preferences: { ...current.current.prefs, layout: current.current.layout },
          });
          await win.destroy();
        }
      } catch (err) {
        report(errorText(err));
      } finally {
        closing.current = false;
      }
    });
    const drop = win.onDragDropEvent((e) => {
      if (e.payload.type === 'drop' && e.payload.paths[0])
        void actions.current.open(e.payload.paths[0]);
    });
    const resize = win.onResized(async () => {
      const size = await win.innerSize();
      const dpi = await win.scaleFactor();
      updateLayout({ width: Math.round(size.width / dpi), height: Math.round(size.height / dpi) });
    });
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', before);
      void close.then((f) => f());
      void drop.then((f) => f());
      void resize.then((f) => f());
    };
  }, [report, updateLayout]);
  const resizePanel = (which: 'editor' | 'inspector', e: React.PointerEvent<HTMLDivElement>) => {
    const initial = e.clientX;
    const original = which === 'editor' ? layout.editorWidth : layout.inspectorWidth;
    const node = e.currentTarget;
    node.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      updateLayout(
        which === 'editor'
          ? { editorWidth: Math.max(240, Math.min(650, original + event.clientX - initial)) }
          : { inspectorWidth: Math.max(260, Math.min(420, original + initial - event.clientX)) },
      );
    const end = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end, { once: true });
  };
  const choosePreset = (name: string) => {
    const preset = prefs.presets[name] ?? presets[name];
    if (preset)
      setConfig({
        ...preset,
        title: config.title,
        author: config.author,
        header: config.header,
        footer: config.footer,
      });
  };
  const manage = async (action: 'save' | 'rename' | 'delete') => {
    if (action === 'delete') {
      const { choice } = await ask('Delete this preset?', ['Delete', 'Cancel'], config.preset);
      if (choice === 'Delete') {
        setPrefs((p) => {
          const custom = { ...p.presets };
          delete custom[config.preset];
          return { ...p, presets: custom };
        });
        setConfig((c) => ({ ...c, preset: 'Essay' }));
      }
      return;
    }
    const { choice, value } = await ask(
      action === 'save' ? 'Save a formatting preset' : 'Rename preset',
      ['Save', 'Cancel'],
      undefined,
      action === 'rename' ? config.preset : '',
    );
    if (choice !== 'Save' || !value.trim()) return;
    const name = value.trim();
    if (name in presets) {
      report('Choose a name other than the four built-in presets.');
      return;
    }
    if (name in prefs.presets && name !== config.preset) {
      report('That preset name is already in use.');
      return;
    }
    try {
      validateConfig(config);
      setPrefs((p) => {
        const custom = { ...p.presets };
        if (action === 'rename') delete custom[config.preset];
        custom[name] = { ...config, preset: name };
        return { ...p, presets: custom };
      });
      setConfig((c) => ({ ...c, preset: name }));
    } catch (e) {
      report(errorText(e));
    }
  };
  const editorExtensions = useMemo(
    () => [
      markdown(),
      ...(layout.wrap ? [EditorView.lineWrapping] : []),
      EditorView.theme({
        '&': { background: '#faf9f6', fontSize: '13px' },
        '.cm-content': { fontFamily: 'Consolas, monospace', padding: '18px 0' },
        '.cm-line': { padding: '0 20px' },
        '.cm-gutters': { background: '#faf9f6', border: 'none', color: '#a09f98' },
        '.cm-activeLine': { background: '#f0efea' },
        '.cm-activeLineGutter': { background: '#f0efea' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
    [layout.wrap],
  );
  const insert = (text: string) => {
    const view = editor.current?.view;
    if (!view) return;
    const range = view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
    });
    view.focus();
  };
  const insertImage = async () => {
    const { choice, value } = await ask(
      'Insert an image',
      ['Insert', 'Cancel'],
      'Path relative to this Markdown document:',
      '',
    );
    if (choice === 'Insert' && value.trim())
      insert(`\n![Caption](${value.trim().includes(' ') ? `<${value.trim()}>` : value.trim()})\n`);
  };
  return (
    <div
      onClick={(e) => {
        const target = e.target as Element;
        for (const menu of document.querySelectorAll<HTMLDetailsElement>('.menu[open]'))
          if (!menu.contains(target) || target.closest('.menu-popover button')) menu.open = false;
      }}
      ref={app}
      className="app"
      style={
        {
          '--editor-width': `${layout.editorWidth}px`,
          '--inspector-width': `${layout.inspectorWidth}px`,
        } as CSSProperties
      }
    >
      <header className="toolbar">
        <h1 className="wordmark">
          Folio<span className="wordmark-dot">.</span>
        </h1>
        <div className="document-name">
          {filename(path)}
          <span className={`save-state ${dirty ? 'changed' : ''}`}>
            {dirty ? 'Unsaved' : path ? 'Saved' : 'Sample'}
          </span>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => void open()}>Open</button>
          <button onClick={() => void save()}>Save</button>
          <button className="primary" onClick={() => void publish('pdf')} disabled={!latest}>
            Export PDF
          </button>
          <details className="menu">
            <summary aria-label="Document menu">More</summary>
            <div className="menu-popover">
              <button onClick={() => void save(true)}>
                Save as…<kbd>Ctrl Shift S</kbd>
              </button>
              <button disabled={!path} onClick={() => path && void open(path)}>
                Reload from disk
              </button>
              <button disabled={!latest} onClick={() => void publish('print')}>
                Print…<kbd>Ctrl P</kbd>
              </button>
              <button disabled={!latest} onClick={() => void publish('typst')}>
                Export Typst source…
              </button>
              <div className="menu-label">Recent documents</div>
              {prefs.recent.length ? (
                prefs.recent.map((p) => (
                  <button key={p} title={p} onClick={() => void open(p)}>
                    {filename(p)}
                  </button>
                ))
              ) : (
                <span className="menu-empty">No recent documents</span>
              )}
            </div>
          </details>
          <div className="pane-toggles">
            <button
              aria-pressed={layout.editor}
              onClick={() => updateLayout({ editor: !layout.editor })}
            >
              Editor
            </button>
            <button
              aria-pressed={layout.inspector}
              onClick={() => updateLayout({ inspector: !layout.inspector })}
            >
              Inspector
            </button>
          </div>
        </div>
      </header>
      <Workbench
        config={config}
        fonts={fonts}
        source={source}
        path={path}
        pdf={pdf}
        latest={latest}
        apply={(next, label) => setConfig(next, label)}
        undo={history.undo}
        redo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        variations={prefs.variations?.[path ?? 'untitled'] ?? {}}
        saveVariation={(name, value) =>
          setPrefs((old) => {
            const all = { ...old.variations },
              collection = { ...all[path ?? 'untitled'] };
            if (value) collection[name] = value;
            else delete collection[name];
            all[path ?? 'untitled'] = collection;
            return { ...old, variations: all };
          })
        }
        guides={guides}
        toggleGuides={() => setGuides((v) => !v)}
        compare={compare}
        hasBaseline={!!baseline}
        toggleCompare={() => {
          if (!baseline) captureBaseline();
          setCompare((v) => !v);
        }}
        capture={captureBaseline}
        analysis={analysis}
        openPage={(page) => {
          const view = document.querySelector('.current-preview .page-workspace');
          view?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' });
        }}
        report={report}
        templates={prefs.templates ?? {}}
        saveTemplate={(name, value) =>
          setPrefs((old) => {
            const templates = { ...old.templates };
            if (value) templates[name] = value;
            else delete templates[name];
            return { ...old, templates };
          })
        }
        modelPath={prefs.modelPath ?? null}
        onModelPath={(modelPath) => setPrefs((old) => ({ ...old, modelPath }))}
      />
      <main
        className={`workspace ${layout.editor ? '' : 'editor-hidden'} ${layout.inspector ? '' : 'inspector-hidden'}`}
      >
        {layout.editor && (
          <>
            <section className="editor-pane" aria-label="Markdown source">
              <div className="pane-heading">
                <h2>Source</h2>
                <div className="editor-actions">
                  <details className="menu">
                    <summary>Insert</summary>
                    <div className="menu-popover">
                      {[
                        ['Page break', '\n<!-- folio:pagebreak -->\n'],
                        ['Column break', '\n<!-- folio:columnbreak -->\n'],
                        ['Divider', '\n---\n'],
                        ['Contents', '\n<!-- folio:toc -->\n'],
                        ['Footnote', '[^note]\n\n[^note]: Footnote text.\n'],
                      ].map(([label, text]) => (
                        <button key={label} onClick={() => insert(text)}>
                          {label}
                        </button>
                      ))}
                      <button onClick={() => void insertImage()}>Image…</button>
                    </div>
                  </details>
                  <details className="menu">
                    <summary>View</summary>
                    <div className="menu-popover">
                      <button onClick={() => updateLayout({ lineNumbers: !layout.lineNumbers })}>
                        {layout.lineNumbers ? 'Hide' : 'Show'} line numbers
                      </button>
                      <button onClick={() => updateLayout({ wrap: !layout.wrap })}>
                        {layout.wrap ? 'Disable' : 'Enable'} word wrap
                      </button>
                      <button
                        onClick={() => {
                          if (editor.current?.view) openSearchPanel(editor.current.view);
                        }}
                      >
                        Find & replace
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              <CodeMirror
                className="source-editor"
                ref={editor}
                value={source.replace(/\r\n/g, '\n')}
                onChange={(text) =>
                  setSource(source.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text)
                }
                height="100%"
                extensions={editorExtensions}
                basicSetup={{
                  lineNumbers: layout.lineNumbers,
                  foldGutter: false,
                  highlightActiveLine: true,
                  searchKeymap: true,
                }}
                aria-label="Markdown source"
              />
              <div className="editor-foot">
                <span>Markdown</span>
                <span>{source.trim() ? source.trim().split(/\s+/).length : 0} words</span>
              </div>
            </section>
            <div
              role="separator"
              aria-label="Resize editor"
              aria-orientation="vertical"
              aria-valuenow={layout.editorWidth}
              tabIndex={0}
              className="splitter editor-splitter"
              onPointerDown={(e) => resizePanel('editor', e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateLayout({
                    editorWidth: Math.max(
                      240,
                      Math.min(650, layout.editorWidth + (e.key === 'ArrowRight' ? 20 : -20)),
                    ),
                  });
                }
              }}
            />
          </>
        )}
        <div className={`preview-composition ${compare && baseline ? 'comparing' : ''}`}>
          {compare && baseline && (
            <div className="baseline-preview">
              <div className="comparison-label">Before</div>
              <PdfPreview
                pdf={baseline.pdf}
                zoom="page"
                spread={false}
                onZoom={() => {}}
                onSpread={() => {}}
                onError={report}
                config={baseline.config}
                guides={guides}
                readOnly
              />
            </div>
          )}
          <div className="current-preview">
            {compare && baseline && <div className="comparison-label">Current</div>}
            <PdfPreview
              pdf={pdf}
              zoom={layout.zoom}
              spread={layout.spread}
              onZoom={(zoom) => updateLayout({ zoom })}
              onSpread={() => updateLayout({ spread: !layout.spread })}
              onError={report}
              config={rendered.config}
              guides={guides}
              source={rendered.source}
              fonts={fonts}
              onAnalysis={setAnalysis}
            />
          </div>
        </div>
        {layout.inspector && (
          <>
            <div
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              aria-valuenow={layout.inspectorWidth}
              tabIndex={0}
              className="splitter inspector-splitter"
              onPointerDown={(e) => resizePanel('inspector', e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateLayout({
                    inspectorWidth: Math.max(
                      260,
                      Math.min(420, layout.inspectorWidth + (e.key === 'ArrowLeft' ? 20 : -20)),
                    ),
                  });
                }
              }}
            />
            <Inspector
              config={config}
              onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              fonts={fonts}
              presets={[...Object.keys(presets), ...Object.keys(prefs.presets)]}
              custom={config.preset in prefs.presets}
              onPreset={choosePreset}
              onManage={(action) => void manage(action)}
            />
          </>
        )}
      </main>
      {(error || documentWarning) && (
        <div className="error-banner" role="alert">
          <div>
            <strong>
              {status === 'Compilation error' ? 'Typesetting needs attention' : 'Attention'}
            </strong>
            <p>{error || documentWarning}</p>
          </div>
          <button
            onClick={() => {
              setError('');
              setDocumentWarning('');
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <footer className="statusbar">
        <span className={`status-dot ${status === 'Typesetting' ? 'working' : ''}`} />
        <span>{status}</span>
        {warnings.length > 0 && (
          <details className="warnings">
            <summary>
              {warnings.length} note{warnings.length > 1 ? 's' : ''}
            </summary>
            <div>
              {warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </details>
        )}
        <span className="status-notice" role="status">
          {notice}
        </span>
        <button onClick={refresh}>Refresh</button>
        <span className="pipeline-label">Local typesetting · Pandoc / Typst</span>
      </footer>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          respond('Cancel');
        }}
        aria-labelledby="dialog-title"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            respond(question?.choices[0] ?? 'Cancel');
          }}
        >
          <h2 id="dialog-title">{question?.title}</h2>
          {question?.text && <p>{question.text}</p>}
          {question?.value !== undefined && (
            <label className="dialog-input">
              {question.title.includes('image') ? 'Image path' : 'Preset name'}
              <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </label>
          )}
          <div className="dialog-actions">
            {question?.choices.map((choice, i) => (
              <button
                key={choice}
                type={i === 0 ? 'submit' : 'button'}
                className={i === 0 ? 'primary' : ''}
                onClick={i === 0 ? undefined : () => respond(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        </form>
      </dialog>
    </div>
  );
}
