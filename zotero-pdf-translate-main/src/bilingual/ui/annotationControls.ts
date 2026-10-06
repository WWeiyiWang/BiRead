import type { Block } from "../types";
import type { BilingualView } from "./bilingualView";
import type { PDFIntegration } from "../reader/pdfIntegration";
import { AnnotationBridge } from "../annotations/zoteroAnnotationBridge";

const colors = [
  ["Yellow", "#ffd400"],
  ["Red", "#ff6666"],
  ["Green", "#5fb236"],
  ["Blue", "#2ea8e5"],
  ["Purple", "#a28ae5"],
];
export class AnnotationControls {
  readonly bridge: AnnotationBridge;
  private busy = false;
  private selectedKey?: string;
  private hoverHandler: (event: Event) => void;
  constructor(
    private ui: BilingualView,
    private integration: PDFIntegration,
    private blocks: () => Block[],
  ) {
    this.bridge = new AnnotationBridge(integration, blocks, () => {
      for (const block of blocks()) this.update(block);
      if (this.selectedKey) {
        const selected = Zotero.Items.getByLibraryAndKey(
          integration.item.libraryID,
          this.selectedKey,
        );
        const comment = ui.inspector.querySelector(
          "textarea[data-canonical-comment]",
        ) as HTMLTextAreaElement | null;
        if (
          selected &&
          !selected.deleted &&
          comment &&
          ui.doc.activeElement !== comment
        )
          comment.value = selected.annotationComment;
        const color = ui.inspector.querySelector(
          "select",
        ) as HTMLSelectElement | null;
        if (selected && !selected.deleted && color)
          color.value = selected.annotationColor;
      }
      if (
        this.selectedKey &&
        !integration.item
          .getAnnotations()
          .some((item: any) => item.key === this.selectedKey && !item.deleted)
      ) {
        ui.inspector.replaceChildren();
        this.selectedKey = undefined;
      }
    });
    const color = this.colorSelect("#ffd400");
    ui.settings.append(color);
    const highlight = ui.button(
      "Highlight selection",
      () => void this.create(color.value),
    );
    highlight.title = "中文选择将映射到对应的完整英文句段；批注保存在原 PDF。";
    highlight.onmousedown = (event) => event.preventDefault();
    const underline = ui.button(
      "Underline selection",
      () => void this.create(color.value, "underline"),
    );
    underline.onmousedown = (event) => event.preventDefault();
    ui.onAnnotation = (key) => void this.inspect(key);
    ui.onHover = (key) => ui.emphasize(key);
    this.hoverHandler = (event) => {
      const target = event.target as Element | null;
      const key = target
        ?.closest?.("[data-sidebar-annotation-id]")
        ?.getAttribute("data-sidebar-annotation-id");
      ui.emphasize(event.type === "pointerover" && key ? key : undefined);
    };
    integration.reader._iframeWindow?.document.addEventListener(
      "pointerover",
      this.hoverHandler,
    );
    integration.reader._iframeWindow?.document.addEventListener(
      "pointerout",
      this.hoverHandler,
    );
  }
  private colorSelect(value: string) {
    const select = this.ui.doc.createElement("select");
    select.setAttribute("aria-label", "Annotation colour");
    for (const [name, color] of colors) {
      const option = this.ui.doc.createElement("option");
      option.value = color;
      option.textContent = name;
      select.append(option);
    }
    select.value = value;
    return select;
  }
  update(block: Block) {
    this.ui.update(block, this.bridge.mappings(block));
  }
  private async create(
    color: string,
    type: "highlight" | "underline" = "highlight",
  ) {
    if (this.busy) return;
    const selection = this.ui.selection();
    if (!selection) {
      this.ui.status.textContent = "Select text within one paragraph first.";
      return;
    }
    const block = this.blocks().find((b) => b.id === selection.blockID);
    if (!block || (selection.side === "translation" && !block.translation))
      return;
    this.busy = true;
    try {
      const key = await this.bridge.create(
        block,
        selection.side,
        selection.start,
        selection.end,
        color,
        type,
      );

      this.ui.doc.defaultView?.getSelection()?.removeAllRanges();
      await this.inspect(key);
    } catch (error) {
      this.ui.status.textContent = String(error);
    } finally {
      this.busy = false;
    }
  }
  private async inspect(key: string) {
    try {
      await this.bridge.focus(key);
      this.selectedKey = key;
      const item = Zotero.Items.getByLibraryAndKey(
        this.integration.item.libraryID,
        key,
      );
      if (!item) return;
      const panel = this.ui.inspector;
      panel.replaceChildren();
      const label = this.ui.doc.createElement("div");
      label.textContent =
        "Zotero annotation · " + key + " · 中文标注对应的完整英文句段";
      const comment = this.ui.doc.createElement("textarea");
      comment.value = item.annotationComment;
      comment.dataset.canonicalComment = key;
      comment.setAttribute("aria-label", "Canonical Zotero annotation comment");
      const save = this.ui.doc.createElement("button");
      save.textContent = "Save comment";
      const color = this.colorSelect(item.annotationColor);
      const remove = this.ui.doc.createElement("button");
      remove.textContent = "Delete annotation";
      const close = this.ui.doc.createElement("button");
      close.textContent = "Close";
      const act = async (action: () => Promise<void>) => {
        try {
          await action();
        } catch (error) {
          this.ui.status.textContent = String(error);
        }
      };
      save.onclick = () =>
        void act(() => this.bridge.comment(key, comment.value));
      color.onchange = () =>
        void act(() => this.bridge.color(key, color.value));
      remove.onclick = () => void act(() => this.bridge.remove(key));
      close.onclick = () => {
        panel.replaceChildren();
        this.selectedKey = undefined;
      };
      panel.append(label, comment, save, color, remove, close);
    } catch (error) {
      this.ui.status.textContent = String(error);
    }
  }
  dispose() {
    this.bridge.dispose();

    const doc = this.integration.reader._iframeWindow?.document;
    doc?.removeEventListener("pointerover", this.hoverHandler);
    doc?.removeEventListener("pointerout", this.hoverHandler);
  }
}
