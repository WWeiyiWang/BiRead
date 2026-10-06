import { CompareMode } from "./compareMode";
import { FigureController } from "../ui/figureController";
import { config } from "../../../package.json";
import type { Block, DocumentData, TranslationContext } from "../types";
import {
  pdfIntegration,
  createBilingualSurface,
  currentPage,
  jumpToBlock,
  type PDFIntegration,
} from "./pdfIntegration";
import { BilingualView } from "../ui/bilingualView";
import { extractDocument } from "../parser/pdfTextExtractor";
import { loadDocument, saveDocument } from "../cache/documentCache";
import {
  loadGlossary,
  saveGlossary,
  parseGlossary,
} from "../glossary/documentGlossary";
import {
  translationContext,
  effectiveContext,
  supportsAcademic,
} from "../translation/providers";
import { translateProgressively } from "../translation/batching";
import { getPref, setPref } from "../../utils/prefs";

import { AnnotationControls } from "../ui/annotationControls";
class Session {
  readonly ui: BilingualView;
  private compare: CompareMode;
  private readingMode = String(getPref("bilingual.readingMode") || "immersive");
  private annotations: AnnotationControls;
  private figures?: FigureController;
  private paused = false;
  document?: DocumentData;
  context?: TranslationContext;
  private running = false;
  private restartRequested = false;
  private disposed = false;
  private lastBlock?: string;
  private pageOnPDF = 0;
  private mode: TranslationContext["mode"] =
    getPref("bilingual.academic") === false ? "standard" : "academic";
  onLoaded = () => {};
  onBlockUpdate = (_block: Block) => {};
  constructor(
    readonly integration: PDFIntegration,
    private frame: HTMLIFrameElement,
  ) {
    this.ui = new BilingualView(
      frame.contentDocument!,
      () => this.showPDF(),
      (block) => {
        this.lastBlock = block.id;
        if (this.compare?.active) void jumpToBlock(this.integration, block);
        else this.showPDF(block);
      },
    );
    this.compare = new CompareMode(
      integration,
      frame,
      this.ui,
      () => this.document?.blocks || [],
    );
    this.ui.onReadingMode = (mode) => {
      this.readingMode = mode;
      this.compare.set(mode === "compare");
    };
    this.ui.selectSetting(
      "同步滚动",
      "bilingual.syncScroll",
      [
        ["on", "同步翻页"],
        ["off", "独立滚动"],
      ],
      "on",
      (value) => (this.compare.sync = value === "on"),
    );
    this.ui.selectSetting(
      "翻译速度",
      "bilingual.concurrency",
      [
        ["1", "稳妥 · 1 路"],
        ["2", "加速 · 2 路"],
        ["3", "加速 · 3 路"],
      ],
      "2",
      () => {
        if (this.document) this.restart();
      },
    );
    this.ui.selectSetting(
      "译文缩放",
      "bilingual.paperZoom",
      [
        ["1", "译文适应宽度"],
        ["1.25", "译文 125%"],
        ["1.5", "译文 150%"],
        ["2", "译文 200%"],
      ],
      "1",
      (value) => this.compare.setZoom(Number(value)),
    );
    this.annotations = new AnnotationControls(
      this.ui,
      integration,
      () => this.document?.blocks || [],
    );
    this.onBlockUpdate = (block) => this.annotations.update(block);
    this.ui.status.textContent = "Loading document…";
    const academic = this.ui.doc.createElement("label");
    const check = this.ui.doc.createElement("input");
    check.type = "checkbox";
    check.checked = this.mode === "academic";
    academic.append(check, this.ui.doc.createTextNode(" ACADEMIC MODE"));
    check.onchange = () => {
      this.mode = check.checked ? "academic" : "standard";
      setPref("bilingual.academic", check.checked);
      this.restart();
    };
    this.ui.settings.append(academic);
    const provider = this.ui.doc.createElement("select");
    provider.setAttribute("aria-label", "Translation provider");
    for (const service of addon.data.translate.services
      .getAllServicesWithType("sentence")
      .filter((s) => s.id !== "pot")) {
      const option = this.ui.doc.createElement("option");
      option.value = service.id;
      option.textContent = addon.data.translate.services.getServiceNameByID(
        service.id,
      );
      provider.append(option);
    }
    provider.value = String(getPref("translateSource") || "google");
    provider.onchange = () => {
      setPref("translateSource", provider.value);
      this.restart();
    };
    this.ui.settings.append(provider);
    this.ui.button("Pause", () => {
      this.restartRequested = false;
      this.paused = true;
      this.ui.status.textContent = "Paused. Resume continues from cache.";
    });
    this.ui.button("Retry / Resume", () => this.restart());
    this.ui.button("Glossary", () => void this.editGlossary());
    integration.win.addEventListener("unload", () => this.dispose(), {
      once: true,
    });
  }
  async open() {
    this.frame.hidden = false;
    this.compare.set(this.readingMode === "compare");
    this.ui.root.hidden = false;
    if (this.document) {
      const page = currentPage(this.integration);
      if (page !== this.pageOnPDF)
        this.lastBlock = this.document.blocks.find(
          (b) => b.pageIndex === page,
        )?.id;
      if (this.lastBlock) this.ui.scrollTo(this.lastBlock);
      return;
    }
    await this.run();
  }
  showPDF(block?: Block) {
    this.lastBlock = block?.id || this.ui.visibleBlock();
    const target =
      block || this.document?.blocks.find((b) => b.id === this.lastBlock);
    this.compare.set(false);
    this.ui.root.hidden = true;
    this.frame.hidden = true;
    if (target) {
      this.pageOnPDF = target.pageIndex;
      void jumpToBlock(this.integration, target);
    }
  }
  private restart() {
    if (this.running) {
      this.paused = true;
      this.restartRequested = true;
      this.ui.status.textContent =
        "正在等待当前请求结束，随后使用新设置继续（最长 90 秒）…";
    } else void this.run();
  }
  async run() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.paused = false;
    try {
      if (!this.document) {
        const i = this.integration;
        this.document = await loadDocument(i.identity, i.fingerprint);
        if (!this.document) {
          this.document = await extractDocument(
            i.pdf,
            i.identity,
            i.fingerprint,
            (page, count) => {
              this.ui.status.textContent = `Extracting ${page} / ${count}`;
            },
            () => this.disposed || this.paused,
          );
          await saveDocument(this.document);
        }
        if (this.disposed) return;
        this.ui.furniture = this.document.furniture || [];
        this.ui.showBlocks(this.document.blocks);
        this.figures = new FigureController(this.ui, i, this.document.blocks);
        const first = this.document.blocks.find(
          (b) => b.pageIndex === currentPage(i),
        );
        if (first) this.ui.scrollTo(first.id);
        await this.annotations.bridge.start();
        this.onLoaded();
      }
      this.context = effectiveContext(
        translationContext(
          await loadGlossary(this.integration.identity),
          this.mode,
        ),
      );
      const context = this.context;
      const notice = !supportsAcademic(context.provider)
        ? " · 普通翻译 · 术语按词表固定；上下文润色可选大模型"
        : "";
      this.ui.status.textContent = "正在请求 " + context.provider + notice;
      await translateProgressively(
        this.document.blocks,
        this.integration.identity,
        context,
        this.integration.item.id,
        (block, done, total) => {
          if (this.disposed) return;
          this.onBlockUpdate(block);
          const missing = this.document!.emptyPages.length;
          this.ui.status.textContent = `${done === total ? "READY" : "TRANSLATING"} ${done} / ${total}${missing ? ` · ${missing} page(s) without selectable text` : ""}${notice}`;
        },
        () => this.disposed || this.paused,
        (block, seconds) => {
          if (!this.disposed && !this.paused)
            this.ui.status.textContent = `TRANSLATING · ${context.provider} · p. ${block.pageLabel} · 当前段 ${seconds} 秒 · 单次请求超时 90 秒${notice}`;
        },
        {
          concurrency: Number(getPref("bilingual.concurrency") || 2),
          priority: () => {
            const visible = this.ui.visibleBlock();
            return (
              this.document?.blocks.find((b) => b.id === visible)?.pageIndex ??
              currentPage(this.integration)
            );
          },
        },
      );
    } catch (error) {
      if (!this.disposed)
        this.ui.status.textContent =
          error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
      if (this.restartRequested && !this.disposed) {
        this.restartRequested = false;
        void this.run();
      }
    }
  }
  private async editGlossary() {
    if (this.running) {
      this.ui.status.textContent =
        "Please pause/finish translation before editing glossary.";
      return;
    }
    const glossary = await loadGlossary(this.integration.identity);
    const panel = this.ui.inspector;
    panel.replaceChildren();
    const text = this.ui.doc.createElement("textarea");
    text.setAttribute(
      "aria-label",
      "Document glossary, term → translation per line",
    );
    text.placeholder =
      "每行一条，填写你希望统一使用的术语，例如：\naffordance → 可供性\npublic space → 公共空间";
    text.value = Object.entries(glossary)
      .map(([term, value]) => `${term} → ${value}`)
      .join("\n");
    const save = this.ui.doc.createElement("button");
    save.textContent = "Save glossary";
    const retranslate = this.ui.doc.createElement("button");
    retranslate.textContent = "Save & retranslate affected blocks";
    const message = this.ui.doc.createElement("span");
    const apply = async (translate: boolean) => {
      try {
        await saveGlossary(
          this.integration.identity,
          parseGlossary(text.value),
        );
        panel.replaceChildren();
        if (translate) await this.run();
        else
          this.ui.status.textContent =
            "Glossary saved. Existing translations retained until Retry / Resume.";
      } catch (error) {
        message.textContent = String(error);
      }
    };
    save.onclick = () => void apply(false);
    retranslate.onclick = () => void apply(true);
    const help = this.ui.doc.createElement("p");
    help.textContent =
      "本论文术语表：填写英文术语 → 指定译法。保存并重译仅更新含这些术语的段落；Google 等普通服务固定替换术语，大模型结合上下文翻译。";
    panel.append(help, text, save, retranslate, message);
  }
  dispose() {
    this.disposed = true;
    this.compare.dispose();
    this.figures?.dispose();
    this.annotations.dispose();
    this.ui.dispose();
    this.ui.root.remove();
    this.frame.remove();
    sessions.delete(this);
  }
}
const sessions = new Set<Session>();
const pending = new Map<any, Promise<Session>>();
const buttons = new Set<HTMLElement>();
let active = false;
async function sessionFor(reader: any): Promise<Session> {
  const i = await pdfIntegration(reader);
  const existing = [...sessions].find((s) => s.integration.win === i.win);
  if (existing) return existing;
  if (pending.has(i.win)) return pending.get(i.win)!;
  const create = Promise.resolve().then(async () => {
    const frame = await createBilingualSurface(i);
    if (!active) {
      frame.remove();
      throw new Error("Plugin was disabled.");
    }
    const session = new Session(i, frame);
    sessions.add(session);
    return session;
  });
  pending.set(i.win, create);
  try {
    return await create;
  } finally {
    pending.delete(i.win);
  }
}
function toolbar({ reader, doc, append }: any) {
  if (!active || (reader.type && reader.type !== "pdf")) return;
  const button = doc.createElement("button");
  button.className = "toolbar-button";
  button.textContent = "BILINGUAL";
  button.style.width = "auto";
  button.style.padding = "0 8px";
  button.title = "全文双语阅读 / Full bilingual reading";
  button.onclick = async () => {
    try {
      const session = await sessionFor(reader);
      if (!session.ui.root.hidden && session.document) session.showPDF();
      else await session.open();
    } catch (error) {
      const status =
        reader._internalReader?._primaryView?._iframeWindow?.document
          .querySelector("#zpt-bilingual-frame")
          ?.contentDocument?.querySelector('[role="status"]');
      if (status) status.textContent = String(error);
      else Zotero.getMainWindow().alert(String(error));
    }
  };
  buttons.add(button);
  append(button);
}
export function registerBilingualReader() {
  active = true;
  Zotero.Reader.registerEventListener("renderToolbar", toolbar, config.addonID);
  // Existing tabs may have rendered their toolbar before this plugin loaded.
  for (const reader of (Zotero.Reader as any)._readers || []) {
    const doc = reader._iframeWindow?.document;
    const end = doc?.querySelector(".toolbar .end");
    if (end)
      toolbar({
        reader,
        doc,
        append: (button: HTMLElement) => end.prepend(button),
      });
  }
}
export function shutdownBilingualReader() {
  active = false;
  Zotero.Reader.unregisterEventListener("renderToolbar", toolbar);
  for (const session of sessions) session.dispose();
  for (const button of buttons) button.remove();
  buttons.clear();
}
