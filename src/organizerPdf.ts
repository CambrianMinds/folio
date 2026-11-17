import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = worker;
export async function openOrganizerPdf(pdf: string): Promise<PDFDocumentProxy> {
  return getDocument({
    data: Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)),
    wasmUrl: '/pdfjs/wasm/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    isEvalSupported: false,
  }).promise;
}
export class ThumbnailCache {
  private cache = new Map<string, string>();
  private pending: Array<() => Promise<void>> = [];
  private active = 0;
  clear() {
    this.cache.clear();
  }
  private drain() {
    while (this.active < 3 && this.pending.length) {
      this.active++;
      void this.pending.shift()!().finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
  render(
    doc: PDFDocumentProxy,
    pageIndex: number,
    rotation: number,
    width: number,
    height: number,
    cancelled: () => boolean,
  ): Promise<string | null> {
    // Revisions can share a permanent PDF ID while containing different pages.
    const key = `${doc.loadingTask.docId}:${pageIndex}:${rotation}:${width}:${height}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      this.pending.push(async () => {
        if (cancelled()) {
          resolve(null);
          return;
        }
        try {
          const page = await doc.getPage(pageIndex + 1);
          if (cancelled()) {
            resolve(null);
            return;
          }
          const original = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
          const viewport = page.getViewport({
            scale: Math.min(width / original.width, height / original.height),
            rotation: (page.rotate + rotation) % 360,
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const url = canvas.toDataURL('image/png');
          canvas.width = canvas.height = 1;
          if (cancelled()) {
            resolve(null);
            return;
          }
          if (width <= 320) {
            this.cache.set(key, url);
            if (this.cache.size > 180) this.cache.delete(this.cache.keys().next().value!);
          }
          resolve(url);
        } catch (e) {
          if (cancelled()) resolve(null);
          else reject(e);
        }
      });
      this.drain();
    });
  }
}
