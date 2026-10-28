import { getPref, setPref } from "../../utils/prefs";
import { tableTextBlocks } from "../parser/figureRegions";
import { imageAnchor, sameRegion, type PDFImage } from "../parser/pdfImages";
import type { Block, LinkedAnnotation, PageFurniture } from "../types";
import { renderHighlights } from "../annotations/translatedHighlightRenderer";
import { pageContinuations } from "../parser/pageContinuations";
import { readerTheme } from "./readerTheme";
import { selectionOffsets, restoreSelection } from "./textSelection";
import { createReadingGuide, guideFigureImages } from "./readingGuide";
import { portableReader } from "./portableReader";

export class BilingualView {
  onReference = (_link: import("../parser/referenceLinks").ReadingLink) => {};
  preparePortable = async () => {};
  private exporting = false;
  private portableImages = new Map<string, PDFImage>();
  private guidePanel?: HTMLElement;
  private paperGuide?: import("../translation/paperGuide").PaperGuide;
  generateGuide: import("./readingGuide").GuideOptions["generate"] =
    async () => {
      throw new Error("论文尚未就绪");
    };
  loadGuideFigure = async (_block: Block) => {};

  private mathImages = new Map<string, PDFImage>();
  private renderInlineMath(block: Block) {
    const row = this.rows.get(block.id);
    if (!row) return;
    const selection = this.doc.getSelection();
    const range =
      selection?.rangeCount && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : undefined;
    const selectedCell =
      range &&
      [row.source, row.translation].find(
        (cell) =>
          cell.contains(range.startContainer) &&
          cell.contains(range.endContainer),
      );
    const selected =
      selectedCell && range ? selectionOffsets(selectedCell, range) : undefined;
    for (const math of block.inlineMath || []) {
      const image = this.mathImages.get(math.id);

      for (const cell of [row.source, row.translation]) {
        for (const existing of Array.from(
          cell.querySelectorAll("[data-inline-math]"),
        ) as HTMLElement[]) {
          if (existing.dataset.inlineMath === math.id)
            existing.replaceWith(this.doc.createTextNode(math.token));
        }
        const walker = this.doc.createTreeWalker(cell, 4);
        const nodes: Text[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode as Text);
        for (const node of nodes) {
          if (node.parentElement?.closest("[data-inline-math]")) continue;
          const at = node.data.indexOf(math.token);
          if (at < 0) continue;
          const span = this.doc.createElement("span");
          span.dataset.inlineMath = math.id;
          span.dataset.textToken = math.token;
          const text = this.doc.createElement("span");
          text.textContent = math.token;
          text.style.fontSize = "0";
          const img = this.doc.createElement("img");
          if (image) img.src = image.src;
          img.alt = "公式加载中";
          const h = Math.max(1, math.rect[3] - math.rect[1]);
          img.style.cssText = `display:inline-block;vertical-align:middle;height:${Math.max(1, h / (block.fontSize || 8))}em;width:auto;max-width:100%;margin:0 .15em`;
          span.append(text);
          if (image) {
            img.alt = "原文公式";
            span.append(img);
          } else {
            const pending = this.doc.createElement("span");
            pending.textContent = "〔公式加载中〕";
            span.append(pending);
          }
          node.replaceWith(
            this.doc.createTextNode(node.data.slice(0, at)),
            span,
            this.doc.createTextNode(node.data.slice(at + math.token.length)),
          );
        }
      }
    }
    if (selectedCell && selected) restoreSelection(selectedCell, selected);
  }
  private continuationUndo: (() => void)[] = [];
  private renderedBlocks: Block[] = [];
  setContinuousReading(active: boolean) {
    for (const undo of this.continuationUndo.reverse()) undo();
    this.continuationUndo = [];
    if (!active) return;
    const groups = new Map<string, [HTMLElement, HTMLElement]>();
    for (const [a, b] of pageContinuations(this.renderedBlocks)) {
      const first = this.rows.get(a.id),
        next = this.rows.get(b.id);
      if (!first || !next) continue;
      let cells = groups.get(a.id);
      if (!cells) {
        const columns = first.source.parentElement!;
        cells = [this.doc.createElement("div"), this.doc.createElement("div")];
        cells[0].className = "bi-source";
        cells[1].className = "bi-translation";
        for (const [i, node] of [first.source, first.translation].entries()) {
          const home = this.doc.createComment("continuation");
          node.before(home);
          columns.append(cells[i]);
          cells[i].append(node);
          node.dataset.blockId = a.id;
          node.style.display = "inline";
          node.style.padding = "0";
          this.continuationUndo.push(() => {
            home.replaceWith(node);
            node.style.removeProperty("display");
            node.style.removeProperty("padding");
            cells![i].remove();
          });
        }
      }
      for (const [i, node] of [next.source, next.translation].entries()) {
        const home = this.doc.createComment("continuation");
        node.before(home);
        const space = this.doc.createTextNode(" ");
        cells[i].append(space, node);
        node.dataset.blockId = b.id;
        node.style.display = "inline";
        node.style.padding = "0";
        this.continuationUndo.push(() => {
          home.replaceWith(node);
          space.remove();
          node.style.removeProperty("display");
          node.style.removeProperty("padding");
        });
      }
      next.row.hidden = true;
      this.continuationUndo.push(() => {
        next.row.hidden = false;
      });
      groups.set(b.id, cells);
    }
  }
  furniture: PageFurniture[] = [];
  readonly root: HTMLElement;
  readonly list: HTMLElement;
  readonly status: HTMLElement;
  readonly controls: HTMLElement;
  readonly primary: HTMLElement;
  readonly modeRow: HTMLElement;
  readonly settings: HTMLElement;
  readonly inspector: HTMLElement;
  private rows = new Map<
    string,
    { row: HTMLElement; source: HTMLElement; translation: HTMLElement }
  >();
  private disposed = false;
  private scrollTimer?: ReturnType<typeof setTimeout>;
  dispose() {
    this.disposed = true;
    clearTimeout(this.scrollTimer);
  }
  onReadingMode = (_mode: string) => {};
  onVisibleBlock = (_id: string) => {};
  onAnnotation = (_key: string) => {};
  onHover = (_key?: string) => {};
  constructor(
    readonly doc: Document,
    onPDF: () => void,
    onBlock: (block: Block) => void,
  ) {
    const root = doc.createElement("section");
    root.id = "zpt-bilingual";
    root.setAttribute("aria-label", "Bilingual reading");
    const style = doc.createElement("style");
    style.textContent = `
      #zpt-bilingual { position:fixed; inset:0; z-index:100; display:flex; flex-direction:column; background:var(--material-background,#faf9f6); color:var(--fill-primary,#262626); font:15px/1.8 system-ui,sans-serif; --columns:42fr 58fr; }
      #zpt-bilingual[hidden] { display:none }
      #zpt-bilingual * { box-sizing:border-box }
      #zpt-bilingual .bi-controls { display:flex; flex-direction:column; gap:8px; padding:8px 14px; border-bottom:1px solid #8884; font:12px/1.4 system-ui; }
      #zpt-bilingual .bi-toolbar-primary { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      #zpt-bilingual .bi-settings { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      #zpt-bilingual .bi-controls[data-collapsed=true] .bi-settings { display:none }
      #zpt-bilingual .bi-mode-row { display:flex; align-items:center; gap:10px; min-height:30px; padding:0 4px; border-bottom:1px solid #8882; }
      #zpt-bilingual .bi-mode-label { font-size:12px; opacity:.72; }
      #zpt-bilingual .bi-mode-switch { min-width:180px; padding:4px 9px!important; font-size:12px!important; font-weight:500!important; }
      #zpt-bilingual .bi-collapse-settings { margin-left:auto; background:#fff!important; border-color:#1769d2!important; color:#1769d2!important; font-weight:650!important; }
      #zpt-bilingual button, #zpt-bilingual select { color:inherit; background:transparent; border:1px solid #8886; border-radius:5px; padding:5px 9px; cursor:pointer; font:12px system-ui }
      #zpt-bilingual button:focus-visible { outline:2px solid #467dc7 }
      #zpt-bilingual .bi-list { overflow:auto; flex:1; padding:12px 24px 60px; scroll-behavior:auto; }
      #zpt-bilingual .bi-row { max-width:1400px; margin:0 auto; border-bottom:1px solid #8883; padding:16px 0; }
      #zpt-bilingual .bi-columns { display:grid; grid-template-columns:var(--columns); }
      #zpt-bilingual .bi-text { white-space:pre-wrap; overflow-wrap:anywhere; min-width:0; padding:4px 22px; user-select:text; }
      #zpt-bilingual .bi-source { font-family:Georgia,serif; }
      #zpt-bilingual .bi-translation { border-left:1px solid #8883; font-family:system-ui,sans-serif; }
      #zpt-bilingual .bi-row[data-kind=heading] .bi-text, #zpt-bilingual .bi-row[data-kind=title] .bi-text { font-weight:700; line-height:1.45; margin:0; font-size:1.2em }
      #zpt-bilingual .bi-row[data-kind=title] .bi-text { font-size:1.8em; text-align:center; padding-top:18px; padding-bottom:18px }
      #zpt-bilingual .bi-row[data-level="1"] { padding-top:28px }
      #zpt-bilingual .bi-row[data-level="1"] .bi-text { font-size:1.4em }
      #zpt-bilingual .bi-row[data-level="2"] .bi-text { font-size:1.18em }
      #zpt-bilingual .bi-row[data-level="3"] .bi-text { font-size:1.05em }
      #zpt-bilingual .bi-row[data-kind=caption] .bi-text { font-size:.9em; line-height:1.6 }
      #zpt-bilingual .bi-row[data-kind=list] { padding-top:8px; padding-bottom:8px; border-bottom:0 }
      #zpt-bilingual .bi-row[data-kind=list] .bi-text { padding-left:38px; text-indent:-12px }
      #zpt-bilingual .bi-row[data-kind=footnote] .bi-text { font-size:.9em; line-height:1.65 }
      #zpt-bilingual .bi-section { margin:0; padding:0 }
      #zpt-bilingual .bi-section + .bi-section { margin-top:18px }
      #zpt-bilingual .bi-outline { max-width:300px }
      #zpt-bilingual .bi-row[data-kind=abstract] .bi-text { padding-left:34px; padding-right:34px }
      #zpt-bilingual .bi-meta { opacity:.7; font:11px system-ui; padding:0 22px 8px; display:flex; justify-content:space-between; align-items:center }
      #zpt-bilingual mark { color:inherit; cursor:pointer; border-radius:2px; }
      #zpt-bilingual mark.bi-linked-hover { outline:2px solid #6b87ab; }
      #zpt-bilingual .bi-inspector:empty { display:none }
      #zpt-bilingual .bi-inspector { max-height:35%; overflow:auto; padding:10px 20px; border-top:1px solid #8884; }
      #zpt-bilingual textarea { width:100%; min-height:90px; background:transparent; color:inherit; font:14px/1.6 system-ui; }
      #zpt-bilingual .bi-images { padding:12px 22px; display:flex; flex-wrap:wrap; justify-content:center; gap:16px }
      #zpt-bilingual .bi-table-text { margin:10px 22px; padding:8px 12px; border:1px solid #8883; border-radius:6px }
      #zpt-bilingual .bi-table-text summary { cursor:pointer; font:13px/1.6 system-ui }
      #zpt-bilingual .bi-figure { margin:0; max-width:100%; text-align:center }
      #zpt-bilingual .bi-figure img { display:block; max-width:100%; max-height:560px; width:auto; height:auto; object-fit:contain; background:white; border:1px solid #8883; cursor:zoom-in }
      #zpt-bilingual .bi-figure img.bi-expanded { max-height:none; cursor:zoom-out }
      #zpt-bilingual .bi-figure figcaption { font:12px/1.5 system-ui; opacity:.8; padding:6px }
      #zpt-bilingual .bi-image-loader { max-width:1400px; margin:0 auto; padding:8px 22px; font:12px/1.5 system-ui; opacity:.8 }
      #zpt-bilingual .bi-wait { opacity:.55 }
      #zpt-bilingual .bi-structured-table { max-width:1400px; margin:14px auto; overflow:visible }
      #zpt-bilingual .bi-structured-table table { border-collapse:collapse; table-layout:fixed; width:100%; font:inherit }
      #zpt-bilingual .bi-structured-table td, #zpt-bilingual .bi-structured-table th { border:1px solid #8887; padding:7px; text-align:left; vertical-align:top; overflow-wrap:anywhere }
      #zpt-bilingual .bi-structured-table th { background:#8881; font-weight:700 }
      #zpt-bilingual .bi-structured-table .bi-row { position:static!important; margin:0; padding:0; border:0; width:auto!important; max-width:none }
      #zpt-bilingual .bi-structured-table .bi-meta { display:none }
      #zpt-bilingual .bi-structured-table .bi-columns { grid-template-columns:1fr }
      #zpt-bilingual .bi-structured-table .bi-translation { border-left:0; border-top:1px solid #8883; margin-top:6px; padding-top:6px }
      #zpt-bilingual .bi-structured-table .bi-text { padding:2px 6px; line-height:1.5 }

      #zpt-bilingual .bi-list { font-size:var(--reading-size,15px); line-height:var(--reading-line,1.8) }
      #zpt-bilingual[data-language=translation] .bi-source, #zpt-bilingual[data-language=source] .bi-translation { display:none }
      #zpt-bilingual[data-language=translation] .bi-columns, #zpt-bilingual[data-language=source] .bi-columns { grid-template-columns:1fr }
      #zpt-bilingual[data-language=translation] .bi-translation { border-left:0 }
      #zpt-bilingual[data-language=translation] .bi-row, #zpt-bilingual[data-language=source] .bi-row { max-width:960px }
      #zpt-bilingual .bi-status { flex-basis:100%; font-size:11px; opacity:.8 }
      #zpt-bilingual[data-reading-mode=compare] .bi-source { display:none }
      #zpt-bilingual[data-reading-mode=compare] .bi-columns { grid-template-columns:1fr }
      #zpt-bilingual[data-reading-mode=compare] .bi-translation { display:block; border:0 }

    `;
    style.textContent += readerTheme;
    root.append(style);
    this.controls = doc.createElement("div");
    this.controls.className = "bi-controls";
    this.primary = doc.createElement("div");
    this.primary.className = "bi-toolbar-primary";
    this.modeRow = doc.createElement("div");
    this.modeRow.className = "bi-mode-row";
    const modeLabel = doc.createElement("span");
    modeLabel.className = "bi-mode-label";
    modeLabel.textContent = "阅读方式";
    this.modeRow.append(modeLabel);
    this.settings = doc.createElement("div");
    this.settings.className = "bi-settings";
    this.controls.append(this.primary, this.modeRow, this.settings);
    this.controls.dataset.collapsed = String(
      getPref("bilingual.controlsCollapsed") !== false,
    );
    this.status = doc.createElement("span");
    this.status.className = "bi-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    const pdfButton = this.button("返回 PDF", onPDF);
    const title = doc.createElement("strong");
    title.className = "bi-brand";
    // Inline vector also works inside the PDF reader's restricted document.
    const logo = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    logo.setAttribute("viewBox", "0 0 512 512");
    logo.setAttribute("aria-hidden", "true");
    for (const mirrored of [false, true]) {
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M64 108C64 93 77 88 93 92C147 104 197 133 243 177V448C207 425 158 405 107 392C76 384 64 370 64 344V285C64 265 69 253 82 244C68 235 64 223 64 206Z",
      );
      path.setAttribute("fill", mirrored ? "#3B3B3B" : "#CDBA9D");
      if (mirrored)
        path.setAttribute("transform", "translate(512 0) scale(-1 1)");
      logo.append(path);
      const lines = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      lines.setAttribute("d", "M124 205L188 235M124 275L188 305");
      lines.setAttribute("stroke", "white");
      lines.setAttribute("stroke-width", "24");
      lines.setAttribute("stroke-linecap", "round");
      if (mirrored)
        lines.setAttribute("transform", "translate(512 0) scale(-1 1)");
      logo.append(lines);
    }
    title.append(logo, doc.createTextNode("BiRead"));
    this.primary.append(title, pdfButton);
    this.primary.append(
      this.button("论文导读", () => {
        this.guidePanel?.remove();
        this.guidePanel = createReadingGuide(
          doc,
          this.renderedBlocks,
          onBlock,
          {
            generate: this.generateGuide,
            cached: this.paperGuide,
            save: (guide) => {
              this.paperGuide = guide;
            },
            figure: async (block) => {
              await this.loadGuideFigure(block);
              return guideFigureImages(
                [...this.portableImages.values()],
                block,
              );
            },
          },
        );
        (this.guidePanel as HTMLDetailsElement).open = true;
        this.list.before(this.guidePanel);
      }),
    );
    this.primary.append(
      this.button("导出离线阅读文件", async () => {
        if (this.exporting) return;
        this.exporting = true;
        try {
          if (!this.renderedBlocks.length)
            throw new Error("请先打开论文并完成解析");
          const { FilePicker } = ChromeUtils.importESModule(
            "chrome://zotero/content/modules/filePicker.mjs",
          ) as any;
          const picker = new FilePicker();
          picker.init(
            Zotero.getMainWindow(),
            "导出 BiRead 离线阅读文件",
            picker.modeSave,
          );
          picker.appendFilter("BiRead 阅读文件", "*.html");
          picker.defaultString = "BiRead-paper.html";
          const result = await picker.show();
          if (result !== picker.returnOK && result !== picker.returnReplace)
            return;
          const snapshot = this.renderedBlocks;
          this.status.textContent = "正在准备全文公式与图表，完成后导出…";
          await this.preparePortable();
          if (snapshot !== this.renderedBlocks)
            throw new Error("论文已切换，请重新导出");
          await IOUtils.writeUTF8(
            picker.file,
            portableReader(this.renderedBlocks, [
              ...this.portableImages.values(),
            ]),
          );
          this.status.textContent =
            "阅读文件已导出。包含当前已加载的图片和译文；未就绪内容在文件中明确提示。";
        } catch (error) {
          this.status.textContent = `导出失败：${String(error)}`;
        } finally {
          this.exporting = false;
        }
      }),
    );
    this.controls.append(this.status);
    const ratio = doc.createElement("select");
    ratio.setAttribute("aria-label", "Column ratio");
    for (const value of ["42 / 58", "50 / 50"]) {
      const option = doc.createElement("option");
      option.textContent =
        value === "42 / 58" ? "栏宽 · 译文优先" : "栏宽 · 左右等宽";
      option.value = value;
      ratio.append(option);
    }
    ratio.onchange = () =>
      root.style.setProperty(
        "--columns",
        ratio.selectedIndex ? "1fr 1fr" : "42fr 58fr",
      );
    this.settings.append(ratio);
    this.list = doc.createElement("div");
    this.list.className = "bi-list";
    this.inspector = doc.createElement("div");
    this.inspector.className = "bi-inspector";
    root.append(this.controls, this.list, this.inspector);
    doc.body.append(root);
    this.root = root;
    this.openBlock = onBlock;
    const modeSwitch = this.selectSetting(
      "阅读模式",
      "bilingual.readingMode",
      [
        ["immersive", "沉浸式阅读"],
        ["compare", "PDF 对照"],
      ],
      "immersive",
      (value) => {
        for (const label of ["显示语言", "字号", "行距", "Column ratio"]) {
          const control = this.controls.querySelector(
            'select[aria-label="' + label + '"]',
          ) as HTMLSelectElement | null;
          if (control) control.disabled = value === "compare";
        }
        root.dataset.readingMode = value;
        this.onReadingMode(value);
      },
    );
    modeSwitch.classList.add("bi-mode-switch");
    this.modeRow.append(modeSwitch);
    const collapse = doc.createElement("button");
    collapse.type = "button";
    collapse.className = "bi-collapse-settings";
    const renderCollapse = () => {
      const collapsed = this.controls.dataset.collapsed === "true";
      collapse.textContent = collapsed ? "阅读设置 ▾" : "收起设置 ▴";
      collapse.setAttribute("aria-expanded", String(!collapsed));
      collapse.setAttribute("aria-label", collapsed ? "显示设置" : "收起设置");
    };
    collapse.onclick = () => {
      this.controls.dataset.collapsed = String(
        this.controls.dataset.collapsed !== "true",
      );
      setPref(
        "bilingual.controlsCollapsed",
        this.controls.dataset.collapsed === "true",
      );
      renderCollapse();
    };
    renderCollapse();
    this.primary.append(collapse);
    this.selectSetting(
      "显示语言",
      "bilingual.language",
      [
        ["both", "中英对照"],
        ["translation", "仅中文"],
        ["source", "仅英文"],
      ],
      "both",
      (value) => (root.dataset.language = value),
    );
    this.selectSetting(
      "字号",
      "bilingual.fontSize",
      [12, 14, 15, 16, 18, 20, 22, 24, 28].map((n) => [String(n), "字号 " + n]),
      "15",
      (value) => root.style.setProperty("--reading-size", value + "px"),
    );
    this.selectSetting(
      "行距",
      "bilingual.lineHeight",
      [1.4, 1.6, 1.8, 2, 2.2].map((n) => [String(n), "行距 " + n]),
      "1.8",
      (value) => root.style.setProperty("--reading-line", value),
    );
    doc.defaultView?.addEventListener("unload", () => this.dispose(), {
      once: true,
    });
    this.list.addEventListener("scroll", () => {
      if (this.disposed) return;
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        if (this.disposed) return;
        const id = this.visibleBlock();
        if (id) this.onVisibleBlock(id);
      }, 160);
    });
  }
  selectSetting(
    label: string,
    pref: string,
    options: string[][],
    fallback: string,
    apply: (value: string) => void,
  ) {
    const select = this.doc.createElement("select");
    select.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const option = this.doc.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    const saved = String(getPref(pref) || fallback);
    select.value = options.some(([v]) => v === saved) ? saved : fallback;
    apply(select.value);
    select.onchange = () => {
      setPref(pref, select.value);
      apply(select.value);
    };
    if (["显示语言", "字号", "行距"].includes(label))
      select.disabled = this.root.dataset.readingMode === "compare";
    select.title = label;
    if (["显示语言", "字号"].includes(label)) this.modeRow.append(select);
    else this.settings.append(select);
    return select;
  }
  private openBlock: (block: Block) => void;
  button(label: string, callback: () => void) {
    const button = this.doc.createElement("button");
    button.type = "button";
    const labels: Record<string, string> = {
      Pause: "暂停翻译",
      "Retry / Resume": "继续 / 重试",
      Glossary: "术语表",
      "Highlight selection": "高亮",
      "Underline selection": "划线",
    };
    button.textContent = labels[label] || label;
    button.title = button.textContent;
    button.onclick = callback;
    if (
      [
        "Pause",
        "Retry / Resume",
        "Highlight selection",
        "Underline selection",
      ].includes(label)
    )
      this.modeRow.append(button);
    else this.settings.append(button);
    return button;
  }
  showBlocks(blocks: Block[]) {
    this.portableImages.clear();
    this.paperGuide = undefined;
    this.guidePanel?.remove();
    this.setContinuousReading(false);
    this.renderedBlocks = blocks;
    this.rows.clear();
    this.list.replaceChildren();
    const fragment = this.doc.createDocumentFragment();
    this.controls.querySelector(".bi-outline")?.remove();
    const outline = this.doc.createElement("select");
    outline.className = "bi-outline";
    outline.setAttribute("aria-label", "章节导航");
    const placeholder = this.doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "按章节跳转…";
    outline.append(placeholder);
    for (const b of blocks.filter(
      (b) => b.kind === "heading" || b.kind === "title",
    )) {
      const option = this.doc.createElement("option");
      option.value = b.id;
      option.textContent =
        "　".repeat(Math.max(0, (b.headingLevel || 1) - 1)) +
        b.source.slice(0, 100);
      outline.append(option);
    }
    outline.onchange = () => {
      if (outline.value) this.scrollTo(outline.value);
    };
    this.modeRow.append(outline);
    const tables = new Map<string, HTMLElement>();
    let section: HTMLElement | undefined;
    let sectionID: string | undefined;
    for (const block of blocks) {
      const row = this.doc.createElement("article");
      row.className = "bi-row";
      row.dataset.blockId = block.id;
      row.dataset.kind = block.kind;
      row.dataset.pageIndex = String(block.pageIndex);
      if (["equation", "original-page"].includes(block.kind))
        row.dataset.originalEquation = "true";
      if (block.kind === "equation") {
        const loading = this.doc.createElement("p");
        loading.className = "bi-equation-loading";
        loading.textContent = block.layoutIssues?.includes("local-original")
          ? "局部原版 · 等待加载"
          : "原文公式 · 等待加载";
        row.append(loading);
      }
      if (block.sectionID) row.dataset.sectionId = block.sectionID;
      if (block.headingLevel) row.dataset.level = String(block.headingLevel);
      const meta = this.doc.createElement("div");
      meta.className = "bi-meta";
      const label = this.doc.createElement("span");
      const kinds: Record<string, string> = {
        "author-info": "作者信息 · Authors & affiliations",
        "publication-info": "出版信息",
        "original-page": "原版保留 · 本页未翻译",
        title: "标题",
        heading: "章节",
        paragraph: "正文",
        abstract: "摘要",
        list: "列表",
        caption: "图表说明",
        reference: "参考文献 · Reference",
        equation: "公式",
        "table-cell": "表格",
      };
      label.textContent =
        block.kind === "footnote"
          ? `第 ${block.pageLabel} 页 · ${/corresponding author/i.test(block.source) ? "通讯作者脚注" : "脚注"}`
          : `第 ${block.pageLabel} 页 · ${kinds[block.kind] || block.kind}`;
      const jump = this.doc.createElement("button");
      jump.textContent =
        block.kind === "caption" ? "原图 / 原表 ↗" : "原文定位 ↗";
      jump.onclick = () => this.openBlock(block);
      meta.append(label, jump);
      if (
        block.kind === "caption" &&
        block.layoutIssues?.includes("missing-visual-region")
      ) {
        const notice = this.doc.createElement("p");
        notice.className = "bi-layout-notice";
        notice.textContent =
          "图表区域暂未可靠定位；正文和图注继续翻译，可点“原图 / 原表”查看完整原图。";
        row.append(notice);
      }
      if (block.layoutIssues?.includes("local-original")) {
        const notice = this.doc.createElement("p");
        notice.className = "bi-layout-notice";
        notice.textContent = "此处符号或公式保留原版，其余正文继续翻译。";
        row.append(notice);
      }
      if (block.kind === "original-page") {
        const notice = this.doc.createElement("p");
        notice.className = "bi-layout-notice";
        notice.textContent = block.layoutIssues?.includes("no-text")
          ? "本页没有可提取的文字，已保留原页。暂不支持扫描页自动翻译。"
          : "本页排版未通过自动检查，已保留完整原页，避免公式拆散或内容遗漏。本页未翻译，可点击原文定位查看。";
        row.append(notice);
      }
      const columns = this.doc.createElement("div");
      columns.className = "bi-columns";
      const translation = this.doc.createElement("div");
      translation.className = "bi-text bi-translation";
      translation.lang = "zh-CN";
      translation.dataset.side = "translation";
      const source = this.doc.createElement("div");
      source.className = "bi-text bi-source";
      source.lang = "en";
      source.dataset.side = "source";
      if (block.kind === "heading" || block.kind === "title") {
        for (const cell of [source, translation]) {
          cell.setAttribute("role", "heading");
          cell.setAttribute(
            "aria-level",
            String(
              block.kind === "title"
                ? 1
                : Math.min(6, (block.headingLevel || 1) + 1),
            ),
          );
        }
      }
      columns.append(source, translation);
      row.append(meta, columns);
      if (!section || sectionID !== block.sectionID) {
        section = this.doc.createElement("section");
        section.className = "bi-section";
        sectionID = block.sectionID;
        if (sectionID)
          section.setAttribute(
            "aria-label",
            block.sectionPath?.join(" / ") || "正文",
          );
        fragment.append(section);
      }
      if (block.table) {
        const t = block.table;
        let wrap = tables.get(t.id);
        if (!wrap) {
          wrap = this.doc.createElement("div");
          wrap.className = "bi-structured-table";
          wrap.dataset.tableId = t.id;
          wrap.dataset.pageIndex = String(block.pageIndex);
          wrap.dataset.rect = JSON.stringify(t.rect);
          const table = this.doc.createElement("table");
          table.setAttribute(
            "aria-label",
            "表格 · 原文第 " + block.pageLabel + " 页",
          );
          const cols = this.doc.createElement("colgroup");
          for (let n = 0; n < t.columns.length - 1; n++) {
            const col = this.doc.createElement("col");
            col.style.width =
              (100 * (t.columns[n + 1] - t.columns[n])) /
                (t.rect[2] - t.rect[0]) +
              "%";
            cols.append(col);
          }
          table.append(cols);
          const body = this.doc.createElement("tbody");
          for (let n = 0; n < t.rows; n++)
            body.append(this.doc.createElement("tr"));
          table.append(body);
          wrap.append(table);
          section.append(wrap);
          tables.set(t.id, wrap);
        }
        const cell = this.doc.createElement(
          t.header ? "th" : "td",
        ) as HTMLTableCellElement;
        cell.colSpan = t.colSpan;
        if (t.header) cell.scope = "col";
        cell.append(row);
        cell.dataset.column = String(t.column);
        const tr = wrap.querySelectorAll("tr")[t.row];
        const next = (Array.from(tr.children) as HTMLElement[]).find(
          (c) => Number(c.dataset.column) > t.column,
        );
        tr.insertBefore(cell, next || null);
      } else section.append(row);
      this.rows.set(block.id, { row, source, translation });
      if (block.links?.length) {
        const links = this.doc.createElement("details");
        links.className = "bi-reference-links";
        const summary = this.doc.createElement("summary");
        summary.textContent = `原文引用与链接 · ${block.links.length}`;
        links.append(summary);
        for (const link of block.links) {
          const item = this.doc.createElement("div");
          const preview = this.doc.createElement("p");
          preview.textContent =
            link.preview ||
            (link.url
              ? "原文中的外部链接"
              : `原文目标页 ${Number(link.targetPageIndex) + 1}`);
          item.append(
            this.button(`${link.label} ↗`, () => this.onReference(link)),
            preview,
          );
          links.append(item);
        }
        row.append(links);
      }
      this.update(block, []);
    }
    this.list.append(fragment);
    this.setContinuousReading(this.root.dataset.readingMode !== "compare");
  }
  imageLoader(block: Block) {
    const element = this.doc.createElement("div");
    element.className = "bi-image-loader";
    element.textContent =
      "原文图片 · p. " + block.pageLabel + " · 滚动到此处时加载";
    this.rows.get(block.id)?.row.before(element);
    return element;
  }
  showImage(image: PDFImage, blocks: Block[]) {
    const mathOwner = blocks.find((b) =>
      b.inlineMath?.some((m) => m.id === image.captionID),
    );
    if (mathOwner && image.captionID) {
      this.portableImages.set(image.id, image);
      this.mathImages.set(image.captionID, image);
      this.renderInlineMath(mathOwner);
      return;
    }
    const anchor =
      blocks.find((b) => b.id === image.captionID) ||
      imageAnchor(image, blocks);
    if (
      anchor &&
      image.captionID &&
      blocks.some((b) => b.table?.captionID === image.captionID)
    )
      this.portableImages.set(image.id, { ...image, captionID: anchor.id });
    if (
      !anchor ||
      (image.captionID &&
        blocks.some((b) => b.table?.captionID === image.captionID))
    )
      return;
    for (const [id, stored] of this.portableImages) {
      if (
        stored.pageIndex === image.pageIndex &&
        sameRegion(stored.rect, image.rect)
      )
        this.portableImages.delete(id);
    }
    this.portableImages.set(image.id, { ...image, captionID: anchor.id });
    for (const existing of Array.from(
      this.list.querySelectorAll(".bi-figure"),
    ) as HTMLElement[]) {
      if (
        Number(existing.dataset.pageIndex) === image.pageIndex &&
        existing.dataset.rect &&
        sameRegion(JSON.parse(existing.dataset.rect), image.rect)
      )
        return;
    }
    const row = this.rows.get(anchor.id)?.row;
    if (!row) return;
    row.querySelector(".bi-equation-loading")?.remove();
    if (["equation", "original-page"].includes(anchor.kind))
      row.dataset.originalEquation = "true";
    let group = row.querySelector<HTMLElement>(".bi-images");
    if (!group) {
      group = this.doc.createElement("div");
      group.className = "bi-images";
      if (
        anchor.kind === "original-page" ||
        /^table\b/i.test(anchor.source.trim())
      )
        row.append(group);
      else row.prepend(group);
    }
    if (group.querySelector(`[data-image-id="${image.id}"]`)) return;
    const figure = this.doc.createElement("figure");
    figure.className = "bi-figure";
    figure.dataset.imageId = image.id;
    figure.dataset.rect = JSON.stringify(image.rect);
    figure.dataset.pageIndex = String(image.pageIndex);
    const img = this.doc.createElement("img");
    if (image.preview && /^table\b/i.test(anchor.source.trim())) {
      img.onload = () => {
        if (!this.disposed) this.foldTableText(anchor, image, blocks);
      };
    }
    img.src = image.src;
    img.width = image.width;
    img.height = image.height;
    img.alt = "原 PDF 图片，第 " + anchor.pageLabel + " 页";
    // FigureController already loads by visible page. Decode immediately once extracted.
    img.loading = "eager";
    img.decoding = "async";
    img.tabIndex = 0;
    img.setAttribute("aria-expanded", "false");
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", img.alt + "，点击放大或缩小");
    const toggle = () => {
      img.classList.toggle("bi-expanded");
      img.setAttribute(
        "aria-expanded",
        String(img.classList.contains("bi-expanded")),
      );
    };
    img.onclick = toggle;
    img.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
    const caption = this.doc.createElement("figcaption");
    caption.append(
      this.doc.createTextNode(
        (anchor.kind === "original-page"
          ? "原版保留 · p. "
          : anchor.kind === "equation"
            ? "原文公式 · p. "
            : image.preview
              ? "图表预览 · p. "
              : "原图 · p. ") +
          anchor.pageLabel +
          " · 点击图片放大 ",
      ),
    );
    const jump = this.doc.createElement("button");
    jump.textContent = "在原 PDF 中查看";
    jump.onclick = () =>
      this.openBlock({
        ...anchor,
        anchors: [
          {
            start: 0,
            end: 0,
            pageIndex: image.pageIndex,
            charIndex: 0,
            rect: image.rect,
          },
        ],
      });
    caption.append(jump);
    figure.append(img, caption);
    group.append(figure);
  }
  private foldTableText(caption: Block, image: PDFImage, blocks: Block[]) {
    const row = this.rows.get(caption.id)?.row;
    if (!row || row.querySelector(".bi-table-text")) return;
    const textBlocks = tableTextBlocks(
      caption.id,
      image.pageIndex,
      image.rect,
      blocks,
    );
    if (!textBlocks.length) return;
    const details = this.doc.createElement("details");
    details.className = "bi-table-text";
    const summary = this.doc.createElement("summary");
    summary.textContent = "查看表格文字与翻译";
    details.append(summary);
    for (const block of textBlocks) {
      const content = this.rows.get(block.id)?.row;
      if (content && !content.contains(row)) details.append(content);
    }
    row.append(details);
  }
  update(block: Block, mappings: LinkedAnnotation[]) {
    const row = this.rows.get(block.id);
    if (!row) return;
    renderHighlights(
      row.source,
      block.source,
      mappings,
      "source",
      this.onAnnotation,
      this.onHover,
    );
    const translated =
      block.translation ??
      (block.error
        ? `翻译暂停：${block.error} 点击 Retry / Resume 重试。`
        : "等待翻译…");
    renderHighlights(
      row.translation,
      translated,
      mappings,
      "translation",
      this.onAnnotation,
      this.onHover,
    );
    row.translation.classList.toggle("bi-wait", !block.translation);
    this.renderInlineMath(block);
  }
  emphasize(key?: string) {
    for (const mark of Array.from(
      this.root.querySelectorAll("mark"),
    ) as HTMLElement[])
      mark.classList.toggle(
        "bi-linked-hover",
        !!key && mark.dataset.keys?.split(" ").includes(key) === true,
      );
  }
  visibleBlock(): string | undefined {
    const top = this.list.getBoundingClientRect().top;
    for (const [id, entry] of this.rows) {
      const row = entry.source.getClientRects().length
        ? entry.source
        : entry.translation;
      if (
        row.getClientRects().length &&
        row.getBoundingClientRect().bottom > top + 20
      )
        return id;
    }
  }
  scrollTo(id: string) {
    const entry = this.rows.get(id);
    const row = entry?.row.hidden ? entry.source : entry?.row;
    const details = row?.closest<HTMLDetailsElement>("details");
    if (details) details.open = true;
    row?.scrollIntoView({ block: "start" });
  }
  selection():
    | {
        blockID: string;
        side: "source" | "translation";
        start: number;
        end: number;
      }
    | undefined {
    const selection = this.doc.defaultView?.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const element = (node: Node) =>
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    const cell = element(range.startContainer)?.closest<HTMLElement>(
      "[data-side]",
    );
    if (
      !cell ||
      !cell.contains(range.endContainer) ||
      !this.root.contains(cell)
    )
      return;
    const blockID =
      cell.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    if (!blockID) return;
    const offsets = selectionOffsets(cell, range);
    if (!offsets) return;
    return {
      blockID,
      side: cell.dataset.side as "source" | "translation",
      start: offsets[0],
      end: offsets[1],
    };
  }
}
