import type { Block, LinkedAnnotation } from "../types";
import type { PDFIntegration } from "../reader/pdfIntegration";
import { focusAnnotation } from "../reader/pdfIntegration";
import { digest, readJSON, writeJSON } from "../cache/documentCache";
import {
  preciseTranslationRange,
  preciseSourceRange,
} from "../alignment/selectionMapping";
import { loadGlossary } from "../glossary/documentGlossary";
import { localModelConfigured, localModelRange } from "../alignment/localModel";
import {
  annotationMappings,
  sourceRects,
  type CanonicalAnnotation,
  type ExactMapping,
} from "./annotationMapping";

interface LocalAnnotation {
  key: string;
  blockID: string;
  source: string;
  translation: string;
  start: number;
  end: number;
  color: string;
  comment: string;
  type: "highlight" | "underline";
}
export class AnnotationBridge {
  private local: LocalAnnotation[] = [];
  alignmentStatus = "";
  private async saveLocal() {
    await writeJSON(this.storeName + "-local", this.local);
  }
  isLocal(key: string) {
    return this.local.some((a) => a.key === key);
  }
  details(key: string) {
    const local = this.local.find((a) => a.key === key);
    if (local)
      return {
        annotationComment: local.comment,
        annotationColor: local.color,
        deleted: false,
      };
    return Zotero.Items.getByLibraryAndKey(
      this.integration.item.libraryID,
      key,
    );
  }
  private observer?: string;
  private annotations: CanonicalAnnotation[] = [];
  private exact: ExactMapping[] = [];
  private storeName = "";
  private disposed = false;
  private refreshSequence = 0;
  constructor(
    private integration: PDFIntegration,
    private blocks: () => Block[],
    private changed: () => void,
  ) {}
  async start() {
    this.storeName = "annotations-" + (await digest(this.integration.identity));
    this.exact = (await readJSON<ExactMapping[]>(this.storeName)) || [];
    this.local =
      (await readJSON<LocalAnnotation[]>(this.storeName + "-local")) || [];
    if (this.disposed) return;
    this.observer = Zotero.Notifier.registerObserver(
      {
        notify: async (_event: string, type: string) => {
          if (type === "item" && !this.disposed) await this.refresh();
        },
      },
      ["item"],
      "bilingual-annotations",
    );
    await this.refresh();
  }
  async refresh() {
    const sequence = ++this.refreshSequence;
    const items = this.integration.item.getAnnotations();
    const annotations: CanonicalAnnotation[] = [];
    for (const item of items) {
      if (
        item.deleted ||
        !["highlight", "underline"].includes(item.annotationType)
      )
        continue;
      try {
        annotations.push({
          key: item.key,
          type: item.annotationType as "highlight" | "underline",
          color: item.annotationColor,
          comment: item.annotationComment,
          position: JSON.parse(item.annotationPosition),
        });
      } catch (error) {
        Zotero.logError(error as Error);
      }
    }
    if (this.disposed || sequence !== this.refreshSequence) return;
    this.annotations = annotations;
    this.changed();
  }
  mappings(block: Block): LinkedAnnotation[] {
    return [
      ...annotationMappings(block, this.annotations, this.exact),
      ...this.local
        .filter(
          (a) =>
            a.blockID === block.id &&
            a.source === block.source &&
            a.translation === block.translation,
        )
        .map((a) => ({
          type: a.type,
          logicalAnnotationID: a.key,
          zoteroAnnotationKey: a.key,
          blockID: block.id,
          color: a.color,
          comment: a.comment,
          source: { startOffset: 0, endOffset: 0, text: "" },
          translation: {
            startOffset: a.start,
            endOffset: a.end,
            text: a.translation.slice(a.start, a.end),
          },
        })),
    ];
  }
  private item(key: string) {
    const item = Zotero.Items.getByLibraryAndKey(
      this.integration.item.libraryID,
      key,
    );
    if (
      !item ||
      item.deleted ||
      item.parentID !== this.integration.item.id ||
      !item.isAnnotation()
    )
      throw new Error("This annotation no longer exists.");
    return item;
  }
  async focus(key: string) {
    if (this.isLocal(key)) return;
    this.item(key);
    await focusAnnotation(this.integration, key);
  }
  async comment(key: string, comment: string) {
    const local = this.local.find((a) => a.key === key);
    if (local) {
      if (!this.integration.item.isEditable())
        throw new Error("This attachment is read-only.");
      local.comment = comment;
      await this.saveLocal();
      this.changed();
      return;
    }
    const item = this.item(key);
    if (!item.isEditable()) throw new Error("This annotation is read-only.");
    item.annotationComment = comment;
    await item.saveTx();
    await this.refresh();
  }
  async color(key: string, color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw new Error("Invalid annotation colour.");
    const local = this.local.find((a) => a.key === key);
    if (local) {
      if (!this.integration.item.isEditable())
        throw new Error("This attachment is read-only.");
      local.color = color;
      await this.saveLocal();
      this.changed();
      return;
    }
    const item = this.item(key);
    if (!item.isEditable()) throw new Error("This annotation is read-only.");
    item.annotationColor = color;
    await item.saveTx();
    await this.refresh();
  }
  async remove(key: string) {
    if (this.isLocal(key)) {
      if (!this.integration.item.isEditable())
        throw new Error("This attachment is read-only.");
      if (!this.integration.win.confirm("删除这条译文标注？")) return;
      this.local = this.local.filter((a) => a.key !== key);
      await this.saveLocal();
      this.changed();
      return;
    }
    const item = this.item(key);
    if (!item.isEditable()) throw new Error("This annotation is read-only.");
    if (
      !this.integration.win.confirm(
        "Delete this Zotero annotation and its linked bilingual highlight?",
      )
    )
      return;
    await item.eraseTx();
    await this.refresh();
  }
  binding(key: string) {
    for (const block of this.blocks()) {
      const mapping = this.mappings(block).find(
        (m) => m.zoteroAnnotationKey === key,
      );
      if (mapping) return { block, mapping };
    }
  }
  /** Explicit user-confirmed ranges; preserve canonical key, comment, colour and type. */
  async rebind(
    key: string,
    block: Block,
    source: [number, number],
    target: [number, number],
  ) {
    if (this.disposed || !this.integration.item.isEditable())
      throw new Error("标注不可编辑。");
    const valid = (range: [number, number], text: string) =>
      range.every(Number.isInteger) &&
      range[0] >= 0 &&
      range[1] > range[0] &&
      range[1] <= text.length &&
      !!text.slice(...range).trim();
    if (!valid(source, block.source) || !valid(target, block.translation || ""))
      throw new Error("请分别选择有效的英文和中文词组。");
    const current = this.binding(key);
    if (
      !current ||
      current.block.id !== block.id ||
      current.block.source !== block.source ||
      current.block.translation !== block.translation
    )
      throw new Error("请在标注所属段落内重新选择。");
    const local = this.local.find((a) => a.key === key);
    const item = local ? undefined : this.item(key);
    if (item && !item.isEditable())
      throw new Error("This annotation is read-only.");
    const rects = sourceRects(block, ...source);
    if (!rects.length) throw new Error("找不到英文选区的 PDF 坐标。");
    const position = { pageIndex: block.pageIndex, rects };
    const first = block.anchors.find((a) => a.end > source[0])!;
    const sortIndex = [
      String(block.pageIndex).padStart(5, "0"),
      String(first.charIndex).padStart(6, "0"),
      String(Math.max(0, Math.floor(block.pageHeight - rects[0][3]))).padStart(
        5,
        "0",
      ),
    ].join("|");
    const newKey = local ? key.replace(/^local-/, "") : key;
    const mapping: ExactMapping = {
      confirmed: true,
      key: newKey,
      blockID: block.id,
      source: block.source,
      translation: block.translation!,
      start: target[0],
      end: target[1],
      sourceStart: source[0],
      sourceEnd: source[1],
      position: JSON.stringify(position),
    };
    const previous = this.exact;
    const updated = [
      ...previous.filter((m) => m.key !== key && m.key !== newKey),
      mapping,
    ];
    // Persist offsets before modifying PDF so a successful PDF write has a durable counterpart.
    await writeJSON(this.storeName, updated);
    try {
      if (
        this.disposed ||
        block.source !== mapping.source ||
        block.translation !== mapping.translation
      )
        throw new Error("文本已变化或阅读器已关闭，请重新关联。");
      if (item) {
        const old = {
          text: item.annotationText,
          position: item.annotationPosition,
          pageLabel: item.annotationPageLabel,
          sortIndex: item.annotationSortIndex,
        };
        try {
          item.annotationText = block.source.slice(...source);
          item.annotationPosition = JSON.stringify(position);
          item.annotationPageLabel = block.pageLabel;
          Object.assign(item, { annotationSortIndex: sortIndex });
          await item.saveTx();
        } catch (error) {
          item.annotationText = old.text;
          item.annotationPosition = old.position;
          item.annotationPageLabel = old.pageLabel;
          item.annotationSortIndex = old.sortIndex;
          throw error;
        }
      } else {
        await Zotero.Annotations.saveFromJSON(this.integration.item, {
          key: newKey,
          id: newKey,
          libraryID: this.integration.item.libraryID,
          readOnly: false,
          dateModified: new Date().toISOString(),
          type: local!.type,
          text: block.source.slice(...source),
          comment: local!.comment,
          color: local!.color,
          pageLabel: block.pageLabel,
          sortIndex,
          position,
        } as Parameters<typeof Zotero.Annotations.saveFromJSON>[1]);
      }
    } catch (error) {
      await writeJSON(this.storeName, previous);
      throw error;
    }
    this.exact = updated;
    if (local) {
      this.local = this.local.filter((a) => a.key !== key);
      await this.saveLocal();
    }
    await this.refresh();
    return newKey;
  }
  async resolvePair(
    block: Block,
    side: "source" | "translation",
    start: number,
    end: number,
  ) {
    this.alignmentStatus = "";
    const snapshot = block.translation;
    const sourceSnapshot = block.source;
    const selected =
      (side === "translation" ? snapshot : block.source)
        ?.slice(start, end)
        .trim() || "";
    if (!selected) throw new Error("请先选中文字。");
    const glossary = await loadGlossary(this.integration.identity);
    // Only learn user-confirmed pairs; never propagate legacy guessed offsets.
    let learned: string | undefined;
    for (const pair of this.exact) {
      if (!pair.confirmed) continue;
      const from =
        side === "source"
          ? pair.source.slice(pair.sourceStart, pair.sourceEnd)
          : pair.translation.slice(pair.start, pair.end);
      if (from.trim().toLowerCase() === selected.toLowerCase())
        learned =
          side === "source"
            ? pair.translation.slice(pair.start, pair.end)
            : pair.source.slice(pair.sourceStart, pair.sourceEnd);
    }
    const candidates = [
      ...(learned ? [learned] : []),
      selected,
      ...Object.entries(glossary)
        .filter(
          ([source, target]) =>
            (side === "translation" ? target : source).trim().toLowerCase() ===
            selected.toLowerCase(),
        )
        .map(([source, target]) => (side === "translation" ? source : target)),
    ];
    const match =
      side === "translation" ? preciseTranslationRange : preciseSourceRange;
    const known = this.exact.filter(
      (m) =>
        m.confirmed === true &&
        m.blockID === block.id &&
        m.source === block.source &&
        m.translation === block.translation &&
        this.annotations.some(
          (a) => a.key === m.key && JSON.stringify(a.position) === m.position,
        ),
    );
    const remembered = known
      .reverse()
      .find((m) =>
        side === "source"
          ? m.sourceStart === start && m.sourceEnd === end && m.end > m.start
          : m.start === start && m.end === end && m.sourceEnd > m.sourceStart,
      );
    let counterpart: [number, number] | undefined = remembered
      ? side === "source"
        ? [remembered.start, remembered.end]
        : [remembered.sourceStart, remembered.sourceEnd]
      : match(block, start, end, candidates);
    if (!counterpart && localModelConfigured() && snapshot) {
      try {
        counterpart = await localModelRange(
          sourceSnapshot,
          snapshot,
          side,
          start,
          end,
        );
        if (counterpart) this.alignmentStatus = "本地 ONNX 模型（CPU，离线）";
      } catch (error) {
        this.alignmentStatus = `本地模型未完成对齐：${String(error)}。已保留所选标注，可手动绑定。`;
      }
    }
    if (
      this.disposed ||
      snapshot !== block.translation ||
      sourceSnapshot !== block.source
    )
      throw new Error("文本已更新，请重新选择。");
    return {
      counterpart,
      source: sourceSnapshot,
      translation: snapshot,
      status: this.alignmentStatus,
    };
  }
  async create(
    block: Block,
    side: "source" | "translation",
    start: number,
    end: number,
    color: string,
    type: "highlight" | "underline" = "highlight",
    review?: (
      source: string,
      translation: string,
    ) => Promise<"accept" | "single" | "cancel">,
    prepared?: {
      counterpart?: [number, number];
      source: string;
      translation?: string;
      status: string;
    },
  ) {
    if (!this.integration.item.isEditable())
      throw new Error("This attachment is read-only.");
    const resolved =
      prepared || (await this.resolvePair(block, side, start, end));
    const snapshot = resolved.translation,
      sourceSnapshot = resolved.source;
    let counterpart = resolved.counterpart;
    this.alignmentStatus = resolved.status;
    const otherText = side === "source" ? snapshot : sourceSnapshot;
    if (
      counterpart &&
      (!Number.isInteger(counterpart[0]) ||
        !Number.isInteger(counterpart[1]) ||
        counterpart[0] < 0 ||
        counterpart[1] <= counterpart[0] ||
        counterpart[1] > (otherText?.length || 0))
    )
      throw new Error("对应词范围无效，请重新选择。");
    if (counterpart && review) {
      const sourceRange = side === "source" ? [start, end] : counterpart;
      const targetRange = side === "translation" ? [start, end] : counterpart;
      const choice = await review(
        block.source.slice(sourceRange[0], sourceRange[1]),
        (block.translation || "").slice(targetRange[0], targetRange[1]),
      );
      if (choice === "cancel") throw new Error("已取消，未创建标注。");
      if (choice === "single") counterpart = undefined;
    }
    if (
      this.disposed ||
      snapshot !== block.translation ||
      sourceSnapshot !== block.source
    )
      throw new Error("文本已更新或阅读器已关闭，请重新选择。");
    if (!counterpart && !this.alignmentStatus)
      this.alignmentStatus =
        "未找到本地对应关系。已保留所选标注，可选择另一侧词组绑定；不会发起对齐网络请求。";
    if (counterpart) this.alignmentStatus = "已匹配并保存双向词组关联。";
    if (side === "translation" && !counterpart) {
      const key = "local-" + (Zotero as any).DataObjectUtilities.generateKey();
      const record: LocalAnnotation = {
        key,
        blockID: block.id,
        source: block.source,
        translation: snapshot!,
        start,
        end,
        color,
        type,
        comment: "",
      };
      this.local.push(record);
      try {
        await this.saveLocal();
      } catch (error) {
        this.local = this.local.filter((a) => a !== record);
        throw error;
      }
      this.changed();
      return key;
    }
    const span = side === "translation" ? counterpart! : [start, end];
    const target =
      side === "translation" ? [start, end] : counterpart || [0, 0];
    const [sourceStart, sourceEnd] = span;
    const rects = sourceRects(block, sourceStart, sourceEnd);
    if (!rects.length)
      throw new Error("No PDF coordinates for this selection.");
    const first = block.anchors.find((a) => a.end > sourceStart)!;
    const position = { pageIndex: block.pageIndex, rects };
    const key = (Zotero as any).DataObjectUtilities.generateKey();
    const sortIndex = [
      String(block.pageIndex).padStart(5, "0"),
      String(first.charIndex).padStart(6, "0"),
      String(Math.max(0, Math.floor(block.pageHeight - rects[0][3]))).padStart(
        5,
        "0",
      ),
    ].join("|");
    await Zotero.Annotations.saveFromJSON(this.integration.item, {
      key,
      id: key,
      libraryID: this.integration.item.libraryID,
      readOnly: false,
      dateModified: new Date().toISOString(),
      type,
      text: block.source.slice(sourceStart, sourceEnd).trim(),
      comment: "",
      color,
      pageLabel: block.pageLabel,
      sortIndex,
      position,
    } as Parameters<typeof Zotero.Annotations.saveFromJSON>[1]);
    if (block.translation) {
      this.exact.push({
        confirmed: !!review && !!counterpart,
        key,
        blockID: block.id,
        source: block.source,
        translation: block.translation,
        start: target[0],
        end: target[1],
        sourceStart,
        sourceEnd,
        position: JSON.stringify(position),
      });
      try {
        await writeJSON(this.storeName, this.exact);
      } catch (error) {
        // Annotation already exists canonically. Never prompt retry of creation.
        Zotero.logError(error as Error);
      }
    }
    await this.refresh();
    await this.focus(key);
    return key;
  }
  dispose() {
    this.disposed = true;
    if (this.observer) Zotero.Notifier.unregisterObserver(this.observer);
  }
}
