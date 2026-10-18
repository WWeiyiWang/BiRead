import type { Block } from "../types";
import { blockRect } from "./pdfImages";
import { segmentText } from "../alignment/segmentAlignment";

const labelPattern =
  /^(?:(extended\s+data|supplement(?:ary|al))\s+)?(fig(?:ure)?\.?|table|图|表)\s*([SA]?\d+(?:[.-]\d+)*[a-z]?|[IVXLCDM]+)(?=\s|[.:：|()\-–—]|$)/i;
/** Shared labels for classification, region ownership and preview rendering. */
export function captionKind(text: string): "figure" | "table" | undefined {
  const match = text.trim().match(labelPattern);
  if (!match) return;
  if (
    /^\s+(?:shows?|illustrates?|represents?|depicts?|presents?|provides?|is|are|was|were|can)\b/i.test(
      text.trim().slice(match[0].length),
    )
  )
    return;
  return /^(?:table|表)$/i.test(match[2]) ? "table" : "figure";
}

/** Adjacent bilingual captions describe one object, not two overlapping crops. */
export function mergeCaptionTranslations(blocks: Block[]): Block[] {
  const removed = new Set<Block>();
  for (const b of blocks) {
    const label = b.kind === "caption" && b.source.match(labelPattern);
    if (!label || !b.anchors.length) continue;
    const r = blockRect(b),
      size = b.fontSize || 10;
    // A wrapped sentence ending "shown in" followed by "Fig. 1. These ..."
    // remains prose, even when the PDF marks every physical line a paragraph.
    if (
      blocks.some(
        (p) =>
          p !== b &&
          p.pageIndex === b.pageIndex &&
          p.kind === "paragraph" &&
          p.anchors.length &&
          /(?:\b(?:shown|illustrated|presented|displayed|given|described|depicted|listed)\s+in|\bsee|\brefer\s+to)\s*$/i.test(
            p.source,
          ) &&
          Math.abs((p.fontSize || size) - size) < size * 0.1 &&
          (() => {
            const q = blockRect(p);
            return (
              q[1] >= r[3] - 2 &&
              q[1] - r[3] < size * 3 &&
              Math.abs(q[0] - r[0]) < size * 2
            );
          })(),
      )
    ) {
      b.kind = "paragraph";
      continue;
    }
    if (
      b.source
        .slice(label[0].length)
        .replace(/[.:：|]/g, "")
        .trim()
    )
      continue;
    if (
      blocks.some(
        (p) =>
          p !== b &&
          p.kind === "paragraph" &&
          p.source.length > 20 &&
          p.anchors.some(
            (a) =>
              Math.abs(a.rect[1] - r[1]) < size * 0.4 &&
              Math.max(r[0] - a.rect[2], a.rect[0] - r[2], 0) < size * 3,
          ),
      )
    )
      b.kind = "paragraph";
  }
  for (const a of blocks) {
    const first = a.kind === "caption" && a.source.match(labelPattern);
    if (!first || removed.has(a) || !a.anchors.length) continue;
    for (const b of blocks) {
      const second = b.kind === "caption" && b.source.match(labelPattern);
      if (
        a === b ||
        removed.has(b) ||
        !second ||
        !b.anchors.length ||
        a.pageIndex !== b.pageIndex ||
        captionKind(a.source) !== captionKind(b.source) ||
        first[3].toLowerCase() !== second[3].toLowerCase() ||
        !!first[1] !== !!second[1] ||
        /[图表]/.test(first[2]) === /[图表]/.test(second[2])
      )
        continue;
      const r = blockRect(a),
        q = blockRect(b);
      const overlap = Math.min(r[2], q[2]) - Math.max(r[0], q[0]);
      if (
        overlap < Math.min(r[2] - r[0], q[2] - q[0]) * 0.5 ||
        Math.max(r[1] - q[3], q[1] - r[3], 0) > (a.fontSize || 10) * 3
      )
        continue;
      const offset = a.source.length + 1;
      a.source += "\n" + b.source;
      a.anchors.push(
        ...b.anchors.map((p) => ({
          ...p,
          start: p.start + offset,
          end: p.end + offset,
        })),
      );
      a.segments = segmentText(a.source, a.id);
      removed.add(b);
    }
  }
  return blocks.filter((b) => !removed.has(b));
}

export function equationNumber(
  text: string,
  trailing = true,
): string | undefined {
  const pattern = "\\(([A-Za-z]?\\d+(?:[.-]\\d+)*[a-z]?|[A-Z]\\.\\d+[a-z]?)\\)";
  return text.match(new RegExp(pattern + (trailing ? "\\s*$" : "")))?.[1];
}
