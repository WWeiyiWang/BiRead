import type { TranslationContext } from "../types";
import { digest, readJSON, writeJSON } from "../cache/documentCache";

export function relevantGlossary(
  source: string,
  glossary: TranslationContext["glossary"],
) {
  return Object.fromEntries(
    Object.entries(glossary)
      .filter(([term]) => source.toLowerCase().includes(term.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function loadGlossary(identity: string) {
  return (
    (await readJSON<Record<string, string>>(
      "glossary-" + (await digest(identity)),
    )) || {}
  );
}
export async function saveGlossary(
  identity: string,
  glossary: Record<string, string>,
) {
  await writeJSON("glossary-" + (await digest(identity)), glossary);
}
export function parseGlossary(text: string): Record<string, string> {
  const entries = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split(/\s*(?:→|=>|\t)\s*/);
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim())
        throw new Error("Use one term → translation per line.");
      return [parts[0].trim(), parts[1].trim()];
    });
  return Object.fromEntries(entries);
}
