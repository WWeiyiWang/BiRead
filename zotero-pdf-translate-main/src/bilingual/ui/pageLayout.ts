import type { Block, Rect } from "../types";
import { blockRect } from "../parser/pdfImages";
import type { BilingualView } from "./bilingualView";
/** Page/column reconstruction using selectable translated DOM, not page images. */
export class PageLayout {
  private active = false;
  zoom = 1;
  refresh() {
    this.schedule();
  }
  private observer: MutationObserver;
  private resize: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private homes = new Map<HTMLElement, Comment>();
  private pages = new Map<number, HTMLElement>();
  constructor(
    private ui: BilingualView,
    private blocks: () => Block[],
  ) {
    const win = ui.doc.defaultView as any;
    this.observer = new win.MutationObserver(() => this.schedule());
    this.observer.observe(
      this.ui.list,
      Components.utils.cloneInto(
        { childList: true, subtree: true, characterData: true },
        this.ui.doc.defaultView!,
      ),
    );
    this.resize = new win.ResizeObserver(() => this.schedule());
    this.resize.observe(ui.list);
    const style = ui.doc.createElement("style");
    style.textContent = `
      #zpt-bilingual[data-reading-mode=compare] .bi-list { background:#e8e8e8; padding:16px 8px 60px }
      #zpt-bilingual[data-reading-mode=compare] .bi-section, #zpt-bilingual[data-reading-mode=compare] .bi-image-loader { display:none }
      #zpt-bilingual .bi-paper { position:relative; background:white; color:#242424; margin:0 auto 18px; box-shadow:0 1px 4px #0003; }
      #zpt-bilingual .bi-paper .bi-row { position:absolute; margin:0; padding:0; border:0; max-width:none }
      #zpt-bilingual .bi-paper .bi-meta, #zpt-bilingual .bi-paper .bi-images, #zpt-bilingual .bi-paper .bi-table-text { display:none }
      #zpt-bilingual .bi-paper .bi-text { padding:0!important; margin:0!important; text-indent:0; line-height:1.25; font-size:inherit!important; }
      #zpt-bilingual .bi-paper .bi-columns { display:block }
      #zpt-bilingual .bi-paper img { position:absolute; display:block; width:100%; object-fit:contain }
      #zpt-bilingual .bi-paper .bi-structured-table { position:absolute; margin:0; max-width:none }
      #zpt-bilingual .bi-paper .bi-structured-table .bi-row { font-size:inherit }
      #zpt-bilingual .bi-paper .bi-structured-table td, #zpt-bilingual .bi-paper .bi-structured-table th { padding:.15em .3em }
      #zpt-bilingual .bi-page-furniture { position:absolute; pointer-events:none; white-space:pre; font-family:"Times New Roman",serif; line-height:1; transform-origin:top left }
      #zpt-bilingual .bi-page-rule { position:absolute; background:#555; pointer-events:none }
      #zpt-bilingual .bi-paper-label { position:absolute; bottom:6px; left:0; width:100%; text-align:center; font:10px system-ui; color:#777 }
      #zpt-bilingual .bi-paper .bi-row[data-preview-covered=true] { display:none }
    `;
    ui.root.append(style);
  }
  set(active: boolean) {
    this.active = active;
    if (active) this.schedule();
    else {
      clearTimeout(this.timer);
      this.observer.disconnect();
      for (const [row, home] of this.homes) {
        home.replaceWith(row);
        row.style.removeProperty("left");
        row.style.removeProperty("top");
        row.style.removeProperty("width");
        row.style.removeProperty("font-size");
        row.style.removeProperty("transform");
        row.style.removeProperty("transform-origin");
        delete row.dataset.previewCovered;
      }
      this.homes.clear();
      for (const page of this.pages.values()) page.remove();
      this.pages.clear();
      this.observer.observe(
        this.ui.list,
        Components.utils.cloneInto(
          { childList: true, subtree: true, characterData: true },
          this.ui.doc.defaultView!,
        ),
      );
    }
  }
  private schedule() {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.layout(), 80);
  }
  private layout() {
    if (!this.active) return;
    this.observer.disconnect();
    try {
      const blocks = this.blocks();
      for (const furniture of this.ui.furniture) {
        if (this.pages.has(furniture.pageIndex)) continue;
        const page = this.ui.doc.createElement("section");
        page.className = "bi-paper";
        page.dataset.pageIndex = String(furniture.pageIndex);
        page.setAttribute(
          "aria-label",
          "译文第 " + (furniture.pageIndex + 1) + " 页",
        );
        this.pages.set(furniture.pageIndex, page);
      }
      for (const row of Array.from(
        this.ui.list.querySelectorAll(".bi-structured-table, .bi-row"),
      ) as HTMLElement[]) {
        if (
          this.homes.has(row) ||
          row.parentElement?.closest(".bi-row, .bi-structured-table")
        )
          continue;
        const index = Number(row.dataset.pageIndex);
        let page = this.pages.get(index);
        if (!page) {
          page = this.ui.doc.createElement("section");
          page.className = "bi-paper";
          page.dataset.pageIndex = String(index);
          page.setAttribute("aria-label", "译文第 " + (index + 1) + " 页");
          this.pages.set(index, page);
        }
        const home = this.ui.doc.createComment("reading-row");
        row.before(home);
        this.homes.set(row, home);
        page.append(row);
      }
      for (const [index, page] of [...this.pages].sort(([a], [b]) => a - b)) {
        if (page.parentElement !== this.ui.list) {
          const next = [...this.pages]
            .sort(([a], [b]) => a - b)
            .find(
              ([i, p]) => i > index && p.parentElement === this.ui.list,
            )?.[1];
          this.ui.list.insertBefore(page, next || null);
        }
        const pageBlocks = blocks.filter((b) => b.pageIndex === index);
        const furniture = this.ui.furniture.find((p) => p.pageIndex === index);
        const box: Rect = furniture?.box ||
          pageBlocks[0]?.pageBox || [
            0,
            0,
            612,
            pageBlocks[0]?.pageHeight || 792,
          ];
        const baseWidth = box[2] - box[0],
          baseHeight = box[3] - box[1];
        const scale = Math.min(
          4,
          Math.max(
            0.3,
            ((this.ui.list.clientWidth - 24) / baseWidth) * this.zoom,
          ),
        );
        page.style.width = baseWidth * scale + "px";
        page
          .querySelectorAll(
            ":scope > .bi-paper-label, :scope > .bi-page-furniture, :scope > .bi-page-rule",
          )
          .forEach((e) => e.remove());
        for (const glyph of furniture?.glyphs || []) {
          const span = this.ui.doc.createElement("span");
          span.className = "bi-page-furniture";
          span.textContent = glyph.text;
          span.style.left = (glyph.rect[0] - box[0]) * scale + "px";
          span.style.top = (box[3] - glyph.rect[3]) * scale + "px";
          span.style.fontSize =
            (glyph.fontSize || glyph.rect[3] - glyph.rect[1]) * scale + "px";
          if (glyph.bold) span.style.fontWeight = "bold";
          if (glyph.italic) span.style.fontStyle = "italic";
          page.append(span);
          const width = span.getBoundingClientRect().width;
          if (width > 0)
            span.style.transform =
              "scaleX(" +
              ((glyph.rect[2] - glyph.rect[0]) * scale) / width +
              ")";
        }
        for (const r of furniture?.rules || []) {
          const rule = this.ui.doc.createElement("div");
          rule.className = "bi-page-rule";
          rule.style.cssText =
            "left:" +
            (r[0] - box[0]) * scale +
            "px;top:" +
            (box[3] - r[3]) * scale +
            "px;width:" +
            (r[2] - r[0]) * scale +
            "px;height:" +
            Math.max(0.4, (r[3] - r[1]) * scale) +
            "px";
          page.append(rule);
        }
        const objects: { node: HTMLElement; rect: Rect; image?: boolean }[] =
          [];
        const figureRects: Rect[] = [];
        for (const table of Array.from(
          page.querySelectorAll(":scope > .bi-structured-table"),
        ) as HTMLElement[]) {
          table.style.fontSize = 10 * scale + "px";
          objects.push({ node: table, rect: JSON.parse(table.dataset.rect!) });
        }
        for (const figure of Array.from(
          page.querySelectorAll(".bi-figure"),
        ) as HTMLElement[]) {
          const source = figure.querySelector("img");
          if (!source || !figure.dataset.rect) continue;
          const rect = JSON.parse(figure.dataset.rect) as Rect;
          figureRects.push(rect);
          let img = page.querySelector(
            'img[data-preview-id="' + figure.dataset.imageId + '"]',
          ) as HTMLImageElement | null;
          if (!img) {
            img = this.ui.doc.createElement("img");
            img.dataset.previewId = figure.dataset.imageId;
            img.src = source.src;
            img.alt = source.alt;
            page.append(img);
          }
          objects.push({ node: img, rect, image: true });
        }
        for (const row of Array.from(
          page.querySelectorAll(":scope > .bi-row"),
        ) as HTMLElement[]) {
          const block = pageBlocks.find((b) => b.id === row.dataset.blockId);
          if (!block?.anchors.length) continue;
          const rect = blockRect(block);
          const covered =
            block.kind !== "caption" &&
            figureRects.some((r) =>
              block.anchors.every((a) => {
                const x = (a.rect[0] + a.rect[2]) / 2,
                  y = (a.rect[1] + a.rect[3]) / 2;
                return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
              }),
            );
          row.dataset.previewCovered = String(covered);
          if (covered) continue;
          row.style.fontSize =
            Math.max(8, Math.min(22, block.fontSize || 10)) * scale + "px";
          objects.push({ node: row, rect });
        }
        objects.sort((a, b) => b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
        for (const item of objects) {
          const r = item.rect;
          const width = Math.max(1, (r[2] - r[0]) * scale);
          const height = Math.max(1, (r[3] - r[1]) * scale);
          item.node.style.left = (r[0] - box[0]) * scale + "px";
          item.node.style.top = (box[3] - r[3]) * scale + "px";
          item.node.style.width = width + "px";
          if (item.image) item.node.style.height = height + "px";
          else {
            // Fit selectable text inside its original region without shifting
            // subsequent sections, figures or the original page footer.
            item.node.style.removeProperty("transform");
            let low = 0.1;
            let high = parseFloat(item.node.style.fontSize);
            if (item.node.getBoundingClientRect().height > height) {
              for (let n = 0; n < 12; n++) {
                const size = (low + high) / 2;
                item.node.style.fontSize = size + "px";
                if (item.node.getBoundingClientRect().height <= height)
                  low = size;
                else high = size;
              }
              item.node.style.fontSize = low + "px";
              const measured = item.node.getBoundingClientRect().height;
              if (measured > height + 0.5) {
                item.node.style.transformOrigin = "top left";
                item.node.style.transform = "scaleY(" + height / measured + ")";
              }
            }
          }
        }
        page.style.height = baseHeight * scale + "px";
      }
    } finally {
      this.observer.observe(
        this.ui.list,
        Components.utils.cloneInto(
          { childList: true, subtree: true, characterData: true },
          this.ui.doc.defaultView!,
        ),
      );
    }
  }
  dispose() {
    this.set(false);
    this.observer.disconnect();
    this.resize.disconnect();
  }
}
