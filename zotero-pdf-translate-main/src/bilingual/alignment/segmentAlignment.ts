import type { Block, Segment } from "../types";

// Sentence units are internal. Rendering always joins them into one paragraph.
export function segmentText(text: string, blockID: string): Segment[] {
  const result: Segment[] = [];
  const boundaries =
    /[.!?。！？]+(?:[”’"')\]]*)\s+(?=[A-Z\u3400-\u9fff])|[。！？]+(?=[\u3400-\u9fff])/gu;
  let start = 0;
  const append = (end: number) => {
    if (end > start)
      result.push({
        id: `${blockID}-s${result.length + 1}`,
        sourceStart: start,
        sourceEnd: end,
        source: text.slice(start, end),
      });
    start = end;
  };
  for (const match of text.matchAll(boundaries)) {
    const end = match.index! + match[0].length;
    // Common academic abbreviations must not create artificial alignment units.
    if (
      /\b(?:et al|e\.g|i\.e|Fig|Dr|Prof|Eq|vs)\.\s*$/i.test(
        text.slice(start, end),
      )
    )
      continue;
    append(end);
  }
  append(text.length);
  return result;
}

export function applyTranslations(
  block: Block,
  response: { id: string; translation: string }[],
) {
  const byID = new Map(response.map((entry) => [entry.id, entry.translation]));
  if (
    byID.size !== response.length ||
    response.length !== block.segments.length ||
    block.segments.some((segment) => !byID.get(segment.id)?.trim())
  ) {
    throw new Error(
      "Translation response has missing, duplicate or unknown segment IDs.",
    );
  }
  let text = "";
  for (const segment of block.segments) {
    const translated = byID.get(segment.id)!.trim();
    segment.translation = translated;
    segment.translationStart = text.length;
    text += translated;
    segment.translationEnd = text.length;
  }
  block.translation = text;
  delete block.error;
}
