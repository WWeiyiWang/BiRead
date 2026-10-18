interface Part {
  text: string;
  protected: boolean;
}

/** Keep a whole sentence as the translation unit, including the positions of
 * math and citations. Accept it only when every opaque marker survives once.
 * A provider that cannot preserve markers gets the conservative local-splice
 * fallback; an error/timeout is still an error, not a silent extra request. */
export async function translateContinuous(
  parts: Part[],
  run: (text: string) => Promise<string>,
): Promise<string> {
  if (!parts.some((p) => !p.protected && /[a-zA-Z]/.test(p.text)))
    return parts.map((p) => p.text).join("");
  if (parts.some((p) => p.protected)) {
    const original = parts.map((p) => p.text).join("");
    let prefix = "ZXQKEEP";
    while (original.toUpperCase().includes(prefix)) prefix += "Q";
    const values: string[] = [];
    const tokens: string[] = [];
    const input = parts
      .map((p) => {
        if (!p.protected) return p.text;
        const token = `${prefix}${values.length}QXZ`;
        values.push(p.text);
        tokens.push(token);
        return token;
      })
      .join("");
    const output = await run(input.trim());
    const found = output.match(new RegExp(`${prefix}\\d+QXZ`, "gi")) || [];
    if (
      found.length === tokens.length &&
      tokens.every(
        (t) => found.filter((f) => f.toUpperCase() === t).length === 1,
      )
    ) {
      const restored = output.replace(
        new RegExp(`${prefix}(\\d+)QXZ`, "gi"),
        (_all, index: string) => values[Number(index)],
      );
      return (
        (input.match(/^\s*/)?.[0] || "") +
        restored.trim() +
        (input.match(/\s*$/)?.[0] || "")
      );
    }
  }
  let translated = "";
  for (const part of parts) {
    if (part.protected || !/[a-zA-Z]/.test(part.text)) translated += part.text;
    else
      translated +=
        (part.text.match(/^\s*/)?.[0] || "") +
        (await run(part.text.trim())).trim() +
        (part.text.match(/\s*$/)?.[0] || "");
  }
  return translated;
}
