import { pdfIntegration } from "../../src/bilingual/reader/pdfIntegration";
const imagesDescribe = Zotero.Prefs.get("bilingual.test.fixture", true)
  ? describe
  : describe.skip;
imagesDescribe("Original embedded PDF images", function () {
  this.timeout(60000);
  it("extracts repeated original images with their placement and colors", async function () {
    const fixture = Zotero.Prefs.get("bilingual.test.fixture", true) as string;
    const attachment = await Zotero.Attachments.importFromFile({
      file: PathUtils.join(PathUtils.parent(fixture)!, "images.pdf"),
    });
    const reader: any = await Zotero.Reader.open(attachment.id);
    try {
      const integration = await pdfIntegration(reader);
      const result = await integration.pdf.getImages(0, () => false);
      assert.equal(result.skipped, 0);
      assert.equal(result.images.length, 2);
      assert.deepEqual(result.images[0].rect, [60, 500, 220, 620]);
      const win = integration.win;
      const image = win.document.createElement("img");
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Image decode failed"));
      });
      image.src = result.images[0].src;
      await loaded;
      const canvas = win.document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const left = Components.utils.waiveXrays(
        context.getImageData(20, 20, 1, 1).data,
      );
      const right = Components.utils.waiveXrays(
        context.getImageData(canvas.width - 20, 20, 1, 1).data,
      );
      assert.isAbove(left[0], 240);
      assert.isBelow(left[2], 10);
      assert.isAbove(right[2], 240);
      assert.isBelow(right[0], 10);
      canvas.width = canvas.height = 0;
    } finally {
      reader.close();
      await attachment.eraseTx();
    }
  });
});
