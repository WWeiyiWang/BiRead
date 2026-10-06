import { textLines, lineText } from "./documentStructure";
import type { Block, Glyph } from "../types";
import { segmentText } from "../alignment/segmentAlignment";

function median(values: number[]) {
  const sorted = values
    .filter((v) => v > 0 && Number.isFinite(v))
    .sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

/** Some publishers put the Abstract label on the first line of its prose. */
function splitAbstractLabel(line: Glyph[]): Glyph[][] {
  const text = lineText(line);
  if (!/^abstract\b/i.test(text)) return [line];
  for (let end = 1; end < line.length; end++) {
    const label = lineText(line.slice(0, end));
    if (!/^abstract[:：.]?$/i.test(label)) continue;
    const rest = line.slice(end);
    const prose = lineText(rest);
    if (!prose || /^[:：.]/.test(prose) || !/\s|[:：.]/.test(text.slice(8, 9)))
      continue;
    const labelBold = line.slice(0, end).some((g) => g.bold);
    const firstBodyGlyph = rest.find((g) => g.text.trim());
    if (
      /[:：.]$/.test(label) ||
      (labelBold && !firstBodyGlyph?.bold) ||
      /^[A-Z]/.test(prose)
    )
      return [line.slice(0, end), rest];
  }
  return [line];
}
export function segmentPage(
  glyphs: Glyph[],
  pageIndex: number,
  pageLabel: string,
  pageHeight: number,
  references: { active: boolean },
): Block[] {
  const blocks: Block[] = [];
  let source = "";
  let anchors: Block["anchors"] = [];
  let styles: Glyph[] = [];
  const flush = () => {
    source = source.trimEnd();
    if (!source.trim()) {
      source = "";
      anchors = [];
      styles = [];
      return;
    }
    const id = `p${pageIndex}-c${anchors[0].charIndex}`;
    let kind: Block["kind"] = "paragraph";
    const referenceHeading =
      /^(?:references|bibliography|works cited)\s*$/i.test(source);
    if (referenceHeading) references.active = true;
    if (/^(?:appendix|supplementary material)\b/i.test(source))
      references.active = false;
    if (referenceHeading) kind = "heading";
    else if (references.active) kind = "reference";
    else if (/^(?:fig(?:ure)?\.?|table)\s*\d+/i.test(source)) kind = "caption";
    else if (/^abstract[:：.]?\s*$/i.test(source)) kind = "heading";
    else if (/^abstract\b/i.test(source)) kind = "abstract";
    else if (/^(?:[•▪◦●‣–—-]\s*|\(?\d+[.)]\s+|[a-z][.)]\s+)/.test(source))
      kind = "list";
    else if (
      source.length < 180 &&
      /[=∑∫∏]/.test(source) &&
      (source.match(/[a-zA-Z]{3,}/g) || []).length < 3
    )
      kind = "equation";
    blocks.push({
      id,
      kind,
      pageIndex,
      pageLabel,
      pageHeight,
      source,
      anchors,
      fontSize: median(styles.map((g) => g.fontSize || 0)),
      bold: styles.filter((g) => g.bold).length > styles.length * 0.65,
      italic: styles.filter((g) => g.italic).length > styles.length * 0.65,
      segments: segmentText(source, id),
    });
    source = "";
    anchors = [];
    styles = [];
  };
  const lines = textLines(glyphs).flatMap(splitAbstractLabel);
  let previousSize = 0;
  let pendingHeading = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      text = lineText(line),
      size = median(line.map((g) => g.fontSize || 0));
    const list = /^(?:[•▪◦●‣–—-]\s+|\(?\d+[.)]\s+|[a-z][.)]\s+)/.test(text);
    const heading =
      text.length < 160 &&
      !/[.!?;,]$/.test(text) &&
      (/^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\s+[A-Z]/.test(text) ||
        /^(?:Abstract|Introduction|References|Bibliography|Conclusion|Acknowledgments)$/i.test(
          text,
        ));
    if (
      source &&
      (list ||
        heading ||
        (pendingHeading && text.length > 80) ||
        (size &&
          previousSize &&
          Math.max(size, previousSize) / Math.min(size, previousSize) > 1.18))
    )
      flush();
    for (const glyph of line) {
      if (!source && !glyph.text.trim()) continue;
      const start = source.length;
      source += glyph.text;
      styles.push(glyph);
      anchors.push({
        start,
        end: source.length,
        pageIndex,
        charIndex: glyph.index,
        rect: glyph.rect,
      });
      if ((glyph.spaceAfter || glyph.lineBreakAfter) && !/\s$/.test(source))
        source += " ";
      if (glyph.paragraphBreakAfter) flush();
    }
    // A standalone label must not absorb even a short following prose line.
    if (/^abstract[:：.]?\s*$/i.test(source)) flush();
    pendingHeading = !!source && heading;
    previousSize = size;
  }
  flush();
  return blocks;
}

/** Infer hierarchy from the whole paper rather than treating every short line as a heading. */
export function inferHierarchy(blocks: Block[]) {
  const body =
    median(
      blocks
        .filter((b) => b.kind === "paragraph" && b.source.length > 160)
        .map((b) => b.fontSize || 0),
    ) || median(blocks.map((b) => b.fontSize || 0));
  for (const block of blocks) {
    if (block.table) continue;
    if (!["paragraph", "heading", "list"].includes(block.kind)) continue;
    const text = block.source.trim();
    if (/^(?:arXiv:|https?:|doi:)/i.test(text)) continue;
    const short =
      text.length < 180 &&
      text.split(/\s+/).length < 24 &&
      !/[.!?;,]$/.test(text);
    const numbered = text.match(/^((?:\d+|[A-Z])(?:\.\d+)*)(?:\.)?\s+[A-Za-z]/);
    const known =
      /^(?:abstract[:：.]?|introduction|background|related work|methods?|methodology|results?|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments?|appendix(?:\s+[A-Z])?)$/i.test(
        text,
      );
    const large = !!body && (block.fontSize || 0) > body * 1.12;
    const title =
      block.pageIndex === 0 &&
      !/^abstract[:：.]?$/i.test(text) &&
      blocks.indexOf(block) < 2 &&
      short &&
      !!body &&
      (block.fontSize || 0) > body * 1.25;
    if (title) {
      block.kind = "title";
      continue;
    }
    const numberedList = block.kind === "list" && !block.bold && !large;
    const bodyScale = !body || !block.fontSize || block.fontSize >= body * 0.9;
    if (
      !numberedList &&
      bodyScale &&
      short &&
      (known || numbered || block.bold || large)
    ) {
      block.kind = "heading";
      block.headingLevel = numbered
        ? Math.min(3, numbered[1].split(".").length)
        : large || known
          ? 1
          : block.italic
            ? 3
            : 2;
    } else if (block.kind === "heading") block.headingLevel = 1;
  }
  // Adjacent title lines often arrive as separate native paragraphs.
  for (let i = 1; i < blocks.length; i++) {
    const previous = blocks[i - 1],
      current = blocks[i];
    if (
      previous.kind !== "title" ||
      current.kind !== "title" ||
      previous.pageIndex !== current.pageIndex
    )
      continue;
    const offset = previous.source.length + 1;
    previous.source += " " + current.source;
    previous.anchors.push(
      ...current.anchors.map((a) => ({
        ...a,
        start: a.start + offset,
        end: a.end + offset,
      })),
    );
    previous.segments = segmentText(previous.source, previous.id);
    blocks.splice(i--, 1);
  }
}
