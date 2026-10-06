import type { Block, LinkedAnnotation } from "../types";
import type { PDFIntegration } from "../reader/pdfIntegration";
import { focusAnnotation } from "../reader/pdfIntegration";
import { digest, readJSON, writeJSON } from "../cache/documentCache";
import { mapRange } from "../alignment/selectionMapping";
import {
  annotationMappings,
  sourceRects,
  type CanonicalAnnotation,
  type ExactMapping,
} from "./annotationMapping";

export class AnnotationBridge {
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
    return annotationMappings(block, this.annotations, this.exact);
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
    this.item(key);
    await focusAnnotation(this.integration, key);
  }
  async comment(key: string, comment: string) {
    const item = this.item(key);
    if (!item.isEditable()) throw new Error("This annotation is read-only.");
    item.annotationComment = comment;
    await item.saveTx();
    await this.refresh();
  }
  async color(key: string, color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw new Error("Invalid annotation colour.");
    const item = this.item(key);
    if (!item.isEditable()) throw new Error("This annotation is read-only.");
    item.annotationColor = color;
    await item.saveTx();
    await this.refresh();
  }
  async remove(key: string) {
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
  async create(
    block: Block,
    side: "source" | "translation",
    start: number,
    end: number,
    color: string,
    type: "highlight" | "underline" = "highlight",
  ) {
    if (!this.integration.item.isEditable())
      throw new Error("This attachment is read-only.");
    const span =
      side === "translation" ? mapRange(block, side, start, end) : [start, end];
    if (!span) throw new Error("Translation alignment is not ready.");
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
    if (side === "translation" && block.translation) {
      this.exact.push({
        key,
        blockID: block.id,
        source: block.source,
        translation: block.translation,
        start,
        end,
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
