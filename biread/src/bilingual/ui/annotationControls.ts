import type { Block } from "../types";
import type { BilingualView } from "./bilingualView";
import type { PDFIntegration } from "../reader/pdfIntegration";
import { AnnotationBridge } from "../annotations/zoteroAnnotationBridge";
import { setPref } from "../../utils/prefs";
import {
  installLocalModel,
  ensureLocalModel,
} from "../alignment/installLocalModel";

const colors = [
  ["黄色", "#ffd400"],
  ["红色", "#ff6666"],
  ["绿色", "#5fb236"],
  ["蓝色", "#2ea8e5"],
  ["紫色", "#a28ae5"],
];
export class AnnotationControls {
  readonly bridge: AnnotationBridge;
  private busy = false;
  private selectedKey?: string;
  private flushComment: () => Promise<void> = async () => {};
  private commentDirty: () => boolean = () => false;
  private bindingSelection?: (
    selection: NonNullable<ReturnType<BilingualView["selection"]>>,
  ) => void;
  private hoverHandler: (event: Event) => void;
  private menu?: HTMLDivElement;
  private selectionPreview: HTMLDivElement[] = [];
  private preserveRightSelection = (event: MouseEvent) => {
    if (event.button !== 2) return;
    const selection = this.ui.selection();
    const cell = (event.target as Element)?.closest?.<HTMLElement>(
      "[data-side]",
    );
    if (
      selection &&
      cell?.dataset.side === selection.side &&
      cell.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ===
        selection.blockID
    )
      event.preventDefault();
  };
  private contextHandler: (event: MouseEvent) => void;
  private dismissMenu = (event: Event) => {
    if (!this.menu?.contains(event.target as Node)) this.closeMenu();
  };
  private closeMenu = () => {
    this.menu?.remove();
    this.menu = undefined;
    this.selectionPreview.forEach((node) => node.remove());
    this.selectionPreview = [];
  };
  constructor(
    private ui: BilingualView,
    private integration: PDFIntegration,
    private blocks: () => Block[],
  ) {
    this.bridge = new AnnotationBridge(integration, blocks, () => {
      for (const block of blocks()) this.update(block);
      if (this.selectedKey) {
        const selected = this.bridge.details(this.selectedKey);
        const comment = ui.inspector.querySelector(
          "textarea[data-canonical-comment]",
        ) as HTMLTextAreaElement | null;
        if (
          selected &&
          !selected.deleted &&
          comment &&
          ui.doc.activeElement !== comment &&
          !this.commentDirty()
        )
          comment.value = selected.annotationComment;
        const color = ui.inspector.querySelector(
          "select",
        ) as HTMLSelectElement | null;
        if (selected && !selected.deleted && color)
          color.value = selected.annotationColor;
      }
      if (this.selectedKey && !this.bridge.details(this.selectedKey)) {
        ui.inspector.replaceChildren();
        this.selectedKey = undefined;
      }
    });
    const color = this.colorSelect("#ffd400");
    ui.settings.append(color);
    const installModel = ui.button("一键安装本地模型", async () => {
      installModel.disabled = true;
      try {
        await installLocalModel((text) => {
          ui.status.textContent = text;
        });
        this.bridge.retryAlignment();
      } catch (error) {
        ui.status.textContent = `安装未完成：${String(error)}。点击一键安装可重试；原有配置仍保留。`;
      } finally {
        installModel.disabled = false;
      }
    });
    installModel.title =
      "Windows x64：首次下载约 194 MB，自动配置并验证。之后离线运行，无需安装 Python。";
    ui.settings.append(installModel);
    ui.settings.append(
      ui.button("手动选择模型配置", async () => {
        try {
          const { FilePicker } = ChromeUtils.importESModule(
            "chrome://zotero/content/modules/filePicker.mjs",
          ) as any;
          const picker = new FilePicker();
          picker.init(
            Zotero.getMainWindow(),
            "选择本地模型配置 JSON",
            picker.modeOpen,
          );
          picker.appendFilter("模型配置", "*.json");
          if ((await picker.show()) !== picker.returnOK) return;
          const path = picker.file;
          const config = (await IOUtils.readJSON(path)) as any;
          for (const key of ["python", "model", "deps"])
            if (
              typeof config[key] !== "string" ||
              !PathUtils.isAbsolute(config[key]) ||
              !(await IOUtils.exists(config[key]))
            )
              throw new Error(`配置中的 ${key} 路径无效`);
          setPref("bilingual.localModel.config", path);
          this.bridge.retryAlignment();
          ui.status.textContent =
            "已启用本地模型。下次选词时离线运行，点击标注后自动匹配；对应有误可手动修改。";
        } catch (error) {
          ui.status.textContent = String(error);
        }
      }),
    );
    const highlight = ui.button(
      "Highlight selection",
      () => void this.create(color.value),
    );
    highlight.title =
      "中文选择优先匹配英文词语；无法唯一匹配时不会扩大到整句。匹配失败时中文标注保存在本机 BiRead。";
    highlight.onmousedown = (event) => event.preventDefault();
    const underline = ui.button(
      "Underline selection",
      () => void this.create(color.value, "underline"),
    );
    underline.onmousedown = (event) => event.preventDefault();
    this.contextHandler = (event) => {
      this.closeMenu();
      const selection = ui.selection();
      const cell = (event.target as Element)?.closest?.<HTMLElement>(
        "[data-side]",
      );
      if (
        !selection ||
        !cell ||
        this.busy ||
        cell.dataset.side !== selection.side ||
        cell.closest<HTMLElement>("[data-block-id]")?.dataset.blockId !==
          selection.blockID
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      // Keep offsets independently of browser selection, which menu focus can clear.
      const block = blocks().find((b) => b.id === selection.blockID);
      const snapshot =
        selection.side === "source" ? block?.source : block?.translation;
      const menu = ui.doc.createElement("div");
      this.menu = menu;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "文本标注");
      menu.style.cssText =
        "position:fixed;z-index:2147483647;min-width:160px;padding:5px;border:1px solid #aaa;border-radius:6px;background:Canvas;color:CanvasText;box-shadow:0 3px 14px #0003;display:flex;flex-direction:column;gap:3px";
      const actions: [string, "highlight" | "underline", boolean][] = [
        ["高亮", "highlight", false],
        ["划线", "underline", false],
        ["批注", "highlight", true],
      ];
      for (const [label, type, comment] of actions) {
        const button = ui.doc.createElement("button");
        button.textContent = label;
        button.setAttribute("role", "menuitem");
        button.style.cssText =
          "text-align:left;padding:7px 10px;color:inherit;background:transparent;border:0;border-radius:3px;cursor:pointer";
        button.onmousedown = (e) => e.preventDefault();
        button.onclick = () => {
          this.closeMenu();
          const current = blocks().find((b) => b.id === selection.blockID);
          if (
            snapshot !==
            (selection.side === "source"
              ? current?.source
              : current?.translation)
          ) {
            ui.status.textContent = "文本已更新，请重新选中文字后标注。";
            return;
          }
          void this.create(color.value, type, selection, comment);
        };
        menu.append(button);
      }
      menu.onkeydown = (e) => {
        if (e.key === "Escape" || e.key === "Tab") {
          this.closeMenu();
          if (e.key === "Escape") e.preventDefault();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = Array.from(
            menu.querySelectorAll<HTMLButtonElement>("button"),
          ) as HTMLButtonElement[];
          const index = buttons.indexOf(
            ui.doc.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ].focus();
        }
      };
      ui.doc.body.append(menu);
      // The reader iframe contains a fixed root: its document element may have
      // zero layout height. Clamp against the viewport, not that empty box.
      const win = ui.doc.defaultView;
      const width = win?.innerWidth || ui.root.getBoundingClientRect().width;
      const height = win?.innerHeight || ui.root.getBoundingClientRect().height;
      const range = ui.doc.getSelection()?.rangeCount
        ? ui.doc.getSelection()!.getRangeAt(0).getBoundingClientRect()
        : undefined;
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const x = keyboard && range ? range.left : event.clientX;
      const y = keyboard && range ? range.bottom : event.clientY;
      menu.style.maxHeight = `${Math.max(40, height - 8)}px`;
      menu.style.overflowY = "auto";
      const reposition = () => {
        const current = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(x + 4, width - current.width - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(y + 4, height - current.height - 4))}px`;
      };
      reposition();
      // Keep the native range and focus for mouse users. The overlay also makes
      // the selection visible when keyboard navigation moves focus into the menu.
      const nativeSelection = ui.doc.getSelection();
      if (nativeSelection?.rangeCount) {
        for (const rect of Array.from(
          nativeSelection.getRangeAt(0).getClientRects() || [],
        )) {
          const preview = ui.doc.createElement("div");
          preview.setAttribute("aria-hidden", "true");
          preview.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;background:rgba(70,130,220,.22);outline:1px solid rgba(70,130,220,.55);left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
          ui.doc.body.append(preview);
          this.selectionPreview.push(preview);
        }
      }
      if (keyboard)
        menu.querySelector("button")?.focus({ preventScroll: true });
    };
    ui.root.addEventListener("mousedown", this.preserveRightSelection, true);
    ui.root.addEventListener("contextmenu", this.contextHandler);
    ui.doc.addEventListener("pointerdown", this.dismissMenu, true);
    ui.doc.addEventListener("scroll", this.closeMenu, true);
    ui.doc.defaultView?.addEventListener("blur", this.closeMenu);
    ui.onAnnotation = (key) => {
      if (!this.bindingSelection && !this.busy) void this.inspect(key);
    };
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
    void this.bridge.reconcile(block);
  }
  private async create(
    color: string,
    type: "highlight" | "underline" = "highlight",
    savedSelection?: ReturnType<BilingualView["selection"]>,
    focusComment = false,
  ) {
    if (this.busy) return;
    this.bindingSelection = undefined;
    const selection = savedSelection || this.ui.selection();
    if (!selection) {
      this.ui.status.textContent = "请先在一个段落内选中文字。";
      return;
    }
    const block = this.blocks().find((b) => b.id === selection.blockID);
    if (!block || (selection.side === "translation" && !block.translation))
      return;
    this.busy = true;
    this.ui.status.textContent = "正在查找本地词组对应关系…";
    try {
      let modelWarning = "";
      try {
        await ensureLocalModel((text) => {
          this.ui.status.textContent = text;
        });
      } catch (error) {
        modelWarning = ` 自动模型准备未完成：${String(error)}。可点击一键安装重试。`;
      }
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
      this.ui.status.textContent = this.bridge.isLocal(key)
        ? "中文标注已保存在本机 BiRead；未可靠匹配英文，未同步原 PDF。"
        : this.bridge.nativeSyncError || "标注已保存并同步到原 PDF。";
      this.ui.status.textContent += " " + this.bridge.alignmentStatus;
      this.ui.status.textContent += modelWarning;
      if (focusComment)
        this.ui.inspector
          .querySelector<HTMLTextAreaElement>(
            "textarea[data-canonical-comment]",
          )
          ?.focus();
    } catch (error) {
      this.ui.status.textContent = String(error);
    } finally {
      this.busy = false;
    }
  }
  private async inspect(key: string) {
    try {
      await this.flushComment();
      await this.bridge.focus(key);
      this.bindingSelection = undefined;
      this.selectedKey = key;
      const item = this.bridge.details(key);
      if (!item) return;
      const panel = this.ui.inspector;
      panel.replaceChildren();
      const label = this.ui.doc.createElement("div");
      label.textContent =
        (this.bridge.isLocal(key)
          ? "BiRead 本机译文标注（未同步原 PDF） · "
          : "Zotero annotation · ") + key;
      const comment = this.ui.doc.createElement("textarea");
      comment.value = item.annotationComment;
      comment.dataset.canonicalComment = key;
      comment.setAttribute("aria-label", "Canonical Zotero annotation comment");
      const saveStatus = this.ui.doc.createElement("span");
      saveStatus.setAttribute("role", "status");
      saveStatus.textContent = "批注自动保存";
      let saved = comment.value;
      let pending: Promise<void> | undefined;
      const flush = (): Promise<void> => {
        if (pending) return pending;
        if (comment.value === saved) return Promise.resolve();
        saveStatus.textContent = "正在保存…";
        pending = (async () => {
          while (comment.value !== saved) {
            const value = comment.value;
            await this.bridge.comment(key, value);
            saved = value;
          }
          saveStatus.textContent = "已自动保存";
        })()
          .catch((error) => {
            saveStatus.textContent = "保存失败，继续编辑或离开输入框时重试";
            this.ui.status.textContent = `批注未保存：${String(error)}`;
            throw error;
          })
          .finally(() => {
            pending = undefined;
          });
        return pending;
      };
      this.flushComment = flush;
      this.commentDirty = () => comment.value !== saved;
      comment.oninput = () => {
        void flush().catch(() => {});
      };
      comment.onblur = () => {
        void flush().catch(() => {});
      };
      const color = this.colorSelect(item.annotationColor);
      const remove = this.ui.doc.createElement("button");
      remove.textContent = "删除标注";
      const close = this.ui.doc.createElement("button");
      close.textContent = "关闭";
      const act = async (action: () => Promise<void>) => {
        try {
          await action();
        } catch (error) {
          this.ui.status.textContent = String(error);
        }
      };
      color.onchange = () =>
        void act(() => this.bridge.color(key, color.value));
      remove.onclick = () =>
        void act(async () => {
          await flush();
          await this.bridge.remove(key);
          this.flushComment = async () => {};
          this.commentDirty = () => false;
        });
      close.onclick = () =>
        void act(async () => {
          await flush();
          panel.replaceChildren();
          this.selectedKey = undefined;
          this.bindingSelection = undefined;
        });
      const relink = this.ui.doc.createElement("button");
      relink.textContent = "绑定 / 重新关联词组";
      relink.onclick = () =>
        void act(async () => {
          await flush();
          this.editBinding(key);
        });
      panel.append(label, comment, saveStatus, color, relink, remove, close);
    } catch (error) {
      this.ui.status.textContent = String(error);
    }
  }
  private editBinding(key: string) {
    const original = this.bridge.binding(key);
    if (!original) {
      this.ui.status.textContent = "找不到当前文本中的标注，请重新选择。";
      return;
    }
    const { block, mapping } = original;
    const sourceText = block.source,
      translationText = block.translation;
    let source: [number, number] = [
      mapping.source.startOffset,
      mapping.source.endOffset,
    ];
    let target: [number, number] = [
      mapping.translation.startOffset,
      mapping.translation.endOffset,
    ];
    const panel = this.ui.inspector;
    const hint = this.ui.doc.createElement("div");
    hint.textContent =
      "选中同一段的对应词组，点击下方“使用选区”，或输入本段中唯一出现的对应词。确认后才修改标注；可分别修改两侧。";
    const preview = this.ui.doc.createElement("div");
    preview.style.whiteSpace = "pre-wrap";
    const show = () => {
      preview.textContent = `英文：${sourceText.slice(...source) || "（待选择）"}\n中文：${(translationText || "").slice(...target) || "（待选择）"}`;
    };
    const capture = (
      selection: NonNullable<ReturnType<BilingualView["selection"]>>,
    ) => {
      if (
        selection.blockID !== block.id ||
        block.source !== sourceText ||
        block.translation !== translationText
      ) {
        this.ui.status.textContent =
          "请选择同一段落的词组；文本变化后请取消并重新关联。";
        return;
      }
      if (selection.side === "source")
        source = [selection.start, selection.end];
      else target = [selection.start, selection.end];
      show();
    };
    this.bindingSelection = capture;
    const buttons = (["source", "translation"] as const).map((side) => {
      const button = this.ui.doc.createElement("button");
      button.textContent = side === "source" ? "使用英文选区" : "使用中文选区";
      button.onmousedown = (e) => e.preventDefault();
      button.onclick = () => {
        const selection = this.ui.selection();
        if (selection?.side === side) capture(selection);
        else this.ui.status.textContent = "请先选中对应语言的词组。";
      };
      return button;
    });
    const inputs = (["source", "translation"] as const).map((side) => {
      const row = this.ui.doc.createElement("label");
      row.textContent = side === "source" ? "英文词组：" : "中文词组：";
      const input = this.ui.doc.createElement("input");
      input.setAttribute(
        "aria-label",
        side === "source" ? "修改英文对应词" : "修改中文对应词",
      );
      const apply = this.ui.doc.createElement("button");
      apply.textContent = "使用输入";
      apply.onclick = () => {
        const text = (side === "source" ? sourceText : translationText) || "";
        const term = input.value.trim();
        const start = term ? text.indexOf(term) : -1;
        if (start < 0 || text.indexOf(term, start + 1) >= 0) {
          this.ui.status.textContent =
            "输入词须在本段中唯一出现；有重复时请使用选区。自写释义请填写批注。";
          return;
        }
        capture({ blockID: block.id, side, start, end: start + term.length });
      };
      row.append(input, apply);
      return row;
    });
    const confirm = this.ui.doc.createElement("button");
    confirm.textContent = "确认绑定";
    confirm.onclick = async () => {
      if (this.busy) return;
      if (
        block.source !== sourceText ||
        block.translation !== translationText
      ) {
        this.ui.status.textContent = "文本已变化，请取消并重新关联。";
        return;
      }
      this.busy = true;
      confirm.disabled = true;
      try {
        const newKey = await this.bridge.rebind(key, block, source, target);
        this.bindingSelection = undefined;
        await this.inspect(newKey);
        this.ui.status.textContent =
          "双向关联已保存，原标注的颜色和批注已保留。";
      } catch (error) {
        this.ui.status.textContent = String(error);
      } finally {
        this.busy = false;
        confirm.disabled = false;
      }
    };
    const cancel = this.ui.doc.createElement("button");
    cancel.textContent = "取消关联";
    cancel.onclick = () => {
      if (!this.busy) {
        this.bindingSelection = undefined;
        void this.inspect(key);
      }
    };
    show();
    panel.replaceChildren(
      hint,
      preview,
      ...buttons,
      ...inputs,
      confirm,
      cancel,
    );
  }
  dispose() {
    void this.flushComment().catch((error) => Zotero.logError(error));
    this.bindingSelection = undefined;
    this.closeMenu();
    this.ui.root.removeEventListener(
      "mousedown",
      this.preserveRightSelection,
      true,
    );
    this.ui.root.removeEventListener("contextmenu", this.contextHandler);
    this.ui.doc.removeEventListener("pointerdown", this.dismissMenu, true);
    this.ui.doc.removeEventListener("scroll", this.closeMenu, true);
    this.ui.doc.defaultView?.removeEventListener("blur", this.closeMenu);
    this.bridge.dispose();

    const doc = this.integration.reader._iframeWindow?.document;
    doc?.removeEventListener("pointerover", this.hoverHandler);
    doc?.removeEventListener("pointerout", this.hoverHandler);
  }
}
