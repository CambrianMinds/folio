import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { call, native } from './bridge';
import {
  emptyHistory,
  parseRanges,
  reduceHistory,
  sourcePages,
  splitDocument,
  type OrganizerPage,
  type PageCommand,
} from './organizerModel';
import { openOrganizerPdf, ThumbnailCache } from './organizerPdf';
import './organizer.css';

export interface ImportedPdf {
  id: string;
  name: string;
  count: number;
  pdf: string;
}
interface Source extends Omit<ImportedPdf, 'pdf'> {
  doc: PDFDocumentProxy;
  compose?: boolean;
}
export interface OrganizerHandle {
  importPaths: (paths?: string[]) => Promise<void>;
  receive: (source: ImportedPdf, replace: boolean) => Promise<void>;
  hasPages: () => boolean;
}
interface Props {
  active: boolean;
  ask: (
    title: string,
    choices: string[],
    text?: string,
    value?: string,
  ) => Promise<{ choice: string; value: string }>;
  onDirty: (dirty: boolean) => void;
  onCompose: (sourceId: string) => void;
}
function PageImage({
  source,
  page,
  cache,
  large = false,
  zoom = 100,
  report,
}: {
  source?: Source;
  page: Pick<OrganizerPage, 'pageIndex' | 'rotation'>;
  cache: ThumbnailCache;
  large?: boolean;
  zoom?: number;
  report: (message: string) => void;
}) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    if (source)
      void cache
        .render(
          source.doc,
          page.pageIndex,
          page.rotation,
          large ? (1000 * zoom) / 100 : 280,
          large ? (1300 * zoom) / 100 : 360,
          () => cancelled,
        )
        .then((result) => {
          if (!cancelled) setImage(result);
        })
        .catch((e) => {
          if (!cancelled) report(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [source, page.pageIndex, page.rotation, cache, large, zoom, report]);
  return image ? (
    <img src={image} alt="" draggable={false} />
  ) : (
    <span className="thumbnail-loading">Loading page…</span>
  );
}
const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor');

export default forwardRef<OrganizerHandle, Props>(function Organizer(
  { active, ask, onDirty, onCompose },
  ref,
) {
  const [history, dispatch] = useReducer(reduceHistory, undefined, emptyHistory);
  const state = history.present;
  const [sources, setSources] = useState<Source[]>([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Add PDFs to begin.');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false),
    cancelImport = useRef(false);
  const [showSources, setShowSources] = useState(true),
    [showInspector, setShowInspector] = useState(true);
  const [sourceId, setSourceId] = useState(''),
    [sourceRange, setSourceRange] = useState(''),
    [insertAt, setInsertAt] = useState('1');
  const [splitting, setSplitting] = useState(false);
  const [view, setView] = useState<{ sourceId?: string; index: number } | null>(null),
    [zoom, setZoom] = useState(70);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 600, top: 0 });
  const grid = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLDialogElement>(null),
    anchor = useRef<string | null>(null);
  const cache = useRef(new ThumbnailCache()).current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const saved = useRef(JSON.stringify(state));
  const report = useRef((message: string) => setError(message)).current;
  useEffect(() => {
    onDirty(JSON.stringify(state) !== saved.current);
  }, [state, onDirty]);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (view) preview.current?.showModal();
    else {
      preview.current?.close();
      grid.current?.focus({ preventScroll: true });
    }
  }, [!!view]);
  useEffect(
    () => () => {
      for (const s of sourcesRef.current) void s.doc.destroy();
      if (native) void call('organizer_release', { ids: sourcesRef.current.map((s) => s.id) });
      cache.clear();
    },
    [cache],
  );
  const change = (command: PageCommand) => {
    if (busyRef.current) return;
    dispatch(command);
    setError('');
  };
  const addSource = async (imported: ImportedPdf, replace = false, compose = false) => {
    let doc: PDFDocumentProxy;
    try {
      doc = await openOrganizerPdf(imported.pdf);
    } catch (e) {
      await call('organizer_release', { ids: [imported.id] });
      throw e;
    }
    const source = { id: imported.id, name: imported.name, count: imported.count, doc, compose };
    if (doc.numPages !== source.count) {
      void doc.destroy();
      await call('organizer_release', { ids: [source.id] });
      throw Error('PDF preview page count differs from the source.');
    }
    if (replace) {
      // Old sources remain available to undo the replacement.
      setSelected([]);
    }
    setSources((old) => [...old, source]);
    const pages = sourcePages(
      source.id,
      Array.from({ length: source.count }, (_, i) => i),
    );
    dispatch(
      replace
        ? { type: 'replace', pages }
        : { type: 'insert', pages, at: stateRef.current.pages.length },
    );
    setSourceId(source.id);
    setSourceRange(`1-${source.count}`);
    setMessage(`Added ${source.name} · ${source.count} pages`);
  };
  const importPaths = async (requested?: string[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    cancelImport.current = false;
    setError('');
    try {
      const paths = requested ?? (await call<string[]>('organizer_pick'));
      for (let i = 0; i < paths.length; i++) {
        if (cancelImport.current) break;
        const path = paths[i];
        if (!/\.pdf$/i.test(path)) {
          setError('Choose PDF files for Organize.');
          continue;
        }
        setMessage(`Opening ${i + 1} of ${paths.length} · ${path.split(/[\\/]/).pop()}`);
        try {
          let imported: ImportedPdf;
          try {
            imported = await call<ImportedPdf>('organizer_import', { path, password: null });
          } catch (e) {
            if (!String(e).includes('PASSWORD_REQUIRED')) throw e;
            const answer = await ask(
              'PDF password',
              ['Open', 'Cancel'],
              path.split(/[\\/]/).pop(),
              '',
            );
            if (answer.choice !== 'Open') continue;
            imported = await call<ImportedPdf>('organizer_import', {
              path,
              password: answer.value,
            });
          }
          if (cancelImport.current) {
            await call('organizer_release', { ids: [imported.id] });
            break;
          }
          await addSource(imported);
          // Yield a frame so each import is reflected before appending the next.
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        } catch (e) {
          setError(
            `${path.split(/[\\/]/).pop()} · ${String(e).replace('PASSWORD_REQUIRED', 'Password was not accepted.')}`,
          );
        }
      }
    } catch (e) {
      report(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  useImperativeHandle(ref, () => ({
    importPaths,
    receive: async (source, replace) => {
      await addSource(source, replace, true);
    },
    hasPages: () => stateRef.current.pages.length > 0,
  }));
  const selection = state.pages.filter((p) => selected.includes(p.id));
  const rotate = (degrees: number) => change({ type: 'rotate', ids: selected, degrees });
  const duplicate = () => {
    const newIds = selection.map(() => crypto.randomUUID());
    change({ type: 'duplicate', ids: selected, newIds });
    setSelected(newIds);
  };
  const remove = () => {
    change({ type: 'delete', ids: selected });
    setSelected([]);
  };
  const exportPdf = async (documents: OrganizerPage[][], complete = false) => {
    if (busyRef.current || !documents.length || documents.some((p) => !p.length)) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('Preparing and checking PDF output…');
    const snapshot = JSON.stringify(stateRef.current);
    try {
      const path = await call<string | null>('organizer_export', { documents });
      if (path) {
        setMessage(`Exported ${path}`);
        if (complete) {
          saved.current = snapshot;
          onDirty(false);
        }
      } else setMessage('Export cancelled.');
    } catch (e) {
      report(String(e));
      setMessage('Export did not finish.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const cancel = () => {
    cancelImport.current = true;
    void call('organizer_cancel');
    setMessage('Cancelling…');
  };
  const actions = useRef({ importPaths, exportPdf, remove, rotate, duplicate });
  actions.current = { importPaths, exportPdf, remove, rotate, duplicate };
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || document.querySelector('dialog[open]')) return;
      const ctrl = e.ctrlKey || e.metaKey,
        k = e.key.toLowerCase();
      if (busyRef.current) return;
      if (ctrl && k === 'o') {
        e.preventDefault();
        void actions.current.importPaths();
      } else if (ctrl && k === 'e') {
        e.preventDefault();
        void actions.current.exportPdf([stateRef.current.pages], true);
      } else if (editable(e.target)) {
        return;
      } else if (ctrl && (k === 'z' || k === 'y')) {
        e.preventDefault();
        dispatch({ type: k === 'y' || e.shiftKey ? 'redo' : 'undo' });
      } else if (ctrl && k === 'a' && grid.current?.contains(e.target as Node)) {
        e.preventDefault();
        setSelected(stateRef.current.pages.map((p) => p.id));
      } else if (k === 'delete' && grid.current?.contains(e.target as Node)) {
        e.preventDefault();
        actions.current.remove();
      } else if (k === 'escape') {
        setSelected([]);
        setDropAt(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active]);
  const select = (page: OrganizerPage, e: React.MouseEvent) => {
    if (busy) return;
    if (e.shiftKey && anchor.current) {
      const first = state.pages.findIndex((p) => p.id === anchor.current),
        last = state.pages.indexOf(page);
      const range = state.pages
        .slice(Math.max(0, Math.min(first, last)), Math.max(first, last) + 1)
        .map((p) => p.id);
      setSelected(e.ctrlKey ? [...new Set([...selected, ...range])] : range);
    } else {
      setSelected(
        e.ctrlKey
          ? selected.includes(page.id)
            ? selected.filter((id) => id !== page.id)
            : [...selected, page.id]
          : [page.id],
      );
      anchor.current = page.id;
    }
  };
  const columns = Math.max(1, Math.floor((viewport.width - 32) / 180)),
    rowHeight = 258;
  const rowCount = Math.ceil(state.pages.length / columns);
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 2) * columns;
  const end = Math.min(
    state.pages.length,
    (Math.ceil((viewport.top + viewport.height) / rowHeight) + 2) * columns,
  );
  const dragCleanup = useRef<() => void>(() => {});
  useEffect(() => () => dragCleanup.current(), []);
  const startDrag = (
    e: Pick<
      React.PointerEvent,
      | 'button'
      | 'pointerId'
      | 'currentTarget'
      | 'clientX'
      | 'clientY'
      | 'preventDefault'
      | 'stopPropagation'
    >,
    ids: string[],
    source?: Source,
  ) => {
    if (busy || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragCleanup.current();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    if (!source) setSelected(ids);
    let target: number | null = null,
      pointerY = e.clientY,
      pointerX = e.clientX,
      frame = 0;
    const locate = () => {
      const el = grid.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = pointerY - rect.top,
        x = pointerX - rect.left - 16;
      if (pointerX < rect.left || pointerX > rect.right) {
        target = null;
        setDropAt(null);
        return;
      }
      const row = Math.max(
        0,
        Math.floor((el.scrollTop + Math.max(0, Math.min(rect.height, y)) - 16) / rowHeight),
      );
      const cellWidth = (el.clientWidth - 32) / columns;
      target = Math.min(
        state.pages.length,
        row * columns + Math.max(0, Math.min(columns, Math.round(x / cellWidth))),
      );
      setDropAt(target);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      pointerY = event.clientY;
      pointerX = event.clientX;
      locate();
    };
    const scroll = () => {
      const el = grid.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const speed = pointerY < rect.top + 45 ? -14 : pointerY > rect.bottom - 45 ? 14 : 0;
        if (speed) {
          el.scrollTop += speed;
          locate();
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      setDropAt(null);
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', abort);
      document.removeEventListener('keydown', escape);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      dragCleanup.current = () => {};
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      if (target !== null) {
        if (source)
          change({
            type: 'insert',
            pages: sourcePages(
              source.id,
              Array.from({ length: source.count }, (_, i) => i),
            ),
            at: target,
          });
        else change({ type: 'move', ids, at: target });
        setMessage(`Moved ${source ? source.count : ids.length} pages to position ${target + 1}.`);
      }
      cleanup();
      grid.current?.focus({ preventScroll: true });
    };
    const abort = () => cleanup();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cleanup();
    };
    dragCleanup.current = cleanup;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', abort);
    document.addEventListener('keydown', escape);
    frame = requestAnimationFrame(scroll);
  };
  const suppressClick = useRef(false);
  const prepareThumbnailDrag = (e: React.PointerEvent, page: OrganizerPage) => {
    if (busy || e.button !== 0 || e.pointerType !== 'mouse' || e.ctrlKey || e.shiftKey) return;
    const handle = e.currentTarget;
    const initialX = e.clientX,
      initialY = e.clientY,
      pointerId = e.pointerId;
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', cleanup);
      document.removeEventListener('pointercancel', cleanup);
      dragCleanup.current = () => {};
    };
    const move = (event: PointerEvent) => {
      if (
        event.pointerId !== pointerId ||
        Math.hypot(event.clientX - initialX, event.clientY - initialY) < 6
      )
        return;
      cleanup();
      suppressClick.current = true;
      startDrag(
        {
          button: 0,
          pointerId,
          currentTarget: handle,
          clientX: event.clientX,
          clientY: event.clientY,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
        },
        selected.includes(page.id) ? selected : [page.id],
      );
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', cleanup);
    document.addEventListener('pointercancel', cleanup);
    dragCleanup.current = cleanup;
  };
  const currentSource = sources.find((s) => s.id === sourceId);
  const viewingSource = view?.sourceId ? sources.find((s) => s.id === view.sourceId) : undefined;
  const viewingPage = view
    ? viewingSource
      ? { sourceId: viewingSource.id, pageIndex: view.index, rotation: 0 }
      : state.pages[view.index]
    : undefined;
  const viewCount = viewingSource?.count ?? state.pages.length;
  const addSourceRange = () => {
    if (!currentSource) return;
    try {
      const at = Number(insertAt);
      if (!Number.isInteger(at) || at < 1 || at > state.pages.length + 1)
        throw Error(`Insertion position must be between 1 and ${state.pages.length + 1}.`);
      const pages = sourcePages(currentSource.id, parseRanges(sourceRange, currentSource.count));
      change({ type: 'insert', pages, at: at - 1 });
      setSelected(pages.map((p) => p.id));
      setMessage(`Inserted ${pages.length} pages before position ${at}.`);
    } catch (e) {
      report((e as Error).message);
    }
  };
  return (
    <section className="organizer" hidden={!active} aria-label="Organize workspace">
      <div className="organizer-toolbar">
        <button onClick={() => void importPaths()} disabled={busy}>
          Add PDFs
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const indices = parseRanges(range, state.pages.length);
              setSelected([...new Set([...selected, ...indices.map((i) => state.pages[i].id)])]);
              setError('');
              grid.current?.focus();
            } catch (e) {
              report((e as Error).message);
            }
          }}
        >
          <input
            aria-label="Page ranges"
            placeholder="1-5, 8, 12-16"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
          <button disabled={busy || !state.pages.length}>Select pages</button>
        </form>
        <button disabled={busy || !history.past.length} onClick={() => dispatch({ type: 'undo' })}>
          Undo
        </button>
        <button
          disabled={busy || !history.future.length}
          onClick={() => dispatch({ type: 'redo' })}
        >
          Redo
        </button>
        <button
          aria-pressed={splitting}
          disabled={busy || !state.pages.length}
          onClick={() => setSplitting((v) => !v)}
        >
          Split
        </button>
        <span className="organizer-spacer" />
        <button aria-pressed={showSources} onClick={() => setShowSources((v) => !v)}>
          Sources
        </button>
        <button aria-pressed={showInspector} onClick={() => setShowInspector((v) => !v)}>
          Inspector
        </button>
        <button
          className="primary"
          disabled={busy || !state.pages.length}
          onClick={() => void exportPdf([state.pages], true)}
        >
          Export PDF
        </button>
      </div>
      {splitting && (
        <div className="split-controls">
          <span>Mark a boundary after a page using its Split after button.</span>
          <button
            disabled={busy || splitDocument(state).length < 2}
            onClick={() => void exportPdf(splitDocument(state))}
          >
            Export {splitDocument(state).length} parts
          </button>
          <button
            disabled={busy || !state.pages.length}
            onClick={() => void exportPdf(splitDocument(state, true))}
          >
            One PDF per page
          </button>
          <button onClick={() => setSplitting(false)}>Done</button>
        </div>
      )}
      <div className="organizer-body">
        {showSources && (
          <aside className="organizer-sources" aria-label="Sources">
            <div className="pane-heading">
              <strong>Sources</strong>
              <span>{sources.length} files</span>
            </div>
            <div className="source-list">
              {sources.map((source) => (
                <div
                  className={`source-item ${source.id === sourceId ? 'active' : ''}`}
                  key={source.id}
                >
                  <button
                    className="source-choice"
                    onClick={() => {
                      setSourceId(source.id);
                      setSourceRange(`1-${source.count}`);
                    }}
                  >
                    <span className="source-thumb">
                      <PageImage
                        source={source}
                        page={{ pageIndex: 0, rotation: 0 }}
                        cache={cache}
                        report={report}
                      />
                    </span>
                    <span>
                      <strong>{source.name}</strong>
                      <small>{source.count} pages</small>
                    </span>
                  </button>
                  <div className="source-actions">
                    <button
                      onClick={() => {
                        setView({ sourceId: source.id, index: 0 });
                        setZoom(70);
                      }}
                    >
                      Inspect
                    </button>
                    <button
                      className="drag-handle"
                      aria-label={`Drag all pages from ${source.name}`}
                      onPointerDown={(e) => startDrag(e, [], source)}
                    >
                      Drag pages
                    </button>
                  </div>
                  {source.compose && (
                    <button onClick={() => onCompose(source.id)}>Open in Compose</button>
                  )}
                </div>
              ))}
            </div>
            {currentSource && (
              <form
                className="source-insert"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSourceRange();
                }}
              >
                <label>
                  Source pages
                  <input
                    aria-label="Source page ranges"
                    value={sourceRange}
                    onChange={(e) => setSourceRange(e.target.value)}
                  />
                </label>
                <label>
                  Insert before output page
                  <input
                    type="number"
                    min={1}
                    max={state.pages.length + 1}
                    value={insertAt}
                    onChange={(e) => setInsertAt(e.target.value)}
                  />
                </label>
                <button disabled={busy}>Add pages</button>
              </form>
            )}
          </aside>
        )}
        <div
          className="organizer-grid"
          ref={grid}
          tabIndex={0}
          aria-label="Output pages"
          aria-busy={busy}
          onScroll={(e) => setViewport((v) => ({ ...v, top: e.currentTarget.scrollTop }))}
        >
          {!state.pages.length ? (
            <div className="organizer-empty">
              <h2>Organize your pages</h2>
              <p>Add PDFs or send a document from Compose.</p>
              <button disabled={busy} onClick={() => void importPaths()}>
                Add PDFs
              </button>
            </div>
          ) : (
            <div className="virtual-pages" style={{ height: rowCount * rowHeight + 32 }}>
              {state.pages.slice(start, end).map((page, offset) => {
                const index = start + offset,
                  source = sources.find((s) => s.id === page.sourceId);
                return (
                  <div
                    key={page.id}
                    className={`organizer-page ${selected.includes(page.id) ? 'selected' : ''}`}
                    style={{
                      left: `calc(16px + (100% - 32px) * ${index % columns} / ${columns})`,
                      top: 16 + Math.floor(index / columns) * rowHeight,
                      width: `calc((100% - 32px) / ${columns} - 16px)`,
                    }}
                  >
                    <button
                      className="thumbnail-button"
                      aria-label={`Output page ${index + 1}, ${source?.name}, source page ${page.pageIndex + 1}`}
                      aria-pressed={selected.includes(page.id)}
                      disabled={busy}
                      onPointerDown={(e) => prepareThumbnailDrag(e, page)}
                      onClick={(e) => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        select(page, e);
                      }}
                      onDoubleClick={() => {
                        setView({ index });
                        setZoom(70);
                      }}
                    >
                      <span className="thumbnail-paper">
                        <PageImage source={source} page={page} cache={cache} report={report} />
                      </span>
                      <span className="thumbnail-number">
                        {index + 1}
                        <span aria-hidden="true">{selected.includes(page.id) ? ' ●' : ''}</span>
                      </span>
                    </button>
                    <div className="page-handle-row">
                      <button
                        className="drag-handle"
                        aria-label={`Move page ${index + 1}`}
                        onPointerDown={(e) =>
                          startDrag(e, selected.includes(page.id) ? selected : [page.id])
                        }
                      >
                        Move
                      </button>
                      {splitting && index < state.pages.length - 1 && (
                        <button
                          aria-pressed={state.splitAfter.includes(page.id)}
                          onClick={() => change({ type: 'split', after: page.id })}
                        >
                          Split after
                        </button>
                      )}
                    </div>
                    {state.splitAfter.includes(page.id) && index < state.pages.length - 1 && (
                      <span className="split-mark">Split after {index + 1}</span>
                    )}
                  </div>
                );
              })}
              {dropAt !== null && (
                <div
                  className="page-insertion"
                  style={{
                    left: `calc(10px + (100% - 32px) * ${dropAt % columns} / ${columns})`,
                    top: 16 + Math.floor(dropAt / columns) * rowHeight,
                  }}
                >
                  <span>Insert here</span>
                </div>
              )}
            </div>
          )}
        </div>
        {showInspector && (
          <aside className="organizer-inspector" aria-label="Page inspector">
            <div className="pane-heading">
              <strong>Page inspector</strong>
            </div>
            <div className="page-inspector-content">
              <p>
                {selection.length ? `${selection.length} selected` : 'Select pages to organize.'}
              </p>
              {!!selection.length && (
                <>
                  <div className="inspector-buttons">
                    <button disabled={busy} onClick={() => rotate(-90)}>
                      Rotate left
                    </button>
                    <button disabled={busy} onClick={() => rotate(90)}>
                      Rotate right
                    </button>
                    <button disabled={busy} onClick={duplicate}>
                      Duplicate
                    </button>
                    <button disabled={busy} onClick={remove}>
                      Delete
                    </button>
                    <button disabled={busy} onClick={() => void exportPdf([selection])}>
                      Extract
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const at = Number(insertAt);
                      if (!Number.isInteger(at) || at < 1 || at > state.pages.length + 1) {
                        report('Enter a valid output position.');
                        return;
                      }
                      change({ type: 'move', ids: selected, at: at - 1 });
                    }}
                  >
                    <label>
                      Move before output page
                      <input
                        type="number"
                        min={1}
                        max={state.pages.length + 1}
                        value={insertAt}
                        onChange={(e) => setInsertAt(e.target.value)}
                      />
                    </label>
                    <button disabled={busy}>Move selection</button>
                  </form>
                  {selection.length === 1 && (
                    <p className="page-origin">
                      {sources.find((s) => s.id === selection[0].sourceId)?.name}
                      <br />
                      Source page {selection[0].pageIndex + 1}
                      <br />
                      Rotation adjustment {selection[0].rotation}°
                    </p>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      {error && (
        <div className="organizer-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      <footer className="organizer-status">
        <span>{state.pages.length} pages</span>
        <span role="status">{message}</span>
        {busy && <button onClick={cancel}>Cancel</button>}
        <small>
          Page content preserved. Bookmarks, tags, forms and document metadata may change on export.
        </small>
      </footer>
      <dialog
        ref={preview}
        className="organizer-preview"
        aria-label="Page preview"
        onCancel={(e) => {
          e.preventDefault();
          setView(null);
        }}
      >
        <div className="preview-navigation">
          <button
            disabled={!view || view.index <= 0}
            onClick={() => setView((v) => v && { ...v, index: v.index - 1 })}
          >
            Previous
          </button>
          <label>
            Page
            <input
              aria-label="Preview page"
              type="number"
              min={1}
              max={viewCount}
              value={(view?.index ?? 0) + 1}
              onChange={(e) =>
                setView(
                  (v) =>
                    v && {
                      ...v,
                      index: Math.max(0, Math.min(viewCount - 1, Number(e.target.value) - 1)),
                    },
                )
              }
            />
          </label>
          <span>of {viewCount}</span>
          <button
            disabled={!view || view.index >= viewCount - 1}
            onClick={() => setView((v) => v && { ...v, index: v.index + 1 })}
          >
            Next
          </button>
          <label>
            Zoom
            <input
              aria-label="Preview zoom"
              type="number"
              min={25}
              max={200}
              value={zoom}
              onChange={(e) => setZoom(Math.max(25, Math.min(200, Number(e.target.value))))}
            />
            %
          </label>
          <button onClick={() => setView(null)}>Close</button>
        </div>
        <div className="organizer-preview-page">
          {viewingPage && (
            <PageImage
              source={sources.find((s) => s.id === viewingPage.sourceId)}
              page={viewingPage}
              cache={cache}
              large
              zoom={zoom}
              report={report}
            />
          )}
        </div>
        {viewingSource && (
          <button
            disabled={busy}
            onClick={() => {
              change({
                type: 'insert',
                pages: sourcePages(viewingSource.id, [view!.index]),
                at: state.pages.length,
              });
              setMessage('Added source page to the output.');
            }}
          >
            Append this page
          </button>
        )}
      </dialog>
    </section>
  );
});
