import type { Block, LinkedAnnotation, Rect } from "../types";
import { mapRange } from "../alignment/selectionMapping";
export interface CanonicalAnnotation {
  key: string;
  type?: "highlight" | "underline";
  color: string;
  comment: string;
  position: { pageIndex: number; rects?: Rect[]; nextPageRects?: Rect[] };
}
export interface ExactMapping {
  key: string;
  blockID: string;
  source: string;
  translation: string;
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  position: string;
}
export function containsCenter(rect: Rect, glyph: Rect) {
  const x = (glyph[0] + glyph[2]) / 2,
    y = (glyph[1] + glyph[3]) / 2;
  return (
    x >= rect[0] - 0.25 &&
    x <= rect[2] + 0.25 &&
    y >= rect[1] - 0.25 &&
    y <= rect[3] + 0.25
  );
}
export function annotationMappings(
  block: Block,
  annotations: CanonicalAnnotation[],
  exact: ExactMapping[] = [],
): LinkedAnnotation[] {
  const result: LinkedAnnotation[] = [];
  for (const annotation of annotations) {
    const position = annotation.position;
    const rects =
      block.pageIndex === position.pageIndex
        ? position.rects
        : block.pageIndex === position.pageIndex + 1
          ? position.nextPageRects
          : undefined;
    if (!rects?.length) continue;
    const anchors = block.anchors.filter((a) =>
      rects.some((rect) => containsCenter(rect, a.rect)),
    );
    if (!anchors.length) continue;
    const start = Math.min(...anchors.map((a) => a.start)),
      end = Math.min(
        block.source.length,
        Math.max(...anchors.map((a) => a.end)),
      );
    const translated = mapRange(block, "source", start, end);
    if (!translated) continue;
    const saved = exact.find(
      (m) =>
        m.key === annotation.key &&
        m.blockID === block.id &&
        m.source === block.source &&
        m.translation === block.translation &&
        m.position === JSON.stringify(position),
    );
    const [targetStart, targetEnd] = saved
      ? [saved.start, saved.end]
      : translated;
    result.push({
      type: annotation.type,
      logicalAnnotationID: annotation.key,
      zoteroAnnotationKey: annotation.key,
      blockID: block.id,
      color: annotation.color,
      comment: annotation.comment,
      source: {
        startOffset: start,
        endOffset: end,
        text: block.source.slice(start, end),
      },
      translation: {
        startOffset: targetStart,
        endOffset: targetEnd,
        text: block.translation!.slice(targetStart, targetEnd),
      },
    });
  }
  return result;
}
export function sourceRects(block: Block, start: number, end: number): Rect[] {
  const anchors = block.anchors.filter((a) => a.end > start && a.start < end);
  const rects: Rect[] = [];
  for (const anchor of anchors) {
    const rect = anchor.rect;
    const previous = rects[rects.length - 1];
    const sameLine =
      previous &&
      Math.abs(previous[1] - rect[1]) < 2 &&
      Math.abs(previous[3] - rect[3]) < 2 &&
      rect[0] >= previous[0] &&
      rect[0] - previous[2] < 15;
    if (sameLine) {
      previous[0] = Math.min(previous[0], rect[0]);
      previous[1] = Math.min(previous[1], rect[1]);
      previous[2] = Math.max(previous[2], rect[2]);
      previous[3] = Math.max(previous[3], rect[3]);
    } else rects.push([...rect]);
  }
  return rects;
}
