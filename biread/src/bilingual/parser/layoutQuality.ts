import type { Block, Glyph, Rect } from "../types";
import { isMathFragment } from "./inlineMath";
import { segmentPage } from "./blockSegmenter";
import { preserveOpaqueInlineGlyphs } from "./opaqueInlineGlyphs";
import { blockRect } from "./pdfImages";

export type LayoutIssue =
  | "no-text"
  | "unreadable-glyphs"
  | "fragmented-math"
  | "missing-text"
  | "invalid-region"
  | "missing-visual-region"
  | "overlapping-regions";
const contains = (r: Rect, q: Rect) => {
  const x = (q[0] + q[2]) / 2,
    y = (q[1] + q[3]) / 2;
  return x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1;
};
/** Independent acceptance gate: a parser result is not safe just because it
 * completed. Every retained glyph needs a text anchor or a preserved region. */
export function auditLayout(
  glyphs: Glyph[],
  blocks: Block[],
  box: Rect,
): LayoutIssue[] {
  const issues = new Set<LayoutIssue>();
  const visible = glyphs.filter((g) => g.text.trim());
  if (!visible.length) issues.add("no-text");
  const ids = new Set(blocks.flatMap((b) => b.anchors.map((a) => a.charIndex)));
  const regions = blocks.flatMap((b) => [
    ...(b.originalRegion ? [b.originalRegion.rect] : []),
    ...(b.inlineMath || []).map((m) => m.rect),
  ]);
  for (const r of regions)
    if (
      !r.every(Number.isFinite) ||
      r[2] <= r[0] ||
      r[3] <= r[1] ||
      r[0] < box[0] - 5 ||
      r[1] < box[1] - 5 ||
      r[2] > box[2] + 5 ||
      r[3] > box[3] + 5
    )
      issues.add("invalid-region");
  const missing = visible.filter(
    (g) => !ids.has(g.index) && !regions.some((r) => contains(r, g.rect)),
  );
  if (missing.length > Math.max(4, visible.length * 0.005))
    issues.add("missing-text");
  for (const b of blocks) {
    if (
      b.kind === "caption" &&
      !b.originalRegion &&
      !blocks.some((c) => c.table?.captionID === b.id)
    )
      issues.add("missing-visual-region");
    if (b.kind !== "paragraph" || !b.anchors.length) continue;
    if (
      blocks.some(
        (other) =>
          other !== b &&
          other.originalRegion?.kind === "figure" &&
          b.anchors.filter((a) => contains(other.originalRegion!.rect, a.rect))
            .length >
            b.anchors.length * 0.8,
      )
    )
      issues.add("overlapping-regions");
  }
  let fragments = 0;
  const proseSizes = blocks
    .filter((b) => b.kind === "paragraph" && b.source.length > 140)
    .map((b) => b.fontSize || 0)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const proseSize = proseSizes[Math.floor(proseSizes.length / 2)] || 0;
  for (const b of blocks) {
    if (
      b.originalRegion ||
      ["reference", "caption", "table-cell"].includes(b.kind)
    )
      continue;
    const text = b.source.replace(/\$BIREAD_MATH_[^$]+\$/g, "");
    if (/[\ue000-\uf8ff\ufffd]/u.test(text)) issues.add("unreadable-glyphs");
    // Empty comma-separated brackets are often the shell left behind when a
    // fragmented vector's operands were moved into a separate equation crop.
    // A successfully embedded vector still has its inline objects here.
    if (
      ["paragraph", "list"].includes(b.kind) &&
      /\[\s*[,;]\s*\]/.test(b.source)
    )
      issues.add("fragmented-math");
    if (
      b.kind === "paragraph" &&
      text.length < 80 &&
      !/^\(?\d+[A-Za-z]?\)?$/.test(text.trim()) &&
      !/^(?:[IVXLCDM]+|[A-Z])\.$/.test(text.trim()) &&
      isMathFragment(text) &&
      (/[\u0370-\u03ff\u{1d400}-\u{1d7ff}∂=∥]/u.test(text) ||
        (text.length <= 16 &&
          /[A-Za-z]/.test(text) &&
          !!proseSize &&
          !b.inlineMath?.length) ||
        (!!proseSize &&
          !!b.fontSize &&
          b.fontSize < proseSize * 0.85 &&
          /^[A-Za-z0-9\s′'()+−=-]{1,20}$/.test(text)))
    )
      fragments++;
  }
  if (fragments >= 2) issues.add("fragmented-math");
  return [...issues];
}
export function originalPage(
  pageIndex: number,
  pageLabel: string,
  box: Rect,
  issues: LayoutIssue[],
): Block {
  return {
    id: `p${pageIndex}-original`,
    kind: "original-page",
    pageIndex,
    pageLabel,
    pageHeight: box[3] - box[1],
    pageBox: box,
    source: "",
    segments: [],
    anchors: [],
    originalRegion: { kind: "page", rect: [...box] },
    layoutIssues: issues,
  };
}

/** Acceptance is local: a defective region must never discard readable prose. */
export function acceptLayout(
  blocks: Block[],
  issues: LayoutIssue[],
  pageIndex: number,
  label: string,
  box: Rect,
  glyphs: Glyph[] = [],
): Block[] {
  const visible = glyphs.filter((g) => g.text.trim());
  if (!blocks.length && !visible.length)
    return [originalPage(pageIndex, label, box, ["no-text"])];
  const valid = (r: Rect) =>
    r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1];
  const clipped = (r: Rect): Rect => [
    Math.max(box[0], r[0]),
    Math.max(box[1], r[1]),
    Math.min(box[2], r[2]),
    Math.min(box[3], r[3]),
  ];
  const warn = (b: Block, issue: string) => {
    b.layoutIssues = [...new Set([...(b.layoutIssues || []), issue])];
  };
  for (const b of blocks) {
    if (b.originalRegion) {
      const r = clipped(b.originalRegion.rect);
      const overlapsProse =
        b.originalRegion.kind === "figure" &&
        blocks.some(
          (p) =>
            p !== b &&
            p.kind === "paragraph" &&
            p.anchors.length &&
            p.anchors.filter((a) => contains(r, a.rect)).length >
              p.anchors.length * 0.8,
        );
      if (!valid(r) || overlapsProse) {
        delete b.originalRegion;
        warn(b, "missing-visual-region");
      } else b.originalRegion.rect = r;
    }
    // A malformed inline crop must not make the rest of its page disappear.
    for (const math of b.inlineMath || []) {
      const r = clipped(math.rect);
      if (valid(r)) math.rect = r;
      else warn(b, "invalid-region");
    }
  }
  // Recover text omitted by layout/model grouping, using original character IDs.
  // Valid preserved figures still mask their internal labels, avoiding duplicates.
  const ids = new Set(blocks.flatMap((b) => b.anchors.map((a) => a.charIndex)));
  const regions = blocks.flatMap((b) => [
    ...(b.originalRegion ? [b.originalRegion.rect] : []),
    ...(b.inlineMath || []).map((m) => m.rect).filter(valid),
  ]);
  const missing = visible.filter(
    (g) => !ids.has(g.index) && !regions.some((r) => contains(r, g.rect)),
  );
  if (missing.length) {
    const runs: Glyph[][] = [];
    let lastPosition = -2;
    const positions = new Map(visible.map((g, i) => [g, i]));
    for (const g of missing) {
      const position = positions.get(g)!;
      if (position !== lastPosition + 1) runs.push([]);
      runs[runs.length - 1].push({ ...g });
      lastPosition = position;
    }
    for (const [i, run] of runs.entries()) {
      const recovered = segmentPage(run, pageIndex, label, box[3] - box[1], {
        active: false,
      });
      for (const b of recovered) {
        b.id = `p${pageIndex}-recovered-${i}-${b.id}`;
        b.segments.forEach((s, j) => {
          s.id = `${b.id}-s${j}`;
        });
        warn(b, "recovered-text");
        const first = Math.min(...b.anchors.map((a) => a.charIndex));
        const next = blocks.findIndex(
          (p) =>
            p.anchors.length &&
            Math.min(...p.anchors.map((a) => a.charIndex)) > first,
        );
        blocks.splice(next < 0 ? blocks.length : next, 0, b);
      }
    }
  }
  preserveOpaqueInlineGlyphs(blocks);
  for (const b of blocks) {
    const text = b.source.replace(/\$BIREAD_MATH_[^$]+\$/g, "");
    const unreadable = /[\ue000-\uf8ff\ufffd]/u.test(text);
    const fragment =
      issues.includes("fragmented-math") &&
      ["paragraph", "list"].includes(b.kind) &&
      !b.inlineMath?.length &&
      text.length < 80 &&
      isMathFragment(text);
    if (
      !b.originalRegion &&
      (unreadable ||
        fragment ||
        b.kind === "equation" ||
        b.layoutIssues?.includes("invalid-region"))
    ) {
      const r = clipped(blockRect(b));
      if (valid(r)) {
        // Reuse the original-equation rendering path; only this bounded block
        // is preserved, and never marked as an untranslated whole page.
        b.originalRegion = { kind: "equation", rect: r };
        b.kind = "equation";
        delete b.inlineMath;
        b.segments = [];
        warn(b, "local-original");
      }
    }
    if (
      b.kind === "caption" &&
      !b.originalRegion &&
      !blocks.some((p) => p.table?.captionID === b.id)
    )
      warn(b, "missing-visual-region");
  }
  return blocks;
}
