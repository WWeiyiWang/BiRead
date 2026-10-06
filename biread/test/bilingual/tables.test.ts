import {
  pdfIntegration,
  createBilingualSurface,
} from "../../src/bilingual/reader/pdfIntegration";
import { extractDocument } from "../../src/bilingual/parser/pdfTextExtractor";
import { blockRect } from "../../src/bilingual/parser/pdfImages";
import { tableTextBlocks } from "../../src/bilingual/parser/figureRegions";
import { BilingualView } from "../../src/bilingual/ui/bilingualView";
const tableDescribe = Zotero.Prefs.get("bilingual.test.tableFixture", true)
  ? describe
  : describe.skip;
tableDescribe("Frontiers top-caption tables", function () {
  this.timeout(120000);
  it("renders Table 1 below its caption and keeps notes outside the folded table text", async function () {
    const path = Zotero.Prefs.get(
      "bilingual.test.tableFixture",
      true,
    ) as string;
    const attachment = await Zotero.Attachments.importFromFile({ file: path });
    const reader: any = await Zotero.Reader.open(attachment.id);
    try {
      const integration = await pdfIntegration(reader);
      const doc = await extractDocument(
        integration.pdf,
        integration.identity,
        integration.fingerprint,
        () => {},
        () => false,
      );
      const caption = doc.blocks.find(
        (b) => b.kind === "caption" && /^TABLE 1\b/i.test(b.source),
      )!;
      assert.isOk(caption, "Table 1 caption found");
      assert.equal(caption.pageIndex, 11);
      const previews = await integration.pdf.getFigures(
        caption.pageIndex,
        doc.blocks,
        () => false,
      );
      const preview = previews.find((p: any) => p.captionID === caption.id);
      await IOUtils.writeJSON(path + ".tables.json", {
        caption: caption.source,
        captionRect: blockRect(caption),
        previews: previews.map((p: any) => ({
          id: p.captionID,
          rect: p.rect,
          width: p.width,
          height: p.height,
        })),
        pageBlocks: doc.blocks
          .filter((b) => b.pageIndex === caption.pageIndex)
          .map((b) => ({
            id: b.id,
            kind: b.kind,
            text: b.source,
            rect: blockRect(b),
          })),
      });
      assert.isOk(preview, "Table 1 preview exists");
      assert.isBelow(
        preview.rect[3],
        blockRect(caption)[1] + 3,
        "table is below its caption",
      );
      assert.isAbove(preview.width, 600);
      assert.isAbove(preview.height, 70);
      const folded = tableTextBlocks(
        caption.id,
        caption.pageIndex,
        preview.rect,
        doc.blocks,
      );
      assert.isTrue(
        folded.some((b) => b.source.includes("304")),
        "numeric rows are covered by the preview",
      );
      assert.isFalse(
        folded.some((b) => b.source.startsWith("Total Viewers denotes")),
        "table note remains outside",
      );
      const binary = Zotero.getMainWindow().atob(preview.src.split(",")[1]);
      await IOUtils.write(
        path + ".table.png",
        Uint8Array.from(binary, (c: string) => c.charCodeAt(0)),
      );
      const frame = await createBilingualSurface(integration);
      const ui = new BilingualView(
        frame.contentDocument!,
        () => {},
        () => {},
      );
      ui.showBlocks(doc.blocks);
      ui.showImage(preview, doc.blocks);
      ui.scrollTo(caption.id);
      const row = ui.root.querySelector(
        '[data-block-id="' + caption.id + '"]',
      )!;
      const started = Date.now();
      while (!row.querySelector(".bi-table-text")) {
        if (Date.now() - started > 10000)
          throw new Error("Table image did not decode in bilingual view");
        await Zotero.Promise.delay(50);
      }
      assert.isAbove(row.querySelectorAll(".bi-table-text .bi-row").length, 0);
      const details = row.querySelector("details")!;
      assert.isFalse(details.open);
      details.open = true;
      assert.include(details.textContent, "304");
      assert.isTrue(
        row
          .querySelector(".bi-columns")!
          .compareDocumentPosition(row.querySelector(".bi-images")!) & 4
          ? true
          : false,
        "caption precedes table",
      );
      ui.dispose();
      frame.remove();
    } catch (error) {
      await IOUtils.writeUTF8(
        path + ".error.txt",
        String(error) + "\n" + (error as Error).stack,
      );
      throw error;
    } finally {
      reader.close();
      await attachment.eraseTx();
    }
  });
});
