import { graphicsRects } from "../parser/figureRegions";
import { figurePreviews } from "./figurePreviews";
import { embeddedImages } from "./embeddedImages";
import type { Block } from "../types";

// All use of private reader APIs is isolated here and capability-checked.
export async function pdfIntegration(reader: any) {
  await reader._initPromise;
  const view = reader._internalReader?._primaryView;
  await view?.initializedPromise;
  const win = view?._iframeWindow;
  const nativePDF = win?.PDFViewerApplication?.pdfDocument;
  const pdf = nativePDF && {
    numPages: nativePDF.numPages,
    fingerprints: nativePDF.fingerprints || nativePDF.fingerprint,
    getPageLabels: () => nativePDF.getPageLabels(),
    getGraphics: async (pageIndex: number) => {
      const page = Components.utils.waiveXrays(
        await nativePDF.getPage(pageIndex + 1),
      );
      const list = Components.utils.waiveXrays(
        await page.getOperatorList(
          Components.utils.cloneInto({ annotationMode: 0 }, win),
        ),
      );
      return graphicsRects(list);
    },
    getFigures: (
      pageIndex: number,
      blocks: Block[],
      cancelled: () => boolean,
    ) => figurePreviews(nativePDF, win, pageIndex, blocks, cancelled),
    getImages: (pageIndex: number, cancelled: () => boolean) =>
      embeddedImages(nativePDF, win, pageIndex, cancelled),
    getPageData: (request: { pageIndex: number }) =>
      nativePDF.getPageData(Components.utils.cloneInto(request, win)),
  };
  if (!win?.document || !pdf)
    throw new Error("Open a PDF attachment in Zotero first.");
  const item = Zotero.Items.get(reader.itemID);
  const path = await item.getFilePathAsync();
  if (!path) throw new Error("The PDF attachment is not available locally.");
  const stat = await IOUtils.stat(path);
  const fingerprint = JSON.stringify([
    pdf.fingerprints || pdf.fingerprint,
    stat.size,
    stat.lastModified,
    pdf.numPages,
    10,
  ]);
  return {
    reader,
    view,
    win,
    pdf,
    item,
    identity: `${item.libraryID}-${item.key}`,
    fingerprint,
  };
}
export type PDFIntegration = Awaited<ReturnType<typeof pdfIntegration>>;
export async function jumpToBlock(integration: PDFIntegration, block: Block) {
  await integration.reader.navigate({
    pageIndex: block.pageIndex,
    position: {
      pageIndex: block.pageIndex,
      rects: block.anchors.slice(0, 1).map((a) => a.rect),
    },
  });
}
export function currentPage(integration: PDFIntegration): number {
  return Math.max(
    0,
    (integration.win.PDFViewerApplication.pdfViewer.currentPageNumber || 1) - 1,
  );
}
export async function focusAnnotation(
  integration: PDFIntegration,
  key: string,
) {
  integration.reader.toggleSidebar?.(true);
  integration.reader.setSidebarView?.("annotations");
  await integration.reader.navigate({ annotationID: key });
}

/** A local, nested frame isolates normal text selection from PDF.js's capture
 * handlers, which otherwise clear browser ranges on every toolbar mousedown. */
export async function createBilingualSurface(
  integration: PDFIntegration,
): Promise<HTMLIFrameElement> {
  const frame = integration.win.document.createElement(
    "iframe",
  ) as HTMLIFrameElement;
  frame.id = "zpt-bilingual-frame";
  frame.title = "Bilingual reading";
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:100;background:Canvas";
  const ready = new Promise<void>((resolve) =>
    frame.addEventListener("load", () => resolve(), { once: true }),
  );
  frame.src = "about:blank";
  integration.win.document.body.append(frame);
  await ready;
  if (!frame.contentDocument?.body) {
    frame.remove();
    throw new Error("Unable to initialize the bilingual reader.");
  }
  return frame;
}
