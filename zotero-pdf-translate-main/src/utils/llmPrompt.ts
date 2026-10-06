import { getPref } from "./prefs";
import { TranslateTask } from "./task";

/**
 * Split the prompt template into a system instruction and a user content.
 * The `${sourceText}` placeholder separates the instruction part from the
 * actual text to translate, improving the model's instruction following.
 * Paper context (title/abstract) goes to the system message as background.
 */
export function buildPromptParts(
  prefKey: string,
  langFrom: string,
  langTo: string,
  sourceText: string,
  data: Required<TranslateTask>,
): { system: string; user: string } {
  if (data.bilingualInstruction) {
    return { system: data.bilingualInstruction, user: sourceText };
  }
  const prompt = getPref(prefKey) as string;
  const marker = "${sourceText}";
  const markerIndex = prompt.indexOf(marker);
  const before = prompt.slice(0, markerIndex);
  const after = prompt.slice(markerIndex + marker.length);

  let instruction = `${before.trimEnd()} ${after.trimStart()}`
    .replaceAll("${langFrom}", langFrom)
    .replaceAll("${langTo}", langTo)
    .trim();

  if (getPref("attachPaperContext") && data.itemId) {
    const item = Zotero.Items.get(data.itemId);
    const topItem = item ? Zotero.Items.getTopLevel([item])[0] : null;
    if (topItem) {
      let contextInfo = "";
      const title = topItem.getField("title") as string;
      const abstract = topItem.getField("abstractNote") as string;

      if (title) {
        contextInfo += `Paper Title: ${title}`;
      }
      if (abstract) {
        contextInfo += title
          ? `\n\nPaper Abstract: ${abstract}`
          : `Paper Abstract: ${abstract}`;
      }

      if (contextInfo) {
        instruction += `\n\nContext from the academic paper:\n${contextInfo}`;
      }
    }
  }

  return { system: instruction, user: sourceText };
}
