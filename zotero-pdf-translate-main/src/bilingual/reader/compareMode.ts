import { PageLayout } from "../ui/pageLayout";
import {
  currentPage,
  jumpToBlock,
  type PDFIntegration,
} from "./pdfIntegration";
import type { Block } from "../types";
import type { BilingualView } from "../ui/bilingualView";
import { getPref, setPref } from "../../utils/prefs";
/** Keeps the real PDF viewer live, with its native annotation tools. */
export class CompareMode {
  active = false;
  private layout: PageLayout;
  private savedRight = "";
  private savedPriority = "";
  private savedScale: any;
  private lockUntil = 0;
  private ratio = 0.5;
  private splitter: HTMLDivElement;
  private moving = false;
  private pointerMove = (event: PointerEvent) => {
    if (!this.moving) return;
    const width =
      this.integration.win.document.documentElement.clientWidth ||
      this.integration.win.innerWidth;
    this.ratio = Math.max(0.25, Math.min(0.75, event.clientX / width));
    this.applySplit();
  };
  private pointerUp = () => {
    if (this.moving) setPref("bilingual.compareSplit", this.ratio);
    this.moving = false;
    this.integration.win.removeEventListener("pointerup", this.pointerUp);
    this.integration.win.removeEventListener("pointercancel", this.pointerUp);
  };
  private keyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    this.ratio = Math.max(
      0.25,
      Math.min(0.75, this.ratio + (event.key === "ArrowLeft" ? -0.025 : 0.025)),
    );
    setPref("bilingual.compareSplit", this.ratio);
    this.applySplit();
  };
  private pageListener = () => {
    if (!this.active || Date.now() < this.lockUntil || !this.sync) return;
    const block = this.blocks().find(
      (b) => b.pageIndex === currentPage(this.integration),
    );
    if (block) {
      this.lockUntil = Date.now() + 600;
      this.ui.scrollTo(block.id);
    }
  };
  sync = true;
  constructor(
    private integration: PDFIntegration,
    private frame: HTMLIFrameElement,
    private ui: BilingualView,
    private blocks: () => Block[],
  ) {
    this.ratio = Number(getPref("bilingual.compareSplit") || 0.5);
    if (!Number.isFinite(this.ratio)) this.ratio = 0.5;
    this.ratio = Math.max(0.25, Math.min(0.75, this.ratio));
    const doc = integration.win.document;
    this.splitter = doc.createElement("div");
    this.splitter.id = "zpt-bilingual-splitter";
    this.splitter.setAttribute("role", "separator");
    this.splitter.setAttribute("aria-label", "调整原文与译文栏宽");
    this.splitter.setAttribute("aria-orientation", "vertical");
    this.splitter.tabIndex = 0;
    this.splitter.title = "拖动调整原文与译文宽度，也可使用方向键";
    this.splitter.style.cssText =
      "display:none;position:fixed;top:0;bottom:0;width:14px;margin-left:-7px;z-index:2147483000;cursor:col-resize;touch-action:none;background:transparent";
    const grip = doc.createElement("span");
    grip.style.cssText =
      "position:absolute;left:6px;top:42%;height:64px;width:2px;border-radius:2px;background:#74809499;box-shadow:0 0 0 1px #fff9";
    this.splitter.append(grip);
    this.splitter.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.splitter.setPointerCapture(event.pointerId);
      this.moving = true;
      integration.win.addEventListener("pointerup", this.pointerUp, {
        once: true,
      });
      integration.win.addEventListener("pointercancel", this.pointerUp, {
        once: true,
      });
    };
    this.splitter.onpointermove = this.pointerMove;
    this.splitter.onlostpointercapture = this.pointerUp;
    this.splitter.onkeydown = this.keyDown;
    doc.body.append(this.splitter);
    this.layout = new PageLayout(ui, blocks);
    integration.win.PDFViewerApplication.eventBus.on(
      "pagechanging",
      this.pageListener,
    );
    ui.onVisibleBlock = (id) => {
      if (!this.active || !this.sync || Date.now() < this.lockUntil) return;
      const block = blocks().find((b) => b.id === id);
      if (block && block.pageIndex !== currentPage(integration)) {
        this.lockUntil = Date.now() + 700;
        void jumpToBlock(integration, block);
      }
    };
  }
  setZoom(zoom: number) {
    this.layout.zoom = zoom;
    this.layout.refresh();
  }
  set(active: boolean) {
    if (this.active === active) return;
    const container = this.integration.win.document.getElementById(
      "viewerContainer",
    ) as HTMLElement;
    if (!container) throw new Error("当前 PDF 阅读器不支持对照布局。");
    const viewer = this.integration.win.PDFViewerApplication.pdfViewer;
    this.active = active;
    this.layout.set(active);
    if (active) {
      this.savedRight = container.style.getPropertyValue("right");
      this.savedPriority = container.style.getPropertyPriority("right");
      this.savedScale = viewer.currentScaleValue;
      this.splitter.style.display = "block";
      this.applySplit();
      viewer.currentScaleValue = "page-width";
    } else {
      if (this.savedRight)
        container.style.setProperty(
          "right",
          this.savedRight,
          this.savedPriority,
        );
      else container.style.removeProperty("right");
      this.frame.style.left = "0";
      this.frame.style.width = "100%";
      this.frame.style.borderLeft = "0";
      this.splitter.style.display = "none";
      if (this.savedScale) viewer.currentScaleValue = this.savedScale;
    }
    this.integration.win.dispatchEvent(
      new this.integration.win.Event("resize"),
    );
  }
  private applySplit() {
    const container = this.integration.win.document.getElementById(
      "viewerContainer",
    ) as HTMLElement | null;
    if (!container) return;
    const percent = this.ratio * 100;
    container.style.setProperty("right", 100 - percent + "%", "important");
    this.frame.style.left = percent + "%";
    this.frame.style.width = 100 - percent + "%";
    this.frame.style.borderLeft = "1px solid #8886";
    this.splitter.style.left = percent + "%";
    this.splitter.setAttribute("aria-valuemin", "25");
    this.splitter.setAttribute("aria-valuemax", "75");
    this.splitter.setAttribute("aria-valuenow", String(Math.round(percent)));
    this.integration.win.dispatchEvent(
      new this.integration.win.Event("resize"),
    );
  }
  dispose() {
    this.set(false);
    this.pointerUp();
    this.splitter.remove();
    this.layout.dispose();
    this.integration.win.PDFViewerApplication.eventBus.off(
      "pagechanging",
      this.pageListener,
    );
  }
}
