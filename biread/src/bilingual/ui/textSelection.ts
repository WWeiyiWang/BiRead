// Visible formula previews have one logical text token. Loading labels, alt
// text and menu widgets must never shift annotation offsets in the paragraph.
export function logicalText(node: Node): string {
  const token = (node as HTMLElement).dataset?.textToken;
  if (token !== undefined) return token;
  if (node.nodeType === 3) return node.textContent || "";
  return Array.from(node.childNodes)
    .map((child) => (child ? logicalText(child) : ""))
    .join("");
}
const logicalLength = (node: Node) => logicalText(node).length;

export function selectionOffsets(
  container: HTMLElement,
  range: Range,
): [number, number] | undefined {
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  )
    return;
  const normalized = range.cloneRange();
  const atom = (node: Node) =>
    (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(
      "[data-text-token]",
    );
  const first = atom(range.startContainer),
    last = atom(range.endContainer);
  if (first) normalized.setStartBefore(first);
  if (last) normalized.setEndAfter(last);
  const prefix = normalized.cloneRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(normalized.startContainer, normalized.startOffset);
  const start = logicalLength(prefix.cloneContents());
  return [start, start + logicalLength(normalized.cloneContents())];
}

export function restoreSelection(
  container: HTMLElement,
  offsets: [number, number],
) {
  const range = container.ownerDocument.createRange();
  let offset = 0,
    begun = false,
    ended = false;
  const visit = (node: Node) => {
    if (ended) return;
    const token = (node as HTMLElement).dataset?.textToken;
    if (token === undefined && node.nodeType !== 3) {
      for (const child of Array.from(node.childNodes)) if (child) visit(child);
      return;
    }
    const length = logicalLength(node);
    if (!begun && offsets[0] <= offset + length) {
      if (token !== undefined) {
        if (offsets[0] === offset + length) range.setStartAfter(node);
        else range.setStartBefore(node);
      } else range.setStart(node, offsets[0] - offset);
      begun = true;
    }
    if (begun && offsets[1] <= offset + length) {
      if (token !== undefined) {
        if (offsets[1] === offset) range.setEndBefore(node);
        else range.setEndAfter(node);
      } else range.setEnd(node, offsets[1] - offset);
      ended = true;
    }
    offset += length;
  };
  visit(container);
  if (ended) {
    const selection = container.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}
