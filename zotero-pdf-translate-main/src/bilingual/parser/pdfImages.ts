import type { Block, Rect } from "../types";
export type Matrix = [number, number, number, number, number, number];
export interface ImagePlacement {
  image: any;
  matrix: Matrix;
  rect: Rect;
}
export interface PDFImage {
  captionID?: string;
  preview?: boolean;
  id: string;
  pageIndex: number;
  rect: Rect;
  src: string;
  width: number;
  height: number;
}
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function imageRect(m: Matrix): Rect {
  const x = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const y = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
}
/** PDF.js image operators; no page rendering or screenshot acquisition. */
export function imagePlacements(list: {
  fnArray: number[];
  argsArray: any[];
}): ImagePlacement[] {
  let matrix = identity();
  const stack: Matrix[] = [];
  const result: ImagePlacement[] = [];
  const add = (image: any, m = matrix) => {
    const rect = imageRect(m);
    if (
      rect.every(Number.isFinite) &&
      rect[2] - rect[0] >= 8 &&
      rect[3] - rect[1] >= 8
    )
      result.push({ image, matrix: [...m], rect });
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i],
      a = list.argsArray[i] || [];
    if (op === 10 || op === 74 || op === 76) {
      stack.push([...matrix]);
      if (op === 74 && a[0]) matrix = multiply(matrix, a[0]);
      if (op === 76 && a[0]?.matrix) matrix = multiply(matrix, a[0].matrix);
    } else if (op === 11 || op === 75 || op === 77)
      matrix = stack.pop() || identity();
    else if (op === 12) matrix = multiply(matrix, a as Matrix);
    else if (op === 85 || op === 86) add(a[0]);
    else if (op === 88) {
      for (let j = 0; j < a[3].length; j += 2)
        add(a[0], multiply(matrix, [a[1], 0, 0, a[2], a[3][j], a[3][j + 1]]));
    }
    // Grouped inline images are a sprite sheet, not independent full pictures.
    // Do not display the whole sprite as a figure.
  }
  return result;
}
export function blockRect(block: Block): Rect {
  return [
    Math.min(...block.anchors.map((a) => a.rect[0])),
    Math.min(...block.anchors.map((a) => a.rect[1])),
    Math.max(...block.anchors.map((a) => a.rect[2])),
    Math.max(...block.anchors.map((a) => a.rect[3])),
  ];
}
export function imageAnchor(
  image: Pick<PDFImage, "pageIndex" | "rect">,
  blocks: Block[],
) {
  const page = blocks.filter((b) => b.pageIndex === image.pageIndex);
  const overlap = (r: Rect) =>
    Math.min(r[2], image.rect[2]) - Math.max(r[0], image.rect[0]) > 0;
  const below = page.filter(
    (b) =>
      b.anchors.length &&
      overlap(blockRect(b)) &&
      blockRect(b)[3] <= image.rect[1] + 8,
  );
  const captions = below.filter(
    (b) => b.kind === "caption" && image.rect[1] - blockRect(b)[3] < 180,
  );
  return (
    (captions.length ? captions : below).sort(
      (a, b) => blockRect(b)[3] - blockRect(a)[3],
    )[0] || page[0]
  );
}
/** Decode original PDF pixel data only; never renders text or a PDF page. */
export function rgbaPixels(image: {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array;
}): Uint8ClampedArray {
  const { width, height, kind, data } = image;
  if (width < 1 || height < 1 || width * height > 20000000)
    throw new Error("Image is too large to decode safely");
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 3) {
    if (data.length < out.length) throw new Error("Incomplete RGBA image");
    out.set(data.subarray(0, out.length));
  } else if (kind === 2) {
    if (data.length < width * height * 3)
      throw new Error("Incomplete RGB image");
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = data[i * 3];
      out[i * 4 + 1] = data[i * 3 + 1];
      out[i * 4 + 2] = data[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  } else if (kind === 1) {
    const stride = Math.ceil(width / 8);
    if (data.length < stride * height)
      throw new Error("Incomplete monochrome image");
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = data[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
        const i = (y * width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = 255;
      }
  } else throw new Error("Unsupported embedded image format");
  return out;
}
/** Duplicate representations of the same placement; distinct repeated placements survive. */
export function sameRegion(a: Rect, b: Rect, threshold = 0.88) {
  const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const aa = area(a),
    bb = area(b),
    overlap =
      Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
      Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (
    aa > 0 &&
    bb > 0 &&
    Math.min(aa, bb) / Math.max(aa, bb) > 0.72 &&
    overlap / Math.min(aa, bb) > threshold
  );
}
