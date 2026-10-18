import type { Block } from "../types";
import { localModelRange } from "./localModel";

type Span = [number, number];

/** Use the translation's actual sentence IDs, never proportional character
 * positions. Long paragraphs and repeated phrases must not share one model window. */
export async function alignedSelectionRange(
  block: Block,
  side: "source" | "translation",
  start: number,
  end: number,
  infer = localModelRange,
): Promise<Span | undefined> {
  if (!block.translation) return;
  const texts = [block.source, block.translation];
  const origin = side === "source" ? 0 : 1;
  if (start < 0 || end <= start || end > texts[origin].length) return;
  const ranges: Span[] = [];
  let covered = start;
  for (const unit of block.segments) {
    if (
      unit.translationStart === undefined ||
      unit.translationEnd === undefined
    )
      continue;
    const offsets: Span[] = [
      [unit.sourceStart, unit.sourceEnd],
      [unit.translationStart, unit.translationEnd],
    ];
    const [lo, hi] = offsets[origin];
    if (lo >= end || hi <= start) continue;
    if (texts[origin].slice(covered, lo).trim()) return;
    const from = Math.max(start, lo),
      to = Math.min(end, hi);
    const local = texts.map((text, i) => text.slice(...offsets[i]));
    let span: Span | undefined;
    if (texts[origin].slice(from, to).trim() === local[origin].trim()) {
      span = [0, local[1 - origin].length];
    } else {
      // Opaque formula IDs are layout anchors, not words for the language model.
      // Equal-length spaces retain every DOM / PDF UTF-16 offset.
      const masked = local.map((text) =>
        text.replace(/\$BIREAD_MATH_[^$]+\$/g, (token) =>
          " ".repeat(token.length),
        ),
      );
      span = await infer(masked[0], masked[1], side, from - lo, to - lo);
    }
    // Do not silently save only one part of a multi-sentence selection.
    if (!span) return;
    ranges.push(span.map((n) => n + offsets[1 - origin][0]) as Span);
    covered = hi;
  }
  if (!ranges.length || texts[origin].slice(covered, end).trim()) return;
  return [
    Math.min(...ranges.map((r) => r[0])),
    Math.max(...ranges.map((r) => r[1])),
  ];
}
