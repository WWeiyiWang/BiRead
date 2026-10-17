import type { Block, Rect } from "../types";
import { blockRect, sameRegion, type PDFImage } from "../parser/pdfImages";
import { graphicsRects, figureRegion } from "../parser/figureRegions";
import { requestDeadline } from "../translation/requestDeadline";
export async function figurePreviews(
  nativePDF: any,
  win: any,
  pageIndex: number,
  blocks: Block[],
  cancelled: () => boolean,
): Promise<PDFImage[]> {
  const captions = blocks
    .flatMap((b) => [
      b,
      ...(b.inlineMath || []).map((m) => ({
        ...b,
        id: m.id,
        kind: "equation" as const,
        originalRegion: { kind: "equation" as const, rect: m.rect },
      })),
    ])
    .filter(
      (b) =>
        b.pageIndex === pageIndex &&
        ["caption", "equation", "original-page"].includes(b.kind) &&
        !blocks.some((cell) => cell.table?.captionID === b.id),
    );
  if (!captions.length) return [];
  const page = Components.utils.waiveXrays(
    await nativePDF.getPage(pageIndex + 1),
  );
  const graphics = captions.some(
    (b) => !b.originalRegion && b.kind === "caption",
  )
    ? graphicsRects(
        Components.utils.waiveXrays(
          await page.getOperatorList(
            Components.utils.cloneInto({ annotationMode: 0 }, win),
          ),
        ),
      )
    : [];
  const images: PDFImage[] = [];
  const regions: { caption: Block; rect: Rect }[] = [];
  for (const caption of captions) {
    if (cancelled()) break;
    const rect = caption.originalRegion
      ? caption.originalRegion.rect
      : caption.kind === "equation"
        ? (blockRect(caption).map((v, i) => v + (i < 2 ? -2 : 2)) as Rect)
        : figureRegion(
            caption,
            graphics,
            Array.from(page.view) as Rect,
            blocks,
          );
    if (!rect || regions.some((image) => sameRegion(image.rect, rect)))
      continue;
    regions.push({ caption, rect });
  }
  if (!regions.length || cancelled()) return [];
  // Rendering the page once is essential: dozens of equations used to repeat
  // the entire operator list and exhaust the page-level loading deadline.
  const base = page.getViewport(Components.utils.cloneInto({ scale: 1 }, win));
  const scale = Math.min(2, Math.sqrt(6000000 / (base.width * base.height)));
  const viewport = page.getViewport(Components.utils.cloneInto({ scale }, win));
  const full = win.document.createElement("canvas");
  full.width = Math.ceil(viewport.width);
  full.height = Math.ceil(viewport.height);
  let task: any;
  try {
    const options = Components.utils.waiveXrays(
      Components.utils.createObjectIn(win),
    );
    Object.assign(options, {
      canvasContext: full.getContext("2d"),
      viewport,
      annotationMode: 0,
      background: "rgb(255,255,255)",
    });
    task = page.render(options);
    await requestDeadline(
      task.promise,
      () => new Error("Figure preview timed out"),
      20000,
    );
    for (const { caption, rect } of regions) {
      if (cancelled()) return [];
      const r = viewport.convertToViewportRectangle(
        Components.utils.cloneInto(rect, win),
      );
      const left = Math.max(0, Math.floor(Math.min(r[0], r[2]))),
        top = Math.max(0, Math.floor(Math.min(r[1], r[3])));
      const width =
          Math.min(full.width, Math.ceil(Math.max(r[0], r[2]))) - left,
        height = Math.min(full.height, Math.ceil(Math.max(r[1], r[3]))) - top;
      if (width <= 0 || height <= 0) throw new Error("Invalid preview region");
      const canvas = win.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        canvas
          .getContext("2d")
          .drawImage(full, left, top, width, height, 0, 0, width, height);
        if (!cancelled())
          images.push({
            id: caption.id + "-figure",
            pageIndex,
            rect,
            src: canvas.toDataURL("image/png"),
            width,
            height,
            captionID: caption.id,
            preview: true,
          });
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  } catch (error) {
    task?.cancel();
    throw error;
  } finally {
    full.width = full.height = 0;
  }
  return images;
}
