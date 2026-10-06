// Protect common academic citations, DOIs and URLs before either LLM or MT.
// Missing/changed tokens are an error, never a silently corrupted cache entry.
export function protectText(text: string) {
  const values: string[] = [];
  const pattern =
    /https?:\/\/[^\s<>]+|\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+|\[[\d\s,;–—-]+\]|\([^()\n]{0,120}\b(?:18|19|20)\d{2}[a-z]?[^()\n]{0,60}\)|\$[^$\n]+\$/gi;
  const masked = text.replace(pattern, (value) => {
    const token = `⟦ZPT_KEEP_${values.length}⟧`;
    values.push(value);
    return token;
  });
  return {
    text: masked,
    parts: masked
      .split(/(⟦ZPT_KEEP_\d+⟧)/g)
      .filter(Boolean)
      .map((part) => {
        const token = part.match(/^⟦ZPT_KEEP_(\d+)⟧$/);
        return {
          text: token ? values[Number(token[1])] : part,
          protected: !!token,
        };
      }),
    restore(translation: string): string {
      for (let i = 0; i < values.length; i++) {
        const token = `⟦ZPT_KEEP_${i}⟧`;
        if (translation.split(token).length !== 2)
          throw new Error(
            "Provider changed or omitted a protected citation, URL or formula. Retry with another provider.",
          );
        translation = translation.replace(token, values[i]);
      }
      if (/⟦ZPT_KEEP_\d+⟧/.test(translation))
        throw new Error("Provider returned an unknown citation token.");
      return translation;
    },
  };
}

/** Apply explicitly chosen terminology locally for MT without exposing citations. */
export function glossaryParts(text: string, glossary: Record<string, string>) {
  const terms = Object.keys(glossary)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const parts: { text: string; protected: boolean }[] = [];
  let plain = "";
  for (let i = 0; i < text.length; ) {
    const term = terms.find(
      (term) =>
        text.slice(i, i + term.length).toLowerCase() === term.toLowerCase() &&
        (!/[a-z0-9]/i.test(term[0]) ||
          i === 0 ||
          !/[a-z0-9]/i.test(text[i - 1])) &&
        (!/[a-z0-9]/i.test(term[term.length - 1]) ||
          i + term.length === text.length ||
          !/[a-z0-9]/i.test(text[i + term.length])),
    );
    if (term) {
      if (plain) parts.push({ text: plain, protected: false });
      plain = "";
      parts.push({ text: glossary[term], protected: true });
      i += term.length;
    } else {
      plain += text[i++];
    }
  }
  if (plain) parts.push({ text: plain, protected: false });
  return parts;
}
