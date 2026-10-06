import type { Block, TranslationContext } from "../types";
import { TranslationCache } from "../cache/translationCache";
import { applyTranslations } from "../alignment/segmentAlignment";
import { translateBlock } from "./providers";

export async function translateProgressively(
  blocks: Block[],
  identity: string,
  context: TranslationContext,
  itemID: number,
  update: (block: Block, done: number, total: number) => void,
  cancelled: () => boolean,
  waiting: (block: Block, seconds: number) => void = () => {},
  options: { concurrency?: number; priority?: () => number } = {},
) {
  const cache = new TranslationCache(identity, context);
  let done = 0;
  const pending: Block[] = [];
  for (const block of blocks) {
    if (cancelled()) return;
    if (
      !block.source.trim() ||
      ["reference", "equation"].includes(block.kind)
    ) {
      applyTranslations(
        block,
        block.segments.map((s) => ({ id: s.id, translation: s.source })),
      );
      block.translation = block.source;
      for (const segment of block.segments) {
        segment.translation = segment.source;
        segment.translationStart = segment.sourceStart;
        segment.translationEnd = segment.sourceEnd;
      }
      done++;
    } else if (
      block.kind === "heading" &&
      /^abstract[:：.]?$/i.test(block.source.trim()) &&
      block.segments.length === 1
    ) {
      // This is the academic section label, not the adjective “abstract”.
      applyTranslations(block, [
        { id: block.segments[0].id, translation: "摘要" },
      ]);
      done++;
    } else if (await cache.restore(block)) done++;
    else {
      delete block.translation;
      delete block.error;
      for (const segment of block.segments) {
        delete segment.translation;
        delete segment.translationStart;
        delete segment.translationEnd;
      }
      pending.push(block);
    }
    update(block, done, blocks.length);
  }
  // Independent blocks share a bounded queue. In-flight work drains before a
  // restart, so settings changes cannot start a second overlapping scheduler.
  let failure: unknown;
  const concurrency = Math.max(
    1,
    Math.min(3, Math.floor(options.concurrency || 1)),
  );
  const worker = async () => {
    while (pending.length && !cancelled() && !failure) {
      const page = options.priority?.();
      if (page !== undefined)
        pending.sort(
          (a, b) => Math.abs(a.pageIndex - page) - Math.abs(b.pageIndex - page),
        );
      const block = pending.shift()!;
      const started = Date.now();
      waiting(block, 0);
      const timer = setInterval(
        () => waiting(block, Math.floor((Date.now() - started) / 1000)),
        1000,
      );
      try {
        const response = await translateBlock(
          block,
          context,
          itemID,
          cancelled,
        );
        if (cancelled()) return;
        applyTranslations(block, response);
        await cache.save(block);
        update(block, ++done, blocks.length);
        await Zotero.Promise.delay(
          Math.max(100, addon.data.translate.batchTaskDelay || 0),
        );
      } catch (error) {
        if (cancelled()) return;
        block.error = error instanceof Error ? error.message : String(error);
        update(block, done, blocks.length);
        failure = error;
      } finally {
        clearInterval(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failure) throw failure;
}
