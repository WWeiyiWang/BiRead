import type { Block } from "../types";

/** Display-only links: never merge canonical offsets or PDF page coordinates. */
export function pageContinuations(blocks: Block[]): [Block, Block][] {
  const links: [Block, Block][] = [];
  const pages = [...new Set(blocks.map((b) => b.pageIndex))].sort(
    (a, b) => a - b,
  );
  for (const page of pages) {
    const before = blocks.filter(
      (b) => b.pageIndex === page && b.kind !== "footnote",
    );
    const after = blocks.filter(
      (b) => b.pageIndex === page + 1 && b.kind !== "footnote",
    );
    const a = before.at(-1),
      b = after[0];
    if (
      !a ||
      !b ||
      a.kind !== "paragraph" ||
      b.kind !== "paragraph" ||
      a.table ||
      b.table
    )
      continue;
    if (!a.anchors.length || !b.anchors.length) continue;
    const last = a.anchors.at(-1)!,
      first = b.anchors[0];
    const size = a.fontSize || 10;
    // Require an unfinished sentence and a lowercase continuation. Ambiguous
    // complete sentences, new indented paragraphs, headings and lists stay apart.
    if (
      /[.!?。！？:：;；][\s”’"')\]]*$/.test(a.source) ||
      !/^[a-z]/.test(b.source.trim())
    )
      continue;
    if (
      Math.abs((b.fontSize || size) - size) > size * 0.12 ||
      a.bold !== b.bold ||
      a.italic !== b.italic
    )
      continue;
    if (
      last.rect[1] > a.pageHeight * 0.3 ||
      first.rect[3] < b.pageHeight * 0.65
    )
      continue;
    const top = first.rect[3];
    const later = b.anchors.filter((x) => x.rect[3] < top - size * 0.5);
    const left = later.length
      ? Math.min(...later.map((x) => x.rect[0]))
      : first.rect[0];
    if (first.rect[0] - left > size * 0.7) continue;
    links.push([a, b]);
  }
  return links;
}
