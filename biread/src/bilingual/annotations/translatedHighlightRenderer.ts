import type { LinkedAnnotation } from "../types";

// Split at all boundaries so overlapping annotations remain independently
// addressable. No source or model text is ever inserted as HTML.
export function renderHighlights(
  container: HTMLElement,
  text: string,
  mappings: LinkedAnnotation[],
  side: "source" | "translation",
  click: (key: string) => void,
  hover: (key?: string) => void,
) {
  const doc = container.ownerDocument;
  const boundaries = new Set([0, text.length]);
  for (const mapping of mappings) {
    boundaries.add(
      Math.max(0, Math.min(text.length, mapping[side].startOffset)),
    );
    boundaries.add(Math.max(0, Math.min(text.length, mapping[side].endOffset)));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const fragment = doc.createDocumentFragment();
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i],
      end = sorted[i + 1];
    const active = mappings.filter(
      (m) => m[side].startOffset < end && m[side].endOffset > start,
    );
    if (!active.length) {
      fragment.append(doc.createTextNode(text.slice(start, end)));
      continue;
    }
    const mark = doc.createElement("mark");
    mark.textContent = text.slice(start, end);
    mark.dataset.keys = active.map((m) => m.zoteroAnnotationKey).join(" ");
    mark.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(
      active[active.length - 1].color,
    )
      ? active[active.length - 1].color + "40"
      : "#ffd40040";
    if (active.length > 1) {
      const stops = active.map((entry, index) => {
        const color = /^#[0-9a-f]{6}$/i.test(entry.color)
          ? entry.color + "40"
          : "#ffd40040";
        return `${color} ${(index * 100) / active.length}%, ${color} ${((index + 1) * 100) / active.length}%`;
      });
      mark.style.backgroundImage = `linear-gradient(to bottom, ${stops.join(",")})`;
    }
    if (active.some((m) => m.type === "underline")) {
      mark.style.textDecoration = "underline";
      mark.style.textDecorationColor = active.find(
        (m) => m.type === "underline",
      )!.color;
      mark.style.textDecorationThickness = "2px";
      if (active.every((m) => m.type === "underline")) {
        mark.style.backgroundColor = "transparent";
        mark.style.backgroundImage = "none";
      }
    }
    mark.title = active
      .map((m) => m.comment || "Open Zotero annotation (sentence-aligned)")
      .join("\n");
    mark.tabIndex = 0;
    mark.onclick = () => click(active[active.length - 1].zoteroAnnotationKey);
    mark.onkeydown = (event) => {
      if (event.key === "Enter")
        click(active[active.length - 1].zoteroAnnotationKey);
    };
    mark.onmouseenter = () =>
      hover(active[active.length - 1].zoteroAnnotationKey);
    mark.onmouseleave = () => hover();
    // Cycling overlapping marks is handled by a small context menu selector.
    mark.oncontextmenu = (event) => {
      if (active.length < 2) return;
      event.preventDefault();
      const menu = doc.createElement("select");
      for (const entry of active) {
        const option = doc.createElement("option");
        option.value = entry.zoteroAnnotationKey;
        option.textContent = entry.comment || entry.zoteroAnnotationKey;
        menu.append(option);
      }
      menu.onchange = () => {
        click(menu.value);
        menu.remove();
      };
      menu.onblur = () => menu.remove();
      mark.after(menu);
      menu.focus();
    };
    fragment.append(mark);
  }
  container.replaceChildren(fragment);
}
