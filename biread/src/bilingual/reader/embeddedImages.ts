import {
  imagePlacements,
  rgbaPixels,
  type PDFImage,
} from "../parser/pdfImages";
import { requestDeadline } from "../translation/requestDeadline";

export async function embeddedImages(
  nativePDF: any,
  win: any,
  pageIndex: number,
  cancelled: () => boolean,
): Promise<{ images: PDFImage[]; skipped: number }> {
  const page = Components.utils.waiveXrays(
    await nativePDF.getPage(pageIndex + 1),
  );
  const list = Components.utils.waiveXrays(
    await page.getOperatorList(
      Components.utils.cloneInto({ annotationMode: 0 }, win),
    ),
  );
  const placements = imagePlacements(list);
  const images: PDFImage[] = [];
  let skipped = 0;
  for (let i = 0; i < placements.length; i++) {
    if (cancelled()) break;
    if (i >= 80) {
      skipped += placements.length - i;
      break;
    }
    const placement = placements[i];
    try {
      let image = placement.image;
      if (typeof image === "string") {
        const pool = image.startsWith("g_") ? page.commonObjs : page.objs;
        image = await requestDeadline(
          new Promise<any>((resolve) => pool.get(image, resolve)),
          () => new Error("Image decoding timed out"),
          15000,
        );
      }
      if (cancelled()) break;
      image = Components.utils.waiveXrays(image);
      const width = image.width,
        height = image.height;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 1 ||
        height < 1
      )
        throw new Error("Missing image dimensions");
      if (!image.bitmap && width * height > 20000000)
        throw new Error("Embedded image exceeds decoding limit");
      const [x1, y1, x2, y2] = placement.rect;
      const scale = Math.min(2, 1600 / Math.max(x2 - x1, y2 - y1));
      const canvas = win.document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil((x2 - x1) * scale));
      canvas.height = Math.max(1, Math.ceil((y2 - y1) * scale));
      let scratch: HTMLCanvasElement | undefined;
      try {
        let pixels = image.bitmap;
        if (!pixels) {
          scratch = win.document.createElement("canvas");
          scratch!.width = width;
          scratch!.height = height;
          const ctx = scratch!.getContext("2d")!;
          const data = ctx.createImageData(width, height);
          data.data.set(rgbaPixels(image));
          ctx.putImageData(data, 0, 0);
          pixels = scratch;
        }
        const ctx = canvas.getContext("2d")!;
        const m = placement.matrix;
        // PDF image coordinates map the unit square with its pixel Y axis reversed.
        ctx.setTransform(
          (scale * m[0]) / width,
          (-scale * m[1]) / width,
          (-scale * m[2]) / height,
          (scale * m[3]) / height,
          scale * (m[2] + m[4] - x1),
          scale * (y2 - m[3] - m[5]),
        );
        ctx.drawImage(pixels, 0, 0, width, height);
        images.push({
          id: "p" + pageIndex + "-image" + i,
          pageIndex,
          rect: placement.rect,
          src: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
        });
      } finally {
        canvas.width = canvas.height = 0;
        if (scratch) scratch.width = scratch.height = 0;
      }
    } catch {
      skipped++;
    }
  }
  return { images, skipped };
}
