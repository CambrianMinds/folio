import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { call } from './bridge';
import type { Config } from './config';
import { analyzeDocument, type Analysis } from './pdfAnalysis';
GlobalWorkerOptions.workerSrc = worker;
interface Props {
  pdf: string | null;
  zoom: string;
  spread: boolean;
  onZoom: (v: string) => void;
  onSpread: () => void;
  onError: (e: string) => void;
  config?: Config;
  guides?: boolean;
  source?: string;
  fonts?: string[];
  onAnalysis?: (analysis: Analysis) => void;
  readOnly?: boolean;
}
function Page({
  doc,
  num,
  scale,
  onError,
  config,
  guides,
}: {
  doc: PDFDocumentProxy;
  num: number;
  scale: number;
  onError: (e: string) => void;
  config?: Config;
  guides?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 612, height: 792 }),
    [near, setNear] = useState(false),
    [links, setLinks] = useState<{ url: string; rect: number[] }[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: '900px',
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let canceled = false;
    let page: PDFPageProxy | undefined;
    let render: RenderTask | undefined;
    let layer: TextLayer | undefined;
    if (!near) {
      if (canvas.current) {
        canvas.current.width = 1;
        canvas.current.height = 1;
      }
      text.current?.replaceChildren();
      return;
    }
    void (async () => {
      page = await doc.getPage(num);
      if (canceled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width / scale, height: viewport.height / scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2),
        el = canvas.current!;
      el.width = Math.ceil(viewport.width * ratio);
      el.height = Math.ceil(viewport.height * ratio);
      render = page.render({
        canvas: el,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await render.promise;
      if (canceled) return;
      const textEl = text.current!;
      textEl.replaceChildren();
      textEl.style.setProperty('--scale-factor', String(scale));
      textEl.style.setProperty('--total-scale-factor', String(scale));
      layer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: textEl,
        viewport,
      });
      await layer.render();
      const annotations = await page.getAnnotations();
      if (canceled) return;
      setLinks(
        annotations
          .filter((a) => a.url && /^https?:\/\//i.test(a.url))
          .map((a) => ({ url: a.url, rect: viewport.convertToViewportRectangle(a.rect) })),
      );
    })().catch((e) => {
      if (!canceled && e?.name !== 'RenderingCancelledException') onError(String(e));
    });
    return () => {
      canceled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [doc, num, scale, near, onError]);
  return (
    <div
      className="pdf-page"
      ref={host}
      data-page={num}
      style={{ width: size.width * scale, height: size.height * scale }}
      aria-label={`Page ${num}`}
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} aria-hidden="true" />
      <div ref={text} className="textLayer" />
      {guides && config && (
        <div
          className="page-guides"
          aria-hidden="true"
          style={{
            left:
              (config.mirrored && num % 2 === 0 ? config.marginRight : config.marginLeft) * scale,
            right:
              (config.mirrored && num % 2 === 0 ? config.marginLeft : config.marginRight) * scale,
            top: config.marginTop * scale,
            bottom: config.marginBottom * scale,
          }}
        >
          {Array.from({ length: config.columns }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${(index / config.columns) * 100}%`,
                width: `calc(${100 / config.columns}% - ${((config.columns - 1) / config.columns) * config.gutter * scale}px)`,
                marginLeft: ((index * config.gutter) / config.columns) * scale,
              }}
            />
          ))}
        </div>
      )}
      {links.map((l, i) => (
        <a
          key={i}
          className="pdf-link"
          href={l.url}
          aria-label={l.url}
          onClick={(e) => {
            e.preventDefault();
            void call('open_link', { url: l.url }).catch((e) => onError(String(e)));
          }}
          style={{
            left: Math.min(l.rect[0], l.rect[2]),
            top: Math.min(l.rect[1], l.rect[3]),
            width: Math.abs(l.rect[2] - l.rect[0]),
            height: Math.abs(l.rect[3] - l.rect[1]),
          }}
        />
      ))}
      <span className="page-folio" aria-hidden="true">
        {num}
      </span>
    </div>
  );
}
export default function PdfPreview({
  pdf,
  zoom,
  spread,
  onZoom,
  onSpread,
  onError,
  config,
  guides,
  source = '',
  fonts = [],
  onAnalysis,
  readOnly = false,
}: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [viewport, setViewport] = useState({ width: 612, height: 792 }),
    [available, setAvailable] = useState({ width: 600, height: 700 }),
    [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement>(null),
    ratio = useRef(0),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!pdf) return;
    let canceled = false;
    setLoading(true);
    const bytes = Uint8Array.from(atob(pdf), (s) => s.charCodeAt(0));
    const task = getDocument({
      data: bytes,
      wasmUrl: '/pdfjs/wasm/',
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      isEvalSupported: false,
    });
    let loaded: PDFDocumentProxy | undefined;
    void task.promise
      .then(async (d) => {
        loaded = d;
        const page = await d.getPage(1);
        if (canceled) {
          void d.destroy();
          return;
        }
        const vp = page.getViewport({ scale: 1 });
        const el = scroller.current;
        ratio.current = el ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) : 0;
        setViewport({ width: vp.width, height: vp.height });
        setDoc(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!canceled) {
          setLoading(false);
          onError(`PDF preview: ${String(e)}`);
        }
      });
    return () => {
      canceled = true;
      if (!loaded) void task.destroy();
    };
  }, [pdf, onError]);
  useEffect(
    () => () => {
      void doc?.destroy();
    },
    [doc],
  );
  useEffect(() => {
    if (!doc || !config || !onAnalysis) return;
    let canceled = false;
    void analyzeDocument(doc, config, source, fonts, () => canceled)
      .then((result) => {
        if (!canceled) onAnalysis(result);
      })
      .catch((e) => {
        if (!canceled) onError(`Publishing checks: ${String(e)}`);
      });
    return () => {
      canceled = true;
    };
  }, [doc, config, source, fonts, onAnalysis, onError]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = ratio.current * Math.max(0, el.scrollHeight - el.clientHeight);
  }, [doc]);
  const fitWidth = (available.width - 64 - (spread ? 20 : 0)) / (viewport.width * (spread ? 2 : 1));
  const fitPage = Math.min(fitWidth, (available.height - 60) / viewport.height);
  const scale = Math.max(
    0.15,
    Math.min(4, zoom === 'width' ? fitWidth : zoom === 'page' ? fitPage : Number(zoom) / 100),
  );
  return (
    <section className="preview" aria-label="PDF preview">
      <div className="preview-toolbar">
        <div className="page-counter">
          <label>
            Page{' '}
            <input
              aria-label="Go to page"
              type="number"
              min={1}
              max={doc?.numPages || 1}
              value={current}
              onChange={(e) => {
                const n = Math.max(1, Math.min(doc?.numPages || 1, Number(e.target.value)));
                setCurrent(n);
                scroller.current
                  ?.querySelector(`[data-page="${n}"]`)
                  ?.scrollIntoView({ block: 'start' });
              }}
            />
          </label>
          <span>of {doc?.numPages ?? '—'}</span>
        </div>
        {!readOnly && (
          <div className="zoom-controls">
            <button
              aria-label="Zoom out"
              onClick={() => onZoom(String(Math.max(20, Math.round(scale * 100) - 10)))}
            >
              −
            </button>
            <label className="zoom-label">
              <span className="visually-hidden">Zoom</span>
              <input
                aria-label="Zoom percentage"
                type="number"
                min={20}
                max={400}
                value={Math.round(scale * 100)}
                onChange={(e) => onZoom(e.target.value || '100')}
              />
              %
            </label>
            <button
              aria-label="Zoom in"
              onClick={() => onZoom(String(Math.min(400, Math.round(scale * 100) + 10)))}
            >
              +
            </button>
            <select
              aria-label="Fit mode"
              value={['width', 'page'].includes(zoom) ? zoom : 'custom'}
              onChange={(e) => onZoom(e.target.value)}
            >
              <option value="width">Fit width</option>
              <option value="page">Fit page</option>
              <option value="custom" disabled>
                Custom
              </option>
            </select>
            <button onClick={onSpread} aria-pressed={spread}>
              Facing
            </button>
          </div>
        )}
      </div>
      <div
        ref={scroller}
        className="page-workspace"
        aria-busy={loading}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          const pages = [...el.querySelectorAll<HTMLElement>('[data-page]')];
          const first = pages.find((p) => p.offsetTop + p.offsetHeight > el.scrollTop + 50);
          if (first) setCurrent(Number(first.dataset.page));
        }}
      >
        {doc ? (
          <div
            className={`pages ${spread ? 'spread' : ''}`}
            style={{ width: spread ? viewport.width * scale * 2 + 20 : viewport.width * scale }}
          >
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Page
                key={`${doc.fingerprints[0]}-${i}`}
                doc={doc}
                num={i + 1}
                scale={scale}
                onError={onError}
                config={config}
                guides={guides}
              />
            ))}
          </div>
        ) : (
          <div className="empty-preview">
            <span className="paper-mark">F</span>
            <p>{pdf ? 'Opening pages…' : 'The page is taking shape.'}</p>
          </div>
        )}
      </div>
    </section>
  );
}
