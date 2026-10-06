import type { Block, TranslationContext } from "../types";
import { digest, readJSON, writeJSON } from "./documentCache";
import { relevantGlossary } from "../glossary/documentGlossary";
import { applyTranslations } from "../alignment/segmentAlignment";

interface Entry {
  source: string;
  segments: { id: string; translation: string }[];
}
export class TranslationCache {
  constructor(
    private identity: string,
    private context: TranslationContext,
  ) {}
  async key(block: Block) {
    // Glossary version is the hash of the subset affecting this block. Unrelated
    // terminology edits therefore keep their existing cache entries valid.
    const glossaryVersion = await digest(
      JSON.stringify(relevantGlossary(block.source, this.context.glossary)),
    );
    return (
      "translation-" +
      (await digest(
        JSON.stringify([
          3,
          this.identity,
          block.id,
          await digest(block.source),
          this.context.provider,
          this.context.model,
          this.context.endpoint,
          this.context.mode,
          "en",
          "zh-CN",
          glossaryVersion,
        ]),
      ))
    );
  }
  async restore(block: Block) {
    const entry = await readJSON<Entry>(await this.key(block));
    if (!entry || entry.source !== block.source) return false;
    try {
      applyTranslations(block, entry.segments);
      return true;
    } catch {
      return false;
    }
  }
  async save(block: Block) {
    await writeJSON(await this.key(block), {
      source: block.source,
      segments: block.segments.map((s) => ({
        id: s.id,
        translation: s.translation,
      })),
    });
  }
}
