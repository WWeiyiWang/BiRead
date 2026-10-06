import type { PDFImage } from "../parser/pdfImages";
import type { Block } from "../types";
import type { PDFIntegration } from "../reader/pdfIntegration";
import type { BilingualView } from "./bilingualView";
import { requestDeadline } from "../translation/requestDeadline";
export class FigureController {
  private observer?: IntersectionObserver;
  private disposed = false;
  private pending: number[] = [];
  private busy = false;
  private slots = new Map<number, HTMLElement>();
  private loaded = new Set<number>();
  constructor(
    private ui: BilingualView,
    private integration: PDFIntegration,
    private blocks: Block[],
  ) {
    const pages = new Map<number, Block>();
    for (const b of blocks)
      if (!pages.has(b.pageIndex)) pages.set(b.pageIndex, b);
    const Observer = (ui.doc.defaultView as any).IntersectionObserver;
    if (Observer)
      this.observer = new Observer(
        (entries: IntersectionObserverEntry[]) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              this.observer!.unobserve(entry.target);
              const data = (entry.target as HTMLElement).dataset;
              this.enqueue(Number(data.page ?? data.pageIndex));
            }
        },
        Components.utils.cloneInto(
          { root: ui.list, rootMargin: "700px 0px" },
          ui.doc.defaultView!,
          { wrapReflectors: true },
        ),
      );
    for (const [page, block] of pages) {
      const slot = ui.imageLoader(block);
      slot.dataset.page = String(page);
      this.slots.set(page, slot);
      if (this.observer) {
        this.observer.observe(slot);
        for (const row of Array.from(
          ui.root.querySelectorAll(`[data-page-index="${page}"]`),
        ) as Element[])
          this.observer.observe(row);
      } else {
        const button = ui.doc.createElement("button");
        button.textContent = "加载本页图片";
        button.onclick = () => this.enqueue(page);
        slot.append(button);
      }
    }
  }
  private enqueue(page: number) {
    if (this.disposed || this.loaded.has(page) || this.pending.includes(page))
      return;
    this.pending.push(page);
    void this.drain();
  }
  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length && !this.disposed)
        await this.loadPage(this.pending.shift()!);
    } finally {
      this.busy = false;
    }
  }
  async loadPage(page: number) {
    if (this.disposed || this.loaded.has(page)) return;
    const slot = this.slots.get(page);
    if (!slot) return;
    this.loaded.add(page);
    slot.textContent = "正在加载原图与图表预览…";
    let expired = false;
    const cancelled = () => this.disposed || expired;
    try {
      const figures = await requestDeadline<PDFImage[]>(
        this.integration.pdf.getFigures(page, this.blocks, cancelled),
        () => new Error("Preview timeout"),
        30000,
      );
      if (cancelled()) return;
      for (const figure of figures) this.ui.showImage(figure, this.blocks);
      const result = await requestDeadline<{
        images: PDFImage[];
        skipped: number;
      }>(
        this.integration.pdf.getImages(page, cancelled),
        () => new Error("Image timeout"),
        30000,
      );
      if (cancelled()) return;
      for (const image of result.images) {
        const [x1, y1, x2, y2] = image.rect;
        const included = figures.some((f) => {
          const r = f.rect,
            area =
              Math.max(0, Math.min(x2, r[2]) - Math.max(x1, r[0])) *
              Math.max(0, Math.min(y2, r[3]) - Math.max(y1, r[1]));
          return area / ((x2 - x1) * (y2 - y1)) > 0.8;
        });
        if (!included) this.ui.showImage(image, this.blocks);
      }
      const captions = this.blocks.filter(
        (b) =>
          b.pageIndex === page &&
          b.kind === "caption" &&
          !this.blocks.some((cell) => cell.table?.captionID === b.id),
      );
      const missing = captions.some(
        (c) => !figures.some((f) => f.captionID === c.id),
      );
      if (result.skipped || missing)
        slot.textContent =
          "部分图表未能可靠定位或提取，可使用图注旁的 OPEN IN PDF 查看。";
      else slot.remove();
    } catch {
      expired = true;
      if (!this.disposed) {
        slot.textContent = "图片加载未完成，正文翻译不受影响。";
        const button = this.ui.doc.createElement("button");
        button.textContent = "重试图片";
        button.onclick = () => {
          this.loaded.delete(page);
          this.enqueue(page);
        };
        slot.append(button);
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.pending = [];
    this.observer?.disconnect();
  }
}
