import type { Block, Glyph, Rect } from "../types";
import { isMathFragment } from "./inlineMath";

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
