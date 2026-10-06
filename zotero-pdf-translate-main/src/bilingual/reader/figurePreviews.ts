import type { Block, Rect } from "../types";
import { sameRegion, type PDFImage } from "../parser/pdfImages";
import { graphicsRects, figureRegion } from "../parser/figureRegions";
import { requestDeadline } from "../translation/requestDeadline";
export async function figurePreviews(
  nativePDF: any,
  win: any,
  pageIndex: number,
  blocks: Block[],
  cancelled: () => boolean,
): Promise<PDFImage[]> {
  const captions = blocks.filter(
    (b) =>
      b.pageIndex === pageIndex &&
      b.kind === "caption" &&
      !blocks.some((cell) => cell.table?.captionID === b.id),
  );
  if (!captions.length) return [];
  const page = Components.utils.waiveXrays(
    await nativePDF.getPage(pageIndex + 1),
  );
  const list = Components.utils.waiveXrays(
    await page.getOperatorList(
      Components.utils.cloneInto({ annotationMode: 0 }, win),
    ),
  );
  const graphics = graphicsRects(list),
    images: PDFImage[] = [];
  for (const caption of captions) {
    if (cancelled()) break;
    const rect = figureRegion(
      caption,
      graphics,
      Array.from(page.view) as Rect,
      blocks,
    );
    if (!rect || images.some((image) => sameRegion(image.rect, rect))) continue;
    const viewport = page.getViewport(
      Components.utils.cloneInto({ scale: 2 }, win),
    );
    const r = viewport.convertToViewportRectangle(
      Components.utils.cloneInto(rect, win),
    );
    const left = Math.min(r[0], r[2]),
      top = Math.min(r[1], r[3]);
    const width = Math.ceil(Math.abs(r[2] - r[0])),
      height = Math.ceil(Math.abs(r[3] - r[1]));
    if (width * height > 6000000) continue;
    const canvas = win.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    let task: any;
    try {
      const options = Components.utils.waiveXrays(
        Components.utils.createObjectIn(win),
      );
      Object.assign(options, {
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: Components.utils.cloneInto([1, 0, 0, 1, -left, -top], win),
        annotationMode: 0,
        background: "rgb(255,255,255)",
      });
      task = page.render(options);
      await requestDeadline(
        task.promise,
        () => new Error("Figure preview timed out"),
        20000,
      );
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
    } catch (error) {
      Zotero.logError(error as Error);
      task?.cancel();
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  return images;
}
