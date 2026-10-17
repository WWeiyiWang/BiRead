import type { Block, Rect } from "../types";
import { blockRect } from "./pdfImages";
import { segmentText } from "../alignment/segmentAlignment";
const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
export function isMathFragment(text: string) {
  const normal = text
    .normalize("NFKC")
    .replace(
      /\b(?:sin|cos|tan|arccos|arcsin|det|tr|max|min|log|ln|total|frame|membrane)\b/g,
      "0",
    );
  return (
    normal.length <= 512 &&
    !/[A-Za-z]{3}/.test(normal) &&
    // PDF runs may contain standalone combining marks and variation selectors.
    // eslint-disable-next-line no-misleading-character-class
    /^[\sA-Za-z0-9\u0370-\u03ff\ue000-\uf8ff\u0300-\u036f\ufe00-\ufe0f′'()[\]{}+−=≈∝≠≤≥∂×⊗∥∑∫∈√¯.,/*-]+$/.test(
      normal,
    )
  );
}

/** PDF runs can emit a subscript after the equation's right-hand side, in the
 * same run as the following prose. Separate it only when its coordinates sit
 * inside the preceding mathematical suffix, not at the start of a new line. */
export function splitMathContinuations(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const b of blocks) {
    const prev = result.at(-1);
    const match =
      b.kind === "paragraph" &&
      b.source.match(
        /^([A-Za-z\u0370-\u03ff]\d{1,2})(?=\s*[,;]|\s+(?:and|which|where|is|are)\b)/,
      );
    if (
      !match ||
      !prev ||
      prev.pageIndex !== b.pageIndex ||
      !["paragraph", "equation"].includes(prev.kind) ||
      !/[\u0370-\u03ff=≈]/.test(prev.source.slice(-60))
    ) {
      result.push(b);
      continue;
    }
    const script = b.anchors.filter((a) => a.end <= match[1].length);
    const tail = prev.anchors.slice(-25),
      last = tail.at(-1);
    if (
      !script.length ||
      !last ||
      !script.every(
        (a) =>
          a.rect[0] >= Math.min(...tail.map((t) => t.rect[0])) &&
          a.rect[2] <= last.rect[2] + 2 &&
          Math.max(last.rect[1] - a.rect[3], a.rect[1] - last.rect[3], 0) < 4,
      )
    ) {
      result.push(b);
      continue;
    }
    const offset =
      b.source.length - b.source.slice(match[1].length).trimStart().length;
    const rest = b.source.slice(offset),
      id = b.id + "-prose";
    result.push(
      {
        ...b,
        source: match[1],
        anchors: script,
        segments: segmentText(match[1], b.id),
      },
      {
        ...b,
        id,
        source: rest,
        anchors: b.anchors
          .filter((a) => a.start >= offset)
          .map((a) => ({ ...a, start: a.start - offset, end: a.end - offset })),
        segments: segmentText(rest, id),
      },
    );
  }
  return result;
}

