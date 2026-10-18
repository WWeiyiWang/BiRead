import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { contentLane, overlapX } from "./regionGeometry";

/** Image-only formulas have no text seed. Require a compact graphic between
 * formula-introducing prose and its explanation; captions own their figures. */
export function preserveImageEquations(
  blocks: Block[],
  graphics: Rect[],
  box: Rect,
): Block[] {
  const result = [...blocks];
  for (const r of graphics) {
    const width = r[2] - r[0],
      height = r[3] - r[1];
    if (
      width < 35 ||
      height < 7 ||
      height > 90 ||
      width > (box[2] - box[0]) * 0.85
    )
      continue;
    if (
      result.some((b) =>
        [
          ...(b.originalRegion ? [b.originalRegion.rect] : []),
          ...(b.inlineMath || []).map((m) => m.rect),
        ].some(
          (q) =>
            overlapX(q, r) > 0 && Math.min(q[3], r[3]) > Math.max(q[1], r[1]),
        ),
      )
    )
      continue;
    const prose = result.filter(
      (b) =>
        b.kind === "paragraph" &&
        b.anchors.length &&
        overlapX(blockRect(b), r) > 0,
    );
    const before = prose
      .filter((b) => blockRect(b)[1] >= r[3] - 1)
      .sort((a, b) => blockRect(a)[1] - blockRect(b)[1])[0];
    const after = prose
      .filter((b) => blockRect(b)[3] <= r[1] + 1)
      .sort((a, b) => blockRect(b)[3] - blockRect(a)[3])[0];
    if (
      !before ||
      !after ||
      blockRect(before)[1] - r[3] > 45 ||
      r[1] - blockRect(after)[3] > 45 ||
      !/(?:[:=]|\b(?:as|by|gives|becomes))\s*$/i.test(before.source) ||
      !/^(?:(?:where|in which|with|here)\b|式中|其中)/i.test(after.source)
    )
      continue;
    const [left, right] = contentLane(before, result, box);
    if (r[0] < left || r[2] > right) continue;
    if (
      result.some((b) =>
        b.anchors.some(
          (a) =>
            a.rect[0] >= r[0] &&
            a.rect[2] <= r[2] &&
            a.rect[1] >= r[1] &&
            a.rect[3] <= r[3],
        ),
      )
    )
      continue;
    const equation: Block = {
      id: `${before.id}-image-equation-${result.length}`,
      kind: "equation",
      pageIndex: before.pageIndex,
      pageLabel: before.pageLabel,
      pageHeight: before.pageHeight,
      fontSize: before.fontSize,
      source: "",
      anchors: [],
      segments: [],
      originalRegion: {
        kind: "equation",
        rect: [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1],
      },
    };
    result.splice(result.indexOf(before) + 1, 0, equation);
  }
  return result;
}