// Native PDF runs emit fraction numerators and scripts after the prose line.
// Group these spatially, then retain their original PDF pixels as one object.
export function preserveInlineMath(blocks: Block[]): Block[] {
  const removed = new Set<Block>();
  const stackedVariables = (b: Block) => {
    if (!/^[A-Za-z\u0370-\u03ff]\s+[A-Za-z\u0370-\u03ff]$/.test(b.source))
      return false;
    const a = b.anchors[0]?.rect,
      z = b.anchors.at(-1)?.rect;
    return (
      a &&
      z &&
      Math.min(a[2], z[2]) > Math.max(a[0], z[0]) &&
      Math.abs(a[1] - z[1]) > 2
    );
  };
  const short = (b: Block) =>
    ["paragraph", "heading"].includes(b.kind) &&
    b.anchors.length &&
    isMathFragment(b.source);
  for (const owner of blocks) {
    if (
      removed.has(owner) ||
      !short(owner) ||
      !(
        /[\u0370-\u03ff\ue000-\uf8ff\u{1d400}-\u{1d7ff}=∥]/u.test(
          owner.source,
        ) ||
        /^[A-Za-z]\d{1,2}$/.test(owner.source) ||
        stackedVariables(owner)
      )
    )
      continue;
    const seed = blockRect(owner);
    const parts = [owner];
    let rect = seed;
    // Connected spatial components recover matrices and fractions emitted as
    // separate PDF text runs, including mathematical alphabets and private glyphs.
    for (let changed = true; changed; ) {
      changed = false;
      for (const b of blocks) {
        if (
          parts.includes(b) ||
          removed.has(b) ||
          !short(b) ||
          b.pageIndex !== owner.pageIndex
        )
          continue;
        const r = blockRect(b),
          joined = union(rect, r);
        if (joined[2] - joined[0] > 260 || joined[3] - joined[1] > 32) continue;
        if (
          Math.max(rect[0] - r[2], r[0] - rect[2], 0) < 25 &&
          Math.max(rect[1] - r[3], r[1] - rect[3], 0) < 5
        ) {
          parts.push(b);
          rect = joined;
          changed = true;
        }
      }
    }

    const picked = new Map<Block, Set<number>>();
    for (const b of parts)
      picked.set(b, new Set(b.anchors.map((a) => a.charIndex)));
    for (const b of blocks) {
      if (
        parts.includes(b) ||
        b.kind !== "paragraph" ||
        b.pageIndex !== owner.pageIndex ||
        !b.anchors.length
      )
        continue;
      // Only a leading/trailing mathematical run may join; prose words never join.
      const token =
        "(?:det|sin|cos|tan|[A-Za-z\\u0370-\\u03ff\\u{1d400}-\\u{1d7ff}](?![A-Za-z])|[0-9]+(?:\\.[0-9]+)?|[\\ue000-\\uf8ff=≈∝≠≤≥∂×⊗∥∑∫∈√¯+−*/()′'])";
      const suffix = b.source.match(
        new RegExp("(?:^|\\s)(" + token + "(?:\\s*" + token + ")*)\\s*$", "u"),
      );
      const prefix = b.source.match(
        new RegExp(
          "^(" + token + "(?:\\s*" + token + ")*)(?=\\s*[,;(]|\\s+[A-Za-z]{2})",
          "u",
        ),
      );
      const candidates = [];
      if (suffix)
        candidates.push([b.source.lastIndexOf(suffix[1]), b.source.length]);
      if (prefix) candidates.push([0, prefix[1].length]);
      for (const [start, end] of candidates) {
        const anchors = b.anchors.filter(
          (a) => a.start >= start && a.end <= end,
        );
        if (!anchors.length) continue;
        const r = anchors.reduce((r, a) => union(r, a.rect), anchors[0].rect);
        if (
          Math.max(rect[0] - r[2], r[0] - rect[2], 0) > 22 ||
          Math.max(rect[1] - r[3], r[1] - rect[3], 0) > 3
        )
          continue;
        rect = union(rect, r);
        picked.set(
          b,
          new Set([
            ...(picked.get(b) || []),
            ...anchors.map((a) => a.charIndex),
          ]),
        );
      }
    }
    if (picked.size < 2) continue;
    // PDF run order can put operators and connecting words into a different
    // prose run. Every glyph already visible inside this crop belongs to the
    // crop; emitting it again would duplicate a broken version of the formula.
    for (const b of blocks) {
      if (
        b.kind !== "paragraph" ||
        b.pageIndex !== owner.pageIndex ||
        removed.has(b)
      )
        continue;
      const covered = b.anchors.filter(
        (a) =>
          a.rect[0] >= rect[0] - 0.25 &&
          a.rect[2] <= rect[2] + 0.25 &&
          a.rect[1] >= rect[1] - 0.25 &&
          a.rect[3] <= rect[3] + 0.25,
      );
      if (covered.length)
        picked.set(
          b,
          new Set([
            ...(picked.get(b) || []),
            ...covered.map((a) => a.charIndex),
          ]),
        );
    }
    let mathSource = "";
    const mathAnchors: Block["anchors"] = [];
    for (const [b, ids] of picked) {
      const old = b.source;
      let source = "";
      const anchors: Block["anchors"] = [];
      for (const a of b.anchors) {
        const text = old.slice(a.start, a.end);
        if (ids.has(a.charIndex)) {
          const start = mathSource.length;
          mathSource += text;
          mathAnchors.push({ ...a, start, end: mathSource.length });
        } else {
          const previous = anchors[anchors.length - 1];
          if (
            previous &&
            /\s/.test(
              old.slice(
                b.anchors.find((x) => x.charIndex === previous.charIndex)!.end,
                a.start,
              ),
            )
          )
            source += " ";
          const start = source.length;
          source += text;
          anchors.push({ ...a, start, end: source.length });
        }
      }
      if (b !== owner) {
        if (!source.trim()) removed.add(b);
        else {
          b.source = source;
          b.anchors = anchors;
          b.segments = segmentText(source, b.id);
        }
      }
    }
    owner.kind = "equation";
    owner.source = mathSource;
    owner.anchors = mathAnchors;
    owner.segments = segmentText(mathSource, owner.id);
    owner.originalRegion = {
      kind: "equation",
      rect: [rect[0] - 0.5, rect[1] - 0.5, rect[2] + 0.5, rect[3] + 0.5],
    };
  }
  return blocks.filter((b) => !removed.has(b));
}
